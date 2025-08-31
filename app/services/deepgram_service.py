"""
Deepgram service for real-time speech-to-text transcription
"""
import asyncio
import base64
import json
import logging
import websockets
from typing import Optional, Callable
from structlog import get_logger

logger = get_logger()

class DeepgramService:
    """Service for handling Deepgram WebSocket connections and transcription"""
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.websocket = None
        self.is_connected = False
        self.session_id = None
        self.transcript_callback = None
        
        # Deepgram WebSocket URL
        self.deepgram_url = (
            "wss://api.deepgram.com/v1/listen"
            "?encoding=linear16"
            "&sample_rate=16000"
            "&channels=1"
            "&model=nova-2"
            "&language=en-US"
            "&punctuate=true"
            "&interim_results=true"
            "&endpointing=300"
        )
    
    async def connect(self, session_id: str, transcript_callback: Callable):
        """Connect to Deepgram WebSocket"""
        try:
            self.session_id = session_id
            self.transcript_callback = transcript_callback
            
            headers = {
                "Authorization": f"Token {self.api_key}"
            }
            
            logger.info("Connecting to Deepgram", session_id=session_id)
            
            self.websocket = await websockets.connect(
                self.deepgram_url,
                extra_headers=headers
            )
            
            self.is_connected = True
            logger.info("Connected to Deepgram", session_id=session_id)
            
            # Start listening for responses
            asyncio.create_task(self._listen_for_responses())
            
            return True
            
        except Exception as e:
            logger.error("Failed to connect to Deepgram", error=str(e), session_id=session_id)
            self.is_connected = False
            return False
    
    async def disconnect(self):
        """Disconnect from Deepgram WebSocket"""
        try:
            if self.websocket and self.is_connected:
                logger.info("Disconnecting from Deepgram", session_id=self.session_id)
                
                # Send close frame
                await self.websocket.send(json.dumps({"type": "CloseStream"}))
                await self.websocket.close()
                
                self.is_connected = False
                self.websocket = None
                
                logger.info("Disconnected from Deepgram", session_id=self.session_id)
                
        except Exception as e:
            logger.error("Error disconnecting from Deepgram", error=str(e), session_id=self.session_id)
    
    async def send_audio(self, audio_data: str):
        """Send base64 encoded audio data to Deepgram"""
        try:
            if not self.is_connected or not self.websocket:
                logger.warning("Deepgram not connected, cannot send audio", session_id=self.session_id)
                return False
            
            # Decode base64 audio data
            try:
                audio_bytes = base64.b64decode(audio_data)
            except Exception as e:
                logger.error("Failed to decode base64 audio", error=str(e), session_id=self.session_id)
                return False
            
            # Send binary audio data to Deepgram
            await self.websocket.send(audio_bytes)
            
            # Debug log occasionally
            if len(audio_bytes) > 0:
                logger.debug("Sent audio to Deepgram", 
                           session_id=self.session_id, 
                           bytes_sent=len(audio_bytes))
            
            return True
            
        except Exception as e:
            logger.error("Failed to send audio to Deepgram", error=str(e), session_id=self.session_id)
            return False
    
    async def _listen_for_responses(self):
        """Listen for transcript responses from Deepgram"""
        try:
            async for message in self.websocket:
                try:
                    response = json.loads(message)
                    await self._handle_deepgram_response(response)
                    
                except json.JSONDecodeError as e:
                    logger.error("Failed to parse Deepgram response", error=str(e), session_id=self.session_id)
                    
        except websockets.exceptions.ConnectionClosed:
            logger.info("Deepgram connection closed", session_id=self.session_id)
            self.is_connected = False
            
        except Exception as e:
            logger.error("Error listening for Deepgram responses", error=str(e), session_id=self.session_id)
            self.is_connected = False
    
    async def _handle_deepgram_response(self, response: dict):
        """Handle transcript response from Deepgram"""
        try:
            # Check if this is a transcript response
            if response.get("type") == "Results":
                channel = response.get("channel", {})
                alternatives = channel.get("alternatives", [])
                
                if alternatives:
                    alternative = alternatives[0]
                    transcript = alternative.get("transcript", "").strip()
                    confidence = alternative.get("confidence", 0.0)
                    
                    # Only process non-empty transcripts
                    if transcript:
                        is_final = response.get("is_final", False)
                        
                        logger.info("Deepgram transcript received", 
                                  session_id=self.session_id,
                                  transcript=transcript[:50] + "..." if len(transcript) > 50 else transcript,
                                  confidence=confidence,
                                  is_final=is_final)
                        
                        # Call the transcript callback
                        if self.transcript_callback:
                            await self.transcript_callback({
                                'session_id': self.session_id,
                                'transcript': transcript,
                                'confidence': confidence,
                                'is_final': is_final,
                                'timestamp': response.get('start', 0)
                            })
            
            elif response.get("type") == "Metadata":
                logger.info("Deepgram metadata received", session_id=self.session_id)
                
            elif response.get("type") == "SpeechStarted":
                logger.debug("Speech started", session_id=self.session_id)
                
            elif response.get("type") == "UtteranceEnd":
                logger.debug("Utterance ended", session_id=self.session_id)
                
        except Exception as e:
            logger.error("Error handling Deepgram response", error=str(e), session_id=self.session_id)


class DeepgramManager:
    """Manager for multiple Deepgram connections per session"""
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.connections = {}  # session_id -> DeepgramService
    
    async def start_session(self, session_id: str, transcript_callback: Callable) -> bool:
        """Start Deepgram connection for a session"""
        try:
            if session_id in self.connections:
                logger.warning("Deepgram session already exists", session_id=session_id)
                return True
            
            service = DeepgramService(self.api_key)
            success = await service.connect(session_id, transcript_callback)
            
            if success:
                self.connections[session_id] = service
                logger.info("Deepgram session started", session_id=session_id)
                return True
            else:
                logger.error("Failed to start Deepgram session", session_id=session_id)
                return False
                
        except Exception as e:
            logger.error("Error starting Deepgram session", error=str(e), session_id=session_id)
            return False
    
    async def end_session(self, session_id: str):
        """End Deepgram connection for a session"""
        try:
            if session_id in self.connections:
                service = self.connections[session_id]
                await service.disconnect()
                del self.connections[session_id]
                logger.info("Deepgram session ended", session_id=session_id)
            else:
                logger.warning("Deepgram session not found", session_id=session_id)
                
        except Exception as e:
            logger.error("Error ending Deepgram session", error=str(e), session_id=session_id)
    
    async def send_audio(self, session_id: str, audio_data: str) -> bool:
        """Send audio data to Deepgram for a session"""
        try:
            if session_id not in self.connections:
                logger.warning("Deepgram session not found for audio", session_id=session_id)
                return False
            
            service = self.connections[session_id]
            return await service.send_audio(audio_data)
            
        except Exception as e:
            logger.error("Error sending audio to Deepgram", error=str(e), session_id=session_id)
            return False
    
    def is_session_active(self, session_id: str) -> bool:
        """Check if Deepgram session is active"""
        return session_id in self.connections and self.connections[session_id].is_connected
    
    def get_active_sessions(self) -> list:
        """Get list of active session IDs"""
        return list(self.connections.keys())
