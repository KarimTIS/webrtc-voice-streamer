# Architecture Documentation - WebRTC Voice Streaming Backend

## System Overview

This system implements a **signaling server** architecture for WebRTC-based real-time audio communication. Unlike traditional media servers that relay all audio traffic, this system facilitates **peer-to-peer media paths** while maintaining centralized control over session management.

### Architectural Pattern: Event-Driven Signaling

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Client Layer                                │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐      │
│  │ Voice Sending   │  │ Voice Receiving │  │ Home Assistant  │      │
│  │ Card (Sender)   │  │ Card (Receiver) │  │ Media Player    │      │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘      │
│           │                    │                    │               │
│           │ WebSocket (WSS)    │ HTTP (MP3)         │ HTTP (MP3)    │
│           │ WebRTC (UDP)       │                    │               │
└───────────┼────────────────────┼────────────────────┼───────────────┘
            │                    │                    │
            ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Signaling Layer                                │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              VoiceStreamingServer                             │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │  WebSocket Handler (/ws)                                │  │  │
│  │  │  - Connection lifecycle management                      │  │  │
│  │  │  - Message routing (offer/answer/ICE)                   │  │  │
│  │  │  - Stream broadcast events                              │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │  WebRTC Peer Connection Manager                         │  │  │
│  │  │  - RTCPeerConnection per client                         │  │  │
│  │  │  - SDP offer/answer exchange                            │  │  │
│  │  │  - ICE candidate handling (LAN-only)                    │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │  MediaRelay Distribution                                │  │  │
│  │  │  - Single producer, multiple consumers                  │  │  │
│  │  │  - Track subscription management                        │  │  │
│  │  │  - Visualization data extraction                        │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                               │                                     │
│                               ▼                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              AudioStreamServer (Port 8081)                    │  │
│  │  - MP3 encoding via PyAV                                      │  │
│  │  - HTTP chunked streaming                                     │  │
│  │  - Legacy client support                                      │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Architecture

### 1. VoiceStreamingServer (`webrtc_server_relay.py`)

**Responsibility:** Central signaling hub for WebRTC session establishment

**Key Classes:**

```python
class VoiceStreamingServer:
    connections: Dict[str, dict]      # connection_id → {ws, pc, role, stream_id}
    active_streams: Dict[str, Dict]   # stream_id → {track, receivers[], sender_id}
    relay: MediaRelay                  # aiortc media distribution
    audio_server: AudioStreamServer    # MP3 streaming component
```

**State Machine:**

```
┌─────────────┐
│   Idle      │
└──────┬──────┘
       │ WebSocket connection received
       ▼
┌─────────────┐
│ Connected   │ ←────────────────────────┐
└──────┬──────┘                          │
       │ Message: start_sending          │ WebSocket error
       ▼                                 │
┌─────────────┐                          │
│  Sender     │──────────────────────────┘
└──────┬──────┘
       │ Track received
       ▼
┌─────────────┐
│  Streaming  │ ←────────────────────┐
└──────┬──────┘                      │
       │ Message: start_receiving    │ Track ended
       ▼                             │
┌─────────────┐                      │
│  Relaying   │──────────────────────┘
└──────┬──────┘
       │ All receivers disconnected
       ▼
┌─────────────┐
│  Active     │ (waiting for receivers)
└─────────────┘
```

**Message Protocol:**

```typescript
// Client → Server
{ type: "start_sending" }
{ type: "start_receiving", stream_id: "stream_xxx" }
{ type: "webrtc_offer", offer: { sdp: "...", type: "offer" } }
{ type: "webrtc_answer", answer: { sdp: "...", type: "answer" } }
{ type: "get_available_streams" }
{ type: "stop_stream" }

// Server → Client
{ type: "sender_ready", connection_id: "uuid" }
{ type: "webrtc_offer", offer: { sdp: "...", type: "offer" } }
{ type: "webrtc_answer", answer: { sdp: "...", type: "answer" } }
{ type: "available_streams", streams: ["stream_xxx", ...] }
{ type: "stream_available", stream_id: "stream_xxx" }
{ type: "stream_ended", stream_id: "stream_xxx" }
{ type: "error", message: "..." }
```

**Note:** ICE candidates are bundled within SDP exchange (aiortc default behavior), not sent as separate messages.

### 2. AudioStreamServer (`audio_stream_server.py`)

**Responsibility:** Provide HTTP-based MP3 streaming for non-WebRTC clients

**Architecture:**

