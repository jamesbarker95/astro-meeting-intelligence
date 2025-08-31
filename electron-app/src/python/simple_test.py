#!/usr/bin/env python3
"""Simple test script for Deepgram connection."""

import sys
import time
from deepgram import DeepgramClient, LiveTranscriptionEvents, LiveOptions

def main():
    try:
        print("Testing Deepgram connection...")
        
        # Create Deepgram client
        api_key = "547f2a8ba13eab840e01d9f8cf1bb5dc8d1bf259"
        deepgram = DeepgramClient(api_key)
        
        # Create websocket connection
        dg_connection = deepgram.listen.websocket.v("1")
        
        def on_message(result, **kwargs):
            sentence = result.channel.alternatives[0].transcript
            if len(sentence) == 0:
                return
            print(f"Transcript: {sentence}")
        
        def on_open(connection, event, **kwargs):
            print("Connection opened!")
        
        def on_close(connection, event, **kwargs):
            print("Connection closed!")
        
        def on_error(connection, error, **kwargs):
            print(f"Connection error: {error}")
        
        # Set up event handlers
        dg_connection.on(LiveTranscriptionEvents.Transcript, on_message)
        dg_connection.on(LiveTranscriptionEvents.Open, on_open)
        dg_connection.on(LiveTranscriptionEvents.Close, on_close)
        dg_connection.on(LiveTranscriptionEvents.Error, on_error)
        
        # Configure options
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
        
        print("Starting connection...")
        if dg_connection.start(options) is False:
            print("Failed to start connection")
            return
        
        print("Connection started successfully!")
        print("Waiting 5 seconds...")
        time.sleep(5)
        
        print("Finishing connection...")
        dg_connection.finish()
        print("Test completed!")
        
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
