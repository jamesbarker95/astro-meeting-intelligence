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
    socketio = SocketIO(app, cors_allowed_origins="*", logger=True, engineio_logger=True)
    
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
    
    # Initialize Deepgram service (REMOVED - now handled in desktop app)
    # from .services.deepgram_service import initialize_deepgram_service, get_deepgram_service
    # deepgram_api_key = os.environ.get('DEEPGRAM_API_KEY', '547f2a8ba13eab840e01d9f8cf1bb5dc8d1bf259')
    # initialize_deepgram_service(deepgram_api_key)
    
    # WebSocket event handlers
    @socketio.on('connect')
    def handle_connect():
        logger.info("Client connected", client_id=request.sid)
        socketio.emit('connected', {'status': 'connected'}, room=request.sid)
    
    @socketio.on('disconnect')
    def handle_disconnect():
        logger.info("Client disconnected", client_id=request.sid)
    
    @socketio.on('create_session')
    def handle_create_session(data):
        try:
            logger.info("Creating new session", client_id=request.sid)
            
            session_id = str(uuid.uuid4())
            session_data = {
                'session_id': session_id,
                'status': 'created',
                'created_at': datetime.utcnow().isoformat(),
                'client_id': request.sid,
                'type': 'manual',
                'transcript_count': 0,
                'word_count': 0,
                'debug_logs': []
            }
            
            # Store in shared sessions dictionary
            sessions[session_id] = session_data
            
            logger.info("Session created", session_id=session_id)
            socketio.emit('session_created', {
                'success': True,
                'session': session_data
            }, room=request.sid)
            
        except Exception as e:
            logger.error("Error creating session", error=str(e))
            socketio.emit('session_created', {
                'success': False,
                'error': str(e)
            }, room=request.sid)
    
    @socketio.on('start_session')
    def handle_start_session(data):
        try:
            session_id = data.get('session_id')
            logger.info("Starting session", session_id=session_id, client_id=request.sid)
            
            if session_id not in sessions:
                raise Exception("Session not found")
            
            sessions[session_id]['status'] = 'active'
            sessions[session_id]['started_at'] = datetime.utcnow().isoformat()
            
            # Start Deepgram transcription for this session
            # deepgram_service = get_deepgram_service() # REMOVED
            # if deepgram_service: # REMOVED
            #     # Define transcript callback # REMOVED
            #     def on_transcript(session_id: str, transcript_text: str): # REMOVED
            #         logger.info("Transcript received", session_id=session_id, text=transcript_text) # REMOVED
            #         # Emit transcript to client # REMOVED
            #         socketio.emit('transcript_line', { # REMOVED
            #             'session_id': session_id, # REMOVED
            #             'text': transcript_text # REMOVED
            #         }, room=request.sid) # REMOVED
            #         # Update session transcript count # REMOVED
            #         if session_id in sessions: # REMOVED
            #             sessions[session_id]['transcript_count'] += 1 # REMOVED
            #             sessions[session_id]['word_count'] += len(transcript_text.split()) # REMOVED
                
            #     # Start transcription # REMOVED
            #     import asyncio # REMOVED
            #     loop = asyncio.new_event_loop() # REMOVED
            #     asyncio.set_event_loop(loop) # REMOVED
            #     success = loop.run_until_complete( # REMOVED
            #         deepgram_service.start_transcription(session_id, on_transcript) # REMOVED
            #     ) # REMOVED
            #     loop.close() # REMOVED
                
            #     if success: # REMOVED
            #         logger.info("Deepgram transcription started", session_id=session_id) # REMOVED
            #     else: # REMOVED
            #         logger.warning("Failed to start Deepgram transcription", session_id=session_id) # REMOVED
            
            logger.info("Session started", session_id=session_id)
            socketio.emit('session_started', {
                'success': True,
                'session': sessions[session_id]
            }, room=request.sid)
            
        except Exception as e:
            logger.error("Error starting session", error=str(e))
            socketio.emit('session_started', {
                'success': False,
                'error': str(e)
            }, room=request.sid)
    
    @socketio.on('end_session')
    def handle_end_session(data):
        try:
            session_id = data.get('session_id')
            logger.info("Ending session", session_id=session_id, client_id=request.sid)
            
            if session_id not in sessions:
                raise Exception("Session not found")
            
            sessions[session_id]['status'] = 'completed'
            sessions[session_id]['ended_at'] = datetime.utcnow().isoformat()
            
            # Calculate duration
            if sessions[session_id].get('started_at'):
                start_time = datetime.fromisoformat(sessions[session_id]['started_at'])
                end_time = datetime.fromisoformat(sessions[session_id]['ended_at'])
                duration = int((end_time - start_time).total_seconds())
                sessions[session_id]['duration'] = duration
            
            # Stop Deepgram transcription
            # deepgram_service = get_deepgram_service() # REMOVED
            # if deepgram_service: # REMOVED
            #     import asyncio # REMOVED
            #     loop = asyncio.new_event_loop() # REMOVED
            #     asyncio.set_event_loop(loop) # REMOVED
            #     loop.run_until_complete(deepgram_service.stop_transcription(session_id)) # REMOVED
            #     loop.close() # REMOVED
            #     logger.info("Deepgram transcription stopped", session_id=session_id) # REMOVED
            
            logger.info("Session ended", session_id=session_id)
            socketio.emit('session_ended', {
                'success': True,
                'session': sessions[session_id]
            }, room=request.sid)
            
        except Exception as e:
            logger.error("Error ending session", error=str(e))
            socketio.emit('session_ended', {
                'success': False,
                'error': str(e)
            }, room=request.sid)
    
    @socketio.on('audio_chunk')
    def handle_audio_chunk(data):
        try:
            session_id = data.get('session_id')
            audio_data = data.get('audio')
            
            if not session_id or not audio_data:
                logger.warning("Missing session_id or audio data in audio_chunk")
                return
            
            logger.info("Audio chunk received", session_id=session_id, chunk_size=len(audio_data))
            
            # Send audio chunk to Deepgram for transcription
            # deepgram_service = get_deepgram_service() # REMOVED
            # if deepgram_service: # REMOVED
            #     import asyncio # REMOVED
            #     loop = asyncio.new_event_loop() # REMOVED
            #     asyncio.set_event_loop(loop) # REMOVED
            #     success = loop.run_until_complete( # REMOVED
            #         deepgram_service.send_audio_chunk(session_id, audio_data) # REMOVED
            #     ) # REMOVED
            #     loop.close() # REMOVED
                
            #     if success: # REMOVED
            #         logger.debug("Audio chunk sent to Deepgram", session_id=session_id) # REMOVED
            #     else: # REMOVED
            #         logger.warning("Failed to send audio chunk to Deepgram", session_id=session_id) # REMOVED
            
        except Exception as e:
            logger.error("Error processing audio chunk", error=str(e))
    
    @socketio.on('transcript_line')
    def handle_transcript_line(data):
        logger.info("Transcript line received", text=data.get('text', ''))
        # Handle transcript processing here
    
    return app

# Create the app instance for gunicorn
app = create_app()
socketio = None  # Will be initialized when needed
