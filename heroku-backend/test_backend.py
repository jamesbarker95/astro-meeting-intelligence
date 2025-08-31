#!/usr/bin/env python3
"""
Test script for Astro Heroku Backend
Run this to verify all endpoints are working correctly
"""

import requests
import json
import uuid

# Configuration
BASE_URL = "http://localhost:5000"  # Change to your Heroku URL when deployed
TEST_SESSION_ID = str(uuid.uuid4())

def test_health_check():
    """Test health check endpoint"""
    print("🔍 Testing health check...")
    response = requests.get(f"{BASE_URL}/health")
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")
    print()

def test_api_docs():
    """Test API documentation endpoint"""
    print("📚 Testing API docs...")
    response = requests.get(f"{BASE_URL}/api/docs")
    print(f"Status: {response.status_code}")
    print(f"Available endpoints: {list(response.json()['endpoints'].keys())}")
    print()

def test_session_creation():
    """Test session creation"""
    print("📝 Testing session creation...")
    data = {
        "type": "manual",
        "meeting_info": {
            "title": "Test Meeting",
            "participants": ["user1", "user2"]
        }
    }
    response = requests.post(f"{BASE_URL}/api/sessions/create", json=data)
    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        result = response.json()
        print(f"Session created: {result['session_id']}")
        return result['session_id']
    else:
        print(f"Error: {response.json()}")
        return None
    print()

def test_token_storage(session_id):
    """Test token storage"""
    print("🔐 Testing token storage...")
    data = {
        "session_id": session_id,
        "salesforce_tokens": {
            "access_token": "test_salesforce_token",
            "instance_url": "https://test.salesforce.com",
            "refresh_token": "test_refresh_token"
        },
        "slack_tokens": {
            "access_token": "test_slack_token",
            "team": {"name": "Test Team"},
            "bot_user_id": "test_bot_id"
        }
    }
    response = requests.post(f"{BASE_URL}/api/auth/tokens", json=data)
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")
    print()

def test_token_validation(session_id):
    """Test token validation"""
    print("✅ Testing token validation...")
    response = requests.get(f"{BASE_URL}/api/auth/validate/{session_id}")
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")
    print()

def test_session_start(session_id):
    """Test session start"""
    print("▶️ Testing session start...")
    response = requests.post(f"{BASE_URL}/api/sessions/{session_id}/start")
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")
    print()

def test_transcript_addition(session_id):
    """Test transcript addition"""
    print("📝 Testing transcript addition...")
    data = {
        "text": "Hello, this is a test transcript line.",
        "speaker": "Test Speaker",
        "confidence": 0.95
    }
    response = requests.post(f"{BASE_URL}/api/sessions/{session_id}/transcript", json=data)
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")
    print()

def test_audio_configuration():
    """Test audio configuration"""
    print("🎵 Testing audio configuration...")
    response = requests.get(f"{BASE_URL}/api/audio/test")
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")
    print()

def test_session_listing():
    """Test session listing"""
    print("📋 Testing session listing...")
    response = requests.get(f"{BASE_URL}/api/sessions/all")
    print(f"Status: {response.status_code}")
    result = response.json()
    print(f"Total sessions: {result['count']}")
    if result['sessions']:
        print(f"Latest session: {result['sessions'][-1]['id']}")
    print()

def main():
    """Run all tests"""
    print("🚀 Starting Astro Backend Tests")
    print("=" * 50)
    
    try:
        test_health_check()
        test_api_docs()
        test_audio_configuration()
        
        session_id = test_session_creation()
        if session_id:
            test_token_storage(session_id)
            test_token_validation(session_id)
            test_session_start(session_id)
            test_transcript_addition(session_id)
        
        test_session_listing()
        
        print("✅ All tests completed!")
        
    except requests.exceptions.ConnectionError:
        print("❌ Connection failed. Make sure the backend is running on localhost:5000")
    except Exception as e:
        print(f"❌ Test failed with error: {e}")

if __name__ == "__main__":
    main()
