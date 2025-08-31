# Astro Heroku Backend

The backend service for Astro, a real-time meeting intelligence platform. This Flask application handles session management, audio processing, insights generation, and WebSocket communication.

## Architecture

- **Flask Web Server**: RESTful API endpoints and WebSocket support
- **Session Management**: Track meeting sessions and user authentication
- **Audio Processing**: Real-time transcription via Deepgram
- **Insights Generation**: Salesforce Models API and Agent API integration
- **Slack Integration**: Post insights and meeting summaries to Slack channels

## Features

- ✅ Session creation and management
- ✅ User token storage and validation
- ✅ Real-time audio transcription
- ✅ Meeting insights generation
- ✅ Slack integration
- ✅ WebSocket communication
- ✅ Configuration web interface
- ✅ API documentation

## Quick Start

### Prerequisites

- Python 3.9+
- Heroku CLI (for deployment)
- API keys for:
  - Deepgram (transcription)
  - Salesforce (Models API, Agent API)
  - Slack (messaging)

### Local Development

1. **Clone and setup**:
   ```bash
   cd heroku-backend
   pip install -r requirements.txt
   ```

2. **Configure environment**:
   ```bash
   cp env.example .env
   # Edit .env with your API keys
   ```

3. **Run the server**:
   ```bash
   python app/__init__.py
   ```

4. **Test the backend**:
   ```bash
   python test_backend.py
   ```

### Heroku Deployment

1. **Create Heroku app**:
   ```bash
   heroku create astro-meetings
   ```

2. **Set environment variables**:
   ```bash
   heroku config:set DEEPGRAM_API_KEY=your_deepgram_key
   heroku config:set SECRET_KEY=your_secret_key
   ```

3. **Deploy**:
   ```bash
   git add .
   git commit -m "Initial deployment"
   git push heroku main
   ```

## API Endpoints

### Authentication
- `POST /api/auth/tokens` - Store user OAuth tokens
- `GET /api/auth/tokens/<session_id>` - Get stored user tokens
- `DELETE /api/auth/tokens/<session_id>` - Clear stored user tokens
- `GET /api/auth/validate/<session_id>` - Validate session tokens

### Sessions
- `POST /api/sessions/create` - Create new meeting session
- `POST /api/sessions/<session_id>/start` - Start meeting session
- `POST /api/sessions/<session_id>/end` - End meeting session
- `GET /api/sessions/<session_id>` - Get session details
- `POST /api/sessions/<session_id>/transcript` - Add transcript line
- `GET /api/sessions/active` - List active sessions
- `GET /api/sessions/all` - List all sessions

### Audio
- `POST /api/audio/transcribe` - Transcribe audio chunk
- `POST /api/audio/stream/start` - Start audio stream
- `POST /api/audio/stream/stop` - Stop audio stream
- `GET /api/audio/test` - Test audio configuration

### Insights
- `POST /api/insights/models/summary` - Generate meeting summary
- `POST /api/insights/models/relevance` - Check transcript relevance
- `POST /api/insights/agent/insight` - Generate actionable insight
- `POST /api/insights/slack/post` - Post to Slack channel

### Web Interface
- `GET /` - Configuration page
- `GET /config` - Configuration form
- `GET /download` - Download page
- `GET /health` - Health check
- `GET /api/docs` - API documentation

## WebSocket Events

### Client to Server
- `connect` - Client connection
- `join_session` - Join session room
- `leave_session` - Leave session room
- `audio_chunk` - Send audio chunk
- `transcript_line` - Send transcript line
- `insight_generated` - Receive generated insight
- `session_status` - Session status update

### Server to Client
- `connected` - Connection confirmation
- `joined_session` - Session join confirmation
- `left_session` - Session leave confirmation
- `audio_processing` - Audio processing status
- `transcript_update` - New transcript line
- `insight_update` - New insight generated
- `session_status_update` - Session status change
- `error` - Error message

## Configuration

### Environment Variables

```bash
# Flask Configuration
FLASK_ENV=development
SECRET_KEY=your-secret-key-here
PORT=5000

# Deepgram API Configuration
DEEPGRAM_API_KEY=your_deepgram_api_key

# Heroku Configuration
HEROKU_APP_NAME=astro-meetings

# Database Configuration (for production)
DATABASE_URL=postgresql://username:password@host:port/database

# Redis Configuration (for production)
REDIS_URL=redis://username:password@host:port

# Logging Configuration
LOG_LEVEL=INFO
```

### User Configuration Flow

1. **User visits web interface** at `https://astro-meetings.herokuapp.com`
2. **Inputs their API credentials**:
   - Salesforce Client ID/Secret
   - Slack Client ID/Secret
   - Deepgram API Key
   - Default Slack Channel
3. **Downloads customized desktop app** with their credentials embedded
4. **Desktop app handles OAuth** with Salesforce and Slack
5. **Desktop app connects to backend** with user tokens

## Development

### Project Structure

```
heroku-backend/
├── app/
│   ├── __init__.py          # Main Flask app
│   ├── api/
│   │   ├── auth.py          # Token management
│   │   ├── sessions.py      # Session management
│   │   ├── audio.py         # Audio processing
│   │   └── insights.py      # Insights generation
│   ├── services/
│   │   └── socket_service.py # WebSocket events
│   ├── models/              # Data models (future)
│   └── utils/               # Utilities (future)
├── templates/
│   ├── config.html          # Configuration interface
│   ├── success.html         # Success page
│   └── download.html        # Download page
├── tests/                   # Test files
├── requirements.txt         # Python dependencies
├── Procfile                # Heroku deployment
├── env.example             # Environment template
├── test_backend.py         # Test script
└── README.md               # This file
```

### Running Tests

```bash
# Run the test script
python test_backend.py

# Or test individual endpoints
curl http://localhost:5000/health
curl http://localhost:5000/api/docs
```

### Adding New Features

1. **Create new API endpoint** in `app/api/`
2. **Add WebSocket events** in `app/services/socket_service.py`
3. **Update API documentation** in `app/__init__.py`
4. **Add tests** in `test_backend.py`

## Production Considerations

### Security
- Use HTTPS in production
- Implement proper session management
- Store tokens securely (Redis/database)
- Add rate limiting
- Implement API authentication

### Scalability
- Use Redis for session storage
- Add database for persistent data
- Implement connection pooling
- Add monitoring and logging

### Monitoring
- Add health checks
- Implement error tracking (Sentry)
- Add performance monitoring
- Set up alerting

## Troubleshooting

### Common Issues

1. **Import errors**: Make sure all dependencies are installed
2. **Port conflicts**: Change PORT environment variable
3. **CORS issues**: Check CORS configuration in `app/__init__.py`
4. **WebSocket connection**: Verify SocketIO configuration

### Debug Mode

```bash
export FLASK_ENV=development
export FLASK_DEBUG=1
python app/__init__.py
```

### Logs

```bash
# Local logs
tail -f logs/app.log

# Heroku logs
heroku logs --tail
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT License - see LICENSE file for details
