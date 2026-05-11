import { LitElement, html, css, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { HomeAssistant, VoiceStreamingCardConfig } from "./types";

const SCHEMA = [
  { name: "title", selector: { text: {} } },
  { name: "server_url", selector: { text: {} } },
  { name: "stream_url", selector: { text: {} } },
  { name: "target_media_player", selector: { entity: { domain: "media_player" } } },
  { name: "auto_start", selector: { boolean: {} } },
  { name: "noise_suppression", selector: { boolean: {} } },
  { name: "echo_cancellation", selector: { boolean: {} } },
  { name: "auto_gain_control", selector: { boolean: {} } },
];

@customElement("voice-sending-card-editor")
export class VoiceSendingCardEditor extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private _config!: VoiceStreamingCardConfig;

  public setConfig(config: VoiceStreamingCardConfig): void {
    this._config = config;
  }

  private _computeLabel = (schema: any): string => {
    switch (schema.name) {
      case "title": return "Title";
      case "server_url": return "Server URL (optional)";
      case "stream_url": return "Audio Stream URL (optional)";
      case "target_media_player": return "Target Media Player (optional)";
      case "auto_start": return "Auto Start";
      case "noise_suppression": return "Noise Suppression";
      case "echo_cancellation": return "Echo Cancellation";
      case "auto_gain_control": return "Auto Gain Control";
      default: return schema.name;
    }
  };

  private _computeHelper = (schema: any): string => {
    switch (schema.name) {
      case "server_url": return "WebRTC Server (WS) e.g. localhost:8080/ws";
      case "stream_url": return "Audio playback URL e.g. http://192.168.1.10:8081/stream/latest.mp3";
      case "target_media_player": return "Entity ID e.g. media_player.living_room_speaker";
      default: return "";
    }
  };

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config || !this.hass) {
      return;
    }
    if (this._config === ev.detail.value) {
      return;
    }
    this._config = ev.detail.value;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
  }

  protected render(): TemplateResult {
    if (!this.hass || !this._config) {
      return html``;
    }

    return html`
      <ha-form
        .hass=${this.hass}
        .data=${this._config}
        .schema=${SCHEMA}
        .computeLabel=${this._computeLabel}
        .computeHelper=${this._computeHelper}
        @value-changed=${this._valueChanged}
      ></ha-form>
    `;
  }

  static styles = css`
    ha-form {
      display: block;
      margin-bottom: 16px;
    }
  `;
}
