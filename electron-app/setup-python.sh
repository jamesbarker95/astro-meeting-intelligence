#!/bin/bash

echo "🐍 Setting up Python environment for Astro transcription service"
echo "================================================================"

# Check if Python 3 is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3.8 or higher."
    exit 1
fi

echo "✅ Python 3 found: $(python3 --version)"

# Check if pip is installed
if ! command -v pip3 &> /dev/null; then
    echo "❌ pip3 is not installed. Please install pip."
    exit 1
fi

echo "✅ pip3 found: $(pip3 --version)"

# Create virtual environment if it doesn't exist
if [ ! -d "src/python/venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv src/python/venv
    echo "✅ Virtual environment created"
else
    echo "✅ Virtual environment already exists"
fi

# Activate virtual environment
echo "🔧 Activating virtual environment..."
source src/python/venv/bin/activate

# Upgrade pip
echo "⬆️ Upgrading pip..."
pip install --upgrade pip

# Install dependencies
echo "📦 Installing Python dependencies..."
cd src/python
pip install -r requirements.txt

if [ $? -eq 0 ]; then
    echo "✅ Dependencies installed successfully"
else
    echo "❌ Failed to install dependencies"
    exit 1
fi

# Test the setup
echo "🧪 Testing Python setup..."
python test_setup.py

if [ $? -eq 0 ]; then
    echo ""
    echo "🎉 Python setup completed successfully!"
    echo ""
    echo "📋 Next steps:"
    echo "1. Make sure your 'Astro' multi-output device is configured in Audio MIDI Setup"
    echo "2. Run the Electron app: npm start"
    echo "3. Test audio capture and transcription"
    echo ""
    echo "💡 If you encounter issues:"
    echo "- Check that BlackHole is installed and configured"
    echo "- Verify your Deepgram API key is correct"
    echo "- Ensure microphone permissions are granted"
else
    echo ""
    echo "⚠️ Python setup test failed. Please check the errors above."
    exit 1
fi
