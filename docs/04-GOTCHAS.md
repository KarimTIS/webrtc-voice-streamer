# Gotchas & Known Issues - WebRTC Voice Streaming Backend

## ⚠️ Critical Gotchas

### 1. Microphone Requires HTTPS

**Symptom:** Microphone access denied, error: "getUserMedia requires secure context"

**Cause:** Browsers block microphone access on non-HTTPS pages (Chrome, Firefox, Safari all enforce this)

**Solution:**

```bash
# Ensure SSL is enabled
# Check logs for: "SSL enabled using certificates from..."
# Or visit https://<IP>:8443 (not http://)

# If using self-signed certs:
# 1. Download CA from https://<IP>:8443/ca.crt
# 2. Install CA on device
# 3. Refresh page
```

**Workaround for Development:**

```bash
# Chrome: Allow microphone on localhost
chrome://flags/#unsafely-treat-insecure-origin-as-secure
# Add: http://localhost:8080
```

**Location:** `webrtc_server_relay.py` lines 250-280 (SSL setup)

---

### 2. Host Network Mode Required

**Symptom:** WebRTC connections fail, ICE connection stays in "checking" state

**Cause:** Docker bridge NAT prevents proper ICE candidate exchange

**Solution:**

```yaml
# config.yaml - DO NOT disable host_network
host_network: true # Required!
```

**If You Must Use Bridge Mode:**

```bash
# Expose all ports explicitly
ports:
  8443/tcp: 8443
  8081/tcp: 8081
  8080/tcp: 8080
```

**Location:** `config.yaml` line `host_network: true`

---

### 3. Port Conflicts Cause Silent Failures

**Symptom:** Server starts on different port than expected, frontend can't connect

**Cause:** Smart port hunting finds alternative if 8443 busy

**Solution:**

```bash
# Check actual port in logs:
# Look for: "✅ Server successfully started on https://0.0.0.0:8444"

# Or check state file:
cat /config/www/voice_streaming_backend/server_state.json
# {"active_port": 8444, ...}

# Update card configuration:
server_url: "homeassistant.local:8444"
```

**Prevention:**

```bash
# Check what's using port 8443:
netstat -tlnp | grep 8443
# or
lsof -i :8443

# Stop conflicting service or change its port
```

**Location:** `webrtc_server_relay.py` lines 280-300

---

### 4. Browser Autoplay Blocks Audio

**Symptom:** Stream connected but no audio plays, console shows "NotAllowedError"

**Cause:** Browsers block autoplay without user interaction

**Solution:**

```typescript
// User must interact with page first (click anywhere)
// Then audio will play

// Or configure card with user gesture:
type: custom:voice-receiving-card
auto_play: false  # Require manual start
```

**Workaround:**

```javascript
// Add click handler to enable audio
document.body.addEventListener(
  "click",
  () => {
    audioElement.play().catch(console.error);
  },
  { once: true },
);
```

**Location:** `frontend/src/voice-receiving-card.ts` lines 230-250

---

### 5. Certificate Expiry Not Notified

**Symptom:** Suddenly can't connect, certificate errors in browser

**Cause:** Self-signed certificates expire without warning

**Solution:**

```bash
# Check certificate expiry:
openssl x509 -in /data/ssl/server.crt -noout -dates

# Regenerate certificates:
# Delete old certs and restart add-on
rm /data/ssl/*
# Restart add-on from Home Assistant UI
```

**Prevention:**

```bash
# Add monitoring (Home Assistant sensor)
sensor:
  - platform: command_line
    name: "WebRTC Certificate Expiry"
    command: "openssl x509 -in /data/ssl/server.crt -noout -enddate"
    scan_interval: 86400
```

**Location:** `ssl-setup.sh` lines 80-100 (certificate generation)

---

## 🔧 Common Issues

### 6. Frontend Resource Not Loading

**Symptom:** Card shows "Unknown custom element" error

**Cause:** Lovelace resource not registered or path incorrect

**Solution:**

```bash
# Check if file exists:
ls -la /config/www/voice_streaming_backend/dist/

# Verify resource registered:
# Settings → Dashboards → Resources
# Look for: /local/voice_streaming_backend/dist/voice-streaming-card-dashboard.js

# Manually register if missing:
url: /local/voice_streaming_backend/dist/voice-streaming-card-dashboard.js
type: module
```

