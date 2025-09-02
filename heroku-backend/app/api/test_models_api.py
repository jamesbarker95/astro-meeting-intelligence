"""
Comprehensive test endpoint for Salesforce Models API
"""

from flask import Blueprint, jsonify
import datetime
import os
from ..services.salesforce_models_service import salesforce_models_service

test_models_api_bp = Blueprint('test_models_api', __name__)

@test_models_api_bp.route('/test-models-api', methods=['GET'])
def test_models_api_comprehensive():
    """Comprehensive test of Salesforce Models API integration"""
    test_results = {
        "timestamp": datetime.datetime.utcnow().isoformat(),
        "tests": {},
        "overall_status": "unknown"
    }
    
    # Test 1: Environment Variables Check
    try:
        print("🔧 Testing environment configuration...")
        
        # Check if credentials are available
        client_id = getattr(salesforce_models_service, 'client_id', None)
        client_secret = getattr(salesforce_models_service, 'client_secret', None)
        api_base_url = getattr(salesforce_models_service, 'api_base_url', None)
        model_name = getattr(salesforce_models_service, 'model_name', None)
        
        test_results["tests"]["environment_config"] = {
            "status": "success",
            "message": "Environment variables checked",
            "config": {
                "client_id_present": bool(client_id),
                "client_id_preview": f"{client_id[:20]}..." if client_id else "None",
                "client_secret_present": bool(client_secret),
                "client_secret_preview": f"{client_secret[:20]}..." if client_secret else "None",
                "api_base_url": api_base_url,
                "model_name": model_name
            }
        }
        
    except Exception as e:
        test_results["tests"]["environment_config"] = {
            "status": "error",
            "message": f"Environment config error: {str(e)}"
        }
    
    # Test 2: JWT Token Generation
    try:
        print("🔑 Testing JWT token generation...")
        test_results["tests"]["jwt_generation"] = {
            "status": "testing",
            "message": "Generating JWT token..."
        }
        
        # Test token generation
        token_generated = salesforce_models_service._generate_jwt()
        
        if token_generated and salesforce_models_service.access_token:
            test_results["tests"]["jwt_generation"] = {
                "status": "success",
                "message": "JWT token generated successfully",
                "token_preview": f"{salesforce_models_service.access_token[:30]}..." if salesforce_models_service.access_token else "None",
                "expires_at": salesforce_models_service.token_expires_at.isoformat() if salesforce_models_service.token_expires_at else None
            }
        else:
            test_results["tests"]["jwt_generation"] = {
                "status": "failed",
                "message": "Failed to generate JWT token"
            }
            
    except Exception as e:
        test_results["tests"]["jwt_generation"] = {
            "status": "error",
            "message": f"JWT generation error: {str(e)}"
        }
    
    # Test 3: Meeting Summary Generation (Current Method Signature)
    try:
        print("🤖 Testing meeting summary generation (current method)...")
        test_results["tests"]["meeting_summary_current"] = {
            "status": "testing",
            "message": "Generating meeting summary with current method signature..."
        }
        
        # Sample data using current method signature
        conversation_history = []
        new_transcripts = [
            "Welcome everyone to today's sales meeting. We'll be discussing the Q4 pipeline and upcoming client presentations.",
            "Our main focus today is the Acme Corp deal worth $500K. They've expressed concerns about our pricing model.",
            "I suggest we prepare a competitive analysis and address their objections in the next meeting.",
            "Action item: John will prepare the pricing comparison by Friday.",
            "Let's also discuss the timeline for implementation if they move forward."
        ]
        previous_summary = None
        
        result = salesforce_models_service.generate_meeting_summary(
            conversation_history=conversation_history,
            new_transcripts=new_transcripts,
            previous_summary=previous_summary
        )
        
        if result:
            test_results["tests"]["meeting_summary_current"] = {
                "status": "success",
                "message": "Meeting summary generated successfully with current method",
                "result_type": type(result).__name__,
                "result_preview": str(result)[:200] + "..." if len(str(result)) > 200 else str(result),
                "full_result": result
            }
        else:
            test_results["tests"]["meeting_summary_current"] = {
                "status": "failed",
                "message": "Meeting summary generation returned empty result"
            }
            
    except Exception as e:
        test_results["tests"]["meeting_summary_current"] = {
            "status": "error",
            "message": f"Meeting summary error (current method): {str(e)}",
            "error_details": str(e)
        }
    
    # Test 4: Test Connection Method
    try:
        print("🔗 Testing connection method...")
        test_results["tests"]["connection_test"] = {
            "status": "testing",
            "message": "Testing connection method..."
        }
        
        # Test if test_connection method exists and works
        if hasattr(salesforce_models_service, 'test_connection'):
            connection_result = salesforce_models_service.test_connection()
            test_results["tests"]["connection_test"] = {
                "status": "success" if connection_result else "failed",
                "message": f"Connection test {'passed' if connection_result else 'failed'}",
                "result": connection_result
            }
        else:
            test_results["tests"]["connection_test"] = {
                "status": "skipped",
                "message": "test_connection method not available"
            }
            
    except Exception as e:
        test_results["tests"]["connection_test"] = {
            "status": "error",
            "message": f"Connection test error: {str(e)}"
        }
    
    # Determine overall status
    test_statuses = [test["status"] for test in test_results["tests"].values() if test["status"] != "skipped"]
    if all(status == "success" for status in test_statuses):
        test_results["overall_status"] = "success"
        test_results["message"] = "✅ All tests passed! Salesforce Models API is working correctly."
    elif any(status == "success" for status in test_statuses):
        test_results["overall_status"] = "partial"
        test_results["message"] = "⚠️ Some tests passed, some failed. Check individual test results."
    else:
        test_results["overall_status"] = "failed"
        test_results["message"] = "❌ All tests failed. Salesforce Models API integration has issues."
    
    # Return appropriate HTTP status
    if test_results["overall_status"] == "success":
        return jsonify(test_results), 200
    elif test_results["overall_status"] == "partial":
        return jsonify(test_results), 207  # Multi-Status
    else:
        return jsonify(test_results), 500

@test_models_api_bp.route('/test-models-simple', methods=['GET'])
def test_models_simple():
    """Simple test of Salesforce Models API"""
    try:
        # Test basic functionality
        result = salesforce_models_service.generate_meeting_summary(
            conversation_history=[],
            new_transcripts=["This is a test meeting transcript for API validation."],
            previous_summary=None
        )
        
        return jsonify({
            "status": "success",
            "message": "Simple test passed",
            "result": result,
            "token_valid": salesforce_models_service.access_token is not None
        })
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": f"Simple test failed: {str(e)}"
        }), 500
