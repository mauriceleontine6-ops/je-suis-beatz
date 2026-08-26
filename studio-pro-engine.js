/* ═══════════════════════════════════════════════════════════════════
   STUDIO VIRTUEL PRO — Web Audio API Modulaire
   Auteur : Full-Stack Audio Engineer
   Dernière mise à jour : 12 Juin 2026
═══════════════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════════════
// 1. AUDIO ENGINE — Gestion contexte audio
// ═══════════════════════════════════════════════════════════════════

class AudioEngine {
  constructor() {
    this.audioContext = null;
    this.isInitialized = false;
  }

  async initialize() {
    if (this.isInitialized) return;
    
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContext();
      
      // Resume if suspended
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      this.isInitialized = true;
      console.log('✅ Audio Engine initialized', this.audioContext.sampleRate, 'Hz');
    } catch (error) {
      console.error('❌ Audio Engine initialization failed:', error);
    }
  }

  getContext() {
    return this.audioContext;
  }

  get currentTime() {
    return this.audioContext ? this.audioContext.currentTime : 0;
  }

  get sampleRate() {
    return this.audioContext ? this.audioContext.sampleRate : 44100;
  }
}

// ═══════════════════════════════════════════════════════════════════
// 2. BEAT PLAYER — Lecteur de beats avec Web Audio
// ═══════════════════════════════════════════════════════════════════

class BeatPlayer {
  constructor(audioEngine) {
    this.audioEngine = audioEngine;
    this.audioBuffer = null;
    this.sourceNode = null;
    this.gainNode = null;
    this.analyserNode = null;
    this.isPlaying = false;
    this.startTime = 0;
    this.pausedTime = 0;
    this.beatData = {
      name: 'No Beat Selected',
      bpm: 0,
      duration: 0,
      key: 'C',
      genre: 'Hip-Hop'
    };
  }

  async loadBeat(audioBuffer, beatData = {}) {
    this.audioBuffer = audioBuffer;
    this.beatData = { ...this.beatData, ...beatData };
    this.pausedTime = 0;
    console.log('✅ Beat loaded:', this.beatData.name);
  }

  play(startAt = 0) {
    const ctx = this.audioEngine.getContext();
    if (!this.audioBuffer) return;
    if (this.isPlaying) {
      this.pause();
    }

    if (this.sourceNode) {
      try { this.sourceNode.stop(); } catch (e) {}
    }

    this.sourceNode = ctx.createBufferSource();
    this.sourceNode.buffer = this.audioBuffer;

    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = 0.7;

    this.analyserNode = ctx.createAnalyser();
    this.analyserNode.fftSize = 256;

    this.sourceNode.connect(this.gainNode);
    this.gainNode.connect(this.analyserNode);
    this.analyserNode.connect(ctx.destination);

    const offsetTime = this.pausedTime;
    if (startAt <= 0) {
      startAt = ctx.currentTime;
    }

    try {
      this.sourceNode.start(startAt, offsetTime);
    } catch (error) {
      console.warn('BeatPlayer start failed, retrying immediately:', error);
      this.sourceNode.start(0, offsetTime);
      startAt = ctx.currentTime;
    }

    this.startTime = startAt - offsetTime;
    this.isPlaying = true;

    this.sourceNode.onended = () => this.stop();
  }

  pause() {
    if (!this.isPlaying || !this.sourceNode) return;

    const ctx = this.audioEngine.getContext();
    this.pausedTime = ctx.currentTime - this.startTime;
    this.sourceNode.stop();
    this.isPlaying = false;
  }

  stop() {
    if (this.sourceNode) {
      this.sourceNode.stop();
    }
    this.isPlaying = false;
    this.pausedTime = 0;
  }

  setVolume(value) {
    if (this.gainNode) {
      this.gainNode.gain.value = Math.max(0, Math.min(1, value / 100));
    }
  }

  getCurrentTime() {
    if (!this.isPlaying || !this.sourceNode) return this.pausedTime;
    const ctx = this.audioEngine.getContext();
    return ctx.currentTime - this.startTime;
  }

  getDuration() {
    return this.audioBuffer ? this.audioBuffer.duration : 0;
  }

  seek(time) {
    const wasPlaying = this.isPlaying;
    if (this.isPlaying) this.pause();
    this.pausedTime = Math.max(0, Math.min(time, this.getDuration()));
    if (wasPlaying) this.play();
  }

  getFrequencyData() {
    if (!this.analyserNode) return new Uint8Array(0);
    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(dataArray);
    return dataArray;
  }
}

// ═══════════════════════════════════════════════════════════════════
// 3. VOCAL RECORDER — Enregistrement micro avec sync
// ═══════════════════════════════════════════════════════════════════

function getSupportedRecorderMimeType() {
  const iosFirst = [
    'audio/mp4',
    'audio/aac',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg'
  ];
  const defaultOrder = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    'audio/aac',
    'audio/ogg'
  ];
  const types = isIOS() ? iosFirst : defaultOrder;
  for (const type of types) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
}

function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /MacIntel/.test(navigator.platform));
}

function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /MacIntel/.test(navigator.platform));
}

function getMicConstraints() {
  const audioConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    sampleRate: 48000,
    channelCount: 2,
  };

  return {
    audio: audioConstraints,
    video: false
  };
}

function getUserMediaPolyfill(constraints) {
  if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
    return navigator.mediaDevices.getUserMedia(constraints);
  }
  const legacy = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
  if (!legacy) {
    return Promise.reject(new Error('getUserMedia not supported'));
  }
  return new Promise((resolve, reject) => {
    legacy.call(navigator, constraints, resolve, reject);
  });
}

function isRecordingSupported() {
  const hasMicApi = !!(navigator.mediaDevices?.getUserMedia
    || navigator.getUserMedia
    || navigator.webkitGetUserMedia);
  return hasMicApi && typeof MediaRecorder !== 'undefined';
}

function audioBufferToWavBlob(audioBuffer) {
  const numberOfChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numberOfChannels * bytesPerSample;

  const channels = [];
  for (let i = 0; i < numberOfChannels; i++) {
    channels.push(audioBuffer.getChannelData(i));
  }

  const interleaved = new Float32Array(audioBuffer.length * numberOfChannels);
  for (let i = 0; i < audioBuffer.length; i++) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      interleaved[i * numberOfChannels + channel] = channels[channel][i];
    }
  }

  const dataLength = interleaved.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeStr(36, 'data');
  view.setUint32(40, dataLength, true);

  let index = 44;
  for (let i = 0; i < interleaved.length; i++) {
    const sample = Math.max(-1, Math.min(1, interleaved[i]));
    view.setInt16(index, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
    index += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

class VocalRecorder {
  constructor(audioEngine) {
    this.audioEngine = audioEngine;
    this.mediaRecorder = null;
    this.stream = null;
    this.audioChunks = [];
    this.isRecording = false;
    this.recordedAudioBuffer = null;
    this.recordedBlob = null;
    this.recordedBlobUrl = null;
    this.recordedWavBlob = null;
    this.recordedWavBlobUrl = null;
    this.recordedDuration = 0;
    this.onRecordingReady = null;
    this.inputNode = null;
    this.destination = null;
    this.highpass = null;
    this.compressor = null;
    this.voiceGain = null;
    this.delayNode = null;
    this.delayGain = null;
    this.reverbDelay = null;
    this.reverbFeedback = null;
    this.reverbFilter = null;
    this.reverbGain = null;
    this.analyserNode = null;
    this.monitorGain = null;
    this.monitorVolume = 0.75;
    this.monitoringEnabled = false;
    this.isInitialized = false;
    this.recordingStartTimestamp = 0;
    this.recordingStartAudioTime = 0;
    this.beatStartTime = 0;
    this.recordingLatency = 0;
    this.recordingOffset = 0;
    this.mimeType = '';
  }

  setupMediaRecorder() {
    if (!this.stream) return;

    const options = {};
    this.mimeType = getSupportedRecorderMimeType();
    if (this.mimeType) options.mimeType = this.mimeType;
    options.audioBitsPerSecond = 192000;

    const recordStream = (this.destination && this.destination.stream.getAudioTracks().length)
      ? this.destination.stream
      : this.stream;

    try {
      this.mediaRecorder = new MediaRecorder(recordStream, options);
      this.mimeType = this.mediaRecorder.mimeType || this.mimeType || 'audio/mp4';
    } catch (error) {
      console.warn('MediaRecorder with options failed, using default:', error);
      try {
        this.mediaRecorder = new MediaRecorder(recordStream);
        this.mimeType = this.mediaRecorder.mimeType || 'audio/webm';
      } catch (fallbackError) {
        console.error('MediaRecorder unavailable:', fallbackError);
        throw fallbackError;
      }
    }

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    this.mediaRecorder.onstop = () => this.handleRecordingStop();
  }

  async handleRecordingStop() {
    try {
      const mimeType = this.mimeType || this.mediaRecorder?.mimeType || 'audio/webm';
      const blob = new Blob(this.audioChunks, { type: mimeType });

      if (!blob.size) {
        console.error('❌ Recording blob is empty');
        if (this.onRecordingReady) this.onRecordingReady(null);
        return;
      }

      // Save immediate blob + URL so UI can play instantly
      this.recordedBlob = blob;
      if (this.recordedBlobUrl) URL.revokeObjectURL(this.recordedBlobUrl);
      this.recordedBlobUrl = URL.createObjectURL(blob);
      this.recordedDuration = this.recordingStartTimestamp
        ? (Date.now() - this.recordingStartTimestamp) / 1000
        : 0;

      let playbackUrl = this.recordedBlobUrl;

      // Compute recording offset from the beat position at the time recording started.
      // beatStartTime is already a position inside the beat buffer, so do not mix it with audio context currentTime.
      this.recordingOffset = Math.max(0, (typeof this.beatStartTime === 'number' ? this.beatStartTime : 0) - this.recordingLatency);

      // Fire the ready callback immediately with the raw blob so the UI can play without waiting
      if (this.onRecordingReady) {
        try {
          this.onRecordingReady({
            blob: this.recordedBlob,
            url: this.recordedBlobUrl,
            playbackUrl: this.recordedBlobUrl,
            wavUrl: null,
            wavBlob: null,
            duration: this.recordedDuration,
            mimeType
          });
        } catch (cbErr) {
          console.warn('onRecordingReady immediate callback failed:', cbErr);
        }
      }

      // Continue heavy processing (decode + WAV conversion) in background and notify again when ready
      (async () => {
        try {
          this.recordedAudioBuffer = await this.decodeAudioData(blob);
          this.recordedWavBlob = audioBufferToWavBlob(this.recordedAudioBuffer);
          if (this.recordedWavBlobUrl) URL.revokeObjectURL(this.recordedWavBlobUrl);
          this.recordedWavBlobUrl = URL.createObjectURL(this.recordedWavBlob);
          playbackUrl = this.recordedWavBlobUrl;

          if (this.onRecordingReady) {
            try {
              this.onRecordingReady({
                blob: this.recordedBlob,
                url: this.recordedBlobUrl,
                playbackUrl: playbackUrl,
                wavUrl: this.recordedWavBlobUrl,
                wavBlob: this.recordedWavBlob,
                duration: this.recordedDuration,
                mimeType
              });
            } catch (cbErr2) {
              console.warn('onRecordingReady post-processing callback failed:', cbErr2);
            }
          }
        } catch (decodeError) {
          console.warn('WAV conversion failed, leaving raw blob for playback:', decodeError);
          this.recordedAudioBuffer = null;
          this.recordedWavBlob = null;
          this.recordedWavBlobUrl = null;
        }
      })();

      this.recordingOffset = Math.max(0, (typeof this.beatStartTime === 'number' ? this.beatStartTime : 0) - this.recordingLatency);
      console.log('✅ Recording saved', {
        size: blob.size,
        duration: this.recordedDuration,
        mimeType,
        hasWav: !!this.recordedWavBlobUrl,
        recordingOffset: this.recordingOffset
      });

      if (this.onRecordingReady) {
        this.onRecordingReady({
          blob: this.recordedBlob,
          url: this.recordedBlobUrl,
          wavUrl: this.recordedWavBlobUrl,
          wavBlob: this.recordedWavBlob,
          playbackUrl,
          duration: this.recordedDuration,
          mimeType
        });
      }
    } catch (error) {
      console.error('❌ Failed to process recording:', error);
      if (this.onRecordingReady) this.onRecordingReady(null);
    }
  }

  async acquireMicrophone() {
    const live = this.stream
      && this.stream.active
      && this.stream.getAudioTracks().some(track => track.readyState === 'live');
    if (live) return this.stream;

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    this.stream = await getUserMediaPolyfill(getMicConstraints());
    return this.stream;
  }

  async buildAudioGraph() {
    await this.audioEngine.initialize();
    const ctx = this.audioEngine.getContext();
    if (!ctx) throw new Error('AudioContext not available');

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    if (!this.stream) {
      await this.acquireMicrophone();
    }

    if (this.inputNode) {
      if (!this.mediaRecorder) this.setupMediaRecorder();
      return;
    }

    this.inputNode = ctx.createMediaStreamSource(this.stream);
      this.highpass = ctx.createBiquadFilter();
      this.highpass.type = 'highpass';
      this.highpass.frequency.value = 80;

      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -24;
      this.compressor.knee.value = 30;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.250;

      this.voiceGain = ctx.createGain();
      this.voiceGain.gain.value = 1.0;

      this.delayNode = ctx.createDelay(1.0);
      this.delayNode.delayTime.value = 0.12;
      this.delayGain = ctx.createGain();
      this.delayGain.gain.value = 0.05;

      this.reverbDelay = ctx.createDelay(2.5);
      this.reverbDelay.delayTime.value = 0.18;
      this.reverbFeedback = ctx.createGain();
      this.reverbFeedback.gain.value = 0.22;
      this.reverbFilter = ctx.createBiquadFilter();
      this.reverbFilter.type = 'lowpass';
      this.reverbFilter.frequency.value = 3000;
      this.reverbGain = ctx.createGain();
      this.reverbGain.gain.value = 0.18;

      this.destination = ctx.createMediaStreamDestination();

      this.inputNode.connect(this.highpass);
      this.highpass.connect(this.compressor);

      this.compressor.connect(this.voiceGain);
      this.voiceGain.connect(this.destination);

      this.compressor.connect(this.delayNode);
      this.delayNode.connect(this.delayGain);
      this.delayGain.connect(this.destination);

      this.compressor.connect(this.reverbDelay);
      this.reverbDelay.connect(this.reverbFilter);
      this.reverbFilter.connect(this.reverbFeedback);
      this.reverbFeedback.connect(this.reverbDelay);
      this.reverbFilter.connect(this.reverbGain);
      this.reverbGain.connect(this.destination);

      this.analyserNode = ctx.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.85;
      this.compressor.connect(this.analyserNode);

      // Monitoring casque — entendre sa voix en direct pendant l'enregistrement
      this.monitorGain = ctx.createGain();
      this.monitorGain.gain.value = 0;
      this.voiceGain.connect(this.monitorGain);
      this.monitorGain.connect(ctx.destination);

      this.setupMediaRecorder();
      this.recordingLatency = ctx.baseLatency || 0;
      console.log('✅ Vocal Recorder audio graph ready');
  }

  async initialize() {
    if (this.isInitialized && this.stream?.active) return;

    try {
      await this.acquireMicrophone();
      await this.buildAudioGraph();
      this.isInitialized = true;
      console.log('✅ Vocal Recorder initialized');
    } catch (error) {
      this.isInitialized = false;
      console.error('❌ Microphone access denied or unavailable:', error);
      throw error;
    }
  }

  async ensureReady() {
    if (this.stream && !this.stream.active) {
      this.isInitialized = false;
      this.inputNode = null;
      this.mediaRecorder = null;
    }
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  start() {
    if (!this.mediaRecorder) {
      this.setupMediaRecorder();
    }
    if (!this.mediaRecorder) {
      throw new Error('MediaRecorder not available');
    }
    if (this.mediaRecorder.state === 'recording') return;

    this.audioChunks = [];
    this.recordedAudioBuffer = null;
    this.recordedBlob = null;
    if (this.recordedBlobUrl) {
      URL.revokeObjectURL(this.recordedBlobUrl);
      this.recordedBlobUrl = null;
    }
    this.recordedWavBlob = null;
    if (this.recordedWavBlobUrl) {
      URL.revokeObjectURL(this.recordedWavBlobUrl);
      this.recordedWavBlobUrl = null;
    }

    if (isIOS()) {
      this.mediaRecorder.start();
    } else {
      this.mediaRecorder.start(250);
    }
    this.isRecording = true;
    this.recordingStartTimestamp = Date.now();
    this.recordingStartAudioTime = this.audioEngine.getContext().currentTime;
    console.log('🔴 Recording started');
  }

  stop() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      try {
        this.mediaRecorder.requestData();
      } catch (e) {
        console.warn('requestData failed:', e);
      }
      this.mediaRecorder.stop();
      this.isRecording = false;
      console.log('⏹️ Recording stopped');
    }
  }

  reset() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      try { this.mediaRecorder.requestData(); } catch (e) {}
      this.mediaRecorder.stop();
    }
    this.audioChunks = [];
    this.recordedAudioBuffer = null;
    this.recordedBlob = null;
    if (this.recordedBlobUrl) {
      URL.revokeObjectURL(this.recordedBlobUrl);
      this.recordedBlobUrl = null;
    }
    this.recordedWavBlob = null;
    if (this.recordedWavBlobUrl) {
      URL.revokeObjectURL(this.recordedWavBlobUrl);
      this.recordedWavBlobUrl = null;
    }
    this.isRecording = false;
    this.recordingStartTimestamp = 0;
    this.recordingStartAudioTime = 0;
    this.beatStartTime = 0;
    this.recordingLatency = 0;
    this.recordingOffset = 0;
    this.recordedDuration = 0;
    this.setupMediaRecorder();
  }

  async decodeAudioData(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const ctx = this.audioEngine.getContext();
    return await ctx.decodeAudioData(arrayBuffer);
  }

  getRecordedBuffer() {
    return this.recordedAudioBuffer;
  }

  getRecordedBlob() {
    return this.recordedBlob;
  }

  getRecordedBlobUrl() {
    return this.recordedWavBlobUrl || this.recordedBlobUrl;
  }

  getRecordedWavBlob() {
    return this.recordedWavBlob;
  }

  getRecordedDuration() {
    return this.recordedDuration;
  }

  getMicLevel() {
    if (!this.analyserNode) return 0;
    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(dataArray);
    const max = dataArray.reduce((acc, val) => Math.max(acc, val), 0);
    return max / 255;
  }

  setReverb(value) {
    if (this.reverbGain) {
      this.reverbGain.gain.value = Math.max(0, Math.min(1, value / 100));
    }
  }

  setDelay(value) {
    if (this.delayGain) {
      this.delayGain.gain.value = Math.max(0, Math.min(1, value / 100));
    }
  }

  setMicGain(value) {
    if (this.voiceGain) {
      this.voiceGain.gain.value = Math.max(0.25, Math.min(2, value / 100 * 1.5));
    }
  }

  setMonitorVolume(value) {
    this.monitorVolume = Math.max(0, Math.min(1, value / 100));
    if (this.monitorGain && this.monitoringEnabled) {
      this.monitorGain.gain.value = this.monitorVolume;
    }
  }

  setMonitoring(enabled) {
    this.monitoringEnabled = !!enabled;
    if (this.monitorGain) {
      this.monitorGain.gain.value = this.monitoringEnabled ? this.monitorVolume : 0;
    }
  }

  isMonitoring() {
    return this.monitoringEnabled;
  }

  setBeatStartTime(startTime) {
    this.beatStartTime = startTime;
  }

  getAlignmentOffset() {
    return this.recordingOffset || 0;
  }

  normalizeAudioBuffer(audioBuffer) {
    if (!audioBuffer) return audioBuffer;
    let peak = 0;
    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      const channelData = audioBuffer.getChannelData(ch);
      for (let i = 0; i < channelData.length; i += 32) {
        peak = Math.max(peak, Math.abs(channelData[i]));
      }
    }
    if (peak < 1e-4) return audioBuffer;
    const gain = 0.96 / peak;
    if (gain <= 1) return audioBuffer;

    const normalized = this.audioEngine.getContext().createBuffer(
      audioBuffer.numberOfChannels,
      audioBuffer.length,
      audioBuffer.sampleRate
    );

    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      const input = audioBuffer.getChannelData(ch);
      const output = normalized.getChannelData(ch);
      for (let i = 0; i < input.length; i++) {
        output[i] = Math.max(-1, Math.min(1, input[i] * gain));
      }
    }
    return normalized;
  }

  getAudioBufferPeak(audioBuffer) {
    if (!audioBuffer || !audioBuffer.numberOfChannels) return 1;
    let peak = 0;
    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      const channelData = audioBuffer.getChannelData(ch);
      for (let i = 0; i < channelData.length; i += 32) {
        peak = Math.max(peak, Math.abs(channelData[i]));
      }
    }
    return Math.max(peak, 0.001);
  }

  dispose() {
    this.isInitialized = false;
    this.inputNode = null;
    this.mediaRecorder = null;
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// 4. MIXER — Table de mixage avec effets
// ═══════════════════════════════════════════════════════════════════

class Mixer {
  constructor(audioEngine) {
    this.audioEngine = audioEngine;
    this.masterGain = null;
    this.vocalGain = null;
    this.beatGain = null;
    
    // Effects
    this.reverbNode = null;
    this.delayNode = null;
    this.eqNodes = [];
    
    // Don't initialize here - wait for AudioEngine to be ready
  }

  async initialize() {
    await this.initializeMixer();
  }

  async initializeMixer() {
    const ctx = this.audioEngine.getContext();
    if (!ctx) {
      console.error('❌ AudioContext not ready for Mixer');
      return;
    }
    
    // Create gain nodes
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.8;

    this.vocalGain = ctx.createGain();
    this.vocalGain.gain.value = 0.8;

    this.beatGain = ctx.createGain();
    this.beatGain.gain.value = 0.7;

    // Create effects
    this.createReverb();
    this.createDelay();
    this.createEQ();
  }

  createReverb() {
    const ctx = this.audioEngine.getContext();
    
    // Simple reverb using delay nodes (for production, use ConvolverNode)
    this.reverbNode = ctx.createGain();
    this.reverbNode.gain.value = 0;
  }

  createDelay() {
    const ctx = this.audioEngine.getContext();
    this.delayNode = ctx.createDelay(5);
    this.delayNode.delayTime.value = 0.5;
    this.delayNode.gain = ctx.createGain();
    this.delayNode.gain.gain.value = 0;
  }

  createEQ() {
    const ctx = this.audioEngine.getContext();
    const frequencies = [100, 1000, 10000]; // Bass, Mid, Treble

    this.eqNodes = frequencies.map(freq => {
      const filter = ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = freq;
      filter.gain.value = 0;
      filter.Q.value = 1;
      return filter;
    });
  }

  setVocalVolume(value) {
    if (this.vocalGain) {
      this.vocalGain.gain.value = Math.max(0, Math.min(1, value / 100));
    }
  }

  setBeatVolume(value) {
    if (this.beatGain) {
      this.beatGain.gain.value = Math.max(0, Math.min(1, value / 100));
    }
  }

  setReverb(value) {
    if (this.reverbNode) {
      this.reverbNode.gain.value = value / 100;
    }
  }

  setDelay(value) {
    if (this.delayNode && this.delayNode.gain) {
      this.delayNode.gain.gain.value = value / 100;
    }
  }

  setEQ(band, value) {
    if (this.eqNodes[band]) {
      this.eqNodes[band].gain.value = (value - 50) / 10; // -5 to +5 dB
    }
  }

  getMasterGain() {
    return this.masterGain;
  }

  getVocalGain() {
    return this.vocalGain;
  }

  getBeatGain() {
    return this.beatGain;
  }

  getEQNodes() {
    return this.eqNodes;
  }
}

// ═══════════════════════════════════════════════════════════════════
// 5. VISUALIZER — Analyseur de spectre en temps réel
// ═══════════════════════════════════════════════════════════════════

class Visualizer {
  constructor(canvasElement, analyserNode) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');
    this.analyserNode = analyserNode;
    this.animationId = null;
    this.dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
  }

  start() {
    const draw = () => {
      this.animationId = requestAnimationFrame(draw);

      this.analyserNode.getByteFrequencyData(this.dataArray);

      // Clear canvas
      this.ctx.fillStyle = 'rgba(10, 14, 39, 0.1)';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      // Draw bars
      const barWidth = (this.canvas.width / this.dataArray.length) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < this.dataArray.length; i++) {
        barHeight = (this.dataArray[i] / 255) * this.canvas.height;

        // Gradient
        const hue = (i / this.dataArray.length) * 360;
        this.ctx.fillStyle = `hsla(${hue}, 100%, 50%, 0.8)`;
        this.ctx.fillRect(x, this.canvas.height - barHeight, barWidth, barHeight);

        x += barWidth + 1;
      }
    };

    draw();
  }

  stop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// 6. STUDIO MANAGER — Orchestration complète
// ═══════════════════════════════════════════════════════════════════

class StudioManager {
  constructor() {
    this.engine = new AudioEngine();
    this.beatPlayer = new BeatPlayer(this.engine);
    this.vocalRecorder = new VocalRecorder(this.engine);
    this.mixer = new Mixer(this.engine);
    this.visualizer = null;

    this.recordingStartTime = 0;
    this.recordingDuration = 0;
    this.uiCallbacks = {};

    // Mix playback (beat + voix synchronisés)
    this.mixBeatSource = null;
    this.mixVocalSource = null;
    this.mixBeatGain = null;
    this.mixVocalGain = null;
    this.mixMasterGain = null;
    this.mixMasterCompressor = null;
    this.mixPlaying = false;
    
    // Initialization will be called explicitly by initStudio()
  }

  async initialize() {
    try {
      // Step 1: Initialize audio context first
      await this.engine.initialize();
      console.log('✅ Audio Engine initialized');

      // Step 2: Initialize mixer (needs audio context)
      await this.mixer.initialize();
      console.log('✅ Mixer initialized');

      // Step 3: Le micro sera initialisé au premier clic (geste utilisateur requis)
      console.log('✅ Studio Manager ready');
    } catch (error) {
      console.error('❌ Studio Manager initialization error:', error);
      throw error;
    }
  }

  registerUICallback(event, callback) {
    this.uiCallbacks[event] = callback;
  }

  triggerCallback(event, data = null) {
    if (this.uiCallbacks[event]) {
      this.uiCallbacks[event](data);
    }
  }

  // Beat Management
  async loadBeatFromURL(url, beatData = {}) {
    try {
      const fullUrl = new URL(url, window.location.href).href;
      const response = await fetch(fullUrl);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.engine.getContext().decodeAudioData(arrayBuffer);
      await this.beatPlayer.loadBeat(audioBuffer, beatData);
      this.triggerCallback('beatLoaded', beatData);
      console.log('✅ Beat loaded from URL:', fullUrl, beatData.name);
    } catch (error) {
      console.error('❌ Failed to load beat:', error, url);
      throw error;
    }
  }

  async loadBeat(audioBuffer, beatData = {}) {
    try {
      await this.beatPlayer.loadBeat(audioBuffer, beatData);
      this.triggerCallback('beatLoaded', beatData);
    } catch (error) {
      console.error('❌ Failed to load beat buffer:', error);
    }
  }

  playBeat(startAt = 0) {
    this.beatPlayer.play(startAt);
    this.triggerCallback('beatPlaying');
  }

  pauseBeat() {
    this.beatPlayer.pause();
    this.triggerCallback('beatPaused');
  }

  stopBeat() {
    this.beatPlayer.stop();
    this.triggerCallback('beatStopped');
  }

  setBeatVolume(value) {
    this.beatPlayer.setVolume(value);
    this.triggerCallback('beatVolumeChanged', value);
  }

  seekBeat(time) {
    this.beatPlayer.seek(time);
  }

  getBeatProgress() {
    const current = this.beatPlayer.getCurrentTime();
    const duration = this.beatPlayer.getDuration();
    return { current, duration, percentage: (current / duration) * 100 };
  }

  // Recording Management
  startRecording() {
    this.vocalRecorder.start();
    this.recordingStartTime = Date.now();
    this.vocalRecorder.setMonitoring(true);
    this.triggerCallback('recordingStarted');
  }

  stopRecording() {
    this.vocalRecorder.stop();
    this.vocalRecorder.setMonitoring(false);
    this.recordingDuration = Date.now() - this.recordingStartTime;
    this.triggerCallback('recordingStopped', { duration: this.recordingDuration });
  }

  onRecordingReady(callback) {
    this.vocalRecorder.onRecordingReady = (data) => {
      this.triggerCallback('recordingReady', data);
      if (callback) callback(data);
    };
  }

  getRecordingDuration() {
    if (this.vocalRecorder.isRecording) {
      return Date.now() - this.recordingStartTime;
    }
    return this.recordingDuration;
  }

  getMicLevel() {
    return this.vocalRecorder.getMicLevel();
  }

  // Mixer Management
  setVocalVolume(value) {
    this.mixer.setVocalVolume(value);
    this.vocalRecorder.setMonitorVolume(value);
  }

  setVocalMonitorVolume(value) {
    this.vocalRecorder.setMonitorVolume(value);
  }

  setBeatVolumeFromMixer(value) {
    this.mixer.setBeatVolume(value);
  }

  setReverb(value) {
    this.mixer.setReverb(value);
  }

  setDelay(value) {
    this.mixer.setDelay(value);
  }

  setEQ(band, value) {
    this.mixer.setEQ(band, value);
  }

  getAudioBufferPeak(audioBuffer) {
    if (!audioBuffer || !audioBuffer.numberOfChannels) return 1;
    let peak = 0;
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const data = audioBuffer.getChannelData(channel);
      for (let index = 0; index < data.length; index += 32) {
        peak = Math.max(peak, Math.abs(data[index]));
      }
    }
    return Math.max(peak, 0.001);
  }

  normalizeAudioBuffer(audioBuffer) {
    if (!audioBuffer) return audioBuffer;
    const peak = this.getAudioBufferPeak(audioBuffer);
    const gain = Math.min(1, 0.96 / peak);
    if (gain >= 1) return audioBuffer;

    const normalized = this.engine.getContext().createBuffer(
      audioBuffer.numberOfChannels,
      audioBuffer.length,
      audioBuffer.sampleRate
    );
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const input = audioBuffer.getChannelData(channel);
      const output = normalized.getChannelData(channel);
      for (let index = 0; index < input.length; index++) {
        output[index] = input[index] * gain;
      }
    }
    return normalized;
  }

  // ─── Mix Studio : beat + voix synchronisés ───
  async renderStudioMix(beatVol = 70, vocalVol = 80) {
    const vocalBuffer = this.vocalRecorder.getRecordedBuffer();
    if (!vocalBuffer) return null;

    const beatBuffer = this.beatPlayer.audioBuffer;
    if (!beatBuffer) {
      return audioBufferToWavBlob(vocalBuffer);
    }

    // Use vocal duration as the target length for the mix so short vocal takes precedence
    const sampleRate = Math.max(vocalBuffer.sampleRate || 44100, beatBuffer.sampleRate || 44100, 44100);
    const vocalDuration = vocalBuffer.duration || 0;
    let offsetSeconds = this.vocalRecorder.getAlignmentOffset ? this.vocalRecorder.getAlignmentOffset() : 0;
    if (beatBuffer && beatBuffer.duration > 0) {
      offsetSeconds = Math.max(0, offsetSeconds % beatBuffer.duration);
    }
    // Ensure we render at least the vocal length; include positive alignment offset if present
    const totalDuration = Math.max(vocalDuration, vocalDuration + Math.max(0, offsetSeconds));
    const length = Math.ceil(totalDuration * sampleRate);
    const offline = new OfflineAudioContext(2, length, sampleRate);

    const beatSource = offline.createBufferSource();
    beatSource.buffer = beatBuffer;
    const beatGain = offline.createGain();
    const actualBeatGain = Math.min(1, Math.max(0.45, (beatVol / 100) * 0.9));
    beatGain.gain.value = actualBeatGain;
    beatSource.connect(beatGain);
    beatGain.connect(offline.destination);
    if (offsetSeconds && offsetSeconds > 0 && offsetSeconds < beatBuffer.duration) {
      beatSource.start(0, offsetSeconds);
    } else {
      beatSource.start(0);
    }

    const vocalPeak = (typeof this.getAudioBufferPeak === 'function') ? this.getAudioBufferPeak(vocalBuffer) : 1;
    const vocalBoost = vocalPeak > 0 ? Math.min(1.25, 0.72 / vocalPeak) : 1;
    const actualVocalGain = Math.min(1.2, (vocalVol / 100) * vocalBoost);

    const vocalSource = offline.createBufferSource();
    vocalSource.buffer = vocalBuffer;
    const vocalGain = offline.createGain();
    vocalGain.gain.value = actualVocalGain;

    const vocalHighpass = offline.createBiquadFilter();
    vocalHighpass.type = 'highpass';
    vocalHighpass.frequency.value = 120;

    const vocalCompressor = offline.createDynamicsCompressor();
    vocalCompressor.threshold.value = -18;
    vocalCompressor.knee.value = 25;
    vocalCompressor.ratio.value = 3.8;
    vocalCompressor.attack.value = 0.005;
    vocalCompressor.release.value = 0.18;

    const masterGain = offline.createGain();
    masterGain.gain.value = 1.0;
    const masterCompressor = offline.createDynamicsCompressor();
    masterCompressor.threshold.value = -10;
    masterCompressor.knee.value = 20;
    masterCompressor.ratio.value = 3.2;
    masterCompressor.attack.value = 0.004;
    masterCompressor.release.value = 0.12;

    vocalSource.connect(vocalGain);
    vocalGain.connect(vocalHighpass);
    vocalHighpass.connect(vocalCompressor);
    vocalCompressor.connect(masterGain);

    beatSource.connect(masterGain);
    masterGain.connect(masterCompressor);
    masterCompressor.connect(offline.destination);

    // Place the vocal at the start of the rendered buffer
    vocalSource.start(0);

    const rendered = await offline.startRendering();
    const normalized = this.normalizeAudioBuffer(rendered);
    // If rendered buffer is longer than the vocal duration, truncate to vocalDuration
    try {
      const framesWanted = Math.floor((vocalDuration || 0) * sampleRate);
      if (framesWanted > 0 && normalized.length > framesWanted) {
        const truncated = this.engine.getContext().createBuffer(
          normalized.numberOfChannels,
          framesWanted,
          normalized.sampleRate
        );
        for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
          const src = rendered.getChannelData(ch);
          const dst = truncated.getChannelData(ch);
          dst.set(src.subarray(0, framesWanted));
        }
        return audioBufferToWavBlob(truncated);
      }
    } catch (e) {
      console.warn('Truncate rendered mix failed:', e);
    }

    return audioBufferToWavBlob(rendered);
  }

  async playStudioMix(beatVol = 70, vocalVol = 80) {
    await this.engine.initialize();
    const ctx = this.engine.getContext();
    if (ctx.state === 'suspended') await ctx.resume();

    const vocalBuffer = this.vocalRecorder.getRecordedBuffer();
    if (!vocalBuffer) return false;

    this.stopStudioMix();

    const beatBuffer = this.beatPlayer.audioBuffer;
    const startAt = ctx.currentTime + 0.08;

    this.mixBeatGain = ctx.createGain();
    this.mixVocalGain = ctx.createGain();
    this.mixMasterGain = ctx.createGain();
    this.mixMasterGain.gain.value = 0.95;
    this.mixMasterCompressor = ctx.createDynamicsCompressor();
    this.mixMasterCompressor.threshold.value = -10;
    this.mixMasterCompressor.knee.value = 18;
    this.mixMasterCompressor.ratio.value = 3.0;
    this.mixMasterCompressor.attack.value = 0.005;
    this.mixMasterCompressor.release.value = 0.12;

    const beatGainValue = Math.min(1, Math.max(0.5, (beatVol / 100) * 0.92));
    const vocalPeak = (typeof this.getAudioBufferPeak === 'function') ? this.getAudioBufferPeak(vocalBuffer) : 1;
    const vocalBoost = vocalPeak > 0 ? Math.min(1.2, 0.78 / vocalPeak) : 1;
    const vocalGainValue = Math.min(1.15, (vocalVol / 100) * vocalBoost);

    this.mixBeatGain.gain.value = beatGainValue;
    this.mixVocalGain.gain.value = vocalGainValue;

    let offsetSeconds = this.vocalRecorder.getAlignmentOffset ? this.vocalRecorder.getAlignmentOffset() : 0;
    if (beatBuffer && beatBuffer.duration > 0) {
      offsetSeconds = Math.min(Math.max(0, offsetSeconds), beatBuffer.duration - 0.01);
    }
    if (beatBuffer) {
      this.mixBeatSource = ctx.createBufferSource();
      this.mixBeatSource.buffer = beatBuffer;
      this.mixBeatSource.connect(this.mixBeatGain);
      this.mixBeatGain.connect(this.mixMasterGain);
      try {
        if (offsetSeconds && offsetSeconds > 0 && offsetSeconds < beatBuffer.duration) {
          this.mixBeatSource.start(startAt, offsetSeconds);
        } else {
          this.mixBeatSource.start(startAt, 0);
        }
      } catch(e) {
        console.warn('mixBeatSource.start with offset failed, falling back to 0:', e);
        try { this.mixBeatSource.start(startAt, 0); } catch(_) {}
      }
    }

    this.mixVocalSource = ctx.createBufferSource();
    this.mixVocalSource.buffer = vocalBuffer;
    this.mixVocalSource.connect(this.mixVocalGain);
    const vocalHighpass = ctx.createBiquadFilter();
    vocalHighpass.type = 'highpass';
    vocalHighpass.frequency.value = 120;

    const vocalCompressor = ctx.createDynamicsCompressor();
    vocalCompressor.threshold.value = -20;
    vocalCompressor.knee.value = 30;
    vocalCompressor.ratio.value = 3.5;
    vocalCompressor.attack.value = 0.005;
    vocalCompressor.release.value = 0.20;

    this.mixVocalGain.connect(vocalHighpass);
    vocalHighpass.connect(vocalCompressor);
    vocalCompressor.connect(this.mixMasterGain);
    this.mixMasterGain.connect(this.mixMasterCompressor);
    this.mixMasterCompressor.connect(ctx.destination);
    this.mixVocalSource.start(startAt, 0);

    const endHandler = () => this.stopStudioMix();
    if (this.mixBeatSource) this.mixBeatSource.onended = endHandler;
    this.mixVocalSource.onended = endHandler;

    this.mixPlaying = true;
    return true;
  }

  stopStudioMix() {
    try { if (this.mixBeatSource) this.mixBeatSource.stop(); } catch (e) {}
    try { if (this.mixVocalSource) this.mixVocalSource.stop(); } catch (e) {}
    this.mixBeatSource = null;
    this.mixVocalSource = null;
    this.mixBeatGain = null;
    this.mixVocalGain = null;
    this.mixPlaying = false;
  }

  isMixPlaying() {
    return this.mixPlaying;
  }

  updateMixVolumes(beatVol, vocalVol) {
    if (this.mixBeatGain) this.mixBeatGain.gain.value = Math.min(1, Math.max(0.5, (beatVol / 100) * 0.92));
    if (this.mixVocalGain) {
      const vocalPeak = this.vocalRecorder?.getRecordedBuffer ? this.getAudioBufferPeak(this.vocalRecorder.getRecordedBuffer()) : 1;
      const vocalBoost = vocalPeak > 0 ? Math.min(1.2, 0.78 / vocalPeak) : 1;
      this.mixVocalGain.gain.value = Math.min(1.15, (vocalVol / 100) * vocalBoost);
    }
  }

  hasBeatForMix() {
    return !!this.beatPlayer.audioBuffer;
  }

  // Export
  async exportRecording() {
    let vocalBuffer = this.vocalRecorder.getRecordedBuffer();
    const vocalBlob = this.vocalRecorder.getRecordedBlob();

    if (!vocalBuffer && vocalBlob) {
      try {
        vocalBuffer = await this.vocalRecorder.decodeAudioData(vocalBlob);
      } catch (error) {
        console.warn('Export decode fallback failed:', error);
      }
    }

    if (!vocalBuffer) {
      if (vocalBlob) return vocalBlob;
      console.error('❌ No recording to export');
      return null;
    }

    const offsetSeconds = this.vocalRecorder.getAlignmentOffset();
    if (offsetSeconds > 0 && offsetSeconds < vocalBuffer.duration) {
      console.log('🎚 Applying alignment offset to export:', offsetSeconds, 'seconds');
      vocalBuffer = this.trimAudioBuffer(vocalBuffer, offsetSeconds);
    }

    const offlineContext = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
      vocalBuffer.numberOfChannels,
      vocalBuffer.length,
      vocalBuffer.sampleRate
    );

    const source = offlineContext.createBufferSource();
    source.buffer = vocalBuffer;
    source.connect(offlineContext.destination);
    source.start(0);

    const renderedBuffer = await offlineContext.startRendering();
    return this.bufferToWave(renderedBuffer);
  }

  trimAudioBuffer(audioBuffer, startTime) {
    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.floor(startTime * sampleRate);
    const frameCount = Math.max(0, audioBuffer.length - startSample);
    if (frameCount <= 0) {
      return audioBuffer;
    }

    const trimmedBuffer = this.audioEngine.getContext().createBuffer(
      audioBuffer.numberOfChannels,
      frameCount,
      sampleRate
    );

    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const sourceData = audioBuffer.getChannelData(channel).subarray(startSample);
      trimmedBuffer.copyToChannel(sourceData, channel, 0);
    }

    return trimmedBuffer;
  }

  bufferToWave(audioBuffer) {
    return audioBufferToWavBlob(audioBuffer);
  }

  dispose() {
    this.stopStudioMix();
    this.beatPlayer.stop();
    this.vocalRecorder.dispose();
  }
}

// ═══════════════════════════════════════════════════════════════════
// 7. GLOBAL INSTANCE
// ═══════════════════════════════════════════════════════════════════

let studioManager = null;

async function initStudio() {
  studioManager = new StudioManager();
  // Wait for async initialization to complete
  await studioManager.initialize();
  return studioManager;
}

// Expose initStudio globally so the integration script can always find it.
const engineGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : null;
if (engineGlobal) {
  engineGlobal.initStudio = initStudio;
}

// Helper functions for UI integration
function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

console.log('✅ Studio Pro Audio Engine loaded');
window.isRecordingSupported = isRecordingSupported;
window.isMobileDevice = isMobileDevice;
window.isIOS = isIOS;
window.getUserMediaPolyfill = getUserMediaPolyfill;
window.getMicConstraints = getMicConstraints;
window.getSupportedRecorderMimeType = getSupportedRecorderMimeType;
