// Global variables
let audioManager = null;
let currentSession = null;
let isAudioCapturing = false;
let isSessionActive = false;

// UI State Management
const uiState = {
  panels: {
    summary: false,
    agent: false,
    transcript: false,
    debug: false
  },
  auth: {
    salesforce: false,
    slack: false
  },
  audio: {
    capturing: false
  },
  session: {
    active: false
  },
  calendar: {
    visible: false,
    events: []
  }
};

// Toast notification system
function showToast(type, title, message, duration = 4000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  toast.innerHTML = `
    <div class="toast-title">${title}</div>
    <div class="toast-message">${message}</div>
  `;
  
  container.appendChild(toast);
  
  // Trigger animation
  setTimeout(() => toast.classList.add('show'), 100);
  
  // Auto remove
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => container.removeChild(toast), 300);
  }, duration);
}

// Panel management
function togglePanel(panelName) {
  const panel = document.getElementById(`${panelName}-panel`);
  const button = document.getElementById(`${panelName}-btn`);
  
  if (uiState.panels[panelName]) {
    // Hide panel
    panel.classList.remove('visible');
    button.classList.remove('panel-active');
    uiState.panels[panelName] = false;
  } else {
    // Show panel
    panel.classList.add('visible');
    button.classList.add('panel-active');
    uiState.panels[panelName] = true;
  }
  
  repositionPanels();
}

function repositionPanels() {
  const visiblePanels = Object.keys(uiState.panels).filter(name => uiState.panels[name]);
  const panels = document.querySelectorAll('.floating-panel.visible');
  
  panels.forEach((panel, index) => {
    const offset = (index - (visiblePanels.length - 1) / 2) * 370; // 350px width + 20px gap
    panel.style.transform = `translateX(${offset}px)`;
  });
}

// Calendar management
function showCalendar() {
  const calendarStrip = document.getElementById('calendar-strip');
  calendarStrip.classList.add('visible');
  uiState.calendar.visible = true;
}

function hideCalendar() {
  const calendarStrip = document.getElementById('calendar-strip');
  calendarStrip.classList.remove('visible');
  uiState.calendar.visible = false;
}

function updateCalendarEvents(events) {
  const container = document.getElementById('events-container');
  container.innerHTML = '';
  
  events.forEach((event, index) => {
    const eventCard = document.createElement('div');
    eventCard.className = 'event-card';
    eventCard.dataset.eventId = event.Id || index;
    
    // Format event time
    const startTime = event.StartDateTime ? new Date(event.StartDateTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'TBD';
    const endTime = event.EndDateTime ? new Date(event.EndDateTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'TBD';
    
    eventCard.innerHTML = `
      <div class="event-header">
        <div class="event-icon">📅</div>
        <div class="event-title">${event.Subject || 'Untitled Event'}</div>
      </div>
      <div class="event-time">${startTime} - ${endTime}</div>
      <div class="event-actions">
        <button class="action-button" data-action="start-session" data-event-id="${event.Id || index}" title="Start Session">
          <img src="../../icons/start_stop_session.png" alt="Start">
        </button>
        <button class="action-button" data-action="slack-notify" data-event-id="${event.Id || index}" title="Notify in Slack">
          <img src="../../icons/slack_icon.png" alt="Slack">
        </button>
      </div>
    `;
    
    container.appendChild(eventCard);
  });
  
  // Attach event listeners
  attachCalendarEventListeners();
  uiState.calendar.events = events;
}

function attachCalendarEventListeners() {
  // Handle event card clicks (for selection)
  document.querySelectorAll('.event-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // Don't select if clicking on action buttons
      if (e.target.closest('.action-button')) return;
      
      // Remove selected class from all cards
      document.querySelectorAll('.event-card').forEach(c => c.classList.remove('selected'));
      
      // Add selected class to clicked card
      card.classList.add('selected');
      
      // Get event data
      const eventId = card.dataset.eventId;
      const eventTitle = card.querySelector('.event-title').textContent;
      const eventTime = card.querySelector('.event-time').textContent;
      
      console.log('Event selected:', { id: eventId, title: eventTitle, time: eventTime });
    });
  });
  
  // Handle action button clicks
  document.querySelectorAll('.action-button').forEach(button => {
    button.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent event card selection
      
      const action = button.dataset.action;
      const eventId = button.dataset.eventId;
      const eventCard = button.closest('.event-card');
      const eventTitle = eventCard.querySelector('.event-title').textContent;
      const eventTime = eventCard.querySelector('.event-time').textContent;
      
      if (action === 'start-session') {
        handleEventSessionStart({ id: eventId, title: eventTitle, time: eventTime });
      } else if (action === 'slack-notify') {
        handleEventSlackNotify({ id: eventId, title: eventTitle, time: eventTime });
      }
    });
  });
}

