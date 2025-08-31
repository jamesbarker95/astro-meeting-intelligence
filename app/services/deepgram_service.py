"""
Deepgram service for real-time speech-to-text transcription using official SDK
"""
import os
import threading
import json
import base64
import queue
from typing import Dict, Callable, Optional
from structlog import get_logger

from deepgram import (
    DeepgramClient,
    DeepgramClientOptions,
    LiveTranscriptionEvents,
    LiveOptions,
)

logger = get_logger()

class DeepgramManager:
    """Manager for Deepgram WebSocket connections using official SDK"""
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.connections: Dict[str, dict] = {}  # session_id -> connection info
        self.audio_queues: Dict[str, queue.Queue] = {}  # Audio queues for each session
        
        # Set environment variable for Deepgram SDK
        os.environ["DEEPGRAM_API_KEY"] = api_key
        
        logger.info("🎵 DEEPGRAM: Manager initialized with official SDK")

    def start_session(self, session_id: str, transcript_callback: Callable) -> bool:
        """Start a Deepgram transcription session using official SDK"""
        if session_id in self.connections:
            logger.warning("🎵 DEEPGRAM: Session already active", session_id=session_id)
            return True

        try:
            logger.info("🎵 DEEPGRAM: Starting session with official SDK", session_id=session_id)
            
            # Create Deepgram client
            deepgram = DeepgramClient()
            
            # Create WebSocket connection
            dg_connection = deepgram.listen.websocket.v("1")
            
            # Create audio queue for this session
            self.audio_queues[session_id] = queue.Queue()
            
            # Define event handlers
            def on_message(self, result, **kwargs):
                try:
                    sentence = result.channel.alternatives[0].transcript
                    confidence = result.channel.alternatives[0].confidence
                    is_final = result.is_final
                    
                    if len(sentence) > 0:
                        logger.info("🎵 DEEPGRAM: Transcript received", 
                                  session_id=session_id,
                                  transcript=sentence[:50] + "..." if len(sentence) > 50 else sentence,
                                  confidence=confidence,
                                  is_final=is_final)
                        
                        # Create transcript data
                        transcript_data = {
                            'transcript': sentence,
                            'confidence': confidence,
                            'is_final': is_final,
                            'timestamp': 0  # Deepgram SDK doesn't provide start time in live mode
                        }
                        
                        # Call transcript callback in separate thread
                        callback_thread = threading.Thread(
                            target=self._handle_transcript_callback,
                            args=(transcript_callback, transcript_data),
                            daemon=True
                        )
                        callback_thread.start()
                        
                except Exception as e:
                    logger.error("❌ DEEPGRAM: Error processing transcript", 
                               session_id=session_id, error=str(e))
            
            def on_metadata(self, metadata, **kwargs):
                logger.info("🎵 DEEPGRAM: Metadata received", session_id=session_id)
            
            def on_speech_started(self, speech_started, **kwargs):
                logger.debug("🎵 DEEPGRAM: Speech started", session_id=session_id)
            
            def on_utterance_end(self, utterance_end, **kwargs):
                logger.debug("🎵 DEEPGRAM: Utterance ended", session_id=session_id)
            
            def on_close(self, close, **kwargs):
                logger.info("🎵 DEEPGRAM: Connection closed", session_id=session_id)
            
            def on_error(self, error, **kwargs):
                logger.error("❌ DEEPGRAM: Connection error", session_id=session_id, error=str(error))
            
            # Register event handlers
            dg_connection.on(LiveTranscriptionEvents.Transcript, on_message)
            dg_connection.on(LiveTranscriptionEvents.Metadata, on_metadata)
            dg_connection.on(LiveTranscriptionEvents.SpeechStarted, on_speech_started)
            dg_connection.on(LiveTranscriptionEvents.UtteranceEnd, on_utterance_end)
            dg_connection.on(LiveTranscriptionEvents.Close, on_close)
            dg_connection.on(LiveTranscriptionEvents.Error, on_error)
            
            # Connection options
            options = LiveOptions(
                model="nova-2",
                language="en-US",
                encoding="linear16",
                channels=1,
                sample_rate=16000,
                punctuate=True,
                interim_results=True
            )
            
            # Start connection
            if dg_connection.start(options) is False:
                logger.error("❌ DEEPGRAM: Failed to start connection", session_id=session_id)
                return False
            
            # Start audio streaming thread
            audio_thread = threading.Thread(
                target=self._stream_audio,
                args=(dg_connection, session_id),
                daemon=True
            )
            audio_thread.start()
            
            # Store connection info
            self.connections[session_id] = {
                'deepgram_client': deepgram,
                'dg_connection': dg_connection,
                'audio_thread': audio_thread,
                'transcript_callback': transcript_callback
            }
            
            logger.info("✅ DEEPGRAM: Session started successfully", session_id=session_id)
            return True
            
        except Exception as e:
            logger.error("❌ DEEPGRAM: Failed to start session", session_id=session_id, error=str(e))
            # Clean up on failure
            if session_id in self.audio_queues:
                del self.audio_queues[session_id]
            return False

    def end_session(self, session_id: str):
        """End a Deepgram transcription session"""
        if session_id in self.connections:
            try:
                logger.info("🎵 DEEPGRAM: Ending session", session_id=session_id)
                
                conn_data = self.connections.pop(session_id)
                dg_connection = conn_data['dg_connection']
                
                # Finish the connection (this will close it gracefully)
                dg_connection.finish()
                
                # Clean up audio queue
                if session_id in self.audio_queues:
                    del self.audio_queues[session_id]
                
                logger.info("✅ DEEPGRAM: Session ended successfully", session_id=session_id)
                
            except Exception as e:
                logger.error("❌ DEEPGRAM: Error ending session", session_id=session_id, error=str(e))
        else:
            logger.warning("⚠️ DEEPGRAM: Session not found for ending", session_id=session_id)

    def send_audio(self, session_id: str, audio_data_b64: str) -> bool:
        """Queue base64 encoded audio data for transmission to Deepgram"""
        if session_id not in self.connections:
            logger.warning("⚠️ DEEPGRAM: Session not found for audio", session_id=session_id)
            return False
        
        if session_id not in self.audio_queues:
            logger.warning("⚠️ DEEPGRAM: Audio queue not found", session_id=session_id)
            return False
        
        try:
            # Decode base64 audio data
            audio_bytes = base64.b64decode(audio_data_b64)
            
            # Add to queue for streaming thread
            self.audio_queues[session_id].put(audio_bytes)
            
            # Debug log occasionally (every 10th chunk)
            if len(audio_bytes) > 0:
                logger.debug("🎵 DEEPGRAM: Audio queued", 
                           session_id=session_id, 
                           bytes_queued=len(audio_bytes))
            
            return True
            
        except Exception as e:
            logger.error("❌ DEEPGRAM: Failed to queue audio", session_id=session_id, error=str(e))
            return False

    def _stream_audio(self, dg_connection, session_id: str):
        """Stream audio data from queue to Deepgram connection"""
        logger.info("🎵 DEEPGRAM: Audio streaming thread started", session_id=session_id)
        
        while session_id in self.connections and session_id in self.audio_queues:
            try:
                # Get audio data from queue (with timeout to allow thread cleanup)
                audio_bytes = self.audio_queues[session_id].get(timeout=1.0)
                
                # Send audio data to Deepgram
                dg_connection.send(audio_bytes)
                
                # Debug log occasionally
                logger.debug("🎵 DEEPGRAM: Audio sent to connection", 
                           session_id=session_id, 
                           bytes_sent=len(audio_bytes))
                
            except queue.Empty:
                # Timeout - continue loop to check if session still active
                continue
            except Exception as e:
                logger.error("❌ DEEPGRAM: Error streaming audio", session_id=session_id, error=str(e))
                break
        
        logger.info("🎵 DEEPGRAM: Audio streaming thread ended", session_id=session_id)

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
            logger.error("❌ DEEPGRAM: Error in transcript callback", error=str(e))

    def is_session_active(self, session_id: str) -> bool:
        """Check if Deepgram session is active"""
        return session_id in self.connections

    def get_active_sessions(self) -> list:
        """Get list of active session IDs"""
        return list(self.connections.keys())