import { app, BrowserWindow, ipcMain, shell, Menu } from 'electron';
import * as path from 'path';
import { AuthManager } from './auth/auth-manager';
import { WebSocketManager, WebSocketEvents } from './websocket/websocket-manager';
import { AudioManager } from './audio-manager';
import { OverlayManager } from './overlay/overlay-manager';


class MainProcess {
  private mainWindow: BrowserWindow | null = null;
  private authManager: AuthManager;
  private websocketManager: WebSocketManager;
  private audioManager: AudioManager;
  private overlayManager: OverlayManager;


  constructor() {
    this.authManager = new AuthManager();
    this.overlayManager = new OverlayManager();
    
    // Create WebSocket events handler
    const websocketEvents: WebSocketEvents = {
      onConnect: () => {
        console.log('WebSocket connected');
        this.mainWindow?.webContents.send('websocket-connected');
      },
      onDisconnect: () => {
        console.log('WebSocket disconnected');
        this.mainWindow?.webContents.send('websocket-disconnected');
      },
      onError: (error: string) => {
        console.error('WebSocket error:', error);
        this.mainWindow?.webContents.send('websocket-error', error);
      },
      onSessionCreated: (session: any) => {
        console.log('Session created:', session);
        this.mainWindow?.webContents.send('session-created', session);
      },
      onSessionStarted: (session: any) => {
        console.log('🚀 WEBSOCKET: Session started:', session);
        this.mainWindow?.webContents.send('session-started', session);
        console.log('🚀 WEBSOCKET: About to call updateSessionState(true) to hide calendar');
        this.overlayManager.updateSessionState(true); // Hide calendar
        console.log('🚀 WEBSOCKET: Called updateSessionState(true), calendar should be hidden');
      },
      onSessionEnded: (session: any) => {
        console.log('🚀 WEBSOCKET: Session ended:', session);
        this.mainWindow?.webContents.send('session-ended', session);
        console.log('🚀 WEBSOCKET: About to call updateSessionState(false) to show calendar');
        this.overlayManager.updateSessionState(false); // Show calendar
        console.log('🚀 WEBSOCKET: Called updateSessionState(false), calendar should be shown');
      },
      onTranscriptLine: (text: string) => {
        console.log('Transcript line:', text);
        this.mainWindow?.webContents.send('transcript-line', text);
        this.overlayManager.updatePanelContent('transcript', { text, timestamp: new Date().toISOString() });
      }
    };
    
    this.websocketManager = new WebSocketManager(websocketEvents, this.authManager);
    this.audioManager = new AudioManager();
    
    // Connect AudioManager to WebSocket manager and AuthManager
    // this.audioManager.setWebSocketManager(this.websocketManager); // REMOVED - no longer using WebSocket
    this.audioManager.setAuthManager(this.authManager);
    
    // Connect WebSocketManager to AudioManager (for session context setting)
    this.websocketManager.setAudioManager(this.audioManager);
    
    this.setupAppEvents();
    this.setupIpcHandlers();
    this.setupAudioEvents();
    this.setupWebSocketEvents();
    this.initializeAudioManager();
  }

