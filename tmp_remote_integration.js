// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
// GLOBAL STUDIO INSTANCE & INITIALIZATION
// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ

let studioInstance = null;
let beatProgressInterval = null;
let micLevelInterval = null;
let recordingTimerInterval = null;
let lastStudioRecording = null;
let recordingPlaybackAudio = null;
let playbackMode = 'mix';

function getEl(id) {
  return document.getElementById(id);
}

// Fallback formatTime in case studio engine (which normally defines it) isn't loaded yet.
if (typeof formatTime !== 'function') {
  function formatTime(seconds) {
    const s = Math.floor(Number(seconds) || 0);
    const minutes = Math.floor(s / 60);
    const secs = s % 60;
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  window.formatTime = formatTime;
}

// Action queue: if studio not ready, queue actions and initialize studio once
window._studioActionQueue = window._studioActionQueue || [];
window._studioQueueInitializing = window._studioQueueInitializing || false;
function runOrQueue(action) {
  if (studioInstance) {
    try { return action(); } catch (e) { console.warn('[DIAG] runOrQueue action error', e); }
  } else {
    window._studioActionQueue.push(action);
    if (!window._studioQueueInitializing) {
      window._studioQueueInitializing = true;
      initializeStudioUI().then(() => {
        try {
          window._studioActionQueue.forEach(a=>{ try{ a(); }catch(e){ console.warn('[DIAG] queued action failed', e); } });
        } finally {
          window._studioActionQueue = [];
          window._studioQueueInitializing = false;
        }
      }).catch(err => {
        console.error('Queued studio init failed', err);
        window._studioQueueInitializing = false;
      });
    }
  }
}

function safeText(id, value) {
  const el = getEl(id);
  if (el) el.textContent = value;
}

function safeHTML(id, value) {
  const el = getEl(id);
  if (el) el.innerHTML = value;
}

function safeStyle(id, prop, value) {
  const el = getEl(id);
  if (el && el.style) el.style[prop] = value;
}

function safeClassAdd(id, classname) {
  const el = getEl(id);
  if (el) el.classList.add(classname);
}

function safeClassRemove(id, classname) {
  const el = getEl(id);
  if (el) el.classList.remove(classname);
}

function safeToggleClass(id, classname) {
  const el = getEl(id);
  if (el) el.classList.toggle(classname);
}

function resolveStudioEngineURL() {
  const existing = Array.from(document.querySelectorAll('script[src*="studio-pro-engine.js"]')).find(s => !!s.src);
  if (existing) {
    return existing.src;
  }
  try {
    return new URL('studio-pro-engine.js', window.location.href).href;
  } catch (e) {
    return 'studio-pro-engine.js';
  }
}

function getGlobalInitStudio() {
  if (typeof initStudio === 'function') return initStudio;
  if (typeof globalThis !== 'undefined' && typeof globalThis.initStudio === 'function') return globalThis.initStudio;
  if (typeof window !== 'undefined' && typeof window.initStudio === 'function') return window.initStudio;
  return undefined;
}

async function loadStudioEngineScript() {
  if (typeof getGlobalInitStudio() === 'function') return true;
  const src = resolveStudioEngineURL();
  if (!src) return false;

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src + (src.includes('?') ? '&' : '?') + 'cachebust=' + Date.now();
    script.async = false;
    script.onload = () => {
      if (typeof getGlobalInitStudio() === 'function') {
        resolve(true);
      } else {
        reject(new Error('Engine loaded but initStudio still undefined'));
      }
    };
    script.onerror = () => reject(new Error('Failed to load engine script at ' + src));
    document.head.appendChild(script);
  });
}

let freestyleWaveformFrame = null;
let freestyleWaveformCanvas = null;
let freestyleWaveformCtx = null;
let freestyleWaveformData = null;

