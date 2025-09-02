from flask_socketio import emit, join_room, leave_room, request
import logging
import datetime
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
            
            if not session_id or not audio_data:
                emit('error', {'message': 'Session ID and audio data required'})
                return
            
            logger.debug("Audio chunk received", session_id=session_id, data_size=len(audio_data))
            
            # Get the Deepgram manager from app context
            from flask import current_app
            deepgram_manager = getattr(current_app, 'deepgram_manager', None)
            
            if deepgram_manager:
                # Send audio to Deepgram asynchronously
                import asyncio
                try:
                    # Create async task to send audio
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    success = loop.run_until_complete(
                        deepgram_manager.send_audio(session_id, audio_data)
                    )
                    loop.close()
                    
                    if not success:
                        logger.warning("Failed to send audio to Deepgram", session_id=session_id)
                        
                except Exception as e:
                    logger.error("Error processing audio with Deepgram", error=str(e), session_id=session_id)
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
            from .. import sessions as active_sessions
            import datetime
            
            session_id = data.get('session_id')
            transcript = data.get('transcript')
            speaker = data.get('speaker', 'unknown')
            confidence = data.get('confidence', 0.0)
            is_final = data.get('isFinal', False)
            
            if not session_id or not transcript:
                emit('error', {'message': 'Session ID and transcript required'})
                return
            
            logger.info("Transcript line received", session_id=session_id, transcript=transcript[:50] + "...", is_final=is_final)
            
            # Store transcript in session data
            if session_id in active_sessions:
                # Initialize transcripts array if it doesn't exist
                if 'transcripts' not in active_sessions[session_id]:
                    active_sessions[session_id]['transcripts'] = []
                
                # Initialize meeting summary data if it doesn't exist
                if 'meeting_summary' not in active_sessions[session_id]:
                    active_sessions[session_id]['meeting_summary'] = {
                        'summary': '',
                        'actionItems': [],
                        'questions': [],
                        'nextSteps': [],
                        'lastUpdated': None,
                        'finalTranscriptCount': 0
                    }
                
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
                    
                    # Update final transcript count for meeting summary
                    active_sessions[session_id]['meeting_summary']['finalTranscriptCount'] += 1
                    
                    # Check if we should generate/update meeting summary (adaptive frequency)
                    final_count = active_sessions[session_id]['meeting_summary']['finalTranscriptCount']
                    should_update = _should_update_summary(active_sessions[session_id], final_count)
                    
                    if should_update:
                        logger.info("Triggering meeting summary update", session_id=session_id, final_transcript_count=final_count)
                        _generate_meeting_summary_async(session_id, active_sessions[session_id], socketio)
                
                logger.info("Transcript stored", session_id=session_id, total_transcripts=active_sessions[session_id]['transcript_count'])
            
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
            logger.info("Creating new session via WebSocket", client_id=request.sid, data=data)
            
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
            
            # Start Deepgram session
            from flask import current_app
            deepgram_manager = getattr(current_app, 'deepgram_manager', None)
            if deepgram_manager:
                import asyncio
                try:
                    # Import the transcript callback function
                    from ..api.sessions import add_transcript_to_session
                    
                    # Create transcript callback
                    async def transcript_callback(transcript_data):
                        await add_transcript_to_session(session_id, transcript_data)
                    
                    # Start Deepgram session
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    success = loop.run_until_complete(
                        deepgram_manager.start_session(session_id, transcript_callback)
                    )
                    loop.close()
                    
                    if success:
                        sessions[session_id]['deepgram_active'] = True
                        logger.info("Deepgram session started via WebSocket", session_id=session_id)
                    else:
                        sessions[session_id]['deepgram_active'] = False
                        logger.warning("Failed to start Deepgram session via WebSocket", session_id=session_id)
                        
                except Exception as e:
                    sessions[session_id]['deepgram_active'] = False
                    logger.error("Error starting Deepgram session via WebSocket", error=str(e), session_id=session_id)
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
            
            # End Deepgram session
            from flask import current_app
            deepgram_manager = getattr(current_app, 'deepgram_manager', None)
            if deepgram_manager:
                import asyncio
                try:
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    loop.run_until_complete(deepgram_manager.end_session(session_id))
                    loop.close()
                    
                    sessions[session_id]['deepgram_active'] = False
                    logger.info("Deepgram session ended via WebSocket", session_id=session_id)
                    
                except Exception as e:
                    logger.error("Error ending Deepgram session via WebSocket", error=str(e), session_id=session_id)
            
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
import threading

