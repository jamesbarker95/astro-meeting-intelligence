# 🚀 Astro - AI Meeting Assistant (Proof of Concept)

⚠️ **IMPORTANT: This is a Proof of Concept with hardcoded credentials**

## 🎯 Overview

Astro is an AI-powered meeting assistant that provides real-time transcription and intelligent insights during meetings. This POC demonstrates:

- **Real-time Speech-to-Text** using AssemblyAI
- **Dual Audio Capture** (system audio + microphone via BlackHole)
- **AI-Powered Insights** using Salesforce Models API and Agent API
- **Modern Electron UI** with transparent overlays and progressive transcript display
- **OAuth Integration** with Salesforce and Slack
- **WebSocket Communication** between Electron app and Heroku backend

## 🏗️ Architecture

```
┌─────────────────┐    WebSocket    ┌──────────────────┐
│   Electron App  │ ◄──────────────► │  Heroku Backend  │
│                 │                  │                  │
│ • Audio Capture │                  │ • Session Mgmt   │
│ • UI Overlays   │                  │ • AI Processing  │
│ • OAuth         │                  │ • WebSocket Hub  │
└─────────────────┘                  └──────────────────┘
         │                                     │
         ▼                                     ▼
┌─────────────────┐                  ┌──────────────────┐
│   AssemblyAI    │                  │ Salesforce APIs  │
│ Real-time STT   │                  │ • Models API     │
└─────────────────┘                  │ • Agent API      │
                                     └──────────────────┘
```

## 🚨 Security Notice

**This POC contains hardcoded API credentials for rapid development:**
- Salesforce Client IDs/Secrets
- Slack API Keys
- AssemblyAI API Key
- Deepgram API Key (legacy)

**Do not use in production!** Credentials should be externalized before production deployment.

## 🛠️ Setup & Installation

### Prerequisites
- Node.js 18+
- Python 3.8+
- macOS (for audio capture via BlackHole)
- BlackHole 2ch virtual audio device

### Electron App Setup
```bash
cd electron-app
npm install
npm run build
npm start
```

### Heroku Backend Setup
```bash
cd heroku-backend
pip install -r requirements.txt
python -m flask run
```

## 🎵 Audio Setup (macOS)

1. Install BlackHole 2ch from [existential.audio](https://existential.audio/blackhole/)
2. Create Multi-Output Device in Audio MIDI Setup:
   - Add BlackHole 2ch
   - Add your speakers/headphones
3. Set system output to "Astro-Meeting (Aggregate)" device
4. Grant microphone permissions to the app

## ✨ Key Features

### Real-time Transcription
- Captures both system audio and microphone
- Progressive transcript display (interim → final)
- Millisecond-accurate timestamps

### AI Insights
- Relevancy filtering via Salesforce Models API
- Intelligent responses via Salesforce Agent API
- Real-time notifications for new insights

### Modern UI
- Transparent overlay system
- Material Design icons
- Progressive transcript rendering
- Search functionality for direct AI queries

### Session Management
- Start/stop sessions with calendar integration
- Microphone toggle during sessions
- Session state persistence

## 🔧 Development

### Building
```bash
cd electron-app
npm run build
```

### Packaging
```bash
npm run dist
```

Creates DMG file in `electron-app/dist/`

## 📝 Current Status

✅ **Completed:**
- Real-time audio capture and transcription
- AI insights pipeline
- Modern transparent UI
- Session management
- OAuth authentication
- WebSocket communication

🚧 **POC Limitations:**
- Hardcoded credentials
- No error recovery
- Limited testing
- macOS only

## 🚀 Next Steps (Post-POC)

1. **Security**: Externalize all credentials
2. **Error Handling**: Add comprehensive error recovery
3. **Testing**: Unit and integration tests
4. **Cross-platform**: Windows/Linux support
5. **Performance**: Optimize for longer meetings
6. **Deployment**: Production-ready deployment pipeline

---

**Built with:** Electron, TypeScript, Python, Flask, WebSockets, AssemblyAI, Salesforce APIs