function setupFreestyleUI() {
  freestyleWaveformCanvas = getEl('waveformCanvas');
  if (!freestyleWaveformCanvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = freestyleWaveformCanvas.getBoundingClientRect();
  const width = Math.max(240, rect.width || 320);
  const height = Math.max(64, rect.height || 80);
  freestyleWaveformCanvas.width = width * dpr;
  freestyleWaveformCanvas.height = height * dpr;
  freestyleWaveformCtx = freestyleWaveformCanvas.getContext('2d');
  if (freestyleWaveformCtx) {
    freestyleWaveformCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  freestyleWaveformData = new Uint8Array(256);
}

function resizeFreestyleCanvas() {
  if (!freestyleWaveformCanvas || !freestyleWaveformCtx) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = freestyleWaveformCanvas.getBoundingClientRect();
  const width = Math.max(240, rect.width || 320);
  const height = Math.max(64, rect.height || 80);
  if (freestyleWaveformCanvas.width !== width * dpr || freestyleWaveformCanvas.height !== height * dpr) {
    freestyleWaveformCanvas.width = width * dpr;
    freestyleWaveformCanvas.height = height * dpr;
    freestyleWaveformCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function drawFreestyleWaveform() {
  if (!freestyleWaveformCanvas || !freestyleWaveformCtx || !mobileLevelAnalyser) {
    return;
  }
  resizeFreestyleCanvas();
  const width = freestyleWaveformCanvas.clientWidth || 320;
  const height = freestyleWaveformCanvas.clientHeight || 80;

  try {
    if (typeof mobileLevelAnalyser.getByteTimeDomainData === 'function') {
      mobileLevelAnalyser.getByteTimeDomainData(freestyleWaveformData);
    } else {
      mobileLevelAnalyser.getByteFrequencyData(freestyleWaveformData);
    }
  } catch (e) {
    console.warn('Waveform draw failed', e);
    return;
  }

  const ctx = freestyleWaveformCtx;
  ctx.clearRect(0, 0, width, height);

  const bgGradient = ctx.createLinearGradient(0, 0, width, height);
  bgGradient.addColorStop(0, 'rgba(0, 229, 255, 0.12)');
  bgGradient.addColorStop(0.5, 'rgba(255, 68, 68, 0.18)');
  bgGradient.addColorStop(1, 'rgba(0, 255, 136, 0.1)');
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, width, height);

  const peak = freestyleWaveformData.reduce((sum, value) => sum + Math.abs(value - 128), 0) / freestyleWaveformData.length;
  const energy = Math.min(1, peak / 48);
  const waveColor = `rgba(255,255,255,${0.9 - energy * 0.25})`;

  ctx.lineWidth = 2;
  ctx.strokeStyle = waveColor;
  ctx.beginPath();
  const sliceWidth = width / freestyleWaveformData.length;
  for (let i = 0; i < freestyleWaveformData.length; i++) {
    const x = i * sliceWidth;
    const v = (freestyleWaveformData[i] - 128) / 128;
    const y = height / 2 + v * (height / 2 - 10);
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  const glowScale = 1 + energy * 0.16;
  const glowOpacity = 0.35 + energy * 0.45;
  const ringScale = 1 + energy * 0.18;
  const ringAlpha = 0.5 + energy * 0.4;

  const glowEl = getEl('micGlowBg');
  if (glowEl) {
    glowEl.style.transform = `scale(${glowScale})`;
    glowEl.style.opacity = `${glowOpacity}`;
  }
  const ringEl = getEl('micPulseRing');
  if (ringEl) {
    ringEl.style.transform = `scale(${ringScale})`;
    ringEl.style.borderColor = `rgba(255,68,68,${ringAlpha})`;
  }

  freestyleWaveformFrame = requestAnimationFrame(drawFreestyleWaveform);
}

function startFreestyleVisuals() {
  if (!freestyleWaveformCanvas) {
    setupFreestyleUI();
  }
  if (freestyleWaveformFrame) {
    cancelAnimationFrame(freestyleWaveformFrame);
  }
  drawFreestyleWaveform();
  safeStyle('recordStopBtn', 'display', 'inline-flex');
  safeStyle('recordRestartBtn', 'display', 'inline-flex');
  safeClassAdd('micGlowBg', 'active');
  safeClassAdd('micPulseRing', 'active');
  safeClassAdd('recordStartBtn', 'recording');
}

function stopFreestyleVisuals() {
  if (freestyleWaveformFrame) {
    cancelAnimationFrame(freestyleWaveformFrame);
    freestyleWaveformFrame = null;
  }
  if (freestyleWaveformCtx && freestyleWaveformCanvas) {
    freestyleWaveformCtx.clearRect(0, 0, freestyleWaveformCanvas.clientWidth || 320, freestyleWaveformCanvas.clientHeight || 80);
    freestyleWaveformCtx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    freestyleWaveformCtx.fillRect(0, 0, freestyleWaveformCanvas.clientWidth || 320, freestyleWaveformCanvas.clientHeight || 80);
    freestyleWaveformCtx.strokeStyle = 'rgba(255,255,255,0.12)';
    freestyleWaveformCtx.lineWidth = 1;
    freestyleWaveformCtx.beginPath();
    const mid = (freestyleWaveformCanvas.clientHeight || 80) / 2;
    freestyleWaveformCtx.moveTo(0, mid);
    freestyleWaveformCtx.lineTo(freestyleWaveformCanvas.clientWidth || 320, mid);
    freestyleWaveformCtx.stroke();
  }
  safeStyle('micGlowBg', 'transform', 'scale(1)');
  safeStyle('micGlowBg', 'opacity', '0.35');
  safeStyle('micPulseRing', 'transform', 'scale(1)');
  safeStyle('micPulseRing', 'borderColor', 'rgba(255,68,68,0.5)');
  safeClassRemove('micGlowBg', 'active');
  safeClassRemove('micPulseRing', 'active');
  safeClassRemove('recordStartBtn', 'recording');
  safeStyle('recordStopBtn', 'display', 'none');
}

function showMicPermissionError(message) {
  safeText('micPermissionMsg', message || 'Permission d\'acc├¿s au microphone refus├®e. V├®rifie les param├¿tres du navigateur.');
  safeStyle('micPermissionError', 'display', 'block');
}

function hideMicPermissionError() {
  safeStyle('micPermissionError', 'display', 'none');
}

window.requestMicPermission = async function requestMicPermission() {
  const granted = await probeMicrophonePermission();
  if (granted) {
    hideMicPermissionError();
    safeText('recordStatus', typeof t === 'function' ? t('fs_mic_ready') : 'Micro pr├¬t');
    safeText('micStatusText', typeof t === 'function' ? t('fs_mic_ready') : 'Micro pr├¬t');
  }
};

// Helper function to check studio readiness
function ensureStudio(callback) {
  if (!studioInstance) {
    console.warn('Studio not ready yet');
    showToast(typeof t === 'function' ? t('studio_loading') : 'Studio is loading...');
    return false;
  }
  return callback();
}

function resolveBeatURL(source) {
  if (!source) return '';
  let path = String(source).trim();
  if (!/^https?:\/\//i.test(path) && /\.mpeg$/i.test(path)) {
    path = path.replace(/\.mpeg$/i, '.mp3');
  }
  try {
    return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)
      ? path
      : new URL(path, window.location.href).href;
  } catch (error) {
    return path;
  }
}

function getLocalBeatFallback(beatData) {
  const localBeats = (typeof beats !== 'undefined' && Array.isArray(beats) && beats.length)
    ? beats
    : (window.beats || []);
  if (!Array.isArray(localBeats) || !localBeats.length) return null;

  const match = localBeats.find(b =>
    String(b.id) === String(beatData.id) ||
    (b.title && beatData.title && b.title.toLowerCase() === beatData.title.toLowerCase()) ||
    (b.name && beatData.name && b.name.toLowerCase() === beatData.name.toLowerCase())
  );

  return match || null;
}

async function initializeStudioUI() {
  try {
    // If the engine script hasn't attached `initStudio` yet, wait briefly for it.
    if (typeof getGlobalInitStudio() !== 'function') {
      console.warn('initStudio not yet available; waiting briefly for engine to load');
      await new Promise(resolve => {
        const start = Date.now();
        const iv = setInterval(() => {
          if (typeof getGlobalInitStudio() === 'function') { clearInterval(iv); resolve(); }
          if (Date.now() - start > 2000) { clearInterval(iv); resolve(); }
        }, 100);
      });
    }

    if (typeof getGlobalInitStudio() !== 'function') {
      console.warn('initStudio still not available ÔÇö attempting engine script reload');
      try {
        await loadStudioEngineScript();
      } catch (reloadError) {
        console.warn('Engine reload failed:', reloadError);
      }
    }

    if (typeof getGlobalInitStudio() !== 'function') {
      console.warn('initStudio still not available ÔÇö deferring initialization until user gesture');
      try { activateAudioOnGesture(); } catch (e) { console.warn('activateAudioOnGesture failed', e); }
      return;
    }

    // Initialize audio engine
    const engineInitFn = getGlobalInitStudio();
    studioInstance = await engineInitFn();
    window.studioInstance = studioInstance;

    console.log('Ô£à Studio UI initialized');

    // Setup UI callbacks
    setupUICallbacks();
    studioInstance.onRecordingReady(handleRecordingReady);

    // If a freestyle beat was selected before the studio was ready, load it now.
    if (window.pendingStudioBeat) {
      await loadStudioSelectedBeat(window.pendingStudioBeat);
    }

    // Load beats from Firebase
    loadBeatsFromFirebase();

  } catch (error) {
    console.warn('ÔÜá Studio initialization encountered an issue (will retry on gesture):', error);
    // Don't show a blocking error toast at page load ÔÇö audio init can fail due to
    // browser autoplay/user-gesture policies. Defer a retry to the first user gesture.
    try { activateAudioOnGesture(); } catch (e) { console.warn('activateAudioOnGesture failed', e); }
  }
}

function setupUICallbacks() {
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value;
  };

  const safeEl = (id) => document.getElementById(id);
  const safeDuration = () => {
    if (!studioInstance || !studioInstance.beatPlayer || typeof studioInstance.beatPlayer.getDuration !== 'function') {
      return '0:00';
    }
    return formatTime(studioInstance.beatPlayer.getDuration());
  };

  studioInstance.registerUICallback('beatLoaded', (beatData) => {
    if (!beatData) return;

    const safeUpdate = (id, value) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = value;
    };

    safeUpdate('beatName', beatData.name || 'Untitled');
    safeUpdate('beatBPM', beatData.bpm || '120');
    safeUpdate('beatKey', beatData.key || 'C');
    safeUpdate('beatGenre', beatData.genre || 'Hip-Hop');
    safeUpdate('beatDuration', safeDuration());

    const fsMeta = `${beatData.bpm || '120'} BPM ┬À ${beatData.genre || 'Hip-Hop'}`;
    safeUpdate('fsBeatName', beatData.name || 'Untitled');
    safeUpdate('fsBeatMeta', fsMeta);
    safeUpdate('fsBeatDuration', safeDuration());

    const playBtn = safeEl('beatPlayBtn') || safeEl('fsBeatPlayBtn') || safeEl('recordStartBtn');
    if (playBtn) playBtn.classList.add('active');
  });

  studioInstance.registerUICallback('beatPlaying', () => {
    safeClassAdd('beatPlayBtn', 'active');
    clearInterval(beatProgressInterval);
    beatProgressInterval = setInterval(updateBeatProgressUI, 100);
  });

  studioInstance.registerUICallback('beatPaused', () => {
    safeClassRemove('beatPlayBtn', 'active');
    clearInterval(beatProgressInterval);
  });

  studioInstance.registerUICallback('beatStopped', () => {
    safeClassRemove('beatPlayBtn', 'active');
    safeStyle('beatProgressFill', 'width', '0%');
    safeText('beatCurrentTime', '0:00');
    clearInterval(beatProgressInterval);
  });

  studioInstance.registerUICallback('recordingStarted', () => {
    const recordBtn = getEl('recordBtn') || getEl('recordStartBtn');
    if (recordBtn) recordBtn.classList.add('recording');
    safeText('recordStatus', typeof t === 'function' ? t('dyn_recording_status') : 'Recording in progress...');
    safeStyle('recordTimer', 'display', 'block');
    
    clearInterval(recordingTimerInterval);
    recordingTimerInterval = setInterval(updateRecordingTimerUI, 50);
    
    clearInterval(micLevelInterval);
    micLevelInterval = setInterval(updateMicLevelUI, 50);
  });

  studioInstance.registerUICallback('recordingStopped', () => {
    const recordBtn = getEl('recordBtn') || getEl('recordStartBtn');
    if (recordBtn) recordBtn.classList.remove('recording');
    safeText('recordStatus', typeof t === 'function' ? t('dyn_recording_processing') : 'Traitement de l\'enregistrement...');
    clearInterval(recordingTimerInterval);
    clearInterval(micLevelInterval);
    safeStyle('micLevelBar', 'width', '0%');
  });
}

async function loadBeatsFromFirebase() {
  try {
    const selector = document.getElementById('beatSelector');
    if (!selector) return;

    selector.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--studio-secondary); font-family: var(--font-mono); font-size: 0.7rem;">ÔÅ│ ${t('studio_beats_loading')}</div>`;

    let beatsList = [];
    try {
      const snapshot = await db.collection('beats').limit(8).get();
      if (!snapshot.empty) {
        beatsList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      }
    } catch (error) {
      console.warn('Firestore unavailable, falling back to local beats', error);
    }

    if (!beatsList.length && typeof beats !== 'undefined' && Array.isArray(beats) && beats.length) {
      beatsList = beats.map(b => ({ ...b }));
    }

    selector.innerHTML = '';

    if (!beatsList.length) {
      selector.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-dim); font-family: var(--font-mono);">${t('studio_no_beats')}</div>`;
      return;
    }

    beatsList.forEach(beat => {
      const beatBtn = document.createElement('button');
      beatBtn.className = 'control-btn';
      beatBtn.innerHTML = `
        <div style="font-size: 1.8rem; margin-bottom: 6px;">­ƒÄÁ</div>
        <div style="font-size: 0.65rem; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${beat.title || beat.name || 'Untitled'}</div>
        <div style="font-size: 0.55rem; color: rgba(0,217,255,0.6); margin-top: 2px;">${beat.bpm || '120'} BPM</div>
      `;
      beatBtn.onclick = () => selectBeat(beat.id, beat);
      selector.appendChild(beatBtn);
    });

  } catch (error) {
    console.error('Error loading beats:', error);
  }
}

async function selectBeat(beatId, beatData) {
  const beatInfo = {
    name: beatData.title || beatData.name || 'Untitled',
    bpm: beatData.bpm || 120,
    key: beatData.key || 'C',
    genre: beatData.genre || 'Hip-Hop'
  };

  let beatUrl = '';
  let loaded = false;

  const resolveUrl = (typeof resolveBeatPlaybackURL === 'function')
    ? resolveBeatPlaybackURL
    : resolveBeatURL;

  // Prefer explicit audio path from beat metadata
  const beatSource = beatData.audioFile || beatData.audio || beatData.audioUrl || beatData.url || beatData.fileUrl || beatData.source || '';
  if (beatSource) {
    const directUrl = resolveUrl(beatSource);
    const proxyUrl = (typeof resolveFsBeatProxyURL === 'function')
      ? resolveFsBeatProxyURL(beatSource)
      : directUrl;
    try {
      beatUrl = directUrl;
      await studioInstance.loadBeatFromURL(directUrl, beatInfo);
      loaded = true;
    } catch (error) {
      console.warn('Direct beat load failed, trying proxy:', error);
      if (proxyUrl && proxyUrl !== directUrl) {
        try {
          beatUrl = proxyUrl;
          await studioInstance.loadBeatFromURL(proxyUrl, beatInfo);
          loaded = true;
        } catch (proxyErr) {
          console.warn('Proxy beat load failed:', proxyErr);
        }
      }
    }
  }

  if (!loaded) {
    const fallbackBeat = getLocalBeatFallback(beatData);
    const fallbackSource = fallbackBeat && (fallbackBeat.audio || fallbackBeat.audioUrl || fallbackBeat.url || fallbackBeat.fileUrl || fallbackBeat.source);
    if (fallbackSource) {
      try {
        beatUrl = resolveBeatURL(fallbackSource);
        await studioInstance.loadBeatFromURL(beatUrl, beatInfo);
        loaded = true;
      } catch (error) {
        console.warn('Local default beat fallback failed:', error);
      }
    }
  }

  if (!loaded && firebase && firebase.storage) {
    try {
      const beatFile = beatData.audioFile || beatData.audio || beatData.audioUrl || `${beatId}.mp3`;
      const storageUrl = await firebase.storage().ref(`beats/${beatFile}`).getDownloadURL();
      beatUrl = storageUrl;
      await studioInstance.loadBeatFromURL(beatUrl, beatInfo);
      loaded = true;
    } catch (error) {
      console.warn('Firebase storage load failed:', error);
    }
  }

  if (!loaded) {
    const fallbackBeat = getLocalBeatFallback(beatData);
    const fallbackSource = fallbackBeat && (fallbackBeat.audio || fallbackBeat.audioUrl || fallbackBeat.url || fallbackBeat.fileUrl || fallbackBeat.source);
    if (fallbackSource) {
      try {
        beatUrl = resolveBeatURL(fallbackSource);
        await studioInstance.loadBeatFromURL(beatUrl, beatInfo);
        loaded = true;
      } catch (error) {
        console.warn('Local fallback after storage failed:', error);
      }
    }
  }

  if (!loaded) {
    showToast(typeof t === 'function' ? t('studio_beat_not_found') : 'ÔØî Beat not found. Check your connection or choose another beat.');
    return;
  }

  showToast(typeof t === 'function' ? t('studio_beat_selected', beatInfo.name) : `Ô£à Beat selected: ${beatInfo.name}`);
}

// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
// BEAT PLAYER CONTROLS
// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ

function studioBeatPlay() {
  studioInstance.playBeat();
}

function studioBeatPause() {
  studioInstance.pauseBeat();
}

function studioBeatStop() {
  studioInstance.stopBeat();
}

function seekBeat(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const percentage = x / rect.width;
  const duration = studioInstance.beatPlayer.getDuration();
  studioInstance.seekBeat(duration * percentage);
  updateBeatProgressUI();
}

function updateBeatProgressUI() {
  const progress = studioInstance.getBeatProgress();
  safeStyle('beatProgressFill', 'width', progress.percentage + '%');
  safeText('beatCurrentTime', formatTime(progress.current));
}

// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
// RECORDING CONTROLS
// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ

function getMixerVolumes() {
  const beatSlider = getEl('beatVolSlider');
  const vocalSlider = getEl('vocalVolSlider');
  return {
    beat: beatSlider ? parseFloat(beatSlider.value) : 70,
    vocal: vocalSlider ? parseFloat(vocalSlider.value) : 80
  };
}

function applyMixerToStudio() {
  if (!studioInstance) return;
  const vols = getMixerVolumes();
  studioInstance.setBeatVolume(vols.beat);
  studioInstance.setVocalMonitorVolume(vols.vocal);
  if (studioInstance.isMixPlaying()) {
    studioInstance.updateMixVolumes(vols.beat, vols.vocal);
  }
}

let mobileRecorder = null;
let mobileStream = null;
let mobileChunks = [];
let mobileRecordingActive = false;
let mobileRecordingStart = 0;
let mobileLevelCtx = null;
let mobileLevelAnalyser = null;
// Fallback recorder (WebAudio -> WAV) when MediaRecorder is not available
let fallbackBuffers = [];
let fallbackAudioCtx = null;
let fallbackProcessor = null;
let fallbackSource = null;

function cleanupMobileMic() {
  stopFreestyleVisuals();
  clearInterval(micLevelInterval);
  micLevelInterval = null;
  safeStyle('micLevelBar', 'width', '0%');
  if (mobileLevelCtx && mobileLevelCtx.state !== 'closed') {
    mobileLevelCtx.close().catch(() => {});
  }
  mobileLevelCtx = null;
  mobileLevelAnalyser = null;
  // cleanup fallback recorder resources
  try {
    if (fallbackProcessor) {
      fallbackProcessor.disconnect();
      fallbackProcessor.onaudioprocess = null;
      fallbackProcessor = null;
    }
    if (fallbackSource) {
      try { fallbackSource.disconnect(); } catch (e) {}
      fallbackSource = null;
    }
    if (fallbackAudioCtx && fallbackAudioCtx.state !== 'closed') {
      fallbackAudioCtx.close().catch(() => {});
    }
  } catch (e) { console.warn('cleanup fallback:', e); }
  fallbackAudioCtx = null;
  fallbackBuffers = [];
  if (mobileStream) {
    mobileStream.getTracks().forEach((track) => track.stop());
    mobileStream = null;
  }
}

function startMicLevelMonitor(stream) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    mobileLevelCtx = new AudioCtx();
    const src = mobileLevelCtx.createMediaStreamSource(stream);
    mobileLevelAnalyser = mobileLevelCtx.createAnalyser();
    mobileLevelAnalyser.fftSize = 256;
    src.connect(mobileLevelAnalyser);
    clearInterval(micLevelInterval);
    micLevelInterval = setInterval(() => {
      if (!mobileLevelAnalyser) return;
      const data = new Uint8Array(mobileLevelAnalyser.frequencyBinCount);
      mobileLevelAnalyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      safeStyle('micLevelBar', 'width', Math.min(100, avg * 1.8) + '%');
    }, 100);
  } catch (e) {
    console.warn('Mic level monitor:', e);
  }
}

async function startSimpleVocalRecording() {
  if (mobileRecordingActive) {
    showToast(typeof t === 'function' ? t('dyn_recording_status') : 'Enregistrement d├®j├á en cours');
    return;
  }

  // Prefer an explicit polyfill if provided, otherwise fall back to
  // the standard navigator.mediaDevices.getUserMedia API when available.
  if (!window.getUserMediaPolyfill && !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
    showToast('ÔÜá Micro non support├® sur ce navigateur');
    return;
  }

  try {
    cleanupMobileMic();
    const getMic = window.getUserMediaPolyfill
      ? (constraints) => window.getUserMediaPolyfill(constraints)
      : (constraints) => navigator.mediaDevices.getUserMedia(constraints);

    const constraints = (typeof window.getMicConstraints === 'function') ? window.getMicConstraints() : { audio: true };
    console.log('Requesting microphone with constraints:', constraints);
    try {
      mobileStream = await getMic(constraints);
    } catch (primaryError) {
      console.warn('getUserMedia failed with primary constraints:', primaryError, constraints);
      const isRetryable = /OverconstrainedError|NotReadableError|TypeError|InvalidStateError|NotFoundError/i.test(primaryError.name || primaryError.message || '');
      if (isRetryable && JSON.stringify(constraints) !== JSON.stringify({ audio: true })) {
        const fallbackConstraints = { audio: true };
        try {
          console.log('Retrying getUserMedia with simpler constraints:', fallbackConstraints);
          mobileStream = await getMic(fallbackConstraints);
        } catch (fallbackError) {
          console.error('Fallback getUserMedia failed:', fallbackError);
          throw fallbackError;
        }
      } else {
        throw primaryError;
      }
    }
    mobileChunks = [];
    startMicLevelMonitor(mobileStream);

    // Ensure MediaRecorder is available
    const useFallbackRecorder = (typeof MediaRecorder === 'undefined');
    if (useFallbackRecorder) {
      showToast('Ôä╣ Enregistreur natif non disponible ÔåÆ utilisation d\'un fallback');
    }

    // Determine a supported mimeType for MediaRecorder. Fall back to common
    // types if helper is not present.
    let mimeType = undefined;
    if (typeof window.getSupportedRecorderMimeType === 'function') {
      mimeType = window.getSupportedRecorderMimeType();
    }
    const fallbackTypes = ['audio/webm', 'audio/ogg', 'audio/wav', 'audio/mp4'];
    if (!mimeType) {
      for (const t of fallbackTypes) {
        if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) {
          mimeType = t;
          break;
        }
      }
    }

    // Detect if mobile for optimized recording
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
      || (navigator.maxTouchPoints > 1 && /MacIntel/.test(navigator.platform));
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent)
      || (navigator.maxTouchPoints > 1 && /MacIntel/.test(navigator.platform));

    try {
      if (!useFallbackRecorder) {
        const options = mimeType ? { mimeType } : {};
        // Use lower bitrate for mobile to prevent playback speed issues
        options.audioBitsPerSecond = isMobile ? 128000 : 192000;
        mobileRecorder = new MediaRecorder(mobileStream, options);
        console.log('Ô£à MediaRecorder created with mimeType:', mimeType || 'default', 'bitrate:', options.audioBitsPerSecond);
      }
    } catch (e) {
      console.warn('MediaRecorder ctor failed, switching to fallback', e);
      mobileRecorder = null;
    }

    // On iOS Safari, MediaRecorder often produces webm which isn't playable.
    // Prefer the WebAudio fallback which encodes WAV for maximum compatibility.
    if (isIOS) {
      if (mobileRecorder) {
        console.log('iOS detected ÔÇö preferring WebAudio fallback over MediaRecorder for compatibility');
      }
      mobileRecorder = null;
    }

    if (mobileRecorder) {
      mobileRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          mobileChunks.push(e.data);
          console.log('­ƒôª Audio chunk received:', e.data.size, 'bytes, total chunks:', mobileChunks.length);
        }
      };
      mobileRecorder.onstop = () => {
        console.log('ÔÅ╣´©Å MediaRecorder stopped, total chunks:', mobileChunks.length);
        finishSimpleVocalRecording();
      };
      mobileRecorder.onerror = (ev) => {
        console.error('MediaRecorder error:', ev);
        showToast(typeof t === 'function' ? t('dyn_recording_failed') : 'ÔÜá Enregistrement impossible');
        cleanupMobileMic();
      };
      let recorderStarted = false;
      mobileRecorder.onstart = () => {
        recorderStarted = true;
        console.log('ÔûÂ´©Å MediaRecorder started successfully');
      };
    }

    // Fallback: start WebAudio-based recorder if MediaRecorder isn't present
    async function startFallbackRecorder(stream) {
      try {
        fallbackBuffers = [];
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) throw new Error('No AudioContext');
        fallbackAudioCtx = new AudioCtx();
        
        // Resume audio context if suspended (required for mobile)
        if (fallbackAudioCtx.state === 'suspended') {
          await fallbackAudioCtx.resume();
        }
        
        // Use 44100 Hz for better mobile compatibility
        const targetSampleRate = 44100;
        fallbackAudioCtx.sampleRate = targetSampleRate;
        
        fallbackSource = fallbackAudioCtx.createMediaStreamSource(stream);
        
        // Use ScriptProcessor for broader compatibility (deprecated but works everywhere)
        const bufferSize = 4096;
        fallbackProcessor = fallbackAudioCtx.createScriptProcessor(bufferSize, 1, 1);
        
        fallbackProcessor.onaudioprocess = (evt) => {
          try {
            const inputData = evt.inputBuffer.getChannelData(0);
            // Copy the data to prevent reference issues
            fallbackBuffers.push(new Float32Array(inputData));
          } catch (e) {
            console.warn('Fallback processor error:', e);
          }
        };
        
        // Connect the audio graph
        fallbackSource.connect(fallbackProcessor);
        // Connect to destination to ensure audio flows through (required for some browsers)
        fallbackProcessor.connect(fallbackAudioCtx.destination);
        
        console.log('Ô£à Fallback recorder started with sampleRate:', targetSampleRate, 'Hz, bufferSize:', bufferSize);
      } catch (err) {
        console.error('startFallbackRecorder error:', err);
        throw err;
      }
    }

    const beat = window.fsSelectedBeat || window.pendingStudioBeat;
    const beatSource = beat && (beat.audio || beat.audioUrl || beat.url || beat.fileUrl || beat.source);
    if (typeof fsAudio !== 'undefined' && beat && beatSource) {
      const resolveUrl = (typeof resolveFsBeatURL === 'function')
        ? resolveFsBeatURL
        : (typeof resolveBeatPlaybackURL === 'function')
          ? resolveBeatPlaybackURL
          : (src) => (src.startsWith('http') ? src : new URL(src, window.location.href).href);
      const beatUrl = resolveUrl(beatSource);
      const sameBeatLoaded = fsAudio.src && (typeof audioSrcMatches === 'function' ? audioSrcMatches(fsAudio, beatUrl) : fsAudio.src === beatUrl);
      const preservedFsAudioVolume = (typeof fsAudio.volume === 'number' && fsAudio.volume > 0) ? fsAudio.volume : 1.0;
      if (!sameBeatLoaded) {
        if (typeof clearFsAudioCrossOrigin === 'function') clearFsAudioCrossOrigin();
        fsAudio.src = beatUrl;
        fsAudio.load();
      }
      fsAudio.loop = true;
      fsAudio.muted = false;
      fsAudio.volume = preservedFsAudioVolume;
      if (!sameBeatLoaded) {
        fsAudio.currentTime = 0;
      } else if (fsAudio.paused && fsAudio.duration && fsAudio.currentTime >= fsAudio.duration) {
        fsAudio.currentTime = 0;
      }
      try {
        if (!sameBeatLoaded || fsAudio.paused) {
          if (typeof ensureFsBeatPlayback === 'function') {
            await ensureFsBeatPlayback();
          } else {
            await fsAudio.play();
          }
        }
        fsPlaying = true;
        const playBtn = document.getElementById('fsBeatPlayBtn');
        if (playBtn) playBtn.innerHTML = `<i class='fas fa-pause'></i> ${t('dyn_pause_beat')}`;
      } catch (e) {
        console.warn('Beat play:', e);
      }
    }

    if (mobileRecorder) {
      // Start fallback recorder in parallel as backup for both mobile and desktop
      try {
        await startFallbackRecorder(mobileStream);
        console.log('Ô£à Fallback recorder started in parallel');
      } catch (fbErr) {
        console.warn('Fallback recorder (parallel) startup issue:', fbErr);
      }

      try {
        // Use larger timeslice to prevent audio fragmentation
        if (isIOS) {
          mobileRecorder.start();
        } else if (isMobile) {
          mobileRecorder.start(1000); // 1000ms for mobile (increased)
        } else {
          mobileRecorder.start(1000); // 1000ms for desktop (increased)
        }
        console.log('Ô£à MediaRecorder started with timeslice:', isIOS ? 'none (iOS)' : '1000ms (unified)');
      } catch (startErr) {
        console.error('MediaRecorder start failed:', startErr);
        try { mobileRecorder.start(); } catch (e) { console.error('MediaRecorder fallback start failed:', e); }
      }

      // If the recorder hasn't entered 'recording' state within 1s, treat as failure
      setTimeout(() => {
        if (mobileRecorder && mobileRecorder.state !== 'recording') {
          console.warn('MediaRecorder did not start recording, state=', mobileRecorder.state);
          showToast(typeof t === 'function' ? t('dyn_recording_failed') : 'ÔÜá Impossible de d├®marrer l\'enregistrement');
          try { if (mobileRecorder && mobileRecorder.state === 'inactive') mobileRecorder.stop(); } catch (e) {}
          cleanupMobileMic();
        }
      }, 1000);
    } else {
      // Start fallback recorder
      try {
        await startFallbackRecorder(mobileStream);
      } catch (fbErr) {
        console.error('Fallback recorder failed to start:', fbErr);
        showToast(typeof t === 'function' ? t('dyn_recording_failed') : 'ÔÜá Impossible d\'activer le micro');
        cleanupMobileMic();
        return;
      }
    }

    mobileRecordingActive = true;
    mobileRecordingStart = Date.now();
    hideMicPermissionError();
    startFreestyleVisuals();

    const recordBtn = getEl('recordStartBtn');
    if (recordBtn) recordBtn.classList.add('recording');
    safeText('recordStatus', typeof t === 'function' ? t('dyn_recording_status') : 'Enregistrement en cours...');
    safeStyle('recordTimer', 'display', 'block');
    safeStyle('recordingResultSection', 'display', 'none');
    safeClassAdd('monitoringBadge', 'active');

    clearInterval(recordingTimerInterval);
    recordingTimerInterval = setInterval(() => {
      safeText('recordTimer', formatTime((Date.now() - mobileRecordingStart) / 1000));
    }, 200);

    showToast(typeof t === 'function' ? t('studio_recording_started') : '­ƒö┤ Enregistrement d├®marr├®');
  } catch (error) {
    console.error('Vocal recording failed:', error);
    cleanupMobileMic();
    const errName = (error && (error.name || error.code)) ? (error.name || error.code) : 'Error';
    const errMsg = (error && error.message) ? error.message : String(error);
    const isDenied = /NotAllowedError|PermissionDeniedError|PermissionDismissedError|SecurityError/i.test(errName || errMsg);
    const isNotFound = /NotFoundError|DevicesNotFoundError/i.test(errName || errMsg);
    const isNotReadable = /NotReadableError|TrackStartError/i.test(errName || errMsg);
    let msg;

    if (isDenied) {
      msg = typeof t === 'function' ? t('studio_mic_denied') : 'Micro refus├® ÔÇö autorise l\'acc├¿s dans les r├®glages';
      showMicPermissionError(msg);
    } else if (isNotFound) {
      msg = typeof t === 'function' ? t('studio_mic_not_found') : 'Aucun micro d├®tect├®';
    } else if (isNotReadable) {
      msg = typeof t === 'function' ? t('studio_mic_error') : 'Micro occup├® ou non disponible';
    } else {
      msg = typeof t === 'function' ? t('studio_mic_error') : 'Impossible d\'acc├®der au microphone';
    }

    const detail = `${errName}${errMsg ? `: ${errMsg}` : ''}`;
    const helpHtml = `ÔÜá ${msg}<br><br>
      <button class="btn-ghost" id="probeMicBtn" onclick="probeMicrophonePermission()">V├®rifier autorisations micro</button>
      <div style="margin-top:8px;font-size:0.85rem;color:var(--text-dim)">Permission: ${isDenied ? 'refus├®e' : 'inconnue'} ┬À D├®tail: ${detail}</div>`;

    if (isDenied || errName === 'SecurityError' || errName === 'AbortError') {
      showToast(helpHtml);
    } else {
      showToast(`ÔÜá ${msg}<br><small>${detail}</small>`);
    }
    safeText('recordStatus', `${msg} (${detail})`);
  }
}

