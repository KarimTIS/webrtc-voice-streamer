import { LitElement, html, css, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { HomeAssistant, VoiceReceivingCardConfig } from "./types";

const SCHEMA = [
  { name: "title", selector: { text: {} } },
  { name: "server_url", selector: { text: {} } },
  { name: "auto_play", selector: { boolean: {} } },
];

@customElement("voice-receiving-card-editor")
export class VoiceReceivingCardEditor extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private _config!: VoiceReceivingCardConfig;

  public setConfig(config: VoiceReceivingCardConfig): void {
    this._config = config;
  }

  private _computeLabel = (schema: any): string => {
    switch (schema.name) {
      case "title": return "Title";
      case "server_url": return "Server URL (optional)";
      case "auto_play": return "Auto Play";
      default: return schema.name;
    }
  };

  private _computeHelper = (schema: any): string => {
    switch (schema.name) {
      case "server_url": return "Defaults to localhost:8080/ws";
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