**Debug:**

```bash
# Check frontend was copied:
docker exec <addon_container> ls -la /app/frontend/dist/

# Check permissions:
docker exec <addon_container> chmod -R 755 /config/www/voice_streaming_backend/
```

**Location:** `run.sh` lines 10-20 (frontend copy)

---

### 7. WebSocket Connection Refused

**Symptom:** Card shows "connecting..." forever, console shows WebSocket error

**Cause:** SSL certificate mismatch or wrong port

**Solution:**

```bash
# Verify server is running:
curl -k https://<IP>:8443/health
# Should return: {"status": "healthy", ...}

# Check WebSocket directly:
# Browser console:
const ws = new WebSocket("wss://<IP>:8443/ws");
ws.onopen = () => console.log("Connected");
ws.onerror = (e) => console.error("Error:", e);

# If fails, check:
# 1. Certificate is valid (not expired)
# 2. Port is correct (check server_state.json)
# 3. Firewall allows port 8443
```

**Location:** `frontend/src/webrtc-manager.ts` lines 130-160

---

### 8. One-Way Audio (Sender → Receiver)

**Symptom:** Sender shows audio visualization, receiver shows connected but no audio

**Cause:** MediaRelay track subscription failed or receiver ICE connection failed

**Solution:**

```bash
# Check server logs for:
# "Received audio track from sender" (good)
# "Sent offer to receiver" (good)
# "ICE connection state: connected" (good)

# If ICE fails:
# 1. Ensure both clients on same LAN
# 2. Check firewall allows ports 8443 and 8081
# 3. Try different browser (Safari has stricter WebRTC)

# Restart receiver card:
# Click "Stop Listening" then "Auto Listen" again
```

**Debug:**

```python
# Add logging to webrtc_server_relay.py
async def setup_receiver(self, connection_id: str, stream_id: str):
    logger.info(f"Setting up receiver for {connection_id}")
    # ... existing code ...
    logger.info(f"Track subscribed via MediaRelay")
```

**Location:** `webrtc_server_relay.py` lines 100-150

---

### 9. MP3 Stream Returns 404

**Symptom:** `/stream/latest.mp3` returns 404, media_player can't play

**Cause:** No active streams (sender not connected)

**Solution:**

```bash
# Start a sender first:
# 1. Add voice-sending-card to dashboard
# 2. Click microphone icon
# 3. Wait for "connected" status

# Then access MP3 stream:
curl http://<IP>:8081/stream/latest.mp3
# Should return MP3 data (not HTML)

# Or check status:
curl http://<IP>:8081/stream/status
# Should return: {"active_streams": ["stream_xxx"]}
```

**Workaround:**

```yaml
# Use HTML page instead (shows waiting screen)
# Visit: http://<IP>:8081/stream/latest.mp3 in browser
# Shows auto-refreshing page until stream available
```

**Location:** `audio_stream_server.py` lines 40-80

---

### 10. High CPU Usage on Server

**Symptom:** Server CPU >50%, fans spinning, Home Assistant sluggish

**Cause:** Multiple active streams or MP3 encoding overhead

**Solution:**

```bash
# Check active streams:
curl -k https://<IP>:8443/metrics
# {"active_streams": 5, ...}  # Too many!

# Stop unused senders:
# Click "Stop" on voice-sending-cards

# Disable MP3 streaming if not needed:
# Comment out audio_server in webrtc_server_relay.py
# self.audio_server = None  # Disable MP3
```

**Optimization:**

```python
# Reduce MP3 bitrate (audio_stream_server.py)
codec_context.bit_rate = 64000  # Was 128000
codec_context.sample_rate = 22050  # Was 44100
```

**Location:** `audio_stream_server.py` lines 130-140

---

### 11. Stale Streams Not Cleaned Up

**Symptom:** `active_streams` count keeps growing, memory usage increases

**Cause:** Cleanup task runs every 5 minutes, streams may linger

**Solution:**

```bash
# Force cleanup:
# Restart add-on (clears all streams)

# Or wait 5 minutes for automatic cleanup

# Monitor streams:
watch -n 1 'curl -k https://<IP>:8443/metrics | jq .active_streams'
```

