"""
Salesforce Models API Service
Handles JWT authentication and API calls to Salesforce Models API for meeting summaries
"""

import requests
import time
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any

logger = logging.getLogger(__name__)

class SalesforceModelsService:
    def __init__(self, access_token=None):
        # Salesforce External Client App credentials (Astro_Meeting_Summary - CONFIRMED WORKING)
        self.domain = "storm-65b5252966fd52.my.salesforce.com"
        self.client_id = "3MVG9Rr0EZ2YOVMa1kkbcICIjiKauy7SHQ97hM2TlIXk8hB3kAaNfh8Ma3S1ghIQXwCPKu2XvzvFevSBADIy1"
        self.client_secret = "A3DE16100AAE951EC0C3489825DC89EAA45B39DB9E04109C749A29EA7A85B03A"
        
        # API configuration
        self.api_base_url = "https://api.salesforce.com/einstein/platform/v1"
        self.model_name = "sfdc_ai__DefaultOpenAIGPT4OmniMini"  # GPT-4o mini
        
        # JWT token management - can use provided token or generate new one
        self.access_token = access_token
        self.token_expires_at = None
        self.token_buffer_minutes = 5  # Refresh 5 minutes before expiry
        self.last_token_check = None
        self.token_check_interval_seconds = 300  # Check token every 5 minutes
        
        # Retry logic for long meetings
        self.max_retries = 3
        self.retry_delay_seconds = 10
        
    def _get_token_url(self) -> str:
        """Get the OAuth token endpoint URL"""
        return f"https://{self.domain}/services/oauth2/token"
    
    def _is_token_valid(self) -> bool:
        """Check if current token is valid and not expiring soon"""
        if not self.access_token or not self.token_expires_at:
            return False
        
        # Check if token expires within buffer time
        buffer_time = datetime.now() + timedelta(minutes=self.token_buffer_minutes)
        return self.token_expires_at > buffer_time
    
    def _generate_jwt(self) -> bool:
        """Generate a new JWT token from Salesforce"""
        try:
            logger.info("🔑 Generating new Salesforce JWT token...")
            
            token_url = self._get_token_url()
            data = {
                'grant_type': 'client_credentials',
                'client_id': self.client_id,
                'client_secret': self.client_secret
            }
            
            # Set Content-Type header to match curl -d behavior
            headers = {'Content-Type': 'application/x-www-form-urlencoded'}
            
            # Retry logic for DNS/network issues in web dyno
            for attempt in range(self.max_retries):
                try:
                    response = requests.post(token_url, data=data, headers=headers, timeout=60)
                    break  # Success, exit retry loop
                except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
                    if attempt < self.max_retries - 1:
                        wait_time = self.retry_delay_seconds * (2 ** attempt)  # Exponential backoff
                        logger.warning(f"🔄 Attempt {attempt + 1} failed: {e}. Retrying in {wait_time}s...")
                        time.sleep(wait_time)
                    else:
                        raise  # Last attempt failed, re-raise the exception
            response.raise_for_status()
            
            token_data = response.json()
            
            self.access_token = token_data['access_token']
            
            # Calculate expiry time (default 30 minutes from issued_at)
            issued_at = int(token_data.get('issued_at', time.time() * 1000)) / 1000
            expires_in = 30 * 60  # 30 minutes in seconds
            self.token_expires_at = datetime.fromtimestamp(issued_at + expires_in)
            
            logger.info(f"✅ JWT token generated successfully, expires at {self.token_expires_at}")
            return True
            
        except requests.exceptions.RequestException as e:
            logger.error(f"❌ Failed to generate JWT token: {e}")
            logger.error(f"🔍 Request details - URL: {token_url}")
            logger.error(f"🔍 Headers: {headers}")
            logger.error(f"🔍 Data keys: {list(data.keys())}")
            return False
        except Exception as e:
            logger.error(f"❌ Unexpected error generating JWT token: {e}")
            return False
    
    def _ensure_valid_token(self) -> bool:
        """Ensure we have a valid token, refresh if needed"""
        # If we have a token provided from Electron, use it directly
        if self.access_token:
            logger.info("✅ Using provided OAuth token from Electron")
            return True
            
        # Otherwise, try to generate a new token (fallback for test endpoints)
        current_time = datetime.now()
        
        # Check if we need to validate token (every 5 minutes or if no previous check)
        if (self.last_token_check is None or 
            (current_time - self.last_token_check).total_seconds() > self.token_check_interval_seconds):
            
            self.last_token_check = current_time
            
            if not self._is_token_valid():
                logger.info("🔄 Token expired or invalid, refreshing...")
                return self._generate_jwt()
            else:
                logger.debug("✅ Token still valid")
        
        return self.access_token is not None
    
    def _get_api_headers(self) -> Dict[str, str]:
        """Get headers required for Salesforce Models API"""
        return {
            'Authorization': f'Bearer {self.access_token}',
            'Content-Type': 'application/json',
            'x-sfdc-app-context': 'EinsteinGPT',
            'x-client-feature-id': 'ai-platform-models-connected-app'
        }
    
    def generate_meeting_summary(self, 
                               conversation_history: List[Dict[str, str]], 
                               new_transcripts: List[str],
                               previous_summary: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        """
        Generate or update meeting summary using Salesforce Models API with retry logic
        
        Args:
            conversation_history: Previous conversation context for the AI
            new_transcripts: List of new transcript lines to process
            previous_summary: Previous summary to update (if exists)
            
        Returns:
            Dictionary containing updated summary or None if failed
        """
        for attempt in range(self.max_retries):
            try:
                # Ensure we have a valid token
                if not self._ensure_valid_token():
                    logger.error("❌ Cannot generate summary: No valid token")
                    if attempt < self.max_retries - 1:
                        logger.info(f"🔄 Retrying token generation (attempt {attempt + 1}/{self.max_retries})")
                        time.sleep(self.retry_delay_seconds)
                        continue
                    return None
                
                # Build the conversation messages for chat-generations API
                messages = self._build_conversation_messages(conversation_history, new_transcripts, previous_summary)
                
                # Make API request
                url = f"{self.api_base_url}/models/{self.model_name}/chat-generations"
                headers = self._get_api_headers()
                
                payload = {
                    "messages": messages,
                    "parameters": {
                        "maxTokens": 1500,  # Increased for longer meetings
                        "temperature": 0.3   # Lower temperature for more consistent summaries
                    }
                }
                
                logger.info(f"🤖 Calling Salesforce Models API for meeting summary (attempt {attempt + 1})...")
                
                response = requests.post(url, headers=headers, json=payload, timeout=90)
                response.raise_for_status()
                
                result = response.json()
                
                # Extract the generated summary
                generated_text = result.get('generation', {}).get('generatedText', '')
                
                if not generated_text:
                    logger.error("❌ No generated text in API response")
                    if attempt < self.max_retries - 1:
                        logger.info(f"🔄 Retrying API call (attempt {attempt + 1}/{self.max_retries})")
                        time.sleep(self.retry_delay_seconds)
                        continue
                    return None
                
                # Parse the structured summary from the generated text
                summary = self._parse_summary_response(generated_text)
                
                # Log usage for cost monitoring
                usage = result.get('parameters', {}).get('usage', {})
                logger.info(f"📊 API Usage - Prompt: {usage.get('prompt_tokens', 0)}, "
                           f"Completion: {usage.get('completion_tokens', 0)}, "
                           f"Total: {usage.get('total_tokens', 0)} tokens")
                
                return summary
                
            except requests.exceptions.RequestException as e:
                logger.error(f"❌ API request failed (attempt {attempt + 1}): {e}")
                if attempt < self.max_retries - 1:
                    logger.info(f"🔄 Retrying in {self.retry_delay_seconds} seconds...")
                    time.sleep(self.retry_delay_seconds)
                    # Force token refresh on next attempt
                    self.access_token = None
                    continue
                return None
            except Exception as e:
                logger.error(f"❌ Unexpected error generating summary (attempt {attempt + 1}): {e}")
                if attempt < self.max_retries - 1:
                    time.sleep(self.retry_delay_seconds)
                    continue
                return None
        
        logger.error(f"❌ Failed to generate summary after {self.max_retries} attempts")
        return None
    
    def _build_conversation_messages(self, 
                                   conversation_history: List[Dict[str, str]], 
                                   new_transcripts: List[str],
                                   previous_summary: Optional[Dict[str, Any]] = None) -> List[Dict[str, str]]:
        """Build the conversation messages for the chat-generations API"""
        
        messages = []
        
        # System prompt
        system_prompt = self._get_system_prompt()
        messages.append({"role": "system", "content": system_prompt})
        
        # Add previous summary as assistant message if it exists
        if previous_summary:
            summary_text = self._format_summary_for_context(previous_summary)
            messages.append({"role": "assistant", "content": summary_text})
        
        # Add new transcripts as user message
        transcripts_text = "\n".join([f"- {transcript}" for transcript in new_transcripts])
        
        if previous_summary:
            user_message = f"Please update the meeting summary with these new transcript lines:\n\n{transcripts_text}"
        else:
            user_message = f"Please create a meeting summary from these transcript lines:\n\n{transcripts_text}"
        
        messages.append({"role": "user", "content": user_message})
        
        return messages
    
    def _get_system_prompt(self) -> str:
        """Get the system prompt for meeting summary generation"""
        return """You are an AI meeting assistant that maintains real-time meeting summaries during ongoing business meetings.

ROLE: Analyze new transcript segments and update an existing meeting summary, integrating new information seamlessly with previous content.

TASK: When provided with new transcript lines, update the meeting summary by:
- INTEGRATING new information with existing summary (don't replace, enhance)
- IDENTIFYING new action items, decisions, and key points
- TRACKING unresolved questions and next steps
- MAINTAINING continuity and context from previous updates

OUTPUT FORMAT (JSON):
{
  "summary": "Concise overview integrating all discussion points, key decisions, and main themes covered so far",
  "actionItems": [
    {"task": "Specific actionable task", "assignee": "Person name or 'Unassigned'", "deadline": "Specific date or 'Not specified'"}
  ],
  "questions": [
    "Unresolved questions, concerns, or issues that need follow-up"
  ],
  "nextSteps": [
    "Immediate actions, planned meetings, or dependencies identified"
  ]
}

GUIDELINES FOR LONG MEETINGS:
- PRIORITIZE recent developments while maintaining historical context
- CONSOLIDATE similar action items or questions to avoid duplication
- FOCUS on business outcomes, decisions, and actionable information
- FOCUS on content and decisions rather than individual speaker attribution
- MARK incomplete information as "Not specified" rather than guessing
- MAINTAIN professional, objective tone suitable for business documentation
- EMPHASIZE what was DECIDED or AGREED upon, not just discussed

INTEGRATION STRATEGY:
- If updating existing summary: Enhance and expand, don't overwrite
- If creating new summary: Build comprehensive foundation for future updates
- Always preserve important decisions and commitments from earlier in the meeting"""
    
    def _format_summary_for_context(self, summary: Dict[str, Any]) -> str:
        """Format existing summary for use as conversation context"""
        formatted = f"Current Meeting Summary:\n\n"
        formatted += f"Summary: {summary.get('summary', 'No summary yet')}\n\n"
        
        if summary.get('actionItems'):
            formatted += "Action Items:\n"
            for item in summary['actionItems']:
                formatted += f"- {item.get('task', '')} (Assignee: {item.get('assignee', 'Unassigned')}, Deadline: {item.get('deadline', 'Not specified')})\n"
            formatted += "\n"
        

        
        if summary.get('questions'):
            formatted += "Questions & Concerns:\n"
            for question in summary['questions']:
                formatted += f"- {question}\n"
            formatted += "\n"
        
        if summary.get('nextSteps'):
            formatted += "Next Steps:\n"
            for step in summary['nextSteps']:
                formatted += f"- {step}\n"
        
        return formatted
    
    def _parse_summary_response(self, generated_text: str) -> Dict[str, Any]:
        """Parse the AI response into structured summary data"""
        try:
            # Try to parse as JSON first
            if generated_text.strip().startswith('{'):
                return json.loads(generated_text)
            
            # If not JSON, try to extract JSON from the text
            start_idx = generated_text.find('{')
            end_idx = generated_text.rfind('}') + 1
            
            if start_idx != -1 and end_idx > start_idx:
                json_text = generated_text[start_idx:end_idx]
                return json.loads(json_text)
            
            # Fallback: return as plain summary
            logger.warning("⚠️ Could not parse structured response, using as plain summary")
            return {
                "summary": generated_text,
                "actionItems": [],
                "questions": [],
                "nextSteps": []
            }
            
        except json.JSONDecodeError as e:
            logger.error(f"❌ Failed to parse summary JSON: {e}")
            return {
                "summary": generated_text,
                "actionItems": [],
                "questions": [],
                "nextSteps": []
            }
    
    def test_connection(self) -> bool:
        """Test the connection to Salesforce Models API"""
        try:
            if not self._ensure_valid_token():
                return False
            
            # Make a simple test request
            url = f"{self.api_base_url}/models/{self.model_name}/generations"
            headers = self._get_api_headers()
            
            payload = {
                "prompt": "Test connection",
                "parameters": {
                    "maxTokens": 10
                }
            }
            
            response = requests.post(url, headers=headers, json=payload, timeout=30)
            response.raise_for_status()
            
            logger.info("✅ Salesforce Models API connection test successful")
            return True
            
        except Exception as e:
            logger.error(f"❌ Salesforce Models API connection test failed: {e}")
            return False

# Global instance
salesforce_models_service = SalesforceModelsService()
