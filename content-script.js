/**
 * @fileoverview Content script for the video recorder extension.
 *
 * This script is responsible for:
 * - Creating and managing the recording UI.
 * - Capturing video and audio from a <video> element.
 * - Handling user interactions (button clicks and shortcuts).
 * - Processing the recorded video to ensure it's seekable.
 * - Communicating with the background script for downloads.
 */

/**
 * Manages the user interface for the video capture.
 */
class CaptureUI {
    /**
     * @param {function} onStart - Callback for when the start button is clicked.
     * @param {function} onStop - Callback for when the stop button is clicked.
     */
    constructor(onStart, onStop) {
        this.onStart = onStart;
        this.onStop = onStop;

        this.captureUI = null;
        this.startButton = null;
        this.stopButton = null;
        this.timeDisplay = null;
        this.progressBar = null;
        this.startShortcutInfo = null;
        this.stopShortcutInfo = null;

        this._createUI();
    }

    /**
     * Creates and appends the capture UI to the document.
     * @private
     */
    _createUI() {
        this.captureUI = document.createElement('div');
        this.captureUI.style.cssText = `
            position: fixed; top: 20px; right: 20px; background: rgba(0,0,0,0.7);
            color: white; padding: 15px; border-radius: 10px; z-index: 10000;
            display: flex; flex-direction: column; align-items: center; min-width: 200px;
        `;

        this.startButton = this._createButton('🔴 Start Recording', 'green', this.onStart);
        this.stopButton = this._createButton('⏹️ Stop Recording', 'red', this.onStop);
        this.stopButton.style.display = 'none';

        this.timeDisplay = document.createElement('div');
        this.timeDisplay.style.marginBottom = '10px';
        this.timeDisplay.textContent = '00:00';

        this.progressBar = document.createElement('progress');
        this.progressBar.max = 100;
        this.progressBar.value = 0;
        this.progressBar.style.width = '100%';

        const shortcutContainer = this._createShortcutInfo();

        this.captureUI.appendChild(this.startButton);
        this.captureUI.appendChild(this.stopButton);
        this.captureUI.appendChild(this.timeDisplay);
        this.captureUI.appendChild(this.progressBar);
        this.captureUI.appendChild(shortcutContainer);

        document.body.appendChild(this.captureUI);
    }

    /**
     * Helper to create a button element.
     * @private
     */
    _createButton(text, color, onClick) {
        const button = document.createElement('button');
        button.textContent = text;
        button.style.cssText = `
            background-color: ${color}; color: white; border: none;
            padding: 10px 20px; border-radius: 5px; cursor: pointer; margin-bottom: 10px;
        `;
        button.addEventListener('click', onClick);
        return button;
    }

    /**
     * Helper to create the shortcut info display.
     * @private
     */
    _createShortcutInfo() {
        const container = document.createElement('div');
        container.style.cssText = `
            margin-top: 10px; font-size: 0.8em; color: #ccc; text-align: center;
        `;

        this.startShortcutInfo = document.createElement('div');
        this.startShortcutInfo.textContent = 'Start: Alt+Shift+R';

        this.stopShortcutInfo = document.createElement('div');
        this.stopShortcutInfo.textContent = 'Stop: Ctrl+Shift+X';
        this.stopShortcutInfo.style.display = 'none';

        container.appendChild(this.startShortcutInfo);
        container.appendChild(this.stopShortcutInfo);
        return container;
    }

    /**
     * Switches the UI to its "recording" state.
     */
    showRecordingState() {
        this.startButton.style.display = 'none';
        this.stopButton.style.display = 'block';
        this.startShortcutInfo.style.display = 'none';
        this.stopShortcutInfo.style.display = 'block';
    }

    /**
     * Updates the timer display.
     * @param {string} timeString - The formatted time to display.
     */
    updateTimer(timeString) {
        this.timeDisplay.textContent = timeString;
    }

    /**
     * Updates the progress bar value.
     * @param {number} value - The new progress value.
     */
    updateProgress(value) {
        this.progressBar.value = value;
    }

    /**
     * Removes the UI from the DOM.
     */
    destroy() {
        if (this.captureUI && this.captureUI.parentNode) {
            this.captureUI.parentNode.removeChild(this.captureUI);
        }
    }
}


/**
 * Handles the logic for capturing video.
 */
