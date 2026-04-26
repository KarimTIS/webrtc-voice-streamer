# Setup Guide - WebRTC Voice Streaming Backend

## Installation Paths

Choose one of the following installation methods:

### Path A: Home Assistant Add-on (Recommended)

**Prerequisites:**

- Home Assistant OS or Supervised installation
- Access to Add-on Store
- SSL certificate (optional - auto-generated if missing)

**Steps:**

1. **Add Repository to Home Assistant**

   ```
   Settings → Add-ons → Add-on Store → ⋮ (menu) → Repositories
   URL: https://github.com/KarimTIS/webrtc-voice-streamer
   Click "Add"
   ```

2. **Install Add-on**

   ```
   Add-on Store → Search "Voice Streaming Backend"
   Click "Install"
   Wait for installation to complete
   ```

3. **Configure Add-on**

   ```yaml
   # Configuration tab
   log_level: info # trace|debug|info|warning|error
   audio_port: 8081 # Port for MP3 streaming
   ```

4. **Start Add-on**

   ```
   Click "Start"
   Wait for "✅ Server successfully started" in logs
   ```

5. **Install Frontend Cards**

   ```
   The add-on automatically:
   - Copies frontend files to /config/www/voice_streaming_backend/
   - Registers Lovelace resource via Supervisor API

   Verify: Settings → Dashboards → Resources
   Look for: /local/voice_streaming_backend/dist/voice-streaming-card-dashboard.js
   ```

6. **Add Cards to Dashboard**
   ```
   Edit Dashboard → ⋮ → Add Card
   Search: "Voice Sending" or "Voice Receiving"
   Configure card (see Configuration section below)
   ```

### Path B: Docker (Development)

**Prerequisites:**

- Docker installed
- Port 8443 and 8081 available
- SSL certificates (optional)

**Steps:**

```bash
# 1. Clone repository
git clone https://github.com/KarimTIS/webrtc-voice-streamer.git
cd webrtc-voice-streaming

# 2. Build Docker image
docker build -t webrtc-voice-streaming .

# 3. Run container
docker run -d \
  --name webrtc-backend \
  --network host \
  -v $(pwd)/config:/config:rw \
  -v $(pwd)/ssl:/ssl:rw \
  -e LOG_LEVEL=debug \
  -e AUDIO_PORT=8081 \
  webrtc-voice-streaming

# 4. Check logs
docker logs -f webrtc-backend

# 5. Access server
# HTTPS: https://<your-ip>:8443
# MP3 Stream: http://<your-ip>:8081/stream/latest.mp3
```

### Path C: Local Development (Python + Node)

**Prerequisites:**

- Python 3.10+
- Node.js 20+
- Git

**Steps:**

```bash
# 1. Clone repository
git clone https://github.com/KarimTIS/webrtc-voice-streamer.git
cd webrtc-voice-streaming

# 2. Build frontend
cd frontend
npm install
npm run build
cd ..

# 3. Setup Python environment
python3 -m venv venv
source venv/bin/activate  # Linux/Mac
# or
.\venv\Scripts\Activate   # Windows

# 4. Install dependencies
pip install -r requirements.txt

# 5. Start server
# Without SSL (development)
python webrtc_server_relay.py

# With SSL (production-like)
export SSL_CERT_FILE=/path/to/cert.pem
export SSL_KEY_FILE=/path/to/key.pem
python webrtc_server_relay.py

# 6. Access server
# HTTP: http://localhost:8080
# HTTPS: https://localhost:8443 (if SSL configured)
```

## SSL Configuration

### Option 1: Automatic (Recommended)

The add-on automatically handles SSL through a **cascade strategy**:

1. **Home Assistant Certs**: Uses existing `/ssl/fullchain.pem` and `/ssl/privkey.pem`
2. **Ingress Mode**: If behind HA Ingress, no SSL needed (HA handles it)
3. **Self-Signed**: Generates local CA and server certificate

