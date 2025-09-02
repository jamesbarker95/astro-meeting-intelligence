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

@test_salesforce_bp.route('/test-models-quick', methods=['GET'])
def test_models_quick():
    """Quick test of Salesforce Models API with correct domain"""
    import datetime
    try:
        logger.info("🧪 Quick Models API test starting...")
        
        # Import here to avoid startup issues
        from ..services.salesforce_models_service import salesforce_models_service
        
        # Test 1: Check configuration
        config_info = {
            "domain": salesforce_models_service.domain,
            "client_id_present": bool(salesforce_models_service.client_id),
            "client_id_preview": f"{salesforce_models_service.client_id[:20]}..." if salesforce_models_service.client_id else "None",
            "api_base_url": salesforce_models_service.api_base_url,
            "model_name": salesforce_models_service.model_name
        }
        
        # Test 2: Try JWT generation
        jwt_success = False
        jwt_error = None
        try:
            jwt_success = salesforce_models_service._generate_jwt()
            if jwt_success:
                logger.info("✅ JWT generation successful")
            else:
                logger.error("❌ JWT generation failed")
        except Exception as e:
            jwt_error = str(e)
            logger.error(f"❌ JWT generation error: {e}")
        
        # Test 3: Try meeting summary (if JWT worked)
        summary_result = None
        summary_error = None
        if jwt_success:
            try:
                logger.info("🤖 Testing meeting summary generation...")
                summary_result = salesforce_models_service.generate_meeting_summary(
                    conversation_history=[],
                    new_transcripts=["This is a test meeting about Q4 sales targets and action items."],
                    previous_summary=None
                )
                if summary_result:
                    logger.info("✅ Meeting summary generation successful")
                else:
                    logger.error("❌ Meeting summary returned empty result")
            except Exception as e:
                summary_error = str(e)
                logger.error(f"❌ Meeting summary error: {e}")
        
        return jsonify({
            "status": "success" if jwt_success and (summary_result or not summary_error) else "partial",
            "timestamp": datetime.datetime.utcnow().isoformat(),
            "tests": {
                "configuration": {
                    "status": "success",
                    "data": config_info
                },
                "jwt_generation": {
                    "status": "success" if jwt_success else "failed",
                    "error": jwt_error,
                    "token_preview": f"{salesforce_models_service.access_token[:30]}..." if salesforce_models_service.access_token else None
                },
                "meeting_summary": {
                    "status": "success" if summary_result else ("failed" if summary_error else "skipped"),
                    "error": summary_error,
                    "result_preview": str(summary_result)[:200] + "..." if summary_result and len(str(summary_result)) > 200 else str(summary_result) if summary_result else None
                }
            }
        })
        
    except Exception as e:
        logger.error(f"❌ Quick test failed: {e}")
        return jsonify({
            "status": "error",
            "message": f"Quick test failed: {str(e)}",
            "timestamp": datetime.datetime.utcnow().isoformat()
        }), 500
