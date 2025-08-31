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
            audio_data = data.get('audio_data')
            
            if not session_id or not audio_data:
                emit('error', {'message': 'Session ID and audio data required'})
                return
            
            logger.info("Audio chunk received", session_id=session_id, data_size=len(audio_data))
            
            # Broadcast to all clients in the session room
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