```
┌──────────────────┐
│ MediaRelay Track │
└────────┬─────────┘
         │ av.AudioFrame (48kHz, stereo)
         ▼
┌──────────────────┐
│  AudioResampler  │  → 44.1kHz, stereo, s16p
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  MP3 Encoder     │  → 128kbps
│  (PyAV/FFmpeg)   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ HTTP Chunked     │  → Client (VLC, media_player)
│ Transfer         │
└──────────────────┘
```

**Key Design Decisions:**

- **Standalone Server**: Runs on separate port (8081) to avoid blocking WebRTC signaling
- **Latest Stream**: `/stream/latest.mp3` automatically serves the most recently created stream
- **HTML Fallback**: Returns waiting page with auto-refresh if no stream active
- **Resampling**: Converts WebRTC's 48kHz to standard MP3 44.1kHz

### 3. WebRTCManager (`frontend/src/webrtc-manager.ts`)

**Responsibility:** Client-side WebRTC state machine and signaling

**State Machine:**

```
┌─────────────┐
│disconnected │
└──────┬──────┘
       │ start_sending() or start_receiving()
       ▼
┌─────────────┐
│ connecting  │ ←──────────────┐
└──────┬──────┘                │
       │ WebSocket open        │ ICE failed
       ▼                       │
┌─────────────┐                │
│  connected  │────────────────┘
└──────┬──────┘
       │ stop() or error
       ▼
┌─────────────┐
│    error    │
└─────────────┘
```

**Key Features:**

- **Automatic Reconnection**: Exponential backoff (1s → 30s max)
- **LAN-Only ICE**: Empty `iceServers` array forces direct connections
- **Track Subscription**: Uses MediaRelay pattern for efficient fan-out
- **Visualization**: Extracts audio data for real-time spectrum display

### 5. SSL Setup (`ssl-setup.sh`)

**Responsibility:** Autonomous HTTPS certificate management

**Cascade Strategy:**

```
┌─────────────────────────────────┐
│ Priority 1: HA Certificates     │
│ Check: /ssl/fullchain.pem       │
│       /ssl/privkey.pem          │
│ Valid: ≥ 1 day                  │
└──────────────┬──────────────────┘
               │ Not found or expiring
               ▼
┌─────────────────────────────────┐
│ Priority 2: Ingress Mode        │
│ Check: SUPERVISOR_TOKEN         │
│       Ingress API = true        │
│ Result: HTTP only (HA proxies)  │
└──────────────┬──────────────────┘
               │ Not active
               ▼
┌─────────────────────────────────┐
│ Priority 3: Self-Signed CA      │
│ Generate: CA (10 years)         │
│           Server cert (825 days)│
│ SANs: localhost, hostname,      │
│       homeassistant, LAN_IP     │
└─────────────────────────────────┘
```

**Certificate Sharing:**

```bash
# Copies to shared SSL directory for NGINX/Home Assistant
cp /data/ssl/server.crt /ssl/ha-webrtc.crt
cp /data/ssl/server.key /ssl/ha-webrtc.key
cp /data/ssl/ca.crt /ssl/ha-webrtc-ca.crt
```

## Data Flow Analysis

### Flow 1: Sender Connection

```
1. User clicks "Start Sending"
   └─→ WebRTCManager.startSending()

2. Request microphone access
   └─→ navigator.mediaDevices.getUserMedia({ audio: {...} })
   └─→ Returns MediaStream with audio track

3. Create RTCPeerConnection
   └─→ iceServers: [] (LAN-only)
   └─→ bundlePolicy: "max-bundle"
   └─→ sdpSemantics: "unified-plan"

4. Add track to peer connection
   └─→ pc.addTrack(track, stream)

5. Send WebSocket message
   └─→ { type: "start_sending" }

6. Server creates sender RTCPeerConnection
   └─→ pc.on("track") handler registered

7. Client creates and sends offer
   └─→ pc.createOffer()
   └─→ pc.setLocalDescription(offer)
   └─→ { type: "webrtc_offer", offer: {...} }

8. Server sets remote description
   └─→ pc.setRemoteDescription(offer)
   └─→ pc.createAnswer()
   └─→ pc.setLocalDescription(answer)
   └─→ { type: "webrtc_answer", answer: {...} }

9. Client sets remote answer
   └─→ pc.setRemoteDescription(answer)
   └─→ ICE connection established
   └─→ Media flows: Client → Server

10. Server subscribes to track
    └─→ viz_track = relay.subscribe(track)
    └─→ process_visualization() task started

11. Server broadcasts availability
    └─→ broadcast_stream_available(stream_id)
```

