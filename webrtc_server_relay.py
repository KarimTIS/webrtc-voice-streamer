import asyncio
import json
import logging
import os
import ssl
import uuid
from typing import Dict

from aiohttp import WSMsgType, web
from aiortc import RTCConfiguration, RTCPeerConnection, RTCSessionDescription
from aiortc.contrib.media import MediaRelay

from audio_stream_server import AudioStreamServer
from license_middleware import license_middleware

logger = logging.getLogger(__name__)


class VoiceStreamingServer:
    def __init__(self):
        self.connections: Dict[str, dict] = {}
        self.active_streams: Dict[str, Dict] = {}  # stream_id -> {track, receivers[]}
        self.total_audio_bytes = 0
        self.app = web.Application(middlewares=[license_middleware])
        self.relay = MediaRelay()
        self.audio_server = AudioStreamServer(self)
        self.setup_routes()

    def setup_routes(self):
        self.app.router.add_get("/health", self.health_check)
        self.app.router.add_get("/metrics", self.metrics_handler)
        self.app.router.add_get("/ws", self.websocket_handler)
        self.app.router.add_get("/", self.websocket_handler)
        self.start_time = asyncio.get_event_loop().time()
        self.cleanup_task = None

    async def metrics_handler(self, request):
        """Provide Prometheus-compatible or JSON metrics"""
        uptime = int(asyncio.get_event_loop().time() - self.start_time)
        return web.json_response(
            {
                "uptime_seconds": uptime,
                "active_connections": len(self.connections),
                "active_streams": len(self.active_streams),
                "total_audio_bytes": self.total_audio_bytes,
                "webrtc_available": True,
            }
        )

    async def health_check(self, request):
        uptime = int(asyncio.get_event_loop().time() - self.start_time)
        return web.json_response(
            {
                "status": "healthy",
                "webrtc_available": True,
                "audio_server_running": self.audio_server is not None,
                "active_streams": len(self.active_streams),
                "connected_clients": len(self.connections),
                "uptime_seconds": uptime,
            }
        )

    async def cleanup_stale_streams(self):
        """Periodically clean up streams with no active receivers"""
        while True:
            try:
                await asyncio.sleep(300)  # Run every 5 minutes
                stale_streams = []

                for stream_id, stream_info in self.active_streams.items():
                    # Check if the track is ended
                    track = stream_info.get("track")
                    if track and track.readyState == "ended":
                        stale_streams.append(stream_id)
                        continue

                    if not stream_info.get("receivers"):
                        # Check if stream has been inactive for more than 10 minutes
                        if not hasattr(stream_info, "last_activity"):
                            stream_info["last_activity"] = (
                                asyncio.get_event_loop().time()
                            )
                        elif (
                            asyncio.get_event_loop().time()
                            - stream_info["last_activity"]
                            > 600
                        ):
                            stale_streams.append(stream_id)

                for stream_id in stale_streams:
                    logger.info(f"Cleaning up stale stream: {stream_id}")
                    if stream_id in self.active_streams:
                        del self.active_streams[stream_id]

            except Exception as e:
                logger.error(f"Error in cleanup task: {e}")

    async def websocket_handler(self, request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)

        connection_id = str(uuid.uuid4())
        self.connections[connection_id] = {
            "ws": ws,
            "pc": None,
            "role": None,
            "stream_id": None,
        }

        try:
            # Notify the client of available streams immediately
            await self.send_available_streams(connection_id)

            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    try:
                        data = json.loads(msg.data)
                        await self.handle_message(connection_id, data)
                    except json.JSONDecodeError:
                        logger.error(f"Invalid JSON received from {connection_id}")
                    except Exception as e:
                        logger.error(
                            f"Error handling message from {connection_id}: {e}",
                            exc_info=True,
                        )
                elif msg.type == WSMsgType.ERROR:
                    logger.error(f"WebSocket error: {ws.exception()}")

        except Exception as e:
            logger.error(f"WebSocket connection error for {connection_id}: {e}")
        finally:
            await self.cleanup_connection(connection_id)

        return ws

    async def handle_message(self, connection_id: str, data: dict):
        message_type = data.get("type")
        connection = self.connections.get(connection_id)

        if not connection:
            return

        logger.debug(f"Handling message {message_type} for {connection_id}")

        if message_type == "start_sending":
            await self.setup_sender(connection_id)
        elif message_type == "start_receiving":
            await self.setup_receiver(connection_id, data.get("stream_id"))
        elif message_type == "webrtc_offer":
            await self.handle_webrtc_offer(connection_id, data)
        elif message_type == "webrtc_answer":
            await self.handle_webrtc_answer(connection_id, data)
        elif message_type == "get_available_streams":
            await self.send_available_streams(connection_id)
        elif message_type == "stop_stream":
            # Just stop media, keep WS open
            await self.stop_media(connection_id)

    async def stop_media(self, connection_id: str):
        connection = self.connections.get(connection_id)
        if connection and connection.get("pc"):
            logger.info(f"Stopping media for {connection_id}")
            await connection["pc"].close()
            connection["pc"] = None
            connection["stream_id"] = None
            # Do NOT remove from self.connections, keep WS open

    async def setup_sender(self, connection_id: str):
        """Set up a client as an audio sender"""
        logger.info(f"Setting up sender for connection {connection_id}")
        connection = self.connections[connection_id]
        connection["role"] = "sender"

        # Create RTCPeerConnection with LAN-only ICE configuration
        config = RTCConfiguration(iceServers=[])
        pc = RTCPeerConnection(configuration=config)
        connection["pc"] = pc

        @pc.on("track")
        async def on_track(track):
            if track.kind == "audio":
                logger.info(f"Received audio track from sender {connection_id}")

                # Store the audio stream
                stream_id = f"stream_{connection_id}"
                self.active_streams[stream_id] = {
                    "track": track,
                    "receivers": [],
                    "sender_id": connection_id,
                }
                connection["stream_id"] = stream_id

                logger.info(f"Stored stream {stream_id} for sender {connection_id}")

                # Broadcast availability to all clients
                await self.broadcast_stream_available(stream_id)

                # Start visualization task
                # Subscribe immediately to keep the track flowing
                viz_track = self.relay.subscribe(track)
                asyncio.create_task(self.process_visualization(stream_id, viz_track))

                @track.on("ended")
                async def on_ended():
                    logger.info(f"Audio track ended for {connection_id}")
                    if stream_id in self.active_streams:
                        del self.active_streams[stream_id]
                    await self.broadcast_stream_ended(stream_id)

        @pc.on("iceconnectionstatechange")
        async def on_iceconnectionstatechange():
            logger.info(
                f"ICE connection state for sender {connection_id}: {pc.iceConnectionState}"
            )
            if pc.iceConnectionState == "failed":
                await pc.close()

        # Send ready signal
        await connection["ws"].send_str(
            json.dumps({"type": "sender_ready", "connection_id": connection_id})
        )

    async def setup_receiver(self, connection_id: str, stream_id: str = None):
        """Set up a client as an audio receiver"""
        try:
            connection = self.connections.get(connection_id)
            if not connection:
                return

            connection["role"] = "receiver"

            # If no specific stream requested, use the last available (newest)
            if not stream_id and self.active_streams:
                # Use list conversion to get the last key
                stream_keys = list(self.active_streams.keys())
                stream_id = stream_keys[-1]

            if not stream_id or stream_id not in self.active_streams:
                logger.warning(
                    f"No audio stream available for receiver {connection_id}"
                )
                await connection["ws"].send_str(
                    json.dumps(
                        {"type": "error", "message": "No audio stream available"}
                    )
                )
                return

            stream_info = self.active_streams[stream_id]
            source_track = stream_info["track"]

            if source_track.readyState == "ended":
                logger.warning(f"Stream {stream_id} track is ended, cannot receive")
                del self.active_streams[stream_id]
                await connection["ws"].send_str(
                    json.dumps({"type": "error", "message": "Stream ended"})
                )
                return

            # Add this receiver to the stream list
            if connection_id not in stream_info["receivers"]:
                stream_info["receivers"].append(connection_id)

            connection["stream_id"] = stream_id

            # Create RTCPeerConnection
            config = RTCConfiguration(iceServers=[])
            pc = RTCPeerConnection(configuration=config)
            connection["pc"] = pc

            # Use MediaRelay to create a consumer track
            relayed_track = self.relay.subscribe(source_track)
            pc.addTrack(relayed_track)

            @pc.on("iceconnectionstatechange")
            async def on_iceconnectionstatechange():
                logger.info(
                    f"ICE connection state for receiver {connection_id}: {pc.iceConnectionState}"
                )
                if pc.iceConnectionState == "failed":
                    await pc.close()

            # Create and send offer
            offer = await pc.createOffer()
            await pc.setLocalDescription(offer)

            # Wait slightly longer for ICE gathering to be safe
            await asyncio.sleep(1.0)

            # Check if connection still exists and matches
            if self.connections.get(connection_id, {}).get("pc") != pc:
                logger.warning(f"Connection {connection_id} reset during setup")
                return

            await connection["ws"].send_str(
                json.dumps(
                    {
                        "type": "webrtc_offer",
                        "offer": {
                            "sdp": pc.localDescription.sdp,
                            "type": pc.localDescription.type,
                        },
                    }
                )
            )
            logger.info(
                f"Sent offer to receiver {connection_id} for stream {stream_id}"
            )

        except Exception as e:
            logger.error(
                f"Error setting up receiver {connection_id}: {e}", exc_info=True
            )
            if connection_id in self.connections:
                await self.connections[connection_id]["ws"].send_str(
                    json.dumps({"type": "error", "message": f"Server error: {str(e)}"})
                )

    async def send_available_streams(self, connection_id: str):
        """Send list of available streams to a client"""
        connection = self.connections.get(connection_id)
        if not connection:
            return

        stream_list = list(self.active_streams.keys())
        try:
            await connection["ws"].send_str(
                json.dumps({"type": "available_streams", "streams": stream_list})
            )
        except Exception as e:
            logger.error(f"Error sending available streams: {e}")

    async def broadcast_stream_available(self, stream_id: str):
        message = json.dumps({"type": "stream_available", "stream_id": stream_id})
        for conn in self.connections.values():
            try:
                await conn["ws"].send_str(message)
            except Exception:
                pass

    async def broadcast_stream_ended(self, stream_id: str):
        message = json.dumps({"type": "stream_ended", "stream_id": stream_id})
        for conn in self.connections.values():
            try:
                await conn["ws"].send_str(message)
            except Exception:
                pass

    async def handle_webrtc_offer(self, connection_id: str, data: dict):
        # This handles offers FROM the client (Sender)
        connection = self.connections.get(connection_id)
        if not connection or not connection["pc"]:
            return

        pc = connection["pc"]
        try:
            offer = RTCSessionDescription(
                sdp=data["offer"]["sdp"], type=data["offer"]["type"]
            )
            await pc.setRemoteDescription(offer)

            answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)

            # Wait for ICE
            await asyncio.sleep(1.0)

            await connection["ws"].send_str(
                json.dumps(
                    {
                        "type": "webrtc_answer",
                        "answer": {
                            "sdp": pc.localDescription.sdp,
                            "type": pc.localDescription.type,
                        },
                    }
                )
            )
        except Exception as e:
            logger.error(f"Error handling offer from {connection_id}: {e}")

    async def handle_webrtc_answer(self, connection_id: str, data: dict):
        # This handles answers FROM the client (Receiver)
        connection = self.connections.get(connection_id)
        if not connection or not connection["pc"]:
            return

        pc = connection["pc"]
        try:
            answer = RTCSessionDescription(
                sdp=data["answer"]["sdp"], type=data["answer"]["type"]
            )
            await pc.setRemoteDescription(answer)
            logger.info(f"Set remote description (answer) for {connection_id}")
        except Exception as e:
            logger.error(f"Error handling answer from {connection_id}: {e}")

    async def cleanup_connection(self, connection_id: str):
        if connection_id in self.connections:
            connection = self.connections[connection_id]
            logger.info(f"Cleaning up connection {connection_id}")

            # If sender, remove stream
            if connection.get("role") == "sender" and connection.get("stream_id"):
                stream_id = connection["stream_id"]
                if stream_id in self.active_streams:
                    del self.active_streams[stream_id]
                await self.broadcast_stream_ended(stream_id)

            # If receiver, remove from list
            elif connection.get("role") == "receiver" and connection.get("stream_id"):
                stream_id = connection["stream_id"]
                if stream_id in self.active_streams:
                    receivers = self.active_streams[stream_id].get("receivers", [])
                    if connection_id in receivers:
                        receivers.remove(connection_id)

            if connection.get("pc"):
                await connection["pc"].close()

            del self.connections[connection_id]

    async def process_visualization(self, stream_id: str, track):
        """Keep the stream flowing and send viz data"""
        logger.info(f"Starting visualization task for {stream_id}")
        frame_count = 0
        try:
            while stream_id in self.active_streams:
                try:
                    # Pull frame to keep relay active
                    _ = await asyncio.wait_for(track.recv(), timeout=2.0)

                    frame_count += 1
                    # Downsample viz data
                    if frame_count % 5 == 0:
                        # Processing logic...
                        pass
                except asyncio.TimeoutError:
                    # Just continue, don't crash. Silence is okay.
                    continue
                except Exception as e:
                    # If track ends or errors, we stop this loop
                    logger.warning(f"Visualization loop ended for {stream_id}: {e}")
                    break
        except Exception as e:
            logger.error(f"Visualization task error: {e}")
        finally:
            logger.info(f"Visualization task stopped for {stream_id}")

    async def ca_download_handler(self, request):
        """Serve the CA certificate if available."""
        ca_paths = [
            "/ssl/ca.crt",
            "/data/ssl/ca.crt",
            "/config/ssl/ca.crt",
            "ssl/ca.crt",
            "./ca.crt",
        ]
        for path in ca_paths:
            if os.path.exists(path):
                return web.FileResponse(path)
        return web.Response(status=404, text="CA Certificate not found")

    async def run_server(self):
        base_port = int(os.environ.get("PORT", 8080))
        host = "0.0.0.0"

        # Check for SSL certificates
        ssl_context = None
        cert_file = os.environ.get("SSL_CERT_FILE")
        key_file = os.environ.get("SSL_KEY_FILE")

        if cert_file and key_file:
            if os.path.exists(cert_file) and os.path.exists(key_file):
                try:
                    ssl_context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
                    ssl_context.load_cert_chain(cert_file, key_file)
                    logger.info(f"SSL enabled using certificates from {cert_file}")
                except Exception as e:
                    logger.error(
                        f"Failed to load SSL certificates from {cert_file}: {e}"
                    )
            else:
                logger.warning(
                    f"SSL keys defined but files not found: {cert_file}, {key_file}"
                )

        # Fallback to legacy hardcoded paths
        if not ssl_context:
            cert_locations = [
                ("/ssl/fullchain.pem", "/ssl/privkey.pem"),
                ("/config/ssl/fullchain.pem", "/config/ssl/privkey.pem"),
            ]
            for cert, key in cert_locations:
                if os.path.exists(cert) and os.path.exists(key):
                    try:
                        ssl_context = ssl.create_default_context(
                            ssl.Purpose.CLIENT_AUTH
                        )
                        ssl_context.load_cert_chain(cert, key)
                        logger.info(
                            f"SSL enabled using fallback certificates from {cert}"
                        )
                        break
                    except Exception as e:
                        logger.error(
                            f"Failed to load SSL certificates from {cert}: {e}"
                        )

        # Integrate Audio Server Routes
        self.app.router.add_get(
            "/stream/latest.mp3", self.audio_server.latest_stream_handler
        )
        self.app.router.add_get(
            "/stream/{stream_id}.mp3", self.audio_server.stream_handler
        )
        self.app.router.add_get("/stream/status", self.audio_server.status_handler)
        self.app.router.add_get("/ca.crt", self.ca_download_handler)
        logger.info("Audio Stream Server routes merged into main application")

        runner = web.AppRunner(self.app)
        await runner.setup()

        # ── SMART PORT HUNTING ──
        active_port = base_port
        site = None
        for i in range(10):  # Try up to 10 ports
            try:
                test_port = base_port + i
                site = web.TCPSite(runner, host, test_port, ssl_context=ssl_context)
                await site.start()
                active_port = test_port
                break
            except OSError as e:
                if "Address in use" in str(e) or e.errno == 98:
                    logger.warning(
                        f"Port {test_port} is busy, trying {test_port + 1}..."
                    )
                else:
                    raise e

        if not site:
            logger.error(
                f"Could not bind to any port in range {base_port}-{base_port + 10}"
            )
            return

        # ── STATE PERSISTENCE ──
        # Write the active port to a state file for the frontend to discover
        try:
            state_dir = "/config/www/voice_streaming_backend"
            os.makedirs(state_dir, exist_ok=True)
            with open(f"{state_dir}/server_state.json", "w") as f:
                json.dump(
                    {
                        "active_port": active_port,
                        "ssl": ssl_context is not None,
                        "started_at": asyncio.get_event_loop().time(),
                    },
                    f,
                )
            logger.info(f"Valid Server State written to {state_dir}/server_state.json")
        except Exception as e:
            logger.warning(f"Could not write server state: {e}")

        self.cleanup_task = asyncio.create_task(self.cleanup_stale_streams())
        protocol = "https/wss" if ssl_context else "http/ws"
        logger.info(
            f"✅ Server successfully started on {protocol}://{host}:{active_port}"
        )

        try:
            audio_port = int(os.environ.get("AUDIO_PORT", 8081))
            logger.info(
                f"Starting standalone Audio Stream HTTP server on port {audio_port}..."
            )
            await self.audio_server.start(host=host, port=audio_port)
        except Exception as e:
            logger.error(f"Failed to start standalone Audio Stream server: {e}")

        while True:
            await asyncio.sleep(3600)


if __name__ == "__main__":
    log_level = os.environ.get("LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        level=getattr(logging, log_level, logging.INFO),
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )
    server = VoiceStreamingServer()
    try:
        asyncio.run(server.run_server())
    except KeyboardInterrupt:
        logger.info("Stopped server")
