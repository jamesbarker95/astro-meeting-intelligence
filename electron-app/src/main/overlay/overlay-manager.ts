import { BrowserWindow, screen } from 'electron';
import * as path from 'path';

export interface PanelState {
  isVisible: boolean;
  window?: BrowserWindow;
  queuedData?: any[];
}

export class OverlayManager {
  private menuBarWindow: BrowserWindow | null = null;
  private calendarWindow: BrowserWindow | null = null;
  private toastWindow: BrowserWindow | null = null;
  private authPollingInterval: NodeJS.Timeout | null = null;
  private authState = { salesforce: false, slack: false };
  private sessionActive = false; // Track if session is currently active
  private openPanelOrder: Array<keyof typeof this.panels> = []; // Track order of opened panels
  private panels: {
    meetingSummary: PanelState;
    agentResponses: PanelState;
    transcript: PanelState;
    debug: PanelState;
  };

  constructor() {
    this.panels = {
      meetingSummary: { isVisible: false, queuedData: [] },
      agentResponses: { isVisible: false, queuedData: [] },
      transcript: { isVisible: false, queuedData: [] },
      debug: { isVisible: false, queuedData: [] }
    };
  }

  public async initialize(): Promise<void> {
    console.log('Initializing overlay system...');
    await this.createMenuBar();
    await this.createCalendarComponent();
    await this.createToastWindow();
    console.log('Overlay system initialized');
  }

  private async createMenuBar(): Promise<void> {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth } = primaryDisplay.workAreaSize;
    
    // Menu bar: 50% screen width, centered at top
    const menuWidth = Math.floor(screenWidth * 0.5);
    const menuX = Math.floor((screenWidth - menuWidth) / 2);

