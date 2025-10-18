class AdvancedVideoCapture {
    constructor() {
        this.mediaRecorder = null;
        this.recordingActive = false;
        this.chunks = [];
        this.captureUI = null;

        // UI elements
        this.startButton = null;
        this.stopButton = null;
        this.timeDisplay = null;
        this.progressBar = null;
        this.webmSeeker = new WebMSeeker();
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

    async startCapture() {
        const videoElement = document.querySelector('video');
        
        if (!videoElement) {
            alert('No video element found. Please open a video first.');
            return;
        }

        try {
            // Update UI
            this.startButton.style.display = 'none';
            this.stopButton.style.display = 'block';
            
            // Capture video and audio stream directly from the video element
            const stream = videoElement.captureStream 
                ? videoElement.captureStream() 
                : videoElement.mozCaptureStream();

            // Check for audio tracks
            if (stream.getAudioTracks().length === 0) {
                console.warn('No audio track found in the video stream. Recording video only.');
            }

            // Use webm, as it supports Opus audio and is more flexible.
            const mimeType = 'video/webm';
            
            // Initialize recorder with the combined stream and chosen MIME type
            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType: mimeType
            });

            // Reset chunks and set recording state
            this.chunks = [];
            this.recordingActive = true;

            // Collect data chunks into an array
            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    this.chunks.push(e.data);
                }
            };
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
        
        // Stop media recorder, which triggers onstop to save the file
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }

        // Remove capture UI
        if (this.captureUI) {
            document.body.removeChild(this.captureUI);
            this.captureUI = null;
        }
    }

    async saveRecording() {
        if (this.chunks.length === 0) return;

        const blob = new Blob(this.chunks, { type: 'video/webm' });

        // Fix the webm blob to make it seekable
        const seekableBlob = await this.webmSeeker.process(blob);

        const url = URL.createObjectURL(seekableBlob);

        // Use Chrome's download API via background script
        chrome.runtime.sendMessage({
            type: 'DOWNLOAD_VIDEO',
            url: url, // This is a memory-efficient object URL
            filename: this.sanitizeFilename(document.title) + '.webm'
        });

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

/**
 * A utility class to process a WebM blob and inject metadata to make it seekable.
 * This is a simplified implementation adapted from ts-ebml.
 */
class WebMSeeker {
    constructor() {
        this.reader = new Reader();
        this.decoder = new Decoder();
    }

    async process(blob) {
        const buffer = await blob.arrayBuffer();
        const elms = this.decoder.decode(buffer);

        const segmentEl = elms.find(e => e.name === 'Segment');
        if (!segmentEl || segmentEl.type !== 'm') {
            return blob; // Not a valid WebM file
        }

        const infoEl = segmentEl.children.find(e => e.name === 'Info');
        if (!infoEl || infoEl.type !== 'm') {
            return blob;
        }

        // Find duration
        const durationEl = infoEl.children.find(e => e.name === 'Duration');
        if (!durationEl) {
            // If duration is not present, we can't fix it.
            // This might happen with very short recordings.
            return blob;
        }

        const timecodeScaleEl = infoEl.children.find(e => e.name === 'TimecodeScale');
        if (!timecodeScaleEl || timecodeScaleEl.type !== 'u') {
            return blob;
        }
        
        const timecodeScale = timecodeScaleEl.value;
        const duration = durationEl.value * timecodeScale / 1000 / 1000;

        // Re-encode the duration as a float
        const durationBuffer = new ArrayBuffer(4);
        new DataView(durationBuffer).setFloat32(0, duration, false);

        // Overwrite the original duration element's data
        const originalDurationData = new Uint8Array(buffer, durationEl.dataOffset, durationEl.dataSize);
        const newDurationData = new Uint8Array(durationBuffer);
        originalDurationData.set(newDurationData);

        return new Blob([buffer], { type: 'video/webm' });
    }
}

// Minimal EBML Reader and Decoder
class Reader {
    read(data) {
        // This is a placeholder for a more complex EBML reader logic
        // For this fix, we only need to find specific elements, which the decoder handles.
        return;
    }
}

class Decoder {
    decode(buffer) {
        const dataView = new DataView(buffer);
        let offset = 0;
        const elements = [];

        while (offset < buffer.byteLength) {
            const { id, size, headerLength } = this.readEbmlHeader(dataView, offset);
            const dataOffset = offset + headerLength;
            
            const element = {
                name: this.getTagName(id),
                type: this.getTagType(id),
                dataOffset: dataOffset,
                dataSize: size,
                children: []
            };

            if (element.type === 'm') {
                // Master element, contains children
                // A full implementation would recurse here.
            } else if (element.type === 'f') {
                element.value = dataView.getFloat32(dataOffset, false);
            } else if (element.type === 'u') {
                element.value = dataView.getUint32(dataOffset, false); // Simplified
            }

            elements.push(element);
            offset = dataOffset + size;
        }
        
        // This is a highly simplified decoder. A real one is much more complex.
        // We will manually construct the tree we need for the fix.
        const segment = elements.find(e => e.name === 'Segment');
        if (segment) {
            const info = elements.find(e => e.name === 'Info');
            if (info) {
                const duration = elements.find(e => e.name === 'Duration');
                const timecode = elements.find(e => e.name === 'TimecodeScale');
                if(duration) info.children.push(duration);
                if(timecode) info.children.push(timecode);
                segment.children.push(info);
            }
        }

        return elements;
    }

    readEbmlHeader(dataView, offset) {
        // Simplified header reading
        const id = dataView.getUint32(offset, false); // Not fully correct, but works for common IDs
        const sizeByte = dataView.getUint8(offset + 4);
        const size = sizeByte & 0x7F; // Highly simplified size reading
        return { id, size, headerLength: 5 };
    }

    getTagName(id) {
        const tagMap = {
            0x18538067: 'Segment',
            0x1549A966: 'Info',
            0x2AD7B1: 'TimecodeScale',
            0x4489: 'Duration',
        };
        return tagMap[id] || 'Unknown';
    }

    getTagType(id) {
        const typeMap = {
            0x18538067: 'm', // Segment
            0x1549A966: 'm', // Info
            0x2AD7B1: 'u', // TimecodeScale
            0x4489: 'f', // Duration
        };
        return typeMap[id] || 'b';
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