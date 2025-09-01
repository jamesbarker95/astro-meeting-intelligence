import { EventEmitter } from 'events';
import { WebSocketManager } from './websocket/websocket-manager';
import { AudioProcessor } from './services/audio-processor';

// AudioManager with AssemblyAI transcription support
// The real audio capture happens in the renderer process
export class AudioManager extends EventEmitter {
  private isCapturing = false;
  private websocketManager: WebSocketManager | null = null;
  private audioProcessor: AudioProcessor | null = null;
  private assemblyAIApiKey = 'adec0151627147e9813c8da9cf7bcb4d'; // AssemblyAI API key

  constructor() {
    super();
    this.initializeAudioProcessor();
  }

  private initializeAudioProcessor(): void {
    try {
      this.audioProcessor = new AudioProcessor(this.assemblyAIApiKey);
      
      // Set up event handlers for transcription
      this.audioProcessor.on('transcript', (transcriptData: any) => {
        console.log('🎵 AUDIO MANAGER: Transcript received:', transcriptData);
        
        // Send transcript to Heroku via WebSocket
        if (this.websocketManager) {
          this.websocketManager.sendTranscript(transcriptData);
        }
        
        // Emit to main process for UI updates
        this.emit('transcript', transcriptData);
      });

      this.audioProcessor.on('error', (error: any) => {
        console.error('🎵 AUDIO MANAGER: AudioProcessor error:', error);
        this.emit('transcription_error', error);
      });

      console.log('🎵 AUDIO MANAGER: AudioProcessor initialized');
    } catch (error) {
      console.error('🎵 AUDIO MANAGER: Failed to initialize AudioProcessor:', error);
    }
  }

  setWebSocketManager(websocketManager: WebSocketManager): void {
    this.websocketManager = websocketManager;
    console.log('🔗 AUDIO MANAGER: WebSocket manager connected');
  }

  async initialize(): Promise<void> {
    console.log('AudioManager (stub): Initialized');
    this.emit('initialized');
  }

  async startAudioCapture(): Promise<void> {
    console.log('🎵 AUDIO MANAGER: Starting audio capture with AssemblyAI transcription');
    
    try {
      // Start AssemblyAI processing
      if (this.audioProcessor) {
        await this.audioProcessor.startProcessing();
        console.log('🎵 AUDIO MANAGER: AssemblyAI processing started');
      }
      
      this.isCapturing = true;
      this.emit('started');
      console.log('🎵 AUDIO MANAGER: Audio capture started successfully');
    } catch (error) {
      console.error('🎵 AUDIO MANAGER: Failed to start audio capture:', error);
      this.emit('error', error);
      throw error;
    }
  }

  stopAudioCapture(): void {
    console.log('🎵 AUDIO MANAGER: Stopping audio capture');
    
    try {
      // Stop AssemblyAI processing
      if (this.audioProcessor) {
        this.audioProcessor.stopProcessing();
        console.log('🎵 AUDIO MANAGER: AssemblyAI processing stopped');
      }
      
      this.isCapturing = false;
      this.emit('stopped');
      console.log('🎵 AUDIO MANAGER: Audio capture stopped successfully');
    } catch (error) {
      console.error('🎵 AUDIO MANAGER: Error stopping audio capture:', error);
    }
  }

  async receiveAudioData(audioData: ArrayBuffer | string): Promise<void> {
    // Debug logging (reduced frequency to avoid spam)
    if (Math.random() < 0.01) { // ~1% chance
      console.log('🎧 AUDIO MANAGER: Received audio data', {
        dataType: typeof audioData,
        dataLength: audioData instanceof ArrayBuffer ? audioData.byteLength : audioData.length,
        isArrayBuffer: audioData instanceof ArrayBuffer,
        isString: typeof audioData === 'string',
        hasAudioProcessor: !!this.audioProcessor,
        audioProcessorReady: this.audioProcessor ? this.audioProcessor.isReady() : false
      });
    }
    
    // Send audio to AssemblyAI for transcription
    if (this.audioProcessor && this.audioProcessor.isReady()) {
      try {
        // Ensure audioData is a string (base64) for AssemblyAI processing
        const audioString = typeof audioData === 'string' ? audioData : 
          Buffer.from(audioData).toString('base64');
        
        this.audioProcessor.processAudioData(audioString);
        
        // Debug log occasionally
        if (Math.random() < 0.01) {
          console.log('🎵 AUDIO MANAGER: Sent audio to AssemblyAI processor');
        }
      } catch (error) {
        console.error('❌ AUDIO MANAGER: Failed to process audio with AssemblyAI:', error);
      }
    } else {
      // Debug why AssemblyAI isn't processing
      if (Math.random() < 0.01) {
        console.log('🎵 AUDIO MANAGER: NOT sending to AssemblyAI', {
          hasAudioProcessor: !!this.audioProcessor,
          audioProcessorReady: this.audioProcessor ? this.audioProcessor.isReady() : false
        });
      }
    }
    
    // Still forward to WebSocket manager for compatibility (but Heroku won't process it)
    if (this.websocketManager) {
      try {
        const audioString = typeof audioData === 'string' ? audioData : 
          Buffer.from(audioData).toString('base64');
        
        await this.websocketManager.sendAudioChunk(audioString);
      } catch (error) {
        console.error('❌ AUDIO MANAGER: Failed to forward audio to WebSocket:', error);
      }
    }
  }

  getStatus(): { isCapturing: boolean; hasAudioSignal: boolean; audioLevel: number } {
    return {
      isCapturing: this.isCapturing,
      hasAudioSignal: false,
      audioLevel: 0
    };
  }

  cleanup(): void {
    this.stopAudioCapture();
    this.removeAllListeners();
  }
}