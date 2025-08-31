from flask import Blueprint, request, jsonify, session
import logging
from structlog import get_logger

logger = get_logger()
auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/tokens', methods=['POST'])
def store_user_tokens():
    """Store user OAuth tokens received from Electron app"""
    try:
        data = request.get_json()
        session_id = data.get('session_id')
        salesforce_tokens = data.get('salesforce_tokens')
        slack_tokens = data.get('slack_tokens')
        
        if not session_id:
            return jsonify({'error': 'Session ID required'}), 400
        
        if not salesforce_tokens or not slack_tokens:
            return jsonify({'error': 'Both Salesforce and Slack tokens required'}), 400
        
        # Store tokens in session (in production, use secure storage)
        session[f'salesforce_tokens_{session_id}'] = salesforce_tokens
        session[f'slack_tokens_{session_id}'] = slack_tokens
        
        logger.info("User tokens stored", session_id=session_id)
        
        return jsonify({
            'status': 'success',
            'message': 'Tokens stored successfully',
            'session_id': session_id
        })
        
    except Exception as e:
        logger.error("Token storage failed", error=str(e))
        return jsonify({'error': 'Token storage failed'}), 500

@auth_bp.route('/tokens/<session_id>', methods=['GET'])
def get_user_tokens(session_id):
    """Get stored user tokens for a session"""
    try:
        salesforce_tokens = session.get(f'salesforce_tokens_{session_id}')
        slack_tokens = session.get(f'slack_tokens_{session_id}')
        
        if not salesforce_tokens or not slack_tokens:
            return jsonify({'error': 'Tokens not found for session'}), 404
        
        return jsonify({
            'status': 'success',
            'salesforce_tokens': {
                'access_token': salesforce_tokens.get('access_token')[:10] + '...' if salesforce_tokens.get('access_token') else None,
                'instance_url': salesforce_tokens.get('instance_url'),
                'has_tokens': bool(salesforce_tokens.get('access_token'))
            },
            'slack_tokens': {
                'access_token': slack_tokens.get('access_token')[:10] + '...' if slack_tokens.get('access_token') else None,
                'team_name': slack_tokens.get('team', {}).get('name'),
                'has_tokens': bool(slack_tokens.get('access_token'))
            }
        })
        
    except Exception as e:
        logger.error("Token retrieval failed", session_id=session_id, error=str(e))
        return jsonify({'error': 'Token retrieval failed'}), 500

@auth_bp.route('/tokens/<session_id>', methods=['DELETE'])
def clear_user_tokens(session_id):
    """Clear stored user tokens for a session"""
    try:
        session.pop(f'salesforce_tokens_{session_id}', None)
        session.pop(f'slack_tokens_{session_id}', None)
        
        logger.info("User tokens cleared", session_id=session_id)
        
        return jsonify({
            'status': 'success',
            'message': 'Tokens cleared successfully',
            'session_id': session_id
        })
        
    except Exception as e:
        logger.error("Token clearing failed", session_id=session_id, error=str(e))
        return jsonify({'error': 'Token clearing failed'}), 500

@auth_bp.route('/validate/<session_id>', methods=['GET'])
def validate_session_tokens(session_id):
    """Validate that a session has valid tokens"""
    try:
        salesforce_tokens = session.get(f'salesforce_tokens_{session_id}')
        slack_tokens = session.get(f'slack_tokens_{session_id}')
        
        salesforce_valid = bool(salesforce_tokens and salesforce_tokens.get('access_token'))
        slack_valid = bool(slack_tokens and slack_tokens.get('access_token'))
        
        return jsonify({
            'status': 'success',
            'session_id': session_id,
            'salesforce': {
                'authenticated': salesforce_valid,
                'instance_url': salesforce_tokens.get('instance_url') if salesforce_valid else None
            },
            'slack': {
                'authenticated': slack_valid,
                'team_name': slack_tokens.get('team', {}).get('name') if slack_valid else None
            },
            'all_authenticated': salesforce_valid and slack_valid
        })
        
    except Exception as e:
        logger.error("Token validation failed", session_id=session_id, error=str(e))
        return jsonify({'error': 'Token validation failed'}), 500

def get_salesforce_tokens(session_id):
    """Helper function to get Salesforce tokens for a session"""
    return session.get(f'salesforce_tokens_{session_id}')

def get_slack_tokens(session_id):
    """Helper function to get Slack tokens for a session"""
    return session.get(f'slack_tokens_{session_id}')