// Auth status updates
function updateAuthStatus(service, isConnected) {
  const button = document.getElementById(`${service}-btn`);
  uiState.auth[service] = isConnected;
  
  if (isConnected) {
    button.classList.remove('auth-disconnected');
    button.classList.add('auth-connected');
    showToast('notification', `${service.charAt(0).toUpperCase() + service.slice(1)} Connected`, 'Authentication successful');
  } else {
    button.classList.remove('auth-connected');
    button.classList.add('auth-disconnected');
  }
  
  // Show calendar if both are connected
  if (uiState.auth.salesforce && uiState.auth.slack) {
    showCalendar();
    // Auto-load events
    loadUserEvents();
  } else {
    hideCalendar();
  }
}

// Audio status updates
function updateAudioStatus(isCapturing) {
  const button = document.getElementById('audio-btn');
  uiState.audio.capturing = isCapturing;
  
  if (isCapturing) {
    button.classList.add('control-active');
    showToast('notification', 'Recording Started', 'Audio capture is active');
  } else {
    button.classList.remove('control-active');
    showToast('notification', 'Recording Stopped', 'Audio capture ended');
  }
}

// Session status updates
function updateSessionStatus(isActive) {
  const button = document.getElementById('session-btn');
  uiState.session.active = isActive;
  
  if (isActive) {
    button.classList.add('control-active');
    showToast('notification', 'Session Started', 'Meeting session is active');
  } else {
    button.classList.remove('control-active');
    showToast('notification', 'Session Ended', 'Meeting session completed');
  }
}

// Content updates for panels
function updatePanelContent(panelName, data) {
  const contentDiv = document.getElementById(`${panelName}-content`);
  
  switch (panelName) {
    case 'transcript':
      updateTranscriptContent(contentDiv, data);
      break;
    case 'agent':
      updateAgentContent(contentDiv, data);
      break;
    case 'summary':
      updateSummaryContent(contentDiv, data);
      break;
    case 'debug':
      updateDebugContent(contentDiv, data);
      break;
  }
}

function updateTranscriptContent(container, data) {
  if (data.text) {
    const transcriptLine = document.createElement('div');
    transcriptLine.className = `transcript-line ${data.is_final ? 'final' : 'interim'}`;
    
    const timestamp = new Date().toLocaleTimeString();
    transcriptLine.innerHTML = `
      <span class="timestamp">${timestamp}</span>
      <span class="transcript-text ${data.is_final ? 'final-text' : 'interim-text'}">${data.text}</span>
    `;
    
    container.appendChild(transcriptLine);
    container.scrollTop = container.scrollHeight;
  }
}

function updateAgentContent(container, data) {
  const responseCard = document.createElement('div');
  responseCard.className = 'content-card';
  
  responseCard.innerHTML = `
    <h4>AI Insight - ${new Date().toLocaleTimeString()}</h4>
    <p>${JSON.stringify(data, null, 2)}</p>
  `;
  
  container.appendChild(responseCard);
  container.scrollTop = container.scrollHeight;
}

function updateSummaryContent(container, data) {
  container.innerHTML = `
    <div class="content-card">
      <h4>Meeting Summary - ${new Date().toLocaleTimeString()}</h4>
      <p>${JSON.stringify(data, null, 2)}</p>
    </div>
  `;
}

function updateDebugContent(container, data) {
  // Debug content is handled by the existing debug panel logic
  console.log('Debug data:', data);
}

