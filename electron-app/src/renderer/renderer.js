// Audio Manager Class
class RendererAudioManager {
  constructor() {
    this.microphoneStream = null;
    this.systemAudioStream = null;
    this.combinedStream = null;
    this.audioContext = null;
    this.mediaRecorder = null;
    this.isCapturing = false;
    this.audioChunks = [];
    this.chunkInterval = null;
    
    // Audio configuration
    this.config = {
      sampleRate: 16000, // Deepgram recommended
      channels: 1, // Mono for transcription
      bitDepth: 16,
      chunkSize: 1024, // Audio chunk size
      chunkInterval: 100 // Send chunks every 100ms
    };
  }

  async startMicrophoneCapture() {
    try {
      console.log('Starting microphone capture...');
      
      // Request microphone access with optimal settings for transcription
      this.microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.config.sampleRate,
          channelCount: this.config.channels,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          latency: 0,
          sampleSize: this.config.bitDepth
        }
      });

      console.log('Microphone stream obtained:', this.microphoneStream);
      
      // Set up audio context for processing
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: this.config.sampleRate
      });

      // Create media recorder for audio capture
      this.mediaRecorder = new MediaRecorder(this.microphoneStream, {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: this.config.sampleRate * this.config.bitDepth
      });

      // Set up event handlers
      this.setupMediaRecorderEvents();
      
      // Start recording
      this.mediaRecorder.start(this.config.chunkInterval);
      this.isCapturing = true;

      console.log('Microphone capture started successfully');
      return true;
    } catch (error) {
      console.error('Error starting microphone capture:', error);
      throw error;
    }
  }

  setupMediaRecorderEvents() {
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
        this.processAudioChunk(event.data);
      }
    };

    this.mediaRecorder.onstart = () => {
      console.log('Media recorder started');
      this.audioChunks = [];
    };

    this.mediaRecorder.onstop = () => {
      console.log('Media recorder stopped');
      this.isCapturing = false;
    };

    this.mediaRecorder.onerror = (event) => {
      console.error('Media recorder error:', event);
      this.isCapturing = false;
    };
  }

  async processAudioChunk(audioData) {
    try {
      // Convert audio data to format suitable for streaming
      const arrayBuffer = await audioData.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      
      // Convert to 16-bit PCM for Deepgram
      const pcmData = this.convertToPCM(audioBuffer);
      
      // Send audio chunk to main process for Deepgram transcription
      if (window.electronAPI && window.electronAPI.sendAudioChunk) {
        window.electronAPI.sendAudioChunk(pcmData);
      }
      
      console.log('Audio chunk processed and sent to Deepgram:', pcmData.length, 'bytes');
    } catch (error) {
      console.error('Error processing audio chunk:', error);
    }
  }

  convertToPCM(audioBuffer) {
    // Get the first channel (mono)
    const channelData = audioBuffer.getChannelData(0);
    const pcmData = new Int16Array(channelData.length);
    
    // Convert float32 to int16
    for (let i = 0; i < channelData.length; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      pcmData[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }
    
    return pcmData.buffer;
  }

  async stopMicrophoneCapture() {
    try {
      console.log('Stopping microphone capture...');
      
      if (this.mediaRecorder && this.isCapturing) {
        this.mediaRecorder.stop();
      }
      
      if (this.microphoneStream) {
        this.microphoneStream.getTracks().forEach(track => {
          track.stop();
        });
        this.microphoneStream = null;
      }
      
      if (this.audioContext) {
        await this.audioContext.close();
        this.audioContext = null;
      }
      
      this.isCapturing = false;
      this.audioChunks = [];
      
      console.log('Microphone capture stopped successfully');
      return true;
    } catch (error) {
      console.error('Error stopping microphone capture:', error);
      throw error;
    }
  }

  isCapturingAudio() {
    return this.isCapturing;
  }

  getAudioLevel() {
    if (!this.microphoneStream || !this.audioContext) {
      return 0;
    }
    
    // Create analyzer node for audio level monitoring
    const analyser = this.audioContext.createAnalyser();
    const source = this.audioContext.createMediaStreamSource(this.microphoneStream);
    source.connect(analyser);
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);
    
    // Calculate average level
    const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
    return average / 255; // Normalize to 0-1
  }

  // Future: System audio capture via BlackHole
  async startSystemAudioCapture() {
    console.log('System audio capture not yet implemented');
    // This will be implemented when we add BlackHole integration
  }

  async stopSystemAudioCapture() {
    console.log('System audio capture not yet implemented');
    // This will be implemented when we add BlackHole integration
  }
}

// Export for use in renderer
window.RendererAudioManager = RendererAudioManager;

// Simple global variables
let isAuthenticated = false;
let isAudioSetup = false;
let isAudioCapturing = false;
let currentSession = null;
let websocketConnected = false;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, setting up simple interface');
    setupSimpleButtons();
    checkInitialStatus();
    setupWebSocketEvents();
});

