// offscreen.js - MaydayBooster Audio Processor

// Map of tabId -> session object
const sessions = new Map();

// Listen for messages from background service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === 'offscreen') {
    handleMessage(message).then(sendResponse);
    return true; // Keep message channel open for async response
  }
});

async function handleMessage(message) {
  const tabId = message.tabId;
  
  if (message.type === 'start-capture') {
    await startCapture(tabId, message.streamId, message.volume);
    return { success: true };
  } 
  
  else if (message.type === 'stop-capture') {
    stopCapture(tabId);
    return { success: true };
  } 
  
  else if (message.type === 'set-volume') {
    setVolume(tabId, message.volume);
    return { success: true };
  }
}

async function startCapture(tabId, streamId, volume) {
  // If there is an active session for this tab, stop it first
  if (sessions.has(tabId)) {
    stopCapture(tabId);
  }

  try {
    // Acquire the media stream of the tab using the stream ID
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });

    // Create the Web Audio API context
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const audioContext = new AudioContextClass();
    
    // Create nodes
    const source = audioContext.createMediaStreamSource(stream);
    
    // Gain Node for flat volume amplification (amplifies all frequencies equally)
    const gainNode = audioContext.createGain();
    gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
    
    // Connect the pure flat audio graph: source -> gainNode -> destination
    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    // Resume audio context to ensure it runs immediately
    await audioContext.resume();

    // Store session details
    sessions.set(tabId, {
      stream,
      audioContext,
      source,
      gainNode
    });

    console.log(`[MaydayBooster] Capture started for tab ${tabId} with flat gain multiplier ${volume}`);
  } catch (err) {
    console.error(`[MaydayBooster] Failed to capture tab ${tabId}:`, err);
  }
}

function stopCapture(tabId) {
  const session = sessions.get(tabId);
  if (!session) return;

  try {
    // Stop all audio tracks to release the browser recording indicator
    session.stream.getTracks().forEach(track => track.stop());
    
    // Disconnect Web Audio nodes
    session.source.disconnect();
    session.gainNode.disconnect();
    
    // Close the AudioContext to free up audio hardware resources
    session.audioContext.close();
  } catch (err) {
    console.error(`[MaydayBooster] Error stopping capture for tab ${tabId}:`, err);
  }

  sessions.delete(tabId);
  console.log(`[MaydayBooster] Capture stopped and cleaned up for tab ${tabId}`);
}

function setVolume(tabId, volume) {
  const session = sessions.get(tabId);
  if (session && session.gainNode && session.audioContext) {
    const audioContext = session.audioContext;
    const gainNode = session.gainNode;
    
    // Smoothly transition the volume level over 50ms to prevent clicks
    const now = audioContext.currentTime;
    gainNode.gain.setValueAtTime(gainNode.gain.value, now);
    gainNode.gain.linearRampToValueAtTime(volume, now + 0.05);
    
    console.log(`[MaydayBooster] Flat gain multiplier for tab ${tabId} adjusted to ${volume}`);
  }
}
