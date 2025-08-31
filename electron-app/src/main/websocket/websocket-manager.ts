import { io, Socket } from 'socket.io-client';

export interface SessionData {
  session_id: string;
  status: string;
  created_at: string;
  started_at?: string;
  ended_at?: string;
  duration?: number;
  type?: string;
  transcript_count?: number;
  word_count?: number;
}

export interface WebSocketEvents {
  onConnect: () => void;
  onDisconnect: () => void;
  onError: (error: string) => void;
  onSessionCreated: (session: SessionData) => void;
  onSessionStarted: (session: SessionData) => void;
  onSessionEnded: (session: SessionData) => void;
  onTranscriptLine: (text: string) => void;
}

export class WebSocketManager {
  private socket: Socket | null = null;
  private isConnected: boolean = false;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;
  private events: WebSocketEvents;
  private pendingCallbacks: Map<string, { resolve: Function; reject: Function }> = new Map();
  private currentSessionId: string | null = null;

  constructor(events: WebSocketEvents) {
    this.events = events;
  }

  public async connect(backendUrl: string): Promise<boolean> {
    try {
      console.log('Connecting to WebSocket:', backendUrl);
      
      this.socket = io(backendUrl, {
        transports: ['websocket', 'polling'],
        timeout: 10000,
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: this.reconnectDelay
      });

      this.setupEventListeners();
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
        }, 10000);

        this.socket!.on('connect', () => {
          clearTimeout(timeout);
          this.isConnected = true;
          console.log('WebSocket connected successfully');
          this.events.onConnect();
          resolve(true);
        });

