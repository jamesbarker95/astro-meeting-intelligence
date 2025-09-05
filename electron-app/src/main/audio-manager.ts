import { EventEmitter } from 'events';
// import { WebSocketManager } from './websocket/websocket-manager'; // REMOVED - no longer using
import { AudioProcessor } from './services/audio-processor';

// AudioManager with AssemblyAI transcription support
// The real audio capture happens in the renderer process
export class AudioManager extends EventEmitter {
  private isCapturing = false;
  // private websocketManager: WebSocketManager | null = null; // REMOVED - no longer sending to Heroku
  private audioProcessor: AudioProcessor | null = null;
  private assemblyAIApiKey = 'adec0151627147e9813c8da9cf7bcb4d'; // AssemblyAI API key
  private finalTranscriptCount = 0; // Track final transcripts for auto-summary
  private authManager: any = null; // Will be injected for summary generation
  // REMOVED: No longer storing transcripts in memory - UI handles display
  // private transcripts: any[] = []; // REMOVED - unnecessary memory usage
  private insights: any[] = []; // Store AI insights for the session
  private sessionContext: any = null; // Store session context for insights
  private lastProcessedTranscript = ''; // Track last processed transcript to extract only new parts
  
  // Fire-and-forget batch processing for meeting summaries
  private transcriptBatch: any[] = []; // Temporary batch for summary processing
  private readonly BATCH_SIZE = 5; // Process summaries every 5 final transcripts

  constructor() {
    super();
    this.initializeAudioProcessor();
  }

  private initializeAudioProcessor(): void {
    try {
      this.audioProcessor = new AudioProcessor(this.assemblyAIApiKey);
      
      // Set up event handlers for transcription
      this.audioProcessor.on('transcript', (transcriptData: any) => {
        const timestamp = new Date().toISOString();
        console.log(`🎵 AUDIO MANAGER [${timestamp}]: Transcript received:`, transcriptData);
        
        // REMOVED: No longer storing all transcripts in memory
        
        // Batch final transcripts for fire-and-forget summary processing
        if (transcriptData.isFinal) {
          this.finalTranscriptCount++;
          const finalTimestamp = new Date().toISOString();
          console.log(`🧠 AUDIO MANAGER [${finalTimestamp}]: Final transcript count: ${this.finalTranscriptCount}`);
          
          // Add to batch for summary processing
          this.transcriptBatch.push({
            text: transcriptData.transcript || transcriptData.text || '',
            timestamp: transcriptData.timestamp || Date.now(),
            confidence: transcriptData.confidence || 1.0
          });
          
          // Fire-and-forget batch processing every 5 final transcripts
          if (this.transcriptBatch.length >= this.BATCH_SIZE) {
            const batchTimestamp = new Date().toISOString();
            console.log(`🧠 AUDIO MANAGER [${batchTimestamp}]: Batch ready (${this.transcriptBatch.length} transcripts) - sending for summary processing`);
            this.processBatchSummary();
          }

          // Fire-and-forget AI processing (no blocking, no queue)
          this.fireAndForgetAIProcessing(transcriptData);
        }
        
        // REMOVED: No longer sending transcripts to Heroku - keeping local in Electron
        // if (this.websocketManager) {
        //   this.websocketManager.sendTranscript(transcriptData);
        // }
        
        // Emit to main process for UI updates
        this.emit('transcript', transcriptData);
      });

      this.audioProcessor.on('error', (error: any) => {
        console.error('🎵 AUDIO MANAGER: AudioProcessor error:', error);
        this.emit('transcription_error', error);
      });

      console.log('🎵 AUDIO MANAGER: AudioProcessor initialized');
    } catch (error) {
      console.error('🎵 AUDIO MANAGER: Failed to initialize AudioProcessor:', error);
    }
  }

  // REMOVED: setWebSocketManager - no longer using WebSocket to Heroku
  // setWebSocketManager(websocketManager: WebSocketManager): void {
  //   this.websocketManager = websocketManager;
  //   console.log('🔗 AUDIO MANAGER: WebSocket manager connected');
  // }

  setAuthManager(authManager: any): void {
    this.authManager = authManager;
    console.log('🔗 AUDIO MANAGER: Auth manager connected for summary generation');
  }

  setSessionContext(context: any): void {
    this.sessionContext = context;
    // Reset transcript tracking for new session
    this.lastProcessedTranscript = '';
    console.log('🔗 AUDIO MANAGER: Session context set for AI insights, transcript tracking reset');
  }