// Simple button setup
function setupSimpleButtons() {
    console.log('Setting up simple buttons');
    
    // First, make sure sections are visible
    showSection('auth-buttons');
    showSection('ready-section');
    
    // Get all buttons
    const salesforceBtn = document.getElementById('salesforce-btn');
    const slackBtn = document.getElementById('slack-btn');
    const startSessionBtn = document.getElementById('start-session-btn');
    
    console.log('Found buttons:', {
        salesforce: !!salesforceBtn,
        slack: !!slackBtn,
        startSession: !!startSessionBtn
    });
    
    // Debug: Log all buttons in the document
    const allButtons = document.querySelectorAll('button');
    console.log('All buttons in document:', allButtons.length);
    allButtons.forEach((btn, index) => {
        console.log(`Button ${index}:`, btn.id, btn.textContent.trim(), 'display:', window.getComputedStyle(btn).display);
    });
    
    // Add simple click handlers
    if (salesforceBtn) {
        salesforceBtn.addEventListener('click', () => {
            console.log('Salesforce button clicked');
            authenticateSalesforce();
        });
        console.log('Salesforce button handler attached');
    } else {
        console.error('Salesforce button not found');
    }
    
    if (slackBtn) {
        slackBtn.addEventListener('click', () => {
            console.log('Slack button clicked');
            authenticateSlack();
        });
        console.log('Slack button handler attached');
    } else {
        console.error('Slack button not found');
    }
    
    if (startSessionBtn) {
        startSessionBtn.addEventListener('click', () => {
            console.log('Start session button clicked');
            handleStartSession();
        });
        console.log('Start session button handler attached');
    } else {
        console.error('Start session button not found');
    }
}

// WebSocket event setup
function setupWebSocketEvents() {
    // Listen for WebSocket events from main process
    window.electronAPI.onWebSocketConnected(() => {
        console.log('WebSocket connected');
        websocketConnected = true;
        updateStatus('Connected to Heroku backend', 'success');
    });
    
    window.electronAPI.onWebSocketDisconnected(() => {
        console.log('WebSocket disconnected');
        websocketConnected = false;
        updateStatus('Disconnected from Heroku backend', 'warning');
    });
    
    window.electronAPI.onWebSocketError((error) => {
        console.error('WebSocket error:', error);
        updateStatus('WebSocket error: ' + error, 'error');
    });
    
    window.electronAPI.onSessionCreated((session) => {
        console.log('Session created:', session);
        currentSession = session;
        updateStatus('Session created! ID: ' + session.session_id, 'success');
    });
    
    window.electronAPI.onSessionStarted((session) => {
        console.log('Session started:', session);
        updateStatus('Session started successfully!', 'success');
        updateSessionButton('End Session');
    });
    
    window.electronAPI.onSessionEnded((session) => {
        console.log('Session ended:', session);
        currentSession = null;
        updateStatus('Session ended', 'info');
        updateSessionButton('Start Session');
    });
}

