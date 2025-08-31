from flask import Blueprint, request, jsonify, session
import requests
import os
import logging
from structlog import get_logger
from .auth import get_salesforce_tokens, get_slack_tokens

logger = get_logger()
insights_bp = Blueprint('insights', __name__)

@insights_bp.route('/models/summary', methods=['POST'])
def generate_summary():
    """Generate meeting summary using Salesforce Models API"""
    try:
        data = request.get_json()
        session_id = data.get('session_id')
        transcript_text = data.get('transcript_text', '')
        
        if not session_id:
            return jsonify({'error': 'Session ID required'}), 400
        
        if not transcript_text:
            return jsonify({'error': 'Transcript text required'}), 400
        
        # Get Salesforce tokens from session
        salesforce_tokens = get_salesforce_tokens(session_id)
        if not salesforce_tokens:
            return jsonify({'error': 'Salesforce authentication required'}), 401
        
        instance_url = salesforce_tokens.get('instance_url')
        access_token = salesforce_tokens.get('access_token')
        
        if not instance_url or not access_token:
            return jsonify({'error': 'Invalid Salesforce tokens'}), 401
        
        # Call Salesforce Models API for summary
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
        
        response = requests.post(models_url, headers=headers, json=payload)
        response.raise_for_status()
        
        result = response.json()
        logger.info("Summary generated", session_id=session_id, models_id=result.get('id'))
        
        return jsonify({
            'status': 'success',
            'summary': result,
            'session_id': session_id
        })
        
    except requests.exceptions.RequestException as e:
        logger.error("Salesforce Models API call failed", error=str(e))
        return jsonify({'error': 'Models API call failed'}), 500
    except Exception as e:
        logger.error("Summary generation failed", error=str(e))
        return jsonify({'error': 'Summary generation failed'}), 500

@insights_bp.route('/models/relevance', methods=['POST'])
def check_relevance():
    """Check relevance using Salesforce Models API"""
    try:
        data = request.get_json()
        session_id = data.get('session_id')
        transcript_line = data.get('transcript_line', '')
        
        if not session_id:
            return jsonify({'error': 'Session ID required'}), 400
        
        if not transcript_line:
            return jsonify({'error': 'Transcript line required'}), 400
        
        # Get Salesforce tokens from session
        salesforce_tokens = get_salesforce_tokens(session_id)
        if not salesforce_tokens:
            return jsonify({'error': 'Salesforce authentication required'}), 401
        
        instance_url = salesforce_tokens.get('instance_url')
        access_token = salesforce_tokens.get('access_token')
        
        if not instance_url or not access_token:
            return jsonify({'error': 'Invalid Salesforce tokens'}), 401
        
        # Call Salesforce Models API for relevance check
        models_url = f"{instance_url}/services/data/v58.0/sobjects/Models__c"
        
        headers = {
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json'
        }
        
        payload = {
            'Session_Type__c': 'Surface Insights',
            'Input_Text__c': transcript_line,
            'Session_ID__c': session_id
        }
        
        response = requests.post(models_url, headers=headers, json=payload)
        response.raise_for_status()
        
        result = response.json()
        logger.info("Relevance check completed", session_id=session_id, models_id=result.get('id'))
        
        return jsonify({
            'status': 'success',
            'relevance_result': result,
            'session_id': session_id
        })
        
    except requests.exceptions.RequestException as e:
        logger.error("Salesforce Models API call failed", error=str(e))
        return jsonify({'error': 'Models API call failed'}), 500
    except Exception as e:
        logger.error("Relevance check failed", error=str(e))
        return jsonify({'error': 'Relevance check failed'}), 500

