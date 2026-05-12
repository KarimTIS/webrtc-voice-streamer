import { LitElement, html, css } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import { VoiceReceivingCardConfig, HomeAssistant, ConnectionStatus } from "./types";
import { WebRTCManager } from "./webrtc-manager";
import { sharedStyles } from "./styles";
import "./voice-receiving-editor";

// Constants for configuration
const CONSTANTS = {
  RECONNECT: {
    INITIAL_DELAY: 1000,
    MAX_DELAY: 30000,
    BACKOFF_FACTOR: 1.5,
  },
  TIMERS: {
    STREAM_CHECK_INTERVAL: 5000,
    AUTO_CONNECT_WAIT: 500,
    UI_UPDATE_DELAY: 200,
  },
  AUDIO: {
    FFT_SIZE: 256,
  },
  LATENCY: {
    LOW: 50,
    MEDIUM: 150,
  },
};

@customElement("voice-receiving-card")
export class VoiceReceivingCard extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private config!: VoiceReceivingCardConfig;
  @state() private status: ConnectionStatus = "disconnected";
  @state() private errorMessage: string = "";
  @state() private latency: number = 0;
  @state() private availableStreams: string[] = [];
  @state() private selectedStream: string | null = null;
  @state() private isWatching: boolean = false;
  @state() private isActive: boolean = false;

  @query("canvas") private canvas!: HTMLCanvasElement;
  @query("audio") private audioElement!: HTMLAudioElement;

  private webrtc: WebRTCManager | null = null;
  private animationFrame: number | null = null;
  private watchInterval: any = null;

  static get styles() {
    return [
      sharedStyles,
      css`
        .controls {
          display: flex;
          align-items: center;
          justify-content: center; /* Center the main button */
          gap: 16px;
          margin-bottom: 16px;
        }

        .action-button {
          width: 140px; /* Wider button for text */
          height: 50px;
          border-radius: 25px;
          border: none;
          font-size: 16px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .action-button.start {
          background: #2196f3;
          color: white;
        }

        .action-button.start:hover {
          background: #1976d2;
          box-shadow: 0 4px 8px rgba(33, 150, 243, 0.3);
        }

        .action-button.stop {
          background: #f44336;
          color: white;
          animation: pulse-red 2s infinite;
        }

        .action-button.stop:hover {
          background: #d32f2f;
          box-shadow: 0 4px 8px rgba(244, 67, 54, 0.3);
        }

        @keyframes pulse-red {
          0% {
            box-shadow: 0 0 0 0 rgba(244, 67, 54, 0.4);
          }
          70% {
            box-shadow: 0 0 0 10px rgba(244, 67, 54, 0);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(244, 67, 54, 0);
          }
        }

        .stream-list {
          width: 100%;
          max-height: 150px;
          overflow-y: auto;
          background: rgba(0, 0, 0, 0.02);
          border-radius: 4px;
          margin-top: 16px;
          border-top: 1px solid var(--divider-color);
          padding-top: 8px;
        }

        .stream-item {
          padding: 8px 12px;
          cursor: pointer;
          border-bottom: 1px solid var(--divider-color);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .stream-item:hover {
          background: rgba(0, 0, 0, 0.05);
        }

        .stream-item.active {
          background: rgba(var(--primary-color-rgb, 33, 150, 243), 0.1);
          color: var(--card-primary-color);
          font-weight: 500;
        }

        .visualization {
          width: 100%;
          height: 80px;
          background: rgba(0, 0, 0, 0.05);
          border-radius: 8px;
          overflow: hidden;
          margin-bottom: 16px;
        }

        .connection-indicator {
          display: inline-block;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          margin-right: 6px;
        }

        .connection-indicator.connected {
          background: #4caf50;
        }
        .connection-indicator.connecting {
          background: #ff9800;
          animation: blink 1s infinite;
        }
        .connection-indicator.disconnected {
          background: #f44336;
        }

        @keyframes blink {
          50% {
            opacity: 0.5;
          }
        }

        .latency-indicator {
          display: inline-block;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: bold;
          margin-left: 8px;
        }

        .latency-low {
          background: #4caf50;
          color: white;
        }
        .latency-medium {
          background: #ff9800;
          color: white;
        }
        .latency-high {
          background: #f44336;
          color: white;
        }
      `,
    ];
  }

  public static async getConfigElement() {
    return document.createElement("voice-receiving-card-editor");
  }

  public static getStubConfig(): VoiceReceivingCardConfig {
    return {
      type: "custom:voice-receiving-card",
      title: "Voice Receiver",
      auto_play: true,
    };
  }

  public setConfig(config: VoiceReceivingCardConfig): void {
    if (!config) throw new Error("Invalid configuration");
    this.config = config;

    if (this.webrtc) {
      this.webrtc.updateConfig({
        serverUrl: this.config.server_url,
      });
    }
  }

  public getCardSize(): number {
    return 4;
  }

  async connectedCallback() {
    super.connectedCallback();
    
    let serverUrl = this.config?.server_url;
    
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

    this.webrtc = new WebRTCManager({
      serverUrl: serverUrl,
    });

    this.webrtc.addEventListener("state-changed", (e: any) => {
      this.status = e.detail.state;
      if (e.detail.error) {
        this.errorMessage = e.detail.error;
        // If error occurs, stop watching/playing to reset UI
        if (this.status === "error") {
          this.isWatching = false;
          this.isActive = false;
        }
      } else {
        this.errorMessage = "";
      }

      if (this.status === "connected") {
        // If we are in watch mode, request streams
        if (this.isWatching) {
          // We might want to send a request here if the manager supports it directly,
          // or rely on the interval
        }
      }
      this.requestUpdate();
    });

    this.webrtc.addEventListener("streams-changed", (e: any) => {
      this.availableStreams = e.detail.streams || [];
      
      // Auto Listen Logic:
      if (this.isWatching && this.availableStreams.length > 0) {
        const latestStream = this.availableStreams[this.availableStreams.length - 1];
        
        // Only connect if we aren't already selected this stream
        if (this.selectedStream !== latestStream) {
            this.selectStream(latestStream);
        }
      }
    });

    this.webrtc.addEventListener("stream-added", (e: any) => {
      if (!this.availableStreams.includes(e.detail.streamId)) {
        this.availableStreams = [...this.availableStreams, e.detail.streamId];
      }

      // Aggressive Auto-Connect
      if (this.isWatching) {
        // Switch to new stream even if playing
        if (this.isActive) {
          this.stopReceiving();
          // Small delay to ensure clean state transition if needed
          setTimeout(() => this.selectStream(e.detail.streamId), 200);
        } else {
          this.selectStream(e.detail.streamId);
        }
      }
    });

    this.webrtc.addEventListener("stream-removed", (e: any) => {
      this.availableStreams = this.availableStreams.filter((id) => id !== e.detail.streamId);
      if (this.selectedStream === e.detail.streamId) {
        this.selectedStream = null;
        this.stopReceiving();
        // If watching, we stay in watch mode and will pick up next available or wait
        // The stopReceiving will keeping us connected if isWatching is true
        if (this.isWatching) {
        }
      }
    });

    this.webrtc.addEventListener("track", (e: any) => {
      if (this.audioElement && e.detail.stream) {
        const stream = e.detail.stream;

        // Set the stream directly - it's already a MediaStream
        this.audioElement.srcObject = stream;

        // Attempt to play
        this.audioElement
          .play()
          .then(() => {
            this.isActive = true;
            this.startVisualization();
          })
          .catch((error) => {
            console.error("[VoiceReceiver] ❌ Audio playback failed:", error);
            // Try to enable audio on user interaction
            if (error.name === "NotAllowedError") {
              console.warn("[VoiceReceiver] Autoplay blocked. User interaction required.");
              this.errorMessage = "Click anywhere to enable audio";
            }
          });
      } else {
        console.error("[VoiceReceiver] Track event missing audio element or stream");
      }
    });

    this.webrtc.addEventListener("audio-data", (e: any) => {
      if (this.status !== "connected") {
        this.status = "connected";
        this.errorMessage = "";
        this.requestUpdate();
      }
      if (e.detail.timestamp) {
        this.latency = Date.now() - e.detail.timestamp * 1000;
      }
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stopAll();
    this.webrtc?.stop();
  }

  private selectStream(streamId: string) {
    // Prevent re-connecting if we are already connected/connecting to this stream
    if (this.selectedStream === streamId && (this.isActive || this.status === 'connecting')) return;

    this.selectedStream = streamId;
    this.webrtc?.startReceiving(streamId);
  }

    private stopReceiving() {
      if (this.isWatching) {
          // If watching, stop stream but keep connection open for updates
          this.webrtc?.stopStream();
      } else {
          // If not watching, full stop
          this.webrtc?.stop();
      }
      
      this.stopVisualization();
      this.isActive = false;
      // We keep selectedStream if watching to avoid "flicker" re-selection logic
      // or maybe we should clear it? 
      // If we clear it, `streams-changed` will re-select it immediately.
      // If we don't clear it, `streams-changed` sees we have it selected.
      
      // For manual stop, we set isWatching=false, so streams-changed won't select.
      // For stream switching, we call stopReceiving then selectStream(newID).
      
      if (!this.isWatching) {
          this.selectedStream = null;
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

      ctx.fillStyle = "rgba(240, 240, 240, 0.3)"; // Slight transparency for trail effect? No, opaque.
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      const barWidth = (this.canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * this.canvas.height;
        ctx.fillStyle = `hsl(${(i / bufferLength) * 360}, 100%, 50%)`;
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

  // Start Auto Listen Mode
  private async startAutoListen() {
    this.isWatching = true;
    this.errorMessage = "";

    // Always ensure we have a clean WebSocket connection
    try {
      // If not connected, start receiving (which connects WebSocket)
      if (this.status !== "connected") {
        await this.webrtc?.startReceiving();
      } else {
      }
    } catch (e: any) {
      console.error("[AutoListen] Connection failed:", e);
      this.errorMessage = e.message || "Connection failed";
      this.isWatching = false;
      this.requestUpdate();
      return;
    }

    // Poll for available streams every 5 seconds
    if (this.watchInterval) clearInterval(this.watchInterval);
    this.watchInterval = setInterval(() => {
      if (this.isWatching && this.webrtc) {
        this.webrtc.getStreams();
      }
    }, CONSTANTS.TIMERS.STREAM_CHECK_INTERVAL);

    // Request streams immediately (critical for detecting existing streams)
    this.webrtc?.getStreams();

    // Request again after a short delay to ensure we catch existing streams
    setTimeout(() => {
      if (this.isWatching && this.webrtc) {
        this.webrtc.getStreams();
      }
    }, 500);
  }

  // Stop Everything
  private stopAll() {
    this.isWatching = false;
    this.selectedStream = null;
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }
    this.stopReceiving();
  }

  private manualSelectStream(streamId: string) {
    this.isWatching = false; // Stop auto-switching
    this.selectStream(streamId);
  }

  private getLatencyClass() {
    if (this.latency < CONSTANTS.LATENCY.LOW) return "latency-low";
    if (this.latency < CONSTANTS.LATENCY.MEDIUM) return "latency-medium";
    return "latency-high";
  }

  private getStatusText() {
    if (this.isActive) return `Playing: ${this.selectedStream ? this.selectedStream.substring(0, 8) : "Unknown"}`;
    if (this.isWatching) return "Watching for streams...";
    return this.status;
  }

  protected render() {
    if (!this.config) return html``;

    return html`
      <ha-card>
        <div class="header">
          <div class="title">${this.config.title || this.config.name || "Voice Receive"}</div>
          <div class="status-badge ${this.status}">${this.status}</div>
        </div>

        <div class="content">
          <div class="controls">
            ${this.isActive || this.isWatching
              ? html`<button class="action-button stop" @click=${this.stopAll}><span>⏹</span> Stop Listening</button>`
              : html`<button class="action-button start" @click=${this.startAutoListen}><span>👂</span> Auto Listen</button>`}
          </div>

          <div class="status">
            <div>
              <span class="connection-indicator ${this.status}" id="connectionIndicator"></span>
              <span>${this.getStatusText()}</span>
            </div>
            ${this.isActive
              ? html`
                  <div style="margin-top: 4px;">
                    <span class="latency-indicator ${this.getLatencyClass()}">Latency: ${this.latency}ms</span>
                  </div>
                `
              : ""}
          </div>

          <div class="visualization">
            <canvas width="300" height="80"></canvas>
          </div>

          <div class="stream-list">
            <h3 style="margin: 0 0 8px 0; font-size: 14px; padding: 0 12px;">Available Streams (${this.availableStreams.length})</h3>
            ${this.availableStreams.length > 0
              ? this.availableStreams.map(
                  (streamId) => html`
                    <div class="stream-item ${this.selectedStream === streamId ? "active" : ""}" @click=${() => this.manualSelectStream(streamId)}>
                      <span>Stream: ${streamId.substring(0, 8)}...</span>
                      ${this.selectedStream === streamId ? html`<span>🔊 Playing</span>` : ""}
                    </div>
                  `
                )
              : html`<div style="padding: 12px; font-size: 12px; color: #666;">No streams detected</div>`}
          </div>

          <audio autoplay style="display: none"></audio>
          ${this.errorMessage ? html`<div class="error-message">${this.errorMessage}</div>` : ""}
        </div>
      </ha-card>
    `;
  }
}

// Register
(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "voice-receiving-card",
  name: "Voice Receiving Card",
  description: "Receive voice audio via WebRTC",
  preview: true,
  editor: "voice-receiving-card-editor",
  version: "1.2.0", // Fixed URL parsing - preserves path and port
});