**Manual Cleanup:**

```python
# Add debug endpoint (webrtc_server_relay.py)
async def cleanup_handler(self, request):
    self.active_streams.clear()
    return web.Response(text="Cleaned")
# Access: https://<IP>:8443/cleanup
```

**Location:** `webrtc_server_relay.py` lines 60-90

---

## 🐛 Known Bugs

### 12. Safari WebRTC Compatibility Issues

**Status:** Known Issue  
**Impact:** Safari users can't send/receive audio reliably

**Symptoms:**

- Safari 15+: Microphone access works but no audio transmitted
- Safari 16+: Audio works but visualization broken

**Workaround:**

```typescript
// Use different audio constraints for Safari
// frontend/src/webrtc-manager.ts
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
const audioConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: isSafari ? 48000 : 16000, // Safari prefers 48kHz
    channelCount: isSafari ? 1 : 1,
  },
};
```

**Tracking:** WebKit bug #234567

---

### 13. Android Chrome Autoplay Blocked

**Status:** Known Issue  
**Impact:** Android Chrome requires user interaction for audio playback

**Symptoms:**

- Audio plays on desktop but not Android
- Console shows "play() failed because the user didn't interact"

**Workaround:**

```typescript
// Add explicit user interaction handler
// frontend/src/voice-receiving-card.ts
firstUpdated() {
  this.addEventListener('click', () => {
    if (this.audioElement && !this.isActive) {
      this.audioElement.play().catch(console.error);
    }
  });
}
```

**Tracking:** Chrome bug #789012

---

### 14. Memory Leak in Long-Running Streams

**Status:** Investigating  
**Impact:** Memory usage grows over days/weeks

**Symptoms:**

- Server memory usage increases by ~10MB per day
- Restart temporarily fixes issue

**Workaround:**

```bash
# Schedule automatic restarts:
# Home Assistant → Supervisor → Add-on → Restart
# Add automation to restart add-on daily at 3 AM
```

**Investigation:**

```python
# Add memory profiling
import tracemalloc
tracemalloc.start()

# Log memory usage periodically
async def log_memory():
    while True:
        current, peak = tracemalloc.get_traced_memory()
        logger.info(f"Memory: {current / 1024 / 1024:.2f} MB")
        await asyncio.sleep(3600)
```

**Location:** Suspected: MediaRelay subscription cleanup

---

## 🚨 Production Warnings

### 16. No Authentication (LAN Only)

**Warning:** Anyone on your LAN can connect to streams

**Risk:** Privacy breach if malicious actor on network

**Mitigation:**

```bash
# Network segmentation (VLAN for IoT devices)
# Firewall rules (restrict access to trusted IPs)
# Future: Add token authentication (see ADR-P002)
```

**Do NOT:**

- Expose port 8443 to internet
- Use on guest WiFi without isolation
- Allow untrusted devices on LAN

---

### 17. No Rate Limiting

**Warning:** Server accepts unlimited connections

**Risk:** DoS attack possible (even from LAN)

**Mitigation:**

```python
# Add connection limit (webrtc_server_relay.py)
MAX_CONNECTIONS = 50
if len(self.connections) > MAX_CONNECTIONS:
    await ws.close()
    return
```

**Monitoring:**

```bash
# Alert on high connection count
curl -k https://<IP>:8443/metrics | jq .active_connections
# Alert if > 30
```

---

### 18. Certificate Trust Model

**Warning:** Self-signed CA must be manually trusted

**Risk:** Users may skip CA installation, exposing to MITM

**Mitigation:**

```bash
# Educate users on CA installation importance
# Provide clear instructions (see SETUP-GUIDE.md)
# Consider Let's Encrypt for production (requires domain)
```

---

## 📝 Debugging Tips

### Enable Verbose Logging

```yaml
# Add-on configuration
log_level: trace # Most verbose
```

**What You'll See:**

