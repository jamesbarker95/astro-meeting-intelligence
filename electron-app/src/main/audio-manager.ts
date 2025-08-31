import { EventEmitter } from 'events';

// Simple stub AudioManager to maintain compatibility
// The real audio capture happens in the renderer process
export class AudioManager extends EventEmitter {
  private isCapturing = false;

  constructor() {
    super();
  }

  async initialize(): Promise<void> {
    console.log('AudioManager (stub): Initialized');
    this.emit('initialized');
  }

  async startAudioCapture(): Promise<void> {
    console.log('AudioManager (stub): Audio capture started');
    this.isCapturing = true;
    this.emit('started');
  }

  stopAudioCapture(): void {
    console.log('AudioManager (stub): Audio capture stopped');
    this.isCapturing = false;
    this.emit('stopped');
  }

  receiveAudioData(audioData: ArrayBuffer): void {
    // This is where audio data from renderer would be processed
    // For now, just log that we received it
    console.log('AudioManager (stub): Received audio data:', audioData.byteLength, 'bytes');
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