  private setupAppEvents(): void {
    // Enable experimental web platform features for backdrop-filter
    app.commandLine.appendSwitch('enable-experimental-web-platform-features');
    app.commandLine.appendSwitch('enable-features', 'CSSBackdropFilter');
    
    app.whenReady().then(async () => {
      await this.createWindow();
      
      app.on('activate', async () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          await this.createWindow();
        }
      });
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });
  }

  private async createWindow(): Promise<void> {
    try {
      console.log('Initializing overlay system...');
      
      // Initialize overlay manager instead of creating main window
      await this.overlayManager.initialize();
      
      // Create a hidden fallback window for emergency access
      this.mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false, // Hidden - everything is in overlay
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, 'preload.js')
        }
      });

      console.log('BrowserWindow created successfully');

      // Wait for the renderer to be ready before proceeding
      await new Promise<void>((resolve) => {
        this.mainWindow!.webContents.once('did-finish-load', () => {
          console.log('🚀 MAIN: Renderer finished loading');
          resolve();
        });
        
        this.mainWindow!.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
        console.log('HTML file loaded');
      });

      // Force open developer tools for debugging
      this.mainWindow.webContents.openDevTools({ mode: 'detach' });
      console.log('Developer tools opened in detached mode');

      // Create menu bar for easy dev tools access
      this.createMenu();

      // Open external links in default browser
      this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
      });

      // Add error handlers for the window
      this.mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
        console.error('Window failed to load:', {
          errorCode,
          errorDescription,
          validatedURL
        });
      });

      this.mainWindow.webContents.on('crashed', (_event) => {
        console.error('Renderer process crashed');
      });

      this.mainWindow.on('unresponsive', () => {
        console.error('Window became unresponsive');
      });

      console.log('Window creation completed successfully');
      
      // Set mainWindow reference for debug events
      this.authManager.setMainWindow(this.mainWindow);
      this.websocketManager.setMainWindow(this.mainWindow);
      
      // Set up debug event routing from main window to overlay manager
      this.setupDebugEventRouting();
      
    } catch (error) {
      console.error('Error creating window:', error);
      throw error;
    }
  }

  private createMenu(): void {
    const template = [
      {
        label: 'Debug',
        submenu: [
          {
            label: 'Toggle Developer Tools',
            accelerator: 'CmdOrCtrl+Shift+I',
            click: () => {
              if (this.mainWindow) {
                this.mainWindow.webContents.toggleDevTools();
              }
            }
          },
          {
            label: 'Detach Developer Tools',
            accelerator: 'CmdOrCtrl+Shift+D',
            click: () => {
              if (this.mainWindow) {
                this.mainWindow.webContents.openDevTools({ mode: 'detach' });
              }
            }
          },
          {
            label: 'Reload',
            accelerator: 'CmdOrCtrl+R',
            click: () => {
              if (this.mainWindow) {
                this.mainWindow.webContents.reload();
              }
            }
          }
        ]
      }
    ];

    const menu = Menu.buildFromTemplate(template as any);
    Menu.setApplicationMenu(menu);
  }

  private setupIpcHandlers(): void {
    // Auth handlers
    ipcMain.handle('auth:salesforce', async () => {
      try {
        const authUrl = this.authManager.getSalesforceAuthUrl();
        await shell.openExternal(authUrl);
        return { success: true, url: authUrl };
      } catch (error) {
        console.error('Salesforce auth error:', error);
        return { success: false, error: (error as Error).message };
      }
    });

    ipcMain.handle('auth:slack', async () => {
      try {
        const authUrl = this.authManager.getSlackAuthUrl();
        await shell.openExternal(authUrl);
        return { success: true, url: authUrl };
      } catch (error) {
        console.error('Slack auth error:', error);
        return { success: false, error: (error as Error).message };
      }
    });

    // Listen for auth completion events from auth manager
    this.setupAuthEventListeners();
    
    // Setup overlay-specific IPC handlers
    this.setupOverlayHandlers();

    // Session toggle handler (for menu bar button) - copied from backup project
    ipcMain.handle('session:toggle', async () => {
      try {
        // Connect to WebSocket first (like the backup project)
        console.log('Connecting to WebSocket for session...');
        const connectResult = await this.websocketManager.connect('https://astro-meetings-918feccd1cb1.herokuapp.com');
        
        if (!connectResult) {
          throw new Error('Failed to connect to WebSocket');
        }

        // Create session
        console.log('Creating session...');
        const session = await this.websocketManager.createSession();
        
        // Start session immediately (this was the missing piece!)
        console.log('Starting session...');
        const sessionId = session.sessionId || session.id || session.session_id;
        console.log('Extracted session ID for start:', sessionId);
        const result = await this.websocketManager.startSession(sessionId);
        
        // Update overlay state immediately for manual session starts
        console.log('🚀 MAIN PROCESS: About to call updateSessionState(true) to hide calendar');
        this.overlayManager.updateSessionState(true); // Hide calendar
        console.log('🚀 MAIN PROCESS: Called updateSessionState(true), calendar should be hidden');
        this.overlayManager.showToast('notification', 'Session Started', 'Meeting session is now active');
        return { success: true, action: 'started', session: result };
      } catch (error) {
        console.error('Session toggle error:', error);
        this.overlayManager.showToast('error', 'Session Failed', (error as Error).message);
        return { success: false, error: (error as Error).message };
      }
    });

    // Stop session handler
    ipcMain.handle('session:stop', async () => {
      try {
        console.log('🛑 MAIN: Stopping session...');
        
        // Stop audio capture if active
        if (this.audioManager) {
          await this.audioManager.stopAudioCapture();
          console.log('🛑 MAIN: Audio capture stopped');
          
          // Also tell the renderer to stop browser-side audio capture
          console.log('🛑 MAIN: Telling renderer to stop browser audio capture...');
          setTimeout(() => {
            this.mainWindow?.webContents.send('stop-audio-capture');
            console.log('🛑 MAIN: Sent stop-audio-capture event to renderer');
          }, 100);
        }
        
        // End the session via WebSocket
        if (this.websocketManager) {
          const currentSessionId = this.websocketManager.getCurrentSessionId();
          if (currentSessionId) {
            await this.websocketManager.endSession(currentSessionId);
            console.log('🛑 MAIN: WebSocket session ended');
          } else {
            console.log('🛑 MAIN: No active session to end');
          }
        }
        
        // Update overlay state to show calendar again
        console.log('🛑 MAIN: Updating session state to show calendar');
        this.overlayManager.updateSessionState(false); // Show calendar
        
        // Show success toast
        this.overlayManager.showToast('notification', 'Session Stopped', 'Session ended successfully');
        
        return { success: true, action: 'stopped' };
      } catch (error) {
        console.error('🛑 MAIN: Stop session error:', error);
        this.overlayManager.showToast('error', 'Stop Failed', (error as Error).message);
        return { success: false, error: (error as Error).message };
      }
    });

    ipcMain.handle('auth:status', async () => {
      try {
        const tokens = await this.authManager.getStoredTokens();
        return {
          salesforce: !!tokens.salesforce,
          slack: !!tokens.slack
        };
      } catch (error) {
        console.error('Auth status error:', error);
        return { salesforce: false, slack: false };
      }
    });

    ipcMain.handle('auth:get-user-events', async () => {
      try {
        console.log('Getting user events from Salesforce...');
        const events = await this.authManager.getUserEvents();
        return { success: true, events };
      } catch (error) {
        console.error('Get user events error:', error);
        return { success: false, error: (error as Error).message, events: [] };
      }
    });

    // WebSocket handlers
    ipcMain.handle('websocket:connect', async () => {
      try {
        await this.websocketManager.connect('https://astro-meetings-918feccd1cb1.herokuapp.com');
        return { success: true };
      } catch (error) {
        console.error('WebSocket connect error:', error);
        return { success: false, error: (error as Error).message };
      }
    });

    ipcMain.handle('websocket:create-session', async (_event, contextData) => {
      try {
        console.log('Creating session...', contextData ? 'with context' : 'without context');
        const sessionId = await this.websocketManager.createSession(contextData);
        return { success: true, sessionId };
      } catch (error) {
        console.error('Create session error:', error);
        return { success: false, error: (error as Error).message };
      }
    });

    ipcMain.handle('websocket:start-session', async (_event, sessionId?: string) => {
      try {
        if (!sessionId) {
          // Get the current session ID from the WebSocket manager
          const currentSessionId = this.websocketManager.getCurrentSessionId();
          if (!currentSessionId) {
            return { success: false, error: 'No session ID available' };
          }
          sessionId = currentSessionId;
        }
        await this.websocketManager.startSession(sessionId);
        return { success: true };
      } catch (error) {
        console.error('Start session error:', error);
        return { success: false, error: (error as Error).message };
      }
    });

    ipcMain.handle('websocket:end-session', async (_event, sessionId?: string) => {
      try {
        if (!sessionId) {
          // Get the current session ID from the WebSocket manager
          const currentSessionId = this.websocketManager.getCurrentSessionId();
          if (!currentSessionId) {
            return { success: false, error: 'No session ID available' };
          }
          sessionId = currentSessionId;
        }
        await this.websocketManager.endSession(sessionId);
        return { success: true };
      } catch (error) {
        console.error('End session error:', error);
        return { success: false, error: (error as Error).message };
      }
    });


    // Audio handlers
    ipcMain.handle('audio:initialize', async () => {
      try {
        console.log('MainProcess: Received audio:initialize request');
        await this.audioManager.initialize();
        console.log('MainProcess: Audio manager initialized successfully');
        return { success: true };
      } catch (error) {
        console.error('MainProcess: Audio initialization failed:', error);
        return { success: false, error: (error as Error).message };
      }
    });

    ipcMain.handle('audio:start', async () => {
      try {
        console.log('MainProcess: Received audio:start request');
        await this.audioManager.startAudioCapture();
        console.log('MainProcess: Audio capture started successfully');
        return { success: true };
      } catch (error) {
        console.error('MainProcess: Audio start failed:', error);
        return { success: false, error: (error as Error).message };
      }
    });

    ipcMain.handle('audio:stop', async () => {
      try {
        this.audioManager.stopAudioCapture();
        return { success: true };
      } catch (error) {
        console.error('Audio stop error:', error);
        return { success: false, error: (error as Error).message };
      }
    });

    // Microphone toggle handlers
    ipcMain.handle('microphone:toggle', async () => {
      try {
        // Send to renderer to handle microphone toggle
        this.mainWindow?.webContents.send('microphone:toggle-request');
        return { success: true };
      } catch (error) {
        console.error('Microphone toggle error:', error);
        return { success: false, error: (error as Error).message };
      }
    });

    ipcMain.handle('microphone:stop', async () => {
      try {
        // Send to renderer to stop microphone only
        this.mainWindow?.webContents.send('microphone:stop-request');
        return { success: true };
      } catch (error) {
        console.error('Microphone stop error:', error);
        return { success: false, error: (error as Error).message };
      }
    });

    ipcMain.handle('microphone:start', async () => {
      try {
        // Send to renderer to start microphone only
        this.mainWindow?.webContents.send('microphone:start-request');
        return { success: true };
      } catch (error) {
        console.error('Microphone start error:', error);
        return { success: false, error: (error as Error).message };
      }
    });

    // Microphone state update handler (from renderer to overlay)
    ipcMain.handle('microphone:state-changed', async (_event, isActive: boolean) => {
      try {
        // Forward microphone state to overlay manager
        this.overlayManager.updateMicrophoneState(isActive);
        return { success: true };
      } catch (error) {
        console.error('Microphone state update error:', error);
        return { success: false, error: (error as Error).message };
      }
    });

    ipcMain.handle('audio:status', async () => {
      const status = this.audioManager.getStatus();
      return { 
        isCapturing: status.isCapturing,
        isDeepgramConnected: false, // Deepgram is now handled separately
        hasAudioSignal: status.hasAudioSignal,
        audioLevel: status.audioLevel
      };
    });

    // Audio toggle handler (for menu bar button)
    ipcMain.handle('audio:toggle', async () => {
      try {
        const status = this.audioManager.getStatus();
        if (status.isCapturing) {
          this.audioManager.stopAudioCapture();
          this.overlayManager.showToast('notification', 'Audio Stopped', 'Audio capture stopped');
          return { success: true, action: 'stopped' };
        } else {
          await this.audioManager.startAudioCapture();
          this.overlayManager.showToast('notification', 'Audio Started', 'Audio capture started');
          return { success: true, action: 'started' };
        }
      } catch (error) {
        console.error('Audio toggle error:', error);
        this.overlayManager.showToast('error', 'Audio Toggle Failed', (error as Error).message);
        return { success: false, error: (error as Error).message };
      }
    });

    // Handle audio data from renderer
    ipcMain.handle('audio:send-data', async (_event, audioData: ArrayBuffer) => {
      try {
        console.log('🔗 MAIN IPC: Received audio data from renderer', {
          dataType: typeof audioData,
          dataLength: audioData instanceof ArrayBuffer ? audioData.byteLength : (audioData as any).length,
          isArrayBuffer: audioData instanceof ArrayBuffer,
          preview: typeof audioData === 'string' ? (audioData as string).substring(0, 20) + '...' : 'binary data'
        });
        
        await this.audioManager.receiveAudioData(audioData);
        return { success: true };
      } catch (error) {
        console.error('❌ MAIN IPC: Error processing audio data:', error);
        return { success: false, error: (error as Error).message };
      }
    });

    // Audio streaming to Heroku will be added here
  }

  private setupAudioEvents(): void {
    this.audioManager.on('initialized', () => {
      console.log('Audio manager initialized');
    });

    this.audioManager.on('started', () => {
      console.log('Audio transcription started');
    });

    this.audioManager.on('stopped', () => {
      console.log('Audio transcription stopped');
    });

    this.audioManager.on('error', (error) => {
      console.error('Audio manager error:', error);
    });

    this.audioManager.on('transcript', (transcriptData) => {
      const mainTimestamp = new Date().toISOString();
      console.log(`🎵 MAIN [${mainTimestamp}]: Transcript received from AssemblyAI:`, transcriptData);
      
      // Send transcript to renderer for UI display (multiple event names for compatibility)
      this.mainWindow?.webContents.send('transcript-line', transcriptData);
      this.mainWindow?.webContents.send('transcript:line', transcriptData);
      this.mainWindow?.webContents.send('transcript-received', transcriptData);
      
      // Also update overlay panels
      this.overlayManager.updatePanelContent('transcript', transcriptData);
      
      const forwardTimestamp = new Date().toISOString();
      console.log(`🎵 MAIN [${forwardTimestamp}]: Transcript forwarded to renderer and overlays`);
    });

    this.audioManager.on('transcription_error', (error) => {
      console.error('🎵 MAIN: AssemblyAI transcription error:', error);
      this.mainWindow?.webContents.send('audio:error', error);
    });

    // Summary event handlers
    this.audioManager.on('summary_generating', (data) => {
      console.log('🧠 MAIN: Summary generation started:', data);
      this.mainWindow?.webContents.send('summary:generating', data);
    });

    this.audioManager.on('summary_generated', (data) => {
      console.log('🧠 MAIN: Summary generated successfully:', data);
      this.mainWindow?.webContents.send('summary:generated', data);
      // Update meeting summary panel
      this.overlayManager.updatePanelContent('meetingSummary', data);
    });

    this.audioManager.on('summary_error', (data) => {
      console.error('🧠 MAIN: Summary generation error:', data);
      this.mainWindow?.webContents.send('summary:error', data);
    });

    // AI Insights event handlers
    this.audioManager.on('insight_created', (insight) => {
      console.log('🤖 MAIN: AI insight created:', insight.id);
      this.mainWindow?.webContents.send('insight:created', insight);
      
      // Show notification with Models API request text
      const notificationTitle = 'New AI Insight';
      const notificationMessage = insight.request_sent || 'AI is analyzing your conversation...';
      this.overlayManager.showToast(
        'notification', 
        notificationTitle, 
        notificationMessage, 
        5000,
        { type: 'open-panel', panelName: 'agentResponses' }
      );
      
      // Auto-open agent responses panel (only if not already visible)
      if (!this.overlayManager.isPanelVisible('agentResponses')) {
        this.overlayManager.togglePanel('agentResponses');
      }
      
      // Update agent responses panel
      this.overlayManager.updatePanelContent('agentResponses', { 
        type: 'insight_created', 
        data: insight
      });
      // Update debug panel
      this.overlayManager.updatePanelContent('debug', { 
        type: 'insight_created', 
        data: insight,
        timestamp: new Date().toISOString()
      });
    });

    this.audioManager.on('insight_chunk', (data) => {
      console.log('🤖 MAIN: AI insight chunk received:', data.id);
      this.mainWindow?.webContents.send('insight:chunk', data);
      
      // Update agent responses panel with streaming chunk
      this.overlayManager.updatePanelContent('agentResponses', { 
        type: 'insight_chunk', 
        data: data
      });
    });

    this.audioManager.on('insight_complete', (data) => {
      console.log('🤖 MAIN: AI insight completed:', data.id);
      this.mainWindow?.webContents.send('insight:complete', data);
      // Update agent responses panel
      this.overlayManager.updatePanelContent('agentResponses', { 
        type: 'insight_complete', 
        data: data
      });
      // Update debug panel
      this.overlayManager.updatePanelContent('debug', { 
        type: 'insight_complete', 
        data: data,
        timestamp: new Date().toISOString()
      });
    });

    this.audioManager.on('insight_error', (data) => {
      console.log('🤖 MAIN: AI insight failed:', data.id, data.error);
      this.mainWindow?.webContents.send('insight:error', data);
      this.overlayManager.updatePanelContent('debug', { 
        type: 'insight_error', 
        data: data,
        timestamp: new Date().toISOString()
      });
    });

    this.audioManager.on('insight_processing_error', (data) => {
      console.log('🤖 MAIN: AI insight processing error:', data.error);
      this.mainWindow?.webContents.send('insight:processing_error', data);
      this.overlayManager.updatePanelContent('debug', { 
        type: 'insight_processing_error', 
        data: data,
        timestamp: new Date().toISOString()
      });
    });

    // AI Debug event handlers (pipeline status)
    this.audioManager.on('pipeline_status', (data) => {
      console.log('🤖 MAIN: Pipeline status:', data.type, data.data);
      this.mainWindow?.webContents.send('debug:pipeline_status', data);
      this.overlayManager.updatePanelContent('debug', { 
        type: 'pipeline_status', 
        data: data,
        timestamp: new Date().toISOString()
      });
    });

    this.audioManager.on('deepgram-connected', () => {
      console.log('Deepgram connected');
    });

    this.audioManager.on('deepgram-disconnected', () => {
      console.log('Deepgram disconnected');
    });
  }

  private setupWebSocketEvents(): void {
    // WebSocket events are handled via the WebSocketEvents interface in constructor
    // We need to route debug events from WebSocket and Auth managers to the debug panel
    
    // Set up IPC listeners for debug events that will be sent from WebSocket/Auth managers
    // These events are sent directly via mainWindow.webContents.send() from those managers
    
    // Note: The actual debug events are sent from:
    // - WebSocketManager: debug:context_set
    // - AuthManager: debug:models_api_call, debug:models_api_response, debug:agent_message, debug:agent_session_created
    
    console.log('🔧 MAIN: WebSocket debug event routing set up (events sent directly from managers)');
  }

  private setupDebugEventRouting(): void {
    if (!this.mainWindow) return;
    
    console.log('🔧 MAIN: Setting up debug event routing to overlay manager...');
    
    // Set up a custom debug event handler that both Auth and WebSocket managers can use
    // This approach directly routes debug events to the overlay manager
    (this.mainWindow as any).sendDebugEvent = (eventType: string, data: any) => {
      console.log(`🔧 MAIN: Received debug event ${eventType}, routing to overlay manager:`, data);
      
      this.overlayManager.updatePanelContent('debug', {
        type: eventType,
        data: data,
        timestamp: new Date().toISOString()
      });
    };
    
    console.log('🔧 MAIN: Debug event routing set up successfully');
  }

  private async initializeAudioManager(): Promise<void> {
    try {
      console.log('MainProcess: Starting audio manager initialization...');
      await this.audioManager.initialize();
      console.log('MainProcess: Audio manager initialized with Deepgram');
    } catch (error) {
      console.error('MainProcess: Failed to initialize audio manager:', error);
    }
  }


  private setupAuthEventListeners(): void {
    // Start auth polling with overlay manager
    this.overlayManager.startAuthPolling(
      async () => {
        const tokens = await this.authManager.getStoredTokens();
        return {
          salesforce: !!tokens.salesforce,
          slack: !!tokens.slack
        };
      },
      async () => {
        const events = await this.authManager.getUserEvents();
        this.overlayManager.updateCalendarEvents(events);
      }
    );
  }

  private setupOverlayHandlers(): void {
    // Panel toggle handlers
    ipcMain.handle('overlay:toggle-panel', async (_event, panelName: string) => {
      await this.overlayManager.togglePanel(panelName as any);
      return { success: true };
    });

    // Calendar handlers
    ipcMain.handle('overlay:show-calendar', async () => {
      this.overlayManager.showCalendar();
      return { success: true };
    });

    ipcMain.handle('overlay:hide-calendar', async () => {
      this.overlayManager.hideCalendar();
      return { success: true };
    });

    // Calendar event handlers
    ipcMain.handle('calendar:select-event', async (_event, eventData: any) => {
      console.log('Calendar event selected:', eventData);
      return { success: true };
    });

    ipcMain.handle('calendar:start-session-for-event', async (_event, eventData: any) => {
      try {
        console.log('Starting session for event:', eventData);
        console.log('🔍 DEBUG: Event data keys:', Object.keys(eventData));
        console.log('🔍 DEBUG: Event ID value:', eventData.id);
        console.log('🔍 DEBUG: Event ID type:', typeof eventData.id);
        
        // Use the same logic as session:toggle but with event context
        console.log('Connecting to WebSocket for event session...');
        const connectResult = await this.websocketManager.connect('https://astro-meetings-918feccd1cb1.herokuapp.com');
        
        if (!connectResult) {
          throw new Error('Failed to connect to WebSocket');
        }

        // Get full event data with Meeting_Brief, Competitive_Intelligence, etc.
        const eventId = eventData.id || eventData.Event_Id;
        console.log('🔍 Looking up full event data for ID:', eventId);
        const allEvents = await this.authManager.getUserEvents();
        console.log('🔍 DEBUG: Available events:', allEvents.map(e => ({ Event_Id: e.Event_Id, Title: e.Title })));
        const fullEventData = allEvents.find(event => event.Event_Id === eventId);
        
        if (!fullEventData) {
          console.warn('⚠️ Full event data not found, using basic context');
        } else {
          console.log('✅ Found full event data with context:', {
            eventId: fullEventData.Event_Id,
            title: fullEventData.Title,
            hasMeetingBrief: !!fullEventData.Meeting_Brief,
            meetingBriefLength: fullEventData.Meeting_Brief?.length || 0,
            hasCompetitiveIntelligence: !!fullEventData.Competitive_Intelligence,
            competitiveIntelligenceLength: fullEventData.Competitive_Intelligence?.length || 0,
            hasAgentCapabilities: !!fullEventData.Agent_Capabilities,
            relatedToId: fullEventData.RelatedToId
          });
        }

        // Create session context with FULL event data - NO HEROKU NEEDED!
        const contextData = {
          eventId: fullEventData?.Event_Id || eventId,
          eventTitle: fullEventData?.Title || eventData.title,
          relatedToId: fullEventData?.RelatedToId || eventData.relatedToId || null,
          startTime: fullEventData?.Start || eventData.time || eventData.Start,
          eventType: 'calendar_event',
          // Pass the rich context directly for AI APIs
          meetingBrief: fullEventData?.Meeting_Brief || 'General meeting discussion and insights',
          competitiveIntelligence: fullEventData?.Competitive_Intelligence || 'No competitive intelligence available',
          agentCapabilities: fullEventData?.Agent_Capabilities || 'Basic AI assistance capabilities'
        };
        
        console.log('✅ Using LOCAL context data directly (no Heroku round-trip):', {
          eventId: contextData.eventId,
          eventTitle: contextData.eventTitle,
          meetingBriefLength: contextData.meetingBrief?.length || 0,
          competitiveIntelligenceLength: contextData.competitiveIntelligence?.length || 0,
          agentCapabilitiesLength: contextData.agentCapabilities?.length || 0
        });
        
        // Skip Heroku session creation - set up AI insights directly with local data
        console.log('🚀 Setting up AI insights directly with rich Salesforce data...');
        
        // Generate a local session ID
        const sessionId = `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        console.log('Generated local session ID:', sessionId);
        
        // Set up AI insights directly without Heroku
        await this.websocketManager.setupAIInsightsDirectly(sessionId, contextData);
        
        // Auto-start audio capture when session starts
        console.log('Auto-starting audio capture for session...');
        try {
          await this.audioManager.startAudioCapture();
          console.log('Audio capture auto-started successfully');
          
                  // Also tell the renderer to start browser-side audio capture
        console.log('Telling renderer to start browser audio capture...');
        // Add small delay to ensure renderer is ready
        setTimeout(() => {
          this.mainWindow?.webContents.send('start-audio-capture');
          console.log('🎵 MAIN: Sent start-audio-capture event to renderer');
        }, 100);
        } catch (audioError) {
          console.error('Failed to auto-start audio capture:', audioError);
          // Don't fail the session start if audio fails
        }
        
        // Hide calendar when session starts
        console.log('🚀 MAIN PROCESS: About to call updateSessionState(true) to hide calendar');
        this.overlayManager.updateSessionState(true); // Hide calendar
        console.log('🚀 MAIN PROCESS: Called updateSessionState(true), calendar should be hidden');
        
        this.overlayManager.showToast('notification', 'Session Started', `Session started for "${eventData.Title || eventData.title || 'Unknown Event'}" - Audio capture enabled`);
        return { success: true, action: 'started', sessionId: sessionId, eventContext: eventData };
      } catch (error) {
        console.error('Start session for event error:', error);
        this.overlayManager.showToast('error', 'Session Failed', (error as Error).message);
        return { success: false, error: (error as Error).message };
      }
    });

    ipcMain.handle('calendar:notify-slack-for-event', async (_event, eventData: any) => {
      console.log('Notifying Slack for event:', eventData);
      // TODO: Implement Slack notification logic
      return { success: true };
    });

    // Toast handler
    ipcMain.handle('toast:show', async (_event, type: string, title: string, message: string, duration?: number) => {
      this.overlayManager.showToast(type as any, title, message, duration);
      return { success: true };
    });

    // Toast action handler
    ipcMain.handle('toast:action', async (_event, action: any) => {
      console.log('Toast action triggered:', action);
      if (action?.type === 'open-panel' && action?.panelName) {
        await this.overlayManager.togglePanel(action.panelName as any);
      }
      return { success: true };
    });

    // Direct question submission handler
    ipcMain.handle('search:submit-question', async (_event, question: string) => {
      console.log('🔍 MAIN: Direct question submitted:', question);
      try {
        // Create an insight entry similar to transcript-triggered insights
        const insightId = `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const insight = {
          id: insightId,
          transcript_trigger: '', // No transcript trigger for direct questions
          request_sent: question, // User's question becomes the "request"
          response_status: 'processing' as 'queued' | 'streaming' | 'complete' | 'error',
          response_text: '',
          timestamp: new Date().toISOString(),
          error: null as string | null,
          isDirectQuestion: true // Flag to identify direct questions
        };

        // Emit insight_created event to trigger UI update
        this.audioManager.emit('insight_created', insight);

        // Call Agent API directly with the user's question
        await this.authManager.sendAgentMessage(
          question,
          (chunk: string) => {
            // Handle streaming chunks
            insight.response_text += chunk;
            this.audioManager.emit('insight_chunk', { insightId, chunk, status: 'streaming' });
          },
          (fullResponse: string) => {
            // Handle completion
            insight.response_text = fullResponse;
            insight.response_status = 'complete';
            this.audioManager.emit('insight_complete', { insightId, response: fullResponse });
            console.log(`✅ MAIN: Direct question insight complete: ${insightId}`);
          },
          (error: string) => {
            // Handle error
            insight.error = error;
            insight.response_status = 'error';
            this.audioManager.emit('insight_error', { insightId, error });
            console.error(`❌ MAIN: Direct question insight error: ${error}`);
          }
        );

        return { success: true, insightId };
      } catch (error) {
        console.error('🔍 MAIN: Error processing direct question:', error);
        return { success: false, error: (error as Error).message };
      }
    });

    // Emergency main window access
    ipcMain.handle('show-main-window', async () => {
      if (this.mainWindow) {
        this.mainWindow.show();
      }
      return { success: true };
    });

    ipcMain.handle('hide-main-window', async () => {
      if (this.mainWindow) {
        this.mainWindow.hide();
      }
      return { success: true };
    });
  }
}

new MainProcess();
