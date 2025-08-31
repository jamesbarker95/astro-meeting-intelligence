import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import { AuthManager } from './auth/auth-manager';
import { WebSocketManager } from './websocket/websocket-manager';
import { AudioManager } from './audio/audio-manager';

class MainProcess {
    private mainWindow: BrowserWindow | null = null;
    private authManager: AuthManager;
    private websocketManager: WebSocketManager;
    private audioManager: AudioManager;

    constructor() {
        this.authManager = new AuthManager();
        this.websocketManager = new WebSocketManager(this.createWebSocketEvents());
        this.audioManager = new AudioManager();
        
        this.setupAppEvents();
        this.setupIpcHandlers();
        this.setupAudioEvents();
    }

    private createWebSocketEvents() {
        return {
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

        // Handle custom protocol
        app.setAsDefaultProtocolClient('astro');
    }

    private createWindow(): void {
        this.mainWindow = new BrowserWindow({
            width: 1200,
            height: 800,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js')
            }
        });

        this.mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
        
        // Open DevTools for debugging
        this.mainWindow.webContents.openDevTools();

        // Handle external links
        this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
            shell.openExternal(url);
            return { action: 'deny' };
        });
    }

    private setupIpcHandlers(): void {
        // Auth handlers
        ipcMain.handle('auth:salesforce', async () => {
            try {
                console.log('IPC: auth:salesforce called');
                const authUrl = await this.authManager.getSalesforceAuthUrl();
                console.log('Salesforce auth URL:', authUrl);
                
                // Open the URL in the default browser
                await shell.openExternal(authUrl);
                
                return { success: true, url: authUrl };
            } catch (error) {
                console.error('Salesforce auth error:', (error as Error).message);
                return { success: false, error: (error as Error).message };
            }
        });

        ipcMain.handle('auth:slack', async () => {
            try {
                console.log('IPC: auth:slack called');
                const authUrl = await this.authManager.getSlackAuthUrl();
                console.log('Slack auth URL:', authUrl);
                
                // Open the URL in the default browser
                await shell.openExternal(authUrl);
                
                return { success: true, url: authUrl };
            } catch (error) {
                console.error('Slack auth error:', (error as Error).message);
                return { success: false, error: (error as Error).message };
            }
        });

        ipcMain.handle('auth:check-status', async () => {
            try {
                const tokens = await this.authManager.getStoredTokens();
                return {
                    salesforce: !!tokens.salesforce,
                    slack: !!tokens.slack
                };
            } catch (error) {
                console.error('Error checking auth status:', error);
                return {
                    salesforce: false,
                    slack: false
                };
            }
        });

        // WebSocket handlers
        ipcMain.handle('websocket:connect', async () => {
            try {
                const result = await this.websocketManager.connect('https://astro-meetings-918feccd1cb1.herokuapp.com');
                return { success: result, error: null };
            } catch (error) {
                console.error('WebSocket connection error:', error);
                return { success: false, error: (error as Error).message };
            }
        });

        ipcMain.handle('websocket:disconnect', async () => {
            return await this.websocketManager.disconnect();
        });

        ipcMain.handle('websocket:send', async (_event, data) => {
            return await this.websocketManager.sendTranscriptLine(data);
        });

        // Session handlers
        ipcMain.handle('session:start', async () => {
            return await this.websocketManager.startSession('new-session');
        });

        ipcMain.handle('session:end', async () => {
            return await this.websocketManager.endSession('current-session');
        });

        // Session management handlers
        ipcMain.handle('createSession', async () => {
            try {
                const session = await this.websocketManager.createSession();
                return { success: true, session };
            } catch (error) {
                console.error('Create session error:', error);
                return { success: false, error: (error as Error).message };
            }
        });

        ipcMain.handle('startSession', async (_event, sessionId) => {
            try {
                const session = await this.websocketManager.startSession(sessionId);
                return { success: true, session };
            } catch (error) {
                console.error('Start session error:', error);
                return { success: false, error: (error as Error).message };
            }
        });

        ipcMain.handle('endSession', async (_event, sessionId) => {
            try {
                const session = await this.websocketManager.endSession(sessionId);
                return { success: true, session };
            } catch (error) {
                console.error('End session error:', error);
                return { success: false, error: (error as Error).message };
            }
        });

        // Audio handlers
        ipcMain.handle('audio:setup', async () => {
            return await this.audioManager.setupAudioDevices();
        });

        ipcMain.handle('audio:start', async () => {
            return await this.audioManager.startAudioCapture();
        });

        ipcMain.handle('audio:stop', async () => {
            this.audioManager.stopAudioCapture();
            return { success: true };
        });

        ipcMain.handle('audio:status', async () => {
            return { isCapturing: this.audioManager.isCapturingAudio() };
        });

        // Audio chunk handler - send to backend via WebSocket
        ipcMain.handle('audio:send-chunk', async (_event, audioData) => {
            try {
                // Send audio chunk to backend via WebSocket
                const result = await this.websocketManager.sendAudioChunk(audioData);
                return result;
            } catch (error) {
                console.error('Error sending audio chunk:', error);
                throw error;
            }
        });
    }

    private setupAudioEvents(): void {
        // Forward audio events to renderer
        this.audioManager.on('started', () => {
            this.mainWindow?.webContents.send('audio:started');
        });

        this.audioManager.on('stopped', () => {
            this.mainWindow?.webContents.send('audio:stopped');
        });

        this.audioManager.on('error', (error) => {
            this.mainWindow?.webContents.send('audio:error', error);
        });

        this.audioManager.on('audioChunk', (chunk) => {
            // Forward audio chunk to renderer for processing
            this.mainWindow?.webContents.send('audio:chunk', chunk);
        });

        this.audioManager.on('blackholeAvailable', () => {
            this.mainWindow?.webContents.send('audio:blackhole-available');
        });

        this.audioManager.on('blackholeNotAvailable', () => {
            this.mainWindow?.webContents.send('audio:blackhole-not-available');
        });
    }
}

// Start the main process
new MainProcess();
