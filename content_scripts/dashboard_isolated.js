window.addEventListener('message', (event) => {
    // We only accept messages from ourselves
    if (event.source !== window) return;

    if (event.data && event.data.action === 'OPEN_BACKGROUND_TAB') {
        try {
            chrome.runtime.sendMessage({ 
                action: 'BOSS_OPEN_TAB', 
                url: event.data.url 
            });
        } catch (e) {
            console.error('Failed to send message to background script', e);
        }
    }
});
