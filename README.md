# Astro - Real-Time Meeting Intelligence Platform

**v1.0.0: OAuth + Session Management** 🚀

Astro is a comprehensive meeting assistant that captures audio, transcribes it in real-time, generates insights, and distributes them through desktop overlays and Slack channels.

## 🎯 Current Status (v1.0.0)

**✅ Working Features:**
- OAuth 2.0 authentication for Salesforce and Slack
- Session creation and management with Heroku backend
- Real-time WebSocket communication
- Desktop Electron app with secure token storage
- Session dashboard on Heroku backend

**🔄 Coming Soon:**
- Real-time audio capture and transcription
- Meeting insights generation
- Desktop overlay functionality
- Slack integration for insights distribution

## 🏗️ Architecture

- **Electron Desktop App**: User interface, OAuth flows, session management
- **Heroku Backend**: WebSocket server, API orchestration, session management
- **External APIs**: Salesforce (OAuth, data, models), Slack (OAuth, messaging)

## 📁 Project Structure

```
astro-project/
├── electron-app/          # Electron desktop application
│   ├── src/
│   │   ├── main/         # Main process (auth, websocket, audio)
│   │   ├── renderer/     # Renderer process (UI)
│   │   └── shared/       # Shared utilities
│   ├── assets/           # Static assets
│   └── config/           # Configuration files
├── heroku-backend/       # Flask backend
│   ├── app/
│   │   ├── api/          # API endpoints (auth, sessions, insights)
│   │   ├── services/     # Business logic
│   │   ├── models/       # Data models
│   │   └── utils/        # Utilities
│   ├── templates/        # Web interface templates
│   └── config/           # Configuration
├── docs/                 # Documentation
└── scripts/              # Build and deployment scripts
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Python 3.9+
- Heroku account
- Salesforce developer account
- Slack app setup

### 1. Clone and Setup
```bash
git clone <your-repo-url>
cd astro-project
```

### 2. Electron App Setup
```bash
cd electron-app
npm install
npm run dist
```

### 3. Heroku Backend Setup
```bash
cd heroku-backend
# Deploy to Heroku (see deployment section)
```

### 4. Configure OAuth Apps
- Set up Salesforce Connected App
- Set up Slack App
- Update client IDs in the code (or use environment variables)

### 5. Launch
- Install the DMG from `electron-app/dist/`
- Launch Astro from Applications
- Authenticate with Salesforce and Slack
- Start a session!

## 🔧 Development

### Electron App Development
```bash
cd electron-app
npm run dev          # Start development mode
npm run build        # Build for production
npm run dist         # Create distributable
```

### Heroku Backend Development
```bash
cd heroku-backend
pip install -r requirements.txt
python -m flask run  # Local development
```

## 🌐 Deployment

### Heroku Backend
```bash
cd heroku-backend
heroku create your-app-name
git push heroku main
```

### Electron App
```bash
cd electron-app
npm run dist  # Creates DMG for macOS
```

## 🔐 Authentication Setup

### Salesforce Connected App
1. Go to Setup > App Manager > New Connected App
2. Enable OAuth Settings
3. Add callback URL: `https://localhost:3000/oauth/salesforce/callback`
4. Add scopes: `api`, `refresh_token`, `offline_access`

### Slack App
1. Create new app at api.slack.com
2. Add OAuth & Permissions
3. Add redirect URL: `https://localhost:3000/oauth/slack/callback`
4. Add scopes: `chat:write`, `channels:read`

## 📊 Session Management

Sessions are managed through the Heroku backend:
- Create sessions via Electron app
- View active sessions at `https://your-heroku-app.herokuapp.com/sessions`
- Real-time session status updates via WebSocket

## 🔧 Configuration

### Environment Variables (Optional)
The app includes default OAuth credentials for development. For production:

**Electron App:**
- `SALESFORCE_CLIENT_ID`
- `SALESFORCE_CLIENT_SECRET`
- `SLACK_CLIENT_ID`
- `SLACK_CLIENT_SECRET`
- `HEROKU_BACKEND_URL`

**Heroku Backend:**
- `SALESFORCE_CLIENT_ID`
- `SALESFORCE_CLIENT_SECRET`
- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET`

## 🐛 Troubleshooting

### Common Issues
1. **Keychain prompts**: Use the latest version (v1.0.0) which uses in-memory storage
2. **Button not working**: Ensure you're using the correct button IDs (`salesforce-btn`, `slack-btn`)
3. **Session not starting**: Check Heroku backend is running and accessible
4. **OAuth errors**: Verify callback URLs match your app settings

### Debug Mode
The Electron app opens DevTools by default. Check the console for detailed logs.

## 📝 License

MIT License

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

---

**v1.0.0** - OAuth + Session Management ✅  
**Next**: Audio Capture + Transcription 🎤