// Event handlers
async function handleSalesforceAuth() {
  try {
    showToast('notification', 'Salesforce Auth', 'Opening browser for authentication...');
    const result = await window.electronAPI.authenticateSalesforce();
    console.log('Salesforce auth result:', result);
    
    if (result.success) {
      updateAuthStatus('salesforce', true);
    } else {
      showToast('error', 'Salesforce Auth Failed', result.error || 'Authentication failed');
    }
  } catch (error) {
    console.error('Salesforce auth error:', error);
    showToast('error', 'Salesforce Auth Failed', error.message);
  }
}

async function handleSlackAuth() {
  try {
    showToast('notification', 'Slack Auth', 'Opening browser for authentication...');
    const result = await window.electronAPI.authenticateSlack();
    console.log('Slack auth result:', result);
    
    if (result.success) {
      updateAuthStatus('slack', true);
    } else {
      showToast('error', 'Slack Auth Failed', result.error || 'Authentication failed');
    }
  } catch (error) {
    console.error('Slack auth error:', error);
    showToast('error', 'Slack Auth Failed', error.message);
  }
}

async function handleAudioToggle() {
  try {
    if (uiState.audio.capturing) {
      await handleStopAudioCapture();
    } else {
      await handleStartAudioCapture();
    }
  } catch (error) {
    console.error('Audio toggle error:', error);
    showToast('error', 'Audio Toggle Failed', error.message);
  }
}

async function handleSessionToggle() {
  try {
    if (uiState.session.active) {
      await handleEndSession();
    } else {
      await handleStartSession();
    }
  } catch (error) {
    console.error('Session toggle error:', error);
    showToast('error', 'Session Toggle Failed', error.message);
  }
}

async function handleStartAudioCapture() {
  try {
    console.log('Starting audio capture...');
    const result = await window.electronAPI.startAudioCapture();
    
    if (result.success) {
      updateAudioStatus(true);
      isAudioCapturing = true;
      
      // Show transcript panel if not already visible
      if (!uiState.panels.transcript) {
        togglePanel('transcript');
      }
    } else {
      throw new Error(result.error || 'Failed to start audio capture');
    }
  } catch (error) {
    console.error('Start audio capture error:', error);
    showToast('error', 'Audio Start Failed', error.message);
  }
}

async function handleStopAudioCapture() {
  try {
    console.log('Stopping audio capture...');
    const result = await window.electronAPI.stopAudioCapture();
    
    updateAudioStatus(false);
    isAudioCapturing = false;
  } catch (error) {
    console.error('Stop audio capture error:', error);
    showToast('error', 'Audio Stop Failed', error.message);
  }
}

async function handleStartSession() {
  try {
    console.log('Starting session...');
    const result = await window.electronAPI.createSession();
    
    if (result.success) {
      currentSession = result.session;
      updateSessionStatus(true);
      isSessionActive = true;
      
      // Show relevant panels
      if (!uiState.panels.summary) {
        togglePanel('summary');
      }
      if (!uiState.panels.agent) {
        togglePanel('agent');
      }
    } else {
      throw new Error(result.error || 'Failed to start session');
    }
  } catch (error) {
    console.error('Start session error:', error);
    showToast('error', 'Session Start Failed', error.message);
  }
}

async function handleEndSession() {
  try {
    console.log('Ending session...');
    if (currentSession) {
      const result = await window.electronAPI.endSession(currentSession.id);
      console.log('End session result:', result);
    }
    
    updateSessionStatus(false);
    isSessionActive = false;
    currentSession = null;
  } catch (error) {
    console.error('End session error:', error);
    showToast('error', 'Session End Failed', error.message);
  }
}

async function handleEventSessionStart(event) {
  console.log('Starting session for event:', event);
  showToast('notification', 'Event Session', `Starting session for: ${event.title}`);
  await handleStartSession();
}

async function handleEventSlackNotify(event) {
  console.log('Notifying Slack for event:', event);
  showToast('notification', 'Slack Notification', `Notifying team about: ${event.title}`);
}

async function loadUserEvents() {
  try {
    showToast('notification', 'Loading Events', 'Fetching your calendar events...');
    const result = await window.electronAPI.getUserEvents();
    
    if (result && result.length > 0) {
      updateCalendarEvents(result);
      showToast('notification', 'Events Loaded', `Found ${result.length} events`);
    } else {
      showToast('error', 'No Events', 'No calendar events found');
    }
  } catch (error) {
    console.error('Load events error:', error);
    showToast('error', 'Events Load Failed', error.message);
  }
}

