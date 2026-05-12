import { LitElement, html, css } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import { VoiceStreamingCardConfig, HomeAssistant, ConnectionStatus } from "./types";
import { WebRTCManager } from "./webrtc-manager";
import { sharedStyles } from "./styles";
import "./voice-sending-editor"; // Static import ensures registration

@customElement("voice-sending-card")
export class VoiceSendingCard extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private config!: VoiceStreamingCardConfig;
  @state() private status: ConnectionStatus = "disconnected";
  @state() private errorMessage: string = "";
  @state() private latency: number = 0;

  @query("canvas") private canvas!: HTMLCanvasElement;

  private webrtc: WebRTCManager | null = null;
  private animationFrame: number | null = null;

  static get styles() {
    return [
      sharedStyles,
      css`
        /* Add specific styles if needed */
      `,
    ];
  }

  public static async getConfigElement() {
    return document.createElement("voice-sending-card-editor");
  }

  public static getStubConfig(): VoiceStreamingCardConfig {
    return {
      type: "custom:voice-sending-card",
      title: "Voice Sender",
      auto_start: false,
      noise_suppression: true,
      echo_cancellation: true,
      auto_gain_control: true,
    };
  }

  public setConfig(config: VoiceStreamingCardConfig): void {
    if (!config) {
      throw new Error("Invalid configuration");
    }
    this.config = config;

    // If manager already exists, update its config
    if (this.webrtc) {
      this.webrtc.updateConfig({
        serverUrl: this.config.server_url,
        noiseSuppression: this.config.noise_suppression,
        echoCancellation: this.config.echo_cancellation,
        autoGainControl: this.config.auto_gain_control,
      });
    }
  }

  public getCardSize(): number {
    return 3;
  }

  async connectedCallback() {
    super.connectedCallback();
    
    let serverUrl = this.config?.server_url;
    
    // Auto-discover ingress URL if not provided
    if (!serverUrl && this.hass) {
      try {
        const result = await this.hass.callWS({
          type: "supervisor/api",
          endpoint: "/addons/self/info",
          method: "GET"
        }).catch(() => this.hass.callWS({
          type: "supervisor/api",
          endpoint: "/addons/webrtc-voice-streamer/info",
          method: "GET"
        }));
        if (result && result.data && result.data.ingress_url) {
          serverUrl = `${result.data.ingress_url}/ws`;
          console.log("Auto-discovered WebRTC Ingress URL:", serverUrl);
        }
      } catch (e) {
        console.warn("Failed to auto-discover Ingress URL via Supervisor API", e);
      }
    }

    if (!this.webrtc) {
      this.webrtc = new WebRTCManager({
        serverUrl: serverUrl,
        noiseSuppression: this.config?.noise_suppression,
        echoCancellation: this.config?.echo_cancellation,
        autoGainControl: this.config?.auto_gain_control,
      });
    }

    this.webrtc.addEventListener("state-changed", (e: any) => {
      this.status = e.detail.state;
      if (e.detail.error) {
        this.errorMessage = e.detail.error;
      } else {
        this.errorMessage = "";
      }
      this.requestUpdate();
    });

    this.webrtc.addEventListener("audio-data", (e: any) => {
      if (e.detail.timestamp) {
        this.latency = Date.now() - e.detail.timestamp * 1000;
      }
    });

    // Check for auto_start. Default to false if not provided.
    if (this.config?.auto_start === true) {
      this.toggleSending();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stopVisualization();
    this.webrtc?.stop();
  }

  private async toggleSending() {
    if (this.status === "connected" || this.status === "connecting") {
      this.webrtc?.stop();
      this.stopVisualization();
      await this.manageMediaPlayer("stop");
    } else {
      await this.webrtc?.startSending();
      this.startVisualization();
      await this.manageMediaPlayer("play");
    }
  }

  private async manageMediaPlayer(action: "play" | "stop") {
    if (!this.config.target_media_player || !this.hass) return;

    try {
      if (action === "play") {
        if (!this.config.stream_url) {
          console.warn("No stream_url configured for media player playback");
          return;
        }

        const streamUrl = this.config.stream_url;

        await this.hass.callService("media_player", "play_media", {
          entity_id: this.config.target_media_player,
          media_content_id: streamUrl,
          media_content_type: "music",
        });
      } else {
        await this.hass.callService("media_player", "media_stop", {
          entity_id: this.config.target_media_player,
        });
      }
    } catch (e) {
      console.error("Failed to control media player:", e);
      this.errorMessage = `Media Player Error: ${(e as Error).message}`;
    }
  }

  private startVisualization() {
    if (!this.canvas || !this.webrtc) return;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const analyser = this.webrtc?.getAnalyser();
      if (!analyser) {
        this.animationFrame = requestAnimationFrame(draw);
        return;
      }

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyser.getByteFrequencyData(dataArray);

      ctx.fillStyle = "rgb(240, 240, 240)";
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      const barWidth = (this.canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * this.canvas.height;
        ctx.fillStyle = `rgb(${barHeight + 100}, 50, 50)`;
        ctx.fillRect(x, this.canvas.height - barHeight / 2, barWidth, barHeight);
        x += barWidth + 1;
      }

      this.animationFrame = requestAnimationFrame(draw);
    };

    draw();
  }

  private stopVisualization() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  protected render() {
    if (!this.config) return html``;

    const isSending = this.status === "connected";
    const buttonIcon = isSending ? "🛑" : "🎤";
    const statusText = this.errorMessage || this.status;

    return html`
      <ha-card>
        <div class="header">
          <div class="title">${this.config.title || this.config.name || "Voice Send"}</div>
          <div class="status-badge ${this.status}">${this.status}</div>
        </div>

        <div class="content">
          <div class="visualization">
            <canvas width="300" height="64"></canvas>
          </div>

          <div class="controls">
            <button
              class="main-button ${isSending ? "active" : ""} ${this.status === "error" ? "error" : ""}"
              @click=${this.toggleSending}
              ?disabled=${this.status === "connecting"}
            >
              ${buttonIcon}
            </button>
          </div>

          <div class="stats">${isSending ? html`<span>Latency: ${this.latency}ms</span>` : ""}</div>

          ${this.errorMessage ? html`<div class="error-message">${this.errorMessage}</div>` : ""}
        </div>
      </ha-card>
    `;
  }
}

// Register for HACS
(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "voice-sending-card",
  name: "Voice Sending Card",
  description: "Send voice audio via WebRTC",
  preview: true,
  editor: "voice-sending-card-editor", // Add visual editor support
  version: "1.2.0",
});
