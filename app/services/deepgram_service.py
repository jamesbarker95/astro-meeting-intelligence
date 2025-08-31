"""
Deepgram service for real-time speech-to-text transcription using threading
"""
import threading
import json
import base64
import datetime
import queue
from websocket import WebSocketApp
import websocket
from structlog import get_logger

logger = get_logger()

class DeepgramManager:
    """Manager for Deepgram WebSocket connections using threading approach"""
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.connections = {}  # Stores active Deepgram WebSocket connections per session_id
        self.audio_queues = {}  # Audio data queues for each session
        logger.info("DeepgramManager initialized with threading approach")

    def start_session(self, session_id: str, transcript_callback):
        """Starts a Deepgram transcription session for a given session_id using threading."""
        if session_id in self.connections:
            logger.warning("Deepgram session already active", session_id=session_id)
            return True

        try:
            # Create audio queue for this session
            self.audio_queues[session_id] = queue.Queue()
            
            # WebSocket URL with parameters
            ws_url = "wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000&channels=1&punctuate=true&interim_results=true"
            
            # Headers for authentication
            headers = {"Authorization": f"Token {self.api_key}"}
            
            # Create WebSocket connection
            ws = WebSocketApp(
                ws_url,
                on_open=lambda ws: self._on_open(ws, session_id),
                on_message=lambda ws, message: self._on_message(ws, message, session_id, transcript_callback),
                on_close=lambda ws, close_status_code, close_msg: self._on_close(ws, close_status_code, close_msg, session_id),
                on_error=lambda ws, error: self._on_error(ws, error, session_id),
                header=headers
            )
            
            # Start WebSocket in a separate thread
            ws_thread = threading.Thread(target=ws.run_forever, daemon=True)
            ws_thread.start()
            
            # Start audio streaming thread
            audio_thread = threading.Thread(target=self._stream_audio, args=(ws, session_id), daemon=True)
            audio_thread.start()
            
            # Store connection info
            self.connections[session_id] = {
                'websocket': ws,
                'ws_thread': ws_thread,
                'audio_thread': audio_thread,
                'transcript_callback': transcript_callback
            }
            
            logger.info("Deepgram WebSocket connection started", session_id=session_id)
            return True
            
        except Exception as e:
            logger.error("Failed to start Deepgram session", session_id=session_id, error=str(e))
            return False

    def end_session(self, session_id: str):
        """Ends a Deepgram transcription session."""
        if session_id in self.connections:
            try:
                conn_data = self.connections.pop(session_id)
                ws = conn_data['websocket']
                
                # Close WebSocket connection
                ws.close()
                
                # Clean up audio queue
                if session_id in self.audio_queues:
                    del self.audio_queues[session_id]
                
                logger.info("Deepgram session ended", session_id=session_id)
            except Exception as e:
                logger.error("Error ending Deepgram session", session_id=session_id, error=str(e))
        else:
            logger.warning("Deepgram session not found", session_id=session_id)

    def send_audio(self, session_id: str, audio_data_b64: str):
        """Queues base64 encoded audio data for transmission to Deepgram."""
        if session_id not in self.connections:
            logger.warning("Deepgram session not found for audio", session_id=session_id)
            return False
        
        if session_id not in self.audio_queues:
            logger.warning("Audio queue not found for session", session_id=session_id)
            return False
        
        try:
            # Decode base64 audio data
            audio_bytes = base64.b64decode(audio_data_b64)
            
            # Add to queue for streaming thread
            self.audio_queues[session_id].put(audio_bytes)
            
            # Debug log occasionally
            if len(audio_bytes) > 0:
                logger.debug("Audio queued for Deepgram", 
                           session_id=session_id, 
                           bytes_queued=len(audio_bytes))
            
            return True
            
        except Exception as e:
            logger.error("Failed to queue audio for Deepgram", session_id=session_id, error=str(e))
            return False

    def _on_open(self, ws, session_id):
        """Called when WebSocket connection is established."""
        logger.info("🎵 DEEPGRAM: WebSocket connected", session_id=session_id)

    def _on_message(self, ws, message, session_id, transcript_callback):
        """Called when a message is received from Deepgram."""
        try:
            response = json.loads(message)
            if response.get("type") == "Results":
                transcript_data = self._process_deepgram_response(response)
                if transcript_data:
                    logger.info("🎵 DEEPGRAM: Transcript received", 
                              session_id=session_id,
                              transcript=transcript_data['transcript'][:50] + "..." if len(transcript_data['transcript']) > 50 else transcript_data['transcript'],
                              confidence=transcript_data['confidence'],
                              is_final=transcript_data['is_final'])
                    
                    # Call the transcript callback in a separate thread to avoid blocking
                    callback_thread = threading.Thread(
                        target=self._handle_transcript_callback,
                        args=(transcript_callback, transcript_data),
                        daemon=True
                    )
                    callback_thread.start()
        except json.JSONDecodeError as e:
            logger.error("❌ DEEPGRAM: Error decoding JSON message", session_id=session_id, error=str(e))
        except Exception as e:
            logger.error("❌ DEEPGRAM: Error processing message", session_id=session_id, error=str(e))

    def _on_close(self, ws, close_status_code, close_msg, session_id):
        """Called when WebSocket connection is closed."""
        logger.info("🎵 DEEPGRAM: WebSocket closed", session_id=session_id, code=close_status_code, message=close_msg)

    def _on_error(self, ws, error, session_id):
        """Called when WebSocket error occurs."""
        logger.error("❌ DEEPGRAM: WebSocket error", session_id=session_id, error=str(error))

    def _stream_audio(self, ws, session_id):
        """Streams audio data from queue to WebSocket."""
        logger.info("🎵 DEEPGRAM: Audio streaming thread started", session_id=session_id)
        
        while session_id in self.connections and session_id in self.audio_queues:
            try:
                # Get audio data from queue (with timeout to allow thread cleanup)
                audio_bytes = self.audio_queues[session_id].get(timeout=1.0)
                
                # Send binary audio data to Deepgram
                ws.send(audio_bytes, opcode=websocket.ABNF.OPCODE_BINARY)
                
                # Debug log occasionally
                if len(audio_bytes) > 0:
                    logger.debug("🎵 DEEPGRAM: Audio sent", 
                               session_id=session_id, 
                               bytes_sent=len(audio_bytes))
                
            except queue.Empty:
                # Timeout - continue loop to check if session still active
                continue
            except Exception as e:
                logger.error("❌ DEEPGRAM: Error streaming audio", session_id=session_id, error=str(e))
                break
        
        logger.info("🎵 DEEPGRAM: Audio streaming thread ended", session_id=session_id)

    def _handle_transcript_callback(self, transcript_callback, transcript_data):
        """Handles transcript callback in a separate thread."""
        try:
            # Since this is now synchronous, we can call it directly
            # The original callback was async, but we'll adapt it
            import asyncio
            
            # Create a new event loop for this thread
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
            # Run the async callback
            loop.run_until_complete(transcript_callback(transcript_data))
            loop.close()
            
        except Exception as e:
            logger.error("❌ DEEPGRAM: Error in transcript callback", error=str(e))

    def _process_deepgram_response(self, response: dict) -> dict:
        """Processes a Deepgram API response and extracts transcript data."""
        if not response.get('channel', {}).get('alternatives'):
            return None
        
        alternative = response['channel']['alternatives'][0]
        transcript = alternative.get('transcript', '').strip()
        confidence = alternative.get('confidence', 0.0)
        is_final = response.get('is_final', False)
        
        if transcript:
            return {
                'transcript': transcript,
                'confidence': confidence,
                'is_final': is_final,
                'timestamp': response.get('start', 0)
            }
        return None

    def is_session_active(self, session_id: str) -> bool:
        """Check if Deepgram session is active"""
        return session_id in self.connections

    def get_active_sessions(self) -> list:
        """Get list of active session IDs"""
        return list(self.connections.keys())