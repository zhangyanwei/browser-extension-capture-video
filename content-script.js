class AdvancedVideoCapture {
    constructor() {
        this.mediaRecorder = null;
        this.recordingActive = false;
        this.chunks = [];
        this.captureUI = null;
        this.audioContext = null;
        this.audioSource = null;
        this.audioDestination = null;

        // UI elements
        this.startButton = null;
        this.stopButton = null;
        this.timeDisplay = null;
        this.progressBar = null;
    }

    createCaptureUI() {
        // Remove existing UI if any
        if (this.captureUI) {
            document.body.removeChild(this.captureUI);
        }

        // Create floating capture control panel
        this.captureUI = document.createElement('div');
        this.captureUI.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 15px;
            border-radius: 10px;
            z-index: 10000;
            display: flex;
            flex-direction: column;
            align-items: center;
            min-width: 200px;
        `;

        // Start Button
        this.startButton = document.createElement('button');
        this.startButton.textContent = '🔴 Start Recording';
        this.startButton.style.cssText = `
            background-color: green;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            margin-bottom: 10px;
        `;

        // Stop Button
        this.stopButton = document.createElement('button');
        this.stopButton.textContent = '⏹️ Stop Recording';
        this.stopButton.style.cssText = `
            background-color: red;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            display: none;
        `;

        // Time Display
        this.timeDisplay = document.createElement('div');
        this.timeDisplay.style.marginBottom = '10px';
        this.timeDisplay.textContent = '00:00';

        // Progress Bar
        this.progressBar = document.createElement('progress');
        this.progressBar.max = 100;
        this.progressBar.value = 0;
        this.progressBar.style.width = '100%';

        // Keyboard Shortcut Info
        const shortcutInfo = document.createElement('small');
        shortcutInfo.textContent = 'Tip: Press Ctrl+Shift+S to stop';
        shortcutInfo.style.marginTop = '10px';
        shortcutInfo.style.fontSize = '0.8em';
        shortcutInfo.style.color = '#ccc';

        // Assemble UI
        this.captureUI.appendChild(this.startButton);
        this.captureUI.appendChild(this.stopButton);
        this.captureUI.appendChild(this.timeDisplay);
        this.captureUI.appendChild(this.progressBar);
        this.captureUI.appendChild(shortcutInfo);

        // Add to document
        document.body.appendChild(this.captureUI);

        // Event Listeners
        this.startButton.addEventListener('click', () => this.startCapture());
        this.stopButton.addEventListener('click', () => this.stopRecording());
    }

    resetAudioContext() {
        // Close and reset audio context if exists
        if (this.audioContext) {
            try {
                this.audioContext.close();
            } catch (error) {
                // Suppress errors on closing, can happen if context is already lost
            }
        }
        this.audioContext = null;
        this.audioSource = null;
        this.audioDestination = null;
    }

    async startCapture() {
        // Reset previous recording state
        this.resetAudioContext();
        
        const videoElement = document.querySelector('video');
        
        if (!videoElement) {
            alert('No video element found. Please open a video first.');
            return;
        }

        try {
            // Update UI
            this.startButton.style.display = 'none';
            this.stopButton.style.display = 'block';

            // Create new audio context
            this.audioContext = new AudioContext();
            this.audioDestination = this.audioContext.createMediaStreamDestination();
            
            // Capture video stream
            const videoStream = videoElement.captureStream 
                ? videoElement.captureStream() 
                : videoElement.mozCaptureStream();

            // Connect audio source
            this.audioSource = this.audioContext.createMediaElementSource(videoElement);
            this.audioSource.connect(this.audioDestination);
            this.audioSource.connect(this.audioContext.destination);

            // Combine streams
            const combinedStream = new MediaStream([
                ...videoStream.getTracks(),
                ...this.audioDestination.stream.getTracks()
            ]);

            // Initialize recorder
            this.mediaRecorder = new MediaRecorder(combinedStream, {
                mimeType: 'video/webm'
            });

            // Reset chunks
            this.chunks = [];
            this.recordingActive = true;

            // Event handlers
            this.mediaRecorder.ondataavailable = (e) => this.chunks.push(e.data);
            this.mediaRecorder.onstop = () => this.saveRecording();

            // Start recording
            this.mediaRecorder.start();

            // Time tracking
            let startTime = Date.now();
            
            const updateTimer = setInterval(() => {
                if (!this.recordingActive) {
                    clearInterval(updateTimer);
                    return;
                }
                const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
                const minutes = Math.floor(elapsedSeconds / 60);
                const seconds = elapsedSeconds % 60;
                this.timeDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                
                // Update progress
                if (videoElement && !videoElement.ended) {
                    this.progressBar.value = (elapsedSeconds / videoElement.duration) * 100;
                }
            }, 1000);

            // Keyboard shortcut to stop
            const stopRecordingShortcut = (e) => {
                if (e.ctrlKey && e.shiftKey && e.key === 'S') {
                    e.preventDefault();
                    this.stopRecording();
                    window.removeEventListener('keydown', stopRecordingShortcut);
                }
            };
            window.addEventListener('keydown', stopRecordingShortcut);

        } catch (error) {
            chrome.runtime.sendMessage({
                type: 'CAPTURE_ERROR',
                error: error.toString()
            });
            this.stopRecording();
        }
    }

    stopRecording() {
        if (!this.recordingActive) return;

        this.recordingActive = false;
        
        // Stop media recorder
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }

        // Disconnect the recording destination, but leave the audio playing.
        if (this.audioSource && this.audioDestination) {
            this.audioSource.disconnect(this.audioDestination);
        }

        // Remove capture UI
        if (this.captureUI) {
            document.body.removeChild(this.captureUI);
            this.captureUI = null;
        }
    }

    saveRecording() {
        if (this.chunks.length === 0) return;

        const blob = new Blob(this.chunks, { type: 'video/webm' });

        // Convert blob to data URL to send to background script
        const reader = new FileReader();
        reader.onload = () => {
            // Use Chrome's download API via background script
            chrome.runtime.sendMessage({
                type: 'DOWNLOAD_VIDEO',
                url: reader.result, // This will be the data URL
                filename: this.sanitizeFilename(document.title) + '_captured.webm'
            });
        };
        reader.readAsDataURL(blob);

        this.chunks = [];
    }

    sanitizeFilename(originalTitle, maxLength = 50) {
        const forbiddenChars = /[<>:"/\\|?*\u0000-\u001F]/g;
        
        let sanitizedTitle = originalTitle
            .replace(forbiddenChars, '')
            .trim();
        
        sanitizedTitle = sanitizedTitle.length > maxLength 
            ? sanitizedTitle.substring(0, maxLength) 
            : sanitizedTitle;
        
        sanitizedTitle = sanitizedTitle.replace(/[\s_]+/g, '_');
        
        return sanitizedTitle || 'video_capture';
    }
}

// Initialize capture when extension icon is clicked or a message is received
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'START_CAPTURE_UI') {
        // Ensure any previous capture is stopped
        if (window.videoCapture) {
            window.videoCapture.stopRecording();
        }

        // Create global capture instance and its UI
        window.videoCapture = new AdvancedVideoCapture();
        window.videoCapture.createCaptureUI();
    }
});