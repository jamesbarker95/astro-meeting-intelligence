/**
 * AssemblyAI Real-time Transcription Service for Electron
 * Based on the working examples provided
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';

interface AssemblyAIConfig {
  apiKey: string;
  sampleRate: number;
  formatTurns: boolean;
}

interface TranscriptData {
  transcript: string;
  confidence: number;
  isFinal: boolean;
  timestamp: number;
}

export class AssemblyAIService extends EventEmitter {
  private config: AssemblyAIConfig;
  private ws: WebSocket | null = null;
  private isConnected = false;
  private sessionId: string | null = null;

  constructor(apiKey: string) {
    super();
    this.config = {
      apiKey,
      sampleRate: 16000,
      formatTurns: true
    };
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const params = new URLSearchParams({
          sample_rate: this.config.sampleRate.toString(),
          format_turns: this.config.formatTurns.toString()
        });

        const wsUrl = `wss://streaming.assemblyai.com/v3/ws?${params}`;
        
        console.log('🎵 ASSEMBLYAI: Connecting to:', wsUrl);
        
        this.ws = new WebSocket(wsUrl, {
          headers: {
            'Authorization': this.config.apiKey
          }
        });

        this.ws.on('open', () => {
          console.log('🎵 ASSEMBLYAI: WebSocket connection opened');
          this.isConnected = true;
          this.emit('connected');
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleMessage(message);
          } catch (error) {
            console.error('🎵 ASSEMBLYAI: Error parsing message:', error);
            this.emit('error', error);
          }
        });

        this.ws.on('error', (error) => {
          console.error('🎵 ASSEMBLYAI: WebSocket error:', error);
          this.isConnected = false;
          this.emit('error', error);
          reject(error);
        });

        this.ws.on('close', (code, reason) => {
          console.log('🎵 ASSEMBLYAI: WebSocket closed:', code, reason.toString());
          this.isConnected = false;
          this.sessionId = null;
          this.emit('disconnected', { code, reason: reason.toString() });
        });

      } catch (error) {
        console.error('🎵 ASSEMBLYAI: Connection error:', error);
        reject(error);
      }
    });
  }

  private handleMessage(message: any): void {
    const msgType = message.type;

    switch (msgType) {
      case 'Begin':
        this.sessionId = message.id;
        const expiresAt = message.expires_at;
        console.log(`🎵 ASSEMBLYAI: Session began - ID: ${this.sessionId}, Expires: ${new Date(expiresAt * 1000).toISOString()}`);
        this.emit('session_started', { sessionId: this.sessionId, expiresAt });
        break;

      case 'Turn':
        const transcript = message.transcript || '';
        const formatted = message.turn_is_formatted || false;
        const endOfTurn = message.end_of_turn || false;

        if (transcript) {
          const transcriptData: TranscriptData = {
            transcript,
            confidence: 1.0, // AssemblyAI doesn't provide confidence in streaming
            isFinal: formatted && endOfTurn,
            timestamp: Date.now()
          };

          console.log(`🎵 ASSEMBLYAI: Transcript - Final: ${transcriptData.isFinal}, Text: "${transcript.substring(0, 50)}..."`);
          this.emit('transcript', transcriptData);
        }
        break;

      case 'Termination':
        const audioDuration = message.audio_duration_seconds || 0;
        const sessionDuration = message.session_duration_seconds || 0;
        console.log(`🎵 ASSEMBLYAI: Session terminated - Audio: ${audioDuration}s, Session: ${sessionDuration}s`);
        this.emit('session_ended', { audioDuration, sessionDuration });
        break;

      default:
        console.log('🎵 ASSEMBLYAI: Unknown message type:', msgType, message);
        break;
    }
  }

  sendAudio(audioData: Buffer): void {
    if (!this.isConnected || !this.ws) {
      console.warn('🎵 ASSEMBLYAI: Cannot send audio - not connected');
      return;
    }

    try {
      this.ws.send(audioData);
    } catch (error) {
      console.error('🎵 ASSEMBLYAI: Error sending audio:', error);
      this.emit('error', error);
    }
  }

  async disconnect(): Promise<void> {
    if (!this.ws) {
      return;
    }

    return new Promise((resolve) => {
      if (this.ws && this.isConnected) {
        // Send termination message
        try {
          const terminateMessage = { type: 'Terminate' };
          console.log('🎵 ASSEMBLYAI: Sending termination message');
          this.ws.send(JSON.stringify(terminateMessage));
        } catch (error) {
          console.error('🎵 ASSEMBLYAI: Error sending termination message:', error);
        }

        // Close connection
        this.ws.close();
        
        // Wait a bit for clean closure
        setTimeout(() => {
          this.isConnected = false;
          this.sessionId = null;
          this.ws = null;
          resolve();
        }, 500);
      } else {
        this.isConnected = false;
        this.sessionId = null;
        this.ws = null;
        resolve();
      }
    });
  }

  isReady(): boolean {
    return this.isConnected && this.ws !== null;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }
}
