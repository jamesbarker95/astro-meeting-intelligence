import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // WebSocket methods
  connectWebSocket: () => ipcRenderer.invoke('websocket:connect'),
  disconnectWebSocket: () => ipcRenderer.invoke('websocket:disconnect'),
  isWebSocketConnected: () => ipcRenderer.invoke('websocket:is-connected'),
  
  // Session methods
  createSession: () => ipcRenderer.invoke('websocket:create-session'),
  startSession: (sessionId?: string) => ipcRenderer.invoke('websocket:start-session', sessionId),
  endSession: (sessionId?: string) => ipcRenderer.invoke('websocket:end-session', sessionId),
  
  // Auth methods
  authenticateSalesforce: () => ipcRenderer.invoke('auth:salesforce'),
  authenticateSlack: () => ipcRenderer.invoke('auth:slack'),
  checkAuthStatus: () => ipcRenderer.invoke('auth:status'),
  
  // Audio methods
  initializeAudio: () => ipcRenderer.invoke('audio:initialize'),
  startAudioCapture: () => ipcRenderer.invoke('audio:start'),
  stopAudioCapture: () => ipcRenderer.invoke('audio:stop'),
  getAudioStatus: () => ipcRenderer.invoke('audio:status'),
  sendAudioData: (audioData: ArrayBuffer) => ipcRenderer.invoke('audio:send-data', audioData),
  
  // Audio streaming to Heroku will be added here
  
  // Event listeners
  onWebSocketConnected: (callback: () => void) => {
    ipcRenderer.on('websocket-connected', callback);
  },
  onWebSocketDisconnected: (callback: () => void) => {
    ipcRenderer.on('websocket-disconnected', callback);
  },
  onWebSocketError: (callback: (event: any, error: string) => void) => {
    ipcRenderer.on('websocket-error', callback);
  },
  onSessionCreated: (callback: (session: any) => void) => {
    ipcRenderer.on('session-created', (_event, session) => {
      callback(session);
    });
  },
  onSessionStarted: (callback: (event: any, session: any) => void) => {
    ipcRenderer.on('session-started', callback);
  },
  onSessionEnded: (callback: (event: any, session: any) => void) => {
    ipcRenderer.on('session-ended', callback);
  },
  onTranscriptLine: (callback: (event: any, data: any) => void) => {
    ipcRenderer.on('transcript-line', callback);
    ipcRenderer.on('transcript:line', callback);
  },
  
  // Audio event listeners
  onAudioInitialized: (callback: (event: any) => void) => {
    ipcRenderer.on('audio:initialized', callback);
  },
  onAudioStarted: (callback: (event: any) => void) => {
    ipcRenderer.on('audio:started', callback);
  },
  onAudioStopped: (callback: (event: any) => void) => {
    ipcRenderer.on('audio:stopped', callback);
  },
  onAudioError: (callback: (event: any, error: any) => void) => {
    ipcRenderer.on('audio:error', callback);
  },
  
  // Deepgram event listeners (isolated)
  // Transcript events from Heroku will be added here
  
  // Main process command listeners
  onStartAudioCapture: (callback: (event: any) => void) => {
    ipcRenderer.on('start-audio-capture', callback);
  },
  onStopAudioCapture: (callback: (event: any) => void) => {
    ipcRenderer.on('stop-audio-capture', callback);
  },
  
  // Remove event listeners
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  }
});

// Type definitions for TypeScript
declare global {
  interface Window {
    electronAPI: {
      // WebSocket methods
      connectWebSocket: () => Promise<boolean>;
      disconnectWebSocket: () => Promise<boolean>;
      isWebSocketConnected: () => Promise<boolean>;
      
      // Session methods
      createSession: () => Promise<any>;
      startSession: (sessionId?: string) => Promise<any>;
      endSession: (sessionId?: string) => Promise<any>;
      
      // Auth methods
      authenticateSalesforce: () => Promise<any>;
      authenticateSlack: () => Promise<any>;
      checkAuthStatus: () => Promise<any>;
      
      // Audio methods
      initializeAudio: () => Promise<any>;
      startAudioCapture: () => Promise<any>;
      stopAudioCapture: () => Promise<any>;
      getAudioStatus: () => Promise<any>;
      sendAudioData: (audioData: ArrayBuffer) => Promise<any>;
      
      // Event listeners
      onWebSocketConnected: (callback: () => void) => void;
      onWebSocketDisconnected: (callback: () => void) => void;
      onWebSocketError: (callback: (event: any, error: string) => void) => void;
      onSessionCreated: (callback: (event: any, session: any) => void) => void;
      onSessionStarted: (callback: (event: any, session: any) => void) => void;
      onSessionEnded: (callback: (event: any, session: any) => void) => void;
      onTranscriptLine: (callback: (event: any, data: any) => void) => void;
      
      // Audio event listeners
      onAudioInitialized: (callback: (event: any) => void) => void;
      onAudioStarted: (callback: (event: any) => void) => void;
      onAudioStopped: (callback: (event: any) => void) => void;
      onAudioError: (callback: (event: any, error: any) => void) => void;
      
      // Main process command listeners
      onStartAudioCapture: (callback: (event: any) => void) => void;
      onStopAudioCapture: (callback: (event: any) => void) => void;
      
      // Remove event listeners
      removeAllListeners: (channel: string) => void;
    };
  }
}
