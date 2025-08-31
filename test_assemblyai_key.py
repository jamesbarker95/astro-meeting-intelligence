#!/usr/bin/env python3
"""
Test script to verify AssemblyAI API key validity
"""
import requests
import json

# The API key from your code
API_KEY = "adec0151627147e9813c8da9cf7bcb4d"

def test_api_key():
    """Test the AssemblyAI API key by making a simple request"""
    print("🔑 Testing AssemblyAI API Key...")
    print(f"   Key: {API_KEY[:8]}...")
    
    # Test with a simple transcript endpoint
    url = "https://api.assemblyai.com/v2/transcript"
    headers = {
        "Authorization": API_KEY,
        "Content-Type": "application/json"
    }
    
    # Make a simple GET request to check authentication
    try:
        print("📡 Making test request to AssemblyAI...")
        response = requests.get(url, headers=headers, timeout=10)
        
        print(f"📊 Response Status: {response.status_code}")
        print(f"📊 Response Headers: {dict(response.headers)}")
        
        if response.status_code == 200:
            print("✅ API Key is VALID - Authentication successful!")
            data = response.json()
            print(f"📄 Response data: {json.dumps(data, indent=2)}")
        elif response.status_code == 401:
            print("❌ API Key is INVALID - Authentication failed!")
            print(f"📄 Error response: {response.text}")
        elif response.status_code == 403:
            print("❌ API Key is valid but lacks permissions!")
            print(f"📄 Error response: {response.text}")
        else:
            print(f"⚠️ Unexpected response: {response.status_code}")
            print(f"📄 Response: {response.text}")
            
    except requests.exceptions.RequestException as e:
        print(f"❌ Network error: {e}")
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return False

def test_streaming_endpoint():
    """Test the streaming WebSocket endpoint URL"""
    print("\n🌐 Testing AssemblyAI Streaming Endpoint...")
    
    # This is the endpoint your code uses
    streaming_url = "wss://streaming.assemblyai.com/v3/ws"
    print(f"   Endpoint: {streaming_url}")
    
    # We can't easily test WebSocket from here, but we can check if the domain resolves
    import socket
    try:
        host = "streaming.assemblyai.com"
        print(f"🔍 Resolving hostname: {host}")
        ip = socket.gethostbyname(host)
        print(f"✅ Hostname resolves to: {ip}")
        
        # Try to connect to port 443 (WSS uses HTTPS port)
        print(f"🔌 Testing connection to {host}:443...")
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5)
        result = sock.connect_ex((host, 443))
        sock.close()
        
        if result == 0:
            print("✅ Can connect to streaming endpoint!")
        else:
            print(f"❌ Cannot connect to streaming endpoint (error: {result})")
            
    except Exception as e:
        print(f"❌ Error testing streaming endpoint: {e}")

if __name__ == "__main__":
    print("🧪 AssemblyAI API Key Test")
    print("=" * 40)
    
    test_api_key()
    test_streaming_endpoint()
    
    print("\n" + "=" * 40)
    print("🏁 Test completed!")