### Flow 2: Receiver Connection

```
1. User clicks "Auto Listen"
   └─→ WebRTCManager.startReceiving(stream_id)

2. Connect WebSocket
   └─→ ws = new WebSocket("wss://server:8443/ws")

3. Send receive request
   └─→ { type: "start_receiving", stream_id: "stream_xxx" }

4. Server finds stream
   └─→ stream_info = active_streams[stream_id]
   └─→ source_track = stream_info.track

5. Server creates receiver RTCPeerConnection
   └─→ relayed_track = relay.subscribe(source_track)
   └─→ pc.addTrack(relayed_track)

6. Server creates and sends offer
   └─→ pc.createOffer()
   └─→ pc.setLocalDescription(offer)
   └─→ { type: "webrtc_offer", offer: {...} }

7. Client sets remote offer
   └─→ pc.setRemoteDescription(offer)
   └─→ pc.createAnswer()
   └─→ pc.setLocalDescription(answer)
   └─→ { type: "webrtc_answer", answer: {...} }

8. Server sets remote answer
   └─→ pc.setRemoteDescription(answer)
   └─→ ICE connection established
   └─→ Media flows: Server → Client

9. Client receives track
   └─→ pc.ontrack event
   └─→ audioElement.srcObject = event.streams[0]
   └─→ audioElement.play()
```

### Flow 3: MP3 Streaming

```
1. Client requests MP3 stream
   └─→ GET /stream/latest.mp3

2. Server finds latest stream
   └─→ stream_id = list(active_streams.keys())[-1]

3. Subscribe to track
   └─→ track = relay.subscribe(source_track)

4. Initialize MP3 encoder
   └─→ codec = av.Codec("mp3", "w")
   └─→ codec_context.bit_rate = 128000
   └─→ codec_context.sample_rate = 44100
   └─→ resampler = AudioResampler(format="s16p", layout="stereo", rate=44100)

5. Streaming loop
   └─→ frame = await track.recv()
   └─→ resampled = resampler.resample(frame)
   └─→ packets = codec_context.encode(resampled)
   └─→ response.write(bytes(packet))
   └─→ (repeat until track ends)
```

## Concurrency Model

### Async/Await Pattern

All I/O operations use Python's `asyncio`:

```python
async def websocket_handler(self, request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    async for msg in ws:
        # Non-blocking message processing
        await self.handle_message(connection_id, msg)
```

### Background Tasks

```python
# Cleanup stale streams (runs every 5 minutes)
self.cleanup_task = asyncio.create_task(self.cleanup_stale_streams())

async def cleanup_stale_streams(self):
    while True:
        await asyncio.sleep(300)
        # Cleanup logic...
```

### MediaRelay Concurrency

The `MediaRelay` from `aiortc` handles concurrent subscriptions:

```python
# Single producer
track = sender_pc.get_track()

# Multiple consumers (thread-safe)
receiver1_track = relay.subscribe(track)
receiver2_track = relay.subscribe(track)
mp3_track = relay.subscribe(track)
```

## Network Architecture

### Port Allocation

| Port | Protocol   | Purpose                 | Configurable       |
| ---- | ---------- | ----------------------- | ------------------ |
| 8443 | HTTPS/WSS  | WebRTC signaling        | Auto-hunts if busy |
| 8099 | HTTP       | Ingress mode (HA proxy) | Fixed              |
| 8081 | HTTP/MP3   | Audio streaming         | Yes (AUDIO_PORT)   |
| 8080 | HTTP/HTTPS | CA download (fallback)  | Auto-hunts if busy |

### Smart Port Hunting

```python
base_port = int(os.environ.get("PORT", 8080))
for i in range(10):
    try:
        test_port = base_port + i
        await site.start()
        active_port = test_port
        break
    except OSError as e:
        if "Address in use" in str(e):
            continue  # Try next port
```

### Host Networking

**Why Host Mode?**

```yaml
host_network: true # config.yaml
```

**Benefits:**

1. **Direct IP Access**: ICE candidates use real LAN IPs
2. **No NAT Traversal**: Avoids hairpinning through Docker bridge
3. **Lower Latency**: No network address translation overhead
4. **WebRTC Performance**: Better P2P connection establishment

**Trade-offs:**

1. **Port Conflicts**: Must handle busy ports gracefully
2. **Security**: Less isolation from host network
3. **Platform Dependency**: Requires Home Assistant OS/Supervised