    this.menuBarWindow = new BrowserWindow({
      width: menuWidth,
      height: 60,
      x: menuX,
      y: 0,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000', // Fully transparent
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '..', 'preload.js'),
        experimentalFeatures: true
      }
    });

    // Load menu bar from HTML file
    await this.menuBarWindow.loadFile(path.join(__dirname, '..', '..', 'overlay', 'menu-bar.html'));

    // Open dev tools for menu bar in detached mode
    this.menuBarWindow.webContents.openDevTools({ mode: 'detach' });
    console.log('Menu bar dev tools opened in detached mode');

    console.log('Menu bar created at position:', { x: menuX, y: 0, width: menuWidth });
  }

  private async createCalendarComponent(): Promise<void> {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth } = primaryDisplay.workAreaSize;
    
    // Calendar component: same width as menu bar, positioned below with larger gap
    const calendarWidth = Math.floor(screenWidth * 0.5);
    const calendarX = Math.floor((screenWidth - calendarWidth) / 2);
    const menuBarHeight = 60;
    const gap = 100; // Increased gap to prevent menu bar overlap on hover
    const calendarY = menuBarHeight + gap;

    this.calendarWindow = new BrowserWindow({
      width: calendarWidth,
      height: 220, // More room for event cards
      x: calendarX,
      y: calendarY,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000', // Fully transparent
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      show: false, // Start hidden, will be shown when needed
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '..', 'preload.js'),
        experimentalFeatures: true
      }
    });

    // Load calendar from HTML file
    const calendarHtmlPath = path.join(__dirname, '..', '..', 'overlay', 'calendar.html');
    console.log('🔍 Loading calendar HTML from:', calendarHtmlPath);
    
    try {
      await this.calendarWindow.loadFile(calendarHtmlPath);
      console.log('✅ Calendar HTML loaded successfully');
    } catch (error) {
      console.error('❌ Failed to load calendar HTML:', error);
    }

    console.log('Calendar component created at position:', { x: calendarX, y: calendarY, width: calendarWidth });
  }

  private async createToastWindow(): Promise<void> {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth } = primaryDisplay.workAreaSize;
    
    // Position toast in top-right corner
    const toastWidth = 350;
    const toastHeight = 80;
    const margin = 20;
    const toastX = screenWidth - toastWidth - margin;
    const toastY = margin;

    this.toastWindow = new BrowserWindow({
      width: toastWidth,
      height: toastHeight,
      x: toastX,
      y: toastY,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      show: false, // Hidden by default
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '..', 'preload.js')
      }
    });

    // Load toast HTML content
    await this.toastWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(this.createToastHtml())}`);

    console.log('Toast window created at position:', { x: toastX, y: toastY, width: toastWidth, height: toastHeight });
  }





  public isPanelVisible(panelName: keyof typeof this.panels): boolean {
    const panel = this.panels[panelName];
    return panel ? panel.isVisible : false;
  }

  public async togglePanel(panelName: keyof typeof this.panels): Promise<void> {
    const panel = this.panels[panelName];
    
    if (panel.isVisible) {
      await this.hidePanel(panelName);
    } else {
      await this.showPanel(panelName);
    }
  }

  private async showPanel(panelName: keyof typeof this.panels): Promise<void> {
    const panel = this.panels[panelName];
    
    if (!panel.window) {
      panel.window = await this.createPanelWindow(panelName);
    }
    
    // Add to open panel order if not already there
    if (!this.openPanelOrder.includes(panelName)) {
      this.openPanelOrder.push(panelName);
    }
    
    panel.window.show();
    panel.isVisible = true;
    
    // Send any queued data to the newly opened panel
    if (panel.queuedData && panel.queuedData.length > 0) {
      console.log(`Sending ${panel.queuedData.length} queued items to ${panelName} panel`);
      for (const queuedItem of panel.queuedData) {
        panel.window.webContents.send('panel-data-update', queuedItem);
      }
      // Clear the queue after sending
      panel.queuedData = [];
    }
    
    // Reposition all open panels based on new order
    this.repositionAllPanels();
    
    // Notify menu bar of state change
    this.menuBarWindow?.webContents.send('panel-state-changed', panelName, true);
    
    console.log(`Panel ${panelName} shown at position ${this.openPanelOrder.indexOf(panelName)}`);
  }

  private async hidePanel(panelName: keyof typeof this.panels): Promise<void> {
    const panel = this.panels[panelName];
    
    if (panel.window) {
      panel.window.hide();
    }
    
    panel.isVisible = false;
    
    // Remove from open panel order
    const index = this.openPanelOrder.indexOf(panelName);
    if (index > -1) {
      this.openPanelOrder.splice(index, 1);
    }
    
    // Reposition remaining open panels
    this.repositionAllPanels();
    
    // Notify menu bar of state change
    this.menuBarWindow?.webContents.send('panel-state-changed', panelName, false);
    
    console.log(`Panel ${panelName} hidden, remaining panels repositioned`);
  }

  private async createPanelWindow(panelName: keyof typeof this.panels): Promise<BrowserWindow> {
    // Create window with initial position (will be repositioned dynamically)
    const panelWidth = 350;
    const panelHeight = 500;
    
    // Initial position (will be updated by repositionAllPanels)
    const x = 100;
    const y = 200;

    const panelWindow = new BrowserWindow({
      width: panelWidth,
      height: panelHeight,
      x,
      y,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000', // Fully transparent
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: true,
      show: false, // Start hidden, will be shown by showPanel
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '..', 'preload.js'),
        experimentalFeatures: true
      }
    });

    // Create panel HTML content
    const panelHtml = this.createPanelHtml(panelName);
    await panelWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(panelHtml)}`);

    console.log(`Panel ${panelName} created at position:`, { x, y, width: panelWidth, height: panelHeight });
    
    return panelWindow;
  }

  private createPanelHtml(panelName: keyof typeof this.panels): string {
    const panelTitle = this.getPanelTitle(panelName);
    const panelContent = this.getPanelContent(panelName);
    
    return `
<!DOCTYPE html>
<html>
<head>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" />
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        html {
            background: transparent;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: transparent;
            height: 100vh;
            color: white;
            overflow: hidden;
        }
        
        .panel-container {
            background: rgba(0, 0, 0, 0.9);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 8px;
            height: 100vh;
            padding: 20px;
            transform: translateY(-10px);
            animation: slideIn 0.3s ease forwards;
        }
        
        @keyframes slideIn {
            to {
                transform: translateY(0);
            }
        }
        
        .panel-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.15);
        }
        
        .panel-title {
            font-size: 18px;
            font-weight: 600;
            color: white;
        }
        
        .close-button {
            background: none;
            border: none;
            font-size: 18px;
            cursor: pointer;
            color: rgba(255, 255, 255, 0.7);
            padding: 4px;
            border-radius: 6px;
            transition: all 0.2s ease;
        }
        
        .close-button:hover {
            background: rgba(255, 255, 255, 0.1);
            color: white;
        }
        
        .panel-content {
            height: calc(100% - 60px);
            overflow-y: auto;
        }
        
        .content-card {
            background: transparent;
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 12px;
            transition: all 0.2s ease;
        }
        
        .content-card:hover {
            background: rgba(255, 255, 255, 0.03);
            border-color: rgba(255, 255, 255, 0.3);
        }
        
        .placeholder-text {
            color: rgba(255, 255, 255, 0.6);
            font-style: italic;
            text-align: center;
            padding: 40px 20px;
        }
        
        .transcript-container {
            margin-bottom: 16px;
            padding: 12px;
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            background: transparent;
        }
        
        .transcript-timestamp {
            font-size: 12px;
            color: rgba(255, 255, 255, 0.6);
            margin-bottom: 8px;
        }
        
        .transcript-text {
            font-size: 14px;
            line-height: 1.5;
            transition: all 0.3s ease;
        }
        
        .transcript-text.interim {
            color: rgba(255, 255, 255, 0.5);
            font-style: italic;
        }
        
        .transcript-text.final {
            color: white;
            font-style: normal;
        }
        }
    </style>
</head>
<body>
    <div class="panel-container">
        <div class="panel-header">
            <div class="panel-title">${panelTitle}</div>
            <button class="close-button" onclick="closePanel()">×</button>
        </div>
        <div class="panel-content" id="panel-content">
            ${panelContent}
        </div>
    </div>
    
    <script>
        function closePanel() {
            window.electronAPI?.togglePanel('${panelName}');
        }
        
        // Panel-specific initialization
        ${this.getPanelScript(panelName)}
    </script>
</body>
</html>`;
  }

  private getPanelTitle(panelName: keyof typeof this.panels): string {
    switch (panelName) {
      case 'meetingSummary':
        return 'Meeting Summary';
      case 'agentResponses':
        return 'Agent Responses';
      case 'transcript':
        return 'Live Transcript';
      case 'debug':
        return 'Debug Panel';
      default:
        return 'Panel';
    }
  }

  private getPanelContent(panelName: keyof typeof this.panels): string {
    switch (panelName) {
      case 'meetingSummary':
        return `
          <div class="placeholder-text">
            Meeting summary will appear here once the session starts...
          </div>
        `;
      case 'agentResponses':
        return `
          <div class="placeholder-text">
            AI agent responses and suggestions will appear here...
          </div>
        `;
      case 'transcript':
        return `
          <div class="placeholder-text">
            Live transcript will appear here during the meeting...
          </div>
        `;
      case 'debug':
        return `
          <div class="content-card">
            <h4>Model API Calls</h4>
            <div id="models-api-debug">No API calls yet...</div>
          </div>
          <div class="content-card">
            <h4>Agent Messages</h4>
            <div id="agent-debug">No agent messages yet...</div>
          </div>
          <div class="content-card">
            <h4>Context Updates</h4>
            <div id="context-debug">No context updates yet...</div>
          </div>
          <div class="content-card">
            <h4>Pipeline Status</h4>
            <div id="pipeline-debug">Pipeline inactive...</div>
          </div>
        `;
      default:
        return '<div class="placeholder-text">Panel content loading...</div>';
    }
  }

  private getPanelScript(panelName: keyof typeof this.panels): string {
    switch (panelName) {
      case 'transcript':
        return `
          console.log('🎯 TRANSCRIPT PANEL: Initializing progressive transcript...');
          
          let currentTranscriptElement = null;
          let currentTranscriptContainer = null;
          let lastFinalizedText = '';
          let isWaitingForNewSentence = false;
          
          // Function to update progressive transcript
          function updateProgressiveTranscript(transcriptData) {
            const panelTimestamp = new Date().toISOString();
            console.log(\`🎯 TRANSCRIPT PANEL [\${panelTimestamp}]: Updating progressive transcript:\`, {
              text: transcriptData.transcript?.substring(0, 50) + '...',
              isFinal: transcriptData.isFinal
            });
            
            const content = document.getElementById('panel-content');
            if (!content) {
              console.error('🎯 TRANSCRIPT PANEL: panel-content element not found');
              return;
            }
            
            const placeholder = content.querySelector('.placeholder-text');
            if (placeholder) {
              placeholder.remove();
              console.log('🎯 TRANSCRIPT PANEL: Removed placeholder text');
            }
            
            // Extract text from various possible properties
            let textContent = '';
            if (typeof transcriptData === 'string') {
              textContent = transcriptData;
            } else if (transcriptData && typeof transcriptData === 'object') {
              textContent = transcriptData.transcript || 
                           transcriptData.text || 
                           transcriptData.message_text || 
                           JSON.stringify(transcriptData);
            } else {
              textContent = String(transcriptData);
            }
            
            const isFinal = transcriptData.isFinal || false;
            
            // Check if this is a completely new sentence (not just an extension of the previous one)
            const isNewSentence = !currentTranscriptElement || 
                                 (isWaitingForNewSentence && !textContent.startsWith(lastFinalizedText.substring(0, 10)));
            
            // Create new container only for truly new sentences
            if (isNewSentence) {
              console.log('🎯 TRANSCRIPT PANEL: Creating new transcript element for new sentence');
              isWaitingForNewSentence = false;
              
              // Create new transcript container
              currentTranscriptContainer = document.createElement('div');
              currentTranscriptContainer.className = 'transcript-container';
              currentTranscriptContainer.style.cssText = 'margin-bottom: 16px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.1);';
              
              // Create timestamp
              const timestamp = document.createElement('div');
              timestamp.className = 'transcript-timestamp';
              timestamp.style.cssText = 'font-size: 12px; color: rgba(255, 255, 255, 0.6); margin-bottom: 8px;';
              timestamp.textContent = transcriptData.timestamp ? 
                new Date(transcriptData.timestamp).toLocaleTimeString() : 
                new Date().toLocaleTimeString();
              
              // Create text element
              currentTranscriptElement = document.createElement('div');
              currentTranscriptElement.className = 'transcript-text';
              currentTranscriptElement.style.cssText = 'font-size: 14px; line-height: 1.5;';
              
              currentTranscriptContainer.appendChild(timestamp);
              currentTranscriptContainer.appendChild(currentTranscriptElement);
              content.appendChild(currentTranscriptContainer);
            }
            
            // Always update the text content in the current element
            currentTranscriptElement.textContent = textContent;
            
            // Style based on isFinal status
            if (isFinal) {
              console.log('🎯 TRANSCRIPT PANEL: Finalizing transcript');
              currentTranscriptElement.className = 'transcript-text final';
              currentTranscriptElement.style.cssText = 'font-size: 14px; line-height: 1.5; color: white; font-style: normal;';
              
              // Remember this finalized text and prepare for next sentence
              lastFinalizedText = textContent;
              isWaitingForNewSentence = true;
            } else {
              console.log('🎯 TRANSCRIPT PANEL: Interim transcript update');
              currentTranscriptElement.className = 'transcript-text interim';
              currentTranscriptElement.style.cssText = 'font-size: 14px; line-height: 1.5; color: rgba(255, 255, 255, 0.5); font-style: italic;';
            }
            
            // Auto-scroll to bottom
            content.scrollTop = content.scrollHeight;
            console.log('🎯 TRANSCRIPT PANEL: Progressive transcript updated');
          }
          
          // Listen for transcript events from main process (multiple event types)
          if (window.electronAPI?.onTranscriptLine) {
            window.electronAPI.onTranscriptLine((transcriptData) => {
              console.log('🎯 TRANSCRIPT PANEL: Received onTranscriptLine:', transcriptData);
              updateProgressiveTranscript(transcriptData);
            });
          }
          
          if (window.electronAPI?.onTranscriptReceived) {
            window.electronAPI.onTranscriptReceived((transcriptData) => {
              console.log('🎯 TRANSCRIPT PANEL: Received onTranscriptReceived:', transcriptData);
              updateProgressiveTranscript(transcriptData);
            });
          }

          // Listen for panel data updates from overlay manager
          if (window.electronAPI?.onPanelDataUpdate) {
            window.electronAPI.onPanelDataUpdate((data) => {
              console.log('🎯 TRANSCRIPT PANEL: Received panel data update:', data);
              updateProgressiveTranscript(data);
            });
          }
          
          console.log('🎯 TRANSCRIPT PANEL: All event listeners registered');
        `;
      case 'meetingSummary':
        return `
          console.log('📋 SUMMARY PANEL: Initializing meeting summary panel...');
          
          // Listen for panel data updates from overlay manager (unified approach)
          window.electronAPI?.onPanelDataUpdate?.((data) => {
            console.log('📋 SUMMARY PANEL: Received panel data update:', data);
            const content = document.getElementById('panel-content');
            const placeholder = content.querySelector('.placeholder-text');
            const loading = document.getElementById('summary-loading');
            
            // Remove placeholder and loading states
            if (placeholder) {
              placeholder.remove();
            }
            if (loading) {
              loading.remove();
            }
            
            // Handle different types of summary data
            if (data && (data.summary || typeof data === 'string')) {
              console.log('📋 SUMMARY PANEL: Processing summary data:', data);
              
              // Extract the actual summary text
              let summaryText = 'No summary available'; // Default fallback
              let displayTimestamp = new Date().toLocaleString();
              let displayFinalTranscriptCount = '';

              if (typeof data === 'string') {
                summaryText = data;
              } else if (data && typeof data === 'object') {
                // Check for the nested summary property first
                if (data.summary && typeof data.summary.summary === 'string') {
                  summaryText = data.summary.summary;
                  displayTimestamp = data.summary.timestamp ? new Date(data.summary.timestamp).toLocaleString() : displayTimestamp;
                  displayFinalTranscriptCount = data.summary.finalTranscriptCount ? ' • Based on ' + data.summary.finalTranscriptCount + ' transcripts' : '';
                } else if (typeof data.summary === 'string') { // Fallback if summary is directly a string
                  summaryText = data.summary;
                  displayTimestamp = data.timestamp ? new Date(data.timestamp).toLocaleString() : displayTimestamp;
                  displayFinalTranscriptCount = data.finalTranscriptCount ? ' • Based on ' + data.finalTranscriptCount + ' transcripts' : '';
                } else { // If data.summary is an object but doesn't have a nested summary string
                  summaryText = JSON.stringify(data.summary, null, 2); // Fallback to stringify the object
                }
                // Also update top-level timestamp and count if available
                displayTimestamp = data.timestamp ? new Date(data.timestamp).toLocaleString() : displayTimestamp;
                displayFinalTranscriptCount = data.finalTranscriptCount ? ' • Based on ' + data.finalTranscriptCount + ' transcripts' : displayFinalTranscriptCount;
              }
              
              console.log('📋 SUMMARY PANEL: Extracted summary text:', summaryText);
              
              const summaryCard = document.createElement('div');
              summaryCard.className = 'content-card';
              summaryCard.innerHTML = \`
                <h4>Meeting Summary</h4>
                <div style="line-height: 1.6; margin-bottom: 12px;">
                  \${summaryText}
                </div>
                <div style="font-size: 12px; color: #666; border-top: 1px solid #eee; padding-top: 8px;">
                  Generated: \${displayTimestamp}
                  \${displayFinalTranscriptCount}
                </div>
              \`;
              
              // Add to top of content (most recent first)
              content.insertBefore(summaryCard, content.firstChild);
              
              // Keep only last 5 summaries to prevent clutter
              while (content.children.length > 5) {
                content.removeChild(content.lastChild);
              }
            } else if (data && data.type === 'generating') {
              // Show loading state
              const loadingCard = document.createElement('div');
              loadingCard.className = 'content-card';
              loadingCard.id = 'summary-loading';
              loadingCard.innerHTML = \`
                <h4>Generating Summary...</h4>
                <p><em>AI is analyzing the meeting content...</em></p>
                <div style="font-size: 12px; color: #666; margin-top: 8px;">
                  Transcripts processed: \${data.finalTranscriptCount || 'Unknown'}
                </div>
              \`;
              content.appendChild(loadingCard);
            }
          });
          
          console.log('📋 SUMMARY PANEL: Meeting summary panel initialized');
        `;
      case 'agentResponses':
        return `
          console.log('🤖 AGENT PANEL: Initializing agent responses panel...');
          
          // Track active insights for streaming updates
          let activeInsights = new Map();
          
          // Listen for panel data updates from overlay manager (unified approach)
          window.electronAPI?.onPanelDataUpdate?.((data) => {
            console.log('🤖 AGENT PANEL: Received panel data update:', data);
            const content = document.getElementById('panel-content');
            const placeholder = content.querySelector('.placeholder-text');
            
            if (placeholder) {
              placeholder.remove();
            }
            
            if (data && data.type === 'insight_created') {
              console.log('🤖 AGENT PANEL: Creating insight card for:', data.data.id);
              
              // Store insight data for streaming updates
              activeInsights.set(data.data.id, data.data);
              
              const insightCard = document.createElement('div');
              insightCard.className = 'content-card';
              insightCard.id = 'insight-' + data.data.id;
              
              // Use request_sent as the title (what was sent to Model API)
              const modelRequest = data.data.request_sent || 'AI Analysis Request';
              
              // Determine trigger text based on whether it's a direct question or transcript-triggered
              const triggerText = data.data.isDirectQuestion 
                ? 'User manually' 
                : (data.data.transcript_trigger?.substring(0, 60) || 'Unknown') + '...';
              
              insightCard.innerHTML = \`
                <h4>\${modelRequest}</h4>
                <div class="response-content" style="line-height: 1.5; margin: 12px 0;">
                  <em style="color: rgba(255, 255, 255, 0.6);">Generating response...</em>
                </div>
                <div style="font-size: 12px; color: rgba(255, 255, 255, 0.5); margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.1);">
                  Triggered by: \${triggerText}
                </div>
              \`;
              content.appendChild(insightCard);
              
              // Auto-scroll to bottom
              content.scrollTop = content.scrollHeight;
            } else if (data && data.type === 'insight_chunk') {
              console.log('🤖 AGENT PANEL: Streaming chunk for:', data.data.id);
              const insightCard = document.getElementById('insight-' + data.data.id);
              if (insightCard) {
                const responseContent = insightCard.querySelector('.response-content');
                if (responseContent) {
                  // Update with streaming content (Agent API response)
                  const currentInsight = activeInsights.get(data.data.id);
                  if (currentInsight) {
                    currentInsight.response_text = (currentInsight.response_text || '') + (data.data.chunk || '');
                    responseContent.innerHTML = currentInsight.response_text || 'Streaming...';
                    responseContent.style.color = 'white';
                    responseContent.style.fontStyle = 'normal';
                  }
                }
                // Auto-scroll to bottom
                content.scrollTop = content.scrollHeight;
              }
            } else if (data && data.type === 'insight_complete') {
              console.log('🤖 AGENT PANEL: Completing insight for:', data.data.insightId);
              const insightCard = document.getElementById('insight-' + data.data.insightId);
              if (insightCard) {
                const responseContent = insightCard.querySelector('.response-content');
                if (responseContent) {
                  // Final response from Agent API
                  responseContent.innerHTML = data.data.response || 'No response available';
                  responseContent.style.color = 'white';
                  responseContent.style.fontStyle = 'normal';
                  
                  // Add completion timestamp
                  const existingFooter = insightCard.querySelector('.insight-footer');
                  if (existingFooter) {
                    existingFooter.innerHTML += \` • Completed: \${new Date().toLocaleTimeString()}\`;
                  }
                }
                // Auto-scroll to bottom
                content.scrollTop = content.scrollHeight;
              } else {
                console.warn('🤖 AGENT PANEL: Could not find insight card for:', data.data.insightId);
              }
              
              // Clean up tracking
              activeInsights.delete(data.data.insightId);
            } else if (data && data.type === 'insight_error') {
              console.log('🤖 AGENT PANEL: Error for insight:', data.data.insightId);
              const insightCard = document.getElementById('insight-' + data.data.insightId);
              if (insightCard) {
                const responseContent = insightCard.querySelector('.response-content');
                if (responseContent) {
                  responseContent.innerHTML = \`<span style="color: #ff6b6b;">\${data.data.error || 'Unknown error occurred'}</span>\`;
                  responseContent.style.fontStyle = 'normal';
                  
                  // Add error timestamp
                  const existingFooter = insightCard.querySelector('.insight-footer');
                  if (existingFooter) {
                    existingFooter.innerHTML += \` • Failed: \${new Date().toLocaleTimeString()}\`;
                  }
                }
              }
              
              // Clean up tracking
              activeInsights.delete(data.data.insightId);
            }
          });
          
          console.log('🤖 AGENT PANEL: Agent responses panel initialized');
        `;
      case 'debug':
        return `
          console.log('🔧 DEBUG PANEL: Initializing debug event listeners...');
          
          // Function to add debug entry with timestamp
          function addDebugEntry(containerId, title, data) {
            const debugDiv = document.getElementById(containerId);
            if (!debugDiv) {
              console.error('🔧 DEBUG PANEL: Container not found:', containerId);
              return;
            }
            
            // Clear "No data yet..." placeholder
            if (debugDiv.textContent.includes('No ') && debugDiv.textContent.includes(' yet...')) {
              debugDiv.innerHTML = '';
            }
            
            const entry = document.createElement('div');
            entry.style.cssText = 'margin-bottom: 12px; padding: 8px; background: rgba(0,0,0,0.05); border-radius: 4px; border-left: 3px solid #007bff;';
            
            const timestamp = document.createElement('div');
            timestamp.style.cssText = 'font-size: 10px; color: #666; margin-bottom: 4px;';
            timestamp.textContent = new Date().toLocaleTimeString();
            
            const titleDiv = document.createElement('div');
            titleDiv.style.cssText = 'font-weight: bold; font-size: 12px; margin-bottom: 4px; color: #333;';
            titleDiv.textContent = title;
            
            const dataDiv = document.createElement('pre');
            dataDiv.style.cssText = 'font-size: 11px; margin: 0; white-space: pre-wrap; word-wrap: break-word; max-height: 200px; overflow-y: auto; background: rgba(0,0,0,0.1); padding: 6px; border-radius: 3px;';
            dataDiv.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
            
            entry.appendChild(timestamp);
            entry.appendChild(titleDiv);
            entry.appendChild(dataDiv);
            
            // Add to top of container
            debugDiv.insertBefore(entry, debugDiv.firstChild);
            
            // Keep only last 10 entries to prevent memory issues
            while (debugDiv.children.length > 10) {
              debugDiv.removeChild(debugDiv.lastChild);
            }
            
            console.log('🔧 DEBUG PANEL: Added entry to', containerId, ':', title);
          }
          
          // Listen for Models API calls
          if (window.electronAPI?.onModelsApiCall) {
            window.electronAPI.onModelsApiCall((data) => {
              console.log('🔧 DEBUG PANEL: Received Models API call:', data);
              addDebugEntry('models-api-debug', 'Models API Call', data);
            });
          }
          
          if (window.electronAPI?.onModelsApiResponse) {
            window.electronAPI.onModelsApiResponse((data) => {
              console.log('🔧 DEBUG PANEL: Received Models API response:', data);
              addDebugEntry('models-api-debug', 'Models API Response', data);
            });
          }
          
          // Listen for Agent messages
          if (window.electronAPI?.onAgentMessage) {
            window.electronAPI.onAgentMessage((data) => {
              console.log('🔧 DEBUG PANEL: Received Agent message:', data);
              addDebugEntry('agent-debug', 'Agent Message', data);
            });
          }
          
          if (window.electronAPI?.onAgentSessionCreated) {
            window.electronAPI.onAgentSessionCreated((data) => {
              console.log('🔧 DEBUG PANEL: Received Agent session created:', data);
              addDebugEntry('agent-debug', 'Agent Session Created', data);
            });
          }
          
          // Listen for Context updates
          if (window.electronAPI?.onContextSet) {
            window.electronAPI.onContextSet((data) => {
              console.log('🔧 DEBUG PANEL: Received Context set:', data);
              addDebugEntry('context-debug', 'Context Set', data);
            });
          }
          
          // Listen for Pipeline status
          if (window.electronAPI?.onPipelineStatus) {
            window.electronAPI.onPipelineStatus((data) => {
              console.log('🔧 DEBUG PANEL: Received Pipeline status:', data);
              addDebugEntry('pipeline-debug', 'Pipeline Status', data);
            });
          }
          
          // Listen for transcript events to show pipeline activity
          if (window.electronAPI?.onTranscriptReceived) {
            window.electronAPI.onTranscriptReceived((data) => {
              let debugData = {};
              if (typeof data === 'string') {
                debugData = { text: data, timestamp: new Date().toISOString() };
              } else if (data && typeof data === 'object') {
                debugData = {
                  text: data.transcript || data.text || data.message_text || '[No text found]',
                  confidence: data.confidence,
                  isFinal: data.isFinal,
                  timestamp: data.timestamp ? new Date(data.timestamp).toISOString() : new Date().toISOString(),
                  rawData: data
                };
              } else {
                debugData = { text: String(data), timestamp: new Date().toISOString() };
              }
              
              addDebugEntry('pipeline-debug', 'Transcript Received', debugData);
            });
          }
          
          // Listen for session events
          if (window.electronAPI?.onSessionCreated) {
            window.electronAPI.onSessionCreated((data) => {
              addDebugEntry('context-debug', 'Session Created', data);
            });
          }
          
          if (window.electronAPI?.onSessionStarted) {
            window.electronAPI.onSessionStarted((data) => {
              addDebugEntry('pipeline-debug', 'Session Started', data);
            });
          }
          
          // Listen for panel data updates from overlay manager (main routing)
          if (window.electronAPI?.onPanelDataUpdate) {
            window.electronAPI.onPanelDataUpdate((data) => {
              console.log('🔧 DEBUG PANEL: Received panel data update:', data);
              
              if (data && data.type) {
                let containerId = 'pipeline-debug'; // default
                let title = data.type;
                
                // Route to appropriate container based on debug type
                switch (data.type) {
                  case 'models_api_call':
                  case 'models_api_response':
                    containerId = 'models-api-debug';
                    title = data.type === 'models_api_call' ? 'Models API Call' : 'Models API Response';
                    break;
                  case 'agent_message':
                  case 'agent_session_created':
                    containerId = 'agent-debug';
                    title = data.type === 'agent_message' ? 'Agent Message' : 'Agent Session Created';
                    break;
                  case 'context_set':
                  case 'session_created':
                    containerId = 'context-debug';
                    title = data.type === 'context_set' ? 'Context Set' : 'Session Created';
                    break;
                  case 'pipeline_status':
                  case 'session_started':
                  case 'insight_created':
                  case 'insight_complete':
                  case 'insight_error':
                  case 'insight_processing_error':
                    containerId = 'pipeline-debug';
                    title = data.type.replace(/_/g, ' ').replace(/\\b\\w/g, l => l.toUpperCase());
                    break;
                }
                
                addDebugEntry(containerId, title, data.data);
              }
            });
          }
          
          console.log('🔧 DEBUG PANEL: All debug event listeners registered');
        `;
      default:
        return '';
    }
  }


  public showCalendar(): void {
    if (this.calendarWindow) {
      this.calendarWindow.show();
      console.log('Calendar component shown');
    }
  }

  public hideCalendar(): void {
    if (this.calendarWindow) {
      this.calendarWindow.hide();
      console.log('Calendar component hidden');
    }
  }

  public getMenuBarWindow(): BrowserWindow | null {
    return this.menuBarWindow;
  }

  public startAuthPolling(checkAuthStatusFn: () => Promise<{salesforce: boolean, slack: boolean}>, loadEventsFn?: () => Promise<any>): void {
    // Clear any existing polling
    if (this.authPollingInterval) {
      clearInterval(this.authPollingInterval);
    }

    console.log('Starting auth status polling...');
    
    this.authPollingInterval = setInterval(async () => {
      try {
        const authStatus = await checkAuthStatusFn();
        
        // Check if status changed
        const salesforceChanged = this.authState.salesforce !== authStatus.salesforce;
        const slackChanged = this.authState.slack !== authStatus.slack;
        
        // Check if both auths just became successful
        const wasNotBothAuthenticated = !(this.authState.salesforce && this.authState.slack);
        const nowBothAuthenticated = authStatus.salesforce && authStatus.slack;
        
        if (salesforceChanged || slackChanged) {
          console.log('Auth status changed:', authStatus);
          
          // Update internal state
          this.authState = authStatus;
          
          // Update menu bar UI and show success toasts
          if (salesforceChanged || slackChanged) {
            this.updateAuthUI();
          }
          
          if (salesforceChanged && authStatus.salesforce) {
            this.showToast('notification', 'Salesforce Connected', 'Authentication successful');
          }
          
          if (slackChanged && authStatus.slack) {
            this.showToast('notification', 'Slack Connected', 'Authentication successful');
          }
          
          // Auto-load events when both auths become successful (like "refresh auth")
          if (wasNotBothAuthenticated && nowBothAuthenticated) {
            console.log('Both auths now successful - auto-loading events');
            this.showToast('notification', 'All Connected', 'Loading calendar events...');
            
            if (loadEventsFn) {
              try {
                await loadEventsFn();
                console.log('Events loaded successfully');
              } catch (error) {
                console.error('Failed to load events:', error);
                this.showToast('error', 'Events Load Failed', 'Could not load calendar events');
              }
            }
          }
          
          // Stop polling and load events when both are connected (no hide/show)
          if (nowBothAuthenticated) {
            this.stopAuthPolling(); // Stop polling once both are connected
            // Calendar is already visible, just update with events
          }
        }
      } catch (error) {
        console.error('Auth polling error:', error);
      }
    }, 3000); // Poll every 3 seconds
  }

  public stopAuthPolling(): void {
    if (this.authPollingInterval) {
      clearInterval(this.authPollingInterval);
      this.authPollingInterval = null;
      console.log('Auth polling stopped');
    }
  }

  private updateAuthUI(): void {
    if (this.menuBarWindow) {
      // Send the full auth state object to match what the menu bar expects
      this.menuBarWindow.webContents.send('auth-state-changed', this.authState);
    }
  }

  public triggerAuthFlow(service: 'salesforce' | 'slack'): void {
    console.log(`Auth flow triggered for ${service}`);
    // The actual auth will be handled by the main process
    // We just need to start polling to detect when it completes
  }

  private repositionAllPanels(): void {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth } = primaryDisplay.workAreaSize;
    
    // Panel positioning constants
    const panelWidth = 350;
    const menuBarHeight = 60;
    const calendarHeight = 220; // Match the increased calendar height
    const gap = 80; // Match the increased calendar gap
    const panelGap = 15;
    
    // Check if calendar is visible and adjust top offset accordingly
    const isCalendarVisible = this.calendarWindow && this.calendarWindow.isVisible();
    const topOffset = isCalendarVisible 
      ? menuBarHeight + gap + calendarHeight + 20  // Smaller gap after calendar to account for padding
      : menuBarHeight + gap;  // Just menu gap when calendar is hidden
    
    // Get only visible panels in order
    const visiblePanels = this.openPanelOrder.filter(panelName => this.panels[panelName].isVisible);
    const numVisiblePanels = visiblePanels.length;
    
    if (numVisiblePanels === 0) return;
    
    // Calculate dynamic positioning based on number of open panels
    const totalPanelsWidth = (panelWidth * numVisiblePanels) + (panelGap * (numVisiblePanels - 1));
    const startX = Math.floor((screenWidth - totalPanelsWidth) / 2);
    
    // Position each visible panel
    visiblePanels.forEach((panelName, index) => {
      const panel = this.panels[panelName];
      if (panel.window && panel.isVisible) {
        const x = startX + (index * (panelWidth + panelGap));
        const y = topOffset;
        
        panel.window.setPosition(x, y);
        console.log(`Repositioned ${panelName} to position ${index} at (${x}, ${y})`);
      }
    });
  }

  private createToastHtml(): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: transparent;
          }
          
          .toast {
            background: rgba(0, 0, 0, 0.9);
            border-radius: 6px;
            padding: 16px 20px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
            border: 1px solid rgba(255, 255, 255, 0.15);
            width: 100%;
            display: flex;
            align-items: flex-start;
            gap: 12px;
            opacity: 0;
            transform: translateX(100%);
            transition: all 0.3s ease;
            cursor: pointer;
          }
          
          .toast:hover {
            background: rgba(0, 0, 0, 0.95);
            transform: translateX(-2px);
          }
          
          .toast.show {
            opacity: 1;
            transform: translateX(0);
          }
          
          .toast.notification {
            border-left: 4px solid #E3F2FD;
            background: rgba(0, 0, 0, 0.9);
          }
          
          .toast.error {
            border-left: 4px solid #FFEBEE;
            background: rgba(0, 0, 0, 0.9);
          }
          
          .toast-icon {
            font-size: 20px;
            flex-shrink: 0;
          }
          
          .toast-content {
            flex: 1;
          }
          
          .toast-title {
            font-weight: 600;
            font-size: 14px;
            margin-bottom: 2px;
            color: white;
          }
          
          .toast-message {
            font-size: 13px;
            color: white;
            line-height: 1.3;
          }
          
          .toast.clickable .toast-message::after {
            content: " (Click to view)";
            font-size: 11px;
            color: rgba(255, 255, 255, 0.7);
            font-style: italic;
          }
          
          .toast-close {
            background: none;
            border: none;
            font-size: 16px;
            cursor: pointer;
            color: #999;
            padding: 4px;
            border-radius: 4px;
            transition: background-color 0.2s ease;
          }
          
          .toast-close:hover {
            background: rgba(0, 0, 0, 0.1);
          }
        </style>
      </head>
      <body>
        <div id="toast" class="toast">
          <div class="toast-icon" id="toast-icon">ℹ️</div>
          <div class="toast-content">
            <div class="toast-title" id="toast-title">Notification</div>
            <div class="toast-message" id="toast-message">This is a test notification</div>
          </div>
          <button class="toast-close" id="toast-close">×</button>
        </div>
        
        <script>
          let hideTimeout = null;
          let currentAction = null;
          
          // Close button handler
          document.getElementById('toast-close').addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent toast click
            hideToast();
          });
          
          // Toast click handler
          document.getElementById('toast').addEventListener('click', () => {
            if (currentAction) {
              window.electronAPI?.toastAction?.(currentAction);
              hideToast();
            }
          });
          
          function showToast(type, title, message, duration = 4000, action = null) {
            const toast = document.getElementById('toast');
            const icon = document.getElementById('toast-icon');
            const titleEl = document.getElementById('toast-title');
            const messageEl = document.getElementById('toast-message');
            
            // Store action for click handler
            currentAction = action;
            
            // Add clickable class if action exists
            if (action) {
              toast.classList.add('clickable');
            } else {
              toast.classList.remove('clickable');
            }
            
            // Clear existing timeout
            if (hideTimeout) {
              clearTimeout(hideTimeout);
            }
            
            // Set content
            titleEl.textContent = title;
            messageEl.textContent = message;
            
            // Set type and icon
            toast.className = 'toast ' + type + (action ? ' clickable' : '');
            icon.textContent = type === 'error' ? '⚠️' : 'ℹ️';
            
            // Show toast
            setTimeout(() => {
              toast.classList.add('show');
            }, 10);
            
            // Auto-hide after duration
            hideTimeout = setTimeout(() => {
              hideToast();
            }, duration);
          }
          
          function hideToast() {
            const toast = document.getElementById('toast');
            toast.classList.remove('show');
            
            if (hideTimeout) {
              clearTimeout(hideTimeout);
              hideTimeout = null;
            }
          }
          
          // Listen for toast events from main process
          window.electronAPI?.onToastShow?.((data) => {
            showToast(data.type, data.title, data.message, data.duration, data.action);
          });
        </script>
      </body>
      </html>
    `;
  }

  public showToast(
    type: 'notification' | 'error', 
    title: string, 
    message: string, 
    duration: number = 4000,
    action?: { type: 'open-panel', panelName: string }
  ): void {
    if (!this.toastWindow) {
      console.warn('Toast window not initialized');
      return;
    }

    // Show the toast window
    this.toastWindow.show();
    
    // Send toast data to renderer
    this.toastWindow.webContents.send('toast:show', {
      type,
      title,
      message,
      duration,
      action
    });

    // Auto-hide the window after duration + animation time
    setTimeout(() => {
      if (this.toastWindow) {
        this.toastWindow.hide();
      }
    }, duration + 500);

    console.log(`Toast shown: ${type} - ${title}: ${message}`);
  }

  public updateAudioState(isCapturing: boolean): void {
    // Update menu bar audio button state
    if (this.menuBarWindow) {
      this.menuBarWindow.webContents.send('audio-state-changed', isCapturing);
    }
    console.log(`Audio state updated: ${isCapturing ? 'capturing' : 'stopped'}`);
  }

  public updateSessionState(isActive: boolean): void {
    console.log(`🎯 OVERLAY MANAGER: updateSessionState called with isActive=${isActive}`);
    console.log(`🎯 OVERLAY MANAGER: Calendar window exists: ${!!this.calendarWindow}`);
    console.log(`🎯 OVERLAY MANAGER: Calendar window visible: ${this.calendarWindow?.isVisible()}`);
    
    // Update internal session state
    this.sessionActive = isActive;
    
    // Update menu bar session button state
    if (this.menuBarWindow) {
      this.menuBarWindow.webContents.send('session-state-changed', isActive);
    }
    
    // Hide calendar when session starts, show when session ends
    if (isActive) {
      console.log('🎯 OVERLAY MANAGER: Attempting to hide calendar...');
      this.hideCalendar();
      console.log(`🎯 OVERLAY MANAGER: Calendar hidden - session started. Now visible: ${this.calendarWindow?.isVisible()}`);
    } else {
      console.log('🎯 OVERLAY MANAGER: Attempting to show calendar...');
      this.showCalendar();
      // Reset all event buttons to "Start Session" state when session ends
      this.resetEventButtons();
      console.log(`🎯 OVERLAY MANAGER: Calendar shown - session ended. Now visible: ${this.calendarWindow?.isVisible()}`);
    }
    
    console.log(`🎯 OVERLAY MANAGER: Session state updated: ${isActive ? 'active' : 'inactive'}`);
  }

  private resetEventButtons(): void {
    if (this.calendarWindow) {
      console.log('🔄 OVERLAY MANAGER: Resetting event buttons to Start Session state');
      this.calendarWindow.webContents.executeJavaScript(`
        // Reset all event buttons to default "Start Session" state
        document.querySelectorAll('.action-button[data-action="start-session"]').forEach(function(button) {
          // Reset button content to original state
          button.innerHTML = '<span class="material-symbols-outlined">play_circle</span>';
          button.title = 'Start Session';
          
          // Reset any inline styles
          button.style.backgroundColor = '';
          button.style.borderColor = '';
          button.style.transform = '';
          
          console.log('🔄 CALENDAR: Reset button for event:', button.getAttribute('data-event-id'));
        });
        
        // Also reset any event cards that might show "Session Active" text
        document.querySelectorAll('.event-card').forEach(function(card) {
          const statusElement = card.querySelector('.session-status');
          if (statusElement) {
            statusElement.remove();
          }
        });
      `);
    }
  }

  public updateMicrophoneState(isActive: boolean): void {
    console.log(`🎤 OVERLAY MANAGER: updateMicrophoneState called with isActive=${isActive}`);
    
    // Update menu bar microphone button state
    if (this.menuBarWindow) {
      this.menuBarWindow.webContents.send('microphone-state-changed', isActive);
    }
    
    console.log(`🎤 OVERLAY MANAGER: Microphone state updated: ${isActive ? 'active' : 'inactive'}`);
  }

  public updatePanelContent(panelName: keyof typeof this.panels, data: any): void {
    const panel = this.panels[panelName];
    if (panel.window && panel.isVisible) {
      // Send data to the specific panel via IPC
      panel.window.webContents.send('panel-data-update', data);
      console.log(`Panel ${panelName} updated with data:`, data);
    } else {
      console.log(`Panel ${panelName} not visible, data queued for when opened`);
      // Queue data for when panel is opened
      if (!panel.queuedData) {
        panel.queuedData = [];
      }
      panel.queuedData.push(data);
      // Keep only the last 50 items to prevent memory issues
      if (panel.queuedData.length > 50) {
        panel.queuedData = panel.queuedData.slice(-50);
      }
    }
  }

  public updateCalendarEvents(events: any[]): void {
    console.log('🔍 updateCalendarEvents called with:', events.length, 'events');
    console.log('🔍 Session active:', this.sessionActive);
    
    if (this.calendarWindow) {
      console.log('🔍 Calendar window exists, processing events...');
      
      // Only show calendar if session is not active
      if (!this.sessionActive) {
        console.log('🔍 Session not active, showing calendar...');
        this.showCalendar();
      } else {
        console.log('🔍 Session is active, keeping calendar hidden...');
      }
      
      // Wait a moment for the calendar to be ready, then send events
      setTimeout(() => {
        console.log('🔍 MAIN PROCESS: About to send events to calendar window...');
        
        // Method 1: Send via webContents.send (current method)
        this.calendarWindow!.webContents.send('events-loaded', events);
        console.log('🔍 MAIN PROCESS: Sent via webContents.send');
        
                          // Method 2: Direct DOM manipulation (bypass calendar JavaScript entirely)
                  // Create a simplified event object without the large text fields that cause JSON issues
                  const simplifiedEvents = events.map((event, index) => ({
                    Event_Id: event.Event_Id || index.toString(),
                    Title: event.Title || 'Untitled Event',
                    Start: event.Start || 'TBD',
                    End: event.End || 'TBD'
                  }));

                  this.calendarWindow!.webContents.executeJavaScript(`
                    (function() {
                      try {
                        const events = ${JSON.stringify(simplifiedEvents)};
                        console.log('🎯 CALENDAR: Directly updating DOM with events:', events);

                        // Find the calendar container
                        const container = document.querySelector('.calendar-container');
                        if (!container) {
                          throw new Error('Calendar container not found');
                        }

                        // Clear existing content
                        container.innerHTML = '';

                        // Add real events or show "No events" message
                        if (events.length === 0) {
                          container.innerHTML = '<div class="event-card" style="text-align: center; opacity: 0.6;"><div class="event-header"><div class="event-icon">📅</div><div class="event-title">No events found</div></div><div class="event-time">Check your Salesforce calendar</div></div>';
                        } else {
                          // Create event cards directly
                          events.forEach(function(event, index) {
                            const eventCard = document.createElement('div');
                            eventCard.className = 'event-card';
                            eventCard.setAttribute('data-event-id', event.Event_Id);

                            const startTime = event.Start;
                            const endTime = event.End;

                            eventCard.innerHTML = '<div class="event-header"><div class="event-icon">📅</div><div class="event-title">' + event.Title + '</div></div><div class="event-time">' + startTime + ' - ' + endTime + '</div><div class="event-actions"><button class="action-button" data-action="start-session" data-event-id="' + event.Event_Id + '" title="Start Session"><span class="material-symbols-outlined">play_circle</span></button><button class="action-button" data-action="slack-notify" data-event-id="' + event.Event_Id + '" title="Notify in Slack"><img src="../icons/slack_icon.png" alt="Slack"></button></div>';

                            container.appendChild(eventCard);
                          });
                        }

                        // Attach event listeners to the new buttons
                        document.querySelectorAll('.action-button').forEach(function(button) {
                          button.addEventListener('click', function(e) {
                            e.stopPropagation();
                            
                            const action = button.getAttribute('data-action');
                            const eventId = button.getAttribute('data-event-id');
                            const eventCard = button.closest('.event-card');
                            const eventTitle = eventCard.querySelector('.event-title').textContent;
                            const eventTime = eventCard.querySelector('.event-time').textContent;
                            
                            console.log('🎯 CALENDAR: Button clicked:', action, 'for event:', eventId);
                            
                            if (action === 'start-session') {
                              // Add visual feedback - change button color to blue
                              button.style.backgroundColor = '#007bff';
                              button.style.borderColor = '#007bff';
                              button.style.transform = 'scale(0.95)';
                              
                              if (window.electronAPI && window.electronAPI.startSessionForEvent) {
                                console.log('🎯 CALENDAR: Calling startSessionForEvent');
                                window.electronAPI.startSessionForEvent({
                                  id: eventId,
                                  title: eventTitle,
                                  time: eventTime
                                });
                                
                                // Reset button appearance after 2 seconds
                                setTimeout(function() {
                                  button.style.backgroundColor = '';
                                  button.style.borderColor = '';
                                  button.style.transform = '';
                                }, 2000);
                              } else {
                                console.error('❌ CALENDAR: electronAPI.startSessionForEvent not available');
                                // Reset button immediately if error
                                button.style.backgroundColor = '';
                                button.style.borderColor = '';
                                button.style.transform = '';
                              }
                            } else if (action === 'slack-notify') {
                              if (window.electronAPI && window.electronAPI.notifySlackForEvent) {
                                window.electronAPI.notifySlackForEvent({
                                  id: eventId,
                                  title: eventTitle,
                                  time: eventTime
                                });
                              }
                            }
                          });
                        });

                        console.log('🎯 CALENDAR: DOM updated successfully with', events.length, 'events and event listeners attached');
                        return 'DOM_UPDATED_SUCCESS';
                      } catch (error) {
                        console.error('❌ CALENDAR: DOM update error:', error);
                        throw error;
                      }
                    })();
                  `).then((result) => {
          console.log('🔍 MAIN PROCESS: DOM update completed successfully, result:', result);
        }).catch(err => {
          console.error('❌ MAIN PROCESS: Failed to update DOM:', err);
        });
        
        console.log(`✅ Calendar updated with ${events.length} events via both methods`);
      }, 100); // Small delay to ensure calendar is ready
    } else {
      console.log('❌ Calendar window does not exist!');
    }
  }

  public destroy(): void {
    // Stop auth polling
    this.stopAuthPolling();
    
    // Close all windows
    if (this.menuBarWindow) {
      this.menuBarWindow.close();
      this.menuBarWindow = null;
    }
    
    if (this.calendarWindow) {
      this.calendarWindow.close();
      this.calendarWindow = null;
    }
    
    if (this.toastWindow) {
      this.toastWindow.close();
      this.toastWindow = null;
    }
    
    Object.values(this.panels).forEach(panel => {
      if (panel.window) {
        panel.window.close();
        delete panel.window;
      }
    });
    
    console.log('Overlay system destroyed');
  }
}

