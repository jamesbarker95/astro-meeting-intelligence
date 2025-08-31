from flask_socketio import emit, join_room, leave_room
import logging
from structlog import get_logger

logger = get_logger()

def register_socket_events(socketio):
    """Register all WebSocket event handlers"""
    
    @socketio.on('connect')
    def handle_connect():
        """Handle client connection"""
        logger.info("Client connected", sid=request.sid)
        emit('connected', {'status': 'connected', 'sid': request.sid})
    
    @socketio.on('disconnect')
    def handle_disconnect():
        """Handle client disconnection"""
        logger.info("Client disconnected", sid=request.sid)
    
    @socketio.on('join_session')
    def handle_join_session(data):
        """Join a specific session room"""
        try:
            session_id = data.get('session_id')
            if not session_id:
                emit('error', {'message': 'Session ID required'})
                return
            
            join_room(session_id)
            logger.info("Client joined session", session_id=session_id, sid=request.sid)
            emit('joined_session', {'session_id': session_id, 'status': 'joined'})
            
        except Exception as e:
            logger.error("Join session failed", error=str(e))
            emit('error', {'message': 'Failed to join session'})
    
    @socketio.on('leave_session')
    def handle_leave_session(data):
        """Leave a specific session room"""
        try:
            session_id = data.get('session_id')
            if not session_id:
                emit('error', {'message': 'Session ID required'})
                return
            
            leave_room(session_id)
            logger.info("Client left session", session_id=session_id, sid=request.sid)
            emit('left_session', {'session_id': session_id, 'status': 'left'})
            
        except Exception as e:
            logger.error("Leave session failed", error=str(e))
            emit('error', {'message': 'Failed to leave session'})
    
    @socketio.on('audio_chunk')
    def handle_audio_chunk(data):
        """Handle incoming audio chunk from client"""
        try:
            session_id = data.get('session_id')
            # Fix field name mismatch: Electron sends 'audio', not 'audio_data'
            audio_data = data.get('audio') or data.get('audio_data')
            
            # Enhanced debug logging
            logger.info("🎵 HEROKU: Audio chunk received", 
                       session_id=session_id, 
                       has_audio_data=bool(audio_data),
                       audio_data_type=type(audio_data).__name__ if audio_data else None,
                       audio_data_length=len(audio_data) if audio_data else 0,
                       audio_preview=audio_data[:20] + '...' if audio_data and len(audio_data) > 20 else audio_data,
                       data_keys=list(data.keys()))
            
            if not session_id or not audio_data:
                logger.error("❌ HEROKU: Missing required data", session_id=session_id, has_audio=bool(audio_data))
                emit('error', {'message': 'Session ID and audio data required'})
                return
            
            # Get the Deepgram manager from app context
            from flask import current_app
            deepgram_manager = getattr(current_app, 'deepgram_manager', None)
            
            if deepgram_manager:
                # Send audio to Deepgram (now using official SDK)
                try:
                    success = deepgram_manager.send_audio(session_id, audio_data)
                    
                    if not success:
                        logger.warning("⚠️ DEEPGRAM SDK: Failed to send audio", session_id=session_id)
                    else:
                        logger.debug("✅ DEEPGRAM SDK: Audio sent successfully", session_id=session_id)
                        
                except Exception as e:
                    logger.error("❌ DEEPGRAM SDK: Error processing audio", error=str(e), session_id=session_id)
            else:
                logger.warning("Deepgram manager not available", session_id=session_id)
            
            # Broadcast processing status to session room
            emit('audio_processing', {
                'session_id': session_id,
                'status': 'processing',
                'timestamp': datetime.datetime.utcnow().isoformat()
            }, room=session_id)
            
        except Exception as e:
            logger.error("Audio chunk handling failed", error=str(e))
            emit('error', {'message': 'Failed to process audio chunk'})
    
    @socketio.on('transcript_line')
    def handle_transcript_line(data):
        """Handle incoming transcript line from client"""
        try:
            session_id = data.get('session_id')
            transcript = data.get('transcript')
            speaker = data.get('speaker', 'unknown')
            confidence = data.get('confidence', 0.0)
            
            if not session_id or not transcript:
                emit('error', {'message': 'Session ID and transcript required'})
                return
            
            logger.info("Transcript line received", session_id=session_id, transcript=transcript[:50] + "...")
            
            # Broadcast transcript to all clients in the session room
            emit('transcript_update', {
                'session_id': session_id,
                'transcript': transcript,
                'speaker': speaker,
                'confidence': confidence,
                'timestamp': datetime.datetime.utcnow().isoformat()
            }, room=session_id)
            
        except Exception as e:
            logger.error("Transcript line handling failed", error=str(e))
            emit('error', {'message': 'Failed to process transcript line'})
    
    @socketio.on('insight_generated')
    def handle_insight_generated(data):
        """Handle generated insight from backend"""
        try:
            session_id = data.get('session_id')
            insight = data.get('insight')
            insight_type = data.get('type', 'general')
            
            if not session_id or not insight:
                emit('error', {'message': 'Session ID and insight required'})
                return
            
            logger.info("Insight generated", session_id=session_id, type=insight_type)
            
            # Broadcast insight to all clients in the session room
            emit('insight_update', {
                'session_id': session_id,
                'insight': insight,
                'type': insight_type,
                'timestamp': datetime.datetime.utcnow().isoformat()
            }, room=session_id)
            
        except Exception as e:
            logger.error("Insight handling failed", error=str(e))
            emit('error', {'message': 'Failed to process insight'})
    
    @socketio.on('session_status')
    def handle_session_status(data):
        """Handle session status updates"""
        try:
            session_id = data.get('session_id')
            status = data.get('status')
            
            if not session_id or not status:
                emit('error', {'message': 'Session ID and status required'})
                return
            
            logger.info("Session status update", session_id=session_id, status=status)
            
            # Broadcast status to all clients in the session room
            emit('session_status_update', {
                'session_id': session_id,
                'status': status,
                'timestamp': datetime.datetime.utcnow().isoformat()
            }, room=session_id)
            
        except Exception as e:
            logger.error("Session status handling failed", error=str(e))
            emit('error', {'message': 'Failed to process session status'})
    
    @socketio.on('create_session')
    def handle_create_session(data):
        """Handle session creation from WebSocket"""
        try:
            logger.info("Creating new session via WebSocket", client_id=request.sid)
            
            # Import sessions from main app
            from .. import sessions
            import uuid
            
            session_id = str(uuid.uuid4())
            session_data = {
                'session_id': session_id,
                'status': 'created',
                'created_at': datetime.datetime.utcnow().isoformat(),
                'client_id': request.sid,
                'type': 'manual',
                'transcript_count': 0,
                'word_count': 0,
                'debug_logs': [],
                'transcripts': []
            }
            
            # Store in shared sessions dictionary
            sessions[session_id] = session_data
            
            logger.info("Session created via WebSocket", session_id=session_id)
            emit('session_created', {
                'success': True,
                'session': session_data
            })
            
        except Exception as e:
            logger.error("Error creating session via WebSocket", error=str(e))
            emit('session_created', {
                'success': False,
                'error': str(e)
            })
    
    @socketio.on('start_session')
    def handle_start_session(data):
        """Handle session start from WebSocket"""
        try:
            session_id = data.get('session_id')
            logger.info("Starting session via WebSocket", session_id=session_id, client_id=request.sid)
            
            from .. import sessions
            
            if session_id not in sessions:
                raise Exception("Session not found")
            
            sessions[session_id]['status'] = 'active'
            sessions[session_id]['started_at'] = datetime.datetime.utcnow().isoformat()
            
            # Start Deepgram session (now using official SDK)
            from flask import current_app
            deepgram_manager = getattr(current_app, 'deepgram_manager', None)
            if deepgram_manager:
                try:
                    # Import the transcript callback function
                    from ..api.sessions import add_transcript_to_session
                    
                    # Create transcript callback (async wrapper for SDK)
                    async def transcript_callback(transcript_data):
                        await add_transcript_to_session(session_id, transcript_data)
                    
                    # Start Deepgram session (synchronous call, SDK handles threading)
                    success = deepgram_manager.start_session(session_id, transcript_callback)
                    
                    if success:
                        sessions[session_id]['deepgram_active'] = True
                        logger.info("✅ DEEPGRAM SDK: Session started via WebSocket", session_id=session_id)
                    else:
                        sessions[session_id]['deepgram_active'] = False
                        logger.warning("⚠️ DEEPGRAM SDK: Failed to start session via WebSocket", session_id=session_id)
                        
                except Exception as e:
                    sessions[session_id]['deepgram_active'] = False
                    logger.error("❌ DEEPGRAM SDK: Error starting session via WebSocket", error=str(e), session_id=session_id)
            else:
                sessions[session_id]['deepgram_active'] = False
                logger.warning("Deepgram manager not available via WebSocket", session_id=session_id)
            
            logger.info("Session started via WebSocket", session_id=session_id)
            emit('session_started', {
                'success': True,
                'session': sessions[session_id]
            })
            
        except Exception as e:
            logger.error("Error starting session via WebSocket", error=str(e))
            emit('session_started', {
                'success': False,
                'error': str(e)
            })
    
    @socketio.on('end_session')
    def handle_end_session(data):
        """Handle session end from WebSocket"""
        try:
            session_id = data.get('session_id')
            logger.info("Ending session via WebSocket", session_id=session_id, client_id=request.sid)
            
            from .. import sessions
            
            if session_id not in sessions:
                raise Exception("Session not found")
            
            sessions[session_id]['status'] = 'completed'
            sessions[session_id]['ended_at'] = datetime.datetime.utcnow().isoformat()
            
            # Calculate duration
            if sessions[session_id].get('started_at'):
                start_time = datetime.datetime.fromisoformat(sessions[session_id]['started_at'])
                end_time = datetime.datetime.fromisoformat(sessions[session_id]['ended_at'])
                duration = int((end_time - start_time).total_seconds())
                sessions[session_id]['duration'] = duration
            
            # End Deepgram session (now using official SDK)
            from flask import current_app
            deepgram_manager = getattr(current_app, 'deepgram_manager', None)
            if deepgram_manager:
                try:
                    # End Deepgram session (synchronous call, SDK handles cleanup)
                    deepgram_manager.end_session(session_id)
                    sessions[session_id]['deepgram_active'] = False
                    logger.info("✅ DEEPGRAM SDK: Session ended via WebSocket", session_id=session_id)
                    
                except Exception as e:
                    logger.error("❌ DEEPGRAM SDK: Error ending session via WebSocket", error=str(e), session_id=session_id)
            
            logger.info("Session ended via WebSocket", session_id=session_id)
            emit('session_ended', {
                'success': True,
                'session': sessions[session_id]
            })
            
        except Exception as e:
            logger.error("Error ending session via WebSocket", error=str(e))
            emit('session_ended', {
                'success': False,
                'error': str(e)
            })
    
    @socketio.on('error')
    def handle_error(data):
        """Handle client-side errors"""
        try:
            error_message = data.get('message', 'Unknown error')
            session_id = data.get('session_id')
            
            logger.error("Client error", message=error_message, session_id=session_id, sid=request.sid)
            
            # Broadcast error to all clients in the session room if applicable
            if session_id:
                emit('error_broadcast', {
                    'session_id': session_id,
                    'error': error_message,
                    'timestamp': datetime.datetime.utcnow().isoformat()
                }, room=session_id)
            
        except Exception as e:
            logger.error("Error handling failed", error=str(e))

# Import required modules for the socket service
import datetime
from flask import request
