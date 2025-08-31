#!/usr/bin/env python3
"""Audio capture script for Astro Electron app.

Captures microphone and system audio using sounddevice and outputs to stdout
for integration with Electron main process.
"""
import argparse
import json
import sys
import time
import threading
from typing import Optional, Dict, Any
import numpy as np
import sounddevice as sd

# Audio Configuration
SAMPLE_RATE = 16000
CHANNELS = 1
CHUNK_SIZE = 800  # 50ms chunks (0.05s * 16000Hz)
DTYPE = np.int16

class AudioCapture:
    """Handles audio capture from microphone and system audio."""
    
    def __init__(self, device_name: Optional[str] = None):
        self.device_name = device_name
        self.is_capturing = False
        self.audio_queue = []
        self.lock = threading.Lock()
        
    def list_devices(self) -> None:
        """List available audio input devices."""
        print("Available audio input devices:", file=sys.stderr)
        devices = sd.query_devices()
        for i, device in enumerate(devices):
            if device['max_input_channels'] > 0:
                print(f"{i}: {device['name']} (inputs: {device['max_input_channels']})", file=sys.stderr)
    
    def find_device(self, name_substring: str) -> Optional[int]:
        """Find device index by name substring."""
        name_substring = name_substring.lower()
        devices = sd.query_devices()
        for i, device in enumerate(devices):
            if (device['max_input_channels'] > 0 and 
                name_substring in device['name'].lower()):
                return i
        return None
    
    def audio_callback(self, indata: np.ndarray, frames: int, 
                      time_info: Dict[str, Any], status: sd.CallbackFlags) -> None:
        """Callback for audio data from sounddevice."""
        if status:
            print(f"Audio callback status: {status}", file=sys.stderr)
            return
            
        if self.is_capturing:
            # Convert to 16-bit PCM
            audio_data = (indata * 32767).astype(np.int16)
            
            with self.lock:
                self.audio_queue.append(audio_data.tobytes())
                
                # Keep only recent chunks to prevent memory issues
                if len(self.audio_queue) > 100:  # ~5 seconds of audio
                    self.audio_queue.pop(0)
    
    def start_capture(self, device_index: Optional[int] = None) -> None:
        """Start audio capture."""
        if self.is_capturing:
            return
            
        # Find device if not specified
        if device_index is None and self.device_name:
            device_index = self.find_device(self.device_name)
            if device_index is None:
                print(f"Could not find device containing '{self.device_name}'", file=sys.stderr)
                return
        
        try:
            # Start audio stream
            self.stream = sd.InputStream(
                samplerate=SAMPLE_RATE,
                channels=CHANNELS,
                dtype=np.float32,
                device=device_index,
                callback=self.audio_callback,
                blocksize=CHUNK_SIZE
            )
            
            self.stream.start()
            self.is_capturing = True
            
            device_info = sd.query_devices(device_index) if device_index is not None else "default"
            print(f"Started audio capture from: {device_info['name'] if isinstance(device_info, dict) else 'default device'}", file=sys.stderr)
            
        except Exception as e:
            print(f"Error starting audio capture: {e}", file=sys.stderr)
            raise
    
    def stop_capture(self) -> None:
        """Stop audio capture."""
        if not self.is_capturing:
            return
            
        try:
            self.stream.stop()
            self.stream.close()
            self.is_capturing = False
            print("Stopped audio capture", file=sys.stderr)
        except Exception as e:
            print(f"Error stopping audio capture: {e}", file=sys.stderr)
    
    def get_audio_chunk(self) -> Optional[bytes]:
        """Get the next audio chunk from the queue."""
        with self.lock:
            if self.audio_queue:
                return self.audio_queue.pop(0)
        return None
    
    def get_audio_status(self) -> Dict[str, Any]:
        """Get current audio capture status."""
        return {
            "is_capturing": self.is_capturing,
            "queue_size": len(self.audio_queue),
            "device_name": self.device_name
        }

def main():
    """Main entry point for CLI usage."""
    parser = argparse.ArgumentParser(description="Audio capture for Astro Electron app")
    parser.add_argument("--list-devices", action="store_true", help="List available audio devices")
    parser.add_argument("--device-name", type=str, help="Device name to capture from")
    parser.add_argument("--device-index", type=int, help="Device index to capture from")
    parser.add_argument("--test-capture", action="store_true", help="Test audio capture")
    
    args = parser.parse_args()
    
    capture = AudioCapture(args.device_name)
    
    if args.list_devices:
        capture.list_devices()
        return
    
    if args.test_capture:
        try:
            capture.start_capture(args.device_index)
            print("Audio capture started. Press Ctrl+C to stop.", file=sys.stderr)
            
            # Test for 10 seconds
            start_time = time.time()
            while time.time() - start_time < 10:
                chunk = capture.get_audio_chunk()
                if chunk:
                    print(f"Received audio chunk: {len(chunk)} bytes", file=sys.stderr)
                time.sleep(0.1)
                
            capture.stop_capture()
            print("Test completed", file=sys.stderr)
            
        except KeyboardInterrupt:
            capture.stop_capture()
            print("Test interrupted", file=sys.stderr)
        except Exception as e:
            print(f"Test failed: {e}", file=sys.stderr)

if __name__ == "__main__":
    main()
