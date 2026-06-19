// ═════════════════════════════════════════════════════════════════
// GLOBAL STUDIO INSTANCE & INITIALIZATION
// ═════════════════════════════════════════════════════════════════

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
  try {
    return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(source)
      ? source
      : new URL(source, window.location.href).href;
  } catch (error) {
    return source;
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
    // Initialize audio engine
    studioInstance = await initStudio();
    window.studioInstance = studioInstance;
    
    console.log('✅ Studio UI initialized');

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
    console.error('❌ Studio initialization error:', error);
    showToast(typeof t === 'function' ? t('studio_error_init') : 'Error initializing the studio');
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

    const fsMeta = `${beatData.bpm || '120'} BPM · ${beatData.genre || 'Hip-Hop'}`;
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

    selector.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--studio-secondary); font-family: var(--font-mono); font-size: 0.7rem;">⏳ ${t('studio_beats_loading')}</div>`;

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
        <div style="font-size: 1.8rem; margin-bottom: 6px;">🎵</div>
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

  // Prefer explicit audio path from beat metadata
  const beatSource = beatData.audioFile || beatData.audio || beatData.url || '';
  if (beatSource) {
    try {
      beatUrl = beatSource;
      await studioInstance.loadBeatFromURL(beatUrl, beatInfo);
      loaded = true;
    } catch (error) {
      console.warn('Local beat load failed, will try storage fallback:', error);
    }
  }

  if (!loaded) {
    const fallbackBeat = getLocalBeatFallback(beatData);
    if (fallbackBeat && fallbackBeat.audio) {
      try {
        beatUrl = resolveBeatURL(fallbackBeat.audio);
        await studioInstance.loadBeatFromURL(beatUrl, beatInfo);
        loaded = true;
      } catch (error) {
        console.warn('Local default beat fallback failed:', error);
      }
    }
  }

  if (!loaded && firebase && firebase.storage) {
    try {
      const beatFile = beatData.audioFile || beatData.audio || `${beatId}.mp3`;
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
    if (fallbackBeat && fallbackBeat.audio) {
      try {
        beatUrl = resolveBeatURL(fallbackBeat.audio);
        await studioInstance.loadBeatFromURL(beatUrl, beatInfo);
        loaded = true;
      } catch (error) {
        console.warn('Local fallback after storage failed:', error);
      }
    }
  }

  if (!loaded) {
    showToast(typeof t === 'function' ? t('studio_beat_not_found') : '❌ Beat not found. Check your connection or choose another beat.');
    return;
  }

  showToast(typeof t === 'function' ? t('studio_beat_selected', beatInfo.name) : `✅ Beat selected: ${beatInfo.name}`);
}

// ═════════════════════════════════════════════════════════════════
// BEAT PLAYER CONTROLS
// ═════════════════════════════════════════════════════════════════

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

