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
  private pendingOAuthToken: string | null = null;

  constructor(events: WebSocketEvents) {
    this.events = events;
  }

  public async connect(backendUrl: string): Promise<boolean> {
    try {
      console.log('WebSocketManager: Connecting to:', backendUrl);
      
      this.socket = io(backendUrl, {
        transports: ['websocket', 'polling'],
        timeout: 10000,
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: this.reconnectDelay
      });

      console.log('WebSocketManager: Socket created, setting up event listeners...');
      this.setupEventListeners();
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          console.error('WebSocketManager: Connection timeout after 10 seconds');
          reject(new Error('WebSocket connection timeout'));
        }, 10000);

        this.socket!.on('connect', () => {
          clearTimeout(timeout);
          this.isConnected = true;
          console.log('WebSocketManager: Successfully connected to Heroku backend');
          this.events.onConnect();
          resolve(true);
        });

        this.socket!.on('connect_error', (error) => {
          clearTimeout(timeout);
          console.error('WebSocketManager: Connection error:', error);
          this.events.onError(error.message);
          reject(error);
        });
      });
    } catch (error) {
      console.error('WebSocketManager: Error connecting to WebSocket:', error);
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
      console.log('WebSocketManager: Received session_created from Heroku:', response);
      console.log('WebSocketManager: Response structure:', JSON.stringify(response, null, 2));
      
      if (response.success) {
        this.currentSessionId = response.session.session_id;
        console.log('WebSocketManager: Forwarding full response to renderer:', response);
        // Send the FULL response to maintain the structure the renderer expects
        this.events.onSessionCreated(response);
      } else {
        console.error('WebSocketManager: Session creation failed:', response.error);
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

  public createSession(contextData?: any): Promise<SessionData> {
    return new Promise(async (resolve, reject) => {
      if (!this.socket || !this.isConnected) {
        console.error('WebSocketManager: Cannot create session - WebSocket not connected');
        reject(new Error('WebSocket not connected'));
        return;
      }
      console.log('WebSocketManager: Creating session...');
      const callbackId = 'create_session_' + Date.now();
      this.pendingCallbacks.set(callbackId, { resolve, reject });
      setTimeout(() => {
        if (this.pendingCallbacks.has(callbackId)) {
          this.pendingCallbacks.delete(callbackId);
          console.error('WebSocketManager: Session creation timeout');
          reject(new Error('Session creation timeout'));
        }
      }, 10000);
      const handleSessionCreated = (response: any) => {
        console.log('WebSocketManager: Received session_created response:', response);
        if (this.pendingCallbacks.has(callbackId)) {
          this.pendingCallbacks.delete(callbackId);
          this.socket?.off('session_created', handleSessionCreated);
          if (response.success) {
            // Handle different response structures
            const session = response.session || response;
            const sessionId = session.session_id || session.id || response.session_id || response.id;
            
            console.log('WebSocketManager: Session object:', session);
            console.log('WebSocketManager: Extracted session ID:', sessionId);
            
            if (sessionId) {
              this.currentSessionId = sessionId;
              console.log('WebSocketManager: Session created successfully with ID:', sessionId);
              
              // Send OAuth token if we have one (hybrid approach)
              if (this.pendingOAuthToken) {
                console.log('WebSocketManager: Sending OAuth token for AI features...');
                this.socket?.emit('session_token', {
                  session_id: sessionId,
                  access_token: this.pendingOAuthToken
                });
                this.pendingOAuthToken = null; // Clear after sending
              }
              
              resolve(session);
            } else {
              console.error('WebSocketManager: No session ID found in response. Response structure:', JSON.stringify(response, null, 2));
              reject(new Error('No session ID in response'));
            }
          } else {
            console.error('WebSocketManager: Session creation failed:', response.error);
            reject(new Error(response.error || 'Failed to create session'));
          }
        }
      };
      this.socket.on('session_created', handleSessionCreated);
      console.log('WebSocketManager: Emitting create_session event...');
      
      // Prepare session data with context if provided
      const sessionData = {
        type: contextData ? 'event' : 'manual',
        meeting_brief: contextData?.meetingBrief || '',
        competitive_intelligence: contextData?.competitiveIntelligence || '',
        agent_capabilities: contextData?.agentCapabilities || '',
        meeting_info: contextData ? {
          event_id: contextData.eventId,
          related_to_id: contextData.relatedToId,
          event_title: contextData.eventTitle
        } : {}
      };
      
      console.log('WebSocketManager: Session data:', sessionData);
      this.socket.emit('create_session', sessionData);
      
      // Get OAuth token and send it separately (hybrid approach)
      try {
        console.log('WebSocketManager: Getting OAuth token for AI features...');
        const { AuthManager } = await import('../auth/auth-manager');
        const authManager = AuthManager.getInstance();
        const tokenData = await authManager.getSalesforceAccessToken();
        
        if (tokenData && tokenData.access_token) {
          console.log('WebSocketManager: OAuth token obtained, sending to Heroku...');
          // We'll send the token after we get the session_created response with session_id
          this.pendingOAuthToken = tokenData.access_token;
        } else {
          console.warn('WebSocketManager: No OAuth token available - AI features may not work');
        }
      } catch (error) {
        console.error('WebSocketManager: Failed to get OAuth token:', error);
        // Don't fail session creation if OAuth fails - just log the warning
      }
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
            // Handle different response structures
            const session = response.session || response;
            const sessionId = session.session_id || session.id || response.session_id || response.id;
            
            if (sessionId) {
              this.currentSessionId = sessionId;
              console.log('Session started with ID:', sessionId);
              resolve(session);
            } else {
              reject(new Error('No session ID in response'));
            }
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
            // Handle different response structures
            const session = response.session || response;
            resolve(session);
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
        console.log('❌ WEBSOCKET: Cannot send audio - not connected');
        reject(new Error('WebSocket not connected'));
        return;
      }
      
      if (!this.currentSessionId) {
        console.log('❌ WEBSOCKET: Cannot send audio - no active session');
        reject(new Error('No active session for audio transmission'));
        return;
      }

      console.log('📡 WEBSOCKET: Sending audio chunk', {
        sessionId: this.currentSessionId,
        dataLength: audioData.length,
        dataPreview: audioData.substring(0, 20) + '...',
        socketConnected: this.isConnected
      });
      
      this.socket.emit('audio_chunk', {
        session_id: this.currentSessionId,
        audio: audioData
      });
      
      console.log('✅ WEBSOCKET: Audio chunk emitted successfully');
      
      // For audio chunks, we don't wait for acknowledgment
      resolve(true);
    });
  }

  public sendTranscript(transcriptData: any): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.isConnected) {
        console.log('❌ WEBSOCKET: Cannot send transcript - not connected');
        reject(new Error('WebSocket not connected'));
        return;
      }
      
      if (!this.currentSessionId) {
        console.log('❌ WEBSOCKET: Cannot send transcript - no active session');
        reject(new Error('No active session for transcript transmission'));
        return;
      }

      console.log('📝 WEBSOCKET: Sending transcript to Heroku:', {
        sessionId: this.currentSessionId,
        transcript: transcriptData.transcript?.substring(0, 50) + '...',
        isFinal: transcriptData.isFinal,
        confidence: transcriptData.confidence
      });
      
      this.socket.emit('transcript_line', {
        session_id: this.currentSessionId,
        transcript: transcriptData.transcript,
        speaker: 'system', // Since this comes from AssemblyAI
        confidence: transcriptData.confidence || 1.0,
        is_final: transcriptData.isFinal || false,
        timestamp: transcriptData.timestamp || Date.now()
      });
      
      console.log('✅ WEBSOCKET: Transcript sent successfully');
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