// Try to request microphone access directly to prompt the browser/OS permission dialog
window.probeMicrophonePermission = async function probeMicrophonePermission() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showToast('ÔØî API getUserMedia non disponible dans ce navigateur');
      return false;
    }

    // Query permission state if supported
    let permState = 'unknown';
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const p = await navigator.permissions.query({ name: 'microphone' });
        permState = p.state || permState;
      }
    } catch (e) {
      // permissions API may be unavailable in some browsers (iOS Safari)
      permState = 'unavailable';
    }

    // Enumerate devices (labels visible only if permission already granted)
    let devices = [];
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const devs = await navigator.mediaDevices.enumerateDevices();
        devices = devs.filter(d => d.kind === 'audioinput').map(d => ({ id: d.deviceId, label: d.label || '(label hidden)' }));
      }
    } catch (e) {
      console.warn('enumerateDevices failed', e);
    }

    showToast('ÔÅ│ V├®rification autorisations...');

    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const tracks = stream.getAudioTracks();
      const active = tracks.length > 0 && tracks.some(t => t.readyState === 'live');
      // stop immediately
      tracks.forEach(t => t.stop());

      const detail = `Permission=${permState}; inputs=${devices.length}; active=${active}`;
      showToast('Ô£à Micro accessible ÔÇö ' + detail);
      safeText('recordStatus', 'Micro accessible');
      return true;
    } catch (e) {
      console.error('probeMicrophonePermission:', e);
      const errName = e && e.name ? e.name : 'Error';
      const errMsg = e && e.message ? e.message : String(e);
      const detail = `Permission=${permState}; inputs=${devices.length}; error=${errName}`;
      if (errName === 'NotAllowedError') {
        showToast('ÔÜá Autorisation refus├®e ÔÇö active le micro dans les r├®glages du navigateur');
      } else if (errName === 'NotFoundError') {
        showToast('ÔÜá Aucun micro d├®tect├®');
      } else {
        showToast('ÔÜá Impossible d\'acc├®der au micro: ' + errMsg);
      }
      safeText('recordStatus', detail + ' ÔÇö ' + errMsg);
      return false;
    } finally {
      try { if (stream) stream.getTracks().forEach(t => t.stop()); } catch (e) {}
    }
  } catch (e) {
    console.error('probeMicrophonePermission fatal:', e);
    showToast('ÔØî Erreur interne lors de la v├®rification du micro');
    return false;
  }
}

function finishSimpleVocalRecording() {
  mobileRecordingActive = false;
  clearInterval(recordingTimerInterval);

  // Priority: use fallback if it has data, otherwise use MediaRecorder
  let blob = null;
  let usedFallback = false;
  let recordingDuration = mobileRecordingStart ? Math.max(0.1, (Date.now() - mobileRecordingStart) / 1000) : 0.1;

  console.log('­ƒöì Processing recording - MediaRecorder chunks:', mobileChunks.length, 'Fallback buffers:', fallbackBuffers?.length || 0);

  // Try fallback first if it captured data (works on both mobile and desktop)
  if (fallbackBuffers && fallbackBuffers.length > 0) {
    try {
      const sampleRate = (fallbackAudioCtx && fallbackAudioCtx.sampleRate) ? fallbackAudioCtx.sampleRate : 44100;
      const interleavedFull = flattenFloat32Array(fallbackBuffers);
      recordingDuration = interleavedFull.length / sampleRate;

      console.log('­ƒôè Fallback full WAV encode - samples:', interleavedFull.length, 'sampleRate:', sampleRate, 'buffers:', fallbackBuffers.length);
      const wavBlobFull = encodeWAV(interleavedFull, sampleRate);
      if (wavBlobFull && wavBlobFull.size > 100) {
        blob = wavBlobFull;
        usedFallback = true;
        console.log('Ô£à Using full fallback WAV for immediate playback:', wavBlobFull.size, 'bytes');
      } else {
        console.warn('ÔÜá´©Å Full fallback WAV too small:', wavBlobFull?.size || 0, 'bytes');
      }
    } catch (e) {
      console.error('ÔØî finishSimpleVocalRecording fallback encode failed:', e);
    }
  }

  // If fallback didn't produce data, try MediaRecorder blob
  if (!blob || blob.size === 0) {
    if (mobileChunks && mobileChunks.length > 0) {
      const mime = mobileRecorder?.mimeType || (typeof window.getSupportedRecorderMimeType === 'function' ? window.getSupportedRecorderMimeType() : 'audio/webm');
      blob = new Blob(mobileChunks, { type: mime });
      if (blob && blob.size > 100) {
        console.log('Ô£à Using MediaRecorder blob:', blob.size, 'bytes, mime:', mime, 'chunks:', mobileChunks.length);
      } else {
        console.warn('ÔÜá´©Å MediaRecorder blob too small:', blob?.size || 0, 'bytes');
      }
    } else {
      console.warn('ÔÜá´©Å No MediaRecorder chunks available');
    }
  }

  cleanupMobileMic();
  stopFreestyleVisuals();

  if (!blob || blob.size <= 100) {
    console.error('ÔØî Recording produced no valid data. MediaRecorder chunks:', mobileChunks.length, 'Fallback buffers:', fallbackBuffers?.length || 0, 'Final blob size:', blob?.size || 0);
    safeText('recordStatus', typeof t === 'function' ? t('dyn_recording_failed') : 'Impossible de capturer l\'audio. V├®rifie les permissions.');
    showToast('ÔÜá Enregistrement vide ÔÇö v├®rifie que le micro fonctionne et r├®essaie');
    const recordBtn = getEl('recordStartBtn');
    if (recordBtn) recordBtn.classList.remove('recording');
    safeClassRemove('monitoringBadge', 'active');
    return;
  }

  const url = URL.createObjectURL(blob);
  if (typeof fsAudio !== 'undefined') {
    fsAudio.pause();
    fsAudio.currentTime = 0;
  }

  const beat = window.fsSelectedBeat || window.pendingStudioBeat;
  handleRecordingReady({
    blob,
    url,
    playbackUrl: url,
    wavUrl: usedFallback ? url : null,
    duration: Math.max(0.1, (Date.now() - mobileRecordingStart) / 1000),
    mimeType: usedFallback ? 'audio/wav' : (mobileRecorder?.mimeType || 'audio/webm'),
    hasBeat: !!(beat && beat.audio)
  });

  // Update UI immediately to show recording is done and available for playback
  const recordBtn = getEl('recordStartBtn');
  if (recordBtn) recordBtn.classList.remove('recording');
  safeClassRemove('monitoringBadge', 'active');
  safeText('recordStatus', typeof t === 'function' ? t('dyn_recording_done') : 'Enregistrement termin├®');
}

