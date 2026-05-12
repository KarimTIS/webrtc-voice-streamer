export type WebRTCState = "disconnected" | "connecting" | "connected" | "error";

export interface WebRTCOptions {
  serverUrl?: string;
  noiseSuppression?: boolean;
  echoCancellation?: boolean;
  autoGainControl?: boolean;
}

export class WebRTCManager extends EventTarget {
  private websocket: WebSocket | null = null;
  private peerConnection: RTCPeerConnection | null = null;
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;

  private state: WebRTCState = "disconnected";
  private config: WebRTCOptions;
  private reconnectTimer: number | null = null;
  private retryCount = 0;
  private readonly maxRetries = 5;

  constructor(config: WebRTCOptions = {}) {
    super();
    this.config = {
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
    };
    this.updateConfig(config);
  }

  public updateConfig(config: WebRTCOptions) {
    this.config = {
      ...this.config,
      ...(config.serverUrl !== undefined && { serverUrl: config.serverUrl }),
      ...(config.noiseSuppression !== undefined && { noiseSuppression: config.noiseSuppression }),
      ...(config.echoCancellation !== undefined && { echoCancellation: config.echoCancellation }),
      ...(config.autoGainControl !== undefined && { autoGainControl: config.autoGainControl }),
    };
  }

  public getState(): WebRTCState {
    return this.state;
  }

  public getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  private setState(newState: WebRTCState, error?: string) {
    this.state = newState;
    this.dispatchEvent(
      new CustomEvent("state-changed", {
        detail: { state: newState, error },
      }),
    );
  }