**For self-signed mode:**

```
1. Start add-on
2. Visit https://<IP>:8443 (accept certificate warning)
3. Download CA certificate from https://<IP>:8443/ca.crt
4. Install CA on your device (see below)
5. Refresh page - certificate warning should be gone
```

### Option 2: Manual SSL

**Using Let's Encrypt certificates:**

```bash
# Copy certificates to Home Assistant SSL directory
cp /etc/letsencrypt/live/your-domain/fullchain.pem /ssl/fullchain.pem
cp /etc/letsencrypt/live/your-domain/privkey.pem /ssl/privkey.pem

# Restart add-on
```

**Using custom certificates:**

```bash
# Place certificates in /ssl directory
cp your-cert.pem /ssl/fullchain.pem
cp your-key.pem /ssl/privkey.pem

# Restart add-on
```

### CA Certificate Installation

**iPhone/iPad:**

```
1. Download ha-webrtc-ca.crt from https://<IP>:8443/ca.crt
2. Open downloaded file
3. Settings → General → Profile Downloaded → Install
4. Settings → General → About → Certificate Trust Settings
5. Enable "HA WebRTC Local CA"
```

**Android:**

```
1. Download ha-webrtc-ca.crt
2. Open downloaded file
3. Name it "HA WebRTC"
4. Enter device PIN/pattern
5. Certificate installed
```

**Windows:**

```
1. Download ha-webrtc-ca.crt
2. Double-click certificate
3. Install Certificate → Local Machine
4. Place in "Trusted Root Certification Authorities"
5. Complete wizard
```

**Mac:**

```
1. Download ha-webrtc-ca.crt
2. Double-click to open in Keychain Access
3. Add to "System" keychain
4. Double-click certificate in keychain
5. Expand "Trust" section
6. Set "When using this certificate" to "Always Trust"
```

**Linux:**

```bash
sudo cp ha-webrtc-ca.crt /usr/local/share/ca-certificates/
sudo update-ca-certificates
```

## Configuration

### Add-on Configuration

```yaml
# config.yaml (Add-on configuration)
log_level: info # Verbosity: trace, debug, info, warning, error
audio_port: 8081 # Port for MP3 streaming server
```

### Card Configuration

**Voice Sending Card:**

```yaml
type: custom:voice-sending-card
title: "Microphone"
name: "Front Door Mic" # Alternative title
server_url: "homeassistant.local:8443" # Optional, auto-discovers
auto_start: false # Start sending on card load
noise_suppression: true # Enable noise suppression
echo_cancellation: true # Enable echo cancellation
auto_gain_control: true # Enable automatic gain control
target_media_player: media_player.living_room_speaker # Optional
stream_url: "http://homeassistant.local:8081/stream/latest.mp3" # Optional
```

**Voice Receiving Card:**

```yaml
type: custom:voice-receiving-card
title: "Speaker"
name: "Living Room Speaker" # Alternative title
server_url: "homeassistant.local:8443" # Optional, auto-discovers
auto_play: true # Auto-play when stream available
```

### Advanced Configuration

**Multiple Streams:**

```yaml
# Multiple sending cards can coexist
- type: custom:voice-sending-card
  title: "Front Door Mic"

- type: custom:voice-sending-card
  title: "Backyard Mic"

# Multiple receiving cards can select different streams
- type: custom:voice-receiving-card
  title: "Kitchen Speaker"

- type: custom:voice-receiving-card
  title: "Bedroom Speaker"
```

## Verification

### 1. Check Server Status

```bash
# Health endpoint
curl -k https://<IP>:8443/health

# Expected response:
{
  "status": "healthy",
  "webrtc_available": true,
  "audio_server_running": true,
  "active_streams": 0,
  "connected_clients": 0,
  "uptime_seconds": 123
}
```

### 2. Check Metrics

