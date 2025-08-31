import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';

export interface TranscriptLine {
  text: string;
  confidence: number;
  start: number;
  end: number;
  isFinal: boolean;
  timestamp: number;
}

export interface PythonStatus {
  isRunning: boolean;
  deepgramConnected: boolean;
  error?: string;
}

export class PythonManager extends EventEmitter {
  private pythonProcess: ChildProcess | null = null;
  private pythonScriptPath: string;
  private isInitialized = false;
  private isRunning = false;
  private deepgramConnected = false;

  constructor() {
    super();
    // Use Python from virtual environment
    this.pythonScriptPath = path.join(__dirname, '..', 'python', 'transcription_service.py');
    console.log('PythonManager: Constructor initialized');
    console.log('PythonManager: Python script path:', this.pythonScriptPath);
  }

  async initialize(apiKey: string, deviceName?: string): Promise<void> {
    console.log('PythonManager: Initializing with API key and device:', deviceName);
    
    try {
      // Use Python from virtual environment
      const pythonExecutable = path.join(__dirname, '..', 'python', 'venv', 'bin', 'python');
      console.log('PythonManager: Python executable path:', pythonExecutable);
      
      const args = [
        this.pythonScriptPath,
        '--api-key', apiKey,
        '--device-name', deviceName || 'Astro',
        '--command', 'status'
      ];
      
      console.log('PythonManager: Spawn arguments:', args);
      console.log('PythonManager: Working directory:', path.dirname(this.pythonScriptPath));
      
      this.pythonProcess = spawn(pythonExecutable, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: path.dirname(this.pythonScriptPath)
      });

      console.log('PythonManager: Python process spawned with PID:', this.pythonProcess.pid);

      this.pythonProcess.stdout?.on('data', (data) => {
        const output = data.toString().trim();
        console.log('PythonManager: Python stdout:', output);
        this.handlePythonOutput(output);
      });

      this.pythonProcess.stderr?.on('data', (data) => {
        const error = data.toString().trim();
        console.log('PythonManager: Python stderr:', error);
        this.handlePythonError(error);
      });

      this.pythonProcess.on('error', (error) => {
        console.log('PythonManager: Python process error:', error);
        this.handleProcessError(error);
      });

      this.pythonProcess.on('exit', (code, signal) => {
        console.log('PythonManager: Python process exited with code:', code, 'signal:', signal);
        this.handleProcessExit(code, signal);
      });

      this.pythonProcess.on('close', (code) => {
        console.log('PythonManager: Python process closed with code:', code);
        this.handleProcessClose(code);
      });

      // Wait a bit for the status check to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      this.isInitialized = true;
      console.log('PythonManager: Initialization completed successfully');
      this.emit('initialized');
      
    } catch (error) {
      console.log('PythonManager: Initialization error:', error);
      this.handleProcessError(error as Error);
      throw error;
    }
  }

  async startTranscription(): Promise<void> {
    console.log('PythonManager: Starting transcription');
    
    if (!this.isInitialized) {
      const error = 'Python service not initialized';
      console.log('PythonManager: Start failed -', error);
      throw new Error(error);
    }

    try {
      // Kill existing process if running
      if (this.pythonProcess) {
        console.log('PythonManager: Killing existing Python process');
        this.pythonProcess.kill();
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Use Python from virtual environment
      const pythonExecutable = path.join(__dirname, '..', 'python', 'venv', 'bin', 'python');
      console.log('PythonManager: Starting new Python process with executable:', pythonExecutable);
      
      const args = [
        this.pythonScriptPath,
        '--api-key', '547f2a8ba13eab840e01d9f8cf1bb5dc8d1bf259',
        '--device-name', 'Astro',
        '--command', 'start'
      ];
      
      console.log('PythonManager: Start transcription spawn arguments:', args);
      console.log('PythonManager: Working directory:', path.dirname(this.pythonScriptPath));
      
      this.pythonProcess = spawn(pythonExecutable, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: path.dirname(this.pythonScriptPath)
      });

      console.log('PythonManager: New Python process spawned with PID:', this.pythonProcess.pid);

      this.pythonProcess.stdout?.on('data', (data) => {
        const output = data.toString().trim();
        console.log('PythonManager: Transcription stdout:', output);
        this.handlePythonOutput(output);
      });

      this.pythonProcess.stderr?.on('data', (data) => {
        const error = data.toString().trim();
        console.log('PythonManager: Transcription stderr:', error);
        this.handlePythonError(error);
      });

      this.pythonProcess.on('error', (error) => {
        console.log('PythonManager: Transcription process error:', error);
        this.handleProcessError(error);
      });

      this.pythonProcess.on('exit', (code, signal) => {
        console.log('PythonManager: Transcription process exited with code:', code, 'signal:', signal);
        this.handleProcessExit(code, signal);
      });

      this.pythonProcess.on('close', (code) => {
        console.log('PythonManager: Transcription process closed with code:', code);
        this.handleProcessClose(code);
      });

      this.isRunning = true;
      console.log('PythonManager: Transcription started successfully');
      this.emit('started');
      
    } catch (error) {
      console.log('PythonManager: Start transcription error:', error);
      this.handleProcessError(error as Error);
      throw error;
    }
  }

  async stopTranscription(): Promise<void> {
    console.log('PythonManager: Stopping transcription');
    
    if (this.pythonProcess) {
      console.log('PythonManager: Sending SIGTERM to Python process');
      this.pythonProcess.kill('SIGTERM');
      
      // Wait for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Force kill if still running
      if (this.pythonProcess && !this.pythonProcess.killed) {
        console.log('PythonManager: Force killing Python process');
        this.pythonProcess.kill('SIGKILL');
      }
      
      this.pythonProcess = null;
    }

    this.isRunning = false;
    this.deepgramConnected = false;
    console.log('PythonManager: Transcription stopped');
    this.emit('stopped');
  }

  async getStatus(): Promise<PythonStatus> {
    console.log('PythonManager: Getting status - isRunning:', this.isRunning, 'deepgramConnected:', this.deepgramConnected);
    return {
      isRunning: this.isRunning,
      deepgramConnected: this.deepgramConnected
    };
  }

  private handlePythonOutput(output: string): void {
    console.log('PythonManager: Processing Python output:', output);
    
    // Handle JSON responses
    if (output.startsWith('{')) {
      try {
        const data = JSON.parse(output);
        console.log('PythonManager: Parsed JSON data:', data);
        
        if (data.type === 'status') {
          this.deepgramConnected = data.data?.deepgramConnected || false;
          console.log('PythonManager: Updated Deepgram connection status:', this.deepgramConnected);
        } else if (data.type === 'error') {
          console.log('PythonManager: Python service error:', data.error);
          this.emit('error', new Error(data.error));
        }
      } catch (error) {
        console.log('PythonManager: Failed to parse JSON output:', error);
      }
    } else {
      // Handle transcript lines
      this.handleTranscriptLine(output);
    }
  }

  private handleTranscriptLine(line: string): void {
    console.log('PythonManager: Processing transcript line:', line);
    
    const match = line.match(/^(FINAL|INTERIM):\[(\d{2}:\d{2}:\d{2})\]\s*(.+)$/);
    
    if (match) {
      const [, type, , text] = match;
      const isFinal = type === 'FINAL';
      
      const transcriptLine: TranscriptLine = {
        text: text?.trim() || '',
        confidence: 0,
        start: 0,
        end: 0,
        isFinal,
        timestamp: Date.now()
      };
      
      console.log('PythonManager: Emitting transcript:', transcriptLine);
      this.emit('transcript', transcriptLine);
    } else {
      console.log('PythonManager: Non-transcript output:', line);
    }
  }

  private handlePythonError(error: string): void {
    console.log('PythonManager: Python stderr output:', error);
    
    // Check for Deepgram connection messages
    if (error.includes('Deepgram connection opened')) {
      this.deepgramConnected = true;
      console.log('PythonManager: Deepgram connected');
    } else if (error.includes('Deepgram connection closed') || error.includes('Deepgram connection error')) {
      this.deepgramConnected = false;
      console.log('PythonManager: Deepgram disconnected');
    }
  }

  private handleProcessError(error: Error): void {
    console.log('PythonManager: Process error occurred:', error);
    this.isRunning = false;
    this.deepgramConnected = false;
    this.emit('error', error);
  }

  private handleProcessExit(code: number | null, signal: string | null): void {
    console.log('PythonManager: Process exit - code:', code, 'signal:', signal);
    this.isRunning = false;
    this.deepgramConnected = false;
    
    const exitData = { code, signal, timestamp: Date.now() };
    console.log('PythonManager: Emitting exited event with data:', exitData);
    this.emit('exited', exitData);
  }

  private handleProcessClose(code: number | null): void {
    console.log('PythonManager: Process close - code:', code);
    this.isRunning = false;
    this.deepgramConnected = false;
  }
}