  async initialize(): Promise<void> {
    console.log('AudioManager (stub): Initialized');
    this.emit('initialized');
  }

  async startAudioCapture(): Promise<void> {
    console.log('🎵 AUDIO MANAGER: Starting audio capture with AssemblyAI transcription');
    
    try {
      // Reset final transcript counter, transcripts, and insights for new session
      this.finalTranscriptCount = 0;
      // REMOVED: this.transcripts = []; // No longer storing transcripts in memory
      this.insights = [];
      console.log('🧠 AUDIO MANAGER: Reset final transcript counter, transcripts, and insights for new session');
      
      // Start AssemblyAI processing
      if (this.audioProcessor) {
        await this.audioProcessor.startProcessing();
        console.log('🎵 AUDIO MANAGER: AssemblyAI processing started');
      }
      
      this.isCapturing = true;
      this.emit('started');
      console.log('🎵 AUDIO MANAGER: Audio capture started successfully');
    } catch (error) {
      console.error('🎵 AUDIO MANAGER: Failed to start audio capture:', error);
      this.emit('error', error);
      throw error;
    }
  }

  stopAudioCapture(): void {
    console.log('🎵 AUDIO MANAGER: Stopping audio capture');
    
    try {
      // Stop AssemblyAI processing
      if (this.audioProcessor) {
        this.audioProcessor.stopProcessing();
        console.log('🎵 AUDIO MANAGER: AssemblyAI processing stopped');
      }
      
      this.isCapturing = false;
      this.emit('stopped');
      console.log('🎵 AUDIO MANAGER: Audio capture stopped successfully');
    } catch (error) {
      console.error('🎵 AUDIO MANAGER: Error stopping audio capture:', error);
    }
  }

  async receiveAudioData(audioData: ArrayBuffer | string): Promise<void> {
    // Debug logging (reduced frequency to avoid spam)
    if (Math.random() < 0.01) { // ~1% chance
      console.log('🎧 AUDIO MANAGER: Received audio data', {
        dataType: typeof audioData,
        dataLength: audioData instanceof ArrayBuffer ? audioData.byteLength : audioData.length,
        isArrayBuffer: audioData instanceof ArrayBuffer,
        isString: typeof audioData === 'string',
        hasAudioProcessor: !!this.audioProcessor,
        audioProcessorReady: this.audioProcessor ? this.audioProcessor.isReady() : false
      });
    }
    
    // Send audio to AssemblyAI for transcription
    if (this.audioProcessor && this.audioProcessor.isReady()) {
      try {
        // Ensure audioData is a string (base64) for AssemblyAI processing
        const audioString = typeof audioData === 'string' ? audioData : 
          Buffer.from(audioData).toString('base64');
        
        this.audioProcessor.processAudioData(audioString);
        
        // Debug log occasionally
        if (Math.random() < 0.01) {
          console.log('🎵 AUDIO MANAGER: Sent audio to AssemblyAI processor');
        }
      } catch (error) {
        console.error('❌ AUDIO MANAGER: Failed to process audio with AssemblyAI:', error);
      }
    } else {
      // Debug why AssemblyAI isn't processing
      if (Math.random() < 0.01) {
        console.log('🎵 AUDIO MANAGER: NOT sending to AssemblyAI', {
          hasAudioProcessor: !!this.audioProcessor,
          audioProcessorReady: this.audioProcessor ? this.audioProcessor.isReady() : false
        });
      }
    }
  }

  getStatus(): { isCapturing: boolean; hasAudioSignal: boolean; audioLevel: number } {
    return {
      isCapturing: this.isCapturing,
      hasAudioSignal: false,
      audioLevel: 0
    };
  }

