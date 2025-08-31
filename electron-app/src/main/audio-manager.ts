import { EventEmitter } from 'events';
import { WebSocketManager } from './websocket/websocket-manager';

// Simple stub AudioManager to maintain compatibility
// The real audio capture happens in the renderer process
export class AudioManager extends EventEmitter {
  private isCapturing = false;
  private websocketManager: WebSocketManager | null = null;

  constructor() {
    super();
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
    console.log('AudioManager (stub): Audio capture started');
    this.isCapturing = true;
    this.emit('started');
  }

  stopAudioCapture(): void {
    console.log('AudioManager (stub): Audio capture stopped');
    this.isCapturing = false;
    this.emit('stopped');
  }

  async receiveAudioData(audioData: ArrayBuffer | string): Promise<void> {
    // Enhanced debug logging
    console.log('🎧 AUDIO MANAGER: Received audio data', {
      dataType: typeof audioData,
      dataLength: audioData instanceof ArrayBuffer ? audioData.byteLength : audioData.length,
      isArrayBuffer: audioData instanceof ArrayBuffer,
      isString: typeof audioData === 'string',
      preview: typeof audioData === 'string' ? audioData.substring(0, 20) + '...' : 'binary data'
    });
    
    // Forward to WebSocket manager
    if (this.websocketManager) {
      try {
        // Ensure audioData is a string (base64) for WebSocket transmission
        const audioString = typeof audioData === 'string' ? audioData : 
          Buffer.from(audioData).toString('base64');
        
        await this.websocketManager.sendAudioChunk(audioString);
        console.log('✅ AUDIO MANAGER: Successfully forwarded audio to WebSocket');
      } catch (error) {
        console.error('❌ AUDIO MANAGER: Failed to forward audio to WebSocket:', error);
      }
    } else {
      console.log('⚠️ AUDIO MANAGER: No WebSocket manager available - audio not forwarded');
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