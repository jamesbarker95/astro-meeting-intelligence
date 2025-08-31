#!/usr/bin/env python3
"""Test script to verify Python setup for Astro transcription service."""

import sys
import importlib

def test_imports():
    """Test that all required modules can be imported."""
    required_modules = [
        'sounddevice',
        'numpy', 
        'deepgram',
        'asyncio'
    ]
    
    print("Testing Python module imports...")
    
    for module in required_modules:
        try:
            importlib.import_module(module)
            print(f"✅ {module} - OK")
        except ImportError as e:
            print(f"❌ {module} - FAILED: {e}")
            return False
    
    return True

def test_audio_devices():
    """Test that audio devices can be detected."""
    try:
        import sounddevice as sd
        
        print("\nTesting audio device detection...")
        devices = sd.query_devices()
        
        print(f"Found {len(devices)} audio devices:")
        input_devices = []
        for i, device in enumerate(devices):
            # Check if device has input channels
            max_input_channels = device.get('max_input_channels', 0)
            if max_input_channels > 0:
                print(f"  {i}: {device['name']} (inputs: {max_input_channels})")
                input_devices.append((i, device['name']))
        
        if not input_devices:
            print("⚠️ No input devices found")
            return False
        
        # Look for Astro device
        astro_device = None
        for i, device in enumerate(devices):
            device_name = device.get('name', '').lower()
            max_input_channels = device.get('max_input_channels', 0)
            if 'astro' in device_name and max_input_channels > 0:
                astro_device = (i, device['name'])
                break
        
        if astro_device:
            print(f"✅ Found Astro device: {astro_device[1]} (index {astro_device[0]})")
        else:
            print("⚠️ Astro device not found - will use default input device")
            print("   Available input devices:")
            for idx, name in input_devices:
                print(f"     {idx}: {name}")
        
        return True
        
    except Exception as e:
        print(f"❌ Audio device test failed: {e}")
        return False

def test_deepgram_connection():
    """Test Deepgram API connection."""
    try:
        from deepgram import DeepgramClient
        
        print("\nTesting Deepgram connection...")
        
        # Test with a dummy API key (this will fail but we can test the import)
        client = DeepgramClient("test_key")
        print("✅ Deepgram client created successfully")
        
        return True
        
    except Exception as e:
        print(f"❌ Deepgram test failed: {e}")
        return False

def main():
    """Run all tests."""
    print("🧪 Astro Python Setup Test")
    print("=" * 40)
    
    tests = [
        ("Module Imports", test_imports),
        ("Audio Devices", test_audio_devices),
        ("Deepgram Client", test_deepgram_connection)
    ]
    
    passed = 0
    total = len(tests)
    
    for test_name, test_func in tests:
        print(f"\n📋 {test_name}")
        print("-" * 20)
        
        try:
            if test_func():
                passed += 1
                print(f"✅ {test_name} - PASSED")
            else:
                print(f"❌ {test_name} - FAILED")
        except Exception as e:
            print(f"❌ {test_name} - ERROR: {e}")
    
    print(f"\n📊 Test Results: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All tests passed! Python setup is ready.")
        return 0
    else:
        print("⚠️ Some tests failed. Please check the setup.")
        return 1

if __name__ == "__main__":
    sys.exit(main())
