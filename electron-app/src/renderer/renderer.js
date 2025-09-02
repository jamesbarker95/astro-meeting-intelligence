// Audio Manager Class - Dual Stream (System + Microphone)
class RendererAudioManager extends EventTarget {
  constructor() {
    super();
    this.isCapturing = false;
    this.isDeepgramConnected = false;
    
    // System audio (BlackHole) stream
    this.systemAudioContext = null;
    this.systemMediaStream = null;
    this.systemAudioLevel = 0;
    this.systemHasSignal = false;
    
    // Microphone stream
    this.micAudioContext = null;
    this.micMediaStream = null;
    this.micAudioLevel = 0;
    this.micHasSignal = false;
    
    // Combined/legacy properties for compatibility
    this.audioContext = null;
    this.mediaStream = null;
    this.scriptProcessor = null;
    this.audioLevel = 0;
    this.hasAudioSignal = false;
    
    // Audio streaming buffers (initialized when audio starts)
    this.systemAudioBuffer = null;
    this.systemBufferIndex = 0;
    this.micAudioBuffer = null;
    this.micBufferIndex = 0;
  }

  emit(eventName, data) {
    this.dispatchEvent(new CustomEvent(eventName, { detail: data }));
  }

  async initializeAudio() {
    return this.initializeAudioWithDevice();
  }

  async initializeAudioWithDevice(deviceId = null) {
    // This method is now simplified - the main audio setup happens in handleStartAudioCapture
    console.log('Audio manager initialized (stream will be set by handleStartAudioCapture)');
    return true;
  }

  async startSystemAudioCapture(systemStream) {
    try {
      console.log('DEBUG: startSystemAudioCapture() called');
      this.systemMediaStream = systemStream;
      
      if (!this.systemMediaStream) {
        console.error('DEBUG: No system mediaStream available');
        throw new Error('No system audio stream available');
      }

      console.log('DEBUG: System MediaStream tracks:', this.systemMediaStream.getTracks().length);
      console.log('DEBUG: System Audio tracks:', this.systemMediaStream.getAudioTracks().length);

      // Set up system audio level monitoring
      if (this.systemMediaStream.getAudioTracks().length > 0) {
        console.log('DEBUG: Setting up System AudioContext...');
        
        try {
          // Create AudioContext for system audio
          this.systemAudioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 16000
          });
          console.log('DEBUG: System AudioContext created, state:', this.systemAudioContext.state);
          console.log('DEBUG: System AudioContext sample rate:', this.systemAudioContext.sampleRate);
          
          const source = this.systemAudioContext.createMediaStreamSource(this.systemMediaStream);
          console.log('DEBUG: System MediaStreamSource created');
          
          const analyser = this.systemAudioContext.createAnalyser();
          analyser.fftSize = 512;
          analyser.minDecibels = -90;
          analyser.maxDecibels = -10;
          analyser.smoothingTimeConstant = 0.8;
          source.connect(analyser);
          console.log('DEBUG: System Analyser connected');
          
          // Set up system audio level monitoring and data collection
          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          let frameCount = 0;
          
          // Initialize audio streaming buffer for system audio
          this.systemAudioBuffer = new Float32Array(1024); // ~64ms at 16kHz
          this.systemBufferIndex = 0;
          
          const updateSystemLevel = () => {
            if (this.isCapturing) {
              // Use time domain data for actual audio levels (not frequency data)
              const timeDataArray = new Float32Array(analyser.frequencyBinCount);
              analyser.getFloatTimeDomainData(timeDataArray);
              
              // Collect audio data for streaming (downsample for 16kHz)
              const downsampleRatio = Math.max(1, Math.floor(timeDataArray.length / 256));
              for (let i = 0; i < timeDataArray.length; i += downsampleRatio) {
                if (this.systemBufferIndex < this.systemAudioBuffer.length) {
                  this.systemAudioBuffer[this.systemBufferIndex] = timeDataArray[i];
                  this.systemBufferIndex++;
                }
              }
              
              // Calculate RMS level from time domain data
              let sum = 0;
              for (let i = 0; i < timeDataArray.length; i++) {
                sum += timeDataArray[i] * timeDataArray[i];
              }
              const rms = Math.sqrt(sum / timeDataArray.length);
              // Convert to percentage with safe scaling and hard cap
              let level = rms * 200; // Reduced from 1000 to 200
              this.systemAudioLevel = Math.max(0, Math.min(100, level)); // Hard safety cap
              
              // Debug every 60 frames (roughly once per second)
              if (frameCount % 60 === 0) {
                console.log('DEBUG: System Audio level:', this.systemAudioLevel.toFixed(2), 'RMS:', rms.toFixed(4));
              }
              frameCount++;
              
              // Detect signal presence with lower threshold
              const hasSignal = this.systemAudioLevel > 0.5;
              if (hasSignal !== this.systemHasSignal) {
                this.systemHasSignal = hasSignal;
                console.log('DEBUG: System Signal changed to:', hasSignal);
              }
              
              // Update combined levels and check for audio streaming
              this.updateCombinedLevels();
              this.checkAndSendAudioChunk();
              
              requestAnimationFrame(updateSystemLevel);
            }
          };
          
          // Resume AudioContext if needed
          if (this.systemAudioContext.state === 'suspended') {
            console.log('DEBUG: Resuming suspended System AudioContext...');
            await this.systemAudioContext.resume();
          }
          
          // Set capturing flag BEFORE starting the loop
          this.isCapturing = true;
          
          updateSystemLevel();
          console.log('DEBUG: System Level monitoring started');
          
        } catch (audioError) {
          console.error('DEBUG: System AudioContext setup failed:', audioError);
          throw audioError;
        }
        
        this.systemHasSignal = true;
        this.emit('audio-signal-changed', true);
      } else {
        console.error('DEBUG: No system audio tracks found in stream');
      }
      
