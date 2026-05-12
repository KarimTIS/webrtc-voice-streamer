export interface LovelaceCardConfig {
  index?: number;
  view_index?: number;
  view_layout?: any;
  type: string;
  [key: string]: any;
}

export interface VoiceStreamingCardConfig extends LovelaceCardConfig {
  type: string;
  name?: string;
  title?: string;
  server_url?: string;
  stream_url?: string;
  auto_start?: boolean;
  noise_suppression?: boolean;
  echo_cancellation?: boolean;
  auto_gain_control?: boolean;
  target_media_player?: string;
}

export interface VoiceReceivingCardConfig extends LovelaceCardConfig {
  type: string;
  name?: string;
  title?: string;
  server_url?: string;
  auto_play?: boolean;
  volume_boost?: number;
}

export interface HomeAssistant {
  auth: any;
  conn: any;
  states: any;
  callService: (domain: string, service: string, serviceData?: object) => Promise<void>;
  callWS: (msg: any) => Promise<any>;
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