class AdvancedVideoCapture {
    /**
     * @param {CaptureUI} ui - The UI instance to interact with.
     */
    constructor(ui) {
        this.ui = ui;
        this.mediaRecorder = null;
        this.recordingActive = false;
        this.chunks = [];
        this.webmSeeker = new WebMSeeker();
        this.timerInterval = null;
        this.stopShortcutListener = null;
    }

    /**
     * Starts the video capture process.
     */
    async startCapture() {
        if (this.recordingActive) return;

        const videoElement = document.querySelector('video');
        if (!videoElement) {
            alert('No video element found. Please open a video first.');
            return;
        }

        try {
            this.ui.showRecordingState();

            const stream = videoElement.captureStream ? videoElement.captureStream() : videoElement.mozCaptureStream();
            if (stream.getAudioTracks().length === 0) {
                console.warn('No audio track found in the video stream.');
            }

            this.mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
            this.chunks = [];
            this.recordingActive = true;

            this.mediaRecorder.ondataavailable = (e) => e.data.size > 0 && this.chunks.push(e.data);
            this.mediaRecorder.onstop = () => this.saveRecording();
            this.mediaRecorder.start();

            this._startTimer(videoElement);
            this._addStopShortcut();

        } catch (error) {
            chrome.runtime.sendMessage({ type: 'CAPTURE_ERROR', error: error.toString() });
            this.stopRecording();
        }
    }

    /**
     * Stops the video capture and cleans up resources.
     */
    stopRecording() {
        if (this.recordingActive) {
            this.recordingActive = false;
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop(); // Triggers onstop handler
            }
        }

        if (this.timerInterval) clearInterval(this.timerInterval);
        if (this.stopShortcutListener) window.removeEventListener('keydown', this.stopShortcutListener);

        this.ui.destroy();
    }

    /**
     * Starts the timer to update the UI.
     * @private
     */
    _startTimer(videoElement) {
        const startTime = Date.now();
        this.timerInterval = setInterval(() => {
            if (!this.recordingActive) {
                clearInterval(this.timerInterval);
                return;
            }
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
            const seconds = (elapsed % 60).toString().padStart(2, '0');
            this.ui.updateTimer(`${minutes}:${seconds}`);

            if (videoElement && !videoElement.ended) {
                this.ui.updateProgress((elapsed / videoElement.duration) * 100);
            }
        }, 1000);
    }

    /**
     * Adds the keyboard shortcut listener for stopping the recording.
     * @private
     */
    _addStopShortcut() {
        this.stopShortcutListener = (e) => {
            if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'x') {
                e.preventDefault();
                this.stopRecording();
            }
        };
        window.addEventListener('keydown', this.stopShortcutListener);
    }

    /**
     * Processes and saves the final recording.
     */
    async saveRecording() {
        if (this.chunks.length === 0) return;

        const blob = new Blob(this.chunks, { type: 'video/webm' });
        const seekableBlob = await this.webmSeeker.process(blob);
        const url = URL.createObjectURL(seekableBlob);

        chrome.runtime.sendMessage({
            type: 'DOWNLOAD_VIDEO',
            url: url,
            filename: this.sanitizeFilename(document.title) + '.webm'
        });

        this.chunks = [];
    }

    /**
     * Sanitizes a string to be used as a valid filename.
     * @param {string} title - The original string.
     * @returns {string} The sanitized filename.
     */
    sanitizeFilename(title, maxLength = 50) {
        const sanitized = title
            .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
            .trim()
            .substring(0, maxLength)
            .replace(/[\s_]+/g, '_');
        return sanitized || 'video_capture';
    }
}


/**
 * A utility class to process a WebM blob and inject metadata to make it seekable.
 * This is a simplified implementation adapted from ts-ebml. It finds the
 * duration and timecode scale elements in the WebM metadata and re-encodes
 * the duration to ensure media players can seek through the video.
 */
class WebMSeeker {
    constructor() {
        this.decoder = new Decoder();
    }