  // REMOVED: triggerAutoSummary - now handled by batch processing
  /*
  private async triggerAutoSummary(): Promise<void> {
    try {
      console.log('🧠 AUDIO MANAGER: Starting auto-summary generation...');
      
      if (!this.authManager) {
        console.warn('🧠 AUDIO MANAGER: Cannot generate summary - AuthManager not available');
        return;
      }
      
      // Emit event to UI to show loading state
      this.emit('summary_generating', { 
        finalTranscriptCount: this.finalTranscriptCount,
        trigger: 'auto'
      });
      
      // Generate summary using AuthManager with real transcripts
      // REMOVED: No longer using stored transcripts - using batch processing instead
      console.log(`🧠 AUDIO MANAGER: Auto-summary now handled by batch processing`);
      // const summary = await this.authManager.generateMeetingSummary(finalTranscripts);
      
      // REMOVED: Auto-summary logic - now handled by batch processing
      const summary = null; // Placeholder
      if (false && summary) {
        console.log('🧠 AUDIO MANAGER: Auto-summary generated successfully');
        
        // Send summary to Heroku for storage
        if (this.websocketManager && summary) {
          this.websocketManager.sendSummary(summary);
        }
        
        // Emit to UI for immediate display
        this.emit('summary_generated', {
          summary,
          finalTranscriptCount: this.finalTranscriptCount,
          trigger: 'auto',
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('🧠 AUDIO MANAGER: Auto-summary generation failed:', error);
      this.emit('summary_error', {
        error: error instanceof Error ? error.message : String(error),
        finalTranscriptCount: this.finalTranscriptCount,
        trigger: 'auto'
      });
    }
  }
  */

  // Get current session transcripts for summary generation
  // REMOVED: getSessionTranscripts - no longer storing transcripts in memory
  // Transcripts are now handled in real-time batches for summaries

  // Get only final transcripts for summary generation
  // REMOVED: getFinalTranscripts - no longer storing transcripts in memory
  // Final transcripts are now processed immediately in batches for summaries

  // Get current session insights
  getSessionInsights(): any[] {
    return this.insights.slice(); // Return a copy to prevent external modification
  }

  // ===== FIRE-AND-FORGET AI PROCESSING =====
  
  // Fire-and-forget AI processing (no queues, no blocking)
  private fireAndForgetAIProcessing(transcriptData: any): void {
    const fullTranscriptText = transcriptData.transcript || transcriptData.text || '';
    if (!fullTranscriptText || fullTranscriptText.trim().length === 0) {
      return;
    }
    
    // Extract only the NEW part of the transcript (AssemblyAI sends full accumulated text)
    let newTranscriptPart = '';
    if (this.lastProcessedTranscript && fullTranscriptText.startsWith(this.lastProcessedTranscript)) {
      // Extract only the new part that was added
      newTranscriptPart = fullTranscriptText.substring(this.lastProcessedTranscript.length).trim();
    } else {
      // First transcript or completely different text
      newTranscriptPart = fullTranscriptText.trim();
    }
    
    // Update the last processed transcript
    this.lastProcessedTranscript = fullTranscriptText;
    
    if (!newTranscriptPart || newTranscriptPart.length === 0) {
      console.log('🚀 AUDIO MANAGER: No new transcript content to process');
      return;
    }
    
    const aiTimestamp = new Date().toISOString();
    console.log(`🚀 AUDIO MANAGER [${aiTimestamp}]: Fire-and-forget AI processing (NEW PART ONLY): "${newTranscriptPart.substring(0, 50)}..."`);
    console.log(`🚀 AUDIO MANAGER [${aiTimestamp}]: Full transcript length: ${fullTranscriptText.length}, New part length: ${newTranscriptPart.length}`);
    
    // Fire-and-forget relevancy check with only the new part
    this.fireAndForgetRelevancyCheck(newTranscriptPart);
  }
  
  // Fire-and-forget batch summary processing with context preservation
  private processBatchSummary(): void {
    if (this.transcriptBatch.length === 0) return;
    
    const batchToProcess = [...this.transcriptBatch]; // Copy the batch
    this.transcriptBatch = []; // Clear the batch immediately (non-blocking)
    
    console.log(`🧠 AUDIO MANAGER: Processing batch of ${batchToProcess.length} transcripts for summary`);
    
    // Fire-and-forget: Send batch for processing without waiting for response
    this.fireAndForgetBatchSummary(batchToProcess);
  }
  
  // Fire-and-forget batch summary with context preservation
  private async fireAndForgetBatchSummary(batch: any[]): Promise<void> {
    try {
      if (!this.authManager || !this.sessionContext) {
        console.log('🧠 AUDIO MANAGER: Skipping batch summary - missing dependencies');
        return;
      }
      
      const batchText = batch.map(t => t.text).join(' ');
      const previousSummary = this.sessionContext.currentSummary || '';
      
      console.log(`🧠 AUDIO MANAGER: Fire-and-forget batch summary processing (${batch.length} transcripts)`);
      
      // Fire-and-forget: Don't await the response, just send it
      this.authManager.generateMeetingSummary(
        batchText,
        this.sessionContext.meetingBrief || '',
        this.sessionContext.competitiveIntelligence || '',
        previousSummary // Include previous summary for context continuity
      ).then((summary: any) => {
        // Update context with new summary (for next batch)
        if (this.sessionContext) {
          this.sessionContext.currentSummary = summary;
        }
        console.log('🧠 AUDIO MANAGER: Batch summary completed and context updated');
      }).catch((error: any) => {
        console.error('🧠 AUDIO MANAGER: Batch summary error (non-blocking):', error);
      });
      
    } catch (error) {
      console.error('🧠 AUDIO MANAGER: Fire-and-forget batch summary error:', error);
    }
  }
  
