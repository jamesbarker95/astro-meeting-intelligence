"""
Test endpoint for Salesforce Models API connection
"""

from flask import Blueprint, jsonify
from ..services.salesforce_models_service import salesforce_models_service
import logging

logger = logging.getLogger(__name__)

test_salesforce_bp = Blueprint('test_salesforce', __name__)

@test_salesforce_bp.route('/test-salesforce', methods=['GET'])
def test_salesforce_connection():
    """Test the Salesforce Models API connection"""
    try:
        logger.info("Testing Salesforce Models API connection...")
        
        # Test connection
        success = salesforce_models_service.test_connection()
        
        if success:
            return jsonify({
                'status': 'success',
                'message': 'Salesforce Models API connection successful',
                'token_valid': salesforce_models_service.access_token is not None,
                'token_expires_at': salesforce_models_service.token_expires_at.isoformat() if salesforce_models_service.token_expires_at else None
            })
        else:
            return jsonify({
                'status': 'error',
                'message': 'Salesforce Models API connection failed'
            }), 500
            
    except Exception as e:
        logger.error(f"Error testing Salesforce connection: {e}")
        return jsonify({
            'status': 'error',
            'message': f'Connection test failed: {str(e)}'
        }), 500

@test_salesforce_bp.route('/test-summary', methods=['POST'])
def test_meeting_summary():
    """Test meeting summary generation with sample data"""
    try:
        logger.info("Testing meeting summary generation...")
        
        # Sample transcript data
        sample_transcripts = [
            "Let's start the meeting. We need to discuss the Q4 budget.",
            "I think we should allocate more resources to marketing.",
            "John, can you prepare the budget report by Friday?",
            "We also need to review the customer feedback from last quarter.",
            "What about the new product launch timeline?"
        ]
        
        # Test summary generation
        summary = salesforce_models_service.generate_meeting_summary(
            conversation_history=[],
            new_transcripts=sample_transcripts,
            previous_summary=None
        )
        
        if summary:
            return jsonify({
                'status': 'success',
                'message': 'Meeting summary generated successfully',
                'summary': summary
            })
        else:
            return jsonify({
                'status': 'error',
                'message': 'Failed to generate meeting summary'
            }), 500
            
    except Exception as e:
        logger.error(f"Error testing meeting summary: {e}")
        return jsonify({
            'status': 'error',
            'message': f'Summary test failed: {str(e)}'
        }), 500