function flattenFloat32Array(buffers) {
  const length = buffers.reduce((acc, b) => acc + b.length, 0);
  const result = new Float32Array(length);
  let offset = 0;
  for (const b of buffers) {
    result.set(b, offset);
    offset += b.length;
  }
  return result;
}

function encodeWAV(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  let offset = 0;
  writeString(view, offset, 'RIFF'); offset += 4;
  view.setUint32(offset, 36 + samples.length * 2, true); offset += 4;
  writeString(view, offset, 'WAVE'); offset += 4;
  writeString(view, offset, 'fmt '); offset += 4;
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, sampleRate * 2, true); offset += 4;
  view.setUint16(offset, 2, true); offset += 2;
  view.setUint16(offset, 16, true); offset += 2;
  writeString(view, offset, 'data'); offset += 4;
  view.setUint32(offset, samples.length * 2, true); offset += 4;

  // PCM 16-bit
  let index = 44;
  for (let i = 0; i < samples.length; i++, index += 2) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(index, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([view], { type: 'audio/wav' });
}

function stopSimpleVocalRecording() {
  if (!mobileRecordingActive && !(mobileRecorder && mobileRecorder.state === 'recording')) {
    return;
  }
  mobileRecordingActive = false;
  clearInterval(recordingTimerInterval);
  if (mobileRecorder && mobileRecorder.state === 'recording') {
    try { mobileRecorder.requestData(); } catch (e) {}
    mobileRecorder.stop();
  } else {
    // If we used the fallback (WebAudio) recorder, stop processor and finish
    if (fallbackProcessor) {
      try { fallbackProcessor.disconnect(); fallbackProcessor.onaudioprocess = null; } catch (e) {}
      try { if (fallbackSource) fallbackSource.disconnect(); } catch (e) {}
      try { if (fallbackAudioCtx && fallbackAudioCtx.state === 'running') fallbackAudioCtx.suspend(); } catch (e) {}
      // finish will create WAV from buffers and cleanup
      finishSimpleVocalRecording();
      return;
    }
    cleanupMobileMic();
  }
}

async function startRecordingFlow() {
  if (mobileRecordingActive) {
    showToast(typeof t === 'function' ? t('dyn_recording_status') : 'Enregistrement d├®j├á en cours');
    return;
  }

  if (studioInstance?.vocalRecorder?.isRecording) {
    stopRecordingFlow();
    return;
  }

  return startSimpleVocalRecording();
}

function stopRecordingFlow() {
  if (mobileRecordingActive || (mobileRecorder && mobileRecorder.state === 'recording')) {
    stopSimpleVocalRecording();
    const recordBtn = getEl('recordBtn') || getEl('recordStartBtn');
    if (recordBtn) recordBtn.classList.remove('recording');
    safeClassRemove('monitoringBadge', 'active');
    safeText('recordStatus', typeof t === 'function' ? t('dyn_recording_processing') : 'Traitement de l\'enregistrement...');
    return;
  }

  if (!studioInstance) return;

  if (!studioInstance.vocalRecorder.isRecording) {
    showToast(typeof t === 'function' ? t('dyn_no_active_recording') : 'Aucun enregistrement en cours');
    return;
  }

  studioInstance.stopRecording();
  studioInstance.stopBeat();
  studioInstance.vocalRecorder.setMonitoring(false);
  safeClassRemove('monitoringBadge', 'active');

  const recordBtn = getEl('recordBtn') || getEl('recordStartBtn');
  if (recordBtn) recordBtn.classList.remove('recording');
  safeText('recordStatus', typeof t === 'function' ? t('dyn_recording_processing') : 'Traitement de l\'enregistrement...');

  clearInterval(recordingTimerInterval);
  clearInterval(micLevelInterval);
  safeStyle('micLevelBar', 'width', '0%');
  updateRecordingTimerUI();
}

function restartRecordingFlow() {
  if (mobileRecordingActive || (mobileRecorder && mobileRecorder.state === 'recording')) {
    stopSimpleVocalRecording();
    discardLastRecording(true);
    setTimeout(() => startSimpleVocalRecording(), 400);
    return;
  }

  if (!studioInstance) return;

  discardLastRecording(true);
  studioInstance.stopStudioMix();
  studioInstance.stopRecording();
  studioInstance.vocalRecorder.reset();
  studioInstance.stopBeat();

  safeText('recordTimer', '0:00');
  safeStyle('recordTimer', 'display', 'none');
  safeText('recordStatus', typeof t === 'function' ? t('dyn_recording_prepare') : 'Pr├¬t pour un nouvel enregistrement');

  setTimeout(() => {
    startRecordingFlow();
  }, 300);
}

function handleRecordingReady(data) {
  if (!data || (!data.playbackUrl && !data.url)) {
    safeText('recordStatus', typeof t === 'function' ? t('dyn_recording_failed') : '├ëchec de l\'enregistrement');
    showToast(typeof t === 'function' ? t('dyn_recording_failed') : 'ÔØî ├ëchec de l\'enregistrement');
    return;
  }

  const beat = window.fsSelectedBeat || window.pendingStudioBeat;
  const hasBeat = !!(beat && beat.audio) || (studioInstance && studioInstance.hasBeatForMix());

  // Use original blob URL for playback on mobile to prevent audio corruption
  // On desktop, prefer WAV if available for better compatibility
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /MacIntel/.test(navigator.platform));
  const playbackUrl = isMobile ? (data.url || data.playbackUrl) : (data.playbackUrl || data.wavUrl || data.url);

  // If we already have a recent recording with the same short URL, update it instead
  let updatedExisting = false;
  if (typeof fsRecordings !== 'undefined' && Array.isArray(fsRecordings) && fsRecordings.length) {
    const existing = fsRecordings[0];
    const existingUrl = existing && (existing.url || existing.playbackUrl || existing.wavUrl);
    const incomingUrl = data.url || data.playbackUrl || data.wavUrl;
    if (existingUrl && incomingUrl && existingUrl === incomingUrl) {
      // Update fields on the existing recording in-place
      existing.wavUrl = data.wavUrl || existing.wavUrl;
      existing.playbackUrl = playbackUrl || existing.playbackUrl;
      existing.blob = data.blob || existing.blob;
      existing.wavBlob = data.wavBlob || existing.wavBlob;
      existing.mimeType = data.mimeType || existing.mimeType || 'audio/webm';
      existing.duration = data.duration || existing.duration || studioInstance.getRecordingDuration() / 1000;
      existing.hasBeat = hasBeat;
      existing.beatOffset = (studioInstance && typeof studioInstance.getAlignmentOffset === 'function') ? studioInstance.getAlignmentOffset() : existing.beatOffset || 0;
      updatedExisting = true;
      lastStudioRecording = existing;
    }
  }

  if (!updatedExisting) {
    lastStudioRecording = {
      id: Date.now(),
      url: data.url,
      wavUrl: data.wavUrl,
      playbackUrl,
      blob: data.blob,
      wavBlob: data.wavBlob,
      mimeType: data.mimeType || 'audio/webm',
      duration: data.duration || studioInstance.getRecordingDuration() / 1000,
      beatTitle: beat ? (beat.title || beat.name || 'ÔÇö') : t('fs_vocal_solo'),
      date: new Date().toLocaleDateString(currentLang === 'en' ? 'en-GB' : 'fr-FR'),
      label: t('fs_take_label') + ' ' + ((typeof fsRecordings !== 'undefined' && fsRecordings.length) ? fsRecordings.length + 1 : 1),
      hasBeat,
      beatOffset: (studioInstance && typeof studioInstance.getAlignmentOffset === 'function') ? studioInstance.getAlignmentOffset() : 0,
      mixWavUrl: null,
      mixWavBlob: null
    };

    if (typeof fsRecordings !== 'undefined') {
      fsRecordings.unshift(lastStudioRecording);
      try {
        localStorage.setItem('jsb_recordings', JSON.stringify(
          fsRecordings.map(r => ({ ...r, blob: undefined, mixWavBlob: undefined }))
        ));
      } catch (e) {
        console.warn('localStorage save failed:', e);
      }
    }
  }

  displayRecordingResult(lastStudioRecording);
  safeText('recordStatus', t('dyn_recording_done'));
  safeStyle('recordTimer', 'display', 'none');
  showToast(hasBeat ? t('fs_mix_ready') : t('dyn_recording_saved'));

  // Do not auto-generate the full studio mix here (it can be long).
  // The UI exposes a "Mix Studio" button users can press to render the mix on demand.
}

