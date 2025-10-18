chrome.action.onClicked.addListener((tab) => {
    // Send message to content script to start capture UI
    chrome.tabs.sendMessage(tab.id, { type: 'START_CAPTURE_UI' });
});

// A map to store object URLs that need to be revoked
const objectUrls = new Map();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'DOWNLOAD_VIDEO') {
        // The URL is an object URL. We need to download it and then revoke it.
        chrome.downloads.download({
            url: request.url,
            filename: request.filename,
            // saveAs: true // Always prompt user for save location
        }, (downloadId) => {
            // Store the URL to revoke it later, associated with its download ID
            if (downloadId) {
                objectUrls.set(downloadId, request.url);
            } else {
                // If the download failed to start, revoke the URL immediately
                console.error('Download failed to start. Revoking object URL.');
                URL.revokeObjectURL(request.url);
            }
        });
    }

    if (request.type === 'CAPTURE_ERROR') {
        // Optional: Show error notification
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icon128.png',
            title: 'Video Capture Error',
            message: request.error
        });
    }
});

// Listener to clean up object URLs after download is complete, failed, or interrupted
chrome.downloads.onChanged.addListener((delta) => {
    if (delta.state && objectUrls.has(delta.id)) {
        if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
            const url = objectUrls.get(delta.id);
            URL.revokeObjectURL(url);
            objectUrls.delete(delta.id);
        }
    }
});