// ═════════════════════════════════════════════════════════════════
// RECORDING CONTROLS
// ═════════════════════════════════════════════════════════════════

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
    showToast(typeof t === 'function' ? t('dyn_recording_status') : 'Enregistrement déjà en cours');
    return;
  }

  // Prefer an explicit polyfill if provided, otherwise fall back to
  // the standard navigator.mediaDevices.getUserMedia API when available.
  if (!window.getUserMediaPolyfill && !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
    showToast('⚠ Micro non supporté sur ce navigateur');
    return;
  }

  try {
    cleanupMobileMic();
    if (window.getUserMediaPolyfill) {
      mobileStream = await window.getUserMediaPolyfill(window.getMicConstraints());
    } else {
      const constraints = (typeof window.getMicConstraints === 'function') ? window.getMicConstraints() : { audio: true };
      mobileStream = await navigator.mediaDevices.getUserMedia(constraints);
    }
    mobileChunks = [];
    startMicLevelMonitor(mobileStream);

    // Ensure MediaRecorder is available
    const useFallbackRecorder = (typeof MediaRecorder === 'undefined');
    if (useFallbackRecorder) {
      showToast('ℹ Enregistreur natif non disponible → utilisation d\'un fallback');
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
        console.log('✅ MediaRecorder created with mimeType:', mimeType || 'default', 'bitrate:', options.audioBitsPerSecond);
      }
    } catch (e) {
      console.warn('MediaRecorder ctor failed, switching to fallback', e);
      mobileRecorder = null;
    }

    if (mobileRecorder) {
      mobileRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          mobileChunks.push(e.data);
          console.log('📦 Audio chunk received:', e.data.size, 'bytes, total chunks:', mobileChunks.length);
        }
      };
      mobileRecorder.onstop = () => {
        console.log('⏹️ MediaRecorder stopped, total chunks:', mobileChunks.length);
        finishSimpleVocalRecording();
      };
      mobileRecorder.onerror = (ev) => {
        console.error('MediaRecorder error:', ev);
        showToast(typeof t === 'function' ? t('dyn_recording_failed') : '⚠ Enregistrement impossible');
        cleanupMobileMic();
      };
      let recorderStarted = false;
      mobileRecorder.onstart = () => {
        recorderStarted = true;
        console.log('▶️ MediaRecorder started successfully');
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
        
        console.log('✅ Fallback recorder started with sampleRate:', targetSampleRate, 'Hz, bufferSize:', bufferSize);
      } catch (err) {
        console.error('startFallbackRecorder error:', err);
        throw err;
      }
    }
    mobileRecorder.onerror = (ev) => {
      console.error('MediaRecorder error:', ev);
      showToast(typeof t === 'function' ? t('dyn_recording_failed') : '⚠ Enregistrement impossible');
      cleanupMobileMic();
    };
    let recorderStarted = false;
    mobileRecorder.onstart = () => { recorderStarted = true; };

    const beat = window.fsSelectedBeat || window.pendingStudioBeat;
    if (typeof fsAudio !== 'undefined' && beat && beat.audio) {
      const beatUrl = beat.audio.startsWith('http') ? beat.audio : new URL(beat.audio, window.location.href).href;
      if (fsAudio.src !== beatUrl) fsAudio.src = beatUrl;
      fsAudio.loop = true;
      fsAudio.currentTime = 0;
      fsAudio.muted = false;
      fsAudio.volume = 0.85;
      try {
        if (typeof ensureFsBeatPlayback === 'function') {
          await ensureFsBeatPlayback();
        } else {
          await fsAudio.play();
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
        console.log('✅ Fallback recorder started in parallel');
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
        console.log('✅ MediaRecorder started with timeslice:', isIOS ? 'none (iOS)' : '1000ms (unified)');
      } catch (startErr) {
        console.error('MediaRecorder start failed:', startErr);
        try { mobileRecorder.start(); } catch (e) { console.error('MediaRecorder fallback start failed:', e); }
      }

      // If the recorder hasn't entered 'recording' state within 1s, treat as failure
      setTimeout(() => {
        if (mobileRecorder && mobileRecorder.state !== 'recording') {
          console.warn('MediaRecorder did not start recording, state=', mobileRecorder.state);
          showToast(typeof t === 'function' ? t('dyn_recording_failed') : '⚠ Impossible de démarrer l\'enregistrement');
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
        showToast(typeof t === 'function' ? t('dyn_recording_failed') : '⚠ Impossible d\'activer le micro');
        cleanupMobileMic();
        return;
      }
    }

    mobileRecordingActive = true;
    mobileRecordingStart = Date.now();

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

    showToast(typeof t === 'function' ? t('studio_recording_started') : '🔴 Enregistrement démarré');
  } catch (error) {
    console.error('Vocal recording failed:', error);
    cleanupMobileMic();
    let msg;
    if (error.name === 'NotAllowedError') {
      msg = typeof t === 'function' ? t('studio_mic_denied') : 'Micro refusé — autorise l\'accès dans les réglages';
    } else if (error.name === 'NotFoundError') {
      msg = typeof t === 'function' ? t('studio_mic_not_found') : 'Aucun micro détecté';
    } else {
      msg = typeof t === 'function' ? t('studio_mic_error') : 'Impossible d\'accéder au microphone';
    }
    showToast('⚠ ' + msg);
    safeText('recordStatus', msg);
  }
}

function finishSimpleVocalRecording() {
  mobileRecordingActive = false;
  clearInterval(recordingTimerInterval);

  // Priority: use fallback if it has data, otherwise use MediaRecorder
  let blob = null;
  let usedFallback = false;

  console.log('🔍 Processing recording - MediaRecorder chunks:', mobileChunks.length, 'Fallback buffers:', fallbackBuffers?.length || 0);

  // Try fallback first if it captured data (works on both mobile and desktop)
  if (fallbackBuffers && fallbackBuffers.length > 0) {
    try {
      const sampleRate = (fallbackAudioCtx && fallbackAudioCtx.sampleRate) ? fallbackAudioCtx.sampleRate : 44100;
      const interleaved = flattenFloat32Array(fallbackBuffers);
      console.log('📊 Fallback audio data - samples:', interleaved.length, 'sampleRate:', sampleRate);
      
      const wavBlob = encodeWAV(interleaved, sampleRate);
      if (wavBlob && wavBlob.size > 100) { // Increased threshold to avoid false positives
        blob = wavBlob;
        usedFallback = true;
        console.log('✅ Using fallback WAV recorder:', wavBlob.size, 'bytes');
      } else {
        console.warn('⚠️ Fallback WAV too small:', wavBlob?.size || 0, 'bytes');
      }
    } catch (e) {
      console.error('❌ finishSimpleVocalRecording fallback encode failed:', e);
    }
  }

  // If fallback didn't produce data, try MediaRecorder blob
  if (!blob || blob.size === 0) {
    if (mobileChunks && mobileChunks.length > 0) {
      const mime = mobileRecorder?.mimeType || (typeof window.getSupportedRecorderMimeType === 'function' ? window.getSupportedRecorderMimeType() : 'audio/webm');
      blob = new Blob(mobileChunks, { type: mime });
      if (blob && blob.size > 100) { // Increased threshold
        console.log('✅ Using MediaRecorder blob:', blob.size, 'bytes, mime:', mime, 'chunks:', mobileChunks.length);
      } else {
        console.warn('⚠️ MediaRecorder blob too small:', blob?.size || 0, 'bytes');
      }
    } else {
      console.warn('⚠️ No MediaRecorder chunks available');
    }
  }

  cleanupMobileMic();

  if (!blob || blob.size <= 100) {
    console.error('❌ Recording produced no valid data. MediaRecorder chunks:', mobileChunks.length, 'Fallback buffers:', fallbackBuffers?.length || 0, 'Final blob size:', blob?.size || 0);
    safeText('recordStatus', typeof t === 'function' ? t('dyn_recording_failed') : 'Impossible de capturer l\'audio. Vérifie les permissions.');
    showToast('⚠ Enregistrement vide — vérifie que le micro fonctionne et réessaie');
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

  const recordBtn = getEl('recordStartBtn');
  if (recordBtn) recordBtn.classList.remove('recording');
  safeClassRemove('monitoringBadge', 'active');
  safeText('recordStatus', typeof t === 'function' ? t('dyn_recording_processing') : 'Traitement...');
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
    showToast(typeof t === 'function' ? t('dyn_recording_status') : 'Enregistrement déjà en cours');
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
  safeText('recordStatus', typeof t === 'function' ? t('dyn_recording_prepare') : 'Prêt pour un nouvel enregistrement');

  setTimeout(() => {
    startRecordingFlow();
  }, 300);
}

function handleRecordingReady(data) {
  if (!data || (!data.playbackUrl && !data.url)) {
    safeText('recordStatus', typeof t === 'function' ? t('dyn_recording_failed') : 'Échec de l\'enregistrement');
    showToast(typeof t === 'function' ? t('dyn_recording_failed') : '❌ Échec de l\'enregistrement');
    return;
  }

  const beat = window.fsSelectedBeat || window.pendingStudioBeat;
  const hasBeat = !!(beat && beat.audio) || (studioInstance && studioInstance.hasBeatForMix());

  // Use original blob URL for playback on mobile to prevent audio corruption
  // On desktop, prefer WAV if available for better compatibility
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /MacIntel/.test(navigator.platform));
  const playbackUrl = isMobile ? (data.url || data.playbackUrl) : (data.playbackUrl || data.wavUrl || data.url);

  lastStudioRecording = {
    id: Date.now(),
    url: data.url,
    wavUrl: data.wavUrl,
    playbackUrl,
    blob: data.blob,
    wavBlob: data.wavBlob,
    mimeType: data.mimeType || 'audio/webm',
    duration: data.duration || studioInstance.getRecordingDuration() / 1000,
    beatTitle: beat ? (beat.title || beat.name || '—') : t('fs_vocal_solo'),
    date: new Date().toLocaleDateString(currentLang === 'en' ? 'en-GB' : 'fr-FR'),
    label: t('fs_take_label') + ' ' + ((typeof fsRecordings !== 'undefined' && fsRecordings.length) ? fsRecordings.length + 1 : 1),
    hasBeat,
    mixWavUrl: null,
    mixWavBlob: null
  };

  playbackMode = hasBeat ? 'mix' : 'vocal';

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

  displayRecordingResult(lastStudioRecording);
  safeText('recordStatus', t('dyn_recording_done'));
  safeStyle('recordTimer', 'display', 'none');
  showToast(hasBeat ? t('fs_mix_ready') : t('dyn_recording_saved'));

  if (hasBeat) {
    generateStudioMix(lastStudioRecording);
  }
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
      if (playbackMode === 'mix') {
        updatePlaybackAudioSource(recording);
      }
    }
    console.log('✅ Studio mix rendered');
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

  // Revoke old URL if it's a blob URL to free memory
  if (audioEl.src && audioEl.src.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(audioEl.src);
    } catch (e) {
      console.warn('Failed to revoke old blob URL:', e);
    }
  }

  audioEl.src = src;
  audioEl.load();

  // Configure audio element for better playback performance
  audioEl.preload = 'auto';
  audioEl.crossOrigin = 'anonymous';

  // Ensure audio is ready before allowing playback
  audioEl.oncanplay = () => {
    console.log('✅ Audio ready for playback');
  };

  audioEl.onerror = (e) => {
    console.error('❌ Audio playback error:', e);
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
          <div class="recording-result-meta">${recording.beatTitle} · ${recording.date} · ${durationLabel} · ${formatLabel}</div>
        </div>
      </div>`;
  }

  const mixTabs = getEl('playbackModeTabs');
  if (mixTabs) {
    mixTabs.style.display = recording.hasBeat ? 'flex' : 'none';
    if (recording.hasBeat) setPlaybackMode('mix');
  }

  if (audioEl) {
    audioEl.onerror = () => {
      if (playbackMode === 'mix' && recording.wavUrl && audioEl.src !== recording.wavUrl) {
        audioEl.src = recording.wavUrl;
        audioEl.load();
        return;
      }
      showToast(typeof t === 'function' ? t('dyn_playback_failed') : '⚠ Impossible de lire l\'enregistrement');
    };

    audioEl.onloadedmetadata = () => {
      console.log('✅ Recording ready to play:', audioEl.duration, 's');
    };

    updatePlaybackAudioSource(recording);
    recordingPlaybackAudio = audioEl;
  }

  section.style.display = 'block';
  section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function playLastRecording() {
  if (!lastStudioRecording) {
    showToast(typeof t === 'function' ? t('dyn_no_recording') : 'Aucun enregistrement disponible');
    return;
  }

  if (studioInstance && studioInstance.isMixPlaying()) {
    studioInstance.stopStudioMix();
    const btn = getEl('playRecordingBtn');
    if (btn) btn.innerHTML = `<i class="fas fa-play"></i> <span data-i18n="fs_listen_recording">${typeof t === 'function' ? t('fs_listen_recording') : 'Écouter'}</span>`;
    return;
  }

  const audioEl = getEl('recordingPlayback');

  // Mix studio en temps réel via Web Audio (beat + voix sync)
  if (playbackMode === 'mix' && lastStudioRecording.hasBeat && studioInstance) {
    const vols = getMixerVolumes();
    if (audioEl) audioEl.pause();
    const ok = await studioInstance.playStudioMix(vols.beat, vols.vocal);
    if (ok) {
      const btn = getEl('playRecordingBtn');
      if (btn) btn.innerHTML = `<i class="fas fa-stop"></i> <span>${typeof t === 'function' ? t('dyn_stop') : 'Arrêter'}</span>`;
      return;
    }
  }

  if (!audioEl) return;

  if (!audioEl.src) updatePlaybackAudioSource(lastStudioRecording);

  if (audioEl.paused) {
    try {
      await audioEl.play();
      const btn = getEl('playRecordingBtn');
      if (btn) btn.innerHTML = `<i class="fas fa-pause"></i> <span>${typeof t === 'function' ? t('dyn_pause') : 'Pause'}</span>`;
    } catch (err) {
      console.error('Playback error:', err);
      showToast(typeof t === 'function' ? t('dyn_playback_failed') : '⚠ Clique sur le lecteur audio pour écouter');
    }
  } else {
    audioEl.pause();
    const btn = getEl('playRecordingBtn');
    if (btn) btn.innerHTML = `<i class="fas fa-play"></i> <span data-i18n="fs_listen_recording">${typeof t === 'function' ? t('fs_listen_recording') : 'Écouter'}</span>`;
  }
}

window.downloadLastRecording = function downloadLastStudioRecording() {
  if (!lastStudioRecording) {
    showToast(typeof t === 'function' ? t('dyn_no_recording') : 'Aucun enregistrement à télécharger');
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
  showToast(typeof t === 'function' ? t('dyn_download_started') : '⬇️ Téléchargement lancé');
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
  if (section) section.style.display = 'none';

  if (studioInstance && studioInstance.vocalRecorder) {
    studioInstance.vocalRecorder.reset();
  }

  if (!silent) {
    safeText('recordStatus', typeof t === 'function' ? t('dyn_rec_default') : 'Prêt à enregistrer');
    showToast(typeof t === 'function' ? t('dyn_recording_discarded') : 'Enregistrement supprimé');
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
    audioEl.addEventListener('ended', () => {
      const btn = getEl('playRecordingBtn');
      if (btn) btn.innerHTML = `<i class="fas fa-play"></i> <span data-i18n="fs_listen_recording">${typeof t === 'function' ? t('fs_listen_recording') : 'Écouter l\'enregistrement'}</span>`;
    });
    audioEl.addEventListener('pause', () => {
      if (audioEl.ended) return;
      const btn = getEl('playRecordingBtn');
      if (btn) btn.innerHTML = `<i class="fas fa-play"></i> <span data-i18n="fs_listen_recording">${typeof t === 'function' ? t('fs_listen_recording') : 'Écouter l\'enregistrement'}</span>`;
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

// ═════════════════════════════════════════════════════════════════
// MIXER CONTROLS
// ═════════════════════════════════════════════════════════════════

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

// ═════════════════════════════════════════════════════════════════
// EQUALIZER CONTROLS
// ═════════════════════════════════════════════════════════════════

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

// ═════════════════════════════════════════════════════════════════
// EXPORT & PUBLISH
// ═════════════════════════════════════════════════════════════════

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

// ═════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═════════════════════════════════════════════════════════════════

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

// ─────────────────────────────────────────────────────────────────
// Mobile/tablet compatibility helpers
// ─────────────────────────────────────────────────────────────────

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
