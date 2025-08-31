#!/usr/bin/env python3
"""Deepgram transcription script for Astro Electron app.

Handles real-time transcription using Deepgram's Python SDK and outputs
formatted transcripts for integration with Electron main process.
"""
import argparse
import json
import sys
import time
import threading
from typing import Optional, Dict, Any, Callable
from deepgram import DeepgramClient, DeepgramClientOptions, LiveTranscriptionEvents
import asyncio

class DeepgramTranscription:
    """Handles real-time transcription using Deepgram."""
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.client = None
        self.connection = None
        self.is_connected = False
        self.on_transcript_callback: Optional[Callable[[Dict[str, Any]], None]] = None
        
    def connect(self) -> None:
        """Connect to Deepgram and start live transcription."""
        try:
            # Create Deepgram client
            self.client = DeepgramClient(self.api_key)
            
            # Create a websocket connection to Deepgram
            self.connection = self.client.listen.websocket.v("1")
            
            # Set up event handlers
            self.connection.on(LiveTranscriptionEvents.Transcript, self._on_transcript)
            self.connection.on(LiveTranscriptionEvents.Open, self._on_open)
            self.connection.on(LiveTranscriptionEvents.Close, self._on_close)
            self.connection.on(LiveTranscriptionEvents.Error, self._on_error)
            
            # Configure live transcription options
            from deepgram import LiveOptions
            options = LiveOptions(
                model="nova-3",
                language="en-US",
                smart_format=True,
                punctuate=True,
                interim_results=True,
                encoding="linear16",
                channels=1,
                sample_rate=16000
            )
            
            # Start the connection
            if self.connection.start(options) is False:
                raise Exception("Failed to start Deepgram connection")
            
            self.is_connected = True
            print("Deepgram connection started", file=sys.stderr)
            
        except Exception as e:
            print(f"Error connecting to Deepgram: {e}", file=sys.stderr)
            raise
    
    def _on_open(self, connection, event, **kwargs):
        """Handle connection open event."""
        self.is_connected = True
        print("Deepgram connection opened", file=sys.stderr)
        
    def _on_close(self, connection, event, **kwargs):
        """Handle connection close event."""
        self.is_connected = False
        print("Deepgram connection closed", file=sys.stderr)
        
    def _on_error(self, connection, error, **kwargs):
        """Handle connection error event."""
        print(f"Deepgram connection error: {error}", file=sys.stderr)
        self.is_connected = False
        
    def _on_transcript(self, result, **kwargs):
        """Handle transcript event."""
        try:
            sentence = result.channel.alternatives[0].transcript
            if len(sentence) == 0:
                return
                
            # Output formatted transcript
            stamp = time.strftime("%H:%M:%S")
            is_final = result.is_final if hasattr(result, 'is_final') else True
            
            if is_final:
                print(f"FINAL:[{stamp}] {sentence}", flush=True)
            else:
                print(f"INTERIM:[{stamp}] {sentence}", flush=True)
            
            # Create transcript data for callback
            transcript_data = {
                "type": "transcript",
                "text": sentence,
                "confidence": result.channel.alternatives[0].confidence if hasattr(result.channel.alternatives[0], 'confidence') else 0,
                "start": result.start if hasattr(result, 'start') else 0,
                "end": result.end if hasattr(result, 'end') else 0,
                "is_final": is_final,
                "timestamp": time.time()
            }
            
            # Call callback if provided
            if self.on_transcript_callback:
                self.on_transcript_callback(transcript_data)
                
        except Exception as e:
            print(f"Error handling transcript: {e}", file=sys.stderr)
    

    
    def send_audio(self, audio_data: bytes) -> None:
        """Send audio data to Deepgram."""
        if self.is_connected and self.connection:
            try:
                self.connection.send(audio_data)
            except Exception as e:
                print(f"Error sending audio to Deepgram: {e}", file=sys.stderr)
    
    def on_transcript(self, callback: Callable[[Dict[str, Any]], None]) -> None:
        """Set callback for transcript events."""
        self.on_transcript_callback = callback
    
    def disconnect(self) -> None:
        """Disconnect from Deepgram."""
        if self.connection:
            try:
                self.connection.finish()
                self.connection = None
                self.is_connected = False
                print("Disconnected from Deepgram", file=sys.stderr)
            except Exception as e:
                print(f"Error disconnecting from Deepgram: {e}", file=sys.stderr)
    
    def is_connected_to_deepgram(self) -> bool:
        """Check if connected to Deepgram."""
        return self.is_connected