// Simple authentication functions
async function authenticateSalesforce() {
    try {
        console.log('Starting Salesforce authentication...');
        updateStatus('Authenticating with Salesforce...', 'info');
        
        const result = await window.electronAPI.authenticateSalesforce();
        console.log('Salesforce result:', result);
        
        if (result.success) {
            updateStatus('Salesforce authenticated!', 'success');
            updateAuthStatus('salesforce', true);
            await checkAuthStatus();
        } else {
            updateStatus('Salesforce auth failed: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('Salesforce auth error:', error);
        updateStatus('Salesforce auth error: ' + error.message, 'error');
    }
}

async function authenticateSlack() {
    try {
        console.log('Starting Slack authentication...');
        updateStatus('Authenticating with Slack...', 'info');
        
        const result = await window.electronAPI.authenticateSlack();
        console.log('Slack result:', result);
        
        if (result.success) {
            updateStatus('Slack authenticated!', 'success');
            updateAuthStatus('slack', true);
            await checkAuthStatus();
        } else {
            updateStatus('Slack auth failed: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('Slack auth error:', error);
        updateStatus('Slack auth error: ' + error.message, 'error');
    }
}

// Simple audio functions
async function runAudioSetup() {
    try {
        console.log('Running audio setup...');
        updateStatus('Running audio setup...', 'info');
        
        const result = await window.electronAPI.setupAudio();
        console.log('Audio setup result:', result);
        
        if (result.success) {
            isAudioSetup = true;
            updateStatus('Audio setup complete!', 'success');
            updateAudioStatus('Audio setup complete');
            hideSection('audio-setup-section');
        } else {
            updateStatus('Audio setup failed: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('Audio setup error:', error);
        updateStatus('Audio setup error: ' + error.message, 'error');
    }
}

async function toggleAudioCapture() {
    if (isAudioCapturing) {
        await stopAudioCapture();
    } else {
        await startAudioCapture();
    }
}

async function startAudioCapture() {
    try {
        console.log('Starting audio capture...');
        updateStatus('Starting audio capture...', 'info');
        
        const result = await window.electronAPI.startAudio();
        console.log('Audio start result:', result);
        
        if (result.success) {
            isAudioCapturing = true;
            updateStatus('Audio capture started!', 'success');
            updateAudioButton('Stop Audio');
        } else {
            updateStatus('Failed to start audio: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('Audio start error:', error);
        updateStatus('Audio start error: ' + error.message, 'error');
    }
}

async function stopAudioCapture() {
    try {
        console.log('Stopping audio capture...');
        
        const result = await window.electronAPI.stopAudio();
        console.log('Audio stop result:', result);
        
        if (result.success) {
            isAudioCapturing = false;
            updateStatus('Audio capture stopped!', 'info');
            updateAudioButton('Start Audio');
        }
    } catch (error) {
        console.error('Audio stop error:', error);
        updateStatus('Audio stop error: ' + error.message, 'error');
    }
}

// Simple session function
async function handleStartSession() {
    try {
        if (!isAuthenticated) {
            updateStatus('Please authenticate with Salesforce and Slack first', 'warning');
            return;
        }
        
        console.log('Starting session...');
        updateStatus('Starting session...', 'info');
        
        // Connect to WebSocket if not connected
        if (!websocketConnected) {
            console.log('Connecting to WebSocket...');
            const wsResult = await window.electronAPI.connectWebSocket();
            if (!wsResult.success) {
                updateStatus('Failed to connect to Heroku: ' + wsResult.error, 'error');
                return;
            }
        }
        
        // Create session
        console.log('Creating session...');
        const createResult = await window.electronAPI.createSession();
        if (!createResult.success) {
            updateStatus('Failed to create session: ' + createResult.error, 'error');
            return;
        }
        
        // Start session
        console.log('Starting session...');
        const startResult = await window.electronAPI.startSession(createResult.session.session_id);
        if (!startResult.success) {
            updateStatus('Failed to start session: ' + startResult.error, 'error');
            return;
        }
        
        updateStatus('Session started successfully!', 'success');
        
    } catch (error) {
        console.error('Session error:', error);
        updateStatus('Session error: ' + error.message, 'error');
    }
}

// Simple status check
async function checkInitialStatus() {
    try {
        console.log('Checking initial status...');
        updateStatus('Ready to start!', 'info');
        
        // Check current auth status
        await checkAuthStatus();
        
    } catch (error) {
        console.error('Status check error:', error);
    }
}

async function checkAuthStatus() {
    try {
        const status = await window.electronAPI.checkAuthStatus();
        console.log('Auth status check result:', status);
        
        // Update UI based on auth status
        updateAuthStatus('salesforce', status.salesforce);
        updateAuthStatus('slack', status.slack);
        
        // Check if both services are authenticated
        isAuthenticated = status.salesforce && status.slack;
        console.log('Both services authenticated:', isAuthenticated);
        
        if (isAuthenticated) {
            console.log('Showing ready section and hiding auth buttons');
            showSection('ready-section');
            hideSection('auth-buttons');
            updateStatus('All services connected! Ready to start sessions.', 'success');
        } else {
            console.log('Showing auth buttons and hiding ready section');
            showSection('auth-buttons');
            hideSection('ready-section');
            updateStatus('Please authenticate with Salesforce and Slack', 'info');
        }
        
    } catch (error) {
        console.error('Error checking auth status:', error);
        // Default to showing auth buttons if check fails
        showSection('auth-buttons');
        hideSection('ready-section');
    }
}

// Simple UI helper functions
function updateStatus(message, type = 'info') {
    const statusElement = document.getElementById('status-message');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.className = `status-message ${type}`;
    }
    console.log('Status update:', message, type);
}

function updateAuthStatus(service, isConnected) {
    const statusElement = document.getElementById(`${service}-status-text`);
    if (statusElement) {
        if (isConnected) {
            statusElement.textContent = '✓ Connected';
            statusElement.className = 'status-text connected';
        } else {
            statusElement.textContent = '✗ Not connected';
            statusElement.className = 'status-text disconnected';
        }
    }
}

function updateAudioStatus(message) {
    const audioStatusElement = document.getElementById('audio-status');
    if (audioStatusElement) {
        audioStatusElement.textContent = message;
    }
}

function updateAudioButton(text) {
    const audioBtn = document.getElementById('audio-capture-btn');
    if (audioBtn) {
        audioBtn.textContent = text;
    }
}

function updateSessionButton(text) {
    const sessionBtn = document.getElementById('session-btn');
    if (sessionBtn) {
        sessionBtn.textContent = text;
    }
}

function showSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
        section.style.display = 'block';
    }
}

function hideSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
        section.style.display = 'none';
    }
}


