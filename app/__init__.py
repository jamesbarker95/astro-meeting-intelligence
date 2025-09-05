from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO
import structlog
import uuid
from datetime import datetime
import os

# Configure structured logging
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer()
    ],
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    wrapper_class=structlog.stdlib.BoundLogger,
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()

# Shared session storage (in production, use a database)
# This will be imported by both WebSocket handlers and REST API
sessions = {}

def create_app():
    app = Flask(__name__)
    
    # Configure CORS
    CORS(app, resources={r"/api/*": {"origins": "*"}})
    
    # Configure Flask-SocketIO
    socketio = SocketIO(app, cors_allowed_origins="*", logger=False, engineio_logger=False)
    
    # Register blueprints
    from .api.sessions import sessions_bp
    from .api.auth import auth_bp
    from .api.insights import insights_bp
    # from .api.audio import audio_bp  # REMOVED - audio processing moved to desktop app
    
    app.register_blueprint(sessions_bp, url_prefix='/api/sessions')
    app.register_blueprint(auth_bp, url_prefix='/api/auth')
    app.register_blueprint(insights_bp, url_prefix='/api/insights')
    # app.register_blueprint(audio_bp, url_prefix='/api/audio')  # REMOVED
    
    @app.route('/')
    def config():
        return render_template('config.html')
    
    @app.route('/sessions')
    def sessions_page():
        return render_template('sessions.html')
    
    @app.route('/sessions/<session_id>')
    def session_detail(session_id):
        """Display detailed view of a specific session"""
        try:
            if session_id not in sessions:
                return render_template('session_detail.html', 
                                     session={'session_id': session_id, 'status': 'not_found', 'transcripts': []})
            
            session = sessions[session_id]
            return render_template('session_detail.html', session=session)
        except Exception as e:
            logger.error("Error loading session detail", error=str(e), session_id=session_id)
            return render_template('session_detail.html', 
                                 session={'session_id': session_id, 'status': 'error', 'transcripts': []})
    
    @app.route('/processing')
    def session_processing():
        return render_template('session_processing.html')
    
    @app.route('/live-sessions')
    def live_sessions():
        """Live sessions dashboard with real-time updates"""
        return render_template('live_sessions.html')
    
    @app.route('/live-sessions/<session_id>')
    def live_session_detail(session_id):
        """Live session detail with real-time transcript streaming"""
        try:
            if session_id not in sessions:
                # Create a placeholder session for live viewing
                session = {
                    'session_id': session_id, 
                    'status': 'not_found', 
                    'transcripts': [],
                    'transcript_count': 0,
                    'word_count': 0,
                    'created_at': datetime.now().isoformat()
                }
            else:
                session = sessions[session_id]
            
            return render_template('live_session_detail.html', session=session)
        except Exception as e:
            logger.error("Error loading live session detail", error=str(e), session_id=session_id)
            return render_template('live_session_detail.html', 
                                 session={'session_id': session_id, 'status': 'error', 'transcripts': []})
    
    @app.route('/config', methods=['POST'])
    def save_config():
        try:
            data = request.get_json()
            logger.info("Configuration received", config_keys=list(data.keys()))
            # In a real app, you'd save this to a database
            return jsonify({"status": "success", "message": "Configuration saved"})
        except Exception as e:
            logger.error("Error saving configuration", error=str(e))
            return jsonify({"status": "error", "message": str(e)}), 500
    
    @app.route('/success')
    def success():
        return render_template('success.html')
    
    @app.route('/download')
    def download():
        return render_template('download.html')
    
    @app.route('/api/docs')
    def api_docs():
        return jsonify({
            "message": "Astro API Documentation",
            "endpoints": {
                "auth": {
                    "POST /api/auth/tokens": "Store user tokens",
                    "GET /api/auth/tokens/<session_id>": "Get user tokens",
                    "DELETE /api/auth/tokens/<session_id>": "Delete user tokens",
                    "GET /api/auth/validate/<session_id>": "Validate user tokens"
                },
                "sessions": {
                    "GET /api/sessions": "Get all sessions",
                    "POST /api/sessions": "Create new session",
                    "GET /api/sessions/<session_id>": "Get session details",
                    "PUT /api/sessions/<session_id>/start": "Start session",
                    "PUT /api/sessions/<session_id>/end": "End session",
                    "DELETE /api/sessions/<session_id>": "Delete session"
                },
                "audio": {
                    "POST /api/audio/transcribe": "Transcribe audio chunk",
                    "GET /api/audio/status": "Get audio streaming status"
                },
                "insights": {
                    "POST /api/insights/summary": "Generate meeting summary",
                    "POST /api/insights/relevance": "Check transcript relevance",
                    "POST /api/insights/actionable": "Generate actionable insights",
                    "POST /api/insights/slack": "Send insights to Slack"
                }
            }
        })
    
    @app.route('/health')
    def health():
        return jsonify({
            "status": "healthy",
            "service": "astro-backend",
            "version": "1.0.0"
        })
    
    # AssemblyAI transcription now handled in Electron desktop app
    # Backend will receive transcripts via WebSocket instead of raw audio
    
    # Register WebSocket event handlers from socket service
    from .services.socket_service import register_socket_events
    register_socket_events(socketio)

    
    return app

# Create the app instance for gunicorn
app = create_app()
socketio = None  # Will be initialized when needed
