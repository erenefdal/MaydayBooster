// background.js - MaydayBooster Service Worker

// Keep track of active captures (tabId -> boolean)
const activeCaptures = new Map();

// Helper to check and create offscreen document
async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });

  if (contexts.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'To capture and amplify tab audio using Web Audio API'
  });
}

// Handle messages from Popup or Offscreen
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === 'background') {
    handleMessage(message, sender).then(sendResponse);
    return true; // Keep message channel open for async response
  }
});

async function handleMessage(message, sender) {
  const tabId = message.tabId;
  
  if (message.type === 'enable-capture') {
    try {
      await ensureOffscreenDocument();
      
      // Get the media stream ID for the target tab
      // In MV3, we can get stream ID in background worker if triggered by popup message (user gesture)
      return new Promise((resolve) => {
        chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, async (streamId) => {
          if (chrome.runtime.lastError) {
            console.error('tabCapture error:', chrome.runtime.lastError);
            resolve({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          
          if (!streamId) {
            resolve({ success: false, error: 'Could not acquire stream ID.' });
            return;
          }

          // Save active state
          activeCaptures.set(tabId, true);
          await chrome.storage.local.set({ [`tab_${tabId}_active`]: true });
          
          // Send the stream ID to offscreen to start processing audio
          chrome.runtime.sendMessage({
            target: 'offscreen',
            type: 'start-capture',
            streamId: streamId,
            tabId: tabId,
            volume: message.volume || 1.0
          });
          
          resolve({ success: true });
        });
      });
    } catch (err) {
      console.error('Failed to enable capture:', err);
      return { success: false, error: err.message };
    }
  }
  
  else if (message.type === 'disable-capture') {
    activeCaptures.delete(tabId);
    await chrome.storage.local.remove([`tab_${tabId}_active`]);
    
    // Tell offscreen to stop capture
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'stop-capture',
      tabId: tabId
    });
    
    return { success: true };
  }
  
  else if (message.type === 'set-volume') {
    await chrome.storage.local.set({ [`tab_${tabId}_volume`]: message.volume });
    
    // If capture is active, send the volume update to offscreen
    if (activeCaptures.get(tabId)) {
      chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'set-volume',
        tabId: tabId,
        volume: message.volume
      });
    }
    return { success: true };
  }
  
  else if (message.type === 'get-status') {
    const active = activeCaptures.get(tabId) || false;
    const volumeResult = await chrome.storage.local.get([`tab_${tabId}_volume`]);
    const volume = volumeResult[`tab_${tabId}_volume`] !== undefined ? volumeResult[`tab_${tabId}_volume`] : 1.0;
    return { active, volume };
  }
}

// Clean up when a tab is closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (activeCaptures.has(tabId)) {
    activeCaptures.delete(tabId);
    await chrome.storage.local.remove([`tab_${tabId}_active`, `tab_${tabId}_volume`]);
    
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'stop-capture',
      tabId: tabId
    });
  }
});

// Clean up when a tab is reloaded/navigated
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && activeCaptures.has(tabId)) {
    activeCaptures.delete(tabId);
    await chrome.storage.local.remove([`tab_${tabId}_active`]);
    
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'stop-capture',
      tabId: tabId
    });
  }
});
