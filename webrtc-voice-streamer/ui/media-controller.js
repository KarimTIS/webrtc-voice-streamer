import { logError } from './logger.js';

export class MediaController {
  constructor(hassApi) {
    this.hassApi = hassApi;
    this.isMediaPlaying = false;
    this.mediaPlayerPollInterval = null;
    this.activeStreams = [];

    this.mediaPlayerSelect = document.getElementById("media-player-select");
    this.btnMediaToggle = document.getElementById("btn-media-toggle");
    this.mediaIconPlay = document.getElementById("media-icon-play");
    this.mediaIconStop = document.getElementById("media-icon-stop");
    this.mediaIconLoading = document.getElementById("media-icon-loading");
    this.mediaToggleText = document.getElementById("media-toggle-text");
    this.streamUrlInput = document.getElementById("stream-url");

    this.btnMediaToggle.onclick = () => this.toggleMedia();
  }

  setActiveStreams(streams) {
    this.activeStreams = streams;
  }

  async populateMediaPlayers() {
    console.log("Fetching media players...");
    try {
      const players = await this.hassApi.fetchMediaPlayers();
      console.log(`Found ${players.length} media players.`);
      
      this.mediaPlayerSelect.innerHTML = '<option value="">-- Select a Media Player --</option>';
      players.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.entity_id;
        opt.textContent = `${p.name} (${p.state})`;
        this.mediaPlayerSelect.appendChild(opt);
      });
    } catch (e) {
      logError("Failed to load media players", e);
      this.mediaPlayerSelect.innerHTML = '<option value="">Failed to load</option>';
    }
  }

  async toggleMedia() {
    const entity_id = this.mediaPlayerSelect.value;
    const media_content_id = this.streamUrlInput.value;

    if (!entity_id) {
      logError("Validation failed: Please select a media player first.");
      return;
    }
    if (!this.isMediaPlaying && !media_content_id) {
      logError("Validation failed: Please enter a stream URL.");
      return;
    }

    if (this.isMediaPlaying) {
      console.log(`Stop requested. Target player: ${entity_id}`);
      await this.stopMedia(entity_id);
    } else {
      if (this.activeStreams.length === 0) {
        logError("No active microphone streams available. Please start the microphone first.");
        return;
      }
      console.log(`Play requested. Target player: ${entity_id}, URL: ${media_content_id}`);
      await this.playMedia(entity_id, media_content_id);
    }
  }

  async playMedia(entity_id, media_content_id) {
    this.setMediaLoadingState(true, "play");
    try {
      await this.hassApi.playMedia(entity_id, media_content_id);
      this.isMediaPlaying = true;
      this.startMediaPlayerPolling(entity_id);
    } catch (e) {
      logError("Error playing media.", e);
    }
    this.setMediaLoadingState(false, "play");
    this.updateMediaButtonState();
  }

  async stopMedia(entity_id) {
    this.setMediaLoadingState(true, "stop");
    this.stopMediaPlayerPolling();
    try {
      await this.hassApi.stopMedia(entity_id);
      this.isMediaPlaying = false;
    } catch (e) {
      logError("Error stopping media.", e);
    }
    this.setMediaLoadingState(false, "stop");
    this.updateMediaButtonState();
  }

  stopMediaPlayerPolling() {
    if (this.mediaPlayerPollInterval) {
      clearInterval(this.mediaPlayerPollInterval);
      this.mediaPlayerPollInterval = null;
    }
  }

  startMediaPlayerPolling(entity_id) {
    this.stopMediaPlayerPolling();
    let attempts = 0;
    
    this.mediaPlayerPollInterval = setInterval(async () => {
      attempts++;
      const state = await this.hassApi.getMediaPlayerState(entity_id);
      
      if (state && ["idle", "paused", "standby", "off"].includes(state)) {
        if (attempts > 5) {
          console.log(`Media player ${entity_id} state is ${state}. Reverting UI to Play.`);
          this.isMediaPlaying = false;
          this.updateMediaButtonState();
          this.stopMediaPlayerPolling();
        }
      } else if (state === "playing") {
        // Once playing, ensure a quick revert if it stops later
        attempts = 6;
      }
    }, 2000);
  }

  setMediaLoadingState(isLoading, action) {
    this.btnMediaToggle.disabled = isLoading;
    if (isLoading) {
      this.btnMediaToggle.classList.add("opacity-75", "cursor-not-allowed");
      this.mediaIconPlay.classList.add("hidden");
      this.mediaIconStop.classList.add("hidden");
      this.mediaIconLoading.classList.remove("hidden");
      this.mediaToggleText.textContent = action === "play" ? "Starting..." : "Stopping...";
    } else {
      this.btnMediaToggle.classList.remove("opacity-75", "cursor-not-allowed");
      this.mediaIconLoading.classList.add("hidden");
    }
  }

  updateMediaButtonState() {
    if (this.isMediaPlaying) {
      this.btnMediaToggle.className =
        "w-full bg-red-500 hover:bg-red-600 text-white border-none py-3 px-6 rounded-xl font-medium cursor-pointer transition-all duration-200 flex items-center justify-center gap-2 shadow-lg shadow-red-500/20 active:scale-[0.98]";
      this.mediaIconPlay.classList.add("hidden");
      this.mediaIconStop.classList.remove("hidden");
      this.mediaToggleText.textContent = "Stop Media";
    } else {
      this.btnMediaToggle.className =
        "w-full bg-sky-500 hover:bg-sky-600 text-white border-none py-3 px-6 rounded-xl font-medium cursor-pointer transition-all duration-200 flex items-center justify-center gap-2 shadow-lg shadow-sky-500/20 active:scale-[0.98]";
      this.mediaIconStop.classList.add("hidden");
      this.mediaIconPlay.classList.remove("hidden");
      this.mediaToggleText.textContent = "Play Stream";
    }
  }
}