      console.log('DEBUG: System audio capture completed successfully');
      return true;
    } catch (error) {
      console.error('DEBUG: startSystemAudioCapture failed:', error);
      return false;
    }
  }

  async startMicrophoneCapture() {
    try {
      console.log('DEBUG: startMicrophoneCapture() called');
      
      // Get microphone device
      const devices = await navigator.mediaDevices.enumerateDevices();
      const micDevice = devices.find(device =>
        device.kind === 'audioinput' && 
        (device.label.toLowerCase().includes('macbook pro microphone') || 
         device.label.toLowerCase().includes('built-in'))
      );
      
      if (!micDevice) {
        console.error('DEBUG: Built-in microphone not found');
        throw new Error('Built-in microphone not found');
      }
      
      console.log('DEBUG: Found microphone device:', micDevice.label);
      
      // Request access to microphone
      const constraints = {
        audio: {
          deviceId: { exact: micDevice.deviceId },
          sampleRate: 16000,
          channelCount: 1,  // Mono for microphone
          echoCancellation: true,  // Enable for microphone
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      };
      
      this.micMediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('DEBUG: Successfully captured microphone stream!');
      console.log('DEBUG: Mic stream settings:', {
        sampleRate: this.micMediaStream.getAudioTracks()[0].getSettings().sampleRate,
        channelCount: this.micMediaStream.getAudioTracks()[0].getSettings().channelCount
      });
      
      // Set up microphone audio level monitoring
      if (this.micMediaStream.getAudioTracks().length > 0) {
        console.log('DEBUG: Setting up Microphone AudioContext...');
        
        try {
          // Create AudioContext for microphone
          this.micAudioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 16000
          });
          console.log('DEBUG: Mic AudioContext created, state:', this.micAudioContext.state);
          
          const source = this.micAudioContext.createMediaStreamSource(this.micMediaStream);
          console.log('DEBUG: Mic MediaStreamSource created');
          
          const analyser = this.micAudioContext.createAnalyser();
          analyser.fftSize = 512;
          analyser.minDecibels = -90;
          analyser.maxDecibels = -10;
          analyser.smoothingTimeConstant = 0.8;
          source.connect(analyser);
          console.log('DEBUG: Mic Analyser connected');
          
          // Set up microphone level monitoring and data collection
          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          let frameCount = 0;
          
          // Initialize audio streaming buffer for microphone
          this.micAudioBuffer = new Float32Array(1024); // ~64ms at 16kHz
          this.micBufferIndex = 0;
          
          const updateMicLevel = () => {
            if (this.isCapturing) {
              // Use time domain data for actual audio levels (not frequency data)
              const timeDataArray = new Float32Array(analyser.frequencyBinCount);
              analyser.getFloatTimeDomainData(timeDataArray);
              
              // Collect audio data for streaming (downsample for 16kHz)
              const downsampleRatio = Math.max(1, Math.floor(timeDataArray.length / 256));
              for (let i = 0; i < timeDataArray.length; i += downsampleRatio) {
                if (this.micBufferIndex < this.micAudioBuffer.length) {
                  this.micAudioBuffer[this.micBufferIndex] = timeDataArray[i];
                  this.micBufferIndex++;
                }
              }
              
              // Calculate RMS level from time domain data
              let sum = 0;
              for (let i = 0; i < timeDataArray.length; i++) {
                sum += timeDataArray[i] * timeDataArray[i];
              }
              const rms = Math.sqrt(sum / timeDataArray.length);
              // Convert to percentage with safe scaling and hard cap
              let level = rms * 200; // Reduced from 1000 to 200
              this.micAudioLevel = Math.max(0, Math.min(100, level)); // Hard safety cap
              
              // Debug every 60 frames (roughly once per second)
              if (frameCount % 60 === 0) {
                console.log('DEBUG: Mic Audio level:', this.micAudioLevel.toFixed(2), 'RMS:', rms.toFixed(4));
              }
              frameCount++;
              
              // Detect signal presence with lower threshold
              const hasSignal = this.micAudioLevel > 0.5;
              if (hasSignal !== this.micHasSignal) {
                this.micHasSignal = hasSignal;
                console.log('DEBUG: Mic Signal changed to:', hasSignal);
              }
              
              // Update combined levels and check for audio streaming
              this.updateCombinedLevels();
              this.checkAndSendAudioChunk();
              
              requestAnimationFrame(updateMicLevel);
            }
          };
          
          // Resume AudioContext if needed
          if (this.micAudioContext.state === 'suspended') {
            console.log('DEBUG: Resuming suspended Mic AudioContext...');
            await this.micAudioContext.resume();
          }
          
          updateMicLevel();
          console.log('DEBUG: Mic Level monitoring started');
          
        } catch (audioError) {
          console.error('DEBUG: Mic AudioContext setup failed:', audioError);
          throw audioError;
        }
      }
      
      console.log('DEBUG: Microphone capture completed successfully');
      return true;
    } catch (error) {
      console.error('DEBUG: startMicrophoneCapture failed:', error);
      return false;
    }
  }

  updateCombinedLevels() {
    // Combine system and microphone levels
    this.audioLevel = Math.max(this.systemAudioLevel, this.micAudioLevel);
    this.hasAudioSignal = this.systemHasSignal || this.micHasSignal;
    
    // Emit combined signal change events
    this.emit('audio-signal-changed', this.hasAudioSignal);
  }

  checkAndSendAudioChunk() {
    // Check if buffers are initialized first
    if (!this.systemAudioBuffer || !this.micAudioBuffer) {
      return; // Buffers not ready yet
    }
    
    // Check if both buffers have enough data to send
    if (this.systemBufferIndex >= this.systemAudioBuffer.length && 
        this.micBufferIndex >= this.micAudioBuffer.length) {
      
      // Mix the two audio streams (simple average)
      const mixedBuffer = new Float32Array(this.systemAudioBuffer.length);
      for (let i = 0; i < mixedBuffer.length; i++) {
        // Average the system and microphone audio
        mixedBuffer[i] = (this.systemAudioBuffer[i] + this.micAudioBuffer[i]) * 0.5;
      }
      
      // Convert Float32 to Int16 PCM for WebSocket transmission
      const pcmBuffer = new Int16Array(mixedBuffer.length);
      for (let i = 0; i < mixedBuffer.length; i++) {
        // Clamp to [-1, 1] and convert to 16-bit PCM
        const sample = Math.max(-1, Math.min(1, mixedBuffer[i]));
        pcmBuffer[i] = sample * 32767;
      }
      
      // Send audio chunk via WebSocket if connected and session active
      if (websocketConnected && currentSession && currentSession.session_id) {
        try {
          // Convert to base64 for WebSocket transmission
          const audioData = btoa(String.fromCharCode(...new Uint8Array(pcmBuffer.buffer)));
          
          // Enhanced debug logging
          console.log('🎵 RENDERER: Sending audio chunk', {
            sessionId: currentSession.session_id,
            pcmSamples: pcmBuffer.length,
            pcmBytes: pcmBuffer.buffer.byteLength,
            base64Length: audioData.length,
            base64Preview: audioData.substring(0, 20) + '...',
            websocketConnected: websocketConnected
          });
          
          window.electronAPI.sendAudioData(audioData);
          
        } catch (error) {
          console.error('❌ RENDERER: Error sending audio chunk:', error);
        }
      } else {
        console.log('⚠️ RENDERER: Skipping audio chunk - not ready', {
          websocketConnected,
          hasSession: !!currentSession,
          sessionId: currentSession?.session_id
        });
      }
      
      // Reset buffers for next chunk
      this.systemBufferIndex = 0;
      this.micBufferIndex = 0;
    }
  }

  async startAudioCapture() {
    try {
      console.log('DEBUG: startAudioCapture() called (legacy compatibility)');
      console.log('DEBUG: this.mediaStream exists?', !!this.mediaStream);
      
      if (!this.mediaStream) {
        console.error('DEBUG: No mediaStream available');
        throw new Error('No audio stream available');
      }

      console.log('DEBUG: MediaStream tracks:', this.mediaStream.getTracks().length);
      console.log('DEBUG: Audio tracks:', this.mediaStream.getAudioTracks().length);

      // Set up basic audio level monitoring
      if (this.mediaStream.getAudioTracks().length > 0) {
        console.log('DEBUG: Setting up AudioContext...');
        
        try {
          // Create minimal AudioContext with 16kHz sample rate to match stream
          this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 16000
          });
          console.log('DEBUG: AudioContext created, state:', this.audioContext.state);
          console.log('DEBUG: AudioContext sample rate:', this.audioContext.sampleRate);
          
          const source = this.audioContext.createMediaStreamSource(this.mediaStream);
          console.log('DEBUG: MediaStreamSource created');
          
          // Create analyser for level detection (lightweight)
          const analyser = this.audioContext.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          console.log('DEBUG: Analyser connected');
          
          // Set up level monitoring
          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          let frameCount = 0;
          
          const updateLevel = () => {
            if (this.isCapturing) {
              analyser.getByteFrequencyData(dataArray);
              
              // Calculate RMS level
              let sum = 0;
              for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i] * dataArray[i];
              }
              const rms = Math.sqrt(sum / dataArray.length);
              this.audioLevel = Math.min(100, (rms / 255) * 100);
              
              // Debug every 60 frames (roughly once per second)
              if (frameCount % 60 === 0) {
                console.log('DEBUG: Audio level:', this.audioLevel.toFixed(2), 'RMS:', rms.toFixed(2));
              }
              frameCount++;
              
              // Detect signal presence
              const hasSignal = this.audioLevel > 1; // Low threshold for signal detection
              if (hasSignal !== this.hasAudioSignal) {
                this.hasAudioSignal = hasSignal;
                this.emit('audio-signal-changed', hasSignal);
                console.log('DEBUG: Signal changed to:', hasSignal);
              }
              
              requestAnimationFrame(updateLevel);
            }
          };
          
          // Resume AudioContext if needed
          if (this.audioContext.state === 'suspended') {
            console.log('DEBUG: Resuming suspended AudioContext...');
            await this.audioContext.resume();
          }
          
          // Set capturing flag BEFORE starting the loop
          this.isCapturing = true;
          
          updateLevel();
          console.log('DEBUG: Level monitoring started');
          
        } catch (audioError) {
          console.error('DEBUG: AudioContext setup failed:', audioError);
          throw audioError;
        }
        
        this.hasAudioSignal = true;
        this.emit('audio-signal-changed', true);
      } else {
        console.error('DEBUG: No audio tracks found in stream');
      }
      console.log('DEBUG: Audio capture with level monitoring completed successfully');
      return true;
    } catch (error) {
      console.error('DEBUG: startAudioCapture failed:', error);
      return false;
    }
  }

  async stopAudioCapture() {
    try {
      console.log('Stopping dual audio capture...');
      
      this.isCapturing = false;
      
      // Stop system audio stream
      if (this.systemMediaStream) {
        this.systemMediaStream.getTracks().forEach(track => track.stop());
        this.systemMediaStream = null;
        console.log('System audio stream stopped and cleared');
      }
      
      // Stop microphone stream
      if (this.micMediaStream) {
        this.micMediaStream.getTracks().forEach(track => track.stop());
        this.micMediaStream = null;
        console.log('Microphone stream stopped and cleared');
      }
      
      // Stop system audio context
      if (this.systemAudioContext) {
        await this.systemAudioContext.close();
        this.systemAudioContext = null;
        console.log('System audio context closed');
      }
      
      // Stop microphone audio context
      if (this.micAudioContext) {
        await this.micAudioContext.close();
        this.micAudioContext = null;
        console.log('Microphone audio context closed');
      }
      
      // Stop legacy stream (for compatibility)
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => track.stop());
        this.mediaStream = null;
        console.log('Legacy audio stream stopped and cleared');
      }
      
      // Stop legacy audio context (for compatibility)
      if (this.audioContext) {
        await this.audioContext.close();
        this.audioContext = null;
        console.log('Legacy audio context closed');
      }
      
      // Reset all levels
      this.systemAudioLevel = 0;
      this.systemHasSignal = false;
      this.micAudioLevel = 0;
      this.micHasSignal = false;
      this.audioLevel = 0;
      this.hasAudioSignal = false;
      
      this.emit('audio-signal-changed', false);
      
      console.log('Dual audio capture stopped successfully');
      return true;
    } catch (error) {
      console.error('Error stopping dual audio capture:', error);
      return false;
    }
  }

  async getAudioStatus() {
    try {
      const status = await window.electronAPI.getAudioStatus();
      this.isCapturing = status.isCapturing;
      this.isDeepgramConnected = status.isDeepgramConnected;
      this.hasAudioSignal = status.hasAudioSignal;
      this.audioLevel = status.audioLevel;
      return status;
    } catch (error) {
      console.error('Error getting audio status:', error);
      return { 
        isCapturing: false, 
        isDeepgramConnected: false,
        hasAudioSignal: false,
        audioLevel: 0
      };
    }
  }

  isCapturingAudio() {
    return this.isCapturing;
  }

  isDeepgramConnected() {
    return this.isDeepgramConnected;
  }

  hasAudioSignalDetected() {
    return this.hasAudioSignal;
  }

  getAudioLevel() {
    return this.audioLevel;
  }
}