```bash
# Metrics endpoint
curl -k https://<IP>:8443/metrics

# Expected response:
{
  "uptime_seconds": 123,
  "active_connections": 0,
  "active_streams": 0,
  "total_audio_bytes": 0,
  "webrtc_available": true
}
```

### 3. Check MP3 Stream

```bash
# MP3 stream status
curl http://<IP>:8081/stream/status

# Expected response:
{"active_streams": []}
```

### 4. Check Server State

```bash
# Frontend discovery file
cat /config/www/voice_streaming_backend/server_state.json

# Expected content:
{
  "active_port": 8443,
  "ssl": true,
  "started_at": 1234567890.123
}
```

### 5. Test WebRTC Connection

**Browser Console Test:**

```javascript
// Open browser console (F12)
// Create WebRTC manager
const manager = new WebRTCManager({ serverUrl: "<IP>:8443" });

// Listen for state changes
manager.addEventListener("state-changed", (e) => {
  console.log("State:", e.detail.state);
});

// Try to start sending
manager.startSending().catch(console.error);
```

## Troubleshooting

### Server Won't Start

**Symptom:** Logs show "Address in use" or "Port busy"

**Solution:**

```
1. Server automatically hunts for available port
2. Check logs for actual port: "✅ Server successfully started on https://0.0.0.0:8444"
3. Update card configuration with correct server_url
4. Or stop conflicting service
```

**Symptom:** "SSL certificate not found"

**Solution:**

```
1. Server falls back to self-signed mode
2. Visit https://<IP>:8443 and accept certificate warning
3. Download CA from https://<IP>:8443/ca.crt
4. Install CA on device
```

### Frontend Can't Connect

**Symptom:** Card shows "disconnected" or "connecting..."

**Solution:**

```
1. Check server_state.json: cat /config/www/voice_streaming_backend/server_state.json
2. Verify server_url in card config matches active_port
3. Check browser console for WebSocket errors
4. Ensure firewall allows port 8443
```

**Symptom:** "WebSocket connection failed"

**Solution:**

```
1. Verify server is running: curl -k https://<IP>:8443/health
2. Check SSL certificate is valid
3. Try different browser (Safari has stricter WebRTC policies)
4. Ensure LAN access (WebRTC won't work over internet without TURN)
```

### No Audio

**Symptom:** Card shows "connected" but no audio plays

**Solution:**

```
1. Browser requires user interaction - click anywhere on page
2. Check browser autoplay policy: chrome://settings/content/sound
3. Verify target_media_player is correct entity
4. Check stream_url is accessible: curl http://<IP>:8081/stream/latest.mp3
```

**Symptom:** Microphone not working

**Solution:**

```
1. Browser requires HTTPS for microphone access
2. Check SSL certificate is valid
3. Grant microphone permission in browser
4. Verify noise_suppression/echo_cancellation settings
```

### Certificate Issues

**Symptom:** Browser shows "Your connection is not private"

**Solution:**

```
1. Download CA from https://<IP>:8443/ca.crt
2. Install CA on device (see CA Installation section)
3. Refresh page
4. If still showing warning, clear browser cache
```

**Symptom:** "Certificate has expired"

**Solution:**

```
1. Server certificates valid for 825 days
2. CA certificate valid for 10 years
3. Restart add-on to regenerate certificates
4. Or manually delete /data/ssl/* and restart
```

## Next Steps

After successful installation:

1. **Add cards to dashboard** - See Configuration section
2. **Test voice sending** - Click microphone icon, speak
3. **Test voice receiving** - Click "Auto Listen", wait for stream
4. **Configure media players** - Set target_media_player for speaker output
5. **Set up automations** - Trigger cards based on events (doorbell, etc.)

**Advanced Topics:**

- Read [02-ARCHITECTURE.md](./02-ARCHITECTURE.md) for system internals
- Read [03-DECISION-LOG.md](./03-DECISION-LOG.md) for design rationale
- Read [04-GOTCHAS.md](./04-GOTCHAS.md) for known issues
