// popup.js - MaydayBooster Simple Controller

document.addEventListener('DOMContentLoaded', async () => {
  // --- UI Elements ---
  const statusBadge = document.getElementById('statusBadge');
  const statusText = statusBadge.querySelector('.status-text');
  const volValue = document.getElementById('volValue');
  const volumeSlider = document.getElementById('volumeSlider');
  const sensValue = document.getElementById('sensValue');
  const sensitivitySlider = document.getElementById('sensitivitySlider');
  const powerBtn = document.getElementById('powerBtn');

  let activeTabId = null;
  let isSystemActive = false;
  let currentDb = 0; // Current decibel boost (0 to maxDb)
  let currentSensitivity = 9; // Default sensitivity = 9
  let maxDb = 90; // Recalculated as sensitivity * 10

  // --- 1. Initialize State ---
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Load stored sensitivity preference (default is 9)
    chrome.storage.local.get(['sensitivity'], (result) => {
      const savedSens = result.sensitivity !== undefined ? result.sensitivity : 9;
      updateSensitivity(savedSens);
      
      // Load tab active status and volume
      if (tabs && tabs[0]) {
        activeTabId = tabs[0].id;
        initStatus();
      }
    });
  } catch (err) {
    console.error("Error initializing tabs:", err);
  }

  async function initStatus() {
    if (!activeTabId) return;

    chrome.runtime.sendMessage({
      target: 'background',
      type: 'get-status',
      tabId: activeTabId
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn("Could not reach background worker, using default values.");
        updateUI(false, 0);
        return;
      }

      if (response) {
        // Convert gain multiplier back to decibels: db = 20 * log10(gain)
        const gain = response.volume || 1.0;
        let db = Math.max(0, Math.round(20 * Math.log10(gain)));
        
        // Clamp within our maxDb
        if (db > maxDb) db = maxDb;
        
        updateUI(response.active, db);
      }
    });
  }

  // --- 2. UI Update & Calculation Helpers ---

  // Convert Decibels to Gain Multiplier (logarithmic audio scale)
  function dbToGain(db) {
    if (db <= 0) return 1.0;
    return Math.pow(10, db / 20);
  }

  // Update Sensitivity and adjust slider limits
  function updateSensitivity(sensitivity) {
    currentSensitivity = Math.max(1, Math.min(77, sensitivity));
    sensitivitySlider.value = currentSensitivity;
    sensValue.textContent = currentSensitivity;
    
    // Recalculate maxDb: Sensitivity * 10 dB
    maxDb = currentSensitivity * 10;
    
    // Update Volume Slider limit
    volumeSlider.max = maxDb;

    // Clamp current volume if it exceeds the new maxDb limit
    if (currentDb > maxDb) {
      currentDb = maxDb;
      propagateVolume(currentDb);
    }

    // Refresh UI
    updateUI(isSystemActive, currentDb);
  }

  // Sync the UI values
  function updateUI(active, db) {
    isSystemActive = active;
    currentDb = db;

    // A. Power Button & Status Badge
    if (isSystemActive) {
      powerBtn.classList.add('active');
      powerBtn.textContent = "SİSTEMİ DEVRE DIŞI BIRAK";
      statusBadge.classList.add('active');
      statusText.textContent = "ACTIVE";
    } else {
      powerBtn.classList.remove('active');
      powerBtn.textContent = "SİSTEMİ AKTİF ET";
      statusBadge.classList.remove('active');
      statusText.textContent = "BYPASS";
    }

    // B. Slider Position
    volumeSlider.value = currentDb;

    // C. Text Display
    volValue.textContent = `+${currentDb} dB`;
  }

  // Send volume update to background worker
  function propagateVolume(db) {
    if (!activeTabId) return;
    const gain = dbToGain(db);
    chrome.runtime.sendMessage({
      target: 'background',
      type: 'set-volume',
      tabId: activeTabId,
      volume: gain
    });
  }

  // --- 3. Event Listeners ---

  // Volume Slider drag
  volumeSlider.addEventListener('input', (e) => {
    const db = parseInt(e.target.value);
    volValue.textContent = `+${db} dB`;
    currentDb = db;
    propagateVolume(db);
  });

  // Sensitivity Slider drag
  sensitivitySlider.addEventListener('input', (e) => {
    const sens = parseInt(e.target.value);
    chrome.storage.local.set({ sensitivity: sens }, () => {
      updateSensitivity(sens);
    });
  });

  // Power Button toggle
  powerBtn.addEventListener('click', () => {
    if (!activeTabId) return;

    if (isSystemActive) {
      // Disable capture
      chrome.runtime.sendMessage({
        target: 'background',
        type: 'disable-capture',
        tabId: activeTabId
      }, (response) => {
        if (response && response.success) {
          updateUI(false, currentDb);
        }
      });
    } else {
      // Enable capture
      const gain = dbToGain(currentDb);
      chrome.runtime.sendMessage({
        target: 'background',
        type: 'enable-capture',
        tabId: activeTabId,
        volume: gain
      }, (response) => {
        if (response && response.success) {
          updateUI(true, currentDb);
        } else {
          alert(response?.error || "Bu sekme yakalanamıyor. Sayfayı yenileyip tekrar deneyin.");
        }
      });
    }
  });

  // GitHub Link click
  const githubLink = document.getElementById('githubLink');
  githubLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://github.com/erenefdal/MaydayBooster' });
  });
});
