# Python Audio Transcription Setup

This document explains the new Python-based audio transcription system for the Astro Electron app.

## 🎯 Overview

We've moved from browser-based audio capture to a Python-based solution to solve stability issues and improve performance. The new architecture:

- **Python scripts** handle all audio capture and Deepgram transcription
- **Electron main process** manages the Python subprocess
- **Electron renderer** only handles UI display
- **No more renderer crashes** from audio processing

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Electron      │    │   Python        │    │   Deepgram      │
│   Renderer      │    │   Transcription │    │   API           │
│   (UI Only)     │◄──►│   Service       │◄──►│   (Cloud)       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │
         │                       │
         ▼                       ▼
┌─────────────────┐    ┌─────────────────┐
│   Electron      │    │   Audio         │
│   Main Process  │    │   Hardware      │
│   (Manager)     │    │   (Microphone)  │
└─────────────────┘    └─────────────────┘
```

## 📁 File Structure

```
electron-app/
├── src/
│   ├── main/
│   │   ├── python-manager.ts      # Manages Python subprocess
│   │   └── ...
│   ├── python/
│   │   ├── audio_capture.py       # Audio capture using sounddevice
│   │   ├── deepgram_transcription.py  # Deepgram integration
│   │   ├── transcription_service.py   # Main service script
│   │   ├── test_setup.py          # Setup verification
│   │   ├── requirements.txt       # Python dependencies
│   │   └── venv/                  # Virtual environment
│   └── renderer/
│       └── renderer.js            # Simplified UI only
├── setup-python.sh                # Setup script
└── PYTHON_SETUP.md               # This file
```

## 🚀 Setup Instructions

### 1. Install Python Dependencies

```bash
# Run the setup script
npm run setup:python
```

This script will:
- Check for Python 3 installation
- Create a virtual environment
- Install required packages:
  - `sounddevice` - Audio capture
  - `numpy` - Audio processing
  - `deepgram-sdk` - Deepgram API
  - `asyncio-mqtt` - Async support

### 2. Test the Setup

```bash
# Test Python setup
npm run test:python
```

This will verify:
- All modules can be imported
- Audio devices are detected
- Deepgram client can be created

### 3. Configure Audio

1. **Install BlackHole** (if not already installed):
   ```bash
   brew install blackhole-2ch
   ```

2. **Create Multi-Output Device**:
   - Open Audio MIDI Setup
   - Create a Multi-Output Device named "Astro"
   - Include your speakers/headphones and BlackHole 2ch
   - Set BlackHole 2ch as the input device

3. **Set System Audio**:
   - System Preferences → Sound → Output
   - Select "Astro" as the output device

## 🔧 How It Works

### 1. Audio Capture (`audio_capture.py`)
- Uses `sounddevice` library for native audio capture
- Captures from the "Astro" multi-output device
- Converts audio to 16-bit PCM format
- Queues audio chunks for processing

### 2. Deepgram Integration (`deepgram_transcription.py`)
- Connects to Deepgram's live transcription API
- Streams audio data in real-time
- Receives and formats transcript responses
- Outputs transcripts to stdout for Electron

### 3. Service Management (`transcription_service.py`)
- Main entry point for the Python service
- Handles initialization and lifecycle
- Manages audio capture and transcription
- Communicates with Electron via JSON messages

### 4. Electron Integration (`python-manager.ts`)
- Spawns and manages Python subprocess
- Handles communication via stdin/stdout
- Forwards transcripts to renderer
- Manages service lifecycle

## 📡 Communication Protocol

### Python → Electron (stdout)
```json
// Status messages
{"type": "status", "status": "initialized", "message": "Service ready"}

// Transcript lines
FINAL:[14:30:25] Hello world
INTERIM:[14:30:26] How are you

// Error messages
{"type": "error", "error": "Connection failed", "message": "Service error"}
```

### Electron → Python (stdin)
```
start    # Start transcription
stop     # Stop transcription
status   # Get current status
```

## 🎯 Benefits

### ✅ Stability
- **No renderer crashes** - Audio processing isolated in Python
- **Better error handling** - Python's robust exception handling
- **Process isolation** - Audio failures don't affect UI

### ✅ Performance
- **Native audio processing** - No browser overhead
- **Lower latency** - Direct hardware access
- **Better resource usage** - Efficient audio libraries

### ✅ Maintainability
- **Clear separation** - Audio vs UI concerns
- **Easier debugging** - Can test Python independently
- **Better testing** - Modular components

## 🐛 Troubleshooting

### Common Issues

1. **Python not found**:
   ```bash
   # Install Python 3
   brew install python3
   ```

2. **Audio device not found**:
   - Check Audio MIDI Setup
   - Verify "Astro" device exists
   - Ensure BlackHole is installed

3. **Deepgram connection fails**:
   - Verify API key is correct
   - Check internet connection
   - Ensure Deepgram account is active

4. **Permission denied**:
   - Grant microphone permissions to Terminal/Electron
   - Check system audio permissions

### Debug Commands

```bash
# Test audio devices
cd src/python && source venv/bin/activate && python -c "import sounddevice as sd; print(sd.query_devices())"

# Test Deepgram connection
cd src/python && source venv/bin/activate && python -c "from deepgram import DeepgramClient; print('Deepgram import OK')"

# Run transcription test
cd src/python && source venv/bin/activate && python transcription_service.py --api-key YOUR_KEY --test
```

## 🔄 Migration from Old System

The old browser-based audio capture has been completely replaced. Key changes:

1. **Removed from renderer.js**:
   - Web Audio API code
   - Audio context management
   - Script processor nodes
   - Audio stream handling

2. **Updated main.ts**:
   - Replaced `AudioManager` with `PythonManager`
   - Removed audio chunk IPC handlers
   - Updated event forwarding

3. **Simplified preload.ts**:
   - Removed `sendAudioChunk` method
   - Kept basic audio control methods

## 📈 Next Steps

1. **Test the new system** with real audio
2. **Monitor performance** and stability
3. **Add error recovery** for Python process crashes
4. **Consider bundling** Python with the Electron app
5. **Add logging** for better debugging

## 🤝 Contributing

When working with the Python components:

1. **Always use the virtual environment**:
   ```bash
   source src/python/venv/bin/activate
   ```

2. **Test changes** with the test script:
   ```bash
   npm run test:python
   ```

3. **Update requirements.txt** if adding dependencies:
   ```bash
   pip freeze > requirements.txt
   ```

4. **Document changes** in this file
