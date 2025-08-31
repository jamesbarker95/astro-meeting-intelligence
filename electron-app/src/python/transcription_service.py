#!/usr/bin/env python3
"""Main transcription service for Astro Electron app.

This script runs as a subprocess from Electron and handles all audio capture
and transcription. It outputs formatted transcripts to stdout for Electron
to read and process.
"""
import argparse
import json
import sys
import signal
import asyncio
from typing import Optional
from deepgram_transcription import AudioTranscriptionManager

class TranscriptionService:
    """Main service that manages audio transcription."""
    
    def __init__(self, deepgram_api_key: str, device_name: Optional[str] = None):
        self.deepgram_api_key = deepgram_api_key
        self.device_name = device_name
        self.manager = None
        self.is_running = False
        
    def initialize(self) -> None:
        """Initialize the transcription service."""
        try:
            self.manager = AudioTranscriptionManager(self.deepgram_api_key, self.device_name)
            self.manager.initialize()
            
            # Output initialization status
            status = {
                "type": "status",
                "status": "initialized",
                "message": "Transcription service ready"
            }
            print(json.dumps(status), flush=True)
            
        except Exception as e:
            error = {
                "type": "error",
                "error": str(e),
                "message": "Failed to initialize transcription service"
            }
            print(json.dumps(error), flush=True)
            raise
    
    def start_transcription(self) -> None:
        """Start audio transcription."""
        if not self.manager:
            raise RuntimeError("Service not initialized")
            
        try:
            self.is_running = True
            
            # Output start status
            status = {
                "type": "status",
                "status": "started",
                "message": "Transcription started"
            }
            print(json.dumps(status), flush=True)
            
            # Start the transcription loop
            self.manager.start_capture()
            
        except Exception as e:
            error = {
                "type": "error",
                "error": str(e),
                "message": "Failed to start transcription"
            }
            print(json.dumps(error), flush=True)
            raise
    
    def stop_transcription(self) -> None:
        """Stop audio transcription."""
        if not self.manager:
            return
            
        try:
            self.is_running = False
            self.manager.stop_capture()
            
            # Output stop status
            status = {
                "type": "status",
                "status": "stopped",
                "message": "Transcription stopped"
            }
            print(json.dumps(status), flush=True)
            
        except Exception as e:
            error = {
                "type": "error",
                "error": str(e),
                "message": "Failed to stop transcription"
            }
            print(json.dumps(error), flush=True)
    
    def get_status(self) -> dict:
        """Get current service status."""
        if not self.manager:
            return {"status": "not_initialized"}
        
        return self.manager.get_status()

def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="Astro transcription service")
    parser.add_argument("--api-key", required=True, help="Deepgram API key")
    parser.add_argument("--device-name", type=str, help="Audio device name (e.g., 'Astro')")
    parser.add_argument("--command", choices=["start", "stop", "status"], help="Command to execute")
    
    args = parser.parse_args()
    
    # Create service
    service = TranscriptionService(args.api_key, args.device_name)
    
    # Set up signal handlers for graceful shutdown
    def signal_handler(signum, frame):
        print("Received shutdown signal", file=sys.stderr)
        service.stop_transcription()
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        # Initialize service
        service.initialize()
        
        if args.command == "status":
            # Return status and exit
            status = service.get_status()
            print(json.dumps({"type": "status", "data": status}), flush=True)
            return
        
        elif args.command == "start":
            # Start transcription and keep running
            service.start_transcription()
            
            # Keep the service running
            while service.is_running:
                import time
                time.sleep(0.1)
        
        elif args.command == "stop":
            # Stop transcription
            service.stop_transcription()
        
        else:
            # No command specified, start transcription and keep running
            service.start_transcription()
            
            # Keep the service running
            while service.is_running:
                import time
                time.sleep(0.1)
    
    except KeyboardInterrupt:
        print("Received keyboard interrupt", file=sys.stderr)
        service.stop_transcription()
    
    except Exception as e:
        error = {
            "type": "error",
            "error": str(e),
            "message": "Service error"
        }
        print(json.dumps(error), flush=True)
        print(f"Service error: {e}", file=sys.stderr)

if __name__ == "__main__":
    main()
