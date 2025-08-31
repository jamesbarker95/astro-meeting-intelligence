#!/usr/bin/env python3
"""
Test Deepgram SDK with live transcription
"""
import os
import time
import threading
from deepgram import (
    DeepgramClient,
    DeepgramClientOptions,
    LiveTranscriptionEvents,
    LiveOptions,
)

# Set API key
os.environ["DEEPGRAM_API_KEY"] = "547f2a8ba13eab840e01d9f8cf1bb5dc8d1bf259"

def main():
    try:
        print("🚀 Testing Deepgram SDK...")
        
        # Create Deepgram client
        deepgram = DeepgramClient()
        
        # Create WebSocket connection
        dg_connection = deepgram.listen.websocket.v("1")
        
        def on_message(self, result, **kwargs):
            sentence = result.channel.alternatives[0].transcript
            if len(sentence) == 0:
                return
            print(f"🎯 TRANSCRIPT: '{sentence}'")
            print(f"📊 Confidence: {result.channel.alternatives[0].confidence}")
            print(f"🔄 Is Final: {result.is_final}")
        
        def on_metadata(self, metadata, **kwargs):
            print(f"📝 METADATA: {metadata}")
        
        def on_speech_started(self, speech_started, **kwargs):
            print("🎤 SPEECH STARTED")
        
        def on_utterance_end(self, utterance_end, **kwargs):
            print("🛑 UTTERANCE END")
        
        def on_close(self, close, **kwargs):
            print("🔌 CONNECTION CLOSED")
        
        def on_error(self, error, **kwargs):
            print(f"❌ ERROR: {error}")
        
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
        
        print("🔗 Starting connection...")
        if dg_connection.start(options) is False:
            print("❌ Failed to start connection")
            return
        
        print("✅ Connected! Sending test audio...")
        
        # Send some dummy audio data (silence)
        def send_test_audio():
            for i in range(5):
                time.sleep(1)
                # Send 1 second of silence (16kHz, 16-bit, mono)
                silence = b'\x00' * (16000 * 2)  # 1 second of 16-bit silence
                dg_connection.send(silence)
                print(f"📤 Sent test audio chunk {i+1}/5")
        
        # Start sending audio in background
        audio_thread = threading.Thread(target=send_test_audio)
        audio_thread.start()
        
        # Wait for audio thread to finish
        audio_thread.join()
        
        print("⏳ Waiting for final results...")
        time.sleep(2)
        
        # Finish connection
        dg_connection.finish()
        print("✅ Test completed!")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
