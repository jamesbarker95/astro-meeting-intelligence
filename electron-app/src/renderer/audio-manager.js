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