class AudioTranscriptionManager:
    """Manages both audio capture and transcription."""
    
    def __init__(self, deepgram_api_key: str, device_name: Optional[str] = None):
        self.deepgram = DeepgramTranscription(deepgram_api_key)
        self.audio_capture = None  # Will be imported from audio_capture module
        self.is_running = False
        self.device_name = device_name
        
    def initialize(self) -> None:
        """Initialize audio capture and Deepgram connection."""
        try:
            # Import audio capture module
            from audio_capture import AudioCapture
            
            # Initialize audio capture
            self.audio_capture = AudioCapture(self.device_name)
            
            # Connect to Deepgram
            self.deepgram.connect()
            
            print("Audio transcription manager initialized", file=sys.stderr)
            
        except Exception as e:
            print(f"Error initializing audio transcription manager: {e}", file=sys.stderr)
            raise
    
    def start_capture(self) -> None:
        """Start audio capture and transcription."""
        if self.is_running:
            return
            
        try:
            # Start audio capture
            self.audio_capture.start_capture()
            
            # Start transcription loop
            self.is_running = True
            self._transcription_loop()
            
        except Exception as e:
            print(f"Error starting capture: {e}", file=sys.stderr)
            raise
    
    def stop_capture(self) -> None:
        """Stop audio capture and transcription."""
        self.is_running = False
        
        if self.audio_capture:
            self.audio_capture.stop_capture()
        
        self.deepgram.disconnect()
        
        print("Stopped audio capture and transcription", file=sys.stderr)
    
    def _transcription_loop(self) -> None:
        """Main transcription loop."""
        while self.is_running:
            try:
                # Get audio chunk from capture
                if self.audio_capture:
                    audio_chunk = self.audio_capture.get_audio_chunk()
                    if audio_chunk:
                        # Send to Deepgram
                        self.deepgram.send_audio(audio_chunk)
                
                # Small delay to prevent busy waiting
                import time
                time.sleep(0.01)
                
            except Exception as e:
                print(f"Error in transcription loop: {e}", file=sys.stderr)
                break
    
    def get_status(self) -> Dict[str, Any]:
        """Get current status."""
        audio_status = self.audio_capture.get_audio_status() if self.audio_capture else {}
        return {
            "is_running": self.is_running,
            "deepgram_connected": self.deepgram.is_connected_to_deepgram(),
            "audio_capture": audio_status
        }

async def main():
    """Main entry point for CLI usage."""
    parser = argparse.ArgumentParser(description="Deepgram transcription for Astro Electron app")
    parser.add_argument("--api-key", required=True, help="Deepgram API key")
    parser.add_argument("--device-name", type=str, help="Audio device name")
    parser.add_argument("--test", action="store_true", help="Test transcription")
    
    args = parser.parse_args()
    
    if args.test:
        try:
            manager = AudioTranscriptionManager(args.api_key, args.device_name)
            await manager.initialize()
            
            print("Starting transcription test. Press Ctrl+C to stop.", file=sys.stderr)
            await manager.start_capture()
            
            # Keep running until interrupted
            try:
                while True:
                    await asyncio.sleep(1)
            except KeyboardInterrupt:
                await manager.stop_capture()
                print("Test completed", file=sys.stderr)
                
        except Exception as e:
            print(f"Test failed: {e}", file=sys.stderr)

if __name__ == "__main__":
    asyncio.run(main())