// Export for use in renderer
window.RendererAudioManager = RendererAudioManager;

// Simple global variables
let isAuthenticated = false;
let isAudioCapturing = false;
let isDeepgramConnected = false;
let currentSession = null;
let websocketConnected = false;
let audioManager = null;

// Audio streaming to Heroku will be implemented here

// Placeholder for future Heroku audio streaming class
class HerokuAudioStreamer {
    constructor() {
        this.isStreaming = false;
        this.transcripts = [];
    }
    
    // Placeholder methods - will be implemented when we add Heroku streaming
    startStreaming() {
        console.log('HerokuAudioStreamer: Starting audio stream to Heroku...');
        this.isStreaming = true;
        return true;
    }
    
    stopStreaming() {
        console.log('HerokuAudioStreamer: Stopping audio stream to Heroku...');
        this.isStreaming = false;
        return true;
    }
    
    clearTranscripts() {
        this.transcripts = [];
        const transcriptDisplay = document.getElementById('transcript-display');
        if (transcriptDisplay) {
            transcriptDisplay.innerHTML = '<div class="transcript-placeholder">Transcripts will appear here when you start transcription...</div>';
        }
    }
}
// Global audio streamer instance (will stream to Heroku)
let audioStreamer = null;

// Additional global variables for UI state

// Global error handler to catch any unhandled errors
window.addEventListener('error', (event) => {
    console.error('Global error caught:', event.error);
    console.error('Error details:', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack
    });
});

