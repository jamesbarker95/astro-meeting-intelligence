#!/usr/bin/env python3
"""
Script to manually add a test transcript to a session
"""

import requests
import json

def add_transcript_to_session(session_id, transcript_text, speaker="system", confidence=1.0, is_final=True):
    """Add a transcript to a session via the API"""
    
    # Heroku app URL
    base_url = "https://astro-meetings-918feccd1cb1.herokuapp.com"
    
    # Prepare the transcript data
    transcript_data = {
        "session_id": session_id,
        "transcript": transcript_text,
        "speaker": speaker,
        "confidence": confidence,
        "isFinal": is_final
    }
    
    print(f"🔄 Adding transcript to session {session_id}...")
    print(f"📝 Text: '{transcript_text}'")
    print(f"🎤 Speaker: {speaker}")
    print(f"📊 Confidence: {confidence}")
    print(f"✅ Final: {is_final}")
    
    try:
        # We'll use the WebSocket event simulation approach
        # Since we can't easily make WebSocket calls from a script,
        # let's make a direct API call to add the transcript
        
        url = f"{base_url}/api/sessions/{session_id}/transcript"
        
        response = requests.post(url, json={
            "text": transcript_text,
            "speaker": speaker,
            "confidence": confidence
        })
        
        if response.status_code == 200:
            result = response.json()
            print(f"✅ Success! Transcript added.")
            print(f"📊 New word count: {result.get('word_count', 'unknown')}")
            return True
        else:
            print(f"❌ Failed to add transcript: {response.status_code}")
            print(f"Response: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

if __name__ == "__main__":
    # Session ID from the user
    session_id = "2cf5b705-157d-4e04-b803-08bfb09cc4ec"
    
    # Test transcript
    transcript_text = "This is the second test transcript. It should appear in the transcripts array and be visible on the frontend!"
    
    success = add_transcript_to_session(
        session_id=session_id,
        transcript_text=transcript_text,
        speaker="test_user",
        confidence=0.95,
        is_final=True
    )
    
    if success:
        print(f"\n🎉 Done! Check the session page to see the new transcript:")
        print(f"🔗 https://astro-meetings-918feccd1cb1.herokuapp.com/sessions/{session_id}")
    else:
        print(f"\n❌ Failed to add transcript. Check the logs above.")