        this.socket!.on('connect_error', (error) => {
          clearTimeout(timeout);
          console.error('WebSocket connection error:', error);
          this.events.onError(error.message);
          reject(error);
        });
      });
    } catch (error) {
      console.error('Error connecting to WebSocket:', error);
      this.events.onError(error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  public async disconnect(): Promise<boolean> {
    try {
      if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
      }
      this.isConnected = false;
      this.currentSessionId = null;
      console.log('WebSocket disconnected');
      this.events.onDisconnect();
      return true;
    } catch (error) {
      console.error('Error disconnecting from WebSocket:', error);
      return false;
    }
  }

  public isSocketConnected(): boolean {
    return this.isConnected && this.socket?.connected === true;
  }

  private setupEventListeners(): void {
    if (!this.socket) return;

    this.socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
      this.isConnected = false;
      this.events.onDisconnect();
    });

    this.socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
      this.events.onError(error.message);
    });

    this.socket.on('error', (error) => {
      console.error('WebSocket error:', error);
      this.events.onError(error.message || 'Unknown WebSocket error');
    });

    // Session event handlers
    this.socket.on('session_created', (response: any) => {
      console.log('Session created response:', response);
      if (response.success) {
        this.currentSessionId = response.session.session_id;
        this.events.onSessionCreated(response.session);
      } else {
        this.events.onError(`Session creation failed: ${response.error}`);
      }
    });

    this.socket.on('session_started', (response: any) => {
      console.log('Session started response:', response);
      if (response.success) {
        this.events.onSessionStarted(response.session);
      } else {
        this.events.onError(`Session start failed: ${response.error}`);
      }
    });

    this.socket.on('session_ended', (response: any) => {
      console.log('Session ended response:', response);
      if (response.success) {
        this.currentSessionId = null;
        this.events.onSessionEnded(response.session);
      } else {
        this.events.onError(`Session end failed: ${response.error}`);
      }
    });

    this.socket.on('transcript_line', (data: { session_id: string; text: string }) => {
      console.log('Transcript line received:', data.text);
      this.events.onTranscriptLine(data.text);
    });
  }

  public createSession(): Promise<SessionData> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.isConnected) {
        reject(new Error('WebSocket not connected'));
        return;
      }
      console.log('Creating session...');
      const callbackId = 'create_session_' + Date.now();
      this.pendingCallbacks.set(callbackId, { resolve, reject });
      setTimeout(() => {
        if (this.pendingCallbacks.has(callbackId)) {
          this.pendingCallbacks.delete(callbackId);
          reject(new Error('Session creation timeout'));
        }
      }, 10000);
      const handleSessionCreated = (response: any) => {
        if (this.pendingCallbacks.has(callbackId)) {
          this.pendingCallbacks.delete(callbackId);
          this.socket?.off('session_created', handleSessionCreated);
          if (response.success) {
            resolve(response.session);
          } else {
            reject(new Error(response.error || 'Failed to create session'));
          }
        }
      };
      this.socket.on('session_created', handleSessionCreated);
      this.socket.emit('create_session', {});
    });
  }

  public startSession(sessionId: string): Promise<SessionData> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.isConnected) {
        reject(new Error('WebSocket not connected'));
        return;
      }
      console.log('Starting session:', sessionId);
      const callbackId = 'start_session_' + Date.now();
      this.pendingCallbacks.set(callbackId, { resolve, reject });
      setTimeout(() => {
        if (this.pendingCallbacks.has(callbackId)) {
          this.pendingCallbacks.delete(callbackId);
          reject(new Error('Session start timeout'));
        }
      }, 10000);
      const handleSessionStarted = (response: any) => {
        if (this.pendingCallbacks.has(callbackId)) {
          this.pendingCallbacks.delete(callbackId);
          this.socket?.off('session_started', handleSessionStarted);
          if (response.success) {
            resolve(response.session);
          } else {
            reject(new Error(response.error || 'Failed to start session'));
          }
        }
      };
      this.socket.on('session_started', handleSessionStarted);
      this.socket.emit('start_session', { session_id: sessionId });
    });
  }

  public endSession(sessionId: string): Promise<SessionData> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.isConnected) {
        reject(new Error('WebSocket not connected'));
        return;
      }
      console.log('Ending session:', sessionId);
      const callbackId = 'end_session_' + Date.now();
      this.pendingCallbacks.set(callbackId, { resolve, reject });
      setTimeout(() => {
        if (this.pendingCallbacks.has(callbackId)) {
          this.pendingCallbacks.delete(callbackId);
          reject(new Error('Session end timeout'));
        }
      }, 10000);
      const handleSessionEnded = (response: any) => {
        if (this.pendingCallbacks.has(callbackId)) {
          this.pendingCallbacks.delete(callbackId);
          this.socket?.off('session_ended', handleSessionEnded);
          if (response.success) {
            resolve(response.session);
          } else {
            reject(new Error(response.error || 'Failed to end session'));
          }
        }
      };
      this.socket.on('session_ended', handleSessionEnded);
      this.socket.emit('end_session', { session_id: sessionId });
    });
  }

  public sendAudioChunk(audioData: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.isConnected) {
        reject(new Error('WebSocket not connected'));
        return;
      }
      
      if (!this.currentSessionId) {
        reject(new Error('No active session for audio transmission'));
        return;
      }

      console.log('Sending audio chunk, session:', this.currentSessionId);
      this.socket.emit('audio_chunk', {
        session_id: this.currentSessionId,
        audio: audioData
      });
      
      // For audio chunks, we don't wait for acknowledgment
      resolve(true);
    });
  }

  public sendTranscriptLine(text: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.isConnected) {
        reject(new Error('WebSocket not connected'));
        return;
      }
      
      console.log('Sending transcript line:', text);
      this.socket.emit('transcript_line', { text });
      resolve(true);
    });
  }

  public joinSession(sessionId: string): void {
    if (this.socket && this.isConnected) {
      this.socket.emit('join_session', { session_id: sessionId });
      this.currentSessionId = sessionId;
    }
  }

  public leaveSession(): void {
    if (this.socket && this.isConnected && this.currentSessionId) {
      this.socket.emit('leave_session', { session_id: this.currentSessionId });
      this.currentSessionId = null;
    }
  }

  public getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }
}