// Global unhandled promise rejection handler
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    console.error('Promise:', event.promise);
});

// DOM Content Loaded Event
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM loaded, setting up simple interface');
    
    // Test electronAPI availability
    if (window.electronAPI) {
        console.log('electronAPI is available:', Object.keys(window.electronAPI));
        console.log('Testing electronAPI.checkAuthStatus...');
        const testResult = window.electronAPI.checkAuthStatus();
        console.log('API test result:', testResult);
    } else {
        console.error('electronAPI is not available!');
        return;
    }
    
    try {
        // Setup button handlers
        console.log('Setting up simple buttons');
        setupSimpleButtons();
        
        // Setup WebSocket events
        setupWebSocketEvents();
        
        // Setup audio events
        setupAudioEvents();
        
        // Check initial status
        console.log('Checking initial status...');
        await checkInitialStatus();
        
        // Initialize audio manager (but don't start capture yet)
        console.log('Audio manager created (audio will be initialized when needed)');
        audioManager = new RendererAudioManager();
        
        console.log('Initialization completed successfully');
        
    } catch (error) {
        console.error('Initialization error:', error);
        updateStatus('Initialization failed: ' + error.message, 'error');
    }
});

// Simple button setup
function setupSimpleButtons() {
    const buttons = {
        'salesforce-btn': handleSalesforceAuth,
        'slack-btn': handleSlackAuth,
        'start-session-btn': handleStartSession,
        'end-session-btn': handleEndSession,
        'audio-capture-btn': handleStartAudioCapture,
        'audio-stop-btn': handleStopAudioCapture
    };
    
    // Add refresh auth status button
    const refreshBtn = document.createElement('button');
    refreshBtn.id = 'refresh-auth-btn';
    refreshBtn.textContent = 'Refresh Auth Status';
    refreshBtn.className = 'btn btn-secondary';
    refreshBtn.style.marginTop = '10px';
    refreshBtn.addEventListener('click', async () => {
        console.log('Refresh auth status clicked');
        updateStatus('Refreshing authentication status...', 'info');
        await checkAuthStatus();
    });
    
    // Add to the auth section
    const authSection = document.querySelector('.auth-section');
    if (authSection) {
        authSection.appendChild(refreshBtn);
    }
    
    console.log('Found buttons:', buttons);
    
    // Debug: Check all buttons in document
    const allButtons = document.querySelectorAll('button');
    console.log('All buttons in document:', allButtons.length);
    allButtons.forEach((btn, index) => {
        console.log(`Button ${index}: ${btn.id} ${btn.textContent} display: ${getComputedStyle(btn).display}`);
    });
    
    // Attach event listeners
    Object.entries(buttons).forEach(([buttonId, handler]) => {
        const button = document.getElementById(buttonId);
        if (button) {
            // Remove any existing listeners
            button.replaceWith(button.cloneNode(true));
            const newButton = document.getElementById(buttonId);
            
            newButton.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                console.log(`${buttonId} clicked!`, event);
                handler(event);
            });
            
            // Add hover effect for debugging
            newButton.addEventListener('mouseenter', () => {
                console.log(`${buttonId} hovered`);
            });
            
            console.log(`${buttonId.replace('-btn', '')} button handler attached`);
        } else {
            console.warn(`Button ${buttonId} not found`);
        }
    });
}

