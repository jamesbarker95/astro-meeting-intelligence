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
          
          // Initialize audio streaming buffer for system audio (50ms minimum for AssemblyAI)
          this.systemAudioBuffer = new Float32Array(800); // 50ms at 16kHz (AssemblyAI minimum)
          this.systemBufferIndex = 0;
          
          // Add timing control for audio chunk sending
          let lastAudioSendTime = 0;
          const AUDIO_SEND_INTERVAL = 50; // Send audio chunks every 50ms (AssemblyAI minimum)
          
          const updateSystemLevel = () => {
            if (this.isCapturing) {
              // Use time domain data for actual audio levels (not frequency data)
              const timeDataArray = new Float32Array(analyser.frequencyBinCount);
              analyser.getFloatTimeDomainData(timeDataArray);
              
              // Collect audio data for streaming (no downsampling - use raw 16kHz data)
              const samplesToTake = Math.min(timeDataArray.length, this.systemAudioBuffer.length - this.systemBufferIndex);
              for (let i = 0; i < samplesToTake; i++) {
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
              
              // Update combined levels
              this.updateCombinedLevels();
              
              // Only send audio chunks at controlled intervals (not every frame)
              const now = Date.now();
              if (now - lastAudioSendTime >= AUDIO_SEND_INTERVAL) {
                this.checkAndSendAudioChunk();
                lastAudioSendTime = now;
              }
              
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
      console.log('DEBUG: Microphone stream obtained');
      console.log('DEBUG: Microphone Stream settings:', this.micMediaStream.getAudioTracks()[0].getSettings());
      
      // Set up microphone audio level monitoring
      if (this.micMediaStream.getAudioTracks().length > 0) {
        console.log('DEBUG: Setting up Microphone AudioContext...');
        
        try {
          // Create AudioContext for microphone
          this.micAudioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 16000
          });
          console.log('DEBUG: Microphone AudioContext created, state:', this.micAudioContext.state);
          console.log('DEBUG: Microphone AudioContext sample rate:', this.micAudioContext.sampleRate);
          
          const source = this.micAudioContext.createMediaStreamSource(this.micMediaStream);
          console.log('DEBUG: Microphone MediaStreamSource created');
          
          const analyser = this.micAudioContext.createAnalyser();
          analyser.fftSize = 512;
          analyser.minDecibels = -90;
          analyser.maxDecibels = -10;
          analyser.smoothingTimeConstant = 0.8;
          source.connect(analyser);
          console.log('DEBUG: Microphone Analyser connected');
          
          // Set up microphone audio level monitoring and data collection
          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          let frameCount = 0;
          
          // Initialize audio streaming buffer for microphone (50ms minimum for AssemblyAI)
          this.micAudioBuffer = new Float32Array(800); // 50ms at 16kHz (AssemblyAI minimum)
          this.micBufferIndex = 0;
          
          // Add timing control for audio chunk sending (shared with system audio)
          let lastMicAudioSendTime = 0;
          const MIC_AUDIO_SEND_INTERVAL = 50; // Send audio chunks every 50ms (AssemblyAI minimum)
          
          const updateMicLevel = () => {
            if (this.isCapturing) {
              // Use time domain data for actual audio levels
              const timeDataArray = new Float32Array(analyser.frequencyBinCount);
              analyser.getFloatTimeDomainData(timeDataArray);
              
              // Collect audio data for streaming (no downsampling - use raw 16kHz data)
              const samplesToTake = Math.min(timeDataArray.length, this.micAudioBuffer.length - this.micBufferIndex);
              for (let i = 0; i < samplesToTake; i++) {
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
                console.log('DEBUG: Microphone Audio level:', this.micAudioLevel.toFixed(2), 'RMS:', rms.toFixed(4));
              }
              frameCount++;
              
              // Detect signal presence with lower threshold
              const hasSignal = this.micAudioLevel > 0.5;
              if (hasSignal !== this.micHasSignal) {
                this.micHasSignal = hasSignal;
                console.log('DEBUG: Microphone Signal changed to:', hasSignal);
              }
              
              // Update combined levels
              this.updateCombinedLevels();
              
              // Only send audio chunks at controlled intervals (not every frame)
              const now = Date.now();
              if (now - lastMicAudioSendTime >= MIC_AUDIO_SEND_INTERVAL) {
                this.checkAndSendAudioChunk();
                lastMicAudioSendTime = now;
              }
              
              requestAnimationFrame(updateMicLevel);
            }
          };
          
          // Resume AudioContext if needed
          if (this.micAudioContext.state === 'suspended') {
            console.log('DEBUG: Resuming suspended Microphone AudioContext...');
            await this.micAudioContext.resume();
          }
          
          updateMicLevel();
          console.log('DEBUG: Microphone Level monitoring started');
          
        } catch (audioError) {
          console.error('DEBUG: Microphone AudioContext setup failed:', audioError);
          throw audioError;
        }
        
        this.micHasSignal = true;
        this.emit('audio-signal-changed', true);
      } else {
        console.error('DEBUG: No microphone audio tracks found in stream');
      }
      
      console.log('DEBUG: Microphone audio capture completed successfully');
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
      
      // Calculate RMS level of the mixed audio to determine if it's worth sending
      let rms = 0;
      for (let i = 0; i < mixedBuffer.length; i++) {
        rms += mixedBuffer[i] * mixedBuffer[i];
      }
      rms = Math.sqrt(rms / mixedBuffer.length);
      const audioLevel = rms * 100; // Convert to percentage
      
      // Volume-based gating: Only send audio if it's above background noise threshold
      const AUDIO_GATE_THRESHOLD = 2.0; // 2% threshold - adjust based on testing
      const shouldSendAudio = audioLevel > AUDIO_GATE_THRESHOLD || this.hasAudioSignal;
      
      if (shouldSendAudio) {
        // Send audio chunk to main process for AssemblyAI transcription
        try {
          // Convert to base64 for transmission
          const audioData = btoa(String.fromCharCode(...new Uint8Array(pcmBuffer.buffer)));
          
          // Debug logging - reduced frequency (every 100th chunk to avoid spam)
          if (Math.random() < 0.01) {
            console.log('🎵 RENDERER: Sending audio chunk to AssemblyAI', {
              audioLevel: audioLevel.toFixed(2) + '%',
              threshold: AUDIO_GATE_THRESHOLD + '%',
              hasSignal: this.hasAudioSignal,
              pcmSamples: pcmBuffer.length,
              pcmBytes: pcmBuffer.buffer.byteLength,
              base64Length: audioData.length,
              base64Preview: audioData.substring(0, 20) + '...'
            });
          }
          
          // Send to main process for AssemblyAI transcription
          window.electronAPI.sendAudioData(audioData);
          
        } catch (error) {
          console.error('❌ RENDERER: Error sending audio chunk:', error);
        }
      } else {
        // Skip sending this chunk due to low volume (background noise)
        if (Math.random() < 0.005) { // Very occasional debug log for skipped chunks
          console.log('🔇 RENDERER: Skipping low-volume audio chunk', {
            audioLevel: audioLevel.toFixed(2) + '%',
            threshold: AUDIO_GATE_THRESHOLD + '%',
            hasSignal: this.hasAudioSignal
          });
        }
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

      // Set up audio level monitoring
      if (this.mediaStream.getAudioTracks().length > 0) {
        console.log('DEBUG: Setting up AudioContext...');
        
        try {
          // Create AudioContext
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
      
      console.log('DEBUG: Audio capture completed successfully');
      return true;
    } catch (error) {
      console.error('DEBUG: startAudioCapture failed:', error);
      return false;
    }
  }

  async stopAudioCapture() {
    try {
      console.log('DEBUG: stopAudioCapture() called');
      
      this.isCapturing = false;
      
      // Stop system audio
      if (this.systemAudioContext) {
        await this.systemAudioContext.close();
        this.systemAudioContext = null;
      }
      if (this.systemMediaStream) {
        this.systemMediaStream.getTracks().forEach(track => track.stop());
        this.systemMediaStream = null;
      }
      
      // Stop microphone audio
      if (this.micAudioContext) {
        await this.micAudioContext.close();
        this.micAudioContext = null;
      }
      if (this.micMediaStream) {
        this.micMediaStream.getTracks().forEach(track => track.stop());
        this.micMediaStream = null;
      }
      
      // Stop legacy audio context
      if (this.audioContext) {
        await this.audioContext.close();
        this.audioContext = null;
      }
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => track.stop());
        this.mediaStream = null;
      }
      
      // Reset levels and signals
      this.systemAudioLevel = 0;
      this.systemHasSignal = false;
      this.micAudioLevel = 0;
      this.micHasSignal = false;
      this.audioLevel = 0;
      this.hasAudioSignal = false;
      
      // Reset buffers
      this.systemAudioBuffer = null;
      this.systemBufferIndex = 0;
      this.micAudioBuffer = null;
      this.micBufferIndex = 0;
      
      this.emit('audio-signal-changed', false);
      console.log('DEBUG: Audio capture stopped successfully');
      return true;
    } catch (error) {
      console.error('DEBUG: stopAudioCapture failed:', error);
      return false;
    }
  }

  getAudioLevel() {
    return this.audioLevel;
  }

  hasSignal() {
    return this.hasAudioSignal;
  }

  isCapturingAudio() {
    return this.isCapturing;
  }

  // Individual microphone control methods
  async stopMicrophoneOnly() {
    try {
      console.log('DEBUG: stopMicrophoneOnly() called');
      
      // Stop microphone audio
      if (this.micAudioContext) {
        await this.micAudioContext.close();
        this.micAudioContext = null;
      }
      if (this.micMediaStream) {
        this.micMediaStream.getTracks().forEach(track => track.stop());
        this.micMediaStream = null;
      }
      
      // Reset microphone-specific flags
      this.micHasSignal = false;
      this.micAudioLevel = 0;
      
      console.log('DEBUG: Microphone stopped successfully');
      this.emit('microphone-stopped');
      return true;
    } catch (error) {
      console.error('DEBUG: stopMicrophoneOnly failed:', error);
      return false;
    }
  }

  async startMicrophoneOnly() {
    try {
      console.log('DEBUG: startMicrophoneOnly() called');
      
      // Only start microphone if we don't already have it
      if (this.micMediaStream) {
        console.log('DEBUG: Microphone already active');
        return true;
      }
      
      // Use the existing startMicrophoneCapture method
      const success = await this.startMicrophoneCapture();
      if (success) {
        this.emit('microphone-started');
      }
      return success;
    } catch (error) {
      console.error('DEBUG: startMicrophoneOnly failed:', error);
      return false;
    }
  }

  isMicrophoneActive() {
    return this.micMediaStream !== null;
  }

  isSystemAudioActive() {
    return this.systemMediaStream !== null;
  }
}

// Export for use in renderer
window.RendererAudioManager = RendererAudioManager;