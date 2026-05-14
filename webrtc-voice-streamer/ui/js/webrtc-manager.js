import { logError } from './logger.js';

export class WebRTCManager {
  constructor(visualizer, signalingClient) {
    this.visualizer = visualizer;
    this.signalingClient = signalingClient;

    this.peerConnection = null;
    this.mediaStream = null;

    this.btnMic = document.getElementById("btn-mic");
    this.micErrorMsg = document.getElementById("mic-error-msg");

    this.btnMic.onclick = () => this.toggleMic();
  }

  async toggleMic() {
    console.log("Microphone button clicked. Current state:", this.mediaStream ? "Active" : "Inactive");
    if (this.mediaStream) {
      this.stopMic();
    } else {
      await this.startMic();
    }
  }

  async startMic() {
    this.micErrorMsg.textContent = "";
    console.log("Requesting microphone access from browser...");
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
          channelCount: 1,
        },
      });
      console.log("Microphone access granted.", this.mediaStream);

      this.peerConnection = new RTCPeerConnection({ iceServers: [] });

      this.peerConnection.oniceconnectionstatechange = () => {
        console.log("ICE Connection State Change:", this.peerConnection.iceConnectionState);
        if (this.peerConnection && this.peerConnection.iceConnectionState === "failed") {
          logError("WebRTC ICE Connection failed.");
        }
      };

      this.mediaStream.getAudioTracks().forEach((track) => {
        console.log("Adding audio track to peer connection:", track.label);
        this.peerConnection.addTrack(track, this.mediaStream);
      });

      this.visualizer.start(this.mediaStream);
      this.signalingClient.sendStartSending();

      this.setMicButtonState(true);
    } catch (e) {
      logError("Failed to start microphone", e);
      this.micErrorMsg.textContent = "Error: " + e.message;
    }
  }

  stopMic() {
    console.log("Stopping microphone and cleaning up WebRTC resources...");
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => {
        console.log("Stopping track:", t.kind, t.label);
        t.stop();
      });
      this.mediaStream = null;
      console.log("Media stream stopped.");
    }
    
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
      console.log("Peer connection closed.");
    }

    this.signalingClient.sendStopStream();
    this.visualizer.stop();
    this.setMicButtonState(false);
  }

  async handleSenderReady() {
    if (this.peerConnection) {
      const offer = await this.peerConnection.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
      });
      await this.peerConnection.setLocalDescription(offer);
      
      this.signalingClient.sendOffer({
        sdp: this.peerConnection.localDescription.sdp,
        type: this.peerConnection.localDescription.type,
      });
    } else {
      console.warn("Peer connection not initialized when sender_ready received.");
    }
  }

  async handleAnswer(answer) {
    if (this.peerConnection) {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      console.log("Remote description set successfully. WebRTC connection established.");
    } else {
      console.warn("Peer connection not initialized when webrtc_answer received.");
    }
  }

  setMicButtonState(isStreaming) {
    if (isStreaming) {
      this.btnMic.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
        </svg>
        <span>Stop Microphone</span>
      `;
      this.btnMic.className =
        "w-full bg-red-500 hover:bg-red-600 text-white border-none py-3 px-6 rounded-xl text-lg font-medium cursor-pointer transition-all duration-200 flex items-center justify-center gap-2 shadow-lg shadow-red-500/20 active:scale-[0.98]";
    } else {
      this.btnMic.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
        <span>Start Microphone</span>
      `;
      this.btnMic.className =
        "w-full bg-sky-500 hover:bg-sky-600 text-white border-none py-3 px-6 rounded-xl text-lg font-medium cursor-pointer transition-all duration-200 flex items-center justify-center gap-2 shadow-lg shadow-sky-500/20 active:scale-[0.98]";
    }
  }
}