// Handler functions
async function handleSalesforceAuth() {
    try {
        console.log('Starting Salesforce authentication...');
        updateStatus('Authenticating with Salesforce...', 'info');
        const result = await window.electronAPI.authenticateSalesforce();
        console.log('Salesforce result:', result);
        if (result.success) {
            updateStatus('Salesforce authenticated!', 'success');
            await checkAuthStatus();
        } else {
            updateStatus('Salesforce authentication failed: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('Salesforce auth error:', error);
        updateStatus('Salesforce auth error: ' + error.message, 'error');
    }
}

async function handleSlackAuth() {
    try {
        console.log('Starting Slack authentication...');
        updateStatus('Authenticating with Slack...', 'info');
        const result = await window.electronAPI.authenticateSlack();
        console.log('Slack result:', result);
        if (result.success) {
            updateStatus('Slack authenticated!', 'success');
            await checkAuthStatus();
        } else {
            updateStatus('Slack authentication failed: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('Slack auth error:', error);
        updateStatus('Slack auth error: ' + error.message, 'error');
    }
}

async function handleStartSession() {
    try {
        console.log('Starting session...');
        updateStatus('Starting session...', 'info');
        
        // Connect to WebSocket first
        console.log('Connecting to WebSocket...');
        const wsResult = await window.electronAPI.connectWebSocket();
        if (!wsResult.success) {
            throw new Error('Failed to connect to WebSocket: ' + wsResult.error);
        }
        
        // Create session
        console.log('Creating session...');
        const result = await window.electronAPI.createSession();
        console.log('Session result:', result);
        
        if (result.success) {
            // Only update currentSession if we have valid session data and it's not already set
            if (result.session && result.session.session_id && !currentSession) {
                currentSession = result.session;
                console.log('DEBUG: currentSession set from createSession:', currentSession);
                updateStatus(`Session created! ID: ${result.session.session_id}`, 'success');
            } else if (currentSession && currentSession.session_id) {
                console.log('DEBUG: currentSession already exists from WebSocket, not overwriting:', currentSession);
                updateStatus(`Session created! ID: ${currentSession.session_id}`, 'success');
            } else {
                console.log('DEBUG: createSession returned invalid session data:', result.session);
                updateStatus('Session created but ID not available yet...', 'info');
            }
            updateSessionButton(true);
            
            // Auto-start the session if we have a valid session ID
            if (currentSession && currentSession.session_id) {
                console.log('Auto-starting session with ID:', currentSession.session_id);
                const startResult = await window.electronAPI.startSession(currentSession.session_id);
                console.log('Session started:', startResult);
                if (startResult.success) {
                    updateStatus('Session started successfully!', 'success');
                    // Show transcript section
                    showTranscriptSection();
                }
                console.log('Auto-start session result:', startResult);
            }
        } else {
            updateStatus('Failed to create session: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('Session error:', error);
        updateStatus('Session error: ' + error.message, 'error');
    }
}

async function handleEndSession() {
    try {
        console.log('Ending session...');
        console.log('DEBUG: currentSession at end time:', currentSession);
        updateStatus('Ending session...', 'info');
        
        if (!currentSession) {
            console.error('DEBUG: No currentSession found!');
            throw new Error('No active session to end');
        }
        
        if (!currentSession.session_id) {
            console.error('DEBUG: currentSession exists but no session_id:', currentSession);
            throw new Error('Session ID not found in current session');
        }
        
        console.log('DEBUG: Ending session with ID:', currentSession.session_id);
        const result = await window.electronAPI.endSession(currentSession.session_id);
        console.log('End session result:', result);
        
        if (result.success) {
            currentSession = null;
            updateStatus('Session ended!', 'success');
            updateSessionButton(false);
            // Hide transcript section
            hideTranscriptSection();
        } else {
            updateStatus('Failed to end session: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('End session error:', error);
        updateStatus('End session error: ' + error.message, 'error');
    }
}

async function handleStartAudioCapture() {
    try {
        console.log('Start audio capture button clicked');
        updateStatus('Looking for BlackHole audio device...', 'info');
        
        // Get available audio devices
        const devices = await navigator.mediaDevices.enumerateDevices();
        console.log('DEBUG: Total devices found:', devices.length);
        
        console.log('DEBUG: All available devices:');
        devices.forEach((device, index) => {
            console.log(`  ${index}: ${device.kind} - "${device.label}" (ID: ${device.deviceId})`);
        });
        
        const audioInputs = devices.filter(device => device.kind === 'audioinput');
        console.log('DEBUG: Audio input devices:', audioInputs.length);
        audioInputs.forEach((device, index) => {
            console.log(`  Input ${index}: "${device.label}"`);
        });
        
        // Look for BlackHole device
        const blackHoleDevice = audioInputs.find(device => 
            device.label.toLowerCase().includes('blackhole')
        );
        
        if (!blackHoleDevice) {
            throw new Error('BlackHole device not found. Please check Audio MIDI Setup.');
        }
        
        console.log('Found BlackHole device:', blackHoleDevice.label);
        updateStatus(`Connecting to: ${blackHoleDevice.label}`, 'info');
        
        // Request access to BlackHole device
        const constraints = {
            audio: {
                deviceId: { exact: blackHoleDevice.deviceId },
                sampleRate: 16000,
                channelCount: 2,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        };
        
        const systemAudioStream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('Successfully captured system audio stream from BlackHole device!');
        console.log('System Stream settings:', systemAudioStream.getAudioTracks()[0].getSettings());
        
        // Start system audio capture
        const systemSuccess = await audioManager.startSystemAudioCapture(systemAudioStream);
        if (!systemSuccess) {
            throw new Error('Failed to start system audio capture');
        }
        
        console.log('System audio capture started, now starting microphone...');
        updateStatus('System audio connected, starting microphone...', 'info');
        
        // Start microphone capture
        const micSuccess = await audioManager.startMicrophoneCapture();
        if (!micSuccess) {
            throw new Error('Failed to start microphone capture');
        }
        
        console.log('Both system and microphone audio capture started!');
        
        // Initialize AssemblyAI transcription in main process
        console.log('🎵 RENDERER: Starting AssemblyAI transcription...');
        try {
            await window.electronAPI.startAudioCapture();
            console.log('🎵 RENDERER: AssemblyAI transcription started successfully');
        } catch (error) {
            console.error('🎵 RENDERER: Failed to start AssemblyAI transcription:', error);
            // Continue anyway - audio capture still works without transcription
        }
        
        updateStatus(`Dual audio capture started: ${blackHoleDevice.label} + Microphone!`, 'success');
        updateAudioButton(true);
        setupAudioLevelIndicator();
        
    } catch (error) {
        console.error('Audio capture error:', error);
        updateStatus('Audio capture error: ' + error.message, 'error');
    }
}

async function handleStopAudioCapture() {
    try {
        console.log('Stop audio capture button clicked');
        updateStatus('Stopping audio capture...', 'info');
        
        // Stop AssemblyAI transcription in main process
        console.log('🎵 RENDERER: Stopping AssemblyAI transcription...');
        try {
            await window.electronAPI.stopAudioCapture();
            console.log('🎵 RENDERER: AssemblyAI transcription stopped successfully');
        } catch (error) {
            console.error('🎵 RENDERER: Failed to stop AssemblyAI transcription:', error);
            // Continue anyway
        }
        
        const result = audioManager.stopAudioCapture();
        console.log('Audio capture stop result:', result);
        
        if (result) {
            updateStatus('Audio capture stopped!', 'success');
            updateAudioButton(false);
        } else {
            updateStatus('Failed to stop audio capture', 'error');
        }
    } catch (error) {
        console.error('Audio capture error:', error);
        updateStatus('Audio capture error: ' + error.message, 'error');
    }
}

// Event setup functions
function setupWebSocketEvents() {
    window.electronAPI.onWebSocketConnected(() => {
        console.log('WebSocket connected');
        websocketConnected = true;
        updateStatus('Connected to Heroku backend', 'success');
    });

    window.electronAPI.onWebSocketDisconnected(() => {
        console.log('WebSocket disconnected');
        websocketConnected = false;
        updateStatus('Disconnected from Heroku backend', 'info');
    });

    window.electronAPI.onWebSocketError((event, error) => {
        console.error('WebSocket error:', error);
        updateStatus('WebSocket error: ' + error, 'error');
    });

    window.electronAPI.onSessionCreated((session) => {
        console.log('Session created event received:', session);
        console.log('Response type:', typeof session);
        console.log('Response keys:', Object.keys(session));
        
        try {
            let sessionData;
            
            if (session && typeof session === 'object') {
                if (session.session) {
                    console.log('Found session object in response.session');
                    sessionData = session.session;
                } else if (session.session_id) {
                    console.log('Found session_id directly in response');
                    sessionData = session;
                } else {
                    console.log('Session object:', session);
                    console.log('Session object keys:', Object.keys(session));
                    sessionData = session;
                }
            } else {
                console.error('Invalid session data received:', session);
                return;
            }
            
            if (sessionData && sessionData.session_id) {
                console.log('Found sessionId in session.session_id:', sessionData.session_id);
                
                // Only update currentSession if it's not already set (avoid overwriting)
                if (!currentSession || !currentSession.session_id) {
                    currentSession = sessionData;
                    console.log('DEBUG: currentSession updated from WebSocket:', currentSession);
                } else {
                    console.log('DEBUG: currentSession already exists, not overwriting:', currentSession);
                }
                
                // Extract just the session ID for display
                const sessionId = sessionData.session_id;
                console.log('Extracted session ID:', sessionId);
                
                updateStatus(`Session created! ID: ${sessionId}`, 'success');
                updateSessionButton(true);
                
                // Auto-start session
                console.log('Auto-starting session with ID:', sessionId);
                window.electronAPI.startSession(sessionId).then(result => {
                    console.log('Session started:', result);
                    if (result.success) {
                        updateStatus('Session started successfully!', 'success');
                    }
                    console.log('Auto-start session result:', result);
                });
            } else {
                console.error('No session_id found in session data:', sessionData);
                updateStatus('Session created but no ID found', 'error');
            }
        } catch (error) {
            console.error('Error processing session created event:', error);
            updateStatus('Error processing session: ' + error.message, 'error');
        }
    });

    window.electronAPI.onTranscriptLine((event, line) => {
        console.log('Transcript line received:', line);
        addTranscriptLine(line);
    });
}

function setupAudioEvents() {
    window.electronAPI.onAudioInitialized(() => {
        console.log('Audio initialized');
        updateStatus('Audio system ready', 'success');
    });

    window.electronAPI.onAudioStarted(() => {
        console.log('Audio started');
        updateStatus('Audio capture started', 'success');
    });

    window.electronAPI.onAudioStopped(() => {
        console.log('Audio stopped');
        updateStatus('Audio capture stopped', 'info');
    });

    window.electronAPI.onAudioError((event, error) => {
        console.error('Audio error:', error);
        updateStatus('Audio error: ' + error, 'error');
    });
}

// Status and UI functions
async function checkInitialStatus() {
    try {
        updateStatus('Ready to start!', 'info');
        await checkAuthStatus();
    } catch (error) {
        console.error('Status check error:', error);
        updateStatus('Error checking status', 'error');
    }
}

async function checkAuthStatus() {
    try {
        console.log('Checking auth status...');
        const result = await window.electronAPI.checkAuthStatus();
        console.log('Auth status check result:', result);
        
        const bothAuthenticated = result.salesforce && result.slack;
        console.log('Both services authenticated:', bothAuthenticated);
        isAuthenticated = bothAuthenticated;
        
        if (bothAuthenticated) {
            console.log('Showing ready section and hiding auth buttons');
            updateStatus('All services connected! Ready to start sessions.', 'success');
            
            // Hide auth buttons
            const authSection = document.querySelector('.auth-section');
            const readySection = document.querySelector('.ready-section');
            const eventsSection = document.getElementById('events-section');
            if (authSection) authSection.style.display = 'none';
            if (readySection) readySection.style.display = 'block';
            if (eventsSection) {
                eventsSection.style.display = 'block';
                eventsSection.classList.remove('hidden');
            }
            
            // Load user events from Salesforce
            loadUserEvents();
            
        } else {
            console.log('Showing auth buttons and hiding ready section');
            updateStatus('Please authenticate with Salesforce and Slack (click Refresh if you just completed OAuth)', 'info');
            
            // Show auth buttons
            const authSection = document.querySelector('.auth-section');
            const readySection = document.querySelector('.ready-section');
            if (authSection) authSection.style.display = 'block';
            if (readySection) readySection.style.display = 'none';
        }
    } catch (error) {
        console.error('Auth status error:', error);
        updateStatus('Error checking authentication status', 'error');
    }
}

function updateStatus(message, type) {
    const statusElement = document.getElementById('status');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.className = `status ${type}`;
    }
    console.log('Status update:', message, type);
}

function updateSessionButton(isActive) {
    const startBtn = document.getElementById('start-session-btn');
    const endBtn = document.getElementById('end-session-btn');
    
    if (isActive) {
        if (startBtn) startBtn.classList.add('hidden');
        if (endBtn) endBtn.classList.remove('hidden');
    } else {
        if (startBtn) startBtn.classList.remove('hidden');
        if (endBtn) endBtn.classList.add('hidden');
    }
}

function updateAudioButton(isCapturing) {
    const startBtn = document.getElementById('audio-capture-btn');
    const stopBtn = document.getElementById('audio-stop-btn');
    
    if (isCapturing) {
        if (startBtn) startBtn.classList.add('hidden');
        if (stopBtn) stopBtn.classList.remove('hidden');
    } else {
        if (startBtn) startBtn.classList.remove('hidden');
        if (stopBtn) stopBtn.classList.add('hidden');
    }
}

function showTranscriptSection() {
    const transcriptSection = document.getElementById('transcript-section');
    if (transcriptSection) {
        transcriptSection.classList.remove('hidden');
        console.log('🎵 UI: Transcript section shown');
    }
}

function hideTranscriptSection() {
    const transcriptSection = document.getElementById('transcript-section');
    if (transcriptSection) {
        transcriptSection.classList.add('hidden');
        console.log('🎵 UI: Transcript section hidden');
    }
}

function addTranscriptLine(data) {
    const container = document.getElementById('transcript-content');
    if (!container) {
        console.warn('🎵 UI: Transcript container not found');
        return;
    }

    // Handle both string and object data
    let text, isFinal, confidence;
    if (typeof data === 'string') {
        text = data;
        isFinal = true;
        confidence = 1.0;
    } else if (data && typeof data === 'object') {
        text = data.transcript || data.text || String(data);
        isFinal = data.isFinal || data.is_final || false;
        confidence = data.confidence || 1.0;
    } else {
        text = String(data);
        isFinal = true;
        confidence = 1.0;
    }

    // Skip empty transcripts
    if (!text || text.trim().length === 0) {
        return;
    }

    console.log('🎵 UI: Adding transcript line:', { text: text.substring(0, 50) + '...', isFinal, confidence });

    // Create transcript line element
    const lineElement = document.createElement('div');
    lineElement.className = `transcript-line ${isFinal ? 'final' : 'interim'}`;
    
    const timestamp = new Date().toLocaleTimeString();
    const confidenceText = confidence < 1.0 ? ` (${Math.round(confidence * 100)}%)` : '';
    const statusText = isFinal ? '' : ' [interim]';
    
    lineElement.innerHTML = `
        <span class="timestamp">[${timestamp}]</span>
        <span class="transcript-text ${isFinal ? 'final-text' : 'interim-text'}">${text}</span>
        <span class="transcript-meta">${confidenceText}${statusText}</span>
    `;
    
    // If this is an interim result, replace the last interim line if it exists
    if (!isFinal) {
        const lastInterim = container.querySelector('.transcript-line.interim:last-child');
        if (lastInterim) {
            lastInterim.remove();
        }
    }
    
    container.appendChild(lineElement);
    
    // Auto-scroll to bottom
    const transcriptContainer = document.getElementById('transcript-container');
    if (transcriptContainer) {
        transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
    }
    
    // Also update individual event transcripts
    updateEventTranscripts({ text, isFinal, confidence, timestamp });
}

function updateEventTranscripts(transcript) {
    // Update all active event session transcripts
    activeEventSessions.forEach((sessionInfo, eventId) => {
        const eventTranscriptContent = document.getElementById(`event-transcript-content-${eventId}`);
        if (eventTranscriptContent) {
            // Store transcript line
            sessionInfo.transcriptLines.push(transcript);
            
            // Create transcript line element
            const transcriptLine = document.createElement('div');
            transcriptLine.style.marginBottom = '3px';
            transcriptLine.style.padding = '2px 0';
            transcriptLine.style.fontSize = '11px';
            
            // Color code based on is_final
            if (transcript.isFinal) {
                transcriptLine.style.color = '#212529';
                transcriptLine.style.fontWeight = '500';
            } else {
                transcriptLine.style.color = '#6c757d';
                transcriptLine.style.fontStyle = 'italic';
            }
            
            const timestamp = transcript.timestamp || new Date().toLocaleTimeString();
            transcriptLine.innerHTML = `<span style="color: #007bff; font-size: 10px;">[${timestamp}]</span> ${transcript.text}`;
            
            eventTranscriptContent.appendChild(transcriptLine);
            
            // Auto-scroll to bottom
            const eventTranscriptDiv = document.getElementById(`event-transcript-${eventId}`);
            if (eventTranscriptDiv) {
                eventTranscriptDiv.scrollTop = eventTranscriptDiv.scrollHeight;
            }
            
            // Limit transcript lines to prevent memory issues
            if (sessionInfo.transcriptLines.length > 50) {
                sessionInfo.transcriptLines.shift();
                const firstChild = eventTranscriptContent.firstChild;
                if (firstChild) {
                    eventTranscriptContent.removeChild(firstChild);
                }
            }
        }
    });
}

function setupAudioLevelIndicator() {
    if (!audioManager) return;
    
    console.log('Setting up dual audio level indicator...');
    
    // Create or update the audio level display
    let levelContainer = document.getElementById('audio-level-container');
    if (!levelContainer) {
        levelContainer = document.createElement('div');
        levelContainer.id = 'audio-level-container';
        levelContainer.innerHTML = `
            <div style="margin-top: 20px; padding: 15px; border: 1px solid #ddd; border-radius: 8px; background: #f9f9f9;">
                <h4 style="margin: 0 0 10px 0; color: #333;">Audio Levels</h4>
                
                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: bold; color: #2563eb;">System Audio (BlackHole):</label>
                    <div style="width: 100%; height: 20px; background: #e5e7eb; border-radius: 10px; overflow: hidden; position: relative;">
                        <div id="system-audio-bar" style="height: 100%; background: linear-gradient(90deg, #3b82f6, #1d4ed8); width: 0%; transition: width 0.1s ease;"></div>
                    </div>
                    <div id="system-audio-level" style="margin-top: 5px; font-size: 14px; color: #374151;">Level: 0.0%</div>
                </div>
                
                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: bold; color: #059669;">Microphone:</label>
                    <div style="width: 100%; height: 20px; background: #e5e7eb; border-radius: 10px; overflow: hidden; position: relative;">
                        <div id="mic-audio-bar" style="height: 100%; background: linear-gradient(90deg, #10b981, #047857); width: 0%; transition: width 0.1s ease;"></div>
                    </div>
                    <div id="mic-audio-level" style="margin-top: 5px; font-size: 14px; color: #374151;">Level: 0.0%</div>
                </div>
                
                <div style="padding: 10px; background: #f3f4f6; border-radius: 6px; text-align: center;">
                    <div id="combined-signal-status" style="font-weight: bold; color: #374151;">Combined Signal: No</div>
                </div>
            </div>
        `;
        
        // Insert after audio controls
        const audioSection = document.getElementById('audio-controls-section');
        if (audioSection) {
            audioSection.appendChild(levelContainer);
        }
    }
    
    // Start monitoring levels
    const updateLevels = () => {
        if (!audioManager || !audioManager.isCapturing) {
            return;
        }
        
        // Update system audio levels
        const systemBar = document.getElementById('system-audio-bar');
        const systemLevel = document.getElementById('system-audio-level');
        if (systemBar && systemLevel) {
            const systemPercent = (audioManager.systemAudioLevel * 100).toFixed(1);
            systemBar.style.width = `${Math.min(systemPercent, 100)}%`;
            systemLevel.textContent = `Level: ${systemPercent}%`;
        }
        
        // Update microphone levels
        const micBar = document.getElementById('mic-audio-bar');
        const micLevel = document.getElementById('mic-audio-level');
        if (micBar && micLevel) {
            const micPercent = (audioManager.micAudioLevel * 100).toFixed(1);
            micBar.style.width = `${Math.min(micPercent, 100)}%`;
            micLevel.textContent = `Level: ${micPercent}%`;
        }
        
        // Update combined signal status
        const combinedStatus = document.getElementById('combined-signal-status');
        if (combinedStatus) {
            const hasSignal = audioManager.systemHasSignal || audioManager.micHasSignal;
            combinedStatus.textContent = `Combined Signal: ${hasSignal ? 'Yes' : 'No'}`;
            combinedStatus.style.color = hasSignal ? '#059669' : '#6b7280';
        }
        
        // Debug log - audioLevel is already a percentage (0-100)
        const systemPercent = audioManager.systemAudioLevel.toFixed(1);
        const micPercent = audioManager.micAudioLevel.toFixed(1);
        const hasSignal = audioManager.systemHasSignal || audioManager.micHasSignal;
        console.log(`Dual Audio - System: ${systemPercent}% Mic: ${micPercent}% Combined Signal: ${hasSignal}`);
        
        requestAnimationFrame(updateLevels);
    };
    
    // Start the monitoring loop
    requestAnimationFrame(updateLevels);
}

// ===== SALESFORCE EVENTS FUNCTIONALITY =====

async function loadUserEvents() {
    console.log('Loading user events from Salesforce...');
    
    const eventsLoading = document.getElementById('events-loading');
    const eventsContainer = document.getElementById('events-container');
    const eventsError = document.getElementById('events-error');
    
    // Show loading state
    if (eventsLoading) eventsLoading.style.display = 'flex';
    if (eventsContainer) eventsContainer.style.display = 'none';
    if (eventsError) eventsError.style.display = 'none';
    
    try {
        const result = await window.electronAPI.getUserEvents();
        console.log('User events result:', result);
        console.log('Result success:', result.success);
        console.log('Result events:', result.events);
        console.log('Result error:', result.error);
        
        if (result.success && result.events && result.events.length > 0) {
            console.log(`Found ${result.events.length} events, displaying them`);
            displayEvents(result.events);
        } else {
            console.log('No events found or error occurred. Success:', result.success, 'Error:', result.error);
            showEventsError();
        }
        
    } catch (error) {
        console.error('Error loading user events:', error);
        showEventsError();
    }
}

function displayEvents(events) {
    console.log(`Displaying ${events.length} events`);
    
    // Store events globally for context access
    loadedEvents = events;
    
    const eventsLoading = document.getElementById('events-loading');
    const eventsContainer = document.getElementById('events-container');
    const eventsError = document.getElementById('events-error');
    
    // Hide loading, show container
    if (eventsLoading) eventsLoading.style.display = 'none';
    if (eventsContainer) eventsContainer.style.display = 'flex';
    if (eventsError) eventsError.style.display = 'none';
    
    // Clear existing events
    eventsContainer.innerHTML = '';
    
    // Create event items
    events.forEach(event => {
        const eventElement = createEventElement(event);
        eventsContainer.appendChild(eventElement);
    });
}

function getEventDataById(eventId) {
    return loadedEvents.find(event => event.Event_Id === eventId);
}

function createEventElement(event) {
    const eventDiv = document.createElement('div');
    eventDiv.className = 'event-item';
    
    // Format time display
    const timeDisplay = formatEventTime(event.Start, event.End);
    
    eventDiv.innerHTML = `
        <div class="event-title">${escapeHtml(event.Title)}</div>
        ${timeDisplay ? `<div class="event-time">${timeDisplay}</div>` : ''}
        <div class="event-description">${escapeHtml(event.Description || 'No description')}</div>
        <div class="event-actions">
            <button class="btn-event" data-event-id="${event.Event_Id}" data-related-to-id="${event.RelatedToId}" data-event-title="${escapeHtml(event.Title)}">
                Individual
            </button>
        </div>
        <div class="event-session-container" style="display: none;">
            <!-- Session content will be added here when Individual is clicked -->
        </div>
    `;
    
    // Add secure event listener
    const button = eventDiv.querySelector('.btn-event');
    button.addEventListener('click', handleIndividualEventClick);
    
    return eventDiv;
}

function formatEventTime(start, end) {
    if (!start && !end) return '';
    
    try {
        let timeStr = '';
        if (start) {
            timeStr += `🕐 ${start}`;
        }
        if (end) {
            timeStr += start ? ` - ${end}` : `🕐 Until ${end}`;
        }
        return timeStr;
    } catch (error) {
        console.error('Error formatting event time:', error);
        return '';
    }
}

function showEventsError() {
    const eventsLoading = document.getElementById('events-loading');
    const eventsContainer = document.getElementById('events-container');
    const eventsError = document.getElementById('events-error');
    
    if (eventsLoading) eventsLoading.style.display = 'none';
    if (eventsContainer) eventsContainer.style.display = 'none';
    if (eventsError) eventsError.style.display = 'block';
}

// Store active event sessions
const activeEventSessions = new Map();

// Store loaded events for context access
let loadedEvents = [];

async function handleIndividualEventClick(event) {
    const button = event.target;
    const eventId = button.getAttribute('data-event-id');
    const relatedToId = button.getAttribute('data-related-to-id');
    const eventTitle = button.getAttribute('data-event-title');
    
    console.log(`Starting individual session for event: ${eventTitle} (${eventId})`);
    
    try {
        // Disable button and change text
        button.disabled = true;
        button.textContent = 'Starting...';
        
        // Get the session container for this event
        const eventItem = button.closest('.event-item');
        const sessionContainer = eventItem.querySelector('.event-session-container');
        
        // Connect to WebSocket first (following main session pattern)
        console.log('Connecting to WebSocket...');
        const wsResult = await window.electronAPI.connectWebSocket();
        if (!wsResult.success) {
            throw new Error('Failed to connect to WebSocket: ' + wsResult.error);
        }
        
        // Create session with event metadata
        console.log('Creating session with event metadata...');
        const contextData = {
            eventId: eventId,
            relatedToId: relatedToId,
            eventTitle: eventTitle,
            meetingBrief: eventData?.Meeting_Brief || '',
            competitiveIntelligence: eventData?.Competitive_Intelligence || '',
            agentCapabilities: eventData?.Agent_Capabilities || ''
        };
        
        console.log('📋 Sending context data to Heroku:', {
            eventId,
            relatedToId,
            eventTitle,
            hasMeetingBrief: !!(contextData.meetingBrief),
            hasCompetitiveIntelligence: !!(contextData.competitiveIntelligence),
            hasAgentCapabilities: !!(contextData.agentCapabilities)
        });
        
        const sessionResult = await window.electronAPI.createSession(contextData);
        if (!sessionResult.success) {
            throw new Error('Failed to create session');
        }
        
        const sessionId = sessionResult.sessionId;
        console.log('Session created with ID:', sessionId);
        
        // Get event context data from the event object
        const eventData = getEventDataById(eventId);
        console.log('📋 Event context data:', {
            eventId,
            hasMeetingBrief: !!(eventData?.Meeting_Brief),
            hasCompetitiveIntelligence: !!(eventData?.Competitive_Intelligence),
            hasAgentCapabilities: !!(eventData?.Agent_Capabilities),
            meetingBriefLength: eventData?.Meeting_Brief?.length || 0,
            competitiveIntelligenceLength: eventData?.Competitive_Intelligence?.length || 0,
            agentCapabilitiesLength: eventData?.Agent_Capabilities?.length || 0
        });
        
        // Store session info with context
        activeEventSessions.set(eventId, {
            sessionId: sessionId,
            eventId: eventId,
            relatedToId: relatedToId,
            eventTitle: eventTitle,
            meetingBrief: eventData?.Meeting_Brief || '',
            competitiveIntelligence: eventData?.Competitive_Intelligence || '',
            agentCapabilities: eventData?.Agent_Capabilities || '',
            transcriptLines: []
        });
        
        // Show session container with status
        sessionContainer.style.display = 'block';
        sessionContainer.innerHTML = `
            <div class="event-session-status">🎙️ Recording Session: ${escapeHtml(eventTitle)}</div>
            <div class="event-transcript" id="event-transcript-${eventId}">
                <div style="color: #6c757d; font-style: italic;">Starting audio capture and transcription...</div>
            </div>
        `;
        
        // Auto-start the session and audio capture
        console.log('Auto-starting session and audio capture...');
        const startResult = await window.electronAPI.startSession(sessionId);
        if (!startResult.success) {
            throw new Error('Failed to start session');
        }
        
        // Start audio capture
        const audioResult = await window.electronAPI.startAudioCapture();
        if (!audioResult.success) {
            throw new Error('Failed to start audio capture');
        }
        
        // Update button state
        button.textContent = 'Recording...';
        button.style.background = '#dc3545';
        
        // Update transcript container
        const transcriptDiv = document.getElementById(`event-transcript-${eventId}`);
        transcriptDiv.innerHTML = `
            <div style="color: #28a745; font-weight: 600;">🔴 Live Recording</div>
            <div style="color: #6c757d; font-size: 11px; margin-top: 5px;">Session ID: ${sessionId.session_id || sessionId}</div>
            <div id="event-transcript-content-${eventId}" style="margin-top: 10px;">
                <!-- Transcript lines will appear here -->
            </div>
        `;
        
        console.log(`✅ Individual session started for event: ${eventTitle}`);
        
    } catch (error) {
        console.error('Error starting individual event session:', error);
        
        // Reset button state
        button.disabled = false;
        button.textContent = 'Individual';
        button.style.background = '';
        
        // Show error in session container
        const eventItem = button.closest('.event-item');
        const sessionContainer = eventItem.querySelector('.event-session-container');
        sessionContainer.style.display = 'block';
        sessionContainer.innerHTML = `
            <div style="color: #dc3545; font-weight: 600;">❌ Error: ${error.message}</div>
            <div style="color: #6c757d; font-size: 12px; margin-top: 5px;">Click Individual to try again</div>
        `;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