async function generateStudioMix(recording) {
  if (!studioInstance || !recording) return;

  try {
    if (recording.blob && !studioInstance.vocalRecorder.getRecordedBuffer()) {
      try {
        const decoded = await studioInstance.vocalRecorder.decodeAudioData(recording.blob);
        studioInstance.vocalRecorder.recordedAudioBuffer = decoded;
      } catch (decodeErr) {
        console.warn('Mix decode vocal:', decodeErr);
      }
    }

    const beat = window.fsSelectedBeat || window.pendingStudioBeat;
    if (!studioInstance.beatPlayer.audioBuffer && beat && beat.audio) {
      try {
        const beatInfo = {
          name: beat.title || beat.name || 'Untitled',
          bpm: beat.bpm || 120,
          key: beat.key || 'C',
          genre: beat.genre || 'Hip-Hop'
        };
        await studioInstance.loadBeatFromURL(beat.audio, beatInfo);
      } catch (beatErr) {
        console.warn('Mix beat load:', beatErr);
      }
    }

    const vols = getMixerVolumes();
    const mixBlob = await studioInstance.renderStudioMix(vols.beat, vols.vocal);
    if (!mixBlob) return;

    if (recording.mixWavUrl) URL.revokeObjectURL(recording.mixWavUrl);
    recording.mixWavBlob = mixBlob;
    recording.mixWavUrl = URL.createObjectURL(mixBlob);
    recording.playbackUrl = recording.mixWavUrl;

    if (lastStudioRecording && lastStudioRecording.id === recording.id) {
      lastStudioRecording = recording;
      try { window.lastStudioRecording = lastStudioRecording; } catch (e) {}
      if (playbackMode === 'mix') {
        updatePlaybackAudioSource(recording);
      }
    }
    console.log('Ô£à Studio mix rendered');
  } catch (error) {
    console.warn('Studio mix render failed:', error);
  }
}

function setPlaybackMode(mode) {
  playbackMode = mode;
  const mixBtn = getEl('playModeMix');
  const vocalBtn = getEl('playModeVocal');
  if (mixBtn) mixBtn.classList.toggle('active', mode === 'mix');
  if (vocalBtn) vocalBtn.classList.toggle('active', mode === 'vocal');

  if (studioInstance) studioInstance.stopStudioMix();
  const audioEl = getEl('recordingPlayback');
  if (audioEl) audioEl.pause();

  if (lastStudioRecording) {
    updatePlaybackAudioSource(lastStudioRecording);
  }

  const hint = getEl('recordingPlaybackHint');
  if (hint) {
    const key = mode === 'mix' ? 'fs_mix_playback_hint' : 'fs_vocal_playback_hint';
    const icon = mode === 'mix' ? 'fa-headphones' : 'fa-microphone';
    hint.innerHTML = `<i class="fas ${icon}"></i> <span data-i18n="${key}">${t(key)}</span>`;
  }
}

// Affiche un diagnostic visible pour les erreurs de playback (utile sur mobile)
function setPlaybackError(err) {
  try {
    const hint = getEl('recordingPlaybackHint');
    if (hint) {
      const msg = err && err.message ? err.message : String(err || 'Unknown error');
      hint.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:#ff6b6b;margin-right:8px"></i><span style="color:#ffb3b3">Erreur lecture : </span><span style="color:#fff;margin-left:6px">${escapeHtml(msg)}</span>`;
      hint.style.display = '';
    }
    console.warn('Playback diagnostic:', err);
  } catch (e) {
    console.warn('setPlaybackError failed:', e);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]+/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]); });
}

function updatePlaybackAudioSource(recording) {
  const audioEl = getEl('recordingPlayback');
  if (!audioEl || !recording) return;

  let src = recording.playbackUrl || recording.wavUrl || recording.url;
  if (playbackMode === 'mix' && recording.mixWavUrl) {
    src = recording.mixWavUrl;
  } else if (playbackMode === 'vocal') {
    src = recording.wavUrl || recording.url;
  }

  audioEl.pause();
  audioEl.currentTime = 0;

  const oldSrc = audioEl.src || '';
  const recordingUrls = [recording.mixWavUrl, recording.wavUrl, recording.playbackUrl, recording.url].filter(Boolean);
  const isStillReferenced = recordingUrls.some((url) => url === oldSrc);

  // Only revoke a blob URL if it is no longer referenced by the current recording.
  if (oldSrc.startsWith('blob:') && oldSrc !== src && !isStillReferenced) {
    try {
      URL.revokeObjectURL(oldSrc);
    } catch (e) {
      console.warn('Failed to revoke old blob URL:', e);
    }
  }

  if (audioEl.src !== src) {
    audioEl.src = src;
    audioEl.load();
  }

  // Configure audio element for better playback performance
  audioEl.preload = 'auto';
  audioEl.crossOrigin = 'anonymous';

  // Ensure audio is ready before allowing playback
  audioEl.oncanplay = () => {
    console.log('Ô£à Audio ready for playback');
  };

  audioEl.onerror = (e) => {
    console.error('ÔØî Audio playback error:', e);
  };
}

function displayRecordingResult(recording) {
  const section = getEl('recordingResultSection');
  const list = getEl('recordingResultList');
  const audioEl = getEl('recordingPlayback');
  if (!section || !recording) return;

  const durationLabel = formatTime(recording.duration || 0);
  const formatLabel = playbackMode === 'mix' && recording.mixWavUrl
    ? t('fs_format_mix')
    : (recording.wavUrl ? t('fs_format_wav') : (recording.mimeType || 'audio').split('/').pop().toUpperCase());

  if (list) {
    list.innerHTML = `
      <div class="recording-result-card">
        <div class="recording-result-icon"><i class="fas ${recording.hasBeat ? 'fa-headphones' : 'fa-microphone'}"></i></div>
        <div class="recording-result-info">
          <div class="recording-result-title">${recording.label || t('fs_recording_label')}</div>
          <div class="recording-result-meta">${recording.beatTitle} ┬À ${recording.date} ┬À ${durationLabel} ┬À ${formatLabel}</div>
        </div>
      </div>`;
  }

  const mixTabs = getEl('playbackModeTabs');
  if (mixTabs) {
    mixTabs.style.display = recording.hasBeat ? 'flex' : 'none';
    if (recording.hasBeat) setPlaybackMode('mix');
  }


  // Ensure the recording result section is visible to the user
  try {
    section.style.display = '';
  } catch (e) {}
  if (audioEl) {
    audioEl.onerror = () => {
      if (playbackMode === 'mix' && recording.wavUrl && audioEl.src !== recording.wavUrl) {
        audioEl.src = recording.wavUrl;
        audioEl.load();
        return;
      }
      const mediaErr = audioEl.error ? new Error('MediaError code ' + (audioEl.error.code || 0)) : new Error('Media playback error');
      showToast(typeof t === 'function' ? t('dyn_playback_failed') : 'ÔÜá Impossible de lire l\'enregistrement');
      setPlaybackError(mediaErr);
    };

    audioEl.onloadedmetadata = () => {
      console.log('Ô£à Recording ready to play:', audioEl.duration, 's');
    };

    updatePlaybackAudioSource(recording);
    recordingPlaybackAudio = audioEl;
  }

  section.style.display = 'block';
  section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  // Ensure any dynamic text inside the recording result is translated
  if (typeof applyTranslations === 'function') try { applyTranslations(); } catch(e) {}
}

function getCurrentRecordingSource(recording) {
  if (!recording) return '';
  if (playbackMode === 'mix' && recording.mixWavUrl) return recording.mixWavUrl;
  if (playbackMode === 'vocal') return recording.wavUrl || recording.url || '';
  return recording.playbackUrl || recording.wavUrl || recording.url || '';
}

async function playLastRecording() {
  if (!lastStudioRecording) {
    showToast(typeof t === 'function' ? t('dyn_no_recording') : 'Aucun enregistrement disponible');
    return;
  }

  if (window.stopFsBeat) {
    window.stopFsBeat();
  }

  const audioEl = getEl('recordingPlayback');
  const currentSrc = getCurrentRecordingSource(lastStudioRecording);
  if (audioEl && !audioEl.paused && audioEl.currentSrc === currentSrc) {
    stopRecordingPlayback();
    return;
  }

  if (studioInstance && studioInstance.isMixPlaying()) {
    studioInstance.stopStudioMix();
    const btn = getEl('playRecordingBtn');
    if (btn) btn.innerHTML = `<i class="fas fa-play"></i> <span data-i18n="${playbackMode === 'mix' ? 'fs_listen_mix' : 'fs_listen_recording'}">${typeof t === 'function' ? (playbackMode === 'mix' ? t('fs_listen_mix') : t('fs_listen_recording')) : (playbackMode === 'mix' ? '├ëcouter le mix' : '├ëcouter l\'enregistrement')}</span>`;
    return;
  }

  // Mix studio en temps r├®el via Web Audio (beat + voix sync)
  if (playbackMode === 'mix' && lastStudioRecording.hasBeat && studioInstance) {
    const vols = getMixerVolumes();
    // Prefer native playback when a playback URL is available (forces native audio), else use WebAudio mix
    try {
      const nativeSrc = getCurrentRecordingSource(lastStudioRecording);
      if (nativeSrc && audioEl) {
        // Assign and play native audio element ÔÇö keeps WebAudio mix available but forces native playback
        if (audioEl.src !== nativeSrc) {
          audioEl.src = nativeSrc;
          try { audioEl.load(); } catch (e) {}
        }
        // Let the code below handle playing the audio element
      } else {
        // No native URL available ÔÇö fall back to WebAudio mix
        if (audioEl) audioEl.pause();
        try {
          const mixResult = studioInstance.playStudioMix(vols.beat, vols.vocal);
          if (mixResult && typeof mixResult.then === 'function') {
            mixResult.then((ok) => {
              if (ok) {
                const btn = getEl('playRecordingBtn');
                if (btn) btn.innerHTML = `<i class="fas fa-stop"></i> <span>${typeof t === 'function' ? t('dyn_stop') : 'Arr├¬ter'}</span>`;
              }
            }).catch((err) => {
              console.warn('playStudioMix promise failed:', err);
            });
            return;
          } else if (mixResult) {
            const btn = getEl('playRecordingBtn');
            if (btn) btn.innerHTML = `<i class="fas fa-stop"></i> <span>${typeof t === 'function' ? t('dyn_stop') : 'Arr├¬ter'}</span>`;
            return;
          }
        } catch (e) {
          console.warn('playStudioMix start failed (non-blocking):', e);
        }
      }
    } catch (e) {
      console.warn('Native playback preference failed, falling back to mix:', e);
    }
  }

  if (!audioEl) return;

  updatePlaybackAudioSource(lastStudioRecording);

  if (audioEl.paused) {
    try {
      const playPromise = audioEl.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise.then(() => {
          const btn = getEl('playRecordingBtn');
          if (btn) btn.innerHTML = `<i class="fas fa-pause"></i> <span>${typeof t === 'function' ? t('dyn_pause') : 'Pause'}</span>`;
        }).catch(async (err) => {
          console.error('Playback promise rejected:', err);
          audioEl.controls = true;
          audioEl.setAttribute('controls', '');
          audioEl.style.display = '';
          const wasMuted = audioEl.muted;
          audioEl.muted = true;
          try {
            const mutedPromise = audioEl.play();
            if (mutedPromise && typeof mutedPromise.then === 'function') {
              await mutedPromise;
            }
            setTimeout(async () => {
              try {
                audioEl.muted = false;
                await audioEl.play();
                const btn = getEl('playRecordingBtn');
                if (btn) btn.innerHTML = `<i class="fas fa-pause"></i> <span>${typeof t === 'function' ? t('dyn_pause') : 'Pause'}</span>`;
              } catch (unmuteErr) {
                console.warn('Muted replay unmute failed:', unmuteErr);
                audioEl.muted = wasMuted;
                showToast(typeof t === 'function' ? t('dyn_playback_failed') : 'ÔÜá Impossible de lancer la lecture, utilise le lecteur audio');
                setPlaybackError(err);
              }
            }, 250);
          } catch (mutedErr) {
            console.warn('Muted playback retry failed:', mutedErr);
            audioEl.muted = wasMuted;
            showToast(typeof t === 'function' ? t('dyn_playback_failed') : 'ÔÜá Impossible de lancer la lecture, utilise le lecteur audio');
            setPlaybackError(err);
          }
        });
      } else {
        const btn = getEl('playRecordingBtn');
        if (btn) btn.innerHTML = `<i class="fas fa-pause"></i> <span>${typeof t === 'function' ? t('dyn_pause') : 'Pause'}</span>`;
      }
    } catch (err) {
      console.error('Playback error:', err);
      audioEl.controls = true;
      audioEl.setAttribute('controls', '');
      audioEl.style.display = '';
      try {
        audioEl.muted = true;
        await audioEl.play();
        setTimeout(async () => {
          try {
            audioEl.muted = false;
            await audioEl.play();
          } catch (unmuteErr) {
            console.warn('Muted play unmute failed:', unmuteErr);
          }
        }, 250);
      } catch (fallbackErr) {
        console.warn('Playback fallback failed:', fallbackErr);
        showToast(typeof t === 'function' ? t('dyn_playback_failed') : 'ÔÜá Impossible de lancer la lecture, utilise le lecteur audio');
        setPlaybackError(err);
      }
    }
  } else {
    audioEl.pause();
    const btn = getEl('playRecordingBtn');
    if (btn) btn.innerHTML = `<i class="fas fa-play"></i> <span data-i18n="fs_listen_recording">${typeof t === 'function' ? t('fs_listen_recording') : '├ëcouter'}</span>`;
  }
}

