chrome.action.onClicked.addListener((tab) => {
    // Send message to content script to start capture UI
    chrome.tabs.sendMessage(tab.id, { type: 'START_CAPTURE_UI' });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'DOWNLOAD_VIDEO') {
        // The URL is a data URL from the content script.
        chrome.downloads.download({
            url: request.url,
            filename: request.filename,
            saveAs: false
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