@insights_bp.route('/agent/insight', methods=['POST'])
def generate_insight():
    """Generate actionable insight using Salesforce Agent API"""
    try:
        data = request.get_json()
        session_id = data.get('session_id')
        relevant_text = data.get('relevant_text', '')
        context = data.get('context', {})
        
        if not session_id:
            return jsonify({'error': 'Session ID required'}), 400
        
        if not relevant_text:
            return jsonify({'error': 'Relevant text required'}), 400
        
        # Get Salesforce tokens from session
        salesforce_tokens = get_salesforce_tokens(session_id)
        if not salesforce_tokens:
            return jsonify({'error': 'Salesforce authentication required'}), 401
        
        instance_url = salesforce_tokens.get('instance_url')
        access_token = salesforce_tokens.get('access_token')
        
        if not instance_url or not access_token:
            return jsonify({'error': 'Invalid Salesforce tokens'}), 401
        
        # Call Salesforce Agent API
        agent_url = f"{instance_url}/services/data/v58.0/sobjects/Agent__c"
        
        headers = {
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json'
        }
        
        payload = {
            'Input_Text__c': relevant_text,
            'Context__c': str(context),
            'Session_ID__c': session_id,
            'Insight_Type__c': 'Actionable'
        }
        
        response = requests.post(agent_url, headers=headers, json=payload)
        response.raise_for_status()
        
        result = response.json()
        logger.info("Insight generated", session_id=session_id, agent_id=result.get('id'))
        
        return jsonify({
            'status': 'success',
            'insight': result,
            'session_id': session_id
        })
        
    except requests.exceptions.RequestException as e:
        logger.error("Salesforce Agent API call failed", error=str(e))
        return jsonify({'error': 'Agent API call failed'}), 500
    except Exception as e:
        logger.error("Insight generation failed", error=str(e))
        return jsonify({'error': 'Insight generation failed'}), 500

@insights_bp.route('/slack/post', methods=['POST'])
def post_to_slack():
    """Post insight to Slack channel"""
    try:
        data = request.get_json()
        session_id = data.get('session_id')
        channel = data.get('channel', '#general')
        message = data.get('message', '')
        insight_data = data.get('insight_data', {})
        
        if not session_id:
            return jsonify({'error': 'Session ID required'}), 400
        
        if not message:
            return jsonify({'error': 'Message required'}), 400
        
        # Get Slack tokens from session
        slack_tokens = get_slack_tokens(session_id)
        if not slack_tokens:
            return jsonify({'error': 'Slack authentication required'}), 401
        
        bot_token = slack_tokens.get('access_token')
        
        if not bot_token:
            return jsonify({'error': 'Invalid Slack tokens'}), 401
        
        # Post to Slack
        slack_url = 'https://slack.com/api/chat.postMessage'
        
        headers = {
            'Authorization': f'Bearer {bot_token}',
            'Content-Type': 'application/json'
        }
        
        payload = {
            'channel': channel,
            'text': message,
            'blocks': [
                {
                    'type': 'section',
                    'text': {
                        'type': 'mrkdwn',
                        'text': message
                    }
                }
            ]
        }
        
        # Add insight data if available
        if insight_data:
            payload['blocks'].append({
                'type': 'section',
                'text': {
                    'type': 'mrkdwn',
                    'text': f"*Insight Details:*\n{insight_data.get('description', 'No details available')}"
                }
            })
        
        response = requests.post(slack_url, headers=headers, json=payload)
        response.raise_for_status()
        
        result = response.json()
        if not result.get('ok'):
            logger.error("Slack post failed", error=result.get('error'))
            return jsonify({'error': result.get('error')}), 400
        
        logger.info("Message posted to Slack", channel=channel)
        
        return jsonify({
            'status': 'success',
            'message': 'Posted to Slack successfully',
            'slack_response': result
        })
        
    except requests.exceptions.RequestException as e:
        logger.error("Slack API call failed", error=str(e))
        return jsonify({'error': 'Slack API call failed'}), 500
    except Exception as e:
        logger.error("Slack post failed", error=str(e))
        return jsonify({'error': 'Slack post failed'}), 500