function stopRecordingPlayback() {
  try {
    if (studioInstance && studioInstance.isMixPlaying && studioInstance.isMixPlaying()) {
      studioInstance.stopStudioMix();
    }
    const audioEl = getEl('recordingPlayback');
    if (audioEl && !audioEl.paused) {
      audioEl.pause();
    }
    const btn = getEl('playRecordingBtn');
    if (btn) {
      const labelKey = playbackMode === 'mix' ? 'fs_listen_mix' : 'fs_listen_recording';
      const label = typeof t === 'function'
        ? t(labelKey)
        : (playbackMode === 'mix' ? '├ëcouter le mix' : '├ëcouter l\'enregistrement');
      btn.innerHTML = `<i class="fas fa-play"></i> <span data-i18n="${labelKey}">${label}</span>`;
    }
  } catch (err) {
    console.warn('stopRecordingPlayback failed', err);
  }
}
window.stopRecordingPlayback = stopRecordingPlayback;

window.downloadLastRecording = function downloadLastStudioRecording() {
  if (!lastStudioRecording) {
    showToast(typeof t === 'function' ? t('dyn_no_recording') : 'Aucun enregistrement ├á t├®l├®charger');
    return;
  }

  const useMix = playbackMode === 'mix' && lastStudioRecording.mixWavUrl;
  const useWav = !useMix && !!lastStudioRecording.wavUrl;
  const href = useMix ? lastStudioRecording.mixWavUrl
    : useWav ? lastStudioRecording.wavUrl : lastStudioRecording.url;
  const ext = useMix || useWav ? 'wav' : ((lastStudioRecording.mimeType || '').includes('ogg') ? 'ogg' : 'webm');
  const prefix = useMix ? 'mix_studio' : 'freestyle';

  const link = document.createElement('a');
  link.href = href;
  link.download = `${prefix}_${lastStudioRecording.beatTitle || 'vocal'}_${Date.now()}.${ext}`;
  link.click();
  showToast(typeof t === 'function' ? t('dyn_download_started') : 'Ô¼ç´©Å T├®l├®chargement lanc├®');
};

function discardLastRecording(silent) {
  const section = getEl('recordingResultSection');
  const audioEl = getEl('recordingPlayback');

  if (studioInstance) studioInstance.stopStudioMix();

  if (audioEl) {
    audioEl.pause();
    audioEl.removeAttribute('src');
    audioEl.load();
  }

  if (lastStudioRecording) {
    if (lastStudioRecording.mixWavUrl) {
      try { URL.revokeObjectURL(lastStudioRecording.mixWavUrl); } catch (e) {}
    }
    if (lastStudioRecording.wavUrl) {
      try { URL.revokeObjectURL(lastStudioRecording.wavUrl); } catch (e) {}
    }
    if (lastStudioRecording.url) {
      try { URL.revokeObjectURL(lastStudioRecording.url); } catch (e) {}
    }
  }

  lastStudioRecording = null;
  try { window.lastStudioRecording = null; } catch (e) {}
  if (section) section.style.display = 'none';

  if (studioInstance && studioInstance.vocalRecorder) {
    studioInstance.vocalRecorder.reset();
  }

  if (!silent) {
    safeText('recordStatus', typeof t === 'function' ? t('dyn_rec_default') : 'Pr├¬t ├á enregistrer');
    showToast(typeof t === 'function' ? t('dyn_recording_discarded') : 'Enregistrement supprim├®');
  }
}

window.playLastRecording = playLastRecording;
window.discardLastRecording = discardLastRecording;
window.setPlaybackMode = setPlaybackMode;
window.startRecordingFlow = startRecordingFlow;
window.stopRecordingFlow = stopRecordingFlow;
window.restartRecordingFlow = restartRecordingFlow;

document.addEventListener('DOMContentLoaded', () => {
  const audioEl = getEl('recordingPlayback');
  if (audioEl) {
    audioEl.setAttribute('playsinline', '');
    audioEl.setAttribute('webkit-playsinline', '');
    const updatePlayButtonLabel = () => {
      const btn = getEl('playRecordingBtn');
      if (!btn) return;
      const labelKey = playbackMode === 'mix' ? 'fs_listen_mix' : 'fs_listen_recording';
      const label = typeof t === 'function'
        ? t(labelKey)
        : (playbackMode === 'mix' ? '├ëcouter le mix' : '├ëcouter l\'enregistrement');
      btn.innerHTML = `<i class="fas fa-play"></i> <span data-i18n="${labelKey}">${label}</span>`;
    };
    audioEl.addEventListener('ended', () => updatePlayButtonLabel());
    audioEl.addEventListener('pause', () => {
      if (audioEl.ended) return;
      updatePlayButtonLabel();
    });
  }

  ['recordStartBtn', 'recordStopBtn', 'recordRestartBtn'].forEach((id) => {
    const btn = getEl(id);
    if (!btn) return;
    btn.setAttribute('type', 'button');
    btn.style.touchAction = 'manipulation';
    btn.style.webkitTapHighlightColor = 'transparent';
  });

  // Make other studio controls touch-friendly on mobiles/tablets
  const touchSelectors = [
    '.effect-btn', '.playback-mode-btn', '.btn-primary', '.btn-ghost', '.control-btn',
    '#reverbBtn', '#delayBtn', '#muteBtn', '#soloBtn', '#playModeMix', '#playModeVocal'
  ];

  // Try to restore the last saved recording from local storage (if available and remote).
  try {
    if (!lastStudioRecording && typeof fsRecordings !== 'undefined' && Array.isArray(fsRecordings) && fsRecordings.length) {
      const candidate = fsRecordings[0];
      const candidateUrl = candidate.playbackUrl || candidate.url || candidate.wavUrl || '';
      const isRemote = typeof candidateUrl === 'string' && /^https?:\/\//i.test(candidateUrl);
      if (isRemote) {
        lastStudioRecording = { ...candidate };
        displayRecordingResult(lastStudioRecording);
        setPlaybackMode(lastStudioRecording.hasBeat ? 'mix' : 'vocal');
        console.log('Ô£à Restored lastStudioRecording from storage');
      } else {
        // If stored URL is a blob: URL it won't be valid across sessions ÔÇö keep saved list only
        console.log('Ôä╣ Found saved recording, but URL is not remote ÔÇö skipping automatic restore');
      }
    }
  } catch (e) {
    console.warn('Failed to restore lastStudioRecording from storage:', e);
  }
  touchSelectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      try {
        el.style.touchAction = 'manipulation';
        el.style.webkitTapHighlightColor = 'transparent';
        el.addEventListener('touchstart', (ev) => {
          // prevent duplicate mouse events
          ev.preventDefault();
          el.click();
        }, { passive: false });
      } catch (e) {}
    });
  });

  // Ensure range inputs respond to touch/pointer events
  document.querySelectorAll('input[type="range"], .eq-band-slider, .fader-slider').forEach(sl => {
    try {
      sl.style.touchAction = 'pan-y';
      sl.addEventListener('touchstart', () => {}, { passive: true });
      sl.addEventListener('pointerdown', () => sl.focus());
    } catch (e) {}
  });

  // Make visualizer canvas responsive to touch (start/stop visualizer)
  const vis = getEl('studioVisualizer');
  if (vis) {
    vis.style.touchAction = 'manipulation';
    vis.addEventListener('touchstart', (e) => { e.preventDefault();
      try {
        if (studioInstance && studioInstance.visualizer) {
          // toggle visualizer
          if (studioInstance.visualizer.animationId) studioInstance.visualizer.stop();
          else studioInstance.visualizer.start();
        }
      } catch (err) { console.warn('visualizer touch toggle', err); }
    }, { passive: false });
  }
});

function updateRecordingTimerUI() {
  const duration = studioInstance.getRecordingDuration() / 1000;
  safeText('recordTimer', formatTime(duration));
}

function updateMicLevelUI() {
  const level = Math.min(100, studioInstance.getMicLevel() * 200);
  safeStyle('micLevelBar', 'width', level + '%');
}

// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
// MIXER CONTROLS
// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ

function updateBeatVolume(value) {
  runOrQueue(() => {
    console.log('[DIAG] updateBeatVolume called', { value, ua: navigator.userAgent, isMobile: window.isMobileDevice });
    console.log('[DIAG] studioInstance present:', !!studioInstance);
    if (!studioInstance) return;
    studioInstance.setBeatVolume(value);
    safeText('beatVolValue', value + '%');
    if (studioInstance.isMixPlaying()) {
      const vols = getMixerVolumes();
      studioInstance.updateMixVolumes(vols.beat, vols.vocal);
    }
  });
}

function updateVocalVolume(value) {
  runOrQueue(() => {
    console.log('[DIAG] updateVocalVolume called', { value, ua: navigator.userAgent, isMobile: window.isMobileDevice });
    console.log('[DIAG] studioInstance present:', !!studioInstance);
    if (!studioInstance) return;
    studioInstance.setVocalVolume(value);
    safeText('vocalVolValue', value + '%');
    if (studioInstance.isMixPlaying()) {
      const vols = getMixerVolumes();
      studioInstance.updateMixVolumes(vols.beat, vols.vocal);
    }
  });
}