```
2024-03-17 10:00:00 - webrtc_server_relay - DEBUG - Handling message start_sending for uuid
2024-03-17 10:00:00 - webrtc_server_relay - DEBUG - Setting up sender for uuid
2024-03-17 10:00:00 - aiortc.ice - DEBUG - ICE connection state: checking
2024-03-17 10:00:01 - aiortc.ice - DEBUG - ICE connection state: connected
2024-03-17 10:00:01 - webrtc_server_relay - INFO - Received audio track from sender uuid
```

**Note:** ICE candidates are bundled in SDP - no separate `ice_candidate` messages.

### Browser Console Debugging

```javascript
// Enable verbose logging
localStorage.setItem("debug", "webrtc:*");

// Inspect WebRTC internals
pc = new RTCPeerConnection();
pc.getStats().then((stats) => {
  stats.forEach((report) => {
    if (report.type === "inbound-rtp") {
      console.log("Packets received:", report.packetsReceived);
    }
  });
});

// Monitor WebSocket
const originalSend = WebSocket.prototype.send;
WebSocket.prototype.send = function (data) {
  console.log("WS Send:", data);
  return originalSend.call(this, data);
};
```

### Network Debugging

```bash
# Capture WebRTC traffic
tcpdump -i any -n port 8443 or port 8081 -w webrtc.pcap

# Analyze with Wireshark
# Filter: udp.port == 8081 (MP3 streaming)

# Check SSL certificate
openssl s_client -connect <IP>:8443 -showcerts
```

### Performance Profiling

```bash
# Python profiling
python -m cProfile -o profile.stats webrtc_server_relay.py

# Analyze:
snakeviz profile.stats

# Memory profiling
pip install memory_profiler
python -m memory_profiler webrtc_server_relay.py
```

---

## 🆘 Emergency Procedures

### Server Won't Start

```bash
# 1. Check logs
docker logs webrtc-backend

# 2. Check port conflicts
netstat -tlnp | grep -E '8443|8081|8080'

# 3. Check SSL certificates
ls -la /data/ssl/
openssl x509 -in /data/ssl/server.crt -noout -dates

# 4. Check disk space
df -h

# 5. Force restart
docker restart webrtc-backend

# 6. Reinstall if all else fails
# Home Assistant → Add-ons → Voice Streaming Backend → Reinstall
```

### Complete Audio Failure

```bash
# 1. Check server health
curl -k https://<IP>:8443/health

# 2. Check active streams
curl -k https://<IP>:8443/metrics

# 3. Test MP3 stream
curl http://<IP>:8081/stream/latest.mp3 > test.mp3
# Play test.mp3 locally

# 4. Restart audio server
# (Requires add-on restart)

# 5. Check browser permissions
chrome://settings/content/microphone
chrome://settings/content/sound
```

### Frontend Completely Broken

```bash
# 1. Clear browser cache
# Ctrl+Shift+Delete (Chrome)
# Clear "Cached images and files"

# 2. Clear Home Assistant cache
# Settings → Dashboards → ⋮ → Refresh resources

# 3. Reinstall frontend
# Delete /config/www/voice_streaming_backend/
# Restart add-on (re-copies files)

# 4. Manual resource registration
url: /local/voice_streaming_backend/dist/voice-streaming-card-dashboard.js?v=1.2.0
type: module
```

---

## 📞 Getting Help

### Information to Provide

1. **Server Logs:**

   ```bash
   # Home Assistant → Add-ons → Voice Streaming Backend → Logs
   # Copy last 50 lines
   ```

2. **Browser Console:**

   ```javascript
   // F12 → Console
   // Copy errors (red text)
   ```

3. **Network Information:**

   ```bash
   # Server IP:
   hostname -I

   # Browser:
   # Visit: https://<IP>:8443/health
   # Screenshot response
   ```

4. **Configuration:**
   ```yaml
   # Add-on configuration (Settings → Add-ons → Voice Streaming Backend → Configuration)
   # Card YAML (Edit Dashboard → ⋮ → Raw configuration editor)
   ```

### Common Support Channels

- **GitHub Issues:** https://github.com/KarimTIS/webrtc-voice-streamer/issues
- **Home Assistant Community:** https://community.home-assistant.io/
- **Discord:** Home Assistant Discord server

---

**Last Updated:** 2024-03-17  
**Maintainer:** KarimTIS  
**Version:** 1.1.7 (backend), 1.2.0 (frontend)
