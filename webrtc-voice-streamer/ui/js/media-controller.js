import { logError } from "./logger.js";

export class MediaController {
  constructor(hassApi) {
    this.hassApi = hassApi;
    this.isMediaPlaying = false;
    this.mediaPlayerPollInterval = null;
    this.activeStreams = [];
    this.currentPollingEntity = null;
    this.isActionLoading = false;
    this.loadingActionType = null;
    this.loadingAttempts = 0;

    this.mediaPlayerSelect = document.getElementById("media-player-select");
    this.btnMediaToggle = document.getElementById("btn-media-toggle");
    this.mediaIconPlay = document.getElementById("media-icon-play");
    this.mediaIconStop = document.getElementById("media-icon-stop");
    this.mediaIconLoading = document.getElementById("media-icon-loading");
    this.mediaToggleText = document.getElementById("media-toggle-text");
    this.streamUrlInput = document.getElementById("stream-url");

    this.btnMediaToggle.onclick = () => this.toggleMedia();
    this.mediaPlayerSelect.addEventListener("change", () =>
      this.onMediaPlayerChanged(),
    );
  }

  onMediaPlayerChanged() {
    const entity_id = this.mediaPlayerSelect.value;
    if (entity_id) {
      this.startContinuousPolling(entity_id);
    } else {
      this.stopMediaPlayerPolling();
      this.isMediaPlaying = false;
      this.updateMediaButtonState();
    }
  }

  setActiveStreams(streams) {
    this.activeStreams = streams;
  }

  async populateMediaPlayers() {
    console.log("Fetching media players...");
    try {
      const players = await this.hassApi.fetchMediaPlayers();
      console.log(`Found ${players.length} media players.`);

      this.mediaPlayerSelect.innerHTML =
        '<option value="">-- Select a Media Player --</option>';
      players.forEach((p) => {
        if (p.state !== "unavailable" && p.state !== "off") {
          const opt = document.createElement("option");
          opt.value = p.entity_id;
          opt.textContent = `${p.name}`;
          this.mediaPlayerSelect.appendChild(opt);
        }
      });
    } catch (e) {
      logError("Failed to load media players", e);
      this.mediaPlayerSelect.innerHTML =
        '<option value="">Failed to load</option>';
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
        logError(
          "No active microphone streams available. Please start the microphone first.",
        );
        return;
      }
      console.log(
        `Play requested. Target player: ${entity_id}, URL: ${media_content_id}`,
      );
      await this.playMedia(entity_id, media_content_id);
    }
  }

  async playMedia(entity_id, media_content_id) {
    this.isActionLoading = true;
    this.loadingActionType = "play";
    this.loadingAttempts = 0;
    this.setMediaLoadingState(true, "play");

    this.startContinuousPolling(entity_id);

    try {
      await this.hassApi.playMedia(entity_id, media_content_id);
    } catch (e) {
      logError("Error playing media.", e);
      this.isActionLoading = false;
      this.setMediaLoadingState(false, "play");
      this.updateMediaButtonState();
    }
  }

  async stopMedia(entity_id) {
    this.isActionLoading = true;
    this.loadingActionType = "stop";
    this.loadingAttempts = 0;
    this.setMediaLoadingState(true, "stop");

    this.startContinuousPolling(entity_id);

    try {
      await this.hassApi.stopMedia(entity_id);
    } catch (e) {
      logError("Error stopping media.", e);
      this.isActionLoading = false;
      this.setMediaLoadingState(false, "stop");
      this.updateMediaButtonState();
    }
  }

  stopMediaPlayerPolling() {
    if (this.mediaPlayerPollInterval) {
      clearInterval(this.mediaPlayerPollInterval);
      this.mediaPlayerPollInterval = null;
    }
    this.currentPollingEntity = null;
  }

  startContinuousPolling(entity_id) {
    if (
      this.currentPollingEntity === entity_id &&
      this.mediaPlayerPollInterval
    ) {
      return;
    }

    this.stopMediaPlayerPolling();
    this.currentPollingEntity = entity_id;

    this.mediaPlayerPollInterval = setInterval(async () => {
      const state = await this.hassApi.getMediaPlayerState(entity_id);
      this.handleMediaPlayerState(state);
    }, 500);
  }

  handleMediaPlayerState(state) {
    if (!state) return;

    const isPlayingState = state === "playing" || state === "buffering";

    if (this.isActionLoading && this.loadingActionType === "play") {
      this.loadingAttempts++;
      if (isPlayingState) {
        this.isActionLoading = false;
        this.isMediaPlaying = true;
        this.setMediaLoadingState(false, "play");
        this.updateMediaButtonState();
      } else if (this.loadingAttempts >= 6) {
        console.log(
          `Media player state is ${state} after 3 seconds. Reverting UI.`,
        );
        this.isActionLoading = false;
        this.isMediaPlaying = false;
        this.setMediaLoadingState(false, "play");
        this.updateMediaButtonState();
      }
    } else if (this.isActionLoading && this.loadingActionType === "stop") {
      this.loadingAttempts++;
      if (!isPlayingState) {
        this.isActionLoading = false;
        this.isMediaPlaying = false;
        this.setMediaLoadingState(false, "stop");
        this.updateMediaButtonState();
      } else if (this.loadingAttempts >= 6) {
        console.log(
          `Media player state is ${state} after 3 seconds. Reverting UI.`,
        );
        this.isActionLoading = false;
        this.isMediaPlaying = true;
        this.setMediaLoadingState(false, "stop");
        this.updateMediaButtonState();
      }
    } else if (!this.isActionLoading) {
      if (this.isMediaPlaying && !isPlayingState) {
        console.log(
          `Media player stopped playing (state: ${state}). Updating UI.`,
        );
        this.isMediaPlaying = false;
        this.updateMediaButtonState();
      } else if (!this.isMediaPlaying && isPlayingState) {
        console.log(
          `Media player started playing (state: ${state}). Updating UI.`,
        );
        this.isMediaPlaying = true;
        this.updateMediaButtonState();
      }
    }
  }

  setMediaLoadingState(isLoading, action) {
    this.btnMediaToggle.disabled = isLoading;
    if (isLoading) {
      this.btnMediaToggle.classList.add("opacity-75", "cursor-not-allowed");
      this.mediaIconPlay.classList.add("hidden");
      this.mediaIconStop.classList.add("hidden");
      this.mediaIconLoading.classList.remove("hidden");
      this.mediaToggleText.textContent =
        action === "play" ? "Starting..." : "Stopping...";
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
