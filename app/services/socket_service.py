from flask_socketio import emit, join_room, leave_room
from flask import request
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
            logger.info("Client joined session room", session_id=session_id, sid=request.sid)
            emit('joined_session', {'session_id': session_id, 'status': 'joined'})
            
        except Exception as e:
            logger.error("Join session failed", error=str(e))
            emit('error', {'message': 'Failed to join session room'})
    
    @socketio.on('join')
    def handle_join(session_id):
        """Simple join handler for live pages (accepts session_id directly)"""
        try:
            if not session_id:
                emit('error', {'message': 'Session ID required'})
                return
            
            join_room(session_id)
            logger.info("Client joined session", session_id=session_id, sid=request.sid)
            emit('joined_session', {'session_id': session_id, 'status': 'joined'})
            
        except Exception as e:
            logger.error("Join session failed", error=str(e))
            emit('error', {'message': 'Failed to join session room'})
    
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
        """Handle incoming audio chunk from client - DEPRECATED: Audio processing moved to Electron"""
        try:
            session_id = data.get('session_id')
            logger.info("🎵 HEROKU: Audio chunk received (deprecated - processing moved to Electron)", session_id=session_id)
            
            # Just acknowledge receipt - actual processing happens in Electron now
            emit('audio_processing', {
                'session_id': session_id,
                'status': 'received_by_heroku',
                'message': 'Audio processing moved to Electron app',
                'timestamp': datetime.datetime.utcnow().isoformat()
            }, room=session_id)
            
        except Exception as e:
            logger.error("Audio chunk handling failed", error=str(e))
            emit('error', {'message': 'Failed to process audio chunk'})
    
    @socketio.on('transcript_line')
    def handle_transcript_line(data):
        """Handle incoming transcript line from client"""
        try:
            from .. import sessions as active_sessions
            
            session_id = data.get('session_id')
            transcript = data.get('transcript')
            speaker = data.get('speaker', 'unknown')
            confidence = data.get('confidence', 0.0)
            is_final = data.get('is_final', False)
            
            if not session_id or not transcript:
                emit('error', {'message': 'Session ID and transcript required'})
                return
            
            logger.info("Transcript line received", session_id=session_id, transcript=transcript[:50] + "...", is_final=is_final)
            
            # Create session if it doesn't exist
            if session_id not in active_sessions:
                logger.info("Creating session for transcript", session_id=session_id)
                active_sessions[session_id] = {
                    'session_id': session_id,
                    'status': 'active',
                    'created_at': datetime.datetime.utcnow().isoformat(),
                    'started_at': datetime.datetime.utcnow().isoformat(),
                    'transcripts': [],
                    'transcript_count': 0,
                    'word_count': 0,
                    'type': 'auto_created'
                }
            
            # Initialize transcripts array if it doesn't exist
            if 'transcripts' not in active_sessions[session_id]:
                active_sessions[session_id]['transcripts'] = []
            
            # Create transcript entry
            transcript_entry = {
                'transcript': transcript,
                'speaker': speaker,
                'confidence': confidence,
                'is_final': is_final,
                'timestamp': datetime.datetime.utcnow().isoformat(),
                'sequence': len(active_sessions[session_id]['transcripts'])
            }
            
            # Add to session data
            active_sessions[session_id]['transcripts'].append(transcript_entry)
            
            # Update counts
            active_sessions[session_id]['transcript_count'] = len(active_sessions[session_id]['transcripts'])
            if is_final:
                # Count words in final transcripts only
                word_count = sum(len(t['transcript'].split()) for t in active_sessions[session_id]['transcripts'] if t.get('is_final', False))
                active_sessions[session_id]['word_count'] = word_count
                
                # Count final transcripts for auto-summary trigger
                final_count = sum(1 for t in active_sessions[session_id]['transcripts'] if t.get('is_final', False))
                
                # Trigger meeting summary every 5 final transcripts (5, 10, 15, 20, etc.)
                if final_count > 0 and final_count % 5 == 0:
                    logger.info("Auto-triggering meeting summary", session_id=session_id, final_transcript_count=final_count)
                    trigger_meeting_summary(session_id, final_count)
            
            logger.info("Transcript stored", session_id=session_id, total_transcripts=active_sessions[session_id]['transcript_count'], is_final=is_final)
            
            # Broadcast transcript to all clients in the session room
            emit('transcript_update', {
                'session_id': session_id,
                'transcript': transcript,
                'speaker': speaker,
                'confidence': confidence,
                'is_final': is_final,
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
                'type': data.get('type', 'manual'),
                'transcript_count': 0,
                'word_count': 0,
                'debug_logs': [],
                'transcripts': [],
                # Context fields from Salesforce events
                'meeting_brief': data.get('meeting_brief', ''),
                'competitive_intelligence': data.get('competitive_intelligence', ''),
                'agent_capabilities': data.get('agent_capabilities', ''),
                'meeting_info': data.get('meeting_info', {})
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
            
            # AssemblyAI transcription now handled in Electron desktop app
            sessions[session_id]['assemblyai_active'] = False  # Always false since moved to Electron
            logger.info("✅ Session started - transcription handled by Electron app", session_id=session_id)
            
            logger.info("Session started via WebSocket", session_id=session_id)
            
            # Send only serializable data back to Electron (avoid complex nested objects)
            session_response = {
                'session_id': session_id,
                'status': sessions[session_id]['status'],
                'started_at': sessions[session_id]['started_at'],
                'type': sessions[session_id].get('type', 'manual'),
                'transcript_count': sessions[session_id].get('transcript_count', 0),
                'word_count': sessions[session_id].get('word_count', 0),
                'oauth_token': sessions[session_id].get('oauth_token'),
                'assemblyai_active': sessions[session_id].get('assemblyai_active', False)
            }
            
            emit('session_started', {
                'success': True,
                'session': session_response
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
            
            # AssemblyAI transcription handled in Electron - no cleanup needed on backend
            sessions[session_id]['assemblyai_active'] = False
            logger.info("✅ Session ended - transcription was handled by Electron app", session_id=session_id)
            
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
    
    @socketio.on('session_token')
    def handle_session_token(data):
        """Handle JWT token from Electron for AI features"""
        try:
            session_id = data.get('session_id')
            access_token = data.get('access_token')
            
            if not session_id or not access_token:
                logger.error("Session token missing required data", session_id=session_id, has_token=bool(access_token))
                emit('token_error', {'error': 'Session ID and access token required'})
                return
            
            logger.info("JWT token received from Electron", session_id=session_id, token_length=len(access_token))
            
            # Store in WebSocket sessions for immediate use
            if session_id in sessions:
                sessions[session_id]['oauth_token'] = access_token
                logger.info("JWT token stored in WebSocket session", session_id=session_id)
            else:
                logger.warning("Session not found for token storage", session_id=session_id)
            
            # Also store in Flask session for Models API compatibility
            from flask import session as flask_session
            
            # Get instance URL from existing session data if available
            instance_url = None
            if session_id in sessions and 'meeting_brief' in sessions[session_id]:
                # Extract instance URL from meeting brief or use default
                instance_url = 'https://storm-65b5252966fd52.my.salesforce.com'  # Default from logs
            
            flask_session[f'salesforce_tokens_{session_id}'] = {
                'access_token': access_token,
                'instance_url': instance_url
            }
            
            logger.info("JWT token stored for Models API", session_id=session_id)
            
            # Acknowledge token receipt
            emit('token_stored', {
                'success': True,
                'session_id': session_id,
                'message': 'JWT token stored successfully'
            })
            
        except Exception as e:
            logger.error("Error storing session token", error=str(e), session_id=data.get('session_id'))
            emit('token_error', {
                'success': False,
                'error': str(e)
            })
    
    @socketio.on('manual_summary')
    def handle_manual_summary(data):
        """Handle manual summary generation request"""
        try:
            session_id = data.get('session_id')
            
            if not session_id:
                logger.error("Manual summary missing session ID")
                emit('summary_error', {'error': 'Session ID required'})
                return
            
            logger.info("Manual summary requested", session_id=session_id, client_id=request.sid)
            
            # Get current final transcript count for logging
            if session_id in active_sessions:
                final_count = sum(1 for t in active_sessions[session_id].get('transcripts', []) if t.get('is_final', False))
            else:
                final_count = 0
            
            # Call the same summary function used by auto-trigger
            trigger_meeting_summary(session_id, final_count)
            
        except Exception as e:
            logger.error("Error handling manual summary", error=str(e), session_id=data.get('session_id'))
            emit('summary_error', {
                'session_id': data.get('session_id'),
                'error': f'Manual summary failed: {str(e)}',
                'timestamp': datetime.datetime.utcnow().isoformat()
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

def trigger_meeting_summary(session_id, final_count):
    """Trigger meeting summary generation using Models API"""
    try:
        # Get all final transcripts for this session
        if session_id not in active_sessions:
            logger.error("Session not found for summary generation", session_id=session_id)
            return
        
        session_data = active_sessions[session_id]
        final_transcripts = [t for t in session_data.get('transcripts', []) if t.get('is_final', False)]
        
        if not final_transcripts:
            logger.warning("No final transcripts found for summary", session_id=session_id)
            return
        
        # Combine all final transcript text
        transcript_text = ' '.join([t.get('transcript', '') for t in final_transcripts])
        
        if len(transcript_text.strip()) < 50:  # Minimum text length check
            logger.warning("Insufficient transcript text for summary", session_id=session_id, text_length=len(transcript_text))
            return
        
        logger.info("Generating meeting summary", session_id=session_id, transcript_length=len(transcript_text), final_count=final_count)
        
        # Get JWT token from WebSocket session (not Flask session)
        from .. import sessions
        if session_id not in sessions:
            logger.error("Session not found in sessions dict for JWT token", session_id=session_id)
            return
            
        access_token = sessions[session_id].get('oauth_token')
        if not access_token:
            logger.error("No OAuth token found for session", session_id=session_id)
            emit('summary_error', {
                'session_id': session_id,
                'final_count': final_count,
                'error': 'No OAuth token available for Models API',
                'timestamp': datetime.datetime.utcnow().isoformat()
            }, room=session_id)
            return
        
        # Direct Salesforce Models API call
        import requests
        instance_url = 'https://storm-65b5252966fd52.my.salesforce.com'
        models_url = f"{instance_url}/services/data/v58.0/sobjects/Models__c"
        
        headers = {
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json'
        }
        
        payload = {
            'Session_Type__c': 'Meeting Summary',
            'Input_Text__c': transcript_text,
            'Session_ID__c': session_id
        }
        
        try:
            logger.info("Calling Salesforce Models API", session_id=session_id, url=models_url)
            response = requests.post(models_url, headers=headers, json=payload, timeout=30)
            
            if response.status_code == 200 or response.status_code == 201:
                result = response.json()
                logger.info("Meeting summary generated successfully", session_id=session_id, final_count=final_count, models_id=result.get('id'))
                
                # Broadcast summary update to clients
                emit('summary_generated', {
                    'session_id': session_id,
                    'final_count': final_count,
                    'summary_data': result,
                    'timestamp': datetime.datetime.utcnow().isoformat(),
                    'message': f'Meeting summary generated after {final_count} final transcripts'
                }, room=session_id)
                
            else:
                logger.error("Salesforce Models API call failed", session_id=session_id, status_code=response.status_code, response_text=response.text)
                emit('summary_error', {
                    'session_id': session_id,
                    'final_count': final_count,
                    'error': f'Models API returned {response.status_code}: {response.text}',
                    'timestamp': datetime.datetime.utcnow().isoformat()
                }, room=session_id)
                
        except requests.exceptions.RequestException as api_error:
            logger.error("Error calling Salesforce Models API", session_id=session_id, error=str(api_error))
            emit('summary_error', {
                'session_id': session_id,
                'final_count': final_count,
                'error': f'API request failed: {str(api_error)}',
                'timestamp': datetime.datetime.utcnow().isoformat()
            }, room=session_id)
        
    except Exception as e:
        logger.error("Error triggering meeting summary", session_id=session_id, error=str(e))
        emit('summary_error', {
            'session_id': session_id,
            'final_count': final_count,
            'error': f'Summary generation failed: {str(e)}',
            'timestamp': datetime.datetime.utcnow().isoformat()
        }, room=session_id)

# Import required modules for the socket service
import datetime
from flask import request