## Security Considerations

### Authentication

**Current State:** No authentication required for WebSocket connections

**Rationale:**

- LAN-only deployment (no internet exposure)
- Home Assistant dashboard provides access control
- WebRTC requires user interaction (browser security)

**Recommendations for Production:**

```python
# Add token-based authentication
async def websocket_handler(self, request):
    token = request.headers.get("Authorization")
    if not self.verify_token(token):
        await ws.close()
        return
```

### Authorization

**Stream Access:** Any connected client can receive any stream

**Mitigation:**

- LAN isolation (physical network security)
- Future: Add stream-specific tokens

### SSL/TLS

**Certificate Validation:**

```python
ssl_context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
ssl_context.load_cert_chain(cert_file, key_file)
```

**Self-Signed CA:**

- Generated on first run
- Valid for 825 days (server cert)
- Must be manually installed on clients

## Performance Characteristics

### Latency Breakdown

| Component                 | Latency   | Notes                |
| ------------------------- | --------- | -------------------- |
| Microphone → Browser      | 10-20ms   | Browser audio buffer |
| Browser → Server (WebRTC) | 50-100ms  | Network + codec      |
| Server → Browser (WebRTC) | 50-100ms  | Network + codec      |
| Server → MP3 Stream       | 200-500ms | Encoding buffer      |
| Browser → Speaker         | 20-50ms   | Audio buffer         |

**Total Round-Trip:** <500ms (typical LAN)

### Memory Usage

| Component            | Memory | Notes                      |
| -------------------- | ------ | -------------------------- |
| VoiceStreamingServer | ~50MB  | Base + dependencies        |
| Per Connection       | ~5MB   | RTCPeerConnection overhead |
| MediaRelay           | ~10MB  | Track buffering            |
| AudioStreamServer    | ~20MB  | MP3 encoding buffers       |

**Typical Load (1 sender, 5 receivers):** ~100MB

### CPU Usage

| Operation               | CPU    | Notes              |
| ----------------------- | ------ | ------------------ |
| Idle                    | <1%    | No active streams  |
| WebRTC Signaling        | <5%    | SDP processing     |
| MediaRelay (per stream) | 5-10%  | Track distribution |
| MP3 Encoding            | 10-20% | PyAV/FFmpeg        |

## Scalability

### Current Limits

- **Active Streams:** Limited by server CPU (encoding/relaying)
- **Receivers per Stream:** Unlimited (MediaRelay fan-out)
- **WebSocket Connections:** ~1000 (aiohttp limit)
- **WebRTC Peer Connections:** ~100 (memory bound)

### Bottlenecks

1. **MediaRelay Subscription**: Single-threaded track processing
2. **MP3 Encoding**: CPU-intensive (PyAV/FFmpeg)
3. **WebSocket Broadcast**: O(n) message sending

### Future Optimizations

```python
# 1. Batch WebSocket broadcasts
async def broadcast_stream_available(self, stream_id):
    message = json.dumps({"type": "stream_available", "stream_id": stream_id})
    # Send to all connections in parallel
    await asyncio.gather(*[
        conn["ws"].send_str(message)
        for conn in self.connections.values()
    ])

# 2. Use process pool for MP3 encoding
loop = asyncio.get_event_loop()
encoded = await loop.run_in_executor(
    executor,
    encode_mp3,
    frame
)

# 3. Add connection pooling for receivers
```

## Testing Strategy

### Unit Tests (Missing)

**Recommended Coverage:**

```python
# tests/test_webrtc_server.py
def test_sender_connection():
    server = VoiceStreamingServer()
    # Test WebSocket handshake
    # Test SDP offer/answer
    # Test track reception

def test_receiver_connection():
    # Test stream selection
    # Test MediaRelay subscription
    # Test audio playback

def test_mp3_streaming():
    # Test encoder initialization
    # Test chunked transfer
    # Test stream switching
```

### Integration Tests

**Current:** `tests/verify_autossl.sh`

**Coverage:**

- SSL certificate cascade
- HA cert detection
- Ingress mode detection
- Self-signed CA generation

**Run:**

```bash
cd tests
bash verify_autossl.sh
```

### Manual Testing

**Checklist:**

1. Start sender card → verify audio visualization
2. Start receiver card → verify audio playback
3. Stop sender → verify receiver shows "stream ended"
4. Request MP3 stream → verify VLC plays audio
5. Check server_state.json → verify port detection
