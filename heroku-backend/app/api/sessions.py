from flask import Blueprint, request, jsonify, session
import uuid
import datetime
import logging
from structlog import get_logger
from .auth import get_salesforce_tokens, get_slack_tokens

logger = get_logger()
sessions_bp = Blueprint('sessions', __name__)

# Import the shared session storage from the main app
from .. import sessions as active_sessions

@sessions_bp.route('/', methods=['GET'])
def list_sessions():
    """List all sessions (root endpoint)"""
    try:
        # Convert sessions to list format expected by frontend
        sessions_list = []
        for session_id, session_data in active_sessions.items():
            # Calculate duration if session has ended
            duration = None
            if session_data.get('started_at') and session_data.get('ended_at'):
                start_time = datetime.datetime.fromisoformat(session_data['started_at'])
                end_time = datetime.datetime.fromisoformat(session_data['ended_at'])
                duration = int((end_time - start_time).total_seconds())
            
            sessions_list.append({
                'session_id': session_id,
                'status': session_data['status'],
                'created_at': session_data['created_at'],
                'started_at': session_data.get('started_at'),
                'ended_at': session_data.get('ended_at'),
                'duration': duration,
                'type': session_data.get('type', 'manual'),
                'transcript_count': session_data.get('transcript_count', 0),
                'word_count': session_data.get('word_count', 0)
            })
        
        return jsonify(sessions_list)
        
    except Exception as e:
        logger.error("Sessions retrieval failed", error=str(e))
        return jsonify({'error': 'Sessions retrieval failed'}), 500

@sessions_bp.route('/create', methods=['POST'])
def create_session():
    """Create a new meeting session"""
    try:
        data = request.get_json()
        session_type = data.get('type', 'manual')  # 'manual' or 'calendar'
        meeting_info = data.get('meeting_info', {})
        
        # Create session first
        session_id = str(uuid.uuid4())
        session_data = {
            'id': session_id,
            'type': session_type,
            'meeting_info': meeting_info,
            'status': 'created',
            'created_at': datetime.datetime.utcnow().isoformat(),
            'started_at': None,
            'ended_at': None,
            'transcript_count': 0,
            'word_count': 0,
            'insights_generated': 0,
            'debug_logs': []
        }
        
        active_sessions[session_id] = session_data
        
        logger.info("Session created", session_id=session_id, type=session_type)
        
        return jsonify({
            'status': 'success',
            'session_id': session_id,
            'session': session_data
        })
        
    except Exception as e:
        logger.error("Session creation failed", error=str(e))
        return jsonify({'error': 'Session creation failed'}), 500

@sessions_bp.route('/<session_id>/start', methods=['POST'])
def start_session(session_id):
    """Start a meeting session"""
    try:
        if session_id not in active_sessions:
            return jsonify({'error': 'Session not found'}), 404
        
        # Check if user has authenticated tokens
        salesforce_tokens = get_salesforce_tokens(session_id)
        slack_tokens = get_slack_tokens(session_id)
        
        if not salesforce_tokens or not slack_tokens:
            return jsonify({'error': 'Authentication required. Please authenticate with Salesforce and Slack first.'}), 401
        
        session_data = active_sessions[session_id]
        session_data['status'] = 'active'
        session_data['started_at'] = datetime.datetime.utcnow().isoformat()
        session_data['salesforce_instance'] = salesforce_tokens.get('instance_url')
        session_data['slack_team'] = slack_tokens.get('team', {}).get('name')
        
        logger.info("Session started", session_id=session_id)
        
        return jsonify({
            'status': 'success',
            'session': session_data
        })
        
    except Exception as e:
        logger.error("Session start failed", session_id=session_id, error=str(e))
        return jsonify({'error': 'Session start failed'}), 500