    async process(blob) {
        const buffer = await blob.arrayBuffer();
        const elms = this.decoder.decode(buffer);

        const segmentEl = elms.find(e => e.name === 'Segment');
        const infoEl = segmentEl ? segmentEl.children.find(e => e.name === 'Info') : null;
        if (!infoEl) return blob;

        const durationEl = infoEl.children.find(e => e.name === 'Duration');
        const timecodeScaleEl = infoEl.children.find(e => e.name === 'TimecodeScale');

        if (durationEl && timecodeScaleEl) {
            const duration = durationEl.value * timecodeScaleEl.value / 1000 / 1000;
            const durationBuffer = new ArrayBuffer(4);
            new DataView(durationBuffer).setFloat32(0, duration, false);
            new Uint8Array(buffer, durationEl.dataOffset, durationEl.dataSize).set(new Uint8Array(durationBuffer));
        }

        return new Blob([buffer], { type: 'video/webm' });
    }
}

/**
 * A minimal EBML decoder for WebM files.
 */
class Decoder {
    decode(buffer) {
        const dataView = new DataView(buffer);
        let offset = 0;
        const elements = [];

        while (offset < buffer.byteLength) {
            const { id, size, headerLength } = this._readEbmlHeader(dataView, offset);
            const dataOffset = offset + headerLength;
            const type = this._getTagType(id);

            const element = {
                name: this._getTagName(id),
                type: type,
                dataOffset: dataOffset,
                dataSize: size,
                children: [],
                value: null
            };

            if (type === 'f') element.value = dataView.getFloat32(dataOffset, false);
            else if (type === 'u') element.value = dataView.getUint32(dataOffset, false);

            elements.push(element);
            offset = dataOffset + size;
        }

        // Manually construct a simplified tree for our purpose
        const segment = elements.find(e => e.name === 'Segment');
        if (segment) {
            const info = elements.find(e => e.name === 'Info');
            if (info) {
                const duration = elements.find(e => e.name === 'Duration');
                const timecode = elements.find(e => e.name === 'TimecodeScale');
                if (duration) info.children.push(duration);
                if (timecode) info.children.push(timecode);
                segment.children.push(info);
            }
        }
        return elements;
    }

    _readEbmlHeader(dataView, offset) {
        // Simplified: assumes 4-byte ID and 1-byte size length
        const id = dataView.getUint32(offset, false);
        const size = dataView.getUint8(offset + 4) & 0x7F;
        return { id, size, headerLength: 5 };
    }

    _getTagName(id) {
        const tagMap = { 0x18538067: 'Segment', 0x1549A966: 'Info', 0x2AD7B1: 'TimecodeScale', 0x4489: 'Duration' };
        return tagMap[id] || 'Unknown';
    }

    _getTagType(id) {
        const typeMap = { 0x18538067: 'm', 0x1549A966: 'm', 0x2AD7B1: 'u', 0x4489: 'f' };
        return typeMap[id] || 'b';
    }
}


/**
 * Main application class to orchestrate the extension's functionality.
 */
class App {
    constructor() {
        this.videoCapture = null;
        this._addListeners();
    }

    /**
     * Adds all necessary event listeners.
     * @private
     */
    _addListeners() {
        chrome.runtime.onMessage.addListener(this._handleMessage.bind(this));
        window.addEventListener('keydown', this._handleStartShortcut.bind(this));
    }

    /**
     * Handles messages from the background script.
     * @private
     */
    _handleMessage(request) {
        if (request.type === 'TOGGLE_CAPTURE_UI') {
            this._toggleCaptureUI();
        }
    }

    /**
     * Handles the shortcut for starting a recording.
     * @private
     */
    _handleStartShortcut(e) {
        if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'r') {
            e.preventDefault();
            if (!this.videoCapture) {
                this._createCapture();
            }
            if (this.videoCapture && !this.videoCapture.recordingActive) {
                this.videoCapture.startCapture();
            }
        }
    }

    /**
     * Toggles the visibility of the capture UI.
     * @private
     */
    _toggleCaptureUI() {
        if (this.videoCapture) {
            this.videoCapture.stopRecording();
            this.videoCapture = null;
        } else {
            this._createCapture();
        }
    }

    /**
     * Creates and initializes a new video capture session.
     * @private
     */
    _createCapture() {
        const ui = new CaptureUI(
            () => this.videoCapture.startCapture(),
            () => {
                this.videoCapture.stopRecording();
                this.videoCapture = null;
            }
        );
        this.videoCapture = new AdvancedVideoCapture(ui);
    }
}

// Initialize the application
new App();