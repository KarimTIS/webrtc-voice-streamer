#!/bin/bash
set -euo pipefail

export PYTHONUNBUFFERED=1

echo "════════════════════════════════════════"
echo "      WebRTC Voice Add-on Starting      "
echo "════════════════════════════════════════"

# ── Step 0: Install Frontend Cards ──
if [ -d "/config" ]; then
	echo "[INFO] Installing frontend cards to /config/www/voice_streaming_backend..."
	mkdir -p /config/www/voice_streaming_backend/dist
	cp -rf /app/frontend/dist/* /config/www/voice_streaming_backend/dist/ || echo "[WARN] Failed to copy frontend files"
else
	echo "[WARN] /config directory not found. skipping frontend install."
fi

# ── Step 0.5: Register Frontend Resource ──
export LOG_LEVEL=$(jq -r '.log_level // "info"' /data/options.json)
export AUDIO_PORT=$(jq -r '.audio_port // "8081"' /data/options.json)
export HA_ADDRESS=$(jq -r '.ha_address // "http://homeassistant:8123"' /data/options.json)

# ── Step 1: Start the server ──
echo "[SERVER] Starting HTTP on port 8099 (behind Ingress)"

export PORT=8099

exec python3 /app/webrtc_server_relay.py
