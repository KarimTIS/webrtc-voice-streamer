import { initLogger } from "./logger.js";
import { HassApi } from "./hass-api.js";
import { AudioVisualizer } from "./visualizer.js";
import { SignalingClient } from "./websocket-client.js";
import { WebRTCManager } from "./webrtc-manager.js";
import { MediaController } from "./media-controller.js";

// DOM Elements
const wsStatus = document.getElementById("ws-status");
const visualizerCanvas = document.getElementById("visualizer");
const streamUrlInput = document.getElementById("stream-url");

// 1. Initialize Logger
initLogger("error-log-container", "error-logs", "clear-errors-btn");

// 2. Initialize APIs and Controllers
const hassApi = new HassApi();
const mediaController = new MediaController(hassApi);
const visualizer = new AudioVisualizer(visualizerCanvas);

// Default stream URL placeholder
streamUrlInput.value = `http://[IP_ADDRESS]:8081/stream/latest.mp3`;

// Fetch initial server config
hassApi.fetchServerIp().then((data) => {
  if (data && data.ip && data.ip !== "127.0.0.1") {
    const defaultHost = data.ip;
    const audioPort = data.audio_port || 8081;
    streamUrlInput.value = `http://${defaultHost}:${audioPort}/stream/latest.mp3`;
  }
});

// Wait for Hass and fetch media players
hassApi.waitForHassAndInitialize(() => {
  mediaController.populateMediaPlayers();
});

// 3. Setup Signaling Client
const signalingClient = new SignalingClient({
  onSenderReady: () => webrtcManager.handleSenderReady(),
  onAnswer: (answer) => webrtcManager.handleAnswer(answer),
  onStreamsUpdated: (streams) => mediaController.setActiveStreams(streams),
  onConnectionChange: (isConnected) => {
    if (isConnected) {
      wsStatus.textContent = "Connected";
      wsStatus.className =
        "px-3 py-1 rounded-full text-sm font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 transition-colors duration-300";
    } else {
      wsStatus.textContent = "Disconnected";
      wsStatus.className =
        "px-3 py-1 rounded-full text-sm font-medium bg-red-500/20 text-red-400 border border-red-500/30 transition-colors duration-300";
      webrtcManager.stopMic();
    }
  },
});

// 4. Setup WebRTC Manager
const webrtcManager = new WebRTCManager(visualizer, signalingClient);

// 5. Connect WebSocket
signalingClient.connect();
