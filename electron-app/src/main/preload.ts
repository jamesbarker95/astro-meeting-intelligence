import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // WebSocket methods
  connectWebSocket: () => ipcRenderer.invoke('websocket:connect'),
  disconnectWebSocket: () => ipcRenderer.invoke('websocket:disconnect'),
  isWebSocketConnected: () => ipcRenderer.invoke('websocket:is-connected'),
  
  // Session methods
  createSession: (contextData?: any) => ipcRenderer.invoke('websocket:create-session', contextData),
  startSession: (sessionId?: string) => ipcRenderer.invoke('websocket:start-session', sessionId),
  endSession: (sessionId?: string) => ipcRenderer.invoke('websocket:end-session', sessionId),
  
  // Auth methods
  authenticateSalesforce: () => ipcRenderer.invoke('auth:salesforce'),
  authenticateSlack: () => ipcRenderer.invoke('auth:slack'),
  checkAuthStatus: () => ipcRenderer.invoke('auth:status'),
  getUserEvents: () => ipcRenderer.invoke('auth:get-user-events'),
  
  // Audio methods
  initializeAudio: () => ipcRenderer.invoke('audio:initialize'),
  startAudioCapture: () => ipcRenderer.invoke('audio:start'),
  stopAudioCapture: () => ipcRenderer.invoke('audio:stop'),
  getAudioStatus: () => ipcRenderer.invoke('audio:status'),
  sendAudioData: (audioData: ArrayBuffer) => ipcRenderer.invoke('audio:send-data', audioData),
  
  // Microphone control methods
  toggleMicrophone: () => ipcRenderer.invoke('microphone:toggle'),
  startMicrophone: () => ipcRenderer.invoke('microphone:start'),
  stopMicrophone: () => ipcRenderer.invoke('microphone:stop'),
  updateMicrophoneState: (isActive: boolean) => ipcRenderer.invoke('microphone:state-changed', isActive),
  
  // Overlay methods
  togglePanel: (panelName: string) => ipcRenderer.invoke('overlay:toggle-panel', panelName),
  showCalendar: () => ipcRenderer.invoke('overlay:show-calendar'),
  hideCalendar: () => ipcRenderer.invoke('overlay:hide-calendar'),
  selectCalendarEvent: (eventData: any) => ipcRenderer.invoke('calendar:select-event', eventData),
  startSessionForEvent: (eventData: any) => ipcRenderer.invoke('calendar:start-session-for-event', eventData),
  notifySlackForEvent: (eventData: any) => ipcRenderer.invoke('calendar:notify-slack-for-event', eventData),
  
  // Control methods (for menu bar buttons)
  toggleAudioCapture: () => ipcRenderer.invoke('audio:toggle'),
  toggleSession: () => ipcRenderer.invoke('session:toggle'),
  stopSession: () => ipcRenderer.invoke('session:stop'),
  
  // Toast notification methods
  showToast: (type: 'notification' | 'error', title: string, message: string, duration?: number) => 
    ipcRenderer.invoke('toast:show', type, title, message, duration),
  
  // Direct question submission
  submitDirectQuestion: (question: string) => ipcRenderer.invoke('search:submit-question', question),
  
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
  
  // Transcript events from main process (AssemblyAI)
  onTranscriptReceived: (callback: (data: any) => void) => {
    ipcRenderer.on('transcript-received', (_event, data) => {
      callback(data);
    });
  },
  
  // Summary event listeners
  onSummaryGenerating: (callback: (event: any, data: any) => void) => {
    ipcRenderer.on('summary:generating', callback);
  },
  onSummaryGenerated: (callback: (event: any, data: any) => void) => {
    ipcRenderer.on('summary:generated', callback);
  },
  onSummaryError: (callback: (event: any, data: any) => void) => {
    ipcRenderer.on('summary:error', callback);
  },

  // AI Insights event listeners
  onInsightCreated: (callback: (data: any) => void) => {
    ipcRenderer.on('insight:created', (_event, data) => {
      callback(data);
    });
  },
  onInsightChunk: (callback: (data: any) => void) => {
    ipcRenderer.on('insight:chunk', (_event, data) => {
      callback(data);
    });
  },
  onInsightComplete: (callback: (data: any) => void) => {
    ipcRenderer.on('insight:complete', (_event, data) => {
      callback(data);
    });
  },
  onInsightError: (callback: (data: any) => void) => {
    ipcRenderer.on('insight:error', (_event, data) => {
      callback(data);
    });
  },
  onInsightProcessingError: (callback: (data: any) => void) => {
    ipcRenderer.on('insight:processing_error', (_event, data) => {
      callback(data);
    });
  },

  // AI Debug event listeners
  onModelsApiCall: (callback: (data: any) => void) => {
    ipcRenderer.on('debug:models_api_call', (_event, data) => {
      callback(data);
    });
  },
  onModelsApiResponse: (callback: (data: any) => void) => {
    ipcRenderer.on('debug:models_api_response', (_event, data) => {
      callback(data);
    });
  },
  onAgentSessionCreated: (callback: (data: any) => void) => {
    ipcRenderer.on('debug:agent_session_created', (_event, data) => {
      callback(data);
    });
  },
  onAgentMessage: (callback: (data: any) => void) => {
    ipcRenderer.on('debug:agent_message', (_event, data) => {
      callback(data);
    });
  },
  onContextSet: (callback: (data: any) => void) => {
    ipcRenderer.on('debug:context_set', (_event, data) => {
      callback(data);
    });
  },
  onPipelineStatus: (callback: (data: any) => void) => {
    ipcRenderer.on('debug:pipeline_status', (_event, data) => {
      callback(data);
    });
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
  
  // Overlay event listeners
  onPanelStateChanged: (callback: (panelName: string, isVisible: boolean) => void) => {
    ipcRenderer.on('panel-state-changed', (_event, panelName, isVisible) => {
      callback(panelName, isVisible);
    });
  },
  
  // State change listeners for menu bar
  onAuthStateChanged: (callback: (authState: {salesforce: boolean, slack: boolean}) => void) => {
    ipcRenderer.on('auth-state-changed', (_event, authState) => {
      callback(authState);
    });
  },
  onAudioStateChanged: (callback: (isCapturing: boolean) => void) => {
    ipcRenderer.on('audio-state-changed', (_event, isCapturing) => {
      callback(isCapturing);
    });
  },
  onSessionStateChanged: (callback: (isActive: boolean) => void) => {
    ipcRenderer.on('session-state-changed', (_event, isActive) => {
      callback(isActive);
    });
  },
  
  // Microphone control event listeners
  onMicrophoneToggleRequest: (callback: () => void) => {
    ipcRenderer.on('microphone:toggle-request', callback);
  },
  onMicrophoneStartRequest: (callback: () => void) => {
    ipcRenderer.on('microphone:start-request', callback);
  },
  onMicrophoneStopRequest: (callback: () => void) => {
    ipcRenderer.on('microphone:stop-request', callback);
  },
  onMicrophoneStateChanged: (callback: (isActive: boolean) => void) => {
    ipcRenderer.on('microphone-state-changed', (_event, isActive) => {
      callback(isActive);
    });
  },
  
  // Toast event listeners
  onToastShow: (callback: (data: { type: string; title: string; message: string; duration: number; action?: any }) => void) => {
    ipcRenderer.on('toast:show', (_event, data) => {
      callback(data);
    });
  },
  
  // Toast action handler
  toastAction: (action: any) => ipcRenderer.invoke('toast:action', action),

  // Panel data update listener
  onPanelDataUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on('panel-data-update', (_event, data) => {
      callback(data);
    });
  },
  
  // Calendar events listener
  onEventsLoaded: (callback: (events: any[]) => void) => {
    ipcRenderer.on('events-loaded', (_event, events) => {
      callback(events);
    });
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
      createSession: (contextData?: any) => Promise<any>;
      startSession: (sessionId?: string) => Promise<any>;
      endSession: (sessionId?: string) => Promise<any>;
      
      // Auth methods
      authenticateSalesforce: () => Promise<any>;
      authenticateSlack: () => Promise<any>;
      checkAuthStatus: () => Promise<any>;
      getUserEvents: () => Promise<any>;
      
      // Audio methods
      initializeAudio: () => Promise<any>;
      startAudioCapture: () => Promise<any>;
      stopAudioCapture: () => Promise<any>;
      getAudioStatus: () => Promise<any>;
      sendAudioData: (audioData: ArrayBuffer) => Promise<any>;
      
      // Overlay methods
      togglePanel: (panelName: string) => Promise<any>;
      showCalendar: () => Promise<any>;
      hideCalendar: () => Promise<any>;
      selectCalendarEvent: (eventData: any) => Promise<any>;
      startSessionForEvent: (eventData: any) => Promise<any>;
      notifySlackForEvent: (eventData: any) => Promise<any>;
      
      // Control methods
      toggleAudioCapture: () => Promise<any>;
      toggleSession: () => Promise<any>;
      stopSession: () => Promise<any>;
      
      // Toast notification methods
      showToast: (type: 'notification' | 'error', title: string, message: string, duration?: number) => Promise<any>;
      
      // Direct question submission
      submitDirectQuestion: (question: string) => Promise<any>;
      
      // Event listeners
      onWebSocketConnected: (callback: () => void) => void;
      onWebSocketDisconnected: (callback: () => void) => void;
      onWebSocketError: (callback: (event: any, error: string) => void) => void;
      onSessionCreated: (callback: (event: any, session: any) => void) => void;
      onSessionStarted: (callback: (event: any, session: any) => void) => void;
      onSessionEnded: (callback: (event: any, session: any) => void) => void;
      onTranscriptLine: (callback: (event: any, data: any) => void) => void;
      
      // Summary event listeners
      onSummaryGenerating: (callback: (event: any, data: any) => void) => void;
      onSummaryGenerated: (callback: (event: any, data: any) => void) => void;
      onSummaryError: (callback: (event: any, data: any) => void) => void;
      
      // AI Insights event listeners
      onInsightCreated: (callback: (event: any, data: any) => void) => void;
      onInsightChunk: (callback: (event: any, data: any) => void) => void;
      onInsightComplete: (callback: (event: any, data: any) => void) => void;
      onInsightError: (callback: (event: any, data: any) => void) => void;
      onInsightProcessingError: (callback: (event: any, data: any) => void) => void;

      // AI Debug event listeners
      onModelsApiCall: (callback: (event: any, data: any) => void) => void;
      onModelsApiResponse: (callback: (event: any, data: any) => void) => void;
      onAgentSessionCreated: (callback: (event: any, data: any) => void) => void;
      onAgentMessage: (callback: (event: any, data: any) => void) => void;
      onContextSet: (callback: (event: any, data: any) => void) => void;
      onPipelineStatus: (callback: (event: any, data: any) => void) => void;
      
      // Audio event listeners
      onAudioInitialized: (callback: (event: any) => void) => void;
      onAudioStarted: (callback: (event: any) => void) => void;
      onAudioStopped: (callback: (event: any) => void) => void;
      onAudioError: (callback: (event: any, error: any) => void) => void;
      
      // Main process command listeners
      onStartAudioCapture: (callback: (event: any) => void) => void;
      onStopAudioCapture: (callback: (event: any) => void) => void;
      
      // Overlay event listeners
      onPanelStateChanged: (callback: (panelName: string, isVisible: boolean) => void) => void;
      
      // State change listeners for menu bar
      onAuthStateChanged: (callback: (authState: {salesforce: boolean, slack: boolean}) => void) => void;
      onAudioStateChanged: (callback: (isCapturing: boolean) => void) => void;
      onSessionStateChanged: (callback: (isActive: boolean) => void) => void;
      
      // Toast event listeners
      onToastShow: (callback: (data: { type: string; title: string; message: string; duration: number; action?: any }) => void) => void;
      toastAction: (action: any) => Promise<any>;
      
      // Panel data update listener
      onPanelDataUpdate: (callback: (data: any) => void) => void;
      
      // Calendar events listener
      onEventsLoaded: (callback: (events: any[]) => void) => void;
      
      // Remove event listeners
      removeAllListeners: (channel: string) => void;
    };
  }
}
