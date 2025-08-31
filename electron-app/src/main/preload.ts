import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // WebSocket methods
  connectWebSocket: () => ipcRenderer.invoke('websocket:connect'),
  disconnectWebSocket: () => ipcRenderer.invoke('websocket:disconnect'),
  isWebSocketConnected: () => ipcRenderer.invoke('websocket:is-connected'),
  
  // Session methods
  createSession: () => ipcRenderer.invoke('createSession'),
  startSession: (sessionId: string) => ipcRenderer.invoke('startSession', sessionId),
  endSession: (sessionId: string) => ipcRenderer.invoke('endSession', sessionId),
  
  // Auth methods
  authenticateSalesforce: () => ipcRenderer.invoke('auth:salesforce'),
  authenticateSlack: () => ipcRenderer.invoke('auth:slack'),
  checkAuthStatus: () => ipcRenderer.invoke('auth:check-status'),
  
  // Audio methods
  checkAudioSetup: () => ipcRenderer.invoke('audio:check-setup'),
  runAudioSetup: () => ipcRenderer.invoke('audio:run-setup'),
  startAudioCapture: () => ipcRenderer.invoke('audio:start-capture'),
  stopAudioCapture: () => ipcRenderer.invoke('audio:stop-capture'),
  isAudioCapturing: () => ipcRenderer.invoke('audio:is-capturing'),
  getAudioConfig: () => ipcRenderer.invoke('audio:get-config'),
  sendAudioChunk: (audioData: ArrayBuffer) => ipcRenderer.invoke('audio:send-chunk', audioData),
  
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
  onSessionCreated: (callback: (event: any, session: any) => void) => {
    ipcRenderer.on('session-created', callback);
  },
  onSessionStarted: (callback: (event: any, session: any) => void) => {
    ipcRenderer.on('session-started', callback);
  },
  onSessionEnded: (callback: (event: any, session: any) => void) => {
    ipcRenderer.on('session-ended', callback);
  },
  onTranscriptLine: (callback: (event: any, text: string) => void) => {
    ipcRenderer.on('transcript-line', callback);
  },
  
  // Audio event listeners
  onAudioSetupProgress: (callback: (event: any, data: any) => void) => {
    ipcRenderer.on('audio-setup-progress', callback);
  },
  onAudioSetupComplete: (callback: (event: any, data: any) => void) => {
    ipcRenderer.on('audio-setup-complete', callback);
  },
  onAudioSetupError: (callback: (event: any, data: any) => void) => {
    ipcRenderer.on('audio-setup-error', callback);
  },
  onAudioStarted: (callback: (event: any, data: any) => void) => {
    ipcRenderer.on('audio-started', callback);
  },
  onAudioStopped: (callback: (event: any) => void) => {
    ipcRenderer.on('audio-stopped', callback);
  },
  onAudioError: (callback: (event: any, data: any) => void) => {
    ipcRenderer.on('audio-error', callback);
  },
  
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
      startSession: (sessionId: string) => Promise<any>;
      endSession: (sessionId: string) => Promise<any>;
      
      // Auth methods
      authenticateSalesforce: () => Promise<any>;
      authenticateSlack: () => Promise<any>;
      checkAuthStatus: () => Promise<any>;
      
      // Audio methods
      checkAudioSetup: () => Promise<any>;
      runAudioSetup: () => Promise<any>;
      startAudioCapture: () => Promise<any>;
      stopAudioCapture: () => Promise<any>;
      isAudioCapturing: () => Promise<boolean>;
      getAudioConfig: () => Promise<any>;
      sendAudioChunk: (audioData: ArrayBuffer) => Promise<any>;
      
      // Event listeners
      onWebSocketConnected: (callback: () => void) => void;
      onWebSocketDisconnected: (callback: () => void) => void;
      onWebSocketError: (callback: (event: any, error: string) => void) => void;
      onSessionCreated: (callback: (event: any, session: any) => void) => void;
      onSessionStarted: (callback: (event: any, session: any) => void) => void;
      onSessionEnded: (callback: (event: any, session: any) => void) => void;
      onTranscriptLine: (callback: (event: any, text: string) => void) => void;
      
      // Audio event listeners
      onAudioSetupProgress: (callback: (event: any, data: any) => void) => void;
      onAudioSetupComplete: (callback: (event: any, data: any) => void) => void;
      onAudioSetupError: (callback: (event: any, data: any) => void) => void;
      onAudioStarted: (callback: (event: any, data: any) => void) => void;
      onAudioStopped: (callback: (event: any) => void) => void;
      onAudioError: (callback: (event: any, data: any) => void) => void;
      
      // Main process command listeners
      onStartAudioCapture: (callback: (event: any) => void) => void;
      onStopAudioCapture: (callback: (event: any) => void) => void;
      
      // Remove event listeners
      removeAllListeners: (channel: string) => void;
    };
  }
}