function toggleEffect(effect) {
  runOrQueue(() => {
    console.log('[DIAG] toggleEffect called', { effect, ua: navigator.userAgent, isMobile: window.isMobileDevice });
    console.log('[DIAG] studioInstance present:', !!studioInstance);
    const btn = getEl(effect + 'Btn');
    if (!btn) return;

    btn.classList.toggle('active');
    if (effect === 'reverb') {
      studioInstance.setReverb(btn.classList.contains('active') ? 40 : 0);
    } else if (effect === 'delay') {
      studioInstance.setDelay(btn.classList.contains('active') ? 30 : 0);
    }
  });
}

function toggleMute() {
  runOrQueue(() => {
    console.log('[DIAG] toggleMute called', { ua: navigator.userAgent, isMobile: window.isMobileDevice });
    console.log('[DIAG] studioInstance present:', !!studioInstance);
    const btn = getEl('muteBtn');
    if (!btn) return;
    btn.classList.toggle('active');
    if (btn.classList.contains('active')) {
      studioInstance.setVocalVolume(0);
    } else {
      const slider = getEl('vocalVolSlider');
      if (slider) {
        studioInstance.setVocalVolume(parseFloat(slider.value));
      }
    }
  });
}

function toggleSolo() {
  console.log('[DIAG] toggleSolo called', { ua: navigator.userAgent, isMobile: window.isMobileDevice });
  console.log('[DIAG] studioInstance present:', !!studioInstance);
  runOrQueue(() => {
    const btn = getEl('soloBtn');
    if (!btn) return;
    btn.classList.toggle('active');
    if (btn.classList.contains('active')) {
      studioInstance.setBeatVolume(0);
    } else {
      const slider = getEl('beatVolSlider');
      if (slider) {
        studioInstance.setBeatVolume(parseFloat(slider.value));
      }
    }
  });
}

// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
// EQUALIZER CONTROLS
// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ

function updateEQ(band, value) {
  runOrQueue(() => {
    console.log('[DIAG] updateEQ called', { band, value, ua: navigator.userAgent, isMobile: window.isMobileDevice });
    console.log('[DIAG] studioInstance present:', !!studioInstance);
    const dB = ((value - 0) / 50) * 5; // Convert to dB (-5 to +5)
    const bandIndex = band === 'bass' ? 0 : band === 'mid' ? 1 : 2;
    
    if (studioInstance && typeof studioInstance.setEQ === 'function') {
      studioInstance.setEQ(bandIndex, value);
    }
    
    const bandName = band.charAt(0).toUpperCase() + band.slice(1);
    const el = document.getElementById('eq' + bandName + 'Value');
    if (el) el.textContent = dB.toFixed(1) + ' dB';
  });
}

// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
// EXPORT & PUBLISH
// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ

async function exportFreestyle() {
  runOrQueue(async () => {
    console.log('[DIAG] exportFreestyle called', { ua: navigator.userAgent, isMobile: window.isMobileDevice });
    console.log('[DIAG] studioInstance present:', !!studioInstance);
    const user = auth.currentUser;
    if (!user) {
      showToast(t('export_login_required'));
      return;
    }

    const recording = studioInstance.vocalRecorder.getRecordedBuffer()
      || studioInstance.vocalRecorder.getRecordedBlob();
    if (!recording) {
      showToast(t('export_no_recording'));
      return;
    }

    showToast(t('export_preparing'));

    try {
      const wavBlob = await studioInstance.exportRecording();
      const url = URL.createObjectURL(wavBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `freestyle_${user.displayName || 'user'}_${Date.now()}.wav`;
      link.click();
      URL.revokeObjectURL(url);

      showToast(t('export_success'));
    } catch (error) {
      console.error('Export error:', error);
      showToast(t('export_error'));
    }
  });
}

async function publishFreestyle() {
  runOrQueue(async () => {
    console.log('[DIAG] publishFreestyle called', { ua: navigator.userAgent, isMobile: window.isMobileDevice });
    console.log('[DIAG] studioInstance present:', !!studioInstance);
    const user = auth.currentUser;
    if (!user) {
      showToast(t('export_login_required'));
      return;
    }

    const recording = studioInstance.vocalRecorder.getRecordedBuffer()
      || studioInstance.vocalRecorder.getRecordedBlob();
    if (!recording) {
      showToast(t('export_no_recording'));
      return;
    }

    showToast(t('publish_preparing'));

    try {
      const wavBlob = await studioInstance.exportRecording();
      const timestamp = Date.now();
      const storageRef = firebase.storage().ref(`freestyles/${user.uid}/${timestamp}.wav`);
      
      const task = storageRef.put(wavBlob);
      
      task.on('state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          console.log('Upload progress:', progress);
        },
        (error) => {
          console.error('Upload error:', error);
          showToast(t('publish_upload_error'));
        },
        async () => {
          const url = await storageRef.getDownloadURL();

          await db.collection('freestyles').add({
            userId: user.uid,
            userName: user.displayName || 'Anonymous',
            title: `Freestyle - ${new Date().toLocaleDateString('fr-FR')}`,
            audioUrl: url,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            likes: 0,
            plays: 0
          });

          showToast(t('publish_success'));
        }
      );

    } catch (error) {
      console.error('Publish error:', error);
      showToast(t('publish_error'));
    }
  });
}

function shareFreestyle() {
  runOrQueue(() => {
    console.log('[DIAG] shareFreestyle called', { ua: navigator.userAgent, isMobile: window.isMobileDevice });
    console.log('[DIAG] studioInstance present:', !!studioInstance);
    const link = window.location.href.split('#')[0] + '#freestyle';
    navigator.clipboard.writeText(link);
    showToast(t('share_link_copied'));
  });
}

window.updateFreestyleTranslations = function updateFreestyleTranslations() {
  if (lastStudioRecording && getEl('recordingResultSection')?.style.display !== 'none') {
    displayRecordingResult(lastStudioRecording);
    setPlaybackMode(playbackMode);
  }
  const playBtn = getEl('playRecordingBtn');
  const audioEl = getEl('recordingPlayback');
  if (playBtn && !(studioInstance && studioInstance.isMixPlaying && studioInstance.isMixPlaying()) && (!audioEl || audioEl.paused)) {
    playBtn.innerHTML = `<i class="fas fa-play"></i> <span data-i18n="fs_listen_mix">${t('fs_listen_mix')}</span>`;
  }
};

// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
// INITIALIZATION
// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeStudioUI);
} else {
  initializeStudioUI();
}

// Ensure all control functions are globally accessible
if (!window.toggleEffect) window.toggleEffect = toggleEffect;
if (!window.toggleMute) window.toggleMute = toggleMute;
if (!window.toggleSolo) window.toggleSolo = toggleSolo;
if (!window.updateEQ) window.updateEQ = updateEQ;
if (!window.updateBeatVolume) window.updateBeatVolume = updateBeatVolume;
if (!window.updateVocalVolume) window.updateVocalVolume = updateVocalVolume;
if (!window.exportFreestyle) window.exportFreestyle = exportFreestyle;
if (!window.publishFreestyle) window.publishFreestyle = publishFreestyle;
if (!window.shareFreestyle) window.shareFreestyle = shareFreestyle;

// ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
// Mobile/tablet compatibility helpers
// ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

// Ensure AudioContext is resumed on first user gesture (iOS requirement)
function activateAudioOnGesture() {
  const onUserGesture = async () => {
    try {
      if (studioInstance && studioInstance.engine && typeof studioInstance.engine.getContext === 'function') {
        const ctx = studioInstance.engine.getContext();
        if (ctx && ctx.state === 'suspended') {
          await ctx.resume();
          console.log('[DIAG] AudioContext resumed on user gesture');
        }
      } else if (!studioInstance) {
        // Try initialize studio if not already
        try { await initializeStudioUI(); } catch (e) { console.warn('Init on gesture failed', e); }
      }
    } catch (e) { console.warn('activateAudioOnGesture error', e); }
    document.removeEventListener('pointerdown', onUserGesture);
  };
  document.addEventListener('pointerdown', onUserGesture, { once: true });
}

function attachPointerHandlers() {
  // On iOS Safari, touch events don't trigger onclick. We need fallback handlers.
  // Add touchend listener to supplement iOS tap detection.
  // But DON'T override onclick behavior - let browser handle onclick naturally.
  document.querySelectorAll('button[onclick]').forEach(btn => {
    const handler = (ev) => {
      // Trigger the onclick attribute directly
      const onclickStr = btn.getAttribute('onclick');
      if (onclickStr) {
        try {
          eval(onclickStr);
        } catch (e) {
          console.warn('[DIAG] pointer handler error', e);
        }
      }
    };
    // Only add for touch events on iOS - let click event work naturally
    btn.addEventListener('touchend', handler, { passive: true });
  });

  // Specific effect buttons by id (may have inline params)
  ['reverbBtn','delayBtn','muteBtn','soloBtn'].forEach(id => {
    const el = getEl(id);
    if (!el) return;
    const handler = (ev) => {
      try {
        // map id to action
        if (id === 'reverbBtn') toggleEffect('reverb');
        else if (id === 'delayBtn') toggleEffect('delay');
        else if (id === 'muteBtn') toggleMute();
        else if (id === 'soloBtn') toggleSolo();
      } catch (e) { console.warn('[DIAG] effect pointer error', id, e); }
    };
    el.addEventListener('pointerup', handler);
    el.addEventListener('touchend', handler, { passive: true });
  });

  // Range inputs: on pointerup or touchend, trigger input change handler
  document.querySelectorAll('input[type="range"]').forEach(sl => {
    const handler = (ev) => {
      try {
        sl.dispatchEvent(new Event('input', { bubbles: true }));
        sl.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (e) { console.warn('[DIAG] range handler error', e); }
    };
    sl.addEventListener('pointerup', handler);
    sl.addEventListener('touchend', handler, { passive: true });
  });

  // Visualizer canvas: pointerup toggles visualizer as fallback
  const vis = getEl('studioVisualizer');
  if (vis) {
    const vHandler = () => {
      try {
        if (studioInstance && studioInstance.visualizer) {
          if (studioInstance.visualizer.animationId) studioInstance.visualizer.stop();
          else studioInstance.visualizer.start();
        }
      } catch (e) { console.warn('visualizer toggle error', e); }
    };
    vis.addEventListener('pointerup', vHandler);
    vis.addEventListener('touchend', vHandler, { passive: true });
  }
}

// Attach after DOM ready
try { attachPointerHandlers(); } catch (e) { console.warn('attachPointerHandlers failed', e); }
try { activateAudioOnGesture(); } catch (e) { console.warn('activateAudioOnGesture failed', e); }
