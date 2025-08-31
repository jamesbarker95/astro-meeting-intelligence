#!/bin/bash

# Astro Development Setup Script
echo "🚀 Setting up Astro development environment..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3.9+ first."
    exit 1
fi

# Check if pip is installed
if ! command -v pip3 &> /dev/null; then
    echo "❌ pip3 is not installed. Please install pip3 first."
    exit 1
fi

echo "✅ Prerequisites check passed"

# Setup Electron app
echo "📱 Setting up Electron app..."
cd electron-app

# Install Node.js dependencies
echo "📦 Installing Node.js dependencies..."
npm install

# Create dist directory
mkdir -p dist/main dist/renderer

echo "✅ Electron app setup complete"

# Setup Heroku backend
echo "🔧 Setting up Heroku backend..."
cd ../heroku-backend

# Create virtual environment
echo "🐍 Creating Python virtual environment..."
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate

# Install Python dependencies
echo "📦 Installing Python dependencies..."
pip install -r requirements.txt

# Create necessary directories
mkdir -p logs sessions

echo "✅ Heroku backend setup complete"

# Create environment file template
echo "📝 Creating environment file template..."
cd ..
cat > .env.template << EOF
# Electron App Environment Variables
SALESFORCE_CLIENT_ID=your_salesforce_client_id
SALESFORCE_CLIENT_SECRET=your_salesforce_client_secret
SLACK_CLIENT_ID=your_slack_client_id
SLACK_CLIENT_SECRET=your_slack_client_secret
HEROKU_BACKEND_URL=http://localhost:5000

# Heroku Backend Environment Variables
DEEPGRAM_API_KEY=your_deepgram_api_key
SALESFORCE_CLIENT_ID=your_salesforce_client_id
SALESFORCE_CLIENT_SECRET=your_salesforce_client_secret
SLACK_BOT_TOKEN=your_slack_bot_token
SLACK_SIGNING_SECRET=your_slack_signing_secret
SECRET_KEY=your_secret_key_here
FLASK_ENV=development
EOF

echo "✅ Environment template created at .env.template"

# Make setup script executable
chmod +x scripts/setup-dev.sh

echo ""
echo "🎉 Astro development environment setup complete!"
echo ""
echo "Next steps:"
echo "1. Copy .env.template to .env and fill in your API keys"
echo "2. Start the backend: cd heroku-backend && source venv/bin/activate && python -m flask run"
echo "3. Start the Electron app: cd electron-app && npm run dev"
echo ""
echo "Happy coding! 🚀"
