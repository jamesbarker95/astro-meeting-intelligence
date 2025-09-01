/**
 * Audio Processor for AssemblyAI Integration
 * Handles audio data conversion and streaming to AssemblyAI
 */

import { AssemblyAIService } from './assemblyai-service';
import { EventEmitter } from 'events';

export class AudioProcessor extends EventEmitter {
  private assemblyAI: AssemblyAIService;
  private isProcessing = false;

  constructor(apiKey: string) {
    super();
    this.assemblyAI = new AssemblyAIService(apiKey);
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.assemblyAI.on('connected', () => {
      console.log('🎵 AUDIO_PROCESSOR: AssemblyAI connected');
    });

    this.assemblyAI.on('transcript', (data) => {
      console.log('🎵 AUDIO_PROCESSOR: Transcript received:', data);
      // Forward transcript to main process
      this.emit('transcript', data);
    });

    this.assemblyAI.on('error', (error) => {
      console.error('🎵 AUDIO_PROCESSOR: AssemblyAI error:', error);
      this.emit('error', error);
    });

    this.assemblyAI.on('disconnected', (info) => {
      console.log('🎵 AUDIO_PROCESSOR: AssemblyAI disconnected:', info);
      this.isProcessing = false;
      this.emit('disconnected', info);
    });
  }

  async startProcessing(): Promise<void> {
    if (this.isProcessing) {
      console.warn('🎵 AUDIO_PROCESSOR: Already processing');
      return;
    }

    try {
      console.log('🎵 AUDIO_PROCESSOR: Starting audio processing...');
      await this.assemblyAI.connect();
      this.isProcessing = true;
      console.log('🎵 AUDIO_PROCESSOR: Audio processing started');
    } catch (error) {
      console.error('🎵 AUDIO_PROCESSOR: Failed to start processing:', error);
      throw error;
    }
  }

  async stopProcessing(): Promise<void> {
    if (!this.isProcessing) {
      console.warn('🎵 AUDIO_PROCESSOR: Not currently processing');
      return;
    }

    try {
      console.log('🎵 AUDIO_PROCESSOR: Stopping audio processing...');
      await this.assemblyAI.disconnect();
      this.isProcessing = false;
      console.log('🎵 AUDIO_PROCESSOR: Audio processing stopped');
    } catch (error) {
      console.error('🎵 AUDIO_PROCESSOR: Error stopping processing:', error);
      throw error;
    }
  }

  processAudioData(audioData: string): void {
    if (!this.isProcessing || !this.assemblyAI.isReady()) {
      console.warn('🎵 AUDIO_PROCESSOR: Cannot process audio - not ready');
      return;
    }

    try {
      // Convert base64 audio data to Buffer
      const audioBuffer = Buffer.from(audioData, 'base64');
      
      // Send to AssemblyAI
      this.assemblyAI.sendAudio(audioBuffer);
      
      // Debug log occasionally (every 50th chunk to reduce noise)
      if (Math.random() < 0.02) { // ~2% chance
        console.log('🎵 AUDIO_PROCESSOR: Audio chunk sent to AssemblyAI', {
          bufferSize: audioBuffer.length,
          sessionId: this.assemblyAI.getSessionId()
        });
      }
    } catch (error) {
      console.error('🎵 AUDIO_PROCESSOR: Error processing audio data:', error);
      this.emit('error', error);
    }
  }

  isReady(): boolean {
    return this.isProcessing && this.assemblyAI.isReady();
  }

  getSessionId(): string | null {
    return this.assemblyAI.getSessionId();
  }

  // EventEmitter methods are inherited from parent class
}
