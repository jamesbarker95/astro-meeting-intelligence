#!/usr/bin/env python3
"""
Simple Deepgram WebSocket test script
"""
import sys
import time
import threading
from websocket import WebSocketApp
import json

# Your Deepgram API key
API_KEY = "547f2a8ba13eab840e01d9f8cf1bb5dc8d1bf259"

# WebSocket URL with parameters
WS_URL = "wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000&channels=1&punctuate=true&interim_results=true"

# Headers for authentication
HEADERS = {"Authorization": f"Token {API_KEY}"}

def on_open(ws):
    print("✅ CONNECTED: Deepgram WebSocket connection established!")
    
    # Send a test message to keep connection alive
    def send_keepalive():
        time.sleep(2)
        print("📤 Sending keepalive...")
        # Send some dummy audio data (silence)
        dummy_audio = b'\x00' * 1024  # 1KB of silence
        ws.send(dummy_audio, opcode=2)  # opcode=2 for binary data
    
    # Start keepalive in background
    threading.Thread(target=send_keepalive, daemon=True).start()

def on_message(ws, message):
    try:
        response = json.loads(message)
        print(f"📝 RECEIVED: {json.dumps(response, indent=2)}")
        
        if response.get("type") == "Results":
            transcript = response.get("channel", {}).get("alternatives", [{}])[0].get("transcript", "")
            if transcript:
                print(f"🎯 TRANSCRIPT: '{transcript}'")
        
    except json.JSONDecodeError as e:
        print(f"❌ JSON Error: {e}")
        print(f"Raw message: {message}")

def on_error(ws, error):
    print(f"❌ ERROR: {error}")

def on_close(ws, close_status_code, close_msg):
    print(f"🔌 CLOSED: Code={close_status_code}, Message='{close_msg}'")

def main():
    print("🚀 Starting Deepgram WebSocket test...")
    print(f"🔗 Connecting to: {WS_URL}")
    print(f"🔑 Using API key: {API_KEY[:20]}...")
    
    # Create WebSocket connection
    ws = WebSocketApp(
        WS_URL,
        on_open=on_open,
        on_message=on_message,
        on_close=on_close,
        on_error=on_error,
        header=HEADERS
    )
    
    try:
        print("⏳ Running WebSocket (press Ctrl+C to stop)...")
        ws.run_forever()
    except KeyboardInterrupt:
        print("\n🛑 Interrupted by user")
        ws.close()
    except Exception as e:
        print(f"❌ Unexpected error: {e}")

if __name__ == "__main__":
    main()
