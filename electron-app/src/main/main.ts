import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import { AuthManager } from './auth/auth-manager';
import { WebSocketManager, WebSocketEvents } from './websocket/websocket-manager';
import { AudioManager } from './audio-manager';


class MainProcess {
  private mainWindow: BrowserWindow | null = null;
  private authManager: AuthManager;
  private websocketManager: WebSocketManager;
  private audioManager: AudioManager;


  constructor() {
    this.authManager = new AuthManager();
    
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
        console.log('Session started:', session);
        this.mainWindow?.webContents.send('session-started', session);
      },
      onSessionEnded: (session: any) => {
        console.log('Session ended:', session);
        this.mainWindow?.webContents.send('session-ended', session);
      },
      onTranscriptLine: (text: string) => {
        console.log('Transcript line:', text);
        this.mainWindow?.webContents.send('transcript-line', text);
      }
    };
    
    this.websocketManager = new WebSocketManager(websocketEvents);
    this.audioManager = new AudioManager();
    
    // Connect AudioManager to WebSocket manager
    this.audioManager.setWebSocketManager(this.websocketManager);
    
    this.setupAppEvents();
    this.setupIpcHandlers();
    this.setupAudioEvents();
    this.initializeAudioManager();
  }

  private setupAppEvents(): void {
    app.whenReady().then(() => {
      this.createWindow();
      
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          this.createWindow();
        }
      });
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });
  }

  private createWindow(): void {
    try {
      console.log('Creating main window...');
      console.log('Current directory:', __dirname);
      console.log('Preload script path:', path.join(__dirname, 'preload.js'));
      console.log('HTML file path:', path.join(__dirname, '..', 'renderer', 'index.html'));
      
      this.mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, 'preload.js')
        }
      });

      console.log('BrowserWindow created successfully');

      this.mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
      console.log('HTML file loaded');

      // Open developer tools in development mode
      if (process.env['NODE_ENV'] === 'development' || process.argv.includes('--dev')) {
        this.mainWindow.webContents.openDevTools();
        console.log('Developer tools opened');
      }

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
      
    } catch (error) {
      console.error('Error creating window:', error);
      throw error;
    }
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

    ipcMain.handle('audio:status', async () => {
      const status = this.audioManager.getStatus();
      return { 
        isCapturing: status.isCapturing,
        isDeepgramConnected: false, // Deepgram is now handled separately
        hasAudioSignal: status.hasAudioSignal,
        audioLevel: status.audioLevel
      };
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
      console.log('🎵 MAIN: Transcript received from AssemblyAI:', transcriptData);
      
      // Send transcript to renderer for UI display
      this.mainWindow?.webContents.send('transcript-line', transcriptData);
      this.mainWindow?.webContents.send('transcript:line', transcriptData);
      
      console.log('🎵 MAIN: Transcript forwarded to renderer');
    });

    this.audioManager.on('transcription_error', (error) => {
      console.error('🎵 MAIN: AssemblyAI transcription error:', error);
      this.mainWindow?.webContents.send('audio:error', error);
    });

    this.audioManager.on('deepgram-connected', () => {
      console.log('Deepgram connected');
    });

    this.audioManager.on('deepgram-disconnected', () => {
      console.log('Deepgram disconnected');
    });
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
}

new MainProcess();
