import { io, Socket } from 'socket.io-client';
import { AuthManager } from '../auth/auth-manager';

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
  private sessionStartInProgress: boolean = false;
  private sessionState: 'none' | 'created' | 'starting' | 'active' | 'ended' = 'none';
  private authManager: AuthManager;
  private audioManager: any = null; // Will be injected for AI insights
  private mainWindow: Electron.BrowserWindow | null = null;

  constructor(events: WebSocketEvents, authManager: AuthManager) {
    this.events = events;
    this.authManager = authManager;
  }

  setMainWindow(mainWindow: Electron.BrowserWindow): void {
    this.mainWindow = mainWindow;
  }

  setAudioManager(audioManager: any): void {
    this.audioManager = audioManager;
    console.log('🔗 WEBSOCKET MANAGER: Audio manager connected for AI insights');
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
      // Reset all session flags on manual disconnect
      this.sessionStartInProgress = false;
      this.sessionState = 'none';
      this.currentSessionId = null;
      console.log('WebSocket disconnected - all session flags reset');
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
      // Reset all session flags on disconnect to ensure clean state
      this.sessionStartInProgress = false;
      this.sessionState = 'none';
      this.currentSessionId = null;
      console.log('WebSocketManager: Disconnect - all session flags reset');
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
        this.sessionState = 'created';
        console.log('WebSocketManager: Session created, state:', this.sessionState);
        console.log('WebSocketManager: Forwarding full response to renderer:', response);
        // Send the FULL response to maintain the structure the renderer expects
        this.events.onSessionCreated(response);
      } else {
        console.error('WebSocketManager: Session creation failed:', response.error);
        this.sessionState = 'none';
        this.events.onError(`Session creation failed: ${response.error}`);
      }
    });

    this.socket.on('session_started', (response: any) => {
      console.log('Session started response:', response);
      if (response.success) {
        this.sessionState = 'active';
        this.sessionStartInProgress = false;
        console.log('WebSocketManager: Session started successfully, state:', this.sessionState);
        this.events.onSessionStarted(response.session);
      } else {
        this.sessionState = 'created'; // Reset to created state on failure
        this.sessionStartInProgress = false;
        console.log('WebSocketManager: Session start failed, state reset to:', this.sessionState);
        this.events.onError(`Session start failed: ${response.error}`);
      }
    });

    this.socket.on('session_ended', (response: any) => {
      console.log('Session ended response:', response);
      if (response.success) {
        this.currentSessionId = null;
        // Reset session state flags when session ends successfully
        this.sessionStartInProgress = false;
        this.sessionState = 'none';
        console.log('WebSocketManager: Session ended successfully, flags reset');
        this.events.onSessionEnded(response.session);
      } else {
        // Also reset flags on session end failure to allow retry
        this.sessionStartInProgress = false;
        this.sessionState = 'none';
        console.log('WebSocketManager: Session end failed, flags reset for retry');
        this.events.onError(`Session end failed: ${response.error}`);
      }
    });

    this.socket.on('transcript_line', (data: { session_id: string; text: string }) => {
      console.log('Transcript line received:', data.text);
      this.events.onTranscriptLine(data.text);
    });
  }

  public createSession(contextData?: any): Promise<any> {
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

              // Set up AI Insights system (Agent API session and context)
              this.setupAIInsights(session, contextData);
              
              resolve({
                success: true,
                sessionId: sessionId,
                session: session
              });
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
        const tokens = await this.authManager.getStoredTokens();
        
        if (tokens.salesforce && tokens.salesforce.access_token) {
          console.log('WebSocketManager: OAuth token obtained, sending to Heroku...');
          // We'll send the token after we get the session_created response with session_id
          this.pendingOAuthToken = tokens.salesforce.access_token;
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

      // Check session state and prevent race conditions
      if (this.sessionStartInProgress) {
        console.log('WebSocketManager: Session start already in progress, rejecting duplicate call');
        reject(new Error('Session start already in progress'));
        return;
      }

      if (this.sessionState !== 'created') {
        console.log(`WebSocketManager: Invalid session state for start: ${this.sessionState}`);
        reject(new Error(`Cannot start session in state: ${this.sessionState}`));
        return;
      }
      
      // Mark session start as in progress
      this.sessionStartInProgress = true;
      this.sessionState = 'starting';
      
      // Wait a moment to ensure session is fully ready
      setTimeout(() => {
        if (!this.socket || !this.isConnected) {
          this.sessionStartInProgress = false;
          this.sessionState = 'created'; // Reset state
          reject(new Error('WebSocket connection lost'));
          return;
        }
        
        console.log('WebSocketManager: Starting session:', sessionId, 'State:', this.sessionState);
        const callbackId = 'start_session_' + Date.now();
        this.pendingCallbacks.set(callbackId, { resolve, reject });
        
        // Longer timeout for more stability
        const timeoutId = setTimeout(() => {
          if (this.pendingCallbacks.has(callbackId)) {
            this.pendingCallbacks.delete(callbackId);
            // Reset flags on timeout to allow retry
            this.sessionStartInProgress = false;
            this.sessionState = 'created';
            console.log('WebSocketManager: Session start timeout, flags reset for retry');
            reject(new Error('Session start timeout - no response from server'));
          }
        }, 15000);
        
        const handleSessionStarted = (response: any) => {
          console.log('WebSocketManager: Received session_started response:', response);
          
          if (this.pendingCallbacks.has(callbackId)) {
            clearTimeout(timeoutId);
            this.pendingCallbacks.delete(callbackId);
            this.socket?.off('session_started', handleSessionStarted);
            
            if (response && response.success === true) {
              // Handle different response structures
              const session = response.session || response;
              const sessionId = session.session_id || session.id || response.session_id || response.id;
              
              if (sessionId) {
                this.currentSessionId = sessionId;
                console.log('✅ Session started successfully with ID:', sessionId);
                resolve(session);
              } else {
                console.error('❌ No session ID in successful response:', response);
                reject(new Error('No session ID in response'));
              }
            } else {
              const errorMsg = response?.error || 'Failed to start session';
              console.error('❌ Session start failed:', errorMsg);
              reject(new Error(errorMsg));
            }
          }
        };
        
        // Add error handler for WebSocket errors during session start
        const handleError = (error: any) => {
          console.error('WebSocket error during session start:', error);
          if (this.pendingCallbacks.has(callbackId)) {
            clearTimeout(timeoutId);
            this.pendingCallbacks.delete(callbackId);
            this.socket?.off('session_started', handleSessionStarted);
            this.socket?.off('error', handleError);
            // Reset flags on WebSocket error to allow retry
            this.sessionStartInProgress = false;
            this.sessionState = 'created';
            console.log('WebSocketManager: WebSocket error during session start, flags reset for retry');
            reject(new Error(`WebSocket error: ${error}`));
          }
        };
        
        this.socket.on('session_started', handleSessionStarted);
        this.socket.on('error', handleError);
        
        console.log('WebSocketManager: Emitting start_session event for:', sessionId);
        this.socket.emit('start_session', { session_id: sessionId });
        
      }, 100); // Small delay to ensure connection stability
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
          // Reset flags on end session timeout to allow retry
          this.sessionStartInProgress = false;
          this.sessionState = 'none';
          console.log('WebSocketManager: Session end timeout, flags reset for retry');
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
            // Reset session flags when ending session successfully
            this.sessionStartInProgress = false;
            this.sessionState = 'none';
            console.log('WebSocketManager: Session ended via endSession call, flags reset');
            resolve(session);
          } else {
            // Reset flags even on end session failure to allow retry
            this.sessionStartInProgress = false;
            this.sessionState = 'none';
            console.log('WebSocketManager: Session end failed via endSession call, flags reset for retry');
            reject(new Error(response.error || 'Failed to end session'));
          }
        }
      };
      this.socket.on('session_ended', handleSessionEnded);
      this.socket.emit('end_session', { session_id: sessionId });
    });
  }

  // REMOVED: sendAudioChunk method - audio processing now handled entirely by AssemblyAI
  // The Heroku backend's audio_chunk handler is deprecated and no longer needed

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

  public sendSummary(summaryData: any): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.isConnected) {
        console.log('❌ WEBSOCKET: Cannot send summary - not connected');
        reject(new Error('WebSocket not connected'));
        return;
      }
      
      if (!this.currentSessionId) {
        console.log('❌ WEBSOCKET: Cannot send summary - no active session');
        reject(new Error('No active session for summary transmission'));
        return;
      }

      console.log('🧠 WEBSOCKET: Sending meeting summary to Heroku:', {
        sessionId: this.currentSessionId,
        summaryId: summaryData.id,
        timestamp: summaryData.timestamp,
        finalTranscriptCount: summaryData.finalTranscriptCount
      });
      
      this.socket.emit('meeting_summary', {
        session_id: this.currentSessionId,
        summary_data: summaryData
      });
      
      console.log('✅ WEBSOCKET: Meeting summary sent successfully');
      resolve(true);
    });
  }

  // Set up AI Insights directly with local context data (no Heroku needed)
  public async setupAIInsightsDirectly(sessionId: string, contextData: any): Promise<void> {
    try {
      console.log('🤖 WEBSOCKET MANAGER: ===== SETTING UP AI INSIGHTS DIRECTLY =====');
      console.log('🤖 WEBSOCKET MANAGER: AuthManager available:', !!this.authManager);
      console.log('🤖 WEBSOCKET MANAGER: AudioManager available:', !!this.audioManager);
      
      if (!this.authManager || !this.audioManager) {
        console.log('🤖 WEBSOCKET MANAGER: ❌ Missing dependencies, skipping AI insights setup');
        console.log('🤖 WEBSOCKET MANAGER: AuthManager:', !!this.authManager, 'AudioManager:', !!this.audioManager);
        return;
      }

      console.log('🤖 WEBSOCKET MANAGER: ✅ All dependencies available, proceeding with AI setup...');

      // Use the rich contextData directly - no Heroku round-trip!
      const sessionContext = {
        sessionId: sessionId,
        meetingBrief: contextData.meetingBrief,
        competitiveIntelligence: contextData.competitiveIntelligence,
        agentCapabilities: contextData.agentCapabilities
      };
      
      console.log('🤖 WEBSOCKET MANAGER: Session context created with RICH DATA:', {
        sessionId: sessionContext.sessionId,
        meetingBriefLength: sessionContext.meetingBrief?.length || 0,
        competitiveIntelligenceLength: sessionContext.competitiveIntelligence?.length || 0,
        agentCapabilitiesLength: sessionContext.agentCapabilities?.length || 0
      });

      // Set session context on AudioManager
      this.audioManager.setSessionContext(sessionContext);
      
      // Emit debug event for context setting
      const debugEvent = {
        sessionId: sessionContext.sessionId,
        meetingBrief: sessionContext.meetingBrief,
        competitiveIntelligence: sessionContext.competitiveIntelligence,
        agentCapabilities: sessionContext.agentCapabilities
      };
      
      // Send debug event to main process (similar to existing pattern)
      console.log('🔧 MAIN: Received debug event context_set, routing to overlay manager:', debugEvent);

      console.log('🤖 WEBSOCKET MANAGER: 🚀 Creating Agent API session...');
      
      // Create Agent API session with rich context
      try {
        await this.authManager.createAgentSession(sessionContext.meetingBrief, sessionContext.competitiveIntelligence);
        console.log('🤖 WEBSOCKET MANAGER: ✅ Agent API session created successfully');
      } catch (error) {
        console.error('🤖 WEBSOCKET MANAGER: ❌ Failed to create Agent API session:', error);
      }

      console.log('🤖 WEBSOCKET MANAGER: ✅ AI insights system ready with RICH SALESFORCE DATA');
    } catch (error) {
      console.error('🤖 WEBSOCKET MANAGER: ❌ Error setting up AI insights directly:', error);
    }
  }

  // Set up AI Insights system for the session (legacy Heroku method)
  private async setupAIInsights(session: any, contextData: any): Promise<void> {
    try {
      console.log('🤖 WEBSOCKET MANAGER: ===== SETTING UP AI INSIGHTS SYSTEM =====');
      console.log('🤖 WEBSOCKET MANAGER: AuthManager available:', !!this.authManager);
      console.log('🤖 WEBSOCKET MANAGER: AudioManager available:', !!this.audioManager);
      
      if (!this.authManager || !this.audioManager) {
        console.log('🤖 WEBSOCKET MANAGER: ❌ Missing dependencies, skipping AI insights setup');
        console.log('🤖 WEBSOCKET MANAGER: AuthManager:', !!this.authManager, 'AudioManager:', !!this.audioManager);
        return;
      }

      console.log('🤖 WEBSOCKET MANAGER: ✅ All dependencies available, proceeding with AI setup...');

      // Define session context for AI insights - prioritize contextData over empty session data
      const sessionContext = {
        sessionId: session.session_id || session.id,
        meetingBrief: contextData?.meetingBrief || session.meeting_brief || 'General meeting discussion and insights',
        competitiveIntelligence: contextData?.competitiveIntelligence || session.competitive_intelligence || 'No competitive intelligence available',
        agentCapabilities: contextData?.agentCapabilities || session.agent_capabilities || 'Basic AI assistance capabilities'
      };
      
      console.log('🤖 WEBSOCKET MANAGER: Session context created:', {
        sessionId: sessionContext.sessionId,
        meetingBriefLength: sessionContext.meetingBrief?.length || 0,
        competitiveIntelligenceLength: sessionContext.competitiveIntelligence?.length || 0,
        agentCapabilitiesLength: sessionContext.agentCapabilities?.length || 0
      });

      // Set session context on AudioManager
      this.audioManager.setSessionContext(sessionContext);
      
      // Emit debug event for context setting
      if (this.mainWindow) {
        this.mainWindow.webContents.send('debug:context_set', sessionContext);
        
        // Also send to overlay manager via custom debug handler
        if ((this.mainWindow as any).sendDebugEvent) {
          (this.mainWindow as any).sendDebugEvent('context_set', sessionContext);
        }
      }

      // Create Agent API session with context variables
      console.log('🤖 WEBSOCKET MANAGER: 🚀 Creating Agent API session...');
      await this.authManager.createAgentSession(
        sessionContext.competitiveIntelligence,
        sessionContext.meetingBrief
      );
      console.log('🤖 WEBSOCKET MANAGER: ✅ Agent API session created successfully');

      console.log('🤖 WEBSOCKET MANAGER: ✅ AI insights system ready');

    } catch (error) {
      console.error('🤖 WEBSOCKET MANAGER: Failed to set up AI insights system:', error);
      // Don't throw - let the meeting continue without AI insights
    }
  }
}