// Debug panel functionality (simplified)
function switchDebugTab(tabName) {
  // Hide all debug content
  document.querySelectorAll('.debug-content').forEach(content => {
    content.style.display = 'none';
  });
  
  // Remove active class from all tabs
  document.querySelectorAll('.debug-tab').forEach(tab => {
    tab.classList.remove('active');
  });
  
  // Show selected content and activate tab
  const selectedContent = document.getElementById(`${tabName}-debug`);
  const selectedTab = document.querySelector(`[data-tab="${tabName}"]`);
  
  if (selectedContent) selectedContent.style.display = 'block';
  if (selectedTab) selectedTab.classList.add('active');
}

// Setup event listeners
function setupEventListeners() {
  // Menu bar buttons
  document.getElementById('salesforce-btn').addEventListener('click', handleSalesforceAuth);
  document.getElementById('slack-btn').addEventListener('click', handleSlackAuth);
  document.getElementById('summary-btn').addEventListener('click', () => togglePanel('summary'));
  document.getElementById('agent-btn').addEventListener('click', () => togglePanel('agent'));
  document.getElementById('transcript-btn').addEventListener('click', () => togglePanel('transcript'));
  document.getElementById('audio-btn').addEventListener('click', handleAudioToggle);
  document.getElementById('session-btn').addEventListener('click', handleSessionToggle);
  document.getElementById('debug-btn').addEventListener('click', () => togglePanel('debug'));
  
  // Debug tabs
  document.querySelectorAll('.debug-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const targetTab = e.target.dataset.tab;
      switchDebugTab(targetTab);
    });
  });
}

// Setup WebSocket events
function setupWebSocketEvents() {
  if (window.electronAPI) {
    // Transcript events
    window.electronAPI.onTranscriptLine((data) => {
      updatePanelContent('transcript', data);
    });
    
    // AI events
    window.electronAPI.onInsightCreated((data) => {
      updatePanelContent('agent', { type: 'insight_created', data });
    });
    
    window.electronAPI.onInsightComplete((data) => {
      updatePanelContent('agent', { type: 'insight_complete', data });
    });
    
    window.electronAPI.onInsightError((data) => {
      updatePanelContent('agent', { type: 'insight_error', data });
    });
    
    // Summary events
    window.electronAPI.onSummaryGenerated((data) => {
      updatePanelContent('summary', data);
    });
    
    // Session events
    window.electronAPI.onSessionCreated((session) => {
      console.log('Session created:', session);
      currentSession = session;
    });
    
    window.electronAPI.onSessionStarted((session) => {
      console.log('Session started:', session);
      updateSessionStatus(true);
    });
    
    window.electronAPI.onSessionEnded((session) => {
      console.log('Session ended:', session);
      updateSessionStatus(false);
    });
  }
}

// Check initial auth status
async function checkInitialStatus() {
  try {
    const authStatus = await window.electronAPI.checkAuthStatus();
    console.log('Initial auth status:', authStatus);
    
    updateAuthStatus('salesforce', authStatus.salesforce);
    updateAuthStatus('slack', authStatus.slack);
  } catch (error) {
    console.error('Failed to check initial status:', error);
  }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM loaded, setting up new overlay UI');
  
  // Test electronAPI availability
  if (window.electronAPI) {
    console.log('electronAPI is available:', Object.keys(window.electronAPI));
  } else {
    console.error('electronAPI is not available!');
    showToast('error', 'System Error', 'Electron API not available');
    return;
  }
  
  try {
    // Setup event listeners
    setupEventListeners();
    
    // Setup WebSocket events
    setupWebSocketEvents();
    
    // Check initial status
    await checkInitialStatus();
    
    console.log('New overlay UI initialized successfully');
    showToast('notification', 'System Ready', 'Astro Meeting Intelligence is ready');
    
  } catch (error) {
    console.error('Initialization error:', error);
    showToast('error', 'Initialization Failed', error.message);
  }
});
