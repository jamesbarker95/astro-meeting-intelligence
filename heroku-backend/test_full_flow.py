#!/usr/bin/env python3
"""
Test the complete transcript storage flow
"""

import requests
import json

def create_session():
    """Create a new session"""
    url = "https://astro-meetings-918feccd1cb1.herokuapp.com/api/sessions/create"
    
    response = requests.post(url, json={
        "type": "manual",
        "meeting_info": {"title": "Test Session for Transcript Storage"}
    })
    
    if response.status_code == 200:
        data = response.json()
        session_id = data.get('session_id')
        print(f"✅ Session created: {session_id}")
        return session_id
    else:
        print(f"❌ Failed to create session: {response.status_code}")
        print(response.text)
        return None

def add_transcript(session_id, text, speaker="test_user"):
    """Add a transcript to the session"""
    url = f"https://astro-meetings-918feccd1cb1.herokuapp.com/api/sessions/{session_id}/transcript"
    
    response = requests.post(url, json={
        "text": text,
        "speaker": speaker,
        "confidence": 0.95
    })
    
    if response.status_code == 200:
        data = response.json()
        print(f"✅ Transcript added: '{text[:50]}...'")
        return True
    else:
        print(f"❌ Failed to add transcript: {response.status_code}")
        print(response.text)
        return False

def get_transcripts(session_id):
    """Get transcripts from the session"""
    url = f"https://astro-meetings-918feccd1cb1.herokuapp.com/api/sessions/{session_id}/transcripts"
    
    response = requests.get(url)
    
    if response.status_code == 200:
        data = response.json()
        transcripts = data.get('transcripts', {}).get('all', [])
        print(f"✅ Retrieved {len(transcripts)} transcripts")
        for i, t in enumerate(transcripts):
            print(f"  {i+1}. [{t.get('speaker', 'unknown')}] {t.get('transcript', 'N/A')}")
        return transcripts
    else:
        print(f"❌ Failed to get transcripts: {response.status_code}")
        print(response.text)
        return []

if __name__ == "__main__":
    print("🚀 Testing complete transcript storage flow...\n")
    
    # Step 1: Create session
    session_id = create_session()
    if not session_id:
        exit(1)
    
    print(f"\n📝 Session URL: https://astro-meetings-918feccd1cb1.herokuapp.com/sessions/{session_id}")
    
    # Step 2: Add some test transcripts
    test_transcripts = [
        "Hello, this is the first test transcript.",
        "This is the second transcript to verify the storage system.",
        "And here's a third one to make sure everything works correctly!"
    ]
    
    print(f"\n📝 Adding {len(test_transcripts)} test transcripts...")
    for i, text in enumerate(test_transcripts, 1):
        success = add_transcript(session_id, text, f"speaker_{i}")
        if not success:
            print(f"❌ Failed to add transcript {i}")
            break
    
    # Step 3: Retrieve and verify transcripts
    print(f"\n📊 Retrieving stored transcripts...")
    transcripts = get_transcripts(session_id)
    
    if transcripts:
        print(f"\n🎉 Success! {len(transcripts)} transcripts stored and retrieved.")
        print(f"🔗 View them at: https://astro-meetings-918feccd1cb1.herokuapp.com/sessions/{session_id}")
    else:
        print(f"\n❌ No transcripts found. Something went wrong.")
