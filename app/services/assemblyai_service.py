"""
AssemblyAI service for real-time speech-to-text transcription
"""
import json
import base64
import threading
import queue
import time
from typing import Dict, Callable, Optional
from structlog import get_logger
import websocket
from urllib.parse import urlencode

logger = get_logger()

class AssemblyAIManager:
    """Manager for AssemblyAI WebSocket connections"""
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.connections: Dict[str, dict] = {}  # session_id -> connection info
        self.audio_queues: Dict[str, queue.Queue] = {}  # Audio queues for each session
        
        # AssemblyAI WebSocket configuration
        self.connection_params = {
            "sample_rate": 16000,
            "format_turns": True
        }
        self.api_endpoint_base = "wss://streaming.assemblyai.com/v3/ws"
        
        logger.info("🎵 ASSEMBLYAI: Manager initialized")

    def start_session(self, session_id: str, transcript_callback: Callable) -> bool:
        """Start an AssemblyAI transcription session"""
        if session_id in self.connections:
            logger.warning("🎵 ASSEMBLYAI: Session already active", session_id=session_id)
            return True

        try:
            logger.info("🎵 ASSEMBLYAI: Starting session", session_id=session_id)
            
            # Create audio queue for this session
            self.audio_queues[session_id] = queue.Queue()
            
            # Build WebSocket URL with parameters
            api_endpoint = f"{self.api_endpoint_base}?{urlencode(self.connection_params)}"
            
            # Define event handlers
            def on_open(ws):
                logger.info("🎵 ASSEMBLYAI: WebSocket connected", session_id=session_id)
                
                # Start audio streaming thread
                audio_thread = threading.Thread(
                    target=self._stream_audio,
                    args=(ws, session_id),
                    daemon=True
                )
                audio_thread.start()
                
                # Store audio thread reference
                if session_id in self.connections:
                    self.connections[session_id]['audio_thread'] = audio_thread
            
            def on_message(ws, message):
                try:
                    data = json.loads(message)
                    msg_type = data.get('type')
                    
                    if msg_type == "Begin":
                        session_ai_id = data.get('id')
                        logger.info("🎵 ASSEMBLYAI: Session began", 
                                  session_id=session_id, 
                                  ai_session_id=session_ai_id)
                    
                    elif msg_type == "Turn":
                        transcript = data.get('transcript', '')
                        formatted = data.get('turn_is_formatted', False)
                        end_of_turn = data.get('end_of_turn', False)
                        
                        if transcript:
                            logger.info("🎵 ASSEMBLYAI: Transcript received", 
                                      session_id=session_id,
                                      transcript=transcript[:50] + "..." if len(transcript) > 50 else transcript,
                                      formatted=formatted,
                                      end_of_turn=end_of_turn)
                            
                            # Create transcript data
                            transcript_data = {
                                'transcript': transcript,
                                'confidence': 1.0,  # AssemblyAI doesn't provide confidence in streaming
                                'is_final': end_of_turn,
                                'timestamp': time.time()
                            }
                            
                            # Call transcript callback in separate thread
                            callback_thread = threading.Thread(
                                target=self._handle_transcript_callback,
                                args=(transcript_callback, transcript_data),
                                daemon=True
                            )
                            callback_thread.start()
                    
                    elif msg_type == "Termination":
                        audio_duration = data.get('audio_duration_seconds', 0)
                        logger.info("🎵 ASSEMBLYAI: Session terminated", 
                                  session_id=session_id,
                                  audio_duration=audio_duration)
                        
                except json.JSONDecodeError as e:
                    logger.error("❌ ASSEMBLYAI: Error decoding JSON message", 
                               session_id=session_id, error=str(e))
                except Exception as e:
                    logger.error("❌ ASSEMBLYAI: Error processing message", 
                               session_id=session_id, error=str(e))
            
            def on_error(ws, error):
                logger.error("❌ ASSEMBLYAI: WebSocket error", session_id=session_id, error=str(error))
            
            def on_close(ws, close_status_code, close_msg):
                logger.info("🎵 ASSEMBLYAI: WebSocket closed", 
                          session_id=session_id, 
                          code=close_status_code, 
                          message=close_msg)
                
                # Clean up connection data
                if session_id in self.connections:
                    del self.connections[session_id]
                if session_id in self.audio_queues:
                    del self.audio_queues[session_id]
            
            # Create WebSocket connection
            ws = websocket.WebSocketApp(
                api_endpoint,
                header={"Authorization": self.api_key},
                on_open=on_open,
                on_message=on_message,
                on_error=on_error,
                on_close=on_close,
            )
            
            # Start WebSocket in separate thread
            ws_thread = threading.Thread(target=ws.run_forever, daemon=True)
            ws_thread.start()
            
            # Store connection info
            self.connections[session_id] = {
                'websocket': ws,
                'ws_thread': ws_thread,
                'transcript_callback': transcript_callback
            }
            
            # Give connection a moment to establish
            time.sleep(1)
            
            logger.info("✅ ASSEMBLYAI: Session started successfully", session_id=session_id)
            return True
            
        except Exception as e:
            logger.error("❌ ASSEMBLYAI: Failed to start session", session_id=session_id, error=str(e))
            # Clean up on failure
            if session_id in self.audio_queues:
                del self.audio_queues[session_id]
            if session_id in self.connections:
                del self.connections[session_id]
            return False

    def end_session(self, session_id: str):
        """End an AssemblyAI transcription session"""
        if session_id in self.connections:
            try:
                logger.info("🎵 ASSEMBLYAI: Ending session", session_id=session_id)
                
                conn_data = self.connections[session_id]
                ws = conn_data['websocket']
                
                # Send termination message
                terminate_message = {"type": "Terminate"}
                if ws and ws.sock and ws.sock.connected:
                    ws.send(json.dumps(terminate_message))
                    time.sleep(0.5)  # Give time for message to process
                
                # Close WebSocket
                ws.close()
                
                # Clean up
                del self.connections[session_id]
                if session_id in self.audio_queues:
                    del self.audio_queues[session_id]
                
                logger.info("✅ ASSEMBLYAI: Session ended successfully", session_id=session_id)
                
            except Exception as e:
                logger.error("❌ ASSEMBLYAI: Error ending session", session_id=session_id, error=str(e))
        else:
            logger.warning("⚠️ ASSEMBLYAI: Session not found for ending", session_id=session_id)

    def send_audio(self, session_id: str, audio_data_b64: str) -> bool:
        """Queue base64 encoded audio data for transmission to AssemblyAI"""
        if session_id not in self.connections:
            logger.warning("⚠️ ASSEMBLYAI: Session not found for audio", session_id=session_id)
            return False
        
        if session_id not in self.audio_queues:
            logger.warning("⚠️ ASSEMBLYAI: Audio queue not found", session_id=session_id)
            return False
        
        try:
            # Decode base64 audio data
            audio_bytes = base64.b64decode(audio_data_b64)
            
            # Add to queue for streaming thread
            self.audio_queues[session_id].put(audio_bytes)
            
            # Debug log occasionally (every 20th chunk to reduce noise)
            if len(audio_bytes) > 0:
                logger.debug("🎵 ASSEMBLYAI: Audio queued", 
                           session_id=session_id, 
                           bytes_queued=len(audio_bytes))
            
            return True
            
        except Exception as e:
            logger.error("❌ ASSEMBLYAI: Failed to queue audio", session_id=session_id, error=str(e))
            return False

    def _stream_audio(self, ws, session_id: str):
        """Stream audio data from queue to AssemblyAI WebSocket"""
        logger.info("🎵 ASSEMBLYAI: Audio streaming thread started", session_id=session_id)
        
        while session_id in self.connections and session_id in self.audio_queues:
            try:
                # Get audio data from queue (with timeout to allow thread cleanup)
                audio_bytes = self.audio_queues[session_id].get(timeout=1.0)
                
                # Send audio data as binary to AssemblyAI
                if ws and ws.sock and ws.sock.connected:
                    ws.send(audio_bytes, websocket.ABNF.OPCODE_BINARY)
                    
                    # Debug log occasionally
                    logger.debug("🎵 ASSEMBLYAI: Audio sent to WebSocket", 
                               session_id=session_id, 
                               bytes_sent=len(audio_bytes))
                else:
                    logger.warning("⚠️ ASSEMBLYAI: WebSocket not connected, discarding audio", 
                                 session_id=session_id)
                    break
                
            except queue.Empty:
                # Timeout - continue loop to check if session still active
                continue
            except Exception as e:
                logger.error("❌ ASSEMBLYAI: Error streaming audio", session_id=session_id, error=str(e))
                break
        
        logger.info("🎵 ASSEMBLYAI: Audio streaming thread ended", session_id=session_id)

    def _handle_transcript_callback(self, transcript_callback: Callable, transcript_data: dict):
        """Handle transcript callback in a separate thread"""
        try:
            # Since the callback is async, we need to run it in an event loop
            import asyncio
            
            # Create a new event loop for this thread
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
            # Run the async callback
            loop.run_until_complete(transcript_callback(transcript_data))
            loop.close()
            
        except Exception as e:
            logger.error("❌ ASSEMBLYAI: Error in transcript callback", error=str(e))

    def is_session_active(self, session_id: str) -> bool:
        """Check if AssemblyAI session is active"""
        return session_id in self.connections

    def get_active_sessions(self) -> list:
        """Get list of active session IDs"""
        return list(self.connections.keys())
