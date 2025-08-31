#!/usr/bin/env python3
"""
Quick test script to verify BlackHole is receiving audio
"""
import sounddevice as sd
import numpy as np
import time

def list_devices():
    """List all audio devices"""
    print("Available audio devices:")
    devices = sd.query_devices()
    for i, device in enumerate(devices):
        if device['max_input_channels'] > 0:
            print(f"  {i}: {device['name']} (inputs: {device['max_input_channels']})")

def test_blackhole():
    """Test BlackHole audio capture"""
    # Find BlackHole device
    devices = sd.query_devices()
    blackhole_idx = None
    
    for i, device in enumerate(devices):
        if 'blackhole' in device['name'].lower() and device['max_input_channels'] > 0:
            blackhole_idx = i
            print(f"Found BlackHole device: {device['name']}")
            break
    
    if blackhole_idx is None:
        print("BlackHole device not found!")
        return
    
    print("Testing BlackHole audio capture for 10 seconds...")
    print("Play some audio now!")
    
    def audio_callback(indata, frames, time, status):
        if status:
            print(f"Status: {status}")
        
        # Calculate RMS level
        rms = np.sqrt(np.mean(indata**2))
        level = rms * 100  # Convert to percentage-like value
        
        if level > 0.01:  # Only print if there's some signal
            print(f"Audio level: {level:.2f}")
    
    # Start recording
    with sd.InputStream(
        device=blackhole_idx,
        channels=2,  # BlackHole 2ch
        samplerate=16000,
        callback=audio_callback
    ):
        time.sleep(10)
    
    print("Test complete!")

if __name__ == "__main__":
    print("BlackHole Audio Test")
    print("===================")
    list_devices()
    print()
    test_blackhole()