@sessions_bp.route('/<session_id>/end', methods=['POST'])
def end_session(session_id):
    """End a meeting session"""
    try:
        if session_id not in active_sessions:
            return jsonify({'error': 'Session not found'}), 404
        
        session_data = active_sessions[session_id]
        session_data['status'] = 'ended'
        session_data['ended_at'] = datetime.datetime.utcnow().isoformat()
        
        logger.info("Session ended", session_id=session_id)
        
        return jsonify({
            'status': 'success',
            'session': session_data
        })
        
    except Exception as e:
        logger.error("Session end failed", session_id=session_id, error=str(e))
        return jsonify({'error': 'Session end failed'}), 500

@sessions_bp.route('/<session_id>', methods=['GET'])
def get_session(session_id):
    """Get session details"""
    try:
        if session_id not in active_sessions:
            return jsonify({'error': 'Session not found'}), 404
        
        return jsonify({
            'status': 'success',
            'session': active_sessions[session_id]
        })
        
    except Exception as e:
        logger.error("Session retrieval failed", session_id=session_id, error=str(e))
        return jsonify({'error': 'Session retrieval failed'}), 500

@sessions_bp.route('/<session_id>/debug', methods=['POST'])
def add_debug_log(session_id):
    """Add debug log to session"""
    try:
        if session_id not in active_sessions:
            return jsonify({'error': 'Session not found'}), 404
        
        data = request.get_json()
        log_entry = {
            'timestamp': datetime.datetime.utcnow().isoformat(),
            'level': data.get('level', 'info'),
            'message': data.get('message', ''),
            'data': data.get('data', {})
        }
        
        active_sessions[session_id]['debug_logs'].append(log_entry)
        
        logger.info("Debug log added", session_id=session_id, message=data.get('message'))
        
        return jsonify({'status': 'success'})
        
    except Exception as e:
        logger.error("Debug log addition failed", session_id=session_id, error=str(e))
        return jsonify({'error': 'Debug log addition failed'}), 500

@sessions_bp.route('/<session_id>/transcript', methods=['POST'])
def add_transcript(session_id):
    """Add transcript line to session"""
    try:
        if session_id not in active_sessions:
            return jsonify({'error': 'Session not found'}), 404
        
        data = request.get_json()
        transcript_line = {
            'timestamp': datetime.datetime.utcnow().isoformat(),
            'text': data.get('text', ''),
            'speaker': data.get('speaker', 'unknown'),
            'confidence': data.get('confidence', 0.0)
        }
        
        session_data = active_sessions[session_id]
        session_data['transcript_count'] += 1
        session_data['word_count'] += len(transcript_line['text'].split())
        
        # Add to debug logs
        log_entry = {
            'timestamp': datetime.datetime.utcnow().isoformat(),
            'level': 'info',
            'message': 'Transcript line received',
            'data': transcript_line
        }
        session_data['debug_logs'].append(log_entry)
        
        logger.info("Transcript added", session_id=session_id, word_count=session_data['word_count'])
        
        return jsonify({
            'status': 'success',
            'word_count': session_data['word_count']
        })
        
    except Exception as e:
        logger.error("Transcript addition failed", session_id=session_id, error=str(e))
        return jsonify({'error': 'Transcript addition failed'}), 500

@sessions_bp.route('/active', methods=['GET'])
def list_active_sessions():
    """List all active sessions"""
    try:
        active = [s for s in active_sessions.values() if s['status'] == 'active']
        return jsonify({
            'status': 'success',
            'sessions': active,
            'count': len(active)
        })
        
    except Exception as e:
        logger.error("Active sessions retrieval failed", error=str(e))
        return jsonify({'error': 'Active sessions retrieval failed'}), 500

@sessions_bp.route('/all', methods=['GET'])
def list_all_sessions():
    """List all sessions"""
    try:
        return jsonify({
            'status': 'success',
            'sessions': list(active_sessions.values()),
            'count': len(active_sessions)
        })
        
    except Exception as e:
        logger.error("All sessions retrieval failed", error=str(e))
        return jsonify({'error': 'All sessions retrieval failed'}), 500