def _generate_meeting_summary_async(session_id, session_data, socketio):
    """Generate meeting summary asynchronously to avoid blocking WebSocket"""
    def generate_summary():
        try:
            from .salesforce_models_service import salesforce_models_service
            from .. import sessions as active_sessions
            
            logger.info("Starting meeting summary generation", session_id=session_id)
            
            # Get the last 5 final transcripts
            final_transcripts = [
                t['transcript'] for t in session_data['transcripts'] 
                if t.get('is_final', False)
            ]
            
            # Take the last 5 final transcripts
            new_transcripts = final_transcripts[-5:] if len(final_transcripts) >= 5 else final_transcripts
            
            if not new_transcripts:
                logger.warning("No final transcripts available for summary", session_id=session_id)
                return
            
            # Get previous summary if it exists
            previous_summary = session_data.get('meeting_summary')
            if previous_summary and not previous_summary.get('summary'):
                previous_summary = None  # Don't use empty summary as context
            
            # Generate summary using Salesforce Models API
            updated_summary = salesforce_models_service.generate_meeting_summary(
                conversation_history=[],  # We'll build this from transcripts if needed
                new_transcripts=new_transcripts,
                previous_summary=previous_summary
            )
            
            if updated_summary:
                # Update session data
                if session_id in active_sessions:
                    active_sessions[session_id]['meeting_summary'].update(updated_summary)
                    active_sessions[session_id]['meeting_summary']['lastUpdated'] = datetime.datetime.utcnow().isoformat()
                    
                    logger.info("Meeting summary updated successfully", session_id=session_id)
                    
                    # Broadcast summary update to all clients in the session room
                    socketio.emit('meeting_summary_update', {
                        'session_id': session_id,
                        'summary': updated_summary,
                        'timestamp': datetime.datetime.utcnow().isoformat()
                    }, room=session_id)
                else:
                    logger.warning("Session not found when updating summary", session_id=session_id)
            else:
                logger.error("Failed to generate meeting summary", session_id=session_id)
                
        except Exception as e:
            logger.error("Error generating meeting summary", error=str(e), session_id=session_id)
    
    # Run in background thread to avoid blocking WebSocket
    thread = threading.Thread(target=generate_summary)
    thread.daemon = True
    thread.start()

def _should_update_summary(session_data, final_count):
    """
    Determine if we should update the meeting summary based on adaptive frequency
    
    Adaptive frequency for long meetings:
    - First 30 minutes: Every 5 final transcripts (high engagement)
    - 30-60 minutes: Every 10 final transcripts 
    - 60+ minutes: Every 15 final transcripts (cost optimization)
    """
    if final_count < 5:
        return False  # Need at least 5 transcripts for first summary
    
    # Calculate meeting duration if available
    meeting_duration_minutes = 0
    if session_data.get('started_at'):
        try:
            start_time = datetime.datetime.fromisoformat(session_data['started_at'])
            current_time = datetime.datetime.utcnow()
            meeting_duration_minutes = (current_time - start_time).total_seconds() / 60
        except:
            pass
    
    # Determine frequency based on duration
    if meeting_duration_minutes <= 30:
        # First 30 minutes: Every 5 transcripts
        frequency = 5
    elif meeting_duration_minutes <= 60:
        # 30-60 minutes: Every 10 transcripts
        frequency = 10
    else:
        # 60+ minutes: Every 15 transcripts
        frequency = 15
    
    # Check if we should update
    should_update = final_count % frequency == 0
    
    if should_update:
        logger.info("Summary update triggered", 
                   final_count=final_count, 
                   frequency=frequency, 
                   duration_minutes=meeting_duration_minutes)
    
    return should_update

def _get_meeting_duration_minutes(session_data):
    """Calculate meeting duration in minutes"""
    if not session_data.get('started_at'):
        return 0
    
    try:
        start_time = datetime.datetime.fromisoformat(session_data['started_at'])
        current_time = datetime.datetime.utcnow()
        return (current_time - start_time).total_seconds() / 60
    except:
        return 0
