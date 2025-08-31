import os
from typing import Optional

class Config:
    """Base configuration class"""
    SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')
    DEBUG = False
    TESTING = False
    
    # Database
    DATABASE_URL = os.environ.get('DATABASE_URL')
    
    # External APIs
    DEEPGRAM_API_KEY = os.environ.get('DEEPGRAM_API_KEY')
    SALESFORCE_CLIENT_ID = os.environ.get('SALESFORCE_CLIENT_ID')
    SALESFORCE_CLIENT_SECRET = os.environ.get('SALESFORCE_CLIENT_SECRET')
    SALESFORCE_REDIRECT_URI = os.environ.get('SALESFORCE_REDIRECT_URI', 'http://localhost:3000/auth/salesforce/callback')
    
    # Slack Configuration
    SLACK_BOT_TOKEN = os.environ.get('SLACK_BOT_TOKEN')
    SLACK_SIGNING_SECRET = os.environ.get('SLACK_SIGNING_SECRET')
    SLACK_CLIENT_ID = os.environ.get('SLACK_CLIENT_ID')
    SLACK_CLIENT_SECRET = os.environ.get('SLACK_CLIENT_SECRET')
    SLACK_REDIRECT_URI = os.environ.get('SLACK_REDIRECT_URI', 'http://localhost:3000/auth/slack/callback')
    
    # WebSocket Configuration
    SOCKETIO_MESSAGE_QUEUE = os.environ.get('REDIS_URL')
    
    # Logging
    LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO')
    
    # Session Configuration
    SESSION_TIMEOUT = int(os.environ.get('SESSION_TIMEOUT', 3600))  # 1 hour
    
    # Audio Configuration
    AUDIO_SAMPLE_RATE = int(os.environ.get('AUDIO_SAMPLE_RATE', 16000))
    AUDIO_CHANNELS = int(os.environ.get('AUDIO_CHANNELS', 1))
    AUDIO_CHUNK_SIZE = int(os.environ.get('AUDIO_CHUNK_SIZE', 1024))

class DevelopmentConfig(Config):
    """Development configuration"""
    DEBUG = True
    LOG_LEVEL = 'DEBUG'

class ProductionConfig(Config):
    """Production configuration"""
    DEBUG = False
    LOG_LEVEL = 'WARNING'

class TestingConfig(Config):
    """Testing configuration"""
    TESTING = True
    DEBUG = True

def get_config() -> Config:
    """Get configuration based on environment"""
    env = os.environ.get('FLASK_ENV', 'development')
    
    if env == 'production':
        return ProductionConfig()
    elif env == 'testing':
        return TestingConfig()
    else:
        return DevelopmentConfig()

# Validate required environment variables
def validate_config(config: Config) -> None:
    """Validate that all required environment variables are set"""
    required_vars = [
        'DEEPGRAM_API_KEY',
        'SALESFORCE_CLIENT_ID',
        'SALESFORCE_CLIENT_SECRET',
        'SLACK_BOT_TOKEN',
        'SLACK_SIGNING_SECRET'
    ]
    
    missing_vars = []
    for var in required_vars:
        if not getattr(config, var, None):
            missing_vars.append(var)
    
    if missing_vars:
        raise ValueError(f"Missing required environment variables: {', '.join(missing_vars)}")