  // Fire-and-forget relevancy check (no blocking, no response waiting)
  private fireAndForgetRelevancyCheck(transcriptText: string): void {
    try {
      if (!this.authManager || !this.sessionContext) {
        console.log('🤖 AUDIO MANAGER: Skipping relevancy check - missing dependencies');
        return;
      }

      console.log(`🔍 AUDIO MANAGER: Fire-and-forget relevancy check: "${transcriptText.substring(0, 50)}..."`);
      
      // Fire-and-forget: Don't await the response, just send it
      this.authManager.checkTranscriptRelevancy(
        transcriptText,
        this.sessionContext.meetingBrief || '',
        this.sessionContext.competitiveIntelligence || '',
        this.sessionContext.agentCapabilities || ''
      ).then((relevancyResult: any) => {
        console.log('🔍 AUDIO MANAGER: Relevancy result (non-blocking):', relevancyResult);
        
        // If relevant, fire-and-forget Agent API call
        if (!relevancyResult.includes('Waiting_For_More_Context')) {
          this.fireAndForgetAgentAPI(transcriptText, relevancyResult);
        }
      }).catch((error: any) => {
        console.error('🔍 AUDIO MANAGER: Relevancy check error (non-blocking):', error);
      });
      
    } catch (error) {
      console.error('🚨 AUDIO MANAGER: Fire-and-forget relevancy check error:', error);
    }
  }
  
  // Fire-and-forget Agent API call (no blocking, no response waiting)
  private fireAndForgetAgentAPI(transcriptText: string, relevancyResult: string): void {
    console.log(`🤖 AUDIO MANAGER: Fire-and-forget Agent API: "${transcriptText.substring(0, 50)}..."`);
    
    try {
      if (!this.authManager || !this.sessionContext) {
        console.log('🤖 AUDIO MANAGER: Skipping Agent API - missing dependencies');
        return;
      }

      // Create insight entry immediately for UI (non-blocking)
      const insightId = `insight_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const insight = {
        id: insightId,
        transcript_trigger: transcriptText,
        request_sent: relevancyResult,
        response_status: 'processing' as 'queued' | 'streaming' | 'complete' | 'error',
        response_text: '',
        timestamp: new Date().toISOString(),
        error: null as string | null
      };

      // Store insight and emit to UI
      this.insights.push(insight);
      this.emit('insight_created', insight);
    
      // Fire-and-forget: Don't await the response, just send it
      this.authManager.sendAgentMessage(
        relevancyResult,
        (chunk: string) => {
          // Handle streaming chunks (non-blocking)
          insight.response_text += chunk;
          this.emit('insight_chunk', { insightId, chunk, status: 'streaming' });
        },
        (fullResponse: string) => {
          // Handle completion (non-blocking)
          insight.response_text = fullResponse;
          insight.response_status = 'complete';
          this.emit('insight_complete', { insightId, response: fullResponse });
          console.log(`✅ AUDIO MANAGER: Agent API insight complete (non-blocking): ${insightId}`);
        },
        (error: string) => {
          // Handle errors (non-blocking)
          insight.response_status = 'error';
          insight.error = error;
          this.emit('insight_error', { insightId, error });
          console.error(`❌ AUDIO MANAGER: Agent API insight failed (non-blocking): ${insightId}`, error);
        }
      ).catch((error: any) => {
        console.error('🚨 AUDIO MANAGER: Fire-and-forget Agent API error:', error);
        insight.response_status = 'error';
        insight.error = error instanceof Error ? error.message : String(error);
        this.emit('insight_error', { insightId: insight.id, error: insight.error });
      });
      
    } catch (error) {
      console.error('🚨 AUDIO MANAGER: Fire-and-forget Agent API setup error:', error);
    }
  }
  
  // REMOVED: updateMeetingSummary - now handled by batch processing
  // Meeting summaries are now processed in batches of 5 transcripts with context preservation

  cleanup(): void {
    this.stopAudioCapture();
    this.removeAllListeners();
  }
}