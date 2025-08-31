import { EventEmitter } from 'events';
import * as child_process from 'child_process';
import { promisify } from 'util';

const exec = promisify(child_process.exec);

// Type definitions for browser APIs that aren't available in Node.js
declare global {
  var navigator: Navigator;
  var MediaRecorder: any;
  
  interface MediaStream {
    getTracks(): MediaStreamTrack[];
  }
  
  interface MediaStreamTrack {
    stop(): void;
  }
  
  interface Navigator {
    mediaDevices: MediaDevices;
  }
  
  interface MediaDevices {
    getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  }
  
  interface MediaStreamConstraints {
    audio?: boolean | MediaTrackConstraints;
    video?: boolean | MediaTrackConstraints;
  }
  
  interface MediaTrackConstraints {
    sampleRate?: number;
    channelCount?: number;
    echoCancellation?: boolean;
    noiseSuppression?: boolean;
    autoGainControl?: boolean;
  }
}

export class AudioManager extends EventEmitter {
    private isCapturing = false;
    private mediaRecorder: any = null;
    private audioChunks: any[] = [];

    constructor() {
        super();
    }

    async startAudioCapture(): Promise<void> {
        try {
            console.log('Starting audio capture...');
            
            // Request microphone access
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true
                } 
            });

            // Create media recorder
            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus'
            });

            // Set up event handlers
            this.mediaRecorder.ondataavailable = (event: any) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                    this.processAudioChunk(event.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                console.log('Audio recording stopped');
                this.isCapturing = false;
                this.emit('stopped');
            };

            // Start recording
            this.mediaRecorder.start(1000); // Capture in 1-second chunks
            this.isCapturing = true;
            
            console.log('Audio capture started successfully');
            this.emit('started');
            
        } catch (error) {
            console.error('Error starting audio capture:', error);
            this.emit('error', error);
        }
    }

    stopAudioCapture(): void {
        if (this.mediaRecorder && this.isCapturing) {
            console.log('Stopping audio capture...');
            this.mediaRecorder.stop();
            this.mediaRecorder.stream.getTracks().forEach((track: any) => track.stop());
        }
    }

    private async processAudioChunk(audioBlob: any): Promise<void> {
        try {
            // Convert blob to array buffer
            const arrayBuffer = await audioBlob.arrayBuffer();
            
            // Convert to base64 for transmission
            const base64Audio = Buffer.from(arrayBuffer).toString('base64');
            
            // Emit the audio chunk for the main process to handle
            this.emit('audioChunk', {
                audio: base64Audio,
                timestamp: Date.now()
            });
            
        } catch (error) {
            console.error('Error processing audio chunk:', error);
        }
    }

    isCapturingAudio(): boolean {
        return this.isCapturing;
    }

    async setupAudioDevices(): Promise<void> {
        try {
            console.log('Setting up audio devices...');
            
            // Check if BlackHole is available
            const { stdout } = await exec('system_profiler SPAudioDataType | grep -i blackhole');
            
            if (stdout.includes('BlackHole')) {
                console.log('BlackHole audio device found');
                this.emit('blackholeAvailable');
            } else {
                console.log('BlackHole not found, will need to be installed');
                this.emit('blackholeNotAvailable');
            }
            
        } catch (error) {
            console.error('Error setting up audio devices:', error);
            this.emit('error', error);
        }
    }
}