  public async startSending(): Promise<void> {
    try {
      this.setState("connecting");
      await this.connectWebSocket();

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: this.config.echoCancellation,
          noiseSuppression: this.config.noiseSuppression,
          autoGainControl: this.config.autoGainControl,
          sampleRate: 16000,
          channelCount: 1,
        },
      });

      this.setupAudioVisualization(this.mediaStream);
      this.setupPeerConnection();

      this.mediaStream.getAudioTracks().forEach((track) => {
        if (this.peerConnection) {
          this.peerConnection.addTrack(track, this.mediaStream!);
        }
      });

      this.sendWebSocketMessage({ type: "start_sending" });
      this.setState("connected");
    } catch (error: any) {
      console.error("Failed to start sending:", error);
      this.cleanup();
      this.setState("error", error.message);
    }
  }

  public async startReceiving(streamId?: string): Promise<void> {
    try {
      this.setState("connecting");
      await this.connectWebSocket();

      // Clean up existing peer connection if any
      if (this.peerConnection) {
        this.peerConnection.close();
        this.peerConnection = null;
      }

      this.setupPeerConnection();

      this.sendWebSocketMessage({
        type: "start_receiving",
        stream_id: streamId,
      });

      // Don't set connected yet - wait for WebRTC negotiation
    } catch (error: any) {
      console.error("[WebRTC] Failed to start receiving:", error);
      this.cleanup();
      this.setState("error", error.message);
    }
  }

  public getStreams(): void {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.sendWebSocketMessage({ type: "get_available_streams" });
    }
  }

  public stopStream() {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.sendWebSocketMessage({ type: "stop_stream" });
      this.setState("connected");
    } else {
      this.setState("disconnected");
    }
    this.cleanupMedia();
  }

  public stop() {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.sendWebSocketMessage({ type: "stop_stream" });
    }
    this.cleanup();
    this.setState("disconnected");
  }

  private setupPeerConnection() {
    this.peerConnection = new RTCPeerConnection({
      iceServers: [], // LAN only
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      sdpSemantics: "unified-plan",
    } as any);

    this.peerConnection.onicecandidate = (event) => {
      // ICE candidates are handled via SDP exchange (aiortc default behavior)
      // No need to send separate candidate messages
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection?.iceConnectionState;

      if (state === "failed") {
        this.setState("error", "ICE Connection Failed");
      } else if (state === "connected" || state === "completed") {
      }
    };

    this.peerConnection.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        this.setupAudioVisualization(event.streams[0]);
        this.setState("connected"); // Now we're truly connected
        this.dispatchEvent(
          new CustomEvent("track", {
            detail: { stream: event.streams[0] },
          }),
        );
      }
    };
  }

  private async connectWebSocket(): Promise<void> {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) return;

    return new Promise((resolve, reject) => {
      let wsUrl: string;

      if (this.config.serverUrl) {
        try {
          let urlStr = this.config.serverUrl;
          let wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";

          if (urlStr.startsWith("/")) {
            // Relative path, use current host
            wsUrl = `${wsProtocol}//${window.location.host}${urlStr}`;
          } else {
            // Check if protocol is specified
            if (!urlStr.match(/^(https?|wss?):\/\//)) {
              const pageProto = window.location.protocol === "https:" ? "https:" : "http:";
              urlStr = `${pageProto}//${urlStr}`;
            }

            const url = new URL(urlStr);
            if (url.protocol === "https:" || url.protocol === "wss:") {
              wsProtocol = "wss:";
            } else {
              wsProtocol = "ws:";
            }

            const host = url.hostname;
            const port = url.port;
            const path = url.pathname || "/ws";

            if (port) {
              wsUrl = `${wsProtocol}//${host}:${port}${path}`;
            } else {
              wsUrl = `${wsProtocol}//${host}${path}`;
            }
          }
        } catch (e: any) {
          const msg = `Invalid Server URL: ${this.config.serverUrl}`;
          console.error(msg, e);
          this.setState("error", msg);
          reject(new Error(msg));
          return;
        }
      } else {
        // Default: connect to WebRTC server relative to current origin
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        wsUrl = `${protocol}//${window.location.host}/ws`;
      }

      this.websocket = new WebSocket(wsUrl);

      this.websocket.onopen = () => {
        this.retryCount = 0;
        resolve();
      };

      this.websocket.onerror = (error) => {
        console.error("WebSocket error:", error);
        reject(error);
      };

      this.websocket.onclose = () => {
        if (this.state === "connected" || this.state === "connecting") {
          this.handleReconnect();
        } else {
          this.setState("disconnected");
        }
      };

      this.websocket.onmessage = async (event) => {
        await this.handleMessage(JSON.parse(event.data));
      };
    });
  }

  private async handleMessage(data: any) {
    switch (data.type) {
      case "sender_ready":
        if (this.peerConnection) {
          const offer = await this.peerConnection.createOffer({
            offerToReceiveAudio: false,
            offerToReceiveVideo: false,
          });
          await this.peerConnection.setLocalDescription(offer);
          this.sendWebSocketMessage({
            type: "webrtc_offer",
            offer: {
              sdp: this.peerConnection.localDescription?.sdp,
              type: this.peerConnection.localDescription?.type,
            },
          });
        }
        break;

      case "webrtc_answer":
        if (this.peerConnection) {
          try {
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
          } catch (e: any) {
            console.error("[WebRTC] Failed to set remote answer:", e);
            this.setState("error", `Failed to set remote answer: ${e.message}`);
          }
        }
        break;

      case "webrtc_offer": // For receiving
        if (this.peerConnection) {
          try {
            const state = this.peerConnection.signalingState;

            // Only process offer if in stable or have-local-offer state
            if (state === "stable" || state === "have-local-offer") {
              await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));

              const answer = await this.peerConnection.createAnswer();
              await this.peerConnection.setLocalDescription(answer);

              this.sendWebSocketMessage({
                type: "webrtc_answer",
                answer: {
                  sdp: this.peerConnection.localDescription?.sdp,
                  type: this.peerConnection.localDescription?.type,
                },
              });
            } else {
              console.warn(`[WebRTC] Cannot process offer in state: ${state}`);
            }
          } catch (e: any) {
            console.error("[WebRTC] Failed to handle offer:", e);
            this.setState("error", `Failed to handle offer: ${e.message}`);
          }
        }
        break;

      case "available_streams":
        this.dispatchEvent(new CustomEvent("streams-changed", { detail: { streams: data.streams } }));
        break;

      case "stream_available":
        this.dispatchEvent(new CustomEvent("stream-added", { detail: { streamId: data.stream_id } }));
        break;

      case "stream_ended":
        this.dispatchEvent(new CustomEvent("stream-removed", { detail: { streamId: data.stream_id } }));
        break;

      case "audio_data":
        this.dispatchEvent(new CustomEvent("audio-data", { detail: data }));
        break;
    }
  }

  private sendWebSocketMessage(msg: any) {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify(msg));
    }
  }

  private setupAudioVisualization(stream: MediaStream) {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    if (this.analyser) return; // Already setup

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;

    const source = this.audioContext.createMediaStreamSource(stream);
    source.connect(this.analyser);
  }

  private handleReconnect() {
    if (this.retryCount < this.maxRetries) {
      this.retryCount++;
      const delay = Math.min(1000 * Math.pow(1.5, this.retryCount), 30000);

      this.setState("connecting", `Reconnecting in ${Math.round(delay / 1000)}s...`);

      this.reconnectTimer = window.setTimeout(() => {
        this.connectWebSocket().catch(() => this.handleReconnect());
      }, delay);
    } else {
      this.setState("error", "Connection lost. Max retries reached.");
    }
  }

  private cleanupMedia() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
      this.analyser = null;
    }
  }

  private cleanup() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.cleanupMedia();

    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
  }
}
