let fsRecordingStartBeat = 0;
// Firebase est déjà initialisé dans index.html

// ═══ SÉCURITÉ — Rate Limiting pour Connexion ═══
const loginAttempts = {};
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_ATTEMPT_RESET_MS = 15 * 60 * 1000; // 15 minutes

function isLoginRateLimited(identifier) {
  const key = `login_${identifier}`;
  const attempts = loginAttempts[key];
  if (!attempts) return false;
  if (Date.now() - attempts.firstAttempt > LOGIN_ATTEMPT_RESET_MS) {
    delete loginAttempts[key];
    return false;
  }
  return attempts.count >= MAX_LOGIN_ATTEMPTS;
}

function recordLoginAttempt(identifier) {
  const key = `login_${identifier}`;
  if (!loginAttempts[key]) {
    loginAttempts[key] = { count: 0, firstAttempt: Date.now() };
  }
  loginAttempts[key].count++;
  if (loginAttempts[key].count > MAX_LOGIN_ATTEMPTS) {
    loginAttempts[key].locked = true;
  }
}

function clearLoginAttempts(identifier) {
  const key = `login_${identifier}`;
  delete loginAttempts[key];
}

// ═══ SÉCURITÉ — Toggle Password Visibility ═══
function togglePasswordVisibility(fieldId) {
  const field = document.getElementById(fieldId);
  const toggleBtn = document.getElementById(fieldId + 'Toggle');
  if (!field) return;
  
  const isPassword = field.type === 'password';
  field.type = isPassword ? 'text' : 'password';
  
  // Changer l'icône
  if (toggleBtn) {
    toggleBtn.className = isPassword ? 'fas fa-eye-slash' : 'fas fa-eye';
  }
}

// Cloud Functions — région explicite (2nd gen, us-central1)
function cloudFunctions() {
  if (!window._cloudFns) {
    window._cloudFns = firebase.app().functions('us-central1');
  }
  return window._cloudFns;
}

// Attend que Firebase Auth soit prêt (évite "Connexion requise" si session pas encore restaurée)
function waitForAuthUser(timeoutMs = 10000) {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error('Connexion requise'));
    }, timeoutMs);
    const unsub = auth.onAuthStateChanged((user) => {
      if (user) {
        clearTimeout(timer);
        unsub();
        resolve(user);
      }
    });
  });
}

// Appel Cloud Function — SDK Firebase (auth auto) + repli fetch Bearer
async function callCloudFunction(name, data) {
  const user = await waitForAuthUser();
  await user.getIdToken(true);
  try {
    const fn = cloudFunctions().httpsCallable(name);
    return await fn(data || {});
  } catch (sdkErr) {
    console.warn(`Callable SDK ${name}:`, sdkErr.message);
    const token = await user.getIdToken();
    const url = `https://us-central1-je-suis-beatz.cloudfunctions.net/${name}`;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Firebase-Auth': token,
    };
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ data: data || {} }),
    });
    const text = await resp.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      const err = new Error(text || sdkErr.message || 'Erreur serveur');
      err.code = resp.status;
      throw err;
    }
    if (json.error) {
      const err = new Error(json.error.message || json.error.status || 'Erreur serveur');
      err.code = json.error.status || resp.status;
      throw err;
    }
    return { data: json.result };
  }
}

// Translate text using a Cloud Function 'translateText'.
// The Cloud Function should accept { text, target } and return { translated }
async function translateText(text, target = 'en') {
  if (!text || typeof text !== 'string') return null;
  try {
    const res = await callCloudFunction('translateText', { text, target });
    return res.data?.translated || null;
  } catch (e) {
    console.warn('translateText failed:', e && (e.message || e.code || e));
    return null;
  }
}

const OWNER_ADMIN_EMAIL = 'jesuisthebeatmaker@gmail.com';

function isOwnerEmail(email) {
  return (email || '').toLowerCase() === OWNER_ADMIN_EMAIL;
}

function isCurrentUserAdmin() {
  const firebaseEmail = auth.currentUser?.email || currentUser?.email || '';
  return (currentUser && currentUser.role === 'admin') || isOwnerEmail(firebaseEmail);
}

function getVerificationActionSettings() {
  return {
    url: window.location.origin + '/?mode=verifyEmail',
    handleCodeInApp: true
  };
}

function rememberLastPageBeforeLogin() {
  const currentPage = document.querySelector('.page.active');
  if (!currentPage) return;
  const name = currentPage.id?.replace('page-', '');
  if (!name || name === 'login') return;
  localStorage.setItem('jsb_last_page_before_login', name);
}

const GENIUSPAY_CONFIG = {
  baseURL: 'https://geniuspay.ci',
  publicKey: 'pk_live_xUKpaVadschoOZPS5F7jcKUAdmiNZZh9',
  apiKey: 'pk_live_xUKpaVadschoOZPS5F7jcKUAdmiNZZh9',
  environment: 'production',
  // URL publique de vos Cloud Functions (projet fourni)
  // Utiliser l'URL Run fournie par le déploiement (fonctions 2nd gen)
  cloudFunctionURL: 'https://creategeniuspayment-qyfkwosfca-uc.a.run.app',
  // URL de callback pour redirection après paiement
  successURL: window.location.origin + '/?payment_status=success',
  failureURL: window.location.origin + '/?payment_status=failure'
};

// ═══ DEVISES — taux mid-market (1 USD = 566,677 XOF → 300 $ = 170 003,10 FCFA)
const CURRENCY_RATES = {
  USD: { symbol: '$', rate: 1, flag: '🇺🇸', label: 'USD', decimals: 0 },
  EUR: { symbol: '€', rate: 0.8578, flag: '🇪🇺', label: 'EUR', decimals: 2 },
  XOF: { symbol: 'FCFA', rate: 566.677, flag: '🇨🇮', label: 'XOF', decimals: 2 },
  GNF: { symbol: 'GNF', rate: 8640, flag: '🇬🇳', label: 'GNF', decimals: 0 },
  GHS: { symbol: '₵', rate: 15.5, flag: '🇬🇭', label: 'GHS', decimals: 2 },
  NGN: { symbol: '₦', rate: 1580, flag: '🇳🇬', label: 'NGN', decimals: 2 }
};

const CURRENCY_RATE_FEED_URL = 'https://open.er-api.com/v6/latest/USD';
let previousCurrencyRates = {};
let currencyRateChange = {};

function getRateChangeClass(code) {
  const change = currencyRateChange[code];
  if (change > 0) return 'color: #4ade80;';
  if (change < 0) return 'color: #f87171;';
  return 'color: var(--text-dim);';
}

function getRateChangeLabel(code) {
  const change = currencyRateChange[code];
  if (change > 0) return ` <span style="color:#4ade80">▲ ${change.toFixed(3)}</span>`;
  if (change < 0) return ` <span style="color:#f87171">▼ ${Math.abs(change).toFixed(3)}</span>`;
  return '';
}

function updateCurrencyRates(newRates) {
  if (!newRates || typeof newRates !== 'object') return;
  Object.keys(newRates).forEach(code => {
    if (!CURRENCY_RATES[code]) return;
    const newRate = Number(newRates[code]);
    if (Number.isNaN(newRate)) return;
    previousCurrencyRates[code] = CURRENCY_RATES[code].rate;
    currencyRateChange[code] = newRate - CURRENCY_RATES[code].rate;
    CURRENCY_RATES[code].rate = newRate;
  });
  updateCurrencyDisplays();
}

async function fetchCurrencyRates() {
  try {
    const response = await fetch(CURRENCY_RATE_FEED_URL, { cache: 'no-store' });
    if (!response.ok) return;
    const json = await response.json();
    if (json && json.rates) {
      const rates = {
        XOF: json.rates.XOF,
        EUR: json.rates.EUR,
        GNF: json.rates.GNF,
        GHS: json.rates.GHS,
        NGN: json.rates.NGN
      };
      updateCurrencyRates(rates);
    }
  } catch (e) {
    console.warn('Currency rate refresh failed:', e.message || e);
  }
}

function startCurrencyRatePolling(intervalMs = 10000) {
  fetchCurrencyRates();
  setInterval(fetchCurrencyRates, intervalMs);
}

function updateCurrencyDisplays() {
  window._selectedPayCurrency = window._selectedPayCurrency || 'USD';
  window.currentLicenseCurrency = window.currentLicenseCurrency || 'USD';

  const cartTotVal = document.getElementById('cartTotVal');
  if (cartTotVal) {
    const total = cartTotalUsd();
    cartTotVal.textContent = '$' + total + ' · ' + formatUsdAsCurrency(total, 'XOF');
    cartTotVal.style.cssText = getRateChangeClass('XOF');
  }

  if (document.getElementById('paySummaryInner') && typeof window.buildSummaryHTML === 'function') {
    const currency = window._selectedPayCurrency || 'USD';
    document.getElementById('paySummaryInner').innerHTML = window.buildSummaryHTML(currency);
  }

  if (document.getElementById('licCardsWrap')) {
    document.getElementById('licCardsWrap').innerHTML = renderLicCards(window.currentLicenseCurrency);
  }

  const cartModal = document.getElementById('cartModal');
  if (cartModal && cartModal.classList.contains('show')) {
    renderCartItems();
  }
}

function initCurrencyRateUpdater() {
  startCurrencyRatePolling(10000);
}

function convertUsdPrice(usd, currencyCode) {
  const c = CURRENCY_RATES[currencyCode];
  if (!c || usd == null) return usd;
  const amount = usd * c.rate;
  const decimals = c.decimals ?? 2;
  const factor = Math.pow(10, decimals);
  return Math.round(amount * factor) / factor;
}

function convertUsdToXofPayment(usd) {
  // GeniusPay : montant XOF entier (arrondi depuis le taux exact)
  return Math.round(convertUsdPrice(usd, 'XOF'));
}

function formatUsdAsCurrency(usd, currencyCode) {
  const amount = convertUsdPrice(usd, currencyCode);
  const c = CURRENCY_RATES[currencyCode];
  if (!c) return '$' + usd;
  if (currencyCode === 'XOF' || currencyCode === 'GNF' || currencyCode === 'NGN') {
    return amount.toLocaleString('fr-FR', {
      minimumFractionDigits: c.decimals,
      maximumFractionDigits: c.decimals
    }) + ' ' + c.symbol;
  }
  if (currencyCode === 'USD') return c.symbol + amount;
  return c.symbol + amount.toFixed(c.decimals ?? 2);
}

function cartTotalUsd() {
  return cart.reduce((s, c) => s + c.price, 0);
}

// ═══ DATA ═══
const DEFAULT_BEAT_COVER = 'image_beat.jpeg';

// Fallback catalog with essential beats for testing/demo
const INITIAL_CATALOG_BEATS = [
  {
    id: 'beat-ghost-demo',
    title: 'GHOST',
    bpm: 142,
    genre: 'Drill',
    key: 'F#',
    cover: 'image_beat.jpeg',
    audio: 'https://audioproxy-qyfkwosfca-uc.a.run.app?u=https%3A%2F%2Ffirebasestorage.googleapis.com%2Fv0%2Fb%2Fje-suis-beatz.firebasestorage.app%2Fo%2Fbeats%252Fghost-1782937879009.mpeg%3Falt%3Dmedia%26token%3D286fb8c5-d929-4532-ac95-431082438d3d',
    desc: 'Premium drill beat with African influences',
    desc_en: 'Premium drill beat with African influences',
    price: 25,
    createdAt: { seconds: Math.floor(Date.now() / 1000) }
  }
];

function normalizeBeatAsset(path) {
  if (!path || typeof path !== 'string') return '';
  let asset = path.trim();
  // Ne pas réécrire .mpeg → .mp3 dans les URLs Storage (le fichier reste .mpeg)
  if (!/^https?:\/\//i.test(asset) && /\.mpeg$/i.test(asset)) {
    asset = asset.replace(/\.mpeg$/i, '.mp3');
  }
  if (/^gs:\/\//i.test(asset)) {
    const match = asset.match(/^gs:\/\/(.+?)\/(.+)$/i);
    if (match) {
      const bucket = match[1];
      const filePath = match[2];
      return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(filePath)}?alt=media`;
    }
  }
  if (/^https?:\/\//i.test(asset)) return asset;
  if (/^\/\//.test(asset)) return window.location.protocol + asset;
  if (/^(storage\.googleapis\.com|firebasestorage\.googleapis\.com)\//i.test(asset)) {
    return 'https://' + asset;
  }
  return asset.replace(/^\.\//, '');
}

function normalizeForbiddenBeatTitle(title) {
  return String(title || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '');
}

function isForbiddenBeat(beat) {
  const title = normalizeForbiddenBeatTitle(beat?.title);
  return title === 'ife';
}

function resolveBeatAudioSource(beat) {
  if (!beat || typeof beat !== 'object') return '';
  const fallbackKeys = ['audio', 'audioFile', 'audioUrl', 'audio_url', 'audio_file', 'url', 'fileUrl', 'file_url', 'source'];
  for (const key of fallbackKeys) {
    const value = beat[key];
    if (value && typeof value === 'string' && value.trim()) {
      let source = value.trim();
      if (source.startsWith('//')) source = window.location.protocol + source;
      if (/^gs:\/\//i.test(source)) return normalizeBeatAsset(source);
      if (/^(storage\.googleapis\.com|firebasestorage\.googleapis\.com)\//i.test(source)) {
        return 'https://' + source;
      }
      return source;
    }
  }
  return '';
}

function resolveBeatPlaybackURL(source) {
  if (!source || typeof source !== 'string') return '';
  let url = source.trim();
  if (/^gs:\/\//i.test(url)) return normalizeBeatAsset(url);
  if (/^\/\//.test(url)) url = window.location.protocol + url;
  if (/^(storage\.googleapis\.com|firebasestorage\.googleapis\.com)\//i.test(url)) {
    url = 'https://' + url.replace(/^\/+/, '');
  }
  if (/^https?:\/\//i.test(url)) return url;
  if (typeof resolveBeatURL === 'function') {
    try {
      const resolved = resolveBeatURL(url);
      if (resolved) return resolved;
    } catch (err) {
      console.warn('resolveBeatURL failed:', err);
    }
  }
  try {
    return new URL(url, window.location.href).href;
  } catch (err) {
    console.warn('resolveBeatPlaybackURL invalid URL:', err, url);
    return url;
  }
}

function resolveFsBeatURL(source) {
  return resolveBeatPlaybackURL(source);
}

function resolveFsBeatProxyURL(source) {
  const direct = resolveBeatPlaybackURL(source);
  if (!direct) return '';
  const isStorage = /firebasestorage\.googleapis\.com|storage\.googleapis\.com/i.test(direct);
  // Prefer a local proxy when developing locally (localhost / 127.0.0.1)
  const devHost = (window && window.location && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'));
  const localProxy = (window && window.__JSB_PROXY) ? window.__JSB_PROXY : (devHost ? 'http://localhost:8080/' : null);
  if (isStorage) {
    if (localProxy) return `${localProxy}?u=${encodeURIComponent(direct)}`;
    return `https://audioproxy-qyfkwosfca-uc.a.run.app?u=${encodeURIComponent(direct)}`;
  }
  return direct;
}

async function fetchAudioBufferForBeatUrl(url) {
  if (!url || !studioInstance || !studioInstance.engine || typeof studioInstance.engine.getContext !== 'function') return null;
  const fetchWithRetries = async (u, attempts = 2, delayMs = 500) => {
    let lastErr = null;
    for (let i = 0; i < attempts; i++) {
      try {
        const resp = await fetch(u, { mode: 'cors', cache: 'no-store' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp;
      } catch (e) {
        lastErr = e;
        await new Promise(r => setTimeout(r, delayMs * (i + 1)));
      }
    }
    throw lastErr;
  };

  try {
    const response = await fetchWithRetries(url, 2, 500);
    const arrayBuffer = await response.arrayBuffer();
    const ctx = studioInstance.engine.getContext();
    return await ctx.decodeAudioData(arrayBuffer);
  } catch (error) {
    console.warn('fetchAudioBufferForBeatUrl failed:', error, url);
    return null;
  }
}

function audioSrcMatches(audioEl, targetUrl) {
  if (!audioEl?.src || !targetUrl) return false;
  try {
    return audioEl.src === new URL(targetUrl, window.location.href).href;
  } catch {
    return audioEl.src === targetUrl;
  }
}

function normalizeBeatRecord(beat) {
  const b = { ...beat };
  const audioSource = resolveBeatAudioSource(b);
  if (audioSource) b.audio = normalizeBeatAsset(audioSource);
  if (b.cover) b.cover = normalizeBeatAsset(b.cover);
  if (!b.priceBasic && b.priceBasic !== 0) b.priceBasic = 25;
  if (!b.pricePremium && b.pricePremium !== 0) b.pricePremium = 50;
  if (!b.priceWav && b.priceWav !== 0) b.priceWav = 100;
  if (!b.priceUnlimited && b.priceUnlimited !== 0) b.priceUnlimited = 150;
  if (!b.priceExclusive && b.priceExclusive !== 0) b.priceExclusive = 499;
  if (!b.status) b.status = 'available';
  return b;
}

function mergeInitialCatalogBeats(list) {
  const merged = (Array.isArray(list) ? list : []).map(normalizeBeatRecord);
  for (const seed of INITIAL_CATALOG_BEATS) {
    const idx = merged.findIndex(b => (b.title || '').toUpperCase() === seed.title.toUpperCase());
    if (idx === -1) {
      merged.unshift(normalizeBeatRecord({ id: `catalog-${seed.title.toLowerCase()}`, ...seed }));
    } else {
      merged[idx] = normalizeBeatRecord({
        ...seed,
        ...merged[idx],
        cover: merged[idx].cover || seed.cover,
        audio: merged[idx].audio || seed.audio,
        desc_fr: merged[idx].desc_fr || seed.desc_fr,
        desc_en: merged[idx].desc_en || seed.desc_en,
        priceBasic: merged[idx].priceBasic ?? seed.priceBasic,
        pricePremium: merged[idx].pricePremium ?? seed.pricePremium,
        priceWav: merged[idx].priceWav ?? seed.priceWav,
        priceUnlimited: merged[idx].priceUnlimited ?? seed.priceUnlimited,
        priceExclusive: merged[idx].priceExclusive ?? seed.priceExclusive,
        status: merged[idx].status || seed.status,
      });
    }
  }
  return merged;
}

function getBeatTimestamp(beat) {
  const created = Number(beat?.createdAt?.seconds ?? beat?.createdAt?._seconds ?? 0);
  const updated = Number(beat?.updatedAt?.seconds ?? beat?.updatedAt?._seconds ?? 0);
  return Math.max(created, updated);
}

function sortBeatsNewestFirst(list) {
  return [...list].sort((a, b) => getBeatTimestamp(b) - getBeatTimestamp(a));
}

function normalizeBeatTitle(title) {
  return String(title || '').trim().toUpperCase();
}

function validateAdminBeatPayload(beat) {
  if (!beat || typeof beat !== 'object') return 'Beat invalide';
  const title = normalizeBeatTitle(beat.title);
  if (!title || title.length > 100) return 'Titre invalide';
  const bpm = Number(beat.bpm);
  if (!Number.isInteger(bpm) || bpm < 1 || bpm > 300) return 'BPM invalide';
  const prices = ['priceBasic', 'pricePremium', 'priceWav', 'priceUnlimited', 'priceExclusive'];
  for (const key of prices) {
    if (beat[key] != null) {
      const value = Number(beat[key]);
      if (!Number.isFinite(value) || value < 0 || value > 100000) return `Prix ${key} invalide`;
    }
  }
  if (beat.cover && typeof beat.cover !== 'string') return 'Cover invalide';
  if (beat.audio && typeof beat.audio !== 'string') return 'Audio invalide';
  return null;
}

function dedupeBeatsByTitle(list) {
  const unique = new Map();
  for (const beat of Array.isArray(list) ? list : []) {
    const key = normalizeBeatTitle(beat?.title) || String(beat?.id || '');
    const existing = unique.get(key);
    if (!existing || getBeatTimestamp(beat) > getBeatTimestamp(existing)) {
      unique.set(key, beat);
    }
  }
  return Array.from(unique.values());
}

async function cleanupDuplicateBeats(list) {
  if (!Array.isArray(list) || list.length < 2) return;
  const groups = new Map();
  for (const beat of list) {
    const title = normalizeBeatTitle(beat?.title);
    if (!title) continue;
    const existing = groups.get(title);
    if (!existing || getBeatTimestamp(beat) > getBeatTimestamp(existing)) {
      groups.set(title, beat);
    }
  }
  const duplicates = [];
  for (const beat of list) {
    const title = normalizeBeatTitle(beat?.title);
    if (!title) continue;
    const winner = groups.get(title);
    if (winner && winner.id !== beat.id) {
      duplicates.push(beat.id);
    }
  }
  if (!duplicates.length) return;
  if (!currentUser || currentUser.role !== 'admin') return;
  try {
    if (!(await ensureAdminAuth())) return;
    for (const docId of duplicates) {
      await db.collection('beats').doc(String(docId)).delete();
    }
    console.log('cleanupDuplicateBeats removed duplicate beat docs:', duplicates);
  } catch (e) {
    console.warn('cleanupDuplicateBeats failed:', e.message || e);
  }
}

let beats = [];
let lastSuccessfulBeats = [];
let users = [];
let adminPageInitialized = false;
let adminUserStatsLoaded = false;

function isValidCartItem(item) {
  return item && typeof item === 'object'
    && item.id != null
    && typeof item.title === 'string'
    && item.title.trim().length > 0
    && typeof item.price === 'number'
    && item.price >= 0
    && String(item.title).trim().toUpperCase() !== 'TRAP';
}

function normalizeCartItem(item) {
  return {
    id: String(item.id),
    title: String(item.title || '').trim(),
    price: Number(item.price) || 0,
    cover: String(item.cover || ''),
    license: String(item.license || 'Basic'),
  };
}

function sanitizeCartItems(items) {
  if (!Array.isArray(items)) return [];
  const clean = items.filter(isValidCartItem).map(normalizeCartItem);
  localStorage.setItem('jsb_cart2', JSON.stringify(clean));
  return clean;
}

// Panier : on garde une copie locale pour l'UX temps réel, mais on sync avec Firestore
let cart = sanitizeCartItems(JSON.parse(localStorage.getItem('jsb_cart2') || '[]'));
let currentUser = JSON.parse(sessionStorage.getItem('jsb_user2') || 'null');
// ⚠️ Le mot de passe admin n'est PLUS stocké en localStorage.
// L'admin se connecte uniquement via Firebase Auth + custom claim "admin:true".
// Pour définir le claim admin, utilise Firebase Admin SDK côté serveur (Cloud Function).
let currentFilter = 'Tous';
// Global audio element used for playback — expose it on `window` so other scripts/devtools can access it.
let audioEl = new Audio();
window.audioEl = audioEl;
audioEl.id = 'jsbAudio';
audioEl.setAttribute('playsinline', '');
audioEl.setAttribute('webkit-playsinline', '');
audioEl.preload = 'auto';
// Ensure CORS header handling when served via proxy/storage
try { audioEl.crossOrigin = 'anonymous'; audioEl.setAttribute('crossorigin','anonymous'); } catch(e) {}
// Attach hidden audio element to DOM so network requests are visible in DevTools and element persists
try {
  if (!document.getElementById('jsbAudio')) {
    audioEl.style.display = 'none';
    document.body.appendChild(audioEl);
  }
} catch(e) {}
let isPlaying = false;
let currentIdx = -1;
 
// ═══ FIRESTORE HELPERS ═══

async function seedInitialCatalogIfEmpty() {
  for (const beat of INITIAL_CATALOG_BEATS) {
    await db.collection('beats').add({
      ...normalizeBeatRecord(beat),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  }
}

let beatsSnapshotUnsubscribe = null;

function applyBeatsFromFirestoreDocs(docs) {
  const allBeats = docs.map(d => normalizeBeatRecord({
    id: d.id,
    ...(typeof d.data === 'function' ? d.data() : d.data),
  }));
  const rawBeats = allBeats.filter(b => !isTrapBeat(b) && !isForbiddenBeat(b));
  beats = sortBeatsNewestFirst(rawBeats);
  if (beats.length) lastSuccessfulBeats = beats.slice();
  renderAll();
  const statEl = document.getElementById('statBeats');
  if (statEl) statEl.textContent = beats.length;
}

function subscribeBeatsFromFirestore() {
  if (beatsSnapshotUnsubscribe) {
    beatsSnapshotUnsubscribe();
    beatsSnapshotUnsubscribe = null;
  }
  beatsSnapshotUnsubscribe = db.collection('beats').onSnapshot(
    (snap) => applyBeatsFromFirestoreDocs(snap.docs),
    (err) => {
      console.warn('beats snapshot error, fallback to last cache/server load', err);
      if (lastSuccessfulBeats.length) {
        beats = lastSuccessfulBeats.slice();
        renderAll();
      } else {
        loadBeatsFromFirestore().catch(e => console.warn('loadBeatsFromFirestore fallback:', e));
      }
    }
  );
}

// Charger les beats depuis Firestore (catalogue réel uniquement)
async function loadBeatsFromFirestore() {
  try {
    let snap;
    try {
      snap = await db.collection('beats').get({ source: 'server' });
    } catch (serverErr) {
      console.warn('Server beats fetch failed, using default source', serverErr);
      snap = await db.collection('beats').get();
    }
    applyBeatsFromFirestoreDocs(snap.docs);
  } catch (e) {
    console.warn('Firestore beats indisponible, conservation du dernier catalogue connu', e);
    beats = lastSuccessfulBeats.length ? lastSuccessfulBeats.slice() : [];
    renderAll();
    const statEl = document.getElementById('statBeats');
    if (statEl) statEl.textContent = beats.length;
  }
}
 
// Helper: retourne la description du beat dans la langue courante
function getBeatDesc(b) {
  if (currentLang === 'en' && b.desc_en) return b.desc_en;
  if (b.desc_fr) return b.desc_fr;
  return b.desc || '';
}
 
// Vérifie la session Firebase avant toute action admin
async function ensureAdminAuth() {
  let user;
  try {
    user = await waitForAuthUser();
    await user.getIdToken(true);
  } catch {
    showToast('⚠ ' + (currentLang === 'en' ? 'Please log in first' : 'Connectez-vous d\'abord'));
    return false;
  }

  if (isOwnerEmail(user.email)) {
    if (currentUser) {
      currentUser.role = 'admin';
      currentUser.email = user.email;
      sessionStorage.setItem('jsb_user2', JSON.stringify(currentUser));
      updateAuth();
    }
    try {
      const result = await callCloudFunction('ensureAdminClaim');
      if (result?.data?.claimUpdated) {
        await user.getIdToken(true);
      }
    } catch (e) {
      console.warn('ensureAdminClaim owner email:', e.message || e);
    }
    return true;
  }

  try {
    const adminDoc = await db.collection('admins').doc(user.uid).get();
    if (adminDoc.exists) {
      const adminData = adminDoc.data();
      if (adminData.isAdmin === true || adminData.admin === true) {
        if (adminData.admin === true && adminData.isAdmin !== true) {
          await db.collection('admins').doc(user.uid).set({ isAdmin: true }, { merge: true });
        }
        if (currentUser) {
          currentUser.role = 'admin';
          sessionStorage.setItem('jsb_user2', JSON.stringify(currentUser));
          updateAuth();
        }
        return true;
      }
    }
  } catch (e) { /* ignore */ }

  try {
    const userDoc = await db.collection('users').doc(user.uid).get();
    if (userDoc.exists && userDoc.data().role === 'admin') {
      if (currentUser) {
        currentUser.role = 'admin';
        sessionStorage.setItem('jsb_user2', JSON.stringify(currentUser));
        updateAuth();
      }
      return true;
    }
  } catch (e) { /* ignore */ }

  try {
    const result = await callCloudFunction('ensureAdminClaim');
    if (result.data?.isAdmin) {
      if (result.data?.claimUpdated) {
        await user.getIdToken(true);
      }
      if (currentUser) {
        currentUser.role = 'admin';
        sessionStorage.setItem('jsb_user2', JSON.stringify(currentUser));
        updateAuth();
      }
      return true;
    }
  } catch (e) {
    console.warn('ensureAdminClaim:', e.message);
  }

  showToast('⚠ ' + (currentLang === 'en' ? 'Admin access denied' : 'Accès admin refusé'));
  return false;
}

// Sauvegarder un beat (ajout ou mise à jour)
async function saveBeatToFirestore(beatData, docId) {
  if (!(await ensureAdminAuth())) return null;
  const title = normalizeBeatTitle(beatData.title);
  const payload = normalizeBeatRecord({ ...beatData, title });
  delete payload.id;

  const validationError = validateAdminBeatPayload(payload);
  if (validationError) {
    showToast('⚠ ' + validationError);
    return null;
  }

  const serverTs = firebase.firestore.FieldValue.serverTimestamp();

  try {
    if (docId && !String(docId).startsWith('catalog-')) {
      const docRef = db.collection('beats').doc(String(docId));
      const existing = await docRef.get();
      const patch = { ...payload, updatedAt: serverTs };
      if (!existing.exists || !existing.data()?.createdAt) {
        patch.createdAt = serverTs;
      }
      await docRef.set(patch, { merge: true });
      return String(docId);
    }

    const ref = await db.collection('beats').add({
      ...payload,
      createdAt: serverTs,
      updatedAt: serverTs,
    });
    return ref.id;
  } catch (directErr) {
    console.warn('Firestore direct indisponible, repli Cloud Function:', directErr.message);
  }
  try {
    const result = await callCloudFunction('adminSaveBeat', {
      beat: payload,
      beatId: (docId && !String(docId).startsWith('catalog-')) ? String(docId) : null,
    });
    if (result.data?.id) return result.data.id;
  } catch (cloudErr) {
    console.error('Erreur save beat', cloudErr);
    showToast('⚠ Erreur de sauvegarde : ' + (cloudErr.message || cloudErr.code || 'permission refusée'));
  }
  return null;
}

function isCatalogOnlyId(id) {
  return String(id).startsWith('catalog-');
}

// ═══ ADMIN — TÉLÉVERSEMENT BEATS (Firebase Storage) ═══
const ADMIN_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ADMIN_AUDIO_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/m4a', 'audio/flac', 'audio/ogg'];
let pendingCoverFile = null;
let pendingAudioFile = null;
let trapBeatsPurged = false;

function slugifyBeatTitle(title) {
  return String(title).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'beat';
}

function setUploadProgress(pct, label) {
  const wrap = document.getElementById('uploadProgressWrap');
  const fill = document.getElementById('uploadProgressFill');
  const lbl = document.getElementById('uploadProgressLbl');
  if (wrap) wrap.style.display = pct > 0 && pct < 100 ? 'flex' : (pct >= 100 ? 'flex' : 'none');
  if (fill) fill.style.width = pct + '%';
  if (lbl) lbl.textContent = label || (Math.round(pct) + '%');
}

function resolveStorageContentType(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (file.type && file.type.startsWith('image/')) return file.type;
  if (file.type && file.type.startsWith('audio/')) return file.type;
  const audioMap = { mp3: 'audio/mpeg', mpeg: 'audio/mpeg', mpga: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'audio/mp4', flac: 'audio/flac', ogg: 'audio/ogg' };
  const imageMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
  if (audioMap[ext]) return audioMap[ext];
  if (imageMap[ext]) return imageMap[ext];
  if (file.type === 'video/mpeg') return 'audio/mpeg';
  return file.type || 'application/octet-stream';
}

async function uploadFileToStorage(file, path) {
  const contentType = resolveStorageContentType(file);
  // Upload direct Storage (règles admin par email)
  try {
    const user = await waitForAuthUser();
    await user.getIdToken(true);
    const url = await new Promise((resolve, reject) => {
      const ref = firebase.storage().ref(path);
      const task = ref.put(file, { contentType });
      task.on('state_changed',
        (snap) => setUploadProgress((snap.bytesTransferred / snap.totalBytes) * 100),
        reject,
        async () => {
          try { resolve(await ref.getDownloadURL()); }
          catch (e) { reject(e); }
        }
      );
    });
    setUploadProgress(100, '✓');
    return url;
  } catch (directErr) {
    console.warn('Upload direct indisponible, repli URL signée:', directErr.message);
  }
  try {
    const res = await callCloudFunction('getBeatUploadUrl', { path, contentType });
    const { uploadUrl, downloadUrl } = res.data;
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: file,
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    setUploadProgress(100, '✓');
    return downloadUrl;
  } catch (signedErr) {
    throw signedErr;
  }
}

function onCoverFileSelected(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (!ADMIN_IMAGE_TYPES.includes(file.type)) {
    showToast('⚠ ' + (currentLang === 'en' ? 'Invalid image format' : 'Format image invalide'));
    input.value = '';
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('⚠ ' + (currentLang === 'en' ? 'Image max 10 MB' : 'Image max 10 Mo'));
    input.value = '';
    return;
  }
  pendingCoverFile = file;
  const zone = document.getElementById('coverDropZone');
  const label = document.getElementById('coverFileLabel');
  const preview = document.getElementById('coverPreview');
  if (zone) zone.classList.add('has-file');
  if (label) label.textContent = file.name;
  if (preview) {
    preview.src = URL.createObjectURL(file);
    preview.style.display = 'block';
  }
}

function onAudioFileSelected(input) {
  const file = input.files?.[0];
  if (!file) return;
  const okType = ADMIN_AUDIO_TYPES.includes(file.type)
    || file.type === 'video/mpeg'
    || /\.(mp3|wav|mpeg|m4a|flac|ogg)$/i.test(file.name);
  if (!okType) {
    showToast('⚠ ' + (currentLang === 'en' ? 'Invalid audio format' : 'Format audio invalide'));
    input.value = '';
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    showToast('⚠ ' + (currentLang === 'en' ? 'Audio max 50 MB' : 'Audio max 50 Mo'));
    input.value = '';
    return;
  }
  pendingAudioFile = file;
  const zone = document.getElementById('audioDropZone');
  const label = document.getElementById('audioFileLabel');
  const preview = document.getElementById('audioPreview');
  if (zone) zone.classList.add('has-file');
  if (label) label.textContent = file.name;
  if (preview) {
    preview.src = URL.createObjectURL(file);
    preview.style.display = 'block';
  }
}

function initBeatUploadZones() {
  [['coverDropZone', 'nCoverFile', onCoverFileSelected], ['audioDropZone', 'nAudioFile', onAudioFileSelected]].forEach(([zoneId, inputId, handler]) => {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    if (!zone || !input) return;
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      handler(input);
    });
  });
}

function resetBeatUploadForm() {
  pendingCoverFile = null;
  pendingAudioFile = null;
  ['nCoverFile', 'nAudioFile'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['coverDropZone', 'audioDropZone'].forEach(id => document.getElementById(id)?.classList.remove('has-file', 'dragover'));
  const coverLabel = document.getElementById('coverFileLabel');
  const audioLabel = document.getElementById('audioFileLabel');
  if (coverLabel) coverLabel.textContent = t('admin_upload_cover_sub');
  if (audioLabel) audioLabel.textContent = t('admin_upload_audio_sub');
  const coverPreview = document.getElementById('coverPreview');
  const audioPreview = document.getElementById('audioPreview');
  if (coverPreview) { coverPreview.style.display = 'none'; coverPreview.src = ''; }
  if (audioPreview) { audioPreview.style.display = 'none'; audioPreview.src = ''; }
  setUploadProgress(0);
  const wrap = document.getElementById('uploadProgressWrap');
  if (wrap) wrap.style.display = 'none';
}

async function uploadBeatAssets(title) {
  const slug = slugifyBeatTitle(title) + '-' + Date.now();
  const urls = { cover: null, audio: null };
  if (pendingCoverFile) {
    const ext = pendingCoverFile.name.split('.').pop().toLowerCase();
    setUploadProgress(5, currentLang === 'en' ? 'Uploading cover…' : 'Envoi image…');
    urls.cover = await uploadFileToStorage(pendingCoverFile, `covers/${slug}.${ext}`);
  }
  if (pendingAudioFile) {
    const ext = pendingAudioFile.name.split('.').pop().toLowerCase();
    setUploadProgress(pendingCoverFile ? 50 : 5, currentLang === 'en' ? 'Uploading audio…' : 'Envoi audio…');
    urls.audio = await uploadFileToStorage(pendingAudioFile, `beats/${slug}.${ext}`);
  }
  if (pendingCoverFile || pendingAudioFile) setUploadProgress(100, '✓');
  return urls;
}

function isTrapBeat(beat) {
  const title = (beat?.title || '').trim().toUpperCase();
  const genre = (beat?.genre || '').trim().toLowerCase();
  return title === 'TRAP' || genre === 'trap';
}

function isGhostBeat(beat) {
  const title = (beat?.title || '').trim().toUpperCase();
  return title === 'GHOST';
}

async function purgeTrapBeatsIfAdmin() {
  if (trapBeatsPurged || currentUser?.role !== 'admin') return;
  trapBeatsPurged = true;
  try {
    const fn = cloudFunctions().httpsCallable('ensureCatalogBeats');
    await fn({ action: 'purgeTrap' });
    beats = beats.filter(b => !isTrapBeat(b));
  } catch (e) {
    console.warn('purgeTrap:', e.message);
  }
}
 
// Supprimer un beat (Cloud Function ou fallback Firestore direct)
async function deleteBeatFromFirestore(docId, title) {
  if (!(await ensureAdminAuth())) return false;

  try {
    let deleted = 0;
    if (docId && !isCatalogOnlyId(docId)) {
      const docRef = db.collection('beats').doc(String(docId));
      const doc = await docRef.get();
      if (doc.exists) {
        await docRef.delete();
        deleted += 1;
      }
    }
    if (title) {
      for (const variant of [title.toUpperCase(), title]) {
        const snap = await db.collection('beats').where('title', '==', variant).get();
        for (const doc of snap.docs) {
          await doc.ref.delete();
          deleted += 1;
        }
      }
    }
    if (deleted > 0) return true;
  } catch (e) {
    console.warn('Delete Firestore direct:', e.message);
  }

  try {
    const result = await callCloudFunction('ensureCatalogBeats', { action: 'delete', beatId: String(docId), title: title || null });
    if (result.data?.success && (result.data.deleted || 0) > 0) return true;
  } catch (e) {
    console.error('Erreur delete beat', e);
    showToast('⚠ Suppression impossible : ' + (e.message || e.code || 'permission refusée'));
    return false;
  }

  showToast('⚠ Beat introuvable');
  return false;
}

// ═══ PARAMÈTRES SITE (Admin) ═══
async function loadAdminSettings() {
  try {
    const doc = await db.collection('settings').doc('site').get();
    if (!doc.exists) return;
    const d = doc.data();
    const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
    set('adminArtistName', d.artistName);
    set('adminEmail', d.email);
    set('adminWhatsapp', d.whatsapp);
    set('adminInstagram', d.instagram);
  } catch (e) {
    console.warn('Chargement paramètres admin:', e);
  }
}

async function saveAdminSettings() {
  if (!currentUser || currentUser.role !== 'admin') {
    showToast('⚠ Accès admin requis');
    return;
  }
  const data = {
    artistName: document.getElementById('adminArtistName')?.value.trim() || 'Je Suis Beatz',
    email: document.getElementById('adminEmail')?.value.trim() || '',
    whatsapp: document.getElementById('adminWhatsapp')?.value.trim() || '',
    instagram: document.getElementById('adminInstagram')?.value.trim() || '',
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  try {
    await db.collection('settings').doc('site').set(data, { merge: true });
    showToast('✓ ' + t('admin_saved_toast'));
  } catch (e) {
    console.error('Erreur save settings', e);
    showToast('⚠ Erreur de sauvegarde');
  }
}
 
// ═══ PROFILS (Firestore) ═══
function cleanProfileData(data) {
  const cleaned = {};
  Object.entries(data).forEach(([key, value]) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length) cleaned[key] = trimmed;
    } else if (value != null) {
      cleaned[key] = value;
    }
  });
  return cleaned;
}
function isValidProfileUrl(url) {
  if (!url || !url.trim()) return true;
  return /^https:\/\//i.test(url.trim());
}
async function loadProfiles() {
  try {
    const snap = await db.collection('profiles').get();
    return snap.docs.map(d => ({uid: d.id, ...d.data()}));
  } catch(e) { return []; }
}
async function saveProfileToFirestore(uid, data) {
  try {
    await db.collection('profiles').doc(uid).set(data, {merge:true});
    return true;
  } catch(e) {
    console.error('Erreur save profil', e);
    showToast('⚠ Erreur de sauvegarde du profil');
    return false;
  }
}
async function loadMyProfile(uid) {
  try {
    const doc = await db.collection('profiles').doc(uid).get();
    return doc.exists ? doc.data() : {};
  } catch(e) { return {}; }
}
 
// ═══ PUBLICATIONS (Firestore) ═══
async function loadPosts() {
  try {
    const snap = await db.collection('posts').orderBy('createdAt','desc').get();
    return snap.docs.map(d => ({id: d.id, ...d.data()}));
  } catch(e) { return []; }
}
async function addPostToFirestore(post) {
  try {
    await db.collection('posts').add({...post, createdAt: firebase.firestore.FieldValue.serverTimestamp()});
  } catch(e) { console.error('Erreur post Firestore', e); showToast('⚠ Erreur de publication'); }
}
async function deletePostFromFirestore(docId) {
  try { await db.collection('posts').doc(String(docId)).delete(); }
  catch(e) { console.error('Erreur delete post', e); }
}
 
// ═══ PANIER (Firestore) ═══
async function saveCartToFirestore(uid, cartData) {
  cartData = sanitizeCartItems(cartData);
  try { await db.collection('carts').doc(uid).set({items: cartData, updatedAt: firebase.firestore.FieldValue.serverTimestamp()}); }
  catch(e) { console.warn('Cart Firestore indisponible, sauvegarde locale'); }
  // On garde aussi une copie locale
  localStorage.setItem('jsb_cart2', JSON.stringify(cartData));
}
async function loadCartFromFirestore(uid) {
  try {
    const doc = await db.collection('carts').doc(uid).get();
    return sanitizeCartItems(doc.exists ? (doc.data().items || []) : []);
  } catch(e) { return sanitizeCartItems(JSON.parse(localStorage.getItem('jsb_cart2') || '[]')); }
}
 
// ═══ INIT ═══
window.addEventListener('load', async () => {
  buildWave();
  updateAuth();
  updateCartBadge();
  checkReturnFromCinetPay();
  checkReturnFromGeniusPay();
  window.addEventListener('scroll', () => {
    document.getElementById('mainNav').classList.toggle('scrolled', window.scrollY > 40);
  });
  // Catalogue beats en temps réel depuis Firestore
  subscribeBeatsFromFirestore();
  // Charger le panier depuis Firestore si connecté
  if (currentUser && currentUser.uid) {
    cart = await loadCartFromFirestore(currentUser.uid);
    cart = sanitizeCartItems(cart);
    updateCartBadge();
  }
});
 
function buildWave() {
  const w = document.getElementById('heroWave');
  if (!w) return;
  const hs = [8,14,22,36,28,44,32,48,30,42,22,38,16,30,12,24,16,28,20,36,24,44,28,48,34,40,24,34,18,26];
  hs.forEach((h,i) => {
    const b = document.createElement('div');
    b.className = 'wv-bar';
    b.style.cssText = `--h:${h}px;--d:${0.4+Math.random()*0.9}s;--dd:${i*0.06}s`;
    w.appendChild(b);
  });
}
 
// ═══ BEATS ═══
function saveBeats() { /* Remplacé par Firestore — voir saveBeatToFirestore() */ }
 
function renderAll() {
  renderBeatsGrid();
  renderFeatured();
  renderAdminTables();
  renderStats();
  const statBeatsEl = document.getElementById('statBeats');
  if (statBeatsEl) statBeatsEl.textContent = beats.length;
  if (document.getElementById('fsBeatList')) renderFsBeatList();
  if (document.getElementById('recordingsList')) renderRecordingsList();
  if (typeof bindFsTouchHandlers === 'function') bindFsTouchHandlers();
}
 
function beatMatchesFilter(b, filter) {
  if (!filter || filter === 'Tous') return true;
  const normalizedFilter = String(filter).trim().toLowerCase();
  const genre = String(b.genre || '').trim().toLowerCase();
  const subgenre = String(b.subgenre || '').trim().toLowerCase();
  return genre === normalizedFilter
    || subgenre === normalizedFilter
    || genre.includes(normalizedFilter)
    || subgenre.includes(normalizedFilter);
}

function renderBeatsGrid() {
  const filtered = currentFilter === 'Tous'
    ? beats
    : beats.filter(b => beatMatchesFilter(b, currentFilter));
  const grid = document.getElementById('beatsGrid');
  if (!grid) return;
  grid.innerHTML = filtered.length
    ? filtered.map(b => beatCard(b, beats.indexOf(b))).join('')
    : `<div style="text-align:center;color:white;padding:60px;font-family:var(--font-mono);font-size:0.8rem;letter-spacing:2px;grid-column:1/-1"><i class="fas fa-music" style="font-size:2rem;color:rgba(0,229,255,0.2);display:block;margin-bottom:14px"></i>${currentLang === 'en' ? 'No beats available yet' : 'Aucun beat disponible'}</div>`;
}
 
function beatCard(b, idx) {
  const bars = Array.from({length:28}, () => {
    const h = Math.floor(Math.random()*24)+6;
    return `<div class="wbar2" style="height:${h}px"></div>`;
  }).join('');
  const sold = b.status === 'sold';
  return `
  <div class="beat-card">
    <div class="beat-cover-wrap">
      <img src="${b.cover || DEFAULT_BEAT_COVER}" alt="${b.title}" onerror="this.src='${DEFAULT_BEAT_COVER}'">
      <div class="beat-overlay">
        <button class="play-circle" onclick="playBeat(${idx})"><i class="fas fa-play" style="margin-left:3px"></i></button>
      </div>
      <div class="beat-badges">
        <span class="badge">${b.genre}</span>
        ${b.subgenre ? `<span class="badge">${b.subgenre}</span>` : ''}
        ${sold ? '<span class="badge sold">VENDU</span>' : ''}
      </div>
    </div>
    <div class="beat-body">
      <div class="beat-header">
        <div class="beat-name">${b.title}</div>
        <div class="beat-icon-label">
          ${b.icon ? `<i class="${sanitizeIconClass(b.icon)}"></i>` : `<img src="${b.cover || 'image_beat.jpeg'}" alt="default beat icon" class="beat-default-icon"/>`}
        </div>
      </div>
      <div class="beat-meta-row">
        <span class="beat-meta-item"><i class="fas fa-tachometer-alt"></i>${b.bpm} BPM</span>
        <span class="beat-meta-item"><i class="fas fa-tag"></i>${b.genre}</span>
      </div>
      <div class="beat-waveform" onclick="playBeat(${idx})">
        ${bars}
        <div class="wave-progress" id="wp-${idx}" style="width:0%"></div>
      </div>
      <div class="beat-footer">
        <div class="beat-price"><sup>$</sup>${b.priceBasic} <small>/ Basic</small></div>
        ${sold
          ? `<span style="font-family:var(--font-mono);font-size:0.62rem;color:#fff;letter-spacing:2px"><i class="fas fa-lock"></i> ${t('dyn_sold_label').toUpperCase()}</span>`
          : `<button class='btn-add-cart' onclick='addToCart(${idx})'><i class='fas fa-shopping-bag'></i> ${t('cart_title')}</button>`}
      </div>
    </div>
  </div>`;
}
 
function renderFeatured() {
  const el = document.getElementById('featuredBeat');
  if (!el || beats.length === 0) return;
  const b = beats[0];
  el.innerHTML = `
  <div class="featured-wrap">
    <div class="featured-cover">
      <img src="${b.cover || 'image_beat.jpeg'}" alt="${b.title}" onerror="this.src='image_beat.jpeg'">
      <div class="featured-play">
        <button class="play-big" onclick="playBeat(0)"><i class="fas fa-play" style="margin-left:4px"></i></button>
      </div>
    </div>
    <div>
      <div class='featured-label'><i class='fas fa-fire'></i> ${t('featured_chip')}</div>
      <div class="featured-title">${b.title}</div>
      <div class="featured-meta">
        <span><i class="fas fa-tachometer-alt" style="color:var(--cyan)"></i> ${b.bpm} BPM</span>
        <span><i class="fas fa-tag" style="color:var(--cyan)"></i> ${b.genre}${b.subgenre?' · '+b.subgenre:''}</span>
      </div>
      <p class="featured-desc">${getBeatDesc(b)}</p>
      <div class='featured-price'>$${b.priceBasic} <small>/ ${t('lic_basic_tag')}</small></div>
      <div style="display:flex;gap:14px;flex-wrap:wrap">
        <button class='btn-primary' onclick='playBeat(0)'><i class='fas fa-play'></i> ${t('feat_listen')}</button>
        <button class='btn-ghost' onclick='addToCart(0)'><i class='fas fa-shopping-bag'></i> ${t('feat_add_cart')}</button>
      </div>
    </div>
  </div>`;
}
 
function filterBeats(genre, btn) {
  currentFilter = genre;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderBeatsGrid();
}
 
async function addBeat() {
  if (!(await ensureAdminAuth())) return;
  const title = document.getElementById('nTitle').value.trim();
  const bpm = parseInt(document.getElementById('nBpm').value);
  if (!title || !bpm) { showToast('⚠ '+t('err_title_bpm_required')); return; }

  const btn = document.getElementById('addBeatBtn');
  const origBtnHtml = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${currentLang==='en'?'Uploading…':'Téléversement…'}`; }

  let coverUrl = document.getElementById('nCover').value.trim();
  let audioUrl = document.getElementById('nAudio').value.trim();

  try {
    if (pendingCoverFile || pendingAudioFile) {
      const uploaded = await uploadBeatAssets(title);
      if (uploaded.cover) coverUrl = uploaded.cover;
      if (uploaded.audio) audioUrl = uploaded.audio;
    }
  } catch (e) {
    console.error('Upload error:', e);
    const detail = e.code === 'storage/unauthorized'
      ? (currentLang === 'en' ? 'Admin rights missing — log out and log back in' : 'Droits admin manquants — déconnectez-vous puis reconnectez-vous')
      : (e.message || e.code || '');
    showToast('⚠ ' + (currentLang === 'en' ? 'Upload failed' : 'Échec du téléversement') + (detail ? ' : ' + detail : ''));
    if (btn) { btn.disabled = false; btn.innerHTML = origBtnHtml; }
    return;
  }

  if (!audioUrl && !pendingAudioFile) {
    showToast('⚠ ' + (currentLang === 'en' ? 'Please upload or provide an audio file' : 'Téléversez ou indiquez un fichier audio'));
    if (btn) { btn.disabled = false; btn.innerHTML = origBtnHtml; }
    return;
  }

  const b = {
    title: title.toUpperCase(), bpm,
    genre: document.getElementById('nGenre').value,
    subgenre: document.getElementById('nSub').value,
    priceBasic: parseInt(document.getElementById('nPb').value) || 25,
    pricePremium: parseInt(document.getElementById('nPp').value) || 50,
    priceWav: parseInt(document.getElementById('nPw').value) || 100,
    priceUnlimited: parseInt(document.getElementById('nPu').value) || 150,
    priceExclusive: parseInt(document.getElementById('nPe').value) || 499,
    cover: coverUrl || DEFAULT_BEAT_COVER,
    audio: audioUrl || '',
    status: document.getElementById('nStatus').value,
    desc: document.getElementById('nDesc').value,
    desc_fr: document.getElementById('nDesc').value,
    desc_en: document.getElementById('nDescEn').value || document.getElementById('nDesc').value,
  };
  if (isForbiddenBeat(b)) {
    showToast('⚠ ' + (currentLang === 'en' ? 'Forbidden beat removed' : 'Beat interdit supprimé'));
    if (btn) { btn.disabled = false; btn.innerHTML = origBtnHtml; }
    resetBeatUploadForm();
    return;
  }
  const iconVal = document.getElementById('nIcon')?.value.trim();
  if (iconVal) b.icon = sanitizeIconClass(iconVal);
  // If English description missing, attempt to auto-translate via Cloud Function
  if ((!b.desc_en || b.desc_en.trim().length === 0) && b.desc_fr) {
    const tr = await translateText(b.desc_fr, 'en');
    if (tr) b.desc_en = tr;
  }

  const newId = await saveBeatToFirestore(b);
  if (!newId) {
    if (btn) { btn.disabled = false; btn.innerHTML = origBtnHtml; }
    return;
  }
  try {
    const savedDoc = await db.collection('beats').doc(String(newId)).get();
    if (!savedDoc.exists) {
      showToast('⚠ ' + (currentLang === 'en' ? 'Beat saved but not found — retry refresh' : 'Beat enregistré introuvable — actualisez la page'));
    }
  } catch (verifyErr) {
    console.warn('Beat verify after save:', verifyErr);
  }
  ['nTitle','nBpm','nSub','nCover','nIcon','nAudio','nDesc','nDescEn','nPb','nPp','nPw','nPu','nPe'].forEach(id => document.getElementById(id) && (document.getElementById(id).value = ''));
  resetBeatUploadForm();
  await loadBeatsFromFirestore();
  if (btn) { btn.disabled = false; btn.innerHTML = origBtnHtml; }
  showToast('✓ ' + t('dyn_beat_added').replace('%s', b.title));
  adminPanel('manage');
}

async function repairBeatsFromStorage() {
  if (!(await ensureAdminAuth())) return;
  const btn = document.getElementById('btnRepairStorage');
  const origHtml = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> …'; }
  try {
    const folder = firebase.storage().ref('beats');
    const listing = await folder.listAll();
    let repaired = 0;
    for (const item of listing.items) {
      const url = await item.getDownloadURL();
      const alreadyLinked = beats.some(b => {
        const src = resolveBeatAudioSource(b);
        return src && (src === url || src.includes(encodeURIComponent(item.name)) || src.includes(item.name));
      });
      if (alreadyLinked) continue;
      const base = item.name.replace(/\.[a-z0-9]+$/i, '').replace(/-\d{10,}$/i, '');
      const title = base.replace(/[-_]+/g, ' ').trim().toUpperCase() || item.name.toUpperCase();
      await db.collection('beats').add({
        ...normalizeBeatRecord({
          title,
          bpm: 140,
          genre: 'Drill',
          subgenre: '',
          priceBasic: 25,
          pricePremium: 50,
          priceWav: 100,
          priceUnlimited: 150,
          priceExclusive: 499,
          cover: DEFAULT_BEAT_COVER,
          audio: url,
          status: 'available',
          desc_fr: '',
          desc_en: '',
        }),
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      repaired += 1;
    }
    await loadBeatsFromFirestore();
    showToast(repaired
      ? `✓ ${repaired} beat(s) récupéré(s) depuis Storage`
      : (currentLang === 'en' ? '✓ Catalog already synced with Storage' : '✓ Catalogue déjà synchronisé avec Storage'));
  } catch (err) {
    console.error('repairBeatsFromStorage:', err);
    showToast('⚠ ' + (currentLang === 'en' ? 'Storage sync failed' : 'Synchronisation Storage impossible'));
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
  }
}
 
async function deleteBeat(id) {
  if (!(await ensureAdminAuth())) return;
  if (!confirm(t('admin_confirm_delete'))) return;
  const idStr = String(id);
  const beat = beats.find(b => String(b.id) === idStr);
  const title = beat?.title || null;
  const ok = await deleteBeatFromFirestore(idStr, title);
  if (!ok) return;
  if (title) {
    const tUp = title.toUpperCase();
    beats = beats.filter(b => (b.title || '').toUpperCase() !== tUp);
  } else {
    beats = beats.filter(b => String(b.id) !== idStr);
  }
  await loadBeatsFromFirestore();
  showToast('✓ ' + t('dyn_beat_deleted'));
}

async function openEdit(id) {
  if (!(await ensureAdminAuth())) return;
  const b = beats.find(x => String(x.id) === String(id));
  if (!b) return;
  document.getElementById('eId').value = String(id);
  document.getElementById('eTitle').value = b.title;
  document.getElementById('eBpm').value = b.bpm;
  document.getElementById('eGenre').value = b.genre;
  document.getElementById('ePb').value = b.priceBasic;
  document.getElementById('ePp').value = b.pricePremium;
  document.getElementById('ePw').value = b.priceWav || 100;
  document.getElementById('ePu').value = b.priceUnlimited || 150;
  document.getElementById('ePe').value = b.priceExclusive || 499;
  document.getElementById('editModal').classList.add('show');
}
function closeEdit() { document.getElementById('editModal').classList.remove('show'); }
async function saveEdit() {
  if (!(await ensureAdminAuth())) return;
  const id = document.getElementById('eId').value;
  const b = beats.find(x => String(x.id) === String(id));
  if (!b) return;
  const bpm = parseInt(document.getElementById('eBpm').value, 10);
  if (!document.getElementById('eTitle').value.trim() || !bpm || bpm < 1) {
    showToast('⚠ ' + t('err_title_bpm_required'));
    return;
  }
  const updates = {
    title: document.getElementById('eTitle').value.trim().toUpperCase(),
    bpm,
    genre: document.getElementById('eGenre').value,
    priceBasic: parseInt(document.getElementById('ePb').value, 10) || 25,
    pricePremium: parseInt(document.getElementById('ePp').value, 10) || 50,
    priceWav: parseInt(document.getElementById('ePw').value, 10) || 100,
    priceUnlimited: parseInt(document.getElementById('ePu').value, 10) || 150,
    priceExclusive: parseInt(document.getElementById('ePe').value, 10) || 499,
  };
  let docId = String(id);
  if (isCatalogOnlyId(docId)) {
    const newId = await saveBeatToFirestore({ ...b, ...updates });
    if (!newId) return;
    b.id = newId;
    docId = newId;
  } else {
    const saved = await saveBeatToFirestore(updates, docId);
    if (!saved) return;
  }
  Object.assign(b, updates);
  renderAll();
  closeEdit();
  showToast('✓ '+t('admin_beat_edited'));
}
 
function renderAdminTables() {
  const row = (b) => {
    const safeId = String(b.id).replace(/'/g, "\\'");
    return `<tr>
      <td><strong>${b.title}</strong></td><td>${b.genre}</td><td>${b.bpm}</td><td>$${b.priceBasic}</td>
      <td style="color:${b.status==='sold'?'#fff':'var(--cyan)'}"><i class="fas fa-circle" style="font-size:.5rem;margin-right:6px"></i>${b.status==='sold'?t('dyn_sold_label'):t('dyn_available_label')}</td>
      <td><div style="display:flex;gap:8px">
        <button class="tbl-edit" onclick='openEdit("${safeId}")'><i class="fas fa-pen"></i></button>
        <button class="tbl-del" onclick='deleteBeat("${safeId}")'><i class="fas fa-trash"></i></button>
      </div></td>
    </tr>`;
  };
  const html = `
    <thead><tr><th>${t('admin_col_title')}</th><th>Genre</th><th>BPM</th><th>Basic</th><th>${t('admin_col_status')}</th><th>${t('admin_col_actions')}</th></tr></thead>
    <tbody>${beats.map(row).join('')}</tbody>`;
  const rt = document.getElementById('recentTbl');
  const mt = document.getElementById('manageTbl');
  if (rt) rt.innerHTML = html;
  if (mt) mt.innerHTML = html;
}

// Auto-translate beats missing English fields (admin action)
async function autoTranslateBeats() {
  if (!(await ensureAdminAuth())) return { ok: false, error: 'auth' };
  const toTranslate = (beats || []).filter(b => (b.desc_fr || b.desc) && !(b.desc_en && b.desc_en.trim().length>0));
  const results = [];
  for (const b of toTranslate) {
    try {
      const src = b.desc_fr || b.desc || '';
      const translated = await translateText(src, 'en');
      if (translated) {
        await saveBeatToFirestore({ desc_en: translated }, b.id);
        results.push({ id: b.id, ok: true });
        // update local copy
        const bb = beats.find(x => String(x.id) === String(b.id)); if (bb) bb.desc_en = translated;
      } else {
        results.push({ id: b.id, ok: false, error: 'no-translation' });
      }
    } catch (e) { results.push({ id: b.id, ok: false, error: String(e) }); }
    await new Promise(r => setTimeout(r, 500));
  }
  await loadBeatsFromFirestore(); renderAll();
  return { ok: true, results };
}

function autoTranslateBeatsUI() {
  const btn = document.getElementById('btnAutoTranslate');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Translating...'; }
  autoTranslateBeats().then(res => {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-language"></i> Auto-translate missing'; }
    if (res && res.ok) showToast('✓ Traduction automatique terminée');
    else showToast('⚠ Traduction impossible');
  }).catch(e => { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-language"></i> Auto-translate missing'; } showToast('⚠ Erreur traduction'); });
}
 
function renderStats() {
  const el = document.getElementById('statsG');
  if (!el) return;

  const baseCards = `
    <div class="stat-g-card"><div class="stat-g-num">${beats.length}</div><div class="stat-g-lbl"><i class="fas fa-music"></i> Beats</div></div>
    <div class="stat-g-card"><div class="stat-g-num">${beats.filter(b=>b.status!=='sold').length}</div><div class="stat-g-lbl"><i class="fas fa-check"></i> ${t('admin_stat_available')}</div></div>
    <div class="stat-g-card"><div class="stat-g-num">${beats.filter(b=>b.status==='sold').length}</div><div class="stat-g-lbl"><i class="fas fa-lock"></i> ${t('admin_stat_sold')}</div></div>`;

  if (currentUser?.role === 'admin') {
    el.innerHTML = `
      <div class="stat-g-card"><div class="stat-g-num" id="adminUserCount">…</div><div class="stat-g-lbl"><i class="fas fa-users"></i> ${t('admin_stat_users')}</div></div>
      ${baseCards}`;
  } else {
    el.innerHTML = baseCards;
  }
}

async function renderAdminUsers(force = false, limit = 1000) {
  const tbl = document.getElementById('adminUsersTbl');
  const note = document.getElementById('adminUsersNote');
  if (!tbl) return;
  if (adminUserStatsLoaded && !force) return;
  try {
    const fn = cloudFunctions().httpsCallable('getAdminUserStats');
    const result = await fn({ limit });
    const { count, users, partial, limit: returnedLimit } = result.data || {};
    const countEl = document.getElementById('adminUserCount');
    if (countEl) countEl.textContent = count ?? '—';
    if (note) {
      note.textContent = currentLang === 'en'
        ? `Showing ${users?.length || 0} users${partial ? ` of ${count}` : ''}`
        : `Affichage de ${users?.length || 0} utilisateurs${partial ? ` sur ${count}` : ''}`;
    }
    if (!users?.length) {
      tbl.innerHTML = `<tbody><tr><td colspan="4" style="text-align:center;color:gray;padding:20px">${currentLang==='en'?'No users yet':'Aucun utilisateur'}</td></tr></tbody>`;
      adminUserStatsLoaded = true;
      return;
    }
    tbl.innerHTML = `
      <thead><tr><th>Username</th><th>Email</th><th>Role</th><th>${currentLang==='en'?'Registered':'Inscrit le'}</th></tr></thead>
      <tbody>${users.map(u => `<tr>
        <td><strong>${sanitize(u.username)}</strong></td>
        <td>${sanitize(u.email)}</td>
        <td>${sanitize(u.role || 'user')}</td>
        <td>${u.createdAt ? new Date(u.createdAt).toLocaleDateString('fr-FR') : '—'}</td>
      </tr>`).join('')}</tbody>`;
    if (partial && note) {
      note.textContent += currentLang === 'en' ? ' (partial list)' : ' (liste partielle)';
    }
    adminUserStatsLoaded = true;
  } catch (e) {
    const countEl = document.getElementById('adminUserCount');
    if (countEl) countEl.textContent = '—';
    if (note) note.textContent = currentLang === 'en' ? 'Unable to load user list.' : 'Impossible de charger la liste.';
    tbl.innerHTML = '';
    console.warn('getAdminUserStats failed:', e);
  }
}
 
// ═══ AUDIO ═══

async function playBeat(idx) {
  const b = beats[idx];
  const audioSource = resolveBeatAudioSource(b);
  if (!b || !audioSource) { showToast(t('dyn_no_audio')); return; }
  if (currentIdx === idx && isPlaying) { togglePlay(); return; }
  currentIdx = idx;

  const directBeatUrl = resolveBeatPlaybackURL(audioSource);
  const proxyBeatUrl = resolveFsBeatProxyURL(audioSource);
  let beatUrl = directBeatUrl;
  // If the source is served from Firebase Storage, prefer the proxy to avoid CORS issues
  if (proxyBeatUrl && /firebasestorage\.googleapis\.com|storage\.googleapis\.com/i.test(directBeatUrl)) {
    console.log('Using audio proxy for playback (CORS-sensitive source):', proxyBeatUrl);
    beatUrl = proxyBeatUrl;
  }
  let attemptedProxy = false;

  const tryProxyFallback = async () => {
    if (attemptedProxy || !proxyBeatUrl || proxyBeatUrl === beatUrl) return false;
    attemptedProxy = true;
    beatUrl = proxyBeatUrl;
    console.log('Falling back to audio proxy for beat:', beatUrl);
    audioEl.src = beatUrl;
    audioEl.load();
    try {
      await audioEl.play();
      return true;
    } catch (proxyErr) {
      console.warn('Beat proxy playback failed:', proxyErr);
      return false;
    }
  };

  audioEl.onerror = async (evt) => {
    console.warn('Audio element error for', beatUrl, audioEl.error, evt);
    if (await tryProxyFallback()) return;
    showWarningToast('dyn_play_error', 'Impossible de lire le fichier audio');
  };
  audioEl.onloadedmetadata = () => {
    const durEl = document.getElementById('durT');
    if (durEl && audioEl.duration && Number.isFinite(audioEl.duration)) {
      durEl.textContent = fmt(audioEl.duration);
    }
  };

  audioEl.src = beatUrl;
  audioEl.preload = 'auto';
  audioEl.muted = false;
  audioEl.volume = 0.8;
  audioEl.currentTime = 0;
  audioEl.load();
  try {
    await audioEl.play();
    isPlaying = true;
    document.getElementById('playBtn').innerHTML = '<i class="fas fa-pause"></i>';
  } catch (err) {
    console.warn('Beat playback failed:', err);
    // Try muted-play fallback (helps bypass some autoplay/policy blocks)
    try {
      const wasMuted = audioEl.muted;
      audioEl.muted = true;
      await audioEl.play();
      audioEl.muted = wasMuted;
      isPlaying = true;
      document.getElementById('playBtn').innerHTML = '<i class="fas fa-pause"></i>';
      return;
    } catch (mutedErr) {
      console.warn('Muted play fallback failed:', mutedErr);
    }

    if (await tryProxyFallback()) {
      isPlaying = true;
      document.getElementById('playBtn').innerHTML = '<i class="fas fa-pause"></i>';
      return;
    }
    showWarningToast('dyn_play_error', 'Impossible de lire le fichier audio');
    isPlaying = false;
    return;
  }

  document.getElementById('audioTitle').textContent = b.title;
  const thumb = document.getElementById('audioThumb');
  thumb.src = b.cover || 'image_beat.jpeg';
  thumb.onerror = () => thumb.src = 'image_beat.jpeg';
  document.getElementById('beatIcon').innerHTML = b.icon ? `<i class="${sanitizeIconClass(b.icon)}"></i>` : `<img src="${b.cover || DEFAULT_BEAT_COVER}" alt="beat icon" class="beat-default-icon"/>`;
  document.getElementById('audioBar').classList.add('show');
}
 
function togglePlay() {
  if (!audioEl.src) return;
  if (isPlaying) {
    audioEl.pause();
    document.getElementById('playBtn').innerHTML = '<i class="fas fa-play"></i>';
  } else {
    audioEl.play();
    document.getElementById('playBtn').innerHTML = '<i class="fas fa-pause"></i>';
  }
  isPlaying = !isPlaying;
}
function prevTrack() { if (currentIdx > 0) playBeat(currentIdx-1); }
function nextTrack() { if (currentIdx < beats.length-1) playBeat(currentIdx+1); }
function closePlayer() { audioEl.pause(); isPlaying=false; document.getElementById('audioBar').classList.remove('show'); }
function setVol(v) { audioEl.volume = v/100; }
function seekAudio(e) { const r = e.offsetX/e.currentTarget.offsetWidth; if (audioEl.duration) audioEl.currentTime = r*audioEl.duration; }
function fmt(s) { 
  if (isNaN(s) || !isFinite(s)) return '0:00'; 
  const m=Math.floor(s/60), sc=Math.floor(s%60); 
  return m+':'+(sc<10?'0':'')+sc; 
}
 
audioEl.addEventListener('timeupdate', () => {
  if (!audioEl.duration) return;
  const p = (audioEl.currentTime/audioEl.duration)*100;
  document.getElementById('progFill').style.width = p+'%';
  document.getElementById('curT').textContent = fmt(audioEl.currentTime);
  document.getElementById('durT').textContent = fmt(audioEl.duration);
  if (currentIdx >= 0) { const wp = document.getElementById('wp-'+currentIdx); if(wp) wp.style.width = p+'%'; }
});
audioEl.addEventListener('ended', () => { isPlaying=false; document.getElementById('playBtn').innerHTML='<i class="fas fa-play"></i>'; nextTrack(); });
 
// ═══ CART ═══
 
// License selector modal
function selectLicenseAndShop(licenseKey) {
  if (!licenseKey) return;
  window.preferredBeatLicense = licenseKey;
  showPage('beats');
  if (currentIdx >= 0 && beats[currentIdx]) {
    addToCart(currentIdx);
  } else {
    showToast(t('dyn_select_beat_first'));
  }
}

function addToCart(idx) {
  const b = beats[idx];
  if (!b || b.status === 'sold') return;
  if (cart.find(c => String(c.id) === String(b.id))) { showToast(t('dyn_already_cart')); return; }
 
  const isEn = currentLang === 'en';
 
  // Build currency display for each license
  if (window.preferredBeatLicense) {
    const preferred = window.preferredBeatLicense;
    const licenseMap = {
      Basic: b.priceBasic || 25,
      Premium: b.pricePremium || 50,
      'WAV + Stems': b.priceWav || 100,
      UNLIMITED: b.priceUnlimited || 150,
      Exclusif: b.priceExclusive || 499
    };
    const preferredPrice = licenseMap[preferred];
    if (preferredPrice != null) {
      window.preferredBeatLicense = null;
      return confirmAddToCart(idx, preferred, preferredPrice);
    }
  }

  const licenses = [
    {
      key: 'Basic',
      price: b.priceBasic || 25,
      icon: 'fas fa-seedling',
      color: 'var(--cyan)',
      labelFr: 'Basic', labelEn: 'Basic',
      descFr: 'MP3 taggé · 10 000 streams · Non commercial',
      descEn: 'Tagged MP3 · 10,000 streams · Non-commercial'
    },
    {
      key: 'Premium',
      price: b.pricePremium || 50,
      icon: 'fas fa-star',
      color: '#f9c74f',
      labelFr: 'Premium', labelEn: 'Premium',
      descFr: 'WAV + MP3 · 500K streams · Commercial · Radio',
      descEn: 'WAV + MP3 · 500K streams · Commercial · Radio'
    },
    {
      key: 'WAV + Stems',
      price: b.priceWav || 100,
      icon: 'fas fa-layer-group',
      color: '#D4AF37',
      labelFr: 'WAV + Stems', labelEn: 'WAV + Stems',
      descFr: 'WAV HD + Stems · 100K streams · Mixage pro',
      descEn: 'HD WAV + Stems · 100K streams · Pro mixing'
    },
    {
      key: 'UNLIMITED',
      price: b.priceUnlimited || 150,
      icon: 'fas fa-infinity',
      color: '#00d084',
      labelFr: 'UNLIMITED', labelEn: 'UNLIMITED',
      descFr: 'Streams illimités · Beat en catalogue · Usage commercial',
      descEn: 'Unlimited streams · Beat stays in catalog · Commercial use'
    },
    {
      key: 'Exclusif',
      price: b.priceExclusive || 499,
      icon: 'fas fa-crown',
      color: '#ff6b6b',
      labelFr: 'Exclusif', labelEn: 'Exclusive',
      descFr: 'Propriété totale · Streams illimités · Retiré du catalogue',
      descEn: 'Full ownership · Unlimited streams · Removed from catalog'
    }
  ];
 
  function renderLicCards(currency) {
    return licenses.map(lic => `
      <div class="lic-sel-card" onclick="confirmAddToCart(${idx},'${lic.key}',${lic.price})" style="cursor:pointer;border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:16px 18px;display:flex;align-items:center;gap:16px;background:rgba(255,255,255,0.03);transition:all 0.2s;margin-bottom:10px" onmouseover="this.style.borderColor='${lic.color}';this.style.background='rgba(255,255,255,0.07)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.1)';this.style.background='rgba(255,255,255,0.03)'">
        <div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,${lic.color}22,${lic.color}11);border:1px solid ${lic.color}55;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <i class="${lic.icon}" style="color:${lic.color}"></i>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-family:var(--font-display);font-size:1rem;color:#fff;letter-spacing:1px">${isEn ? lic.labelEn : lic.labelFr}</div>
          <div style="font-family:var(--font-mono);font-size:0.58rem;color:var(--text-dim);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${isEn ? lic.descEn : lic.descFr}</div>
        </div>
        <div style="font-family:var(--font-display);font-size:1.1rem;color:${lic.color};flex-shrink:0">${formatUsdAsCurrency(lic.price, currency)}</div>
      </div>`).join('');
  }
 
  const overlay = document.createElement('div');
  overlay.id = 'licSelModal';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = `
    <div style="background:#0f0f1a;border:1px solid rgba(0,229,255,0.2);border-radius:24px;padding:28px;max-width:500px;width:100%;max-height:90vh;overflow-y:auto;position:relative">
      <button onclick="document.getElementById('licSelModal').remove()" style="position:absolute;top:16px;right:16px;background:rgba(255,255,255,0.08);border:none;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:1rem"><i class="fas fa-times"></i></button>
 
      <div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:3px;color:var(--cyan);text-transform:uppercase;margin-bottom:6px"><i class="fas fa-file-contract"></i> ${isEn ? 'Choose your license' : 'Choisissez votre licence'}</div>
      <div style="font-family:var(--font-display);font-size:1.4rem;color:#fff;letter-spacing:2px;margin-bottom:4px">${b.title}</div>
      <div style="font-family:var(--font-mono);font-size:0.62rem;color:var(--text-dim);margin-bottom:20px">${b.genre}${b.subgenre ? ' · ' + b.subgenre : ''} · ${b.bpm} BPM</div>
 
      <!-- Currency picker -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;align-items:center">
        <span style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);letter-spacing:2px">${isEn ? 'CURRENCY' : 'DEVISE'} :</span>
        ${Object.entries(CURRENCY_RATES).map(([code, info]) => `
          <button onclick="window.currentLicenseCurrency='${code}';document.querySelectorAll('.cur-btn').forEach(x=>x.classList.remove('active'));this.classList.add('active');document.getElementById('licCardsWrap').innerHTML=renderLicCards('${code}')" class="cur-btn${code==='USD'?' active':''}" data-code="${code}" style="font-family:var(--font-mono);font-size:0.65rem;padding:5px 12px;border-radius:20px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:#fff;cursor:pointer;transition:all 0.2s" onmouseover="this.style.borderColor='var(--cyan)'" onmouseout="if(!this.classList.contains('active'))this.style.borderColor='rgba(255,255,255,0.15)'">${info.symbol} ${code}</button>`).join('')}
      </div>
 
      <div id="licCardsWrap">${renderLicCards(window.currentLicenseCurrency || 'USD')}</div>
 
      <div style="font-family:var(--font-mono);font-size:0.58rem;color:var(--text-dim);text-align:center;margin-top:6px"><i class="fas fa-info-circle" style="color:var(--cyan)"></i> ${isEn ? 'Prices shown in selected currency · 1 USD = ' + CURRENCY_RATES[window.currentLicenseCurrency || 'USD'].rate + ' ' + (window.currentLicenseCurrency || 'USD') : 'Prix affichés en devise sélectionnée · 1 USD = ' + CURRENCY_RATES[window.currentLicenseCurrency || 'USD'].rate.toLocaleString('fr-FR') + ' ' + (window.currentLicenseCurrency || 'USD')} ${getRateChangeLabel(window.currentLicenseCurrency || 'USD')}</div>
    </div>`;
 
  // Make renderLicCards accessible from onclick
  window.renderLicCards = renderLicCards;
 
  // Style active cur-btn
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
 
  document.body.appendChild(overlay);
 
  // Add active style via JS after render
  setTimeout(() => {
    document.querySelectorAll('.cur-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.cur-btn').forEach(x => {
          x.style.background = 'rgba(255,255,255,0.05)';
          x.style.borderColor = 'rgba(255,255,255,0.15)';
          x.style.color = '#fff';
        });
        btn.style.background = 'rgba(0,229,255,0.15)';
        btn.style.borderColor = 'var(--cyan)';
        btn.style.color = 'var(--cyan)';
      });
    });
    // Activate first button
    const firstBtn = document.querySelector('.cur-btn');
    if (firstBtn) {
      firstBtn.style.background = 'rgba(0,229,255,0.15)';
      firstBtn.style.borderColor = 'var(--cyan)';
      firstBtn.style.color = 'var(--cyan)';
    }
  }, 50);
}
 
async function confirmAddToCart(idx, licenseKey, price) {
  const b = beats[idx];
  if (!b) return;
  document.getElementById('licSelModal')?.remove();
 
  cart.push({
    id: b.id,
    title: b.title,
    price: price,
    cover: b.cover,
    license: licenseKey
  });
  cart = sanitizeCartItems(cart);
 
  if (currentUser && currentUser.uid) {
    await saveCartToFirestore(currentUser.uid, cart);
  } else {
    localStorage.setItem('jsb_cart2', JSON.stringify(cart));
  }
  updateCartBadge();
  showToast((currentLang === 'en' ? '✓ Added: ' : '✓ Ajouté : ') + b.title + ' · ' + licenseKey);
}
async function removeFromCart(id) {
  cart = cart.filter(c => String(c.id) !== String(id));
  cart = sanitizeCartItems(cart);
  if (currentUser && currentUser.uid) {
    await saveCartToFirestore(currentUser.uid, cart);
  } else {
    localStorage.setItem('jsb_cart2', JSON.stringify(cart));
  }
  updateCartBadge(); renderCartItems();
}
function updateCartBadge() {
  const el = document.getElementById('cartCount');
  el.style.display = cart.length > 0 ? 'flex' : 'none';
  el.textContent = cart.length;
}
function toggleCart() {
  const modal = document.getElementById('cartModal');
  if (!modal) return;
  const opening = !modal.classList.contains('show');
  modal.classList.toggle('show');
  if (opening) renderCartItems();
}
function renderCartItems() {
  const ci = document.getElementById('cartItems');
  const cf = document.getElementById('cartFoot');
  const cartTotVal = document.getElementById('cartTotVal');
  if (!ci) return;

  if (cart.length === 0) {
    ci.innerHTML = `<div class="cart-empty"><i class="fas fa-shopping-bag"></i>${t('dyn_cart_empty')}</div>`;
    if (cf) cf.style.display = 'none';
    if (cartTotVal) cartTotVal.textContent = '$0';
    return;
  }

  if (cf) cf.style.display = 'block';
  ci.innerHTML = cart.map(c => `
    <div class="cart-item">
      <img src="${c.cover || 'image_beat.jpeg'}" alt="${c.title}" onerror="this.src='image_beat.jpeg'">
      <div class="cart-item-inf">
        <div class="cart-item-nm">${c.title}</div>
        <div class="cart-item-pr">$${c.price} · ${c.license} · ${formatUsdAsCurrency(c.price, 'XOF')}</div>
      </div>
      <button type="button" class="cart-rm" data-cart-id="${String(c.id).replace(/"/g, '&quot;')}"><i class="fas fa-times"></i></button>
    </div>`).join('');

  const total = cartTotalUsd();
  if (cartTotVal) {
    cartTotVal.textContent = '$' + total + ' · ' + formatUsdAsCurrency(total, 'XOF');
  }
}
function checkout() {
  if (!currentUser) { toggleCart(); showToast(t('dyn_pay_login')); setTimeout(()=>showPage('login'),1200); return; }
  if (cart.length === 0) return;
  toggleCart();
  openPaymentModal();
}
 
// ═══════════════════════════════════════════
// ═══  SYSTÈME DE PAIEMENT MULTI-MÉTHODES ══
// ═══════════════════════════════════════════
 
let selectedPayMethod = null;
let selectedCrypto = 'BTC';
 
const cryptoAddresses = {
  BTC:  'bc1qxy2kgdygjrsqtzq2n0yrf2493402dex3jl8v',
  ETH:  '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
  USDT: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE'
};
const cryptoRates = { BTC: 0.000038, ETH: 0.00055, USDT: 1.0 };
 
function openPaymentModal() {
  renderPaySummary();
  applyPayTranslations();
  document.getElementById('payStep1').style.display = 'block';
  document.getElementById('payStep2').style.display = 'none';
  document.getElementById('payStep3').style.display = 'none';
  document.getElementById('paymentModal').classList.add('show');
}
function closePaymentModal() {
  document.getElementById('paymentModal').classList.remove('show');
  document.getElementById('payStep3').style.display = 'none';
  window._selectedPayCurrency = 'USD';
  // Réinitialiser les boutons PayPal pour la prochaine ouverture
  paypalButtonsRendered = false;
  const container = document.getElementById('paypal-button-container');
  if (container) container.innerHTML = '';
}
 
function renderPaySummary() {
  const total = cartTotalUsd();
  const isEn = currentLang === 'en';

  window._selectedPayCurrency = window._selectedPayCurrency || 'USD';

  function buildSummaryHTML(currency) {
    return `
      <div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:2px;color:var(--cyan);text-transform:uppercase;margin-bottom:10px">
        <i class="fas fa-shopping-bag"></i> ${isEn ? 'Order summary' : 'Récapitulatif'}
      </div>
      ${cart.map(c=>`
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
          <div>
            <div style="font-family:var(--font-display);font-size:0.9rem;color:#fff;letter-spacing:1px">${c.title}</div>
            <div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim)">${c.license} ${isEn?'License':'Licence'} · <span style="color:rgba(0,229,255,0.6)">$${c.price} USD</span></div>
          </div>
          <div style="text-align:right">
            <div style="font-family:var(--font-display);font-size:1rem;color:var(--cyan)">${formatUsdAsCurrency(c.price, currency)}</div>
          </div>
        </div>`).join('')}
      <div style="display:flex;justify-content:space-between;align-items:center;padding-top:12px;font-family:var(--font-display);font-size:1.2rem">
        <span style="color:#fff">Total</span>
        <div style="text-align:right">
          <div style="color:var(--cyan)">${formatUsdAsCurrency(total, currency)}</div>
          ${currency !== 'USD' ? `<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim)">≈ $${total} USD</div>` : `<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim)">≈ ${formatUsdAsCurrency(total, 'XOF')} (GeniusPay)</div>`}
        </div>
      </div>
      <!-- Currency picker -->
      <div style="margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.06)">
        <div style="font-family:var(--font-mono);font-size:0.55rem;letter-spacing:2px;color:var(--text-dim);margin-bottom:8px;text-transform:uppercase">${isEn ? 'Display currency' : 'Afficher en'}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${Object.entries(CURRENCY_RATES).map(([code, info]) => `
            <button onclick="window._selectedPayCurrency='${code}';document.getElementById('paySummaryInner').innerHTML=buildSummaryHTML('${code}')" 
              style="font-family:var(--font-mono);font-size:0.58rem;padding:4px 10px;border-radius:16px;border:1px solid ${code===currency?'var(--cyan)':'rgba(255,255,255,0.12)'};background:${code===currency?'rgba(0,229,255,0.12)':'rgba(255,255,255,0.04)'};color:${code===currency?'var(--cyan)':'rgba(255,255,255,0.6)'};cursor:pointer;transition:all 0.2s" 
              onmouseover="this.style.borderColor='var(--cyan)';this.style.color='var(--cyan)'"
              onmouseout="this.style.borderColor='${code===currency?'var(--cyan)':'rgba(255,255,255,0.12)'}';this.style.color='${code===currency?'var(--cyan)':'rgba(255,255,255,0.6)'}'">
              ${info.flag} ${code}
            </button>`).join('')}
        </div>
        <div style="font-family:var(--font-mono);font-size:0.52rem;color:${getRateChangeClass(currency)};margin-top:8px"><i class="fas fa-info-circle" style="color:var(--cyan)"></i> ${isEn ? '1 USD = ' + CURRENCY_RATES[currency].rate + ' ' + currency : '1 USD = ' + CURRENCY_RATES[currency].rate.toLocaleString('fr-FR') + ' ' + currency}${getRateChangeLabel(currency)}</div>
      </div>`;
  }
 
  // Make buildSummaryHTML accessible from inline onclick
  window.buildSummaryHTML = buildSummaryHTML;
 
  document.getElementById('paySummary').innerHTML = `<div class="pay-summary-inner" id="paySummaryInner">${buildSummaryHTML(window._selectedPayCurrency)}</div>`;
}
 
function selectPayMethod(method) {
  if (!method || typeof method !== 'string') {
    console.warn('selectPayMethod called with invalid method:', method);
    return;
  }
  selectedPayMethod = method;
  document.getElementById('payStep1').style.display = 'none';
  document.getElementById('payStep2').style.display = 'block';
  // Hide all forms
  ['card','paypal','stripe','wave','orange','mtn','moov','cinetpay','crypto','geniuspay'].forEach(m => {
    const el = document.getElementById('payForm'+m.charAt(0).toUpperCase()+m.slice(1));
    if (el) el.style.display = 'none';
  });
  const key = method.charAt(0).toUpperCase() + method.slice(1);
  const form = document.getElementById('payForm'+key);
  if (form) form.style.display = 'block';
  // Update crypto address
  if (method === 'crypto') {
    document.getElementById('cryptoAddress').textContent = cryptoAddresses[selectedCrypto];
    const total = cart.reduce((s,c)=>s+c.price,0);
    const val = (total * cryptoRates[selectedCrypto]).toFixed(6);
    document.getElementById('cryptoAmount').textContent = `${val} ${selectedCrypto}`;
  }
  // ── Init PayPal buttons quand on sélectionne PayPal ──
  if (method === 'paypal') {
    setTimeout(initPayPalButtons, 100);
  }
  applyPayTranslations();
}
 
function backToMethods() {
  document.getElementById('payStep2').style.display = 'none';
  document.getElementById('payStep1').style.display = 'block';
}
 
function selectCrypto(coin, btn) {
  selectedCrypto = coin;
  document.querySelectorAll('.pay-crypto-tab').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('cryptoAddress').textContent = cryptoAddresses[coin];
  const total = cart.reduce((s,c)=>s+c.price,0);
  const val = (total * cryptoRates[coin]).toFixed(6);
  document.getElementById('cryptoAmount').textContent = `${val} ${coin}`;
  const networks = { BTC: 'Bitcoin (BTC)', ETH: 'Ethereum (ERC-20)', USDT: 'Tron (TRC-20)' };
  const isEn = currentLang === 'en';
  document.getElementById('cryptoNetworkLabel').textContent = `${isEn?'Network':'Réseau'} : ${networks[coin]}`;
}
 
function copyCryptoAddr() {
  const addr = cryptoAddresses[selectedCrypto];
  navigator.clipboard.writeText(addr).then(() => {
    showToast(currentLang==='en' ? '✓ Address copied!' : '✓ Adresse copiée !');
  });
}
 
function formatCard(input) {
  let v = input.value.replace(/\D/g,'').slice(0,16);
  input.value = v.replace(/(\d{4})/g,'$1 ').trim();
}
function formatExp(input) {
  let v = input.value.replace(/\D/g,'').slice(0,4);
  if (v.length >= 2) v = v.slice(0,2)+'/'+v.slice(2);
  input.value = v;
}
 
// ═══════════════════════════════════════════════════════
// ═══  CONFIGURATION PAIEMENTS — À REMPLIR            ═══
// ═══════════════════════════════════════════════════════
 
// 🔑 CinetPay — récupère ces valeurs sur dashboard.cinetpay.com
const CINETPAY_APIKEY  = 'VOTRE_APIKEY_CINETPAY';   // ex: "174323661757617531bf99c9.80613927"
const CINETPAY_SITE_ID = 0;                           // ex: 393509  (nombre entier)
const CINETPAY_MODE    = 'TEST';                      // 'TEST' → sandbox | 'PRODUCTION' → vrai argent
 
// 🔑 Firebase Cloud Functions URL (après "firebase deploy --only functions")
const CLOUD_FUNCTIONS_BASE_URL = 'https://YOUR_REGION-je-suis-beatz.cloudfunctions.net';
 
// ═══════════════════════════════════════════════════════
 
async function payCinetPay() {
  const isEn = currentLang === 'en';
  const phoneInput = document.getElementById('cinetPhone');
  const countrySelect = document.getElementById('cinetCountry');
  const fullPhone = (countrySelect?.value || '+225') + (phoneInput?.value?.replace(/\s/g,'') || '');
 
  if (!phoneInput?.value?.trim()) {
    showToast('⚠ ' + (isEn ? 'Enter your phone number' : 'Entrez votre numéro de téléphone'));
    return;
  }
  if (cart.length === 0) { showToast('⚠ ' + (isEn ? 'Your cart is empty' : 'Panier vide')); return; }
 
  const btn = document.getElementById('cinetPayBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${isEn?'Connecting...':'Connexion à CinetPay...'}`; }
 
  const totalUSD   = cartTotalUsd();
  const amountXOF  = convertUsdToXofPayment(totalUSD);
  const transactionId = 'JSB-' + Date.now() + '-' + Math.floor(Math.random()*9999);
  const description = cart.map(c => `${c.title} (${c.license})`).join(', ');
 
  // Sauvegarder la transaction ET la commande en attente dans Firestore
  // Le webhook serveur passera les deux à 'completed'/'SUCCESS'
  try {
    const batch = db.batch();

    // Document transaction (suivi CinetPay)
    batch.set(db.collection('transactions').doc(transactionId), {
      transactionId,
      userId:        currentUser?.uid || 'guest',
      cartItems:     cart,
      totalUSD,
      amountXOF,
      customerEmail: currentUser?.email || '',
      customerPhone: fullPhone,
      status:        'PENDING',
      paymentMethod: 'CinetPay',
      createdAt:     firebase.firestore.FieldValue.serverTimestamp()
    });

    // Document commande (lié à la transaction pour le webhook)
    const orderRef = db.collection('orders').doc();
    batch.set(orderRef, {
      orderId:       transactionId,
      transactionId,
      userId:        currentUser?.uid || 'guest',
      customerEmail: currentUser?.email || '',
      cartItems:     cart,
      total:         totalUSD,
      status:        'pending', // ← uniquement pending côté client
      paymentMethod: 'CinetPay',
      createdAt:     firebase.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();
  } catch(e) { console.warn('Firestore transaction save failed', e); }
 
  try {
    CinetPay.setConfig({
      apikey:     CINETPAY_APIKEY,
      site_id:    CINETPAY_SITE_ID,
      notify_url: `${CLOUD_FUNCTIONS_BASE_URL}/cinetPayWebhook`,
      mode:       CINETPAY_MODE,
    });
 
    CinetPay.getCheckout({
      transaction_id: transactionId,
      amount:      amountXOF,
      currency:    'XOF',
      channels:    'ALL',
      description: `Je Suis Beatz — ${description}`,
      customer_name:         currentUser?.username?.split(' ')[0] || 'Client',
      customer_surname:      currentUser?.username?.split(' ')[1] || 'Beatz',
      customer_email:        currentUser?.email || 'client@jesuis-beatz.com',
      customer_phone_number: fullPhone,
      customer_address:      'Abidjan',
      customer_city:         'Abidjan',
      customer_country:      'CI',
      customer_state:        'CI',
      customer_zip_code:     '00225',
    });
 
    // FAILLE CORRIGÉE : CinetPay.waitResponse ne doit PLUS écrire 'SUCCESS' côté client.
    // Le webhook serveur (cinetpayWebhook) met à jour Firestore via Admin SDK.
    // On écoute simplement le résultat CinetPay pour informer l'UX,
    // puis on interroge la Cloud Function getOrderStatus pour confirmer.
    CinetPay.waitResponse(async function(payData) {
      if (payData.cpm_result === '00') {
        // ✅ CinetPay dit succès — on affiche un écran d'attente
        // La confirmation réelle viendra du webhook serveur (10-30 secondes)
        showPayPendingConfirmation(transactionId, 'cinetpay');
      } else {
        // ❌ Paiement refusé
        showToast('❌ ' + (isEn ? 'Payment refused' : 'Paiement refusé') + (payData.cpm_error_message ? ' : ' + payData.cpm_error_message : ''));
        if (btn) { btn.disabled = false; btn.innerHTML = `<i class="fas fa-coins"></i> <span>${isEn?'Pay with CinetPay':'Payer avec CinetPay'}</span>`; }
      }
    });
 
    CinetPay.onError(function(error) {
      showToast('❌ CinetPay : ' + (error.message || (isEn ? 'Connection error' : 'Erreur de connexion')));
      if (btn) { btn.disabled = false; btn.innerHTML = `<i class="fas fa-coins"></i> <span>${isEn?'Pay with CinetPay':'Payer avec CinetPay'}</span>`; }
    });
 
  } catch(err) {
    showToast('❌ ' + (err.message || (isEn ? 'Server error' : 'Erreur serveur')));
    if (btn) { btn.disabled = false; btn.innerHTML = `<i class="fas fa-coins"></i> <span>${isEn?'Pay with CinetPay':'Payer avec CinetPay'}</span>`; }
  }
}
 
// Vérifier si l'utilisateur revient d'une redirection CinetPay (iOS/mobile)
// CORRIGÉ : on n'affiche plus "Paiement confirmé !" sans vérification serveur
function checkReturnFromCinetPay() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('payment') === 'success' && params.get('tid')) {
    const tid = params.get('tid');
    // Message neutre — la vraie confirmation vient du webhook serveur par email
    showToast(currentLang === 'en'
      ? '⏳ Payment received, verifying... Check your email.'
      : '⏳ Paiement reçu, vérification en cours... Consultez vos emails.'
    );
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

// ═══ GENIUSPAY RETURN HANDLER ═══
function checkReturnFromGeniusPay() {
  const params = new URLSearchParams(window.location.search);
  const paymentId = params.get('payment_id');
  
  if (paymentId) {
    // Récupérer les données de l'order stockées
    const orderData = sessionStorage.getItem('jsb_order_data');
    sessionStorage.removeItem('jsb_payment_id');
    sessionStorage.removeItem('jsb_order_data');
    
    // Afficher un message de vérification
    showToast(currentLang === 'en'
      ? '⏳ Payment received, verifying... Check your email.'
      : '⏳ Paiement reçu, vérification en cours... Consultez vos emails.'
    );
    
    // Nettoyer l'URL
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}
 
// ═══════════════════════════════════════════════════════
// ═══  PAYPAL — Paiement international par carte      ═══
// ═══════════════════════════════════════════════════════
 
let paypalButtonsRendered = false;
 
function initPayPalButtons() {
  if (paypalButtonsRendered) return;
  if (typeof paypal === 'undefined') {
    document.getElementById('paypal-loading').style.display = 'block';
    document.getElementById('paypal-button-container').style.display = 'none';
    showToast('⚠ SDK PayPal non chargé. Vérifiez votre Client ID.');
    return;
  }
 
  paypalButtonsRendered = true;
  document.getElementById('paypal-loading').style.display = 'none';
  document.getElementById('paypal-button-container').style.display = 'block';
 
  paypal.Buttons({
    style: {
      layout:  'vertical',
      color:   'blue',
      shape:   'rect',
      label:   'paypal',
      height:  45
    },
 
    // Création de la commande PayPal
    createOrder: function(data, actions) {
      const total = cart.reduce((s,c) => s+c.price, 0);
      const description = cart.map(c => `${c.title} (${c.license})`).join(', ');
      return actions.order.create({
        purchase_units: [{
          description: `Je Suis Beatz — ${description}`,
          amount: {
            currency_code: 'USD',
            value: total.toFixed(2),
            breakdown: {
              item_total: { currency_code: 'USD', value: total.toFixed(2) }
            }
          },
          items: cart.map(c => ({
            name: `${c.title} — Licence ${c.license}`,
            unit_amount: { currency_code: 'USD', value: c.price.toFixed(2) },
            quantity: '1',
            category: 'DIGITAL_GOODS'
          }))
        }],
        application_context: {
          brand_name: 'Je Suis Beatz',
          locale: currentLang === 'fr' ? 'fr-CI' : 'en-US',
          user_action: 'PAY_NOW'
        }
      });
    },
 
    // Paiement approuvé par l'utilisateur
    onApprove: async function(data, actions) {
      showToast('⏳ ' + t('pay_validating'));
      try {
        const details = await actions.order.capture();
        const paypalOrderId = details.id;
        const orderId = 'JSB-PP-' + paypalOrderId;

        // FAILLE CORRIGÉE : statut 'pending' uniquement côté client.
        // Le webhook PayPal serveur (Cloud Function) passera à 'completed'
        // après vérification de la signature PayPal.
        await db.collection('orders').add({
          orderId,
          transactionId:  paypalOrderId,
          paypalOrderId,
          userId:         currentUser?.uid || 'guest',
          customerEmail:  currentUser?.email || details.payer?.email_address || '',
          cartItems:      cart,
          total:          cart.reduce((s,c) => s+c.price, 0),
          status:         'pending',
          paymentMethod:  'PayPal',
          createdAt:      firebase.firestore.FieldValue.serverTimestamp()
        });

        // Afficher l'écran d'attente — pas de succès immédiat
        showPayPendingConfirmation(orderId, 'paypal');
        paypalButtonsRendered = false;
      } catch(err) {
        showToast('❌ ' + t('pay_validation_error') + ': ' + err.message);
      }
    },
 
    // Paiement annulé
    onCancel: function() {
      showToast(t('pay_cancelled'));
    },
 
    // Erreur PayPal
    onError: function(err) {
      console.error('PayPal error:', err);
      showToast('❌ PayPal : ' + t('pay_error'));
    }
  }).render('#paypal-button-container');
}
 
// ═══════════════════════════════════════════════════════
// ═══  simulatePay — CORRIGÉ : méthodes non implémentées
// ═══  Les méthodes ci-dessous affichent un message clair
// ═══  au lieu de simuler un faux paiement réussi.
// ═══════════════════════════════════════════════════════
function simulatePay(method) {
  if (method === 'geniuspay') {
    // Intégration GeniusPay réelle
    processGeniusPayment();
    return;
  }

  const isEn = currentLang === 'en';

  // FAILLE CORRIGÉE : Ces méthodes ne sont pas encore intégrées.
  // On informe l'utilisateur de contacter directement le vendeur.
  // Aucune commande n'est créée, aucun paiement n'est simulé.
  const methodLabels = {
    card:       isEn ? 'Credit Card (Visa/Mastercard)' : 'Carte Bancaire (Visa/Mastercard)',
    stripe:     'Stripe',
    apple_pay:  'Apple Pay',
    google_pay: 'Google Pay',
    wave:       'Wave',
    orange:     'Orange Money',
    mtn:        'MTN MoMo',
    moov:       'Moov Money',
    crypto:     'Crypto'
  };

  const label = methodLabels[method] || method;

  // Afficher un modal d'information (pas de succès !)
  const isEn2 = currentLang === 'en';
  const btn = document.querySelector('.pay-submit-btn');
  if (btn) { btn.disabled = false; }

  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
    <div style="background:#0f0f1a;border:1px solid rgba(255,165,0,0.4);border-radius:20px;padding:32px;max-width:440px;width:100%;text-align:center">
      <div style="font-size:2.5rem;margin-bottom:16px">⚙️</div>
      <div style="font-family:var(--font-display);font-size:1.3rem;color:#f59e0b;letter-spacing:2px;margin-bottom:12px">
        ${isEn2 ? 'Integration in progress' : 'Intégration en cours'}
      </div>
      <p style="color:rgba(255,255,255,0.7);font-size:0.9rem;line-height:1.6;margin-bottom:20px">
        ${isEn2
          ? `<strong>${label}</strong> is not yet integrated. Please contact us directly to finalize your purchase.`
          : `<strong>${label}</strong> n'est pas encore intégré. Contactez-nous directement pour finaliser votre achat.`
        }
      </p>
      <a href="mailto:jesuisthebeatmaker@gmail.com?subject=Achat%20beat%20-%20${encodeURIComponent(label)}&body=Bonjour%2C%20je%20souhaite%20acheter%20%3A%20${encodeURIComponent(cart.map(c=>c.title+' ('+c.license+')').join(', '))}"
         style="display:inline-block;background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:0.9rem;margin-bottom:12px">
        <i class="fas fa-envelope"></i> ${isEn2 ? 'Contact by email' : 'Contacter par email'}
      </a>
      <br>
      <button onclick="this.closest('div[style*=\"fixed\"]').remove()"
        style="background:none;border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.6);padding:8px 20px;border-radius:8px;cursor:pointer;margin-top:8px;font-size:0.85rem">
        ${isEn2 ? 'Choose another method' : 'Choisir une autre méthode'}
      </button>
    </div>`;
  document.body.appendChild(modal);
}

// ═══ GENIUSPAY PAYMENT INTEGRATION ═══
async function processGeniusPayment() {
  try {
    // Validation
    if (!currentUser) {
      showToast(t('dyn_pay_login'));
      return;
    }
    if (cart.length === 0) return;

    const totalUSD = cartTotalUsd();
    const amountXOF = convertUsdToXofPayment(totalUSD);
    const isEn = currentLang === 'en';

    if (amountXOF < 200) {
      showToast('⚠ ' + (isEn ? 'Minimum amount is 200 FCFA' : 'Montant minimum : 200 FCFA'));
      return;
    }

    // Afficher un loading
    showToast('⏳ ' + (isEn ? 'Processing payment...' : 'Traitement du paiement...'));

    const licenseSummary = cart.map(c => `${c.title} (${c.license} · $${c.price})`).join(', ');

    // Préparer les données de commande — GeniusPay attend le montant en XOF entier (pas en centimes)
    const orderData = {
      amount: amountXOF,
      currency: 'XOF',
      customer_phone: '+225' + (currentUser.phone || '0707000000'),
      customer_name: currentUser.username || 'Customer',
      customer_email: currentUser.email,
      description: `Je Suis Beatz — ${licenseSummary}`,
      items: cart.map(c => ({
        name: `${c.title} — ${c.license}`,
        quantity: 1,
        unit_price: convertUsdToXofPayment(c.price),
        description: `${c.license} License · $${c.price} USD`
      })),
      metadata: {
        total_usd: totalUSD,
        total_xof: amountXOF,
        cart: cart.map(c => ({ title: c.title, license: c.license, price_usd: c.price, price_xof: convertUsdToXofPayment(c.price) }))
      },
      // URLs de callback
      success_url: GENIUSPAY_CONFIG.successURL,
      failure_url: GENIUSPAY_CONFIG.failureURL
    };

    // Appel serveur (Cloud Function) pour créer le paiement en toute sécurité
    let data = null;
    let checkoutUrl = null;

    const cfUrl = GENIUSPAY_CONFIG.cloudFunctionURL.replace(/\/$/, '') + '/createGeniusPayment';
    if (GENIUSPAY_CONFIG.cloudFunctionURL && !GENIUSPAY_CONFIG.cloudFunctionURL.includes('YOUR_REGION')) {
      try {
        const response = await fetch(cfUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderData })
        });

        if (!response.ok) {
          const errBody = await response.text().catch(() => null);
          throw new Error(`GeniusPay proxy error: ${response.status} ${errBody||''}`);
        }

        data = await response.json();
        checkoutUrl = data.checkout_url || (data.payment && data.payment.checkout_url);
      } catch (httpErr) {
        console.warn('GeniusPay proxy failed, falling back to callable function:', httpErr);
      }
    }

    if (!checkoutUrl) {
      try {
        const result = await callCloudFunction('createGeniusPayment', { orderData });
        data = result.data || {};
        checkoutUrl = data.checkout_url || (data.payment && data.payment.checkout_url);
      } catch (callErr) {
        throw new Error('GeniusPay Cloud Function failed: ' + (callErr.message || callErr));
      }
    }

    if (checkoutUrl) {
      sessionStorage.setItem('jsb_payment_id', data.orderId || (data.payment && data.payment.id) || '');
      sessionStorage.setItem('jsb_order_data', JSON.stringify(orderData));
      window.location.href = checkoutUrl;
    } else {
      throw new Error('No checkout_url returned from server');
    }
  } catch (error) {
    console.error('GeniusPay payment error:', error);
    showToast('❌ ' + (currentLang === 'en' ? 'Payment failed' : 'Le paiement a échoué'));
    closePaymentModal();
  }
}

// FAILLE CORRIGÉE : showPaySuccess remplacée par showPayPendingConfirmation.
// On n'affiche plus un faux "Paiement réussi !" immédiat côté client.
// On affiche un écran d'attente pendant que le webhook serveur confirme.
async function showPayPendingConfirmation(orderId, method) {
  const isEn = currentLang === 'en';
  const total = cart.reduce((s,c)=>s+c.price,0);

  const methodNames = {
    paypal:'PayPal', cinetpay:'CinetPay',
    card: isEn?'Credit Card':'Carte Bancaire'
  };

  document.getElementById('payStep2').style.display = 'none';
  document.getElementById('payStep3').style.display = 'block';

  document.getElementById('paySuccessTitle').textContent =
    isEn ? '⏳ Verifying payment...' : '⏳ Vérification en cours...';
  document.getElementById('paySuccessMsg').textContent =
    isEn
      ? 'Your payment has been received. We are verifying it with the payment provider. You will receive a download link by email at ' + (currentUser?.email || 'your address') + ' once confirmed (usually under 2 minutes).'
      : 'Votre paiement a été reçu. Nous le vérifions auprès du prestataire. Vous recevrez le lien de téléchargement par email à ' + (currentUser?.email || 'votre adresse') + ' après confirmation (généralement en moins de 2 minutes).';

  document.getElementById('paySuccessOrder').innerHTML = `
    <div style="background:rgba(0,229,255,0.05);border:1px solid rgba(0,229,255,0.2);border-radius:12px;padding:16px;margin-top:16px;font-family:var(--font-mono);font-size:0.68rem">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <span style="color:var(--text-dim)">${isEn?'Order ID':'N° commande'}</span>
        <span style="color:var(--cyan)">${orderId}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <span style="color:var(--text-dim)">${isEn?'Amount':'Montant'}</span>
        <span style="color:#fff">$${total}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <span style="color:var(--text-dim)">${isEn?'Method':'Méthode'}</span>
        <span style="color:#fff">${methodNames[method]||method}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="color:var(--text-dim)">Status</span>
        <span style="color:#f59e0b" id="orderStatusBadge">
          <i class="fas fa-spinner fa-spin"></i>
          ${isEn?'Pending server confirmation':'En attente de confirmation serveur'}
        </span>
      </div>
    </div>
    <div style="margin-top:16px;font-family:var(--font-mono);font-size:0.62rem;color:var(--text-dim);text-align:center">
      <i class="fas fa-shield-alt" style="color:var(--cyan)"></i>
      ${isEn
        ? 'Payment verified server-side — your beat will only be delivered after real confirmation.'
        : 'Paiement vérifié côté serveur — votre beat ne sera livré qu\'après confirmation réelle.'}
    </div>`;

  document.getElementById('paySuccessBtn').textContent =
    isEn ? 'Keep listening' : 'Continuer l\'écoute';

  // Vider le panier uniquement après que la commande est enregistrée
  cart = [];
  if (currentUser?.uid) {
    await db.collection('carts').doc(currentUser.uid)
      .set({items:[], updatedAt: firebase.firestore.FieldValue.serverTimestamp()})
      .catch(()=>{});
  }
  localStorage.setItem('jsb_cart2', '[]');
  updateCartBadge();

  // Polling léger : vérifier le statut toutes les 5s pendant 3 minutes max
  // via la Cloud Function getOrderStatus (lecture sécurisée)
  if (currentUser?.uid) {
    let attempts = 0;
    const maxAttempts = 36; // 3 minutes
    const pollInterval = setInterval(async () => {
      attempts++;
      try {
        const getStatus = cloudFunctions().httpsCallable('getOrderStatus');
        const result = await getStatus({ orderId });
        const status = result.data?.status;

        if (status === 'completed') {
          clearInterval(pollInterval);
          const badge = document.getElementById('orderStatusBadge');
          if (badge) badge.innerHTML = `<span style="color:#4ade80">✅ ${isEn?'Confirmed! Check your email.':'Confirmé ! Vérifiez vos emails.'}</span>`;
          const titleEl = document.getElementById('paySuccessTitle');
          if (titleEl) titleEl.textContent = isEn ? '✅ Payment confirmed!' : '✅ Paiement confirmé !';
          showToast(isEn ? '🎵 Your beat is on its way!' : '🎵 Votre beat arrive dans votre boîte mail !');
        }

        if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
          const badge = document.getElementById('orderStatusBadge');
          if (badge) badge.innerHTML = `<span style="color:#f59e0b">⏳ ${isEn?'Check your email in a few minutes.':'Vérifiez vos emails dans quelques minutes.'}</span>`;
        }
      } catch(e) {
        // Silencieux — le webhook serveur reste la source de vérité
      }
    }, 5000);
  }
}

// Conservé pour rétrocompatibilité interne (appelé nulle part en production)
async function showPaySuccess(method, transactionId) {
  return showPayPendingConfirmation(transactionId || ('JSB-'+Date.now()), method);
}


 
function applyPayTranslations() {
  const isEn = currentLang === 'en';
  const setTxt = (id, fr, en) => { const el=document.getElementById(id); if(el) el.textContent = isEn?en:fr; };
  const setHtml = (id, fr, en) => { const el=document.getElementById(id); if(el) el.innerHTML = isEn?en:fr; };
  setTxt('payModalTitle', 'Choisir un moyen de paiement', 'Choose a payment method');
  setTxt('payLblIntl', 'Paiement', 'Payment');
  setTxt('payLblAfrica', 'Mobile Money — Afrique', 'Mobile Money — Africa');
  setTxt('paySecureLabel', 'Paiement 100% sécurisé · Livraison digitale immédiate', '100% secure payment · Instant digital delivery');
  setTxt('payBackLabel', 'Retour', 'Back');
  setTxt('paypalLoadingTxt', 'Chargement PayPal...', 'Loading PayPal...');
  // Card
  setTxt('payCardTitle', 'Carte Bancaire', 'Credit Card');
  setTxt('lblCardName', 'Nom sur la carte', 'Name on card');
  setTxt('lblCardNum', 'Numéro de carte', 'Card number');
  setTxt('lblCardExp', 'Expiration', 'Expiry');
  setTxt('payNoteCard', 'En cliquant, vous acceptez les conditions de vente. Transaction sécurisée via SSL.', 'By clicking, you accept the terms of sale. SSL secured transaction.');
  // PayPal
  setTxt('payPaypalMsg', 'Vous allez être redirigé vers PayPal pour finaliser votre paiement en toute sécurité.', 'You will be redirected to PayPal to complete your payment securely.');
  setTxt('lblPaypalEmail', 'Email PayPal', 'PayPal email');
  setTxt('payPaypalBtn', 'Continuer avec PayPal', 'Continue with PayPal');
  // Stripe
  setTxt('lblStripeCard', 'Numéro de carte', 'Card number');
  setTxt('lblStripeExp', 'Expiration', 'Expiry');
  setTxt('payOrLabel', 'ou payer par carte', 'or pay by card');
  setTxt('payStripeBtnLabel', 'Payer avec Stripe', 'Pay with Stripe');
  // Wave
  setTxt('payWaveMsg', 'Entrez votre numéro Wave pour recevoir une demande de paiement sur votre application.', 'Enter your Wave number to receive a payment request on your app.');
  setTxt('lblWavePhone', 'Numéro de téléphone Wave', 'Wave phone number');
  setTxt('payWaveBtn', 'Payer avec Wave', 'Pay with Wave');
  // Orange
  setTxt('payOrangeMsg', 'Entrez votre numéro Orange Money pour recevoir une demande de paiement.', 'Enter your Orange Money number to receive a payment request.');
  setTxt('lblOrangePhone', 'Numéro Orange Money', 'Orange Money number');
  setTxt('lblOrangePin', 'Code PIN Orange Money', 'Orange Money PIN');
  setTxt('payOrangeBtn', 'Payer avec Orange Money', 'Pay with Orange Money');
  // MTN
  setTxt('payMtnMsg', 'Entrez votre numéro MTN MoMo pour recevoir une demande de paiement.', 'Enter your MTN MoMo number to receive a payment request.');
  setTxt('lblMtnPhone', 'Numéro MTN MoMo', 'MTN MoMo number');
  setTxt('payMtnBtn', 'Payer avec MTN MoMo', 'Pay with MTN MoMo');
  // Moov
  setTxt('payMoovMsg', 'Entrez votre numéro Moov pour recevoir une demande de paiement.', 'Enter your Moov number to receive a payment request.');
  setTxt('lblMoovPhone', 'Numéro Moov Money', 'Moov Money number');
  setTxt('payMoovBtn', 'Payer avec Moov Money', 'Pay with Moov Money');
  // CinetPay
  setTxt('payCinetMsg', 'CinetPay regroupe tous les moyens de paiement mobile africains en un seul endroit.', 'CinetPay aggregates all African mobile payment methods in one place.');
  setTxt('lblCinetPhone', 'Numéro de téléphone', 'Phone number');
  setTxt('payCinetBtn', 'Payer avec CinetPay', 'Pay with CinetPay');
  setTxt('payGeniusMsg', 'Payez avec GeniusPay pour un paiement rapide et sécurisé.', 'Pay with GeniusPay for the fastest and most secure checkout.');
  setTxt('payGeniusBtnLabel', 'Payer avec GeniusPay', 'Pay with GeniusPay');
  setTxt('payGeniusNote', 'Si GeniusPay est indisponible, contactez le support.', 'If GeniusPay is unavailable, contact support.');
  // Crypto
  setTxt('payCryptoMsg', "Choisissez votre cryptomonnaie et envoyez le montant exact à l'adresse indiquée.", 'Choose your cryptocurrency and send the exact amount to the address shown.');
  setTxt('lblCopyCrypto', "Copier l'adresse", 'Copy address');
  setTxt('cryptoAmountLabel', 'Montant à envoyer :', 'Amount to send:');
  setTxt('payCryptoBtn', "J'ai effectué le virement", 'I have sent the payment');
  setTxt('payNoteCrypto', 'Le paiement crypto est vérifié manuellement. Vous recevrez votre beat sous 1h après confirmation.', 'Crypto payments are manually verified. You will receive your beat within 1h of confirmation.');
  // Update card pay button amount
  const total = cart.reduce ? cart.reduce((s,c)=>s+c.price,0) : 0;
  const payCardBtnLabel = document.getElementById('payCardBtnLabel');
  if (payCardBtnLabel) payCardBtnLabel.textContent = isEn ? 'Pay' : 'Payer';
}
 
document.getElementById('paymentModal').addEventListener('click', e=>{if(e.target===e.currentTarget)closePaymentModal();});
 
// ═══ AUTH ═══
// Attend que le custom claim admin soit actif dans le token Firebase
async function waitForAdminClaim(firebaseUser, maxAttempts = 4) {
  for (let i = 0; i < maxAttempts; i++) {
    await firebaseUser.getIdToken(true);
    const tokenResult = await firebaseUser.getIdTokenResult();
    if (tokenResult.claims.admin === true) return true;
    if (i < maxAttempts - 1) await new Promise(r => setTimeout(r, 800));
  }
  return false;
}

// Active le rôle admin côté serveur
async function activateAdminRole(firebaseUser) {
  if (!firebaseUser) return false;

  // Vérifier document admins (lecture autorisée pour son propre uid)
  try {
    const adminDoc = await db.collection('admins').doc(firebaseUser.uid).get();
    if (adminDoc.exists) {
      const adminData = adminDoc.data();
      if (adminData.isAdmin === true || adminData.admin === true) {
        if (adminData.admin === true && adminData.isAdmin !== true) {
          await db.collection('admins').doc(firebaseUser.uid).set({ isAdmin: true }, { merge: true });
        }
        return true;
      }
    }
  } catch (e) { /* ignore */ }

  for (let i = 0; i < 3; i++) {
    try {
      await firebaseUser.getIdToken(true);
      const result = await callCloudFunction('ensureAdminClaim');
      if (result.data?.isAdmin === true) return true;
    } catch (e) {
      console.warn('ensureAdminClaim', i + 1, e.message);
    }
    if (i < 2) await new Promise(r => setTimeout(r, 800));
  }

  if (isOwnerEmail(firebaseUser.email)) {
    try {
      await callCloudFunction('setAdminClaim', { email: OWNER_ADMIN_EMAIL });
      const adminDoc = await db.collection('admins').doc(firebaseUser.uid).get();
      if (adminDoc.exists && adminDoc.data().isAdmin === true) return true;
      const result = await callCloudFunction('ensureAdminClaim');
      if (result.data?.isAdmin === true) return true;
    } catch (e) {
      console.warn('setAdminClaim:', e.message);
    }
    return true;
  }

  return false;
}

// Synchronise le rôle admin via Cloud Function (source de vérité serveur)
async function syncAdminRole(firebaseUser) {
  return activateAdminRole(firebaseUser);
}

// Sanitisation XSS — échappe les caractères dangereux
function sanitize(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(String(str||'')));
  return div.innerHTML;
}
function sanitizeIconClass(icon) {
  const val = String(icon || '').trim();
  return /^(fa[srb]?\s+fa-[a-z0-9-]+)(\s+fa-[a-z0-9-]+)*$/i.test(val) ? val : '';
}
function safeImageUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const normalized = url.trim();
  if (!/^https:\/\//i.test(normalized)) return '';
  try {
    return new URL(normalized).toString();
  } catch (err) {
    return normalized.replace(/ /g, '%20');
  }
}
// Validation email simple
function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
// Validation username (alphanumérique + tirets, 3-20 chars)
function isValidUsername(u) { return /^[a-zA-Z0-9_\-]{3,20}$/.test(u); }
 
async function doLogin() {
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value;
  const err = document.getElementById('loginErr');
  err.style.display = 'none';
  if (!u || !p) { err.textContent = t('err_all_fields'); err.style.display = 'block'; return; }
  if (!localStorage.getItem('jsb_last_page_before_login')) {
    const currentPageEl = document.querySelector('.page.active');
    const currentPage = currentPageEl ? currentPageEl.id.replace('page-', '') : 'home';
    localStorage.setItem('jsb_last_page_before_login', currentPage);
  }

  try {
    let email = u;

    // FAILLE CORRIGÉE : plus de lecture directe de /users par username.
    // On passe par la Cloud Function qui ne retourne que l'email
    // et ne permet pas d'énumérer les utilisateurs.
    if (!isValidEmail(u)) {
      try {
        const getUserEmail = cloudFunctions().httpsCallable('getUserEmailByUsername');
        const result = await getUserEmail({ username: u });
        email = result.data.email;
      } catch(fnErr) {
        // Délai intentionnel pour éviter le timing attack (brute force)
        recordLoginAttempt(u);
        await new Promise(r => setTimeout(r, 600));
        err.textContent = t('err_wrong_creds');
        err.style.display = 'block';
        return;
      }
    }

    const cred = await auth.signInWithEmailAndPassword(email, p);
    const uid = cred.user.uid;

    // ✅ SÉCURITÉ : Vérifier que l'email est confirmé
    if (!cred.user.emailVerified) {
      let verificationResent = true;
      let verificationError = null;
      try {
        await cred.user.sendEmailVerification(getVerificationActionSettings());
        console.log('Email de vérification renvoyé à:', cred.user.email);
      } catch (e) {
        verificationResent = false;
        verificationError = e;
        console.warn('Erreur lors de l\'envoi de l\'email de vérification:', e);
      }

      if (!verificationResent) {
        err.textContent = `${t('login_verify_resend_error')} ${sanitize(verificationError?.message || verificationError?.code || '')}`.trim();
        err.style.display = 'block';
        return;
      }

      err.textContent = t('login_verify_required').replace('%s', sanitize(cred.user.email));
      err.style.display = 'block';
      return;
    }

    // Effacer les tentatives de connexion réussies
    clearLoginAttempts(u);

    const ownerAccount = isOwnerEmail(cred.user.email || email);
    currentUser = {
      username: sanitize(u),
      email: cred.user.email || email,
      role: ownerAccount ? 'admin' : 'user',
      uid
    };
    sessionStorage.setItem('jsb_user2', JSON.stringify(currentUser));
    updateAuth();

    const ok = document.getElementById('loginOk');
    ok.textContent = t('dyn_login_welcome').replace('%s', sanitize(currentUser.username));
    ok.style.display = 'block';
    ok.style.opacity = '1';
    ok.style.marginBottom = '20px';

    // Ne pas masquer immédiatement la carte de connexion.
    // L'utilisateur voit clairement le succès avant d'aller sur home.
    setTimeout(() => {
      const nextPage = localStorage.getItem('jsb_last_page_before_login') || (currentUser.role === 'admin' ? 'admin' : 'home');
      localStorage.removeItem('jsb_last_page_before_login');
      showPage(nextPage);
    }, 1200);

    showToast(t('dyn_login_welcome').replace('%s', sanitize(currentUser.username)));

    Promise.allSettled([
      syncAdminRole(cred.user).then((isAdmin) => {
        if (isAdmin && currentUser) {
          currentUser.role = 'admin';
          sessionStorage.setItem('jsb_user2', JSON.stringify(currentUser));
          updateAuth();
          renderAll();
          if (window.location.hash !== '#admin') showAdminPage();
        }
      }).catch(e => console.warn('syncAdminRole failed:', e)),
      db.collection('users').doc(uid).get().then((doc) => {
        if (doc.exists) {
          const userData = doc.data();
          if (userData?.username) {
            currentUser.username = sanitize(userData.username);
            sessionStorage.setItem('jsb_user2', JSON.stringify(currentUser));
          }
        }
      }).catch(e => console.warn('load user profile failed:', e)),
      loadCartFromFirestore(uid).then((cartData) => {
        cart = cartData;
        updateCartBadge();
      }).catch(e => console.warn('loadCartFromFirestore failed:', e))
    ]);
  } catch(ex) {
    recordLoginAttempt(u);
    await new Promise(r => setTimeout(r, 600)); // anti-brute force timing
    err.textContent = t('err_wrong_creds');
    err.style.display = 'block';
  }
}
async function resendVerificationEmail() {
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value;
  const err = document.getElementById('loginErr');
  const ok = document.getElementById('loginOk');
  err.style.display = 'none';
  ok.style.display = 'none';

  if (!u || !p) {
    err.textContent = t('login_resend_enter_credentials');
    err.style.display = 'block';
    return;
  }

  let email = u;
  if (!isValidEmail(u)) {
    try {
      const getUserEmail = cloudFunctions().httpsCallable('getUserEmailByUsername');
      const result = await getUserEmail({ username: u.toLowerCase() });
      email = result.data.email;
    } catch (fnErr) {
      err.textContent = t('login_resend_username_not_found');
      err.style.display = 'block';
      return;
    }
  }

  try {
    const cred = await auth.signInWithEmailAndPassword(email, p);
    if (cred.user.emailVerified) {
      ok.textContent = t('login_already_verified');
      ok.style.display = 'block';
      ok.style.opacity = '1';
      ok.style.color = '#00d084';
      await auth.signOut();
      return;
    }

    try {
      await cred.user.sendEmailVerification(getVerificationActionSettings());
      ok.textContent = t('login_verification_resent').replace('%s', sanitize(email));
      ok.style.display = 'block';
      ok.style.opacity = '1';
      ok.style.color = '#00d084';
    } catch (e) {
      console.warn('Erreur lors de l\'envoi du mail de vérification:', e);
      err.textContent = `${t('login_verify_resend_error')} ${sanitize(e.message || e.code || '')}`.trim();
      err.style.display = 'block';
    } finally {
      await auth.signOut();
    }
  } catch (ex) {
    recordLoginAttempt(u);
    await new Promise((r) => setTimeout(r, 600));
    err.textContent = ex.code === 'auth/wrong-password' ? 'Mot de passe incorrect.' : t('err_wrong_creds');
    err.style.display = 'block';
  }
}
async function doRegister() {
  const u   = document.getElementById('regUser').value.trim();
  const e   = document.getElementById('regEmail').value.trim();
  const p   = document.getElementById('regPass').value;
  const err = document.getElementById('loginErr');
  err.style.display = 'none';
  if (!u||!e||!p) { err.textContent=t('err_all_fields'); err.style.display='block'; return; }
  if (!isValidUsername(u)) { err.textContent=t('err_username_format'); err.style.display='block'; return; }
  if (!isValidEmail(e))    { err.textContent=t('err_invalid_email');  err.style.display='block'; return; }
  if (p.length < 8)        { err.textContent=t('err_pwd_short');      err.style.display='block'; return; }
  if (!/[A-Z]/.test(p)||!/[0-9]/.test(p)) { err.textContent=t('err_pwd_format'); err.style.display='block'; return; }

  try {
    // FAILLE CORRIGÉE : vérification username via Cloud Function (pas de lecture directe /users)
    // Si la CF trouve l'email → username pris. Si elle lève une erreur 'not-found' → libre.
    try {
      const checkFn = cloudFunctions().httpsCallable('getUserEmailByUsername');
      await checkFn({ username: u.toLowerCase() });
      // Si on arrive ici → username déjà pris
      err.textContent = t('err_username_taken');
      err.style.display = 'block';
      return;
    } catch(fnErr) {
      if (fnErr.code !== 'functions/not-found') {
        // Erreur inattendue — on laisse continuer (meilleure expérience, Firebase Auth bloquera si besoin)
        console.warn('Username check warning:', fnErr.code);
      }
      // code === 'not-found' → username disponible, on continue
    }

    // Créer le compte Firebase Auth
    const cred = await auth.createUserWithEmailAndPassword(e, p);
    const uid  = cred.user.uid;

    const userData = {
      username:  sanitize(u),
      email:     sanitize(e),
      role:      'user',
      uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      emailVerified: false  // ✅ Tracer l'état de vérification
    };
    await db.collection('users').doc(uid).set(userData);

    // ✅ SÉCURITÉ : Envoyer automatiquement l'email de vérification
    let verificationSent = true;
    let verificationError = null;
    try {
      await cred.user.sendEmailVerification(getVerificationActionSettings());
    } catch (emailErr) {
      verificationSent = false;
      verificationError = emailErr;
      console.warn('Erreur lors de l\'envoi de l\'email de vérification:', emailErr);
    }

    if (!verificationSent) {
      err.textContent = `${t('login_verify_send_failed')} ${sanitize(verificationError?.message || verificationError?.code || '')}`.trim();
      err.style.display = 'block';
      return;
    }

    const ok = document.getElementById('loginOk');
    ok.textContent = t('login_verify_sent').replace('%s', sanitize(e));
    ok.style.display = 'block';
    ok.style.opacity = '1';
    ok.style.marginBottom = '20px';
    ok.style.color = '#00d084';

    showToast('📧 Vérifiez votre email pour continuer!');
  } catch(ex) {
    const msg = ex.code === 'auth/email-already-in-use' ? t('err_email_taken') : ex.message;
    err.textContent = msg;
    err.style.display = 'block';
  }
}
async function logout() {
 try { await auth.signOut(); } catch(e) {}
  currentUser=null; cart=[]; sessionStorage.removeItem('jsb_user2'); updateAuth(); showPage('home'); showToast(t('dyn_disconnected')); updateCartBadge();
}
function updateAuth() {
  document.getElementById('authBtn').style.display = currentUser ? 'none' : 'flex';
  document.getElementById('logoutBtn').style.display = currentUser ? 'flex' : 'none';
  const firebaseEmail = auth.currentUser?.email || currentUser?.email || '';
  const showAdmin = (currentUser && currentUser.role === 'admin') || isOwnerEmail(firebaseEmail);
  document.getElementById('adminBtn').style.display = showAdmin ? 'flex' : 'none';
  const showAccountBtn = currentUser && !showAdmin;
  const accountBtn = document.getElementById('accountBtn');
  if (accountBtn) {
    accountBtn.style.display = showAccountBtn ? 'flex' : 'none';
  }
  if (currentUser) {
    const avatarUrl = safeImageUrl(currentUser.photoURL);
    if (accountBtn) {
      accountBtn.innerHTML = avatarUrl
        ? `<img class="nav-account-avatar" src="${avatarUrl}" alt="Avatar de ${sanitize(currentUser.username)}">`
        : '<i class="fas fa-user-circle"></i>';
    }
    document.getElementById('logoutName').textContent = sanitize(currentUser.username);
  } else {
    if (accountBtn) accountBtn.innerHTML = '<i class="fas fa-user-circle"></i>';
  }
  renderStats();
  if (document.getElementById('page-beats')?.classList.contains('active') || document.getElementById('page-admin')?.classList.contains('active')) {
    renderAll();
  }
}

// ✅ SÉCURITÉ : À l'init, on revalide le token Firebase si l'user est déjà connecté
auth.onAuthStateChanged(async (firebaseUser) => {
  if (firebaseUser) {
    try {
      const isAdmin = await syncAdminRole(firebaseUser);
      let stored = JSON.parse(sessionStorage.getItem('jsb_user2') || 'null');
      let userData = {};
      if (!stored || stored.uid !== firebaseUser.uid || !stored.photoURL) {
        const doc = await db.collection('users').doc(firebaseUser.uid).get();
        userData = doc.exists ? doc.data() : {};
      }
      if (!stored || stored.uid !== firebaseUser.uid) {
        stored = {
          username: sanitize(userData.username || firebaseUser.email),
          email: firebaseUser.email,
          photoURL: userData.photoURL || firebaseUser.photoURL || '',
          role: (isAdmin || isOwnerEmail(firebaseUser.email)) ? 'admin' : 'user',
          uid: firebaseUser.uid,
        };
      } else {
        stored.role = (isAdmin || isOwnerEmail(firebaseUser.email)) ? 'admin' : 'user';
        stored.email = firebaseUser.email || stored.email;
        stored.photoURL = stored.photoURL || userData.photoURL || firebaseUser.photoURL || '';
      }
      currentUser = stored;
      sessionStorage.setItem('jsb_user2', JSON.stringify(currentUser));
      cart = await loadCartFromFirestore(firebaseUser.uid);
      updateCartBadge();
      updateAuth();
    } catch (e) { console.warn('Token refresh failed:', e); }
  } else {
    // Firebase dit que personne n'est connecté : nettoyer
    if (currentUser) {
      currentUser = null;
      sessionStorage.removeItem('jsb_user2');
      updateAuth();
    }
  }
});
function toggleRegister() {
  const lf=document.getElementById('loginForm'), rf=document.getElementById('registerForm');
  document.getElementById('loginErr').style.display='none';
  if(lf.style.display==='none'){lf.style.display='block';rf.style.display='none';document.getElementById('loginTitle').textContent=t('login_title');document.getElementById('loginSub').textContent=t('login_sub');}
  else{lf.style.display='none';rf.style.display='block';document.getElementById('loginTitle').textContent=t('reg_title');document.getElementById('loginSub').textContent=t('reg_sub');}
}
async function changePwd() {
  const o = document.getElementById('oldPwd').value;
  const n = document.getElementById('newPwd').value;
  if (n.length < 6) { showToast('⚠ ' + t('err_pwd_too_short')); return; }
  // ✅ SÉCURITÉ : Changement de mot de passe via Firebase Auth — jamais en localStorage
  try {
    const user = auth.currentUser;
    if (!user) { showToast('⚠ Non connecté'); return; }
    // Re-authentification requise avant changement de mot de passe
    const cred = firebase.auth.EmailAuthProvider.credential(user.email, o);
    await user.reauthenticateWithCredential(cred);
    await user.updatePassword(n);
    document.getElementById('oldPwd').value = '';
    document.getElementById('newPwd').value = '';
    showToast('✓ ' + t('admin_pwd_changed'));
  } catch(e) {
    if (e.code === 'auth/wrong-password') showToast('⚠ ' + t('err_wrong_pwd'));
    else showToast('⚠ ' + (e.message || 'Erreur'));
  }
}
 
// ═══ NAVIGATION ═══
function showPage(name) {
  if (name === 'admin') {
    const firebaseEmail = auth.currentUser?.email || currentUser?.email || '';
    const isOwnAdmin = isOwnerEmail(firebaseEmail);
    if (!((currentUser && currentUser.role === 'admin') || isOwnAdmin)) {
      localStorage.setItem('jsb_last_page_before_login', name);
      showPage('login');
      return;
    }
  }
  if (name === 'account') {
    if (!currentUser && !auth.currentUser) {
      localStorage.setItem('jsb_last_page_before_login', name);
      showPage('login');
      return;
    }
    if (!currentUser && auth.currentUser) {
      currentUser = {
        uid: auth.currentUser.uid,
        email: auth.currentUser.email,
        username: auth.currentUser.displayName || auth.currentUser.email?.split('@')[0] || 'Utilisateur',
        role: isOwnerEmail(auth.currentUser.email) ? 'admin' : 'user'
      };
      sessionStorage.setItem('jsb_user2', JSON.stringify(currentUser));
      updateAuth();
    }
  }
  if (name === 'community') {
    communityTab('profiles');
  }
  if (name === 'login') rememberLastPageBeforeLogin();
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-links a').forEach(a=>a.classList.remove('active'));
  const pg=document.getElementById('page-'+name);
  if(pg) pg.classList.add('active');
  const nav=document.getElementById('nav-'+name);
  if(nav) nav.classList.add('active');
  if (name === 'home') {
    window.history.replaceState({}, '', '/');
  } else {
    window.history.replaceState({}, '', '/#' + name);
  }
  window.scrollTo(0,0);
  if (name === 'account') {
    renderAccountDashboard();
  }
  if (name === 'admin') {
    loadAdminSettings();
    if (!adminPageInitialized) {
      adminPageInitialized = true;
      renderAdminUsers();
      if (!beats.length) {
        repairBeatsFromStorage().catch(e => console.warn('auto repair beats:', e));
      }
    }
  }
  if (name === 'beats') {
    currentFilter = 'Tous';
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === 'Tous');
    });
  }
  renderAll();
}
 
function adminPanel(name, el) {
  document.querySelectorAll('.admin-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(s=>s.classList.remove('active'));
  const p=document.getElementById('panel-'+name);
  if(p) p.classList.add('active');
  if(el) el.classList.add('active');
}
 
async function verifyAdminRoleInBackground(firebaseUser) {
  try {
    const isAdmin = await syncAdminRole(firebaseUser);
    if (!isAdmin) {
      showToast('⛔ Accès refusé');
      return showPage('home');
    }
    if (currentUser) {
      currentUser.role = 'admin';
      sessionStorage.setItem('jsb_user2', JSON.stringify(currentUser));
      updateAuth();
    }
  } catch (e) {
    console.warn('Admin verification failed:', e.message || e);
  }
}

async function showAdminPage() {
  const user = firebase.auth().currentUser;
  if (!user) return showPage('login');

  const userAlreadyAdmin = currentUser?.role === 'admin' || isOwnerEmail(user.email);
  if (userAlreadyAdmin) {
    showPage('admin');
    verifyAdminRoleInBackground(user);
    return;
  }

  const isAdmin = await syncAdminRole(user);
  if (!isAdmin) {
    showToast('⛔ Accès refusé');
    return showPage('home');
  }
  if (currentUser) {
    currentUser.role = 'admin';
    sessionStorage.setItem('jsb_user2', JSON.stringify(currentUser));
    updateAuth();
  }
  showPage('admin');
}
 
// Mobile nav
function toggleAdminSidebar() {
  const sidebar = document.getElementById('adminSidebar');
  const icon = document.getElementById('adminToggleIcon');
  const isOpen = sidebar.classList.toggle('open');
  if (icon) {
    icon.className = isOpen ? 'fas fa-times' : 'fas fa-bars';
  }
}
function closeSidebarOnMobile() {
  // Ferme le menu uniquement sur mobile (largeur ≤ 768px)
  if (window.innerWidth <= 768) {
    const sidebar = document.getElementById('adminSidebar');
    const icon = document.getElementById('adminToggleIcon');
    sidebar.classList.remove('open');
    if (icon) icon.className = 'fas fa-bars';
  }
}
function toggleMobileNav() {
  const h=document.getElementById('hamburger'), d=document.getElementById('navDrawer');
  h.classList.toggle('open'); d.classList.toggle('open');
}
function closeMobileNav() {
  document.getElementById('hamburger').classList.remove('open');
  document.getElementById('navDrawer').classList.remove('open');
}
 
// ═══ TOAST ═══
function showToast(msg) {
  document.querySelectorAll('.toast').forEach(t=>t.remove());
  const t=document.createElement('div');
  t.className='toast'; t.innerHTML=msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),3100);
}

function showWarningToast(messageKey, fallback) {
  // Suppress noisy studio init toasts; these are often caused by autoplay/user-gesture
  // restrictions and are recoverable via a user gesture. Log to console instead.
  if (messageKey === 'studio_error_init') {
    const fallbackMsg = fallback || (typeof t === 'function' ? t(messageKey) : '') || 'Studio init failed';
    console.warn('Studio init suppressed toast:', fallbackMsg);
    return;
  }
  const msg = (typeof t === 'function' ? t(messageKey) : null) || fallback || '';
  showToast(msg.startsWith('⚠') ? msg : `⚠ ${msg}`);
}
 
 
// ═══ FREESTYLE ═══
let fsAudio = new Audio();
fsAudio.setAttribute('playsinline', '');
fsAudio.setAttribute('webkit-playsinline', '');
window.fsAudio = fsAudio;
fsAudio.preload = 'auto';

function clearFsAudioCrossOrigin() {
  fsAudio.removeAttribute('crossorigin');
  fsAudio.crossOrigin = null;
}

const FS_RECORDINGS_STORAGE_KEY = 'jsb_recordings';
let fsPlaybackAttempt = false;

function safeFsRecordingForStorage(rec) {
  if (!rec) return null;
  if (isBlobUrl(rec.url) && !isRemoteUrl(rec.url)) {
    return null;
  }
  const copy = { ...rec };
  delete copy.blob;
  return copy;
}

function loadFsRecordingsFromStorage() {
  try {
    const stored = JSON.parse(localStorage.getItem(FS_RECORDINGS_STORAGE_KEY) || '[]');
    if (!Array.isArray(stored)) return [];
    // Exclude blob: URLs because they are not valid across sessions.
    return stored
      .filter(r => r && typeof r.url === 'string')
      .filter(r => !/^blob:/i.test(r.url))
      .map(r => ({ ...r, blob: null }));
  } catch (e) {
    console.warn('Unable to load freestyle recordings from storage:', e);
    return [];
  }
}

function saveFsRecordingsToStorage() {
  try {
    const safeRecords = fsRecordings.map(r => safeFsRecordingForStorage(r)).filter(Boolean);
    localStorage.setItem(FS_RECORDINGS_STORAGE_KEY, JSON.stringify(safeRecords));
  } catch (e) {
    console.warn('Unable to save freestyle recordings:', e);
  }
}

function addFsRecording(rec) {
  fsRecordings.unshift(rec);
  saveFsRecordingsToStorage();
  renderRecordingsList();
  // Auto-upload to Firebase for persistence (especially on mobile)
  if (currentUser && rec.blob && !isRemoteUrl(rec.url)) {
    uploadFreestyleRecording(rec).then(uploadedUrl => {
      if (uploadedUrl) {
        console.log('Recording auto-uploaded to Firebase:', uploadedUrl);
        renderRecordingsList(); // re-render with new URL
      }
    }).catch(err => {
      console.warn('Auto-upload failed, blob URL will work until page refresh:', err);
    });
  }
}

function isRemoteUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function isValidAudioFile(file) {
  return file && file.type && /^audio\//i.test(file.type);
}

async function uploadFreestyleRecording(record) {
  if (!currentUser) {
    showToast(t('dyn_login_first'));
    return null;
  }
  if (isRemoteUrl(record.url) && !record.url.startsWith('blob:')) {
    return record.url;
  }
  const file = record.blob instanceof File ? record.blob : new File([record.blob], `freestyle-${record.id}.${record.mimeType?.split('/')[1]||'webm'}`, { type: record.mimeType || 'audio/webm' });
  const ext = record.mimeType ? record.mimeType.split('/')[1] : 'webm';
  const path = `freestyles/${currentUser.uid}/${record.id || Date.now()}.${ext}`;
  try {
    const downloadUrl = await uploadFileToStorage(file, path);
    record.url = downloadUrl;
    record.uploadedAt = new Date().toISOString();
    saveFsRecordingsToStorage();
    return downloadUrl;
  } catch (e) {
    console.error('uploadFreestyleRecording failed', e);
    showToast('⚠ ' + (e.message || t('dyn_play_error')));
    return null;
  }
}

async function importFreestyleFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (!isValidAudioFile(file)) {
    showToast('⚠ ' + t('err_invalid_audio') || 'Format audio invalide');
    input.value = '';
    return;
  }

  let url = URL.createObjectURL(file);
  let uploadedUrl = null;
  if (currentUser) {
    const ext = (file.name.split('.').pop() || 'webm').toLowerCase();
    const safeExt = /^(mp3|wav|m4a|ogg|webm|aac|flac)$/i.test(ext) ? ext : 'webm';
    try {
      uploadedUrl = await uploadFileToStorage(file, `freestyles/${currentUser.uid}/import-${Date.now()}.${safeExt}`);
      url = uploadedUrl;
    } catch (e) {
      console.warn('importFreestyleFile upload failed, keeping local preview:', e);
    }
  }

  const rec = {
    id: Date.now(),
    beatTitle: file.name,
    beatId: null,
    url,
    blob: uploadedUrl ? null : file,
    mimeType: file.type,
    duration: 0,
    date: new Date().toLocaleDateString('fr'),
    label: file.name,
    uploadedAt: uploadedUrl ? new Date().toISOString() : null,
    remote: Boolean(uploadedUrl)
  };

  addFsRecording(rec);
  showToast(t('dyn_audio_imported') || 'Audio importé');
  input.value = '';
}

async function publishFsRecording(index = 0) {
  if (!currentUser) { showToast(t('dyn_login_first')); return; }
  if (!fsRecordings.length) { showToast(t('dyn_no_sound_pub')); return; }
  const record = fsRecordings[index] || fsRecordings[0];
  if (!record) { showToast(t('dyn_no_sound_pub')); return; }
  let finalUrl = record.url;
  if (!isRemoteUrl(finalUrl) || isBlobUrl(finalUrl)) {
    finalUrl = await uploadFreestyleRecording(record);
    if (!finalUrl) return;
  }
  const post = {
    type: 'freestyle',
    username: currentUser.username,
    beatTitle: record.beatTitle || t('fs_no_beat_selected'),
    date: new Date().toLocaleDateString('fr'),
    url: finalUrl,
    likes: 0,
    comments: []
  };
  await addPostToFirestore(post);
  showToast(t('dyn_freestyle_published'));
  // Navigate to Community → My Profile so the user immediately sees their published freestyle
  showPage('community');
  communityTab('my-profile');
  renderMyProfile();
}

function createFsRecordingFromFile(file) {
  const url = URL.createObjectURL(file);
  const rec = {
    id: Date.now(),
    beatTitle: file.name,
    beatId: null,
    url,
    blob: file,
    mimeType: file.type,
    duration: 0,
    date: new Date().toLocaleDateString('fr'),
    label: file.name
  };
  addFsRecording(rec);
  return rec;
}

function loadFsFileFromInput(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (!isValidAudioFile(file)) {
    showToast('⚠ ' + t('err_invalid_audio') || 'Format audio invalide');
    input.value = '';
    return;
  }
  createFsRecordingFromFile(file);
  input.value = '';
}

function setupFsImportInput(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener('change', () => loadFsFileFromInput(input));
}

function isBlobUrl(url) {
  return typeof url === 'string' && url.startsWith('blob:');
}

function isUrlRemote(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function renderFsRecordingActions(record, index) {
  const buttonLabel = record.blob || isBlobUrl(record.url)
    ? t('fs_upload_to_profile')
    : t('fs_publish_profile');
  const publishOnClick = `publishFsRecording(${index})`;
  return `<button onclick="${publishOnClick}" class="btn-ghost" style="font-size:0.75rem;padding:8px 12px">${buttonLabel}</button>`;
}

function getFileNameFromUrl(url) {
  try {
    return new URL(url).pathname.split('/').pop() || url;
  } catch (e) {
    return url;
  }
}

function bindFsAudioElementEvents(audioEl) {
  audioEl.addEventListener('error', (evt) => {
    console.warn('fsAudio error', evt, audioEl.error);
    if (fsSelectedBeat && fsPlaybackAttempt) {
      showWarningToast('dyn_play_error', 'Impossible de lire le fichier audio');
      fsPlaybackAttempt = false;
    }
  });
  audioEl.addEventListener('pause', () => {
    if (fsPlaying && audioEl.loop && !audioEl.ended && audioEl.currentTime > 0) {
      const now = Date.now();
      if (now - fsLastPauseTime > 500) {
        fsLastPauseTime = now;
        setTimeout(() => {
          if (fsPlaying && audioEl.paused) {
            audioEl.play().catch(() => {});
          }
        }, 100);
      }
    }
  });
  audioEl.addEventListener('ended', () => {
    if (fsPlaying && audioEl.loop) {
      audioEl.currentTime = 0;
      audioEl.play().catch(() => {});
    }
  });
  audioEl.addEventListener('loadedmetadata', () => {
    console.log('✅ Audio metadata loaded:', audioEl.duration, 'seconds');
    const dt = document.getElementById('fsDurT');
    if (dt && audioEl.duration && isFinite(audioEl.duration)) {
      dt.textContent = fmt(audioEl.duration);
    }
    const durationEl = document.getElementById('fsBeatDuration');
    if (durationEl && audioEl.duration && isFinite(audioEl.duration)) {
      durationEl.textContent = fmt(audioEl.duration);
    }
  });
  audioEl.addEventListener('timeupdate', () => {
    if (!audioEl.duration || !isFinite(audioEl.duration)) return;
    const p = (audioEl.currentTime / audioEl.duration) * 100;
    const pf = document.getElementById('fsProgFill');
    if (pf) pf.style.width = Math.min(100, p) + '%';
    const ct = document.getElementById('fsCurT');
    if (ct) ct.textContent = fmt(audioEl.currentTime);
  });
}

bindFsAudioElementEvents(fsAudio);
let fsLastPauseTime = 0;
let fsPlaying = false;
let fsBeatVolume = 1.0;
let fsMediaRecorder = null;
let fsChunks = [];
let fsRecordings = loadFsRecordingsFromStorage();
let fsSelectedBeat = null;
window.fsSelectedBeat = fsSelectedBeat;
window.pendingStudioBeat = null;
let fsRecording = false;
let fsTimerInterval = null;
let fsSeconds = 0;
let micStream = null;
let analyserNode = null;
let micAnimFrame = null;
let fsAudioCtx = null;
let fsMicSourceNode = null;
let fsBeatSourceNode = null;
let fsDestinationNode = null;
let fsRecordingDestinationStream = null;
 
async function ensureFsAudioGraph() {
  // Lecture simple via <audio> — pas de graphe Web Audio requis pour le freestyle.
  // (createMediaElementSource + crossOrigin provoquait des échecs CORS sur Storage.)
  return;
}

function renderFsBeatList() {
  const el = document.getElementById('fsBeatList');
  if (!el) return;
  if (!beats.length) {
    el.innerHTML = `<p style="grid-column:1/-1;text-align:center;font-family:var(--font-mono);font-size:0.75rem;color:var(--text-dim);padding:12px 0">${typeof t === 'function' ? t('studio_no_beats') : 'Aucun beat disponible'}</p>`;
    return;
  }
  el.innerHTML = beats.map((b,i) => `
    <button type="button" onclick="selectFsBeat(${i})" id="fsbtn-${i}" class="fs-beat-btn">
      <img src="${b.cover || DEFAULT_BEAT_COVER}" alt="${b.title}" onerror="this.src='${DEFAULT_BEAT_COVER}'" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;margin-bottom:6px">
      <span class="fs-beat-title">${b.title}</span>
      <span class="fs-beat-meta">${b.bpm} BPM · ${b.genre}</span>
    </button>`).join('');
}
 
window.selectFsBeat = async function(idx) {
  fsSelectedBeat = beats[idx];
  window.fsSelectedBeat = fsSelectedBeat;
  if (!fsSelectedBeat) return;
  const audioSource = resolveBeatAudioSource(fsSelectedBeat);
  const directBeatUrl = resolveFsBeatURL(audioSource);
  const proxyBeatUrl = resolveFsBeatProxyURL(audioSource);
  let beatUrl = directBeatUrl;
  // Si c'est une URL Firebase Storage, utiliser le proxy pour éviter les erreurs CORS
  if (proxyBeatUrl && /firebasestorage\.googleapis\.com|storage\.googleapis\.com/i.test(directBeatUrl)) {
    console.log('Using audio proxy for freestyle beat (CORS-sensitive source):', proxyBeatUrl);
    beatUrl = proxyBeatUrl;
  }
  if (!beatUrl) {
    showWarningToast('dyn_no_beat_audio', 'Impossible de charger le beat');
    return;
  }
  console.log('selectFsBeat URL:', beatUrl, 'audioSource:', audioSource, 'beatId:', fsSelectedBeat?.id);
  fsAudio.crossOrigin = 'anonymous';
  fsAudio.src = beatUrl;
  fsAudio.loop = true;
  fsAudio.preload = 'auto';
  fsAudio.muted = false;
  fsAudio.volume = fsBeatVolume > 0.05 ? fsBeatVolume : 1.0;
  try {
    await fsAudio.load();
  } catch(e) {
    console.warn('Audio load:', e);
  }
  fsAudio.addEventListener('error', function(e) {
    console.warn('fsAudio element error after load:', e, fsAudio.error);
    if (/CORS|Failed to fetch|NetworkError/i.test(String(fsAudio.error?.message || e))) {
      showWarningToast('dyn_play_error', 'Beat CORS / réseau introuvable');
    }
  }, { once: true });
  const nameEl = document.getElementById('fsBeatName');
  const metaEl = document.getElementById('fsBeatMeta');
  const coverEl = document.getElementById('fsBeatCover');
  const durationEl = document.getElementById('fsBeatDuration');
  const playBtn = document.getElementById('fsBeatPlayBtn');
  if (nameEl) nameEl.textContent = fsSelectedBeat.title;
  if (metaEl) metaEl.textContent = fsSelectedBeat.bpm + ' BPM · ' + fsSelectedBeat.genre;
  if (coverEl) coverEl.src = fsSelectedBeat.cover || DEFAULT_BEAT_COVER;
  if (playBtn) playBtn.innerHTML = `<i class='fas fa-play'></i> ${t('fs_play_beat')}`;
  if (durationEl) durationEl.textContent = '0:00';
  document.querySelectorAll('[id^="fsbtn-"]').forEach(b => {
    b.classList.remove('active');
  });
  const btn = document.getElementById('fsbtn-'+idx);
  if (btn) btn.classList.add('active');
  window.pendingStudioBeat = fsSelectedBeat;
  await loadStudioSelectedBeat(fsSelectedBeat);
  stopFsBeat();
}
 
window.loadStudioSelectedBeat = async function(beat) {
  const audioSource = resolveBeatAudioSource(beat);
  if (!beat || !audioSource) return;
  window.pendingStudioBeat = beat;
  if (typeof studioInstance === 'undefined' || !studioInstance || typeof studioInstance.loadBeatFromURL !== 'function') {
    console.log('Studio pas encore prêt, beat en attente:', beat.title || beat.name);
    return;
  }
  try {
    const beatInfo = {
      name: beat.title || beat.name || 'Untitled',
      bpm: beat.bpm || 120,
      key: beat.key || 'C',
      genre: beat.genre || 'Hip-Hop'
    };
    const directUrl = resolveBeatPlaybackURL(audioSource);
    const proxyUrl = resolveFsBeatProxyURL(audioSource);
    let beatLoaded = false;
    let lastError = null;

    try {
      await studioInstance.loadBeatFromURL(directUrl, beatInfo);
      beatLoaded = true;
      console.log('✅ Studio loaded beat from freestyle selector:', beatInfo.name, directUrl);
    } catch (directErr) {
      lastError = directErr;
      console.warn('Studio direct load failed, trying proxy:', directErr);
    }

    if (!beatLoaded && proxyUrl && proxyUrl !== directUrl) {
      try {
        await studioInstance.loadBeatFromURL(proxyUrl, beatInfo);
        beatLoaded = true;
        console.log('✅ Studio loaded beat via proxy:', beatInfo.name, proxyUrl);
      } catch (proxyErr) {
        lastError = proxyErr;
        console.warn('Studio proxy load failed:', proxyErr);
      }
    }

    if (!beatLoaded) {
      const fallbackUrl = proxyUrl || directUrl;
      const buffer = await fetchAudioBufferForBeatUrl(fallbackUrl);
      if (buffer) {
        await studioInstance.loadBeat(buffer, beatInfo);
        beatLoaded = true;
        console.log('✅ Studio loaded beat from decoded buffer:', fallbackUrl);
      }
    }

    if (!beatLoaded) {
      throw lastError || new Error('Studio beat load failed');
    }

    window.pendingStudioBeat = null;
  } catch (error) {
    console.warn('Studio beat load failed:', error);
  }
};
 
async function toggleFsBeat() {
  const audioSource = resolveBeatAudioSource(fsSelectedBeat);
  if (!fsSelectedBeat || !audioSource) { showToast(t('dyn_no_beat_audio')); return; }
  if (fsPlaying) {
    fsAudio.pause(); fsPlaying = false;
    document.getElementById('fsBeatPlayBtn').innerHTML = `<i class='fas fa-play'></i> ${t('fs_play_beat')}`;
  } else {
    if (window.stopRecordingPlayback) {
      window.stopRecordingPlayback();
    }
    try {
      await ensureFsBeatPlayback();
      fsPlaying = true;
      document.getElementById('fsBeatPlayBtn').innerHTML = `<i class='fas fa-pause'></i> ${t('dyn_pause_beat')}`;
    } catch (e) {
      showWarningToast('dyn_play_error', 'Lecture impossible');
    }
  }
}

async function loadFsAudioSource(url) {
  fsAudio.crossOrigin = 'anonymous';
  fsAudio.src = url;
  fsAudio.currentTime = 0;
  fsAudio.load();
  if (fsAudio.readyState < 2) {
    await waitForAudioReady(fsAudio, 8000);
  }
}

async function ensureFsBeatPlayback() {
  const audioSource = resolveBeatAudioSource(fsSelectedBeat);
  if (!fsSelectedBeat || !audioSource) return;

  const directUrl = resolveFsBeatURL(audioSource);
  const proxyUrl = resolveFsBeatProxyURL(audioSource);
  if (!directUrl) return;

  fsAudio.loop = true;
  fsAudio.muted = false;
  fsAudio.volume = fsBeatVolume > 0.05 ? fsBeatVolume : 1.0;
  fsPlaybackAttempt = true;

  async function tryPlay(url) {
    if (!audioSrcMatches(fsAudio, url)) {
      await loadFsAudioSource(url);
    } else if (!fsAudio.duration || fsAudio.currentTime >= fsAudio.duration) {
      fsAudio.currentTime = 0;
      if (fsAudio.readyState < 2) {
        await waitForAudioReady(fsAudio, 8000);
      }
    } else if (fsAudio.readyState < 2) {
      await waitForAudioReady(fsAudio, 8000);
    }
    await fsAudio.play();
  }

  try {
    await tryPlay(directUrl);
  } catch (err) {
    console.warn('ensureFsBeatPlayback direct URL failed:', err);
    let played = false;

    // Try proxy URL first if available
    if (proxyUrl && proxyUrl !== directUrl) {
      try {
        await tryPlay(proxyUrl);
        played = true;
      } catch (proxyErr) {
        console.warn('ensureFsBeatPlayback proxy URL failed:', proxyErr);
      }
    }

    // If direct/proxy element playback failed, try decoding the audio with fetch and play from a generated WAV blob
    if (!played) {
      const fallbackUrl = proxyUrl || directUrl;
      try {
        const audioBuffer = await fetchAudioBufferForBeatUrl(fallbackUrl);
        if (audioBuffer) {
          try {
            const wavBlob = audioBufferToWav(audioBuffer);
            const blobUrl = URL.createObjectURL(wavBlob);
            try {
              await loadFsAudioSource(blobUrl);
              await fsAudio.play();
              played = true;
            } catch (playErr) {
              console.warn('Playback from decoded buffer failed:', playErr);
            } finally {
              // Revoke object URL after a short delay to keep audio available for immediate playback
              setTimeout(() => { try { URL.revokeObjectURL(blobUrl); } catch (e) {} }, 60000);
            }
          } catch (convErr) {
            console.warn('Failed to convert AudioBuffer to WAV blob:', convErr);
          }
        }
      } catch (decodeErr) {
        console.warn('Decoded buffer fetch failed:', decodeErr);
      }
    }

    if (!played) throw err;
  } finally {
    fsPlaybackAttempt = false;
  }
}

async function waitForAudioReady(audioEl, timeout = 5000) {
  if (!audioEl) throw new Error('Audio element missing');
  if (audioEl.readyState >= 3) return;

  return new Promise((resolve, reject) => {
    let timer = null;
    let resolved = false;
    const onReady = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve();
    };
    const onError = (ev) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      console.error('Audio error event:', ev.error);
      reject(ev.error || new Error('Audio failed to become ready'));
    };
    const cleanup = () => {
      audioEl.removeEventListener('canplay', onReady);
      audioEl.removeEventListener('canplaythrough', onReady);
      audioEl.removeEventListener('loadeddata', onReady);
      audioEl.removeEventListener('error', onError);
      if (timer) clearTimeout(timer);
    };
    audioEl.addEventListener('canplay', onReady);
    audioEl.addEventListener('canplaythrough', onReady);
    audioEl.addEventListener('loadeddata', onReady);
    audioEl.addEventListener('error', onError);
    timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      cleanup();
      if (audioEl.readyState > 0) {
        console.log('Audio ready timeout but has data, allowing playback (readyState=' + audioEl.readyState + ')');
        resolve();
      } else {
        reject(new Error('Audio ready timeout'));
      }
    }, timeout);
  });
}
 
function stopFsBeat() {
  fsAudio.pause(); fsAudio.currentTime = 0; fsPlaying = false;
  const btn = document.getElementById('fsBeatPlayBtn');
  if (btn) btn.innerHTML = `<i class='fas fa-play'></i> ${t('fs_play_beat')}`;
}

function seekFsBeat(e) {
  if (!fsAudio.duration) return;
  fsAudio.currentTime = (e.offsetX/e.currentTarget.offsetWidth)*fsAudio.duration;
}

async function toggleRecord() {
  if (fsRecording) { stopRecord(); } else { await startRecord(); }
}
 
async function startRecord() {
  if (!fsSelectedBeat) { showToast(t('dyn_select_beat_first')); return; }
  // capture beat offset at recording start to allow synced playback later
  try { fsRecordingStartBeat = (typeof fsAudio.currentTime === 'number') ? fsAudio.currentTime : 0; } catch(e) { fsRecordingStartBeat = 0; }
  const preservedFsAudioVolume = (typeof fsAudio.volume === 'number' && fsAudio.volume > 0) ? fsAudio.volume : 1.0;
  try {
    const constraints = getMicConstraints();
    const getMic = (navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
      ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      : (c) => new Promise((res, rej) => {
          const legacy = navigator.getUserMedia || navigator.webkitGetUserMedia;
          if (!legacy) rej(new Error('getUserMedia not supported'));
          else legacy.call(navigator, c, res, rej);
        });
    try {
      micStream = await getMic(constraints);
    } catch (firstError) {
      if (firstError.name === 'OverconstrainedError' || /sampleRate|channelCount|autoGainControl/i.test(firstError.message || '')) {
        micStream = await getMic({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      } else {
        throw firstError;
      }
    }
  } catch(e) { showToast(t('dyn_mic_denied')); return; }
  const fsAudioSource = resolveBeatAudioSource(fsSelectedBeat);
  if (!fsPlaying && fsAudioSource) {
    try {
      await ensureFsBeatPlayback();
      fsAudio.volume = preservedFsAudioVolume;
      fsBeatVolume = preservedFsAudioVolume;
      fsPlaying = true;
      document.getElementById('fsBeatPlayBtn').innerHTML = `<i class='fas fa-pause'></i> ${t('dyn_pause_beat')}`;
    } catch (e) {
      showWarningToast('dyn_play_error', 'Lecture impossible');
      return;
    }
  } else if (fsPlaying && fsAudio.paused && fsAudioSource) {
    try {
      await ensureFsBeatPlayback();
      fsAudio.volume = preservedFsAudioVolume;
      fsBeatVolume = preservedFsAudioVolume;
      fsPlaying = true;
      document.getElementById('fsBeatPlayBtn').innerHTML = `<i class='fas fa-pause'></i> ${t('dyn_pause_beat')}`;
    } catch (e) {
      console.warn('Unable to resume freestyle beat on record:', e);
    }
  }
  if (typeof fsAudio.volume === 'number') {
    fsAudio.volume = preservedFsAudioVolume;
    fsBeatVolume = preservedFsAudioVolume;
  }
  let recordStream = micStream;
  try {
    if (!fsAudioCtx || fsAudioCtx.state === 'closed') {
      fsAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (fsAudioCtx.state === 'suspended') await fsAudioCtx.resume();

    const micSource = fsAudioCtx.createMediaStreamSource(micStream);
    const beatSource = fsAudioCtx.createMediaElementSource(fsAudio);
    const destination = fsAudioCtx.createMediaStreamDestination();

    micSource.connect(destination);
    beatSource.connect(destination);
    beatSource.connect(fsAudioCtx.destination);

    fsMicSourceNode = micSource;
    fsBeatSourceNode = beatSource;
    fsDestinationNode = destination;
    fsRecordingDestinationStream = destination.stream;
    recordStream = destination.stream;
    fsAudio.muted = true;
  } catch (mixError) {
    console.warn('Freestyle mix recording fallback to mic-only:', mixError);
    if (fsAudioCtx && typeof fsAudioCtx.close === 'function') {
      try { fsAudioCtx.close(); } catch (closeErr) { console.warn('AudioContext close failed:', closeErr); }
      fsAudioCtx = null;
    }
    fsAudio.muted = false;
  }

  try {
    const analyserCtx = fsAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (analyserCtx.state === 'suspended') await analyserCtx.resume();
    analyserNode = analyserCtx.createAnalyser(); analyserNode.fftSize = 256;
    const src = analyserCtx.createMediaStreamSource(micStream);
    src.connect(analyserNode);
    animMicLevel();
  } catch (e) {
    console.warn('Mic level analyzer failed:', e);
  }

  fsChunks = [];
  const selectedMimeType = getSupportedRecorderMimeType() || (isIOS() ? 'audio/mp4' : 'audio/webm');
  try {
    fsMediaRecorder = selectedMimeType
      ? new MediaRecorder(recordStream, { mimeType: selectedMimeType, audioBitsPerSecond: 192000 })
      : new MediaRecorder(recordStream);
  } catch (e) {
    try {
      fsMediaRecorder = new MediaRecorder(recordStream);
    } catch (fallbackError) {
      console.error('MediaRecorder init failed:', fallbackError);
      showToast(t('dyn_recording_error') || 'Enregistrement impossible');
      return;
    }
  }
  fsMediaRecorder.ondataavailable = e => { if(e.data.size>0) fsChunks.push(e.data); };
  fsMediaRecorder.onstop = () => {
    const mimeUsed = fsMediaRecorder.mimeType || 'audio/webm';
    const blob = new Blob(fsChunks, {type: mimeUsed});
    const url = URL.createObjectURL(blob);
    const rec = {
      id: Date.now(),
      beatTitle: fsSelectedBeat ? fsSelectedBeat.title : '—',
      beatId: fsSelectedBeat ? fsSelectedBeat.id : null,
      url,
      blob,
      mimeType: mimeUsed,
      duration: fsSeconds,
      date: new Date().toLocaleDateString('fr'),
      label: 'Take ' + (fsRecordings.length + 1)
      ,
      beatOffset: fsRecordingStartBeat || 0
    };
    addFsRecording(rec);
    document.getElementById('mixSection').style.display = 'block';
    showToast(t('dyn_recording_saved'));
    if (micAnimFrame) cancelAnimationFrame(micAnimFrame);
    const ml = document.getElementById('micLevel'); if(ml) ml.style.width='0%';
  };
  fsMediaRecorder.start();
  fsRecording = true; fsSeconds = 0;
  const rb = document.getElementById('recBtn');
  rb.style.background='rgba(255,68,68,0.3)'; rb.style.boxShadow='0 0 30px rgba(255,68,68,0.5)';
  document.getElementById('recIcon').className='fas fa-stop';
  document.getElementById('recStatus').textContent=t('dyn_recording_status');
  document.getElementById('recStatus').style.color='#ff4444';
  document.getElementById('recTimer').style.display='block';
  fsTimerInterval = setInterval(() => {
    fsSeconds++;
    const m=Math.floor(fsSeconds/60), s=fsSeconds%60;
    document.getElementById('recTimer').textContent=m+':'+(s<10?'0':'')+s;
  }, 1000);
}
 
function stopRecord() {
  if (fsMediaRecorder && fsMediaRecorder.state!=='inactive') fsMediaRecorder.stop();
  if (micStream) micStream.getTracks().forEach(t=>t.stop());
  if (fsMicSourceNode) { try { fsMicSourceNode.disconnect(); } catch (e) {} fsMicSourceNode = null; }
  if (fsBeatSourceNode) { try { fsBeatSourceNode.disconnect(); } catch (e) {} fsBeatSourceNode = null; }
  if (fsDestinationNode) { try { fsDestinationNode.disconnect(); } catch (e) {} fsDestinationNode = null; }
  if (fsAudioCtx) { try { fsAudioCtx.close(); } catch (e) {} fsAudioCtx = null; }
  fsRecordingDestinationStream = null;
  fsAudio.muted = false;
  clearInterval(fsTimerInterval);
  fsRecording = false;
  const rb = document.getElementById('recBtn');
  rb.style.background='rgba(255,68,68,0.1)'; rb.style.boxShadow='none';
  document.getElementById('recIcon').className='fas fa-microphone';
  document.getElementById('recStatus').textContent=t('dyn_rec_default');
  document.getElementById('recStatus').style.color='var(--text-dim)';
  document.getElementById('recTimer').style.display='none';
  stopFsBeat();
}
 
function animMicLevel() {
  if (!analyserNode) return;
  const data = new Uint8Array(analyserNode.frequencyBinCount);
  analyserNode.getByteFrequencyData(data);
  const avg = data.reduce((a,b)=>a+b,0)/data.length;
  const ml = document.getElementById('micLevel');
  if (ml) ml.style.width = Math.min(100,avg*1.5)+'%';
  micAnimFrame = requestAnimationFrame(animMicLevel);
}
 
function renderRecordingsList() {
  const el = document.getElementById('recordingsList');
  if (!el) return;
  if (!fsRecordings.length) {
    el.innerHTML=`<div style="text-align:center;color:var(--text-dim);font-family:var(--font-mono);font-size:0.7rem;padding:20px"><i class="fas fa-microphone-slash" style="font-size:1.5rem;display:block;margin-bottom:8px;opacity:0.3"></i>${t('dyn_no_rec_static')}</div>`;
    return;
  }
  el.innerHTML = fsRecordings.slice(0,10).map((r,i)=>`
    <div style="display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;padding:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(0,229,255,0.1);border-radius:12px">
      <button onclick="playRecording(${JSON.stringify(r.url)})" style="width:36px;height:36px;border-radius:50%;background:rgba(0,229,255,0.1);border:1px solid var(--cyan);color:var(--cyan);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:0.8rem">
        <i class="fas fa-play" style="margin-left:2px"></i>
      </button>
      <div style="min-width:0">
        <div style="font-family:var(--font-mono);font-size:0.7rem;color:#fff">${sanitize(r.label || getFileNameFromUrl(r.url))}</div>
        <div style="font-family:var(--font-mono);font-size:0.58rem;color:var(--text-dim)">${sanitize(r.beatTitle || t('fs_no_beat_selected'))} · ${sanitize(r.date || '')} · ${fmt(r.duration || 0)}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
        <div style="display:flex;gap:8px;align-items:center">
          <a href="${r.url || '#'}" download="freestyle.webm" style="color:var(--cyan);font-size:0.85rem;text-decoration:none" title="${t('fs_download_voice')}"><i class="fas fa-download"></i></a>
          <button onclick="deleteRecording(${i})" style="background:none;border:none;color:rgba(255,100,100,0.75);cursor:pointer;font-size:0.85rem"><i class="fas fa-trash"></i></button>
        </div>
        ${renderFsRecordingActions(r, i)}
      </div>
    </div>`).join('');
  if (document.getElementById('studioPanel') && document.getElementById('studioPanel').style.display !== 'none') {
    setTimeout(drawStudioWaveform, 200);
  }
  // Re-apply translations for dynamically generated recording list
  if (typeof applyTranslations === 'function') applyTranslations();
}

// Attach passive touchstart handlers to freestyle controls to ensure immediate responsiveness on mobile/touch devices
function bindFsTouchHandlers() {
  const root = document.getElementById('page-freestyle') || document;
  if (!root) return;
  const selectors = 'button, a, .record-action-btn, .effect-btn, .fs-beat-btn, .cart-rm';
  root.querySelectorAll(selectors).forEach(el => {
    if (!el) return;
    // Avoid adding duplicate listeners
    if (el.__fs_touch_bound) return;
    el.__fs_touch_bound = true;
    el.addEventListener('touchstart', function(e){
      // Let the native click still occur; dispatch a click for some touch-only edge cases
      try { this.dispatchEvent(new Event('click', {bubbles:true})); } catch(err) {}
    }, {passive:true});
  });
}
 
function playRecording(url) {
  if (!url) { showToast('⚠ ' + (currentLang==='en'?'No recording':'Pas d\'enregistrement')); return; }
  try {
    const a = new Audio(url);
    a.setAttribute('controls', 'controls');
    a.preload = 'auto';
    a.setAttribute('playsinline', '');
    a.crossOrigin = 'anonymous';
    a.volume = 1.0;
    
    a.addEventListener('canplay', () => {
      const playPromise = a.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(err => {
          console.warn('playRecording audio error:', err);
          if (err.name === 'NotAllowedError') {
            showToast('⚠ ' + (currentLang==='en'?'Audio play denied':'Lecture audio refusée'));
          }
        });
      }
    });
    
    a.addEventListener('error', (e) => {
      console.error('Recording playback error:', e.target?.error);
      showToast('⚠ ' + (currentLang==='en'?'Cannot play recording':'Impossible de lire l\'enregistrement'));
    });
    
    a.addEventListener('loadstart', () => {
      document.querySelectorAll('audio').forEach(el => {
        if (el !== a) { try { el.pause(); } catch(e) {} }
      });
    });
    
    const playPromise = a.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(err => {
        console.warn('playRecording deferred error:', err);
      });
    }
  } catch(e) {
    console.error('playRecording failed:', e);
    showToast('⚠ ' + (currentLang==='en'?'Play error':'Erreur lecture'));
  }
}
function deleteRecording(i) {
  fsRecordings.splice(i,1);
  saveFsRecordingsToStorage();
  renderRecordingsList();
  if (!fsRecordings.length) document.getElementById('mixSection').style.display='none';
}
function downloadLastRecording() {
  if (!fsRecordings.length) { showToast(t('dyn_no_recording')); return; }
  const a=document.createElement('a'); a.href=fsRecordings[0].url; a.download='freestyle.webm'; a.click();
}
async function playMix() {
  if (!fsRecordings.length || !fsSelectedBeat) { showToast(t('dyn_no_freestyle')); return; }
  const rec = fsRecordings[0];
  if (!rec.url) { showToast('⚠ ' + (currentLang==='en'?'No recording URL':'URL enregistrement manquante')); return; }
  const voiceEl = new Audio(rec.url);
  voiceEl.preload = 'auto';
  voiceEl.setAttribute('playsinline', '');
  voiceEl.setAttribute('webkit-playsinline', '');
  voiceEl.crossOrigin = 'anonymous';
  voiceEl.volume = 1.0;

  const audioSource = resolveBeatAudioSource(fsSelectedBeat);
  if (!audioSource) { showToast(t('dyn_no_beat_audio')); return; }
  const beatUrl = resolveFsBeatURL(audioSource);
  if (!beatUrl) { showToast(t('dyn_no_beat_audio')); return; }

  if (!fsAudio.src || !audioSrcMatches(fsAudio, beatUrl)) {
    clearFsAudioCrossOrigin();
    fsAudio.src = beatUrl;
    fsAudio.load();
  }

  // If the recording contains a beat offset, seek the beat to that offset
  try { fsAudio.currentTime = (typeof rec.beatOffset === 'number') ? rec.beatOffset : 0; } catch(e) { fsAudio.currentTime = 0; }
  fsAudio.loop = false;
  fsAudio.muted = false;
  const beatVolElem = document.getElementById('beatVolSlider');
  const beatVol = beatVolElem ? Math.max(0.1, Math.min(1, parseFloat(beatVolElem.value) / 100)) : 0.7;
  fsAudio.volume = beatVol;

  const playBtn = document.getElementById('mixPlayBtn');
  if (playBtn) {
    playBtn.disabled = true;
    playBtn.innerHTML = `<i class='fas fa-spinner fa-spin'></i> ${t('fs_loading') || 'Chargement...'}`;
  }

  if (window.fsMixAudio instanceof HTMLAudioElement) {
    try {
      window.fsMixAudio.pause();
      window.fsMixAudio.src = '';
      window.fsMixAudio.remove();
    } catch (cleanupErr) {
      console.warn('Cleanup previous mix audio failed:', cleanupErr);
    }
    window.fsMixAudio = null;
  }

  const recordedMix = new Audio(rec.url);
  recordedMix.preload = 'auto';
  recordedMix.setAttribute('playsinline', '');
  recordedMix.setAttribute('webkit-playsinline', '');
  recordedMix.crossOrigin = 'anonymous';
  recordedMix.volume = 1.0;
  recordedMix.loop = false;
  recordedMix.style.display = 'none';
  recordedMix.dataset.fsMix = 'true';
  window.fsMixAudio = recordedMix;
  document.body.appendChild(recordedMix);

  recordedMix.addEventListener('ended', () => {
    if (playBtn) playBtn.innerHTML = `<i class='fas fa-play'></i> ${t('fs_listen_mix')}`;
  });
  recordedMix.addEventListener('pause', () => {
    if (playBtn && recordedMix.currentTime > 0 && recordedMix.currentTime < recordedMix.duration) {
      playBtn.innerHTML = `<i class='fas fa-play'></i> ${t('fs_listen_mix')}`;
    }
  });
  recordedMix.addEventListener('error', (e) => {
    console.error('playMix mix audio error:', e, recordedMix.error);
    showToast('⚠ ' + (currentLang==='en' ? 'Unable to play mix' : 'Impossible de lire le mix'));
    if (playBtn) playBtn.disabled = false;
  });

  try {
    await waitForAudioReady(recordedMix, 2500);
    await recordedMix.play();
    if (recordedMix.paused) {
      await recordedMix.play();
    }
    if (playBtn) {
      playBtn.disabled = false;
      playBtn.innerHTML = `<i class='fas fa-pause'></i> ${t('fs_playing')}`;
    }
  } catch (err) {
    console.warn('playMix error:', err);
    if (playBtn) playBtn.disabled = false;
  }
}
async function postFreestyleToProfile(index = 0) {
  if (!currentUser) { showToast(t('dyn_login_first')); showPage('login'); return; }
  if (!fsRecordings.length) { showToast(t('dyn_no_sound_pub')); return; }
  const record = fsRecordings[index] || fsRecordings[0];
  if (!record) { showToast(t('dyn_no_sound_pub')); return; }
  let audioUrl = record.url;
  if (!isRemoteUrl(audioUrl) || isBlobUrl(audioUrl)) {
    audioUrl = await uploadFreestyleRecording(record);
    if (!audioUrl) return;
  }
  const post = {
    type: 'freestyle',
    username: currentUser.username,
    beatTitle: record.beatTitle || t('fs_no_beat_selected'),
    date: new Date().toLocaleDateString('fr'),
    url: audioUrl,
    likes: 0,
    comments: []
  };
  await addPostToFirestore(post);
  showToast(t('dyn_freestyle_published'));
  // Ensure user lands on their profile in the community view
  showPage('community');
  communityTab('my-profile');
}
 
// ═══ COMMUNITY ═══
function communityTab(tab, btn) {
  document.querySelectorAll('#page-community .filter-btn').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('comm-profiles').style.display = tab==='profiles'?'block':'none';
  document.getElementById('comm-my-profile').style.display = tab==='my-profile'?'block':'none';
  document.getElementById('comm-feed').style.display = tab==='feed'?'block':'none';
  if (tab==='profiles') renderArtistsGrid();
  if (tab==='my-profile') renderMyProfile();
  if (tab==='feed') renderFeed();
}
 
async function renderArtistsGrid() {
  const el = document.getElementById('artistsGrid');
  if (!el) return;
  el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-dim);font-family:var(--font-mono);font-size:0.8rem">${t('dyn_loading')}</div>`;
  const profiles = await loadProfiles();
  if (!profiles.length) {
    el.innerHTML=`<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--text-dim);font-family:var(--font-mono);font-size:0.8rem;letter-spacing:2px"><i class="fas fa-users" style="font-size:2.5rem;display:block;margin-bottom:16px;color:rgba(0,229,255,0.2)"></i>${t('dyn_no_artists')}<br><span style='color:var(--cyan);cursor:pointer' onclick='communityTab("my-profile")'>${t('dyn_be_first')}</span></div>`;
    return;
  }
  el.innerHTML = profiles.map(p => artistCard(p)).join('');
}
 
function artistCard(p) {
  // ✅ SÉCURITÉ : Toutes les données Firestore sont sanitisées avant injection dans innerHTML
  const safeUsername = sanitize(p.username || '');
  const safeGenre    = sanitize(p.genre || t('comm_artist_label'));
  const safeLocation = sanitize(p.location || 'International');
  const safeBio      = sanitize(p.bio || t('dyn_no_bio'));
  const safeJoined   = sanitize(String(p.joined || '2026'));
  const photoUrl = safeImageUrl(p.photoURL);
  const avatarHtml = photoUrl
    ? `<img class="artist-avatar" src="${photoUrl}" alt="Avatar ${safeUsername}">`
    : `<div class="artist-avatar artist-avatar-fallback">${safeUsername.charAt(0).toUpperCase()}</div>`;
  // URLs des réseaux sociaux : on vérifie qu'elles commencent par https://
  const safeUrl = (url) => (url && /^https:\/\//.test(url)) ? encodeURI(url) : '#';
  const postCount = p.postCount || 0;
  return `<div style="background:rgba(255,255,255,0.03);backdrop-filter:blur(20px);border:1px solid rgba(0,229,255,0.12);border-radius:20px;overflow:hidden;transition:all 0.3s" onmouseover="this.style.borderColor='rgba(0,229,255,0.3)'" onmouseout="this.style.borderColor='rgba(0,229,255,0.12)'">
    <div style="height:90px;background:linear-gradient(135deg,rgba(0,100,180,0.3),rgba(0,229,255,0.1));position:relative"></div>
    <div style="padding:12px 20px 20px;margin-top:-28px">
      ${avatarHtml}
      <div style="font-family:var(--font-display);font-size:1.2rem;color:#fff;letter-spacing:1px">${safeUsername}</div>
      <div style="font-family:var(--font-mono);font-size:0.62rem;color:var(--cyan);margin:4px 0 10px">${safeGenre} · ${safeLocation}</div>
      <p style="font-size:0.82rem;color:var(--text-dim);line-height:1.6;margin-bottom:14px">${safeBio}</p>
      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        ${p.instagram?`<a href="${safeUrl(p.instagram)}" target="_blank" rel="noopener noreferrer" class="social-icon" style="width:34px;height:34px;border-radius:8px;font-size:0.85rem;display:flex;align-items:center;justify-content:center"><i class="fab fa-instagram"></i></a>`:''}
        ${p.youtube?`<a href="${safeUrl(p.youtube)}" target="_blank" rel="noopener noreferrer" class="social-icon" style="width:34px;height:34px;border-radius:8px;font-size:0.85rem;display:flex;align-items:center;justify-content:center"><i class="fab fa-youtube"></i></a>`:''}
        ${p.tiktok?`<a href="${safeUrl(p.tiktok)}" target="_blank" rel="noopener noreferrer" class="social-icon" style="width:34px;height:34px;border-radius:8px;font-size:0.85rem;display:flex;align-items:center;justify-content:center"><i class="fab fa-tiktok"></i></a>`:''}
        ${p.soundcloud?`<a href="${safeUrl(p.soundcloud)}" target="_blank" rel="noopener noreferrer" class="social-icon" style="width:34px;height:34px;border-radius:8px;font-size:0.85rem;display:flex;align-items:center;justify-content:center"><i class="fab fa-soundcloud"></i></a>`:''}
        ${p.spotify?`<a href="${safeUrl(p.spotify)}" target="_blank" rel="noopener noreferrer" class="social-icon" style="width:34px;height:34px;border-radius:8px;font-size:0.85rem;display:flex;align-items:center;justify-content:center"><i class="fab fa-spotify"></i></a>`:''}
      </div>
      <div style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);padding-top:12px;border-top:1px solid rgba(255,255,255,0.06)">
        <span><i class="fas fa-music" style="color:var(--cyan)"></i> ${postCount} ${t('dyn_tracks_label')}</span>
        <span><i class="fas fa-calendar-alt" style="color:var(--cyan)"></i> ${safeJoined}</span>
      </div>
    </div>
  </div>`;
}
 
async function renderMyProfile() {
  const el = document.getElementById('myProfileContent');
  if (!el) return;
  if (!currentUser) {
    el.innerHTML=`<div style="text-align:center;padding:60px;background:rgba(255,255,255,0.03);border:1px solid rgba(0,229,255,0.1);border-radius:20px"><i class="fas fa-user-lock" style="font-size:2.5rem;color:rgba(0,229,255,0.3);display:block;margin-bottom:16px"></i><div style="font-family:var(--font-display);font-size:1.5rem;color:#fff;margin-bottom:10px">${t('dyn_connect_first')}</div><p style='color:var(--text-dim);margin-bottom:20px'>${t('dyn_connect_to_create')}</p><button class='btn-primary' onclick='showPage("login")'><i class='fas fa-sign-in-alt'></i> ${t('dyn_sign_in')}</button></div>`;
    return;
  }
  const myP = currentUser.uid ? await loadMyProfile(currentUser.uid) : {};
  const profilePhoto = safeImageUrl(myP.photoURL || currentUser.photoURL || '');
  const profileInitial = sanitize(currentUser.username).charAt(0).toUpperCase();
  const profileAvatar = profilePhoto
    ? `<img class="profile-avatar-large" src="${profilePhoto}" alt="Avatar de ${sanitize(currentUser.username)}">`
    : `<div class="profile-avatar-large profile-avatar-fallback">${profileInitial}</div>`;
  const allPosts = await loadPosts();
  const myPosts = allPosts.filter(p=>p.username===currentUser.username);
  el.innerHTML=`
  <div style="display:grid;grid-template-columns:1fr 1.4fr;gap:28px;align-items:start" class="profile-grid">
    <div>
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(0,229,255,0.15);border-radius:20px;overflow:hidden;margin-bottom:20px">
        <div style="height:80px;background:linear-gradient(135deg,rgba(0,100,180,0.4),rgba(0,229,255,0.15))"></div>
        <div style="padding:0 20px 20px;margin-top:-30px">
          ${profileAvatar}
          <div style="font-family:var(--font-display);font-size:1.3rem;color:#fff">${currentUser.username}</div>
          <div style="font-family:var(--font-mono);font-size:0.62rem;color:var(--cyan);margin-bottom:10px">${myP.genre||t('comm_artist_label')} · ${myP.location||''}</div>
          <p style="font-size:0.82rem;color:var(--text-dim);line-height:1.6">${myP.bio||t('dyn_no_bio')}</p>
          <div style="font-family:var(--font-mono);font-size:0.62rem;color:var(--text-dim);margin-top:10px"><i class="fas fa-music" style="color:var(--cyan)"></i> ${myPosts.length} ${t('comm_tracks_published')}</div>
        </div>
      </div>
      <div style="font-family:var(--font-mono);font-size:0.68rem;letter-spacing:3px;color:var(--cyan);margin-bottom:22px;padding-bottom:12px;border-bottom:1px solid rgba(0,229,255,0.1);text-transform:uppercase"><i class="fas fa-stream"></i> ${t('comm_my_posts')}</div>
      <div style="display:flex;flex-direction:column;gap:12px">
        ${myPosts.length ? myPosts.slice(0,5).map(p=>postCard(p,true)).join('') : `<div style='text-align:center;color:var(--text-dim);font-family:var(--font-mono);font-size:0.72rem;padding:20px;border:1px dashed rgba(0,229,255,0.15);border-radius:12px'><i class='fas fa-music' style='display:block;font-size:1.5rem;margin-bottom:8px;opacity:0.3'></i>${t('dyn_no_pub')}</div>`}
      </div>
    </div>
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(0,229,255,0.12);border-radius:20px;padding:28px">
      <div style="font-family:var(--font-mono);font-size:0.68rem;letter-spacing:3px;color:var(--cyan);margin-bottom:22px;padding-bottom:12px;border-bottom:1px solid rgba(0,229,255,0.1);text-transform:uppercase"><i class="fas fa-edit"></i> ${t('comm_edit_profile')}</div>
      <div class="form-row"><label class="form-lbl">${t('comm_stage_name')}</label><input class="form-inp" id="pUsername" value="${myP.username||currentUser.username}"></div>
      <div class="form-row"><label class="form-lbl">${t('comm_music_genre')}</label>
        <select class="form-inp" id="pGenre">
          <option ${myP.genre==='Drill'?'selected':''}>Drill</option>
          <option ${myP.genre==='Afrobeats'?'selected':''}>Afrobeats</option>
          <option ${myP.genre==='Afrobeat'?'selected':''}>Afrobeat</option>
          <option ${myP.genre==='Hip-Hop'?'selected':''}>Hip-Hop</option>
          <option ${myP.genre==='RnB'?'selected':''}>RnB</option>
          <option ${myP.genre==='Coupé-Décalé'?'selected':''}>Coupé-Décalé</option>
          <option ${myP.genre==='Zouglou'?'selected':''}>Zouglou</option>
          <option ${myP.genre==='Afropop'?'selected':''}>Afropop</option>
        </select>
      </div>
      <div class="form-row"><label class="form-lbl">${t('comm_location')}</label><input class="form-inp" id="pLocation" value="${myP.location||''}" placeholder="Ex: Abidjan, Côte d'Ivoire"></div>
      <div class="form-row"><label class="form-lbl">Bio</label><textarea class="form-inp" id="pBio" rows="3" placeholder="${t('comm_bio_ph')}">${myP.bio||''}</textarea></div>
      <div style="font-family:var(--font-mono);font-size:0.62rem;letter-spacing:2px;color:var(--cyan);margin:18px 0 12px;text-transform:uppercase"><i class="fas fa-share-alt"></i> ${t('comm_social_media')}</div>
      <div class="form-row"><label class="form-lbl"><i class="fab fa-instagram"></i> Instagram</label><input class="form-inp" id="pInsta" value="${myP.instagram||''}" placeholder="https://instagram.com/..."></div>
      <div class="form-row"><label class="form-lbl"><i class="fab fa-youtube"></i> YouTube</label><input class="form-inp" id="pYt" value="${myP.youtube||''}" placeholder="https://youtube.com/..."></div>
      <div class="form-row"><label class="form-lbl"><i class="fab fa-tiktok"></i> TikTok</label><input class="form-inp" id="pTk" value="${myP.tiktok||''}" placeholder="https://tiktok.com/..."></div>
      <div class="form-row"><label class="form-lbl"><i class="fab fa-soundcloud"></i> SoundCloud</label><input class="form-inp" id="pSc" value="${myP.soundcloud||''}" placeholder="https://soundcloud.com/..."></div>
      <div class="form-row"><label class="form-lbl"><i class="fab fa-spotify"></i> Spotify</label><input class="form-inp" id="pSpotify" value="${myP.spotify||''}" placeholder="https://open.spotify.com/..."></div>
      <div style="font-family:var(--font-mono);font-size:0.62rem;letter-spacing:2px;color:var(--cyan);margin:18px 0 12px;text-transform:uppercase"><i class="fas fa-music"></i> ${t('comm_publish_track')}</div>
      <div class="form-row"><label class="form-lbl">${t('comm_track_title')}</label><input class="form-inp" id="pSongTitle" placeholder="Ex: Ma vie — Feat. Je Suis Beatz"></div>
      <div class="form-row"><label class="form-lbl">${t('comm_track_url')}</label><input class="form-inp" id="pSongUrl" placeholder="https://soundcloud.com/..."></div>
      <div class="form-row"><label class="form-lbl">${t('comm_beat_used')}</label>
        <select class="form-inp" id="pSongBeat"><option value="">— ${t('comm_choose_beat')} —</option>${beats.map(b=>`<option value="${b.title}">${b.title}</option>`).join('')}</select>
      </div>
      <div class="form-row"><label class="form-lbl">${t('comm_description')}</label><textarea class="form-inp" id="pSongDesc" rows="2" placeholder="${t('comm_desc_ph')}"></textarea></div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:4px">
        <button class="btn-primary" onclick="saveProfile()" style="flex:1;justify-content:center"><i class="fas fa-save"></i> ${t('admin_save_btn')}</button>
        <button class="btn-ghost" onclick="publishSong()" style="flex:1;justify-content:center"><i class="fas fa-upload"></i> ${t('comm_publish_btn')}</button>
      </div>
    </div>
  </div>`;
}
 
async function saveProfile() {
  if (!currentUser) return;
  const prof = {
    username: document.getElementById('pUsername').value || currentUser.username,
    genre: document.getElementById('pGenre').value,
    location: document.getElementById('pLocation').value,
    bio: document.getElementById('pBio').value,
    instagram: document.getElementById('pInsta').value,
    youtube: document.getElementById('pYt').value,
    tiktok: document.getElementById('pTk').value,
    soundcloud: document.getElementById('pSc').value,
    spotify: document.getElementById('pSpotify').value,
    joined: new Date().getFullYear().toString()
  };
  for (const key of ['instagram', 'youtube', 'tiktok', 'soundcloud', 'spotify']) {
    if (!isValidProfileUrl(prof[key])) {
      showToast('⚠ ' + t('err_invalid_url'));
      return;
    }
  }
  const uid = currentUser.uid || currentUser.username;
  const cleanedProfile = cleanProfileData(prof);
  const saved = await saveProfileToFirestore(uid, cleanedProfile);
  if (!saved) return;
  showToast(t('dyn_profile_saved'));
  renderMyProfile();
}
 
async function publishSong() {
  if (!currentUser) { showToast(t('dyn_login_first')); return; }
  const title=sanitize(document.getElementById('pSongTitle').value.trim());
  const url=document.getElementById('pSongUrl').value.trim();
  if (!title||!url) { showToast('⚠ '+t('err_title_url_required')); return; }
  if(!/^https?:\/\//i.test(url)){ showToast('⚠ '+t('err_invalid_url')); return; }
  const post = { type:'song', username:sanitize(currentUser.username), title, url:encodeURI(url), beatTitle:sanitize(document.getElementById('pSongBeat').value), desc:sanitize(document.getElementById('pSongDesc').value), date:new Date().toLocaleDateString('fr'), likes:0, comments:[] };
  await addPostToFirestore(post);
  document.getElementById('pSongTitle').value=''; document.getElementById('pSongUrl').value=''; document.getElementById('pSongDesc').value='';
  showToast(t('dyn_song_published'));
  renderMyProfile();
}
 
function postCard(p, mine) {
  // ✅ SÉCURITÉ : Données Firestore sanitisées + URLs validées
  const safeTitle    = sanitize(p.title || (t('fs_chip') + ' · ' + sanitize(p.beatTitle || '')));
  const safeBeatTitle= sanitize(p.beatTitle || '');
  const safeDate     = sanitize(p.date || '');
  const safeDesc     = sanitize(p.desc || '');
  const safeUrl      = (p.url && /^https?:\/\//.test(p.url)) ? encodeURI(p.url) : '#';
  return `<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(0,229,255,0.1);border-radius:14px;padding:16px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
      <div>
        <div style="font-family:var(--font-display);font-size:1rem;color:#fff;letter-spacing:1px">${safeTitle}</div>
        <div style="font-family:var(--font-mono);font-size:0.58rem;color:var(--text-dim);margin-top:3px">${safeBeatTitle?`<i class="fas fa-music" style="color:var(--cyan)"></i> ${safeBeatTitle} · `:''}<i class="fas fa-calendar" style="color:var(--cyan)"></i> ${safeDate}</div>
      </div>
      <span style="font-family:var(--font-mono);font-size:0.55rem;padding:3px 10px;border-radius:100px;background:rgba(0,229,255,0.1);border:1px solid rgba(0,229,255,0.2);color:var(--cyan)">${p.type==='freestyle'?'🎤 Freestyle':'🎵 '+t('dyn_tracks_label')}</span>
    </div>
    ${safeDesc?`<p style="font-size:0.82rem;color:var(--text-dim);margin-bottom:12px;line-height:1.5">${safeDesc}</p>`:''}
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      ${safeUrl!=='#'&&p.type==='song'?`<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="btn-ghost" style="font-size:0.65rem;padding:8px 14px;text-decoration:none;display:flex;align-items:center;gap:6px"><i class="fas fa-external-link-alt"></i> ${t('feat_listen')}</a>`:''}
      ${p.type==='freestyle'&&safeUrl!=='#'?`<button onclick="playRecording('${safeUrl}')" class="btn-ghost" style="font-size:0.65rem;padding:8px 14px"><i class="fas fa-play"></i> ${t('fs_play_beat')}</button>`:''}
      ${mine?`<button onclick="deletePost(${Number(p.id)})" style="background:none;border:1px solid rgba(255,100,100,0.3);color:#ff8080;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:0.65rem"><i class="fas fa-trash"></i></button>`:''}
    </div>
  </div>`;
}
 
async function deletePost(id) {
  await deletePostFromFirestore(id);
  showToast(t('dyn_rec_deleted')); renderMyProfile();
}
 
async function renderFeed() {
  const el=document.getElementById('feedContent');
  if (!el) return;
  el.innerHTML=`<div style="text-align:center;padding:40px;color:var(--text-dim);font-family:var(--font-mono);font-size:0.8rem">${t('dyn_loading')}</div>`;
  const posts = await loadPosts();
  if (!posts.length) {
    el.innerHTML=`<div style="text-align:center;padding:60px;background:rgba(255,255,255,0.02);border:1px solid rgba(0,229,255,0.1);border-radius:20px"><i class="fas fa-stream" style="font-size:2.5rem;color:rgba(0,229,255,0.2);display:block;margin-bottom:16px"></i><div style='font-family:var(--font-display);font-size:1.3rem;color:#fff;margin-bottom:8px'>${t('dyn_feed_empty_title')}</div><p style='color:var(--text-dim);font-size:0.9rem'>${t('dyn_feed_empty_sub')}</p></div>`;
    return;
  }
   el.innerHTML=posts.map(p=>{
    const safeUsername = sanitize(p.username || '');
    const safeDate     = sanitize(p.date || '');
    return `
  <div style="background:rgba(255,255,255,0.03);backdrop-filter:blur(20px);border:1px solid rgba(0,229,255,0.12);border-radius:20px;padding:24px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,var(--cyan),#0070a0);display:flex;align-items:center;justify-content:center;font-family:var(--font-display);font-size:1.2rem;color:var(--dark);flex-shrink:0">${safeUsername.charAt(0).toUpperCase()}</div>
      <div><div style="font-family:var(--font-display);font-size:1rem;color:#fff;letter-spacing:1px">${safeUsername}</div><div style="font-family:var(--font-mono);font-size:0.58rem;color:var(--text-dim)">${safeDate}</div></div>
      <span style="margin-left:auto;font-family:var(--font-mono);font-size:0.55rem;padding:4px 12px;border-radius:100px;background:rgba(0,229,255,0.08);border:1px solid rgba(0,229,255,0.2);color:var(--cyan)">${p.type==='freestyle'?'🎤 Freestyle':'🎵 '+t('comm_published_track')}</span>
    </div>
    ${postCard(p, currentUser&&currentUser.username===p.username)}
  </div>`;
  }).join('');
}
// ═══════════════════════════════════════════
// ═══  SYSTÈME BILINGUE FR / EN  ═══════════
// ═══════════════════════════════════════════
 
const translations = {
  fr: {
    // Nav
    nav_home: 'Accueil',
    nav_artists: 'Artistes',
    nav_licenses: 'Licences',
    nav_login: 'Connexion',
    nav_account: 'Mon Compte',
    nav_freestyle: 'Freestyle',
    // Hero
    hero_badge: "Côte d'Ivoire · Distribution Internationale",
    hero_title: 'Le Studio<br><span class="cyan">du Beatmaker</span>',
    hero_slogan: 'Je suis le son que vous cherchez',
    hero_explore: 'Explorer les Beats',
    hero_licenses: 'Voir les Licences',
    // Stats
    stat_beats: 'Beats',
    stat_available: 'Disponible',
    stat_international: 'International',
    // Footer Genres
    footer_genres: 'Genres',
    footer_made_with: 'Fait avec <i class="fas fa-heart" style="color:var(--cyan)"></i> par Je Suis Beatz',
    // Featured
    featured_chip: 'Nouveau drop',
    featured_title: 'Beat en Vedette',
    // Footer
    footer_desc: "Producteur basé en Côte d'Ivoire. Des sons premium conçus pour dominer les charts internationaux. <em style=\"color:var(--cyan);font-style:italic\">Je suis le son que vous cherchez.</em>",
    footer_nav: 'Navigation',
    footer_catalog: 'Catalogue Beats',
    footer_freestyle: 'Mode Freestyle',
    footer_artists: 'Espace Artistes',
    footer_rights: '© 2026 Je Suis Beatz · Tous droits réservés · Abidjan, Côte d\'Ivoire',
    // Beats
    beats_chip: 'Catalogue',
    beats_title: 'Tous les Beats',
    beats_sub: 'Des productions premium pour tous les styles. Téléchargement immédiat après achat.',
    filter_all: 'Tous',
    // Licenses
    lic_title: 'Choisissez votre Licence',
    lic_sub: 'Des licences adaptées à chaque projet, du morceau amateur à la sortie commerciale internationale.',
    lic_basic_name: 'BASIC',
    lic_basic_tagline: 'Pour démarrer',
    lic_basic_feat_mp3: '✅ Fichier MP3 taggé (320 kbps)',
    lic_basic_feat_streams: '✅ 50 000 streams (YouTube, Spotify, Apple Music)',
    lic_basic_feat_social: '✅ Réseaux sociaux & contenu personnel',
    lic_basic_feat_oneartist: '✅ 1 artiste uniquement',
    lic_basic_feat_nonexclusive: '✅ Licence perpétuelle non-exclusive',
    lic_basic_feat_no_commercial: '❌ Pas d’usage commercial',
    lic_basic_feat_no_wav: '❌ WAV non inclus',
    lic_basic_note: 'Licence perpétuelle non-exclusive à usage personnel et non-commercial, limitée à 50 000 streams cumulés sur toutes plateformes.',
    lic_basic_tag: 'Pour démarrer',
    lic_choose_basic: 'Choisir Basic',
    lic_premium_badge: 'Recommandé',
    lic_premium_name: 'PREMIUM',
    lic_premium_tagline: 'Le plus populaire · Recommandé',
    lic_premium_feat_files: '✅ Fichiers MP3 + WAV non taggés (qualité studio)',
    lic_premium_feat_streams: '✅ 150 000 streams (toutes plateformes)',
    lic_premium_feat_commercial: '✅ Usage commercial (vente, streaming monétisé)',
    lic_premium_feat_radio: '✅ Radio & YouTube monétisé OK',
    lic_premium_feat_physical: '✅ Ventes physiques : jusqu’à 2 000 copies',
    lic_premium_feat_distribution: '✅ Distribution mondiale',
    lic_premium_feat_oneartist: '✅ 1 artiste uniquement',
    lic_premium_feat_nonexclusive: '✅ Licence perpétuelle non-exclusive',
    lic_premium_feat_no_stems: '❌ Stems non inclus',
    lic_premium_feat_catalog: '❌ Beat reste en catalogue',
    lic_premium_note: 'Licence perpétuelle non-exclusive à usage commercial, dans les limites de streams et de copies physiques définies ci-dessus.',
    lic_choose_premium: 'Choisir Premium',
    lic_wav_name: 'WAV + STEMS',
    lic_wav_tagline: 'Production complète',
    lic_wav_feat_files: '✅ MP3 + WAV Haute qualité + Stems séparés (kick, snare, mélodie, basse…)',
    lic_wav_feat_streams: '✅ 500 000 streams (toutes plateformes)',
    lic_wav_feat_commercial: '✅ Usage commercial illimité',
    lic_wav_feat_sync: '✅ Radio, TV & sync autorisés',
    lic_wav_feat_physical: '✅ Ventes physiques : jusqu’à 5 000 copies',
    lic_wav_feat_distribution: '✅ Distribution mondiale',
    lic_wav_feat_mastering: '✅ Mix & Mastering professionnel facilité (fichiers sources séparés)',
    lic_wav_feat_oneartist: '✅ 1 artiste uniquement',
    lic_wav_feat_nonexclusive: '✅ Licence perpétuelle non-exclusive',
    lic_wav_feat_catalog: '❌ Beat reste en catalogue',
    lic_wav_note: 'Licence perpétuelle non-exclusive à usage commercial étendu, incluant les fichiers sources (stems) pour usage en production professionnelle, dans les limites définies.',
    lic_choose_wav: 'Choisir WAV + Stems',
    lic_unlimited_name: 'UNLIMITED',
    lic_unlimited_tagline: 'Streams illimités · Beat en catalogue',
    lic_unlimited_feat_files: '✅ MP3 + WAV + Stems séparés',
    lic_unlimited_feat_streams: '✅ Streams illimités sur toutes plateformes',
    lic_unlimited_feat_commercial: '✅ Usage commercial illimité',
    lic_unlimited_feat_sync: '✅ Radio, TV, Sync & Publicité autorisés',
    lic_unlimited_feat_physical: '✅ Ventes physiques illimitées',
    lic_unlimited_feat_distribution: '✅ Distribution mondiale',
    lic_unlimited_feat_oneartist: '✅ 1 artiste uniquement',
    lic_unlimited_feat_nonexclusive: '✅ Licence perpétuelle non-exclusive',
    lic_unlimited_feat_catalog: '❌ Beat reste en catalogue (d’autres peuvent l’acheter)',
    lic_unlimited_note: 'Licence perpétuelle non-exclusive à usage commercial illimité, sans plafond de streams ni de copies, sur tous territoires et supports.',
    lic_choose_unlimited: 'Choisir Unlimited',
    lic_exclusive_name: 'EXCLUSIF',
    lic_exclusive_tagline: 'Droits totaux · Cession définitive',
    lic_exclusive_feat_files: '✅ MP3 + WAV + Stems séparés (qualité master)',
    lic_exclusive_feat_streams: '✅ Streams & ventes illimités',
    lic_exclusive_feat_use: '✅ Tous usages : commercial, radio, TV, cinéma, publicité, sync',
    lic_exclusive_feat_distribution: '✅ Distribution mondiale illimitée',
    lic_exclusive_feat_removed: '✅ Beat retiré du catalogue définitivement',
    lic_exclusive_feat_contract: '✅ Contrat de cession officiel signé (PDF)',
    lic_exclusive_feat_support: '✅ Support prioritaire',
    lic_exclusive_feat_valid: '✅ Les licences non-exclusives déjà vendues restent valides',
    lic_exclusive_note: 'Cession exclusive et définitive de tous droits patrimoniaux d’exploitation sur le beat, sans limitation de durée, de territoire ou d’usage.',
    lic_choose_exclusive: 'Choisir Exclusif',
    lic_legal_note: 'Toutes les licences sont régies par les lois de la République de Côte d’Ivoire et les standards internationaux de propriété intellectuelle (OMPI/WIPO). L’achat d’une licence vaut acceptation des conditions générales d’utilisation.',
    // FAQ
    faq_title: 'Questions fréquentes',
    faq_q1: 'Comment télécharger après achat ?',
    faq_a1: 'Après le paiement, vous recevez un lien de téléchargement immédiat par email. Le fichier est disponible pendant 30 jours.',
    faq_q2: 'Puis-je utiliser le beat sur toutes les plateformes ?',
    faq_a2: "Oui, selon votre licence. Le Premium et l'Exclusif couvrent Spotify, Apple Music, YouTube, TikTok et toutes les plateformes internationales.",
    faq_q3: 'Quels moyens de paiement acceptez-vous ?',
    faq_a3: 'GeniusPay — paiement rapide et sécurisé. Paiement 100% sécurisé.',
    // Contact
    contact_title: 'Travaillons Ensemble',
    contact_sub: "Une question, une collaboration, un projet ? N'hésitez pas à m'écrire.",
    contact_based: 'Basé à',
    contact_dist: 'Distribution',
    contact_dist_val: 'Mondiale — Livraison digitale immédiate',
    contact_form_title: 'Envoyer un Message',
    contact_name: 'Nom complet',
    contact_name_ph: 'Votre nom',
    contact_subject: 'Sujet',
    contact_subject_ph: 'Collaboration, question, achat...',
    contact_msg: 'Message',
    contact_msg_ph: 'Décrivez votre projet...',
    contact_send: 'Envoyer le Message',
    // Freestyle
    fs_title: 'Mode Freestyle',
    fs_sub: 'Choisis un beat, enregistre ton freestyle directement sur le site, réécoute-le et partage-le.',
    fs_select_hint: 'Choisis un beat dans la liste ci-dessus.',
    fs_play_beat: 'Jouer le beat',
    fs_rec_hint: 'Appuie pour enregistrer',
    // Community
    comm_title: 'Artist Space',
    comm_sub: 'Create your artist profile, share your socials, and publish tracks made with Je Suis Beatz beats.',
    // Login
    login_title: 'Sign In',
    login_sub: 'Access your account',
    login_email_label: 'Email or Username',
    login_pwd_label: 'Password',
    login_btn: 'Sign In',
    login_no_account: 'No account?',
    login_register: 'Register',
    login_back: 'Back to site',
    reg_pseudo: 'Username',
    reg_btn: 'Create Account',
    reg_already: 'Already registered?',
    // Cart
    cart_title: 'Cart',
    cart_pay: 'Pay',
    // Edit modal
    edit_beat_title: 'Edit Beat',
    // Dynamic strings (used in JS)
    dyn_no_beat_audio: '⚠ Ce beat n\'a pas de fichier audio',
    dyn_already_cart: '⚠ Déjà dans le panier !',
    dyn_added_cart: '✓ "%s" ajouté au panier !',
    dyn_stop: 'Arrêter',
    dyn_restart: 'Recommencer',
    dyn_pause: 'Pause',
    dyn_cart_empty: 'Votre panier est vide',
    dyn_pay_login: '⚠ Connectez-vous pour payer !',
    dyn_profile_saved: '✓ Profil enregistré !',
    dyn_song_published: '✓ Morceau publié !',
    dyn_freestyle_published: '✓ Freestyle publié sur ton profil !',
    dyn_login_welcome: '✓ Bienvenue %s !',
    dyn_account_created: '✓ Compte créé ! Bienvenue %s !',
    dyn_disconnected: 'Déconnecté',
    dyn_recording_saved: '✅ Enregistrement sauvegardé',
    dyn_no_recording: '⚠ Aucun enregistrement',
    dyn_select_beat_first: '⚠ Sélectionne un beat d\'abord !',
    dyn_mic_denied: '⚠ Accès au micro refusé. Autorise le micro dans ton navigateur.',
    dyn_recording_status: 'Enregistrement en cours...',
    dyn_recording_done: 'Enregistrement terminé ✓',
    dyn_recording_stopped: 'Enregistrement arrêté',
    dyn_recording_prepare: 'Prêt pour un nouvel enregistrement',
    dyn_rec_default: 'Prêt à enregistrer',
    dyn_no_freestyle: '⚠ Enregistre un freestyle d\'abord',
    dyn_login_first: '⚠ Connecte-toi pour publier !',
    dyn_no_sound_pub: '⚠ Aucun enregistrement à publier',
    dyn_loading: 'Chargement...',
    dyn_feed_empty_title: 'Fil vide',
    dyn_feed_empty_sub: 'Sois le premier à publier un freestyle ou un morceau !',
    dyn_msg_sent: '✓ Message envoyé ! Je répondrai sous 24h.',
    dyn_beat_added: '✓ "%s" ajouté !',
    dyn_beat_deleted: 'Beat supprimé',
    dyn_no_artists: 'Aucun artiste inscrit.',
    dyn_be_first: 'Sois le premier !',
    dyn_no_bio: 'Pas encore de bio.',
    dyn_no_pub: 'Aucune publication',
    dyn_sold_label: 'Vendu',
    dyn_available_label: 'Disponible',
    dyn_no_audio: '⚠ Pas de fichier audio pour ce beat',
    dyn_play_error: '⚠ Impossible de lire le fichier audio',
    dyn_pause_beat: 'Pause Beat',
    dyn_rec_deleted: 'Publication supprimée',
    dyn_connect_first: 'Connecte-toi d\'abord',
    dyn_connect_to_create: 'Tu dois te connecter pour créer ton profil artiste.',
    dyn_sign_in: 'Se connecter',
    dyn_no_beat_selected: '—',
    dyn_songs_count: '%s morceaux',
    dyn_download_started: '⬇️ Téléchargement lancé',
    comm_my_profile: 'Mon Profil',
    comm_feed: 'Fil d\'actualité',
    fs_my_rec: 'Mes enregistrements',
    dyn_no_rec_static: 'Aucun enregistrement',
    // Account page
    account_chip: 'Mon Compte',
    account_title: 'Bienvenue dans votre espace client',
    account_sub: 'Gérez vos achats, licences, favoris, factures et paramètres de profil.',
    account_view_purchases: 'Voir mes achats',
    account_dashboard_title: 'Tableau de bord',
    account_tab_purchases: 'Mes Achats',
    account_tab_licenses: 'Licences & Contrats',
    account_tab_favorites: 'Favoris',
    account_tab_billing: 'Facturation',
    account_tab_settings: 'Paramètres',
    account_panel_purchases_title: 'Mes Achats / Téléchargements',
    account_panel_purchases_desc: 'Retrouvez tous vos beats, téléchargements et licences associées.',
    account_panel_licenses_title: 'Mes Licences & Contrats',
    account_panel_licenses_desc: 'Résumé des droits d\'utilisation pour chaque beat acheté.',
    account_panel_favorites_title: 'Mes Favoris',
    account_panel_favorites_desc: 'Beats sauvegardés pour réécoute ou achat ultérieur.',
    account_panel_billing_title: 'Historique de Facturation',
    account_panel_billing_desc: 'Reçus, factures et détails de vos transactions passées.',
    account_panel_settings_title: 'Paramètres du Profil',
    account_panel_settings_desc: 'Modifiez votre nom, email, photo et mot de passe.',
    account_profile_title: 'Profil',
    account_profile_name: 'Nom',
    account_profile_email: 'Email',
    account_profile_photo: 'Photo de profil',
    account_profile_save: 'Enregistrer',
    account_email_placeholder: 'votre@email.com',
    account_password_title: 'Mot de passe',
    account_password_current: 'Mot de passe actuel',
    account_password_new: 'Nouveau mot de passe',
    account_password_change: 'Changer le mot de passe',
    account_name_placeholder: 'Votre nom',
    account_current_password_placeholder: '••••••••',
    account_new_password_placeholder: '••••••••',
    account_profile_saved: 'Profil enregistré.',
    account_profile_error: 'Erreur lors de la sauvegarde du profil.',
    account_no_purchases: 'Aucun achat trouvé pour le moment.',
    account_no_licenses: 'Aucune licence trouvée.',
    account_no_favorites: 'Aucun favori enregistré. Ajoutez des beats aux favoris pour les retrouver ici.',
    account_no_billing: 'Aucun historique de facturation disponible.',
    account_order: 'Commande',
    account_license: 'Licence',
    account_status: 'Statut',
    account_payment_method: 'Paiement',
    account_total: 'Total',
    account_favorite: 'Favori',
    account_beat: 'Beat',
    account_unknown_genre: 'Genre inconnu',
    account_total_spent: 'Dépenses totales',
    admin_client_space: 'Espace client',
    // Admin panel
    admin_add_beat: 'Ajouter un Beat',
    admin_manage_beats: 'Gérer les Beats',
    admin_settings: 'Paramètres',
    admin_view_site: 'Voir le site',
    admin_welcome: 'Bienvenue dans votre espace admin',
    admin_recent_beats: 'Beats récents',
    admin_add_beat_sub: 'Ajoutez un nouveau beat à votre catalogue',
    admin_upload_title: 'Téléverser les fichiers',

    admin_upload_hint: 'Glissez-déposez ou cliquez pour sélectionner. MP3, WAV, MPEG · JPG, PNG, WEBP',
    admin_upload_cover: 'Image de couverture',
    admin_upload_cover_sub: 'Cliquez ou glissez une image',
    admin_upload_audio: 'Fichier audio du beat',
    admin_upload_audio_sub: 'Cliquez ou glissez un audio',
    admin_url_fallback: 'Ou utiliser des URLs externes (optionnel)',
    admin_info: 'Informations',
    admin_manage_beats_sub: 'Modifier ou supprimer vos beats existants',
    admin_full_catalog: 'Catalogue complet',
    admin_settings_sub: 'Configuration du site',
    admin_artist_info: 'Informations artiste',
    admin_security: 'Sécurité',

    admin_title_field: 'Titre *',
    admin_bpm_field: 'BPM *',
    admin_genre_field: 'Genre *',
    admin_subgenre_field: 'Sous-genre',
    admin_price_basic: 'Prix Basic ($)',
    admin_price_premium: 'Prix Premium ($)',
    admin_price_wav: 'Prix WAV + Stems ($)',
    admin_price_unlimited: 'Prix Unlimited ($)',
    admin_price_excl: 'Prix Exclusif ($)',
    admin_status: 'Statut',
    admin_cover_url: 'URL image',
    admin_audio_url: 'URL audio (MP3/WAV)',
    admin_description: 'Description',
    admin_add_beat_btn: 'Ajouter le Beat',
    admin_artist_name: 'Nom artiste',
    admin_email_contact: 'Email contact',
    admin_save_btn: 'Sauvegarder',
    admin_saved_toast: 'Paramètres enregistrés',
    admin_old_pwd: 'Ancien mot de passe',
    admin_new_pwd: 'Nouveau mot de passe',
    admin_change_pwd: 'Changer',
    admin_pwd_changed: 'Mot de passe changé !',
    admin_beat_edited: 'Beat mis à jour !',
    admin_confirm_delete: 'Supprimer ce beat ?',
    admin_menu: 'MENU ADMIN',
    admin_col_title: 'Titre',
    admin_col_status: 'Statut',
    admin_col_actions: 'Actions',
    admin_stat_available: 'Disponible',
    admin_stat_sold: 'Vendu',
    admin_stat_users: 'Utilisateurs',
    dyn_sold_excl_label: 'Vendu (Exclusif)',
    // Freestyle extra
    fs_chip: 'Mode Freestyle',
    fs_choose_beat: 'Sélectionner un Beat',
    fs_selected_beat: 'Beat sélectionné',
    fs_no_beat_selected: 'Aucun beat sélectionné',
    fs_recording_label: 'Enregistrement Vocal',
    fs_listen_mix: 'Écouter le mix',
    fs_download_voice: 'Télécharger',
    fs_publish_profile: 'Publier sur mon profil',
    fs_take_label: 'Prise',
    fs_vocal_solo: 'Vocal seul',
    fs_format_mix: 'MIX STUDIO',
    fs_format_wav: 'WAV',
    studio_effect_reverb: 'Reverb',
    studio_effect_delay: 'Delay',
    studio_effect_mute: 'Muet',
    studio_effect_solo: 'Solo',
    studio_beats_loading: 'Chargement des beats...',
    studio_no_beats: 'Aucun beat disponible',
    // Studio
    studio_listen_export: 'Studio Listen & Export',
    studio_play_mix: 'Listen to Processed Mix',
    studio_hq_export: 'High Quality Export',
    studio_format: 'Format:',
    studio_quality: 'Quality:',
    studio_fmt_webm: 'WebM (Default)',
    studio_fmt_wav: 'WAV Mix (Beat+Voice)',
    studio_fmt_voice: 'Voice only (WebM)',
    studio_q_high: 'High (128kbps+)',
    studio_q_ultra: 'Ultra (256kbps+)',
    studio_q_lossless: 'Lossless (WAV)',
    studio_export_btn: 'Export in Good Quality',
    studio_publish_btn: 'Publish to My Profile',
    studio_mix_title: 'Mixage',
    studio_beat_volume: 'Volume Beat',
    studio_vocal_volume: 'Volume Voix',
    studio_eq_title: 'Égaliseur 3-Bandes',
    studio_band_bass: 'BASSES',
    studio_band_mid: 'MÉDIUMS',
    studio_band_treble: 'AIGUS',
    fs_export_mp3: 'Exporter en MP3',
    fs_publish: 'Publier',
    fs_share_link: 'Copier Lien',
    fs_recording_ready: 'Enregistrement terminé — Écoute ton take',
    fs_listen_recording: 'Écouter l\'enregistrement',
    fs_discard_recording: 'Supprimer',
    fs_listen_mix: 'Écouter le mix',
    fs_play_mode_mix: 'Mix Studio',
    fs_play_mode_vocal: 'Voix seule',
    fs_monitoring_active: '🎧 Monitoring actif — Beat + Voix',
    fs_monitoring_label: 'Monitoring Studio',
    fs_studio_rec_started: '🎧 Studio actif — chantez sur le beat',
    fs_mix_ready: '✅ Mix studio prêt — écoute beat + voix',
    fs_mix_playback_hint: 'Mix studio — beat et voix synchronisés',
    fs_vocal_playback_hint: 'Écoute ta voix seule',
    dyn_recording_processing: 'Traitement de l\'enregistrement...',
    dyn_recording_failed: '❌ Échec de l\'enregistrement',
    dyn_no_active_recording: 'Aucun enregistrement en cours',
    dyn_recording_discarded: 'Enregistrement supprimé',
    dyn_playback_failed: '⚠ Utilise le lecteur audio pour écouter',
    err_invalid_audio: 'Fichier audio invalide',
    dyn_audio_imported: 'Audio importé',
    fs_upload_to_profile: 'Uploader vers mon profil',
    fs_import_audio: 'Importer un freestyle',
    fs_saved_recordings: 'Freestyles sauvegardés',
    studio_mic_error: 'Impossible d\'accéder au microphone',
    studio_spectral_analyzer: 'Analyseur Spectral',
    studio_export_title: 'Export & Partage',
    studio_recording_started: '🔴 Enregistrement synchronisé démarré',
    studio_recording_stopped_toast: '⏹️ Enregistrement arrêté. Prêt à écouter.',
    studio_loading: 'Studio en cours de chargement...',
    studio_error_init: 'Erreur lors de l\'initialisation du studio',
    studio_select_beat_first: 'Sélectionnez un beat avant d\'enregistrer',
    studio_mic_denied: 'Micro refusé — autorise l\'accès dans Réglages > Safari/Chrome',
    studio_mic_not_found: 'Aucun micro détecté sur cet appareil',
    studio_mic_unsupported: 'Enregistrement non supporté — utilise Safari ou Chrome à jour',
    studio_beat_not_found: '❌ Beat introuvable. Vérifiez votre connexion ou choisissez un autre beat.',
    studio_beat_selected: '✅ Beat sélectionné: %s',
    studio_recording_started: '🔴 Enregistrement synchronisé démarré',
    studio_recording_stopped_toast: '⏹️ Enregistrement arrêté. Prêt à écouter.',
    // Community
    comm_chip: 'Community',
    // Error messages
    err_all_fields: 'Tous les champs sont requis',
    err_wrong_creds: 'Identifiants incorrects',
    err_username_format: 'Pseudo : 3-20 caractères, lettres/chiffres/tirets uniquement',
    err_invalid_email: 'Adresse email invalide',
    err_pwd_short: 'Mot de passe trop court (minimum 8 caractères)',
    err_pwd_format: 'Le mot de passe doit contenir au moins 1 majuscule et 1 chiffre',
    err_username_taken: 'Pseudo déjà utilisé',
    err_email_taken: 'Email déjà utilisé',
    err_wrong_pwd: 'Mot de passe incorrect',
    err_pwd_too_short: 'Trop court (min 6 caractères)',
    err_title_bpm_required: 'Titre et BPM requis !',
    err_title_url_required: 'Titre et URL requis !',
    err_invalid_url: 'URL invalide (doit commencer par par https://)',
    // Payment modal
    pay_card_name: 'Card',
    pay_paypal_sub: 'Secure payment',
    pay_loading_paypal: 'Loading PayPal...',
    pay_paypal_note: 'Secure payment via PayPal · Visa, Mastercard, PayPal account accepted.',
    // Featured (dynamic)
    feat_listen: 'Écouter',
    feat_add_cart: 'Ajouter au panier',
    // Register form
    reg_title: 'Create account',
    reg_sub: 'Join Je Suis Beatz',
    // Community
    comm_published_track: 'Track published',
    // Community profile
    comm_artist_label: 'Artist',
    comm_tracks_published: 'tracks published',
    dyn_tracks_label: 'tracks',
    comm_my_posts: 'My posts',
    comm_edit_profile: 'Edit my profile',
    comm_stage_name: 'Stage name',
    comm_music_genre: 'Music genre',
    comm_location: 'Country / City',
    comm_bio_ph: 'Your style, your journey...',
    comm_social_media: 'Social networks',
    comm_publish_track: 'Publish a track',
    comm_track_title: 'Track title',
    comm_track_url: 'Track URL',
    comm_beat_used: 'Beat used',
    comm_choose_beat: 'Choose a beat',
    comm_description: 'Description',
    comm_desc_ph: 'A few words about this track...',
    comm_publish_btn: 'Publish track',
    // Freestyle playing
    fs_playing: 'Lecture en cours...',
    // PayPal toasts
    pay_validating: 'Validation du paiement...',
    pay_validation_error: 'Erreur de validation',
    pay_cancelled: 'Paiement PayPal annulé.',
    pay_error: 'Une erreur est survenue.',
    // Freestyle
    fs_mic_level: 'Niveau Micro',
    // Contact
    contact_email_ph: 'votre@email.com',
    // Studio labels
    studio_title: 'STUDIO PRO',
    studio_subtitle: 'PRODUCTION · MIX · MASTER · EXPORT',
    studio_ready: 'PRÊT',
    studio_close: 'Fermer',
    studio_waveform: 'Waveform — Ta voix',
    studio_eq: 'Égaliseur (EQ)',
    studio_compressor: 'Compresseur',
    studio_reverb: 'Reverb',
    studio_vocal_gain: 'Gain vocal',
    studio_presets: 'Préréglages Voix',
    studio_open_btn: 'Ouvrir le Studio',
    export_login_required: 'Connecte-toi d\'abord',
    export_no_recording: '❌ Aucun enregistrement à exporter',
    export_preparing: '⏳ Préparation de l\'export...',
    export_success: '✅ Freestyle exporté avec succès',
    export_error: '❌ Erreur lors de l\'export',
    publish_preparing: '⏳ Publication en cours...',
    publish_success: '✅ Freestyle publié sur ton profil',
    publish_error: '❌ Erreur lors de la publication',
    share_link_copied: '✅ Lien copié',
    publish_upload_error: '❌ Erreur lors du téléchargement',
    // Login section (FR)
    login_title: 'Connexion',
    login_sub: 'Accédez à votre espace',
    login_email_label: 'Email ou Pseudo',
    login_pwd_label: 'Mot de passe',
    login_email_placeholder: 'Email ou Pseudo',
    login_pwd_placeholder: '••••••••',
    login_btn: 'Se Connecter',
    login_no_account: 'Pas de compte ?',
    login_register: 'S\'inscrire',
    login_back: 'Retour au site',
    login_resend_verify: 'Renvoyer l\'email de vérification',
    reg_pseudo: 'Pseudo',
    reg_pseudo_placeholder: 'Votre pseudo',
    reg_email: 'Email',
    reg_email_placeholder: 'votre@email.com',
    reg_pwd: 'Mot de passe',
    reg_pwd_placeholder: 'Min. 6 caractères',
    reg_btn: 'Créer un Compte',
    reg_already: 'Déjà inscrit ?',
    login_verify_required: '✅ Veuillez vérifier votre email avant de continuer. Un lien de vérification a été envoyé à %s. Si vous ne le recevez pas, vérifiez votre dossier spam ou renvoyez-le.',
    login_verify_resend_error: '⚠ Impossible de renvoyer l\'email de vérification. Réessayez plus tard.',
    login_already_verified: '✅ Votre adresse est déjà vérifiée. Vous pouvez maintenant vous connecter.',
    login_verification_resent: '✅ Email de vérification renvoyé à %s. Vérifiez votre boîte de réception et votre dossier spam.',
    login_resend_enter_credentials: 'Veuillez entrer votre email/pseudo et votre mot de passe pour renvoyer l\'email de vérification.',
    login_resend_username_not_found: 'Pseudo introuvable. Vérifiez vos informations et réessayez.',
    login_verify_send_failed: '⚠ Compte créé, mais l\'email de vérification n\'a pas pu être envoyé. Vérifiez votre adresse ou réessayez plus tard.',
    login_verify_sent: '✅ Compte créé ! Un lien de vérification a été envoyé à %s. Veuillez vérifier votre email avant de vous connecter.',
  },
  en: {
    // Nav
    nav_home: 'Home',
    nav_artists: 'Artists',
    nav_beats: 'Beats',
    nav_licenses: 'Licenses',
    nav_login: 'Login',
    nav_account: 'Account',
    nav_contact: 'Contact',
    nav_freestyle: 'Freestyle',
    // Hero
    hero_badge: "Ivory Coast · International Distribution",
    hero_title: 'The Beat<br><span class="cyan">Maker\'s Studio</span>',
    hero_slogan: 'I am the sound you are looking for',
    hero_explore: 'Explore Beats',
    hero_licenses: 'View Licenses',
    // Stats
    stat_beats: 'Beats',
    stat_international: 'International',
    // Footer Genres
    footer_genres: 'Genres',
    footer_made_with: 'Made with <i class="fas fa-heart" style="color:var(--cyan)"></i> by Je Suis Beatz',
    // Licenses page
    lic_title: 'Choose your License',
    lic_sub: 'Licenses for every project — from amateur releases to international commercial distribution.',
    lic_basic_name: 'BASIC',
    lic_basic_tagline: 'Get started',
    lic_basic_feat_mp3: '✅ Tagged MP3 file (320 kbps)',
    lic_basic_feat_streams: '✅ 50,000 streams (YouTube, Spotify, Apple Music)',
    lic_basic_feat_social: '✅ Social media & personal use',
    lic_basic_feat_oneartist: '✅ Single artist only',
    lic_basic_feat_nonexclusive: '✅ Perpetual non-exclusive license',
    lic_basic_feat_no_commercial: '❌ No commercial use',
    lic_basic_feat_no_wav: '❌ WAV not included',
    lic_basic_note: 'Perpetual non-exclusive license for personal and non-commercial use; limited to 50,000 cumulative streams across platforms.',
    lic_choose_basic: 'Choose Basic',
    lic_premium_badge: 'Recommended',
    lic_premium_name: 'PREMIUM',
    lic_premium_tagline: 'Most popular · Recommended',
    lic_premium_feat_files: '✅ MP3 + WAV (studio quality)',
    lic_premium_feat_streams: '✅ 150,000 streams (all platforms)',
    lic_premium_feat_commercial: '✅ Commercial use (sales, monetized streaming)',
    lic_premium_feat_radio: '✅ Radio & monetized YouTube OK',
    lic_premium_feat_physical: '✅ Physical sales up to 2,000 copies',
    lic_premium_feat_distribution: '✅ Worldwide distribution',
    lic_premium_feat_oneartist: '✅ Single artist only',
    lic_premium_feat_nonexclusive: '✅ Perpetual non-exclusive license',
    lic_premium_feat_no_stems: '❌ Stems not included',
    lic_premium_feat_catalog: '❌ Beat remains in catalog',
    lic_premium_note: 'Perpetual non-exclusive commercial license within the stream and physical copy limits above.',
    lic_choose_premium: 'Choose Premium',
    lic_wav_name: 'WAV + STEMS',
    lic_wav_tagline: 'Complete production',
    lic_wav_feat_files: '✅ MP3 + WAV high quality + separated stems (kick, snare, melody, bass…)',
    lic_wav_feat_streams: '✅ 500,000 streams (all platforms)',
    lic_wav_feat_commercial: '✅ Unlimited commercial use',
    lic_wav_feat_sync: '✅ Radio, TV & sync allowed',
    lic_wav_feat_physical: '✅ Physical sales up to 5,000 copies',
    lic_wav_feat_distribution: '✅ Worldwide distribution',
    lic_wav_feat_mastering: '✅ Mix & mastering friendly (separated source files)',
    lic_wav_feat_oneartist: '✅ Single artist only',
    lic_wav_feat_nonexclusive: '✅ Perpetual non-exclusive license',
    lic_wav_feat_catalog: '❌ Beat remains in catalog',
    lic_wav_note: 'Perpetual non-exclusive commercial license including source files (stems) for professional production.',
    lic_choose_wav: 'Choose WAV + Stems',
    lic_unlimited_name: 'UNLIMITED',
    lic_unlimited_tagline: 'Unlimited streams · Beat remains in catalog',
    lic_unlimited_feat_files: '✅ MP3 + WAV + separated stems',
    lic_unlimited_feat_streams: '✅ Unlimited streams on all platforms',
    lic_unlimited_feat_commercial: '✅ Unlimited commercial use',
    lic_unlimited_feat_sync: '✅ Radio, TV, sync & advertising allowed',
    lic_unlimited_feat_physical: '✅ Unlimited physical sales',
    lic_unlimited_feat_distribution: '✅ Worldwide distribution',
    lic_unlimited_feat_oneartist: '✅ Single artist only',
    lic_unlimited_feat_nonexclusive: '✅ Perpetual non-exclusive license',
    lic_unlimited_feat_catalog: '❌ Beat remains in catalog (others can still buy it)',
    lic_unlimited_note: 'Perpetual non-exclusive commercial license with unlimited streams, copies, and territories.',
    lic_choose_unlimited: 'Choose Unlimited',
    lic_exclusive_name: 'EXCLUSIVE',
    lic_exclusive_tagline: 'Full rights · Permanent transfer',
    lic_exclusive_feat_files: '✅ MP3 + WAV + separated stems (master quality)',
    lic_exclusive_feat_streams: '✅ Unlimited streams & sales',
    lic_exclusive_feat_use: '✅ All uses: commercial, radio, TV, film, advertising, sync',
    lic_exclusive_feat_distribution: '✅ Worldwide unlimited distribution',
    lic_exclusive_feat_removed: '✅ Beat removed from catalog permanently',
    lic_exclusive_feat_contract: '✅ Official transfer agreement signed (PDF)',
    lic_exclusive_feat_support: '✅ Priority support',
    lic_exclusive_feat_valid: '✅ Previously sold non-exclusive licenses remain valid',
    lic_exclusive_note: 'Exclusive permanent transfer of all exploitation rights for the beat, with no duration, territory or usage limits.',
    lic_choose_exclusive: 'Choose Exclusive',
    lic_legal_note: 'All licenses are governed by Ivory Coast law and international intellectual property standards (WIPO). Purchase implies acceptance of the terms of use.',
    // Stats
    stat_available: 'Available',
    // Featured
    featured_chip: 'New drop',
    featured_title: 'Featured Beat',
    // Footer
    footer_desc: "Producer based in Ivory Coast. Premium sounds crafted to dominate the international charts. <em style=\"color:var(--cyan);font-style:italic\">I am the sound you are looking for.</em>",
    footer_nav: 'Navigation',
    footer_catalog: 'Beats Catalog',
    footer_freestyle: 'Freestyle Mode',
    footer_artists: 'Artists Space',
    footer_rights: '© 2026 Je Suis Beatz · All rights reserved · Abidjan, Ivory Coast',
    // Beats
    beats_chip: 'Catalog',
    beats_title: 'All Beats',
    beats_sub: 'Premium productions for every style. Instant download after purchase.',
    filter_all: 'All',
    // Licenses
    lic_title: 'Choose your License',
    lic_sub: 'Licenses tailored to every project, from amateur tracks to international commercial releases.',
    lic_basic_tag: 'Get started',
    lic_b1: 'Non-commercial use',
    lic_b2: '10,000 streams included',
    lic_b3: 'Tagged MP3 file',
    lic_b4: '1 artist only',
    lic_b5: 'Social media OK',
    lic_b6: 'WAV not included',
    lic_choose_basic: 'Choose Basic',
    lic_recommended: 'Recommended',
    lic_premium_tag: 'Most popular',
    lic_p1: 'Commercial use',
    lic_p3: 'WAV + MP3 Untagged',
    lic_p4: 'Radio & YouTube OK',
    lic_p5: 'Physical sales: 2,000',
    lic_p6: 'Worldwide distribution',
    lic_choose_premium: 'Choose Premium',
    lic_excl_tag: 'Full rights',
    lic_e1: 'Exclusive ownership',
    lic_e3: 'WAV + MP3 + Stems',
    lic_e4: 'Official signed contract',
    lic_e5: 'Removed from catalog',
    lic_e6: 'Priority support',
    lic_choose_exclusive: 'Choose Exclusive',
    lic_wav_tag: 'Full production',
    lic_w1: 'Commercial use',
    lic_w2: 'HD WAV + Stems',
    lic_w3: 'Easier mixing & mastering',
    lic_w4: '100,000 streams',
    lic_w5: 'Worldwide distribution',
    lic_w6: 'Beat stays in catalog',
    lic_choose_wav: 'Choose WAV + Stems',
    // FAQ
    faq_title: 'Frequently Asked Questions',
    faq_q1: 'How do I download after purchase?',
    faq_a1: 'After payment, you receive an instant download link by email. The file is available for 30 days.',
    faq_q2: 'Can I use the beat on all platforms?',
    faq_a2: 'Yes, depending on your license. Premium and Exclusive cover Spotify, Apple Music, YouTube, TikTok and all international platforms.',
    faq_q3: 'What payment methods do you accept?',
    faq_a3: 'GeniusPay — fast and secure checkout. 100% secure payment.',
    // Contact
    contact_title: "Let's Work Together",
    contact_sub: 'A question, a collaboration, a project? Feel free to reach out.',
    contact_based: 'Based in',
    contact_dist: 'Distribution',
    contact_dist_val: 'Worldwide — Instant digital delivery',
    contact_form_title: 'Send a Message',
    contact_name: 'Full name',
    contact_name_ph: 'Your name',
    contact_subject: 'Subject',
    contact_subject_ph: 'Collaboration, question, purchase...',
    contact_msg: 'Message',
    contact_msg_ph: 'Describe your project...',
    contact_send: 'Send Message',
    // Freestyle
    fs_title: 'Spit on the Beat',
    fs_sub: 'Choose a beat, record your freestyle directly from the site, listen back and share it.',
    fs_select_hint: 'Select a beat above',
    fs_saved_recordings: 'Saved Freestyles',
    fs_import_audio: 'Import a freestyle',
    fs_play_beat: 'Play Beat',
    fs_rec_hint: 'Press to record',
    fs_mic_denied_title: 'Microphone Access Denied',
    fs_mic_ready: 'Microphone ready',
    fs_ready_record: 'Ready to record',
    // Community
    comm_title: 'Artists Space',
    comm_sub: 'Create your artist profile, share your socials, publish your tracks made with Je Suis Beatz beats.',
    // Login
    login_title: 'Login',
    login_sub: 'Access your space',
    login_email_label: 'Email or Username',
    login_pwd_label: 'Password',
    login_email_placeholder: 'Email or Username',
    login_pwd_placeholder: '••••••••',
    login_btn: 'Sign In',
    login_no_account: 'No account?',
    login_register: 'Sign up',
    login_back: 'Back to site',
    login_resend_verify: 'Resend verification email',
    reg_pseudo: 'Username',
    reg_pseudo_placeholder: 'Your username',
    reg_email: 'Email',
    reg_email_placeholder: 'your@email.com',
    reg_pwd: 'Password',
    reg_pwd_placeholder: 'Min. 6 characters',
    reg_btn: 'Create Account',
    reg_already: 'Already registered?',
    login_verify_required: '✅ Please verify your email before continuing. A verification link has been sent to %s. If you do not receive it, check your spam folder or use the resend link below.',
    login_verify_resend_error: '⚠ Unable to resend the verification email. Please try again later.',
    login_already_verified: '✅ Your email is already verified. You can now sign in.',
    login_verification_resent: '✅ Verification email sent to %s. Check your inbox and spam folder.',
    login_resend_enter_credentials: 'Please enter your email/username and password to resend the verification email.',
    login_resend_username_not_found: 'Username not found. Check your details and try again.',
    login_verify_send_failed: '⚠ Account created, but the verification email could not be sent. Please check your address or try again later.',
    login_verify_sent: '✅ Account created! A verification link has been sent to %s. Check your email before signing in.',
    // Cart
    cart_title: 'Cart',
    cart_pay: 'Pay',
    // Edit modal
    edit_beat_title: 'Edit Beat',
    // Dynamic strings
    dyn_no_beat_audio: '⚠ This beat has no audio file',
    dyn_already_cart: '⚠ Already in cart!',
    dyn_added_cart: '✓ "%s" added to cart!',
    dyn_stop: 'Stop',
    dyn_restart: 'Restart',
    dyn_pause: 'Pause',
    dyn_cart_empty: 'Your cart is empty',
    dyn_pay_login: '⚠ Please log in to pay!',
    dyn_profile_saved: '✓ Profile saved!',
    dyn_song_published: '✓ Track published!',
    dyn_freestyle_published: '✓ Freestyle published on your profile!',
    dyn_login_welcome: '✓ Welcome %s!',
    dyn_account_created: '✓ Account created! Welcome %s!',
    dyn_disconnected: 'Logged out',
    dyn_recording_saved: '✓ Freestyle recorded!',
    dyn_no_recording: '⚠ No recordings',
    dyn_select_beat_first: '⚠ Select a beat first!',
    dyn_mic_denied: '⚠ Microphone access denied. Allow mic access in your browser.',
    dyn_recording_status: 'Recording...',
    dyn_recording_done: 'Recording complete',
    dyn_recording_stopped: 'Recording stopped',
    dyn_recording_prepare: 'Preparing a new take...',
    dyn_rec_default: 'Press to record',
    dyn_no_freestyle: '⚠ Record a freestyle first',
    dyn_login_first: '⚠ Log in to publish!',
    dyn_no_sound_pub: '⚠ No recording to publish',
    dyn_loading: 'Loading...',
    dyn_feed_empty_title: 'Empty feed',
    dyn_feed_empty_sub: 'Be the first to post a freestyle or a track!',
    dyn_msg_sent: '✓ Message sent! I\'ll reply within 24h.',
    dyn_beat_added: '✓ "%s" added!',
    dyn_beat_deleted: 'Beat deleted',
    dyn_no_artists: 'No artists registered.',
    dyn_be_first: 'Be the first!',
    dyn_no_bio: 'No bio yet.',
    dyn_no_pub: 'No publications',
    dyn_sold_label: 'Sold',
    dyn_available_label: 'Available',
    dyn_no_audio: '⚠ No audio file for this beat',
    dyn_play_error: '⚠ Unable to play the audio file',
    dyn_pause_beat: 'Pause Beat',
    dyn_rec_deleted: 'Post deleted',
    dyn_connect_first: 'Login first',
    dyn_connect_to_create: 'You must be logged in to create your artist profile.',
    dyn_sign_in: 'Sign In',
    dyn_no_beat_selected: '—',
    dyn_songs_count: '%s tracks',
    dyn_download_started: '⬇️ Download started',
    comm_my_profile: 'My Profile',
    comm_feed: 'News Feed',
    fs_my_rec: 'My recordings',
    dyn_no_rec_static: 'No recordings',
    // Account page
    account_chip: 'Customer Dashboard',
    account_title: 'Welcome to your customer space',
    account_sub: 'Manage your purchases, licenses, favorites, invoices and profile settings.',
    account_view_purchases: 'View my purchases',
    account_dashboard_title: 'Dashboard',
    account_tab_purchases: 'Purchases',
    account_tab_licenses: 'Licenses & Contracts',
    account_tab_favorites: 'Favorites',
    account_tab_billing: 'Billing',
    account_tab_settings: 'Settings',
    account_panel_purchases_title: 'My Purchases / Downloads',
    account_panel_purchases_desc: 'Find all your beats, downloads and associated licenses.',
    account_panel_licenses_title: 'My Licenses & Contracts',
    account_panel_licenses_desc: 'Summary of usage rights for each purchased beat.',
    account_panel_favorites_title: 'My Favorites',
    account_panel_favorites_desc: 'Saved beats for replay or later purchase.',
    account_panel_billing_title: 'Billing History',
    account_panel_billing_desc: 'Receipts, invoices and details of your past transactions.',
    account_panel_settings_title: 'Profile Settings',
    account_panel_settings_desc: 'Change your name, email, photo and password.',
    account_profile_title: 'Profile',
    account_profile_name: 'Name',
    account_profile_email: 'Email',
    account_profile_photo: 'Profile photo',
    account_profile_save: 'Save',
    account_email_placeholder: 'your@email.com',
    account_password_title: 'Password',
    account_password_current: 'Current password',
    account_password_new: 'New password',
    account_password_change: 'Change password',
    account_name_placeholder: 'Your name',
    account_current_password_placeholder: '••••••••',
    account_new_password_placeholder: '••••••••',
    account_profile_saved: 'Profile saved.',
    account_profile_error: 'Error saving profile.',
    account_no_purchases: 'No purchases found yet.',
    account_no_licenses: 'No licenses found.',
    account_no_favorites: 'No favorites saved. Add beats to favorites to find them here.',
    account_no_billing: 'No billing history available.',
    account_order: 'Order',
    account_license: 'License',
    account_status: 'Status',
    account_payment_method: 'Payment',
    account_total: 'Total',
    account_favorite: 'Favorite',
    account_beat: 'Beat',
    account_unknown_genre: 'Unknown genre',
    account_total_spent: 'Total spent',
    admin_client_space: 'Customer space',
    // Admin panel
    admin_add_beat: 'Add a Beat',
    admin_manage_beats: 'Manage Beats',
    admin_settings: 'Settings',
    admin_view_site: 'View Site',
    admin_welcome: 'Welcome to your administration panel',
    admin_recent_beats: 'Recent Beats',
    admin_add_beat_sub: 'Add a new beat to your catalog',
    admin_upload_title: 'Upload files',
    admin_upload_hint: 'Drag & drop or click to select. MP3, WAV, MPEG · JPG, PNG, WEBP',
    admin_upload_cover: 'Cover image',
    admin_upload_cover_sub: 'Click or drag an image',
    admin_upload_audio: 'Beat audio file',
    admin_upload_audio_sub: 'Click or drag an audio file',
    admin_url_fallback: 'Or use external URLs (optional)',
    admin_info: 'Information',
    admin_manage_beats_sub: 'Edit or delete your existing beats',
    admin_full_catalog: 'Full catalog',
    admin_settings_sub: 'Site configuration',
    admin_artist_info: 'Artist information',
    admin_security: 'Security',
    admin_title_field: 'Title *',
    admin_bpm_field: 'BPM *',
    admin_genre_field: 'Genre *',
    admin_subgenre_field: 'Sub-genre',
    admin_price_basic: 'Basic price ($)',
    admin_price_premium: 'Premium price ($)',
    admin_price_wav: 'WAV + Stems price ($)',
    admin_price_unlimited: 'Unlimited price ($)',
    admin_price_excl: 'Exclusive price ($)',
    admin_status: 'Status',
    admin_cover_url: 'Image URL',
    admin_audio_url: 'Audio URL (MP3/WAV)',
    admin_description: 'Description',
    admin_add_beat_btn: 'Add Beat',
    admin_artist_name: 'Artist name',
    admin_email_contact: 'Contact email',
    admin_save_btn: 'Save',
    admin_saved_toast: 'Settings saved',
    admin_old_pwd: 'Old password',
    admin_new_pwd: 'New password',
    admin_change_pwd: 'Change',
    admin_pwd_changed: 'Password changed!',
    admin_beat_edited: 'Beat updated!',
    admin_confirm_delete: 'Delete this beat?',
    admin_menu: 'ADMIN MENU',
    admin_col_title: 'Title',
    admin_col_status: 'Status',
    admin_col_actions: 'Actions',
    admin_stat_available: 'Available',
    admin_stat_sold: 'Sold',
    admin_stat_users: 'Users',
    dyn_sold_excl_label: 'Sold (Exclusive)',
    // Freestyle extra
    fs_chip: 'Freestyle Mode',
    fs_choose_beat: 'Choose a beat',
    fs_selected_beat: 'Selected beat',
    fs_no_beat_selected: 'No beat selected',
    fs_recording_label: 'Recording',
    fs_listen_mix: 'Listen to Mix',
    fs_download_voice: 'Download my voice',
    fs_publish_profile: 'Publish on my profile',
    fs_take_label: 'Take',
    fs_vocal_solo: 'Vocals only',
    fs_format_mix: 'STUDIO MIX',
    fs_format_wav: 'WAV',
    studio_effect_reverb: 'Reverb',
    studio_effect_delay: 'Delay',
    studio_effect_mute: 'Mute',
    studio_effect_solo: 'Solo',
    studio_beats_loading: 'Loading beats...',
    studio_no_beats: 'No beats available',
    fs_mix_info: 'The mix plays the beat + your voice simultaneously for a realistic preview of the final result.',
    // Studio
    studio_listen_export: 'Listen & Export Studio',
    studio_play_mix: 'Listen to Processed Mix',
    studio_hq_export: 'High Quality Export',
    studio_format: 'Format:',
    studio_quality: 'Quality:',
    studio_fmt_webm: 'WebM (Default)',
    studio_fmt_wav: 'WAV Mix (Beat+Voice)',
    studio_fmt_voice: 'Voice only (WebM)',
    studio_q_high: 'High (128kbps+)',
    studio_q_ultra: 'Ultra (256kbps+)',
    studio_q_lossless: 'Lossless (WAV)',
    studio_export_btn: 'Export in High Quality',
    studio_publish_btn: 'Publish to my Profile',
    studio_mix_title: 'Mix',
    studio_beat_volume: 'Beat Volume',
    studio_vocal_volume: 'Vocal Volume',
    studio_eq_title: '3-Band Equalizer',
    studio_band_bass: 'BASS',
    studio_band_mid: 'MID',
    studio_band_treble: 'TREBLE',
    fs_export_mp3: 'Export as MP3',
    fs_publish: 'Publish',
    fs_share_link: 'Copy Link',
    fs_recording_ready: 'Recording complete — Listen to your take',
    fs_listen_recording: 'Listen to recording',
    fs_discard_recording: 'Delete',
    fs_listen_mix: 'Listen to mix',
    fs_play_mode_mix: 'Studio Mix',
    fs_play_mode_vocal: 'Vocals only',
    fs_monitoring_active: '🎧 Monitoring active — Beat + Vocals',
    fs_monitoring_label: 'Studio Monitoring',
    fs_studio_rec_started: '🎧 Studio live — rap over the beat',
    fs_mix_ready: '✅ Studio mix ready — listen beat + vocals',
    fs_mix_playback_hint: 'Studio mix — beat and vocals synced',
    fs_vocal_playback_hint: 'Listen to your vocals only',
    dyn_recording_processing: 'Processing recording...',
    dyn_recording_failed: '❌ Recording failed',
    dyn_no_active_recording: 'No active recording',
    dyn_recording_discarded: 'Recording deleted',
    dyn_playback_failed: '⚠ Use the audio player to listen',
    studio_mic_error: 'Unable to access the microphone',
    studio_spectral_analyzer: 'Spectral Analyzer',
    studio_export_title: 'Export & Share',
    studio_recording_started: '🔴 Synchronized recording started',
    studio_recording_stopped_toast: '⏹️ Recording stopped. Ready to listen.',
    studio_loading: 'Studio is loading...',
    studio_error_init: 'Error initializing the studio',
    studio_select_beat_first: 'Select a beat before recording',
    studio_mic_denied: 'Mic denied — allow access in browser settings',
    studio_mic_not_found: 'No microphone detected on this device',
    studio_mic_unsupported: 'Recording not supported — use an up-to-date Safari or Chrome',
    studio_beat_not_found: '❌ Beat not found. Check your connection or choose another beat.',
    studio_beat_selected: '✅ Beat selected: %s',
    studio_recording_started: '🔴 Synchronized recording started',
    studio_recording_stopped_toast: '⏹️ Recording stopped. Ready to listen.',
    // Community
    comm_chip: 'Community',
    // Error messages
    err_all_fields: 'All fields are required',
    err_wrong_creds: 'Incorrect credentials',
    err_username_format: 'Username: 3-20 characters, letters/numbers/dashes only',
    err_invalid_email: 'Invalid email address',
    err_pwd_short: 'Password too short (minimum 8 characters)',
    err_pwd_format: 'Password must contain at least 1 uppercase letter and 1 number',
    err_username_taken: 'Username already taken',
    err_email_taken: 'Email already in use',
    err_wrong_pwd: 'Incorrect password',
    err_pwd_too_short: 'Too short (min 6 chars)',
    err_title_bpm_required: 'Title and BPM are required!',
    err_title_url_required: 'Title and URL are required!',
    err_invalid_url: 'Invalid URL (must start with https://)',
    // Payment modal
    pay_card_name: 'Credit Card',
    pay_paypal_sub: 'Secure payment',
    pay_loading_paypal: 'Loading PayPal...',
    pay_paypal_note: 'Secured by PayPal · Visa, Mastercard, PayPal account accepted.',
    payModalTitle: 'Choose a payment method',
    // Featured (dynamic)
    feat_listen: 'Listen',
    feat_add_cart: 'Add to Cart',
    // Register form
    reg_title: 'Create Account',
    reg_sub: 'Join Je Suis Beatz',
    // Community
    comm_published_track: 'Published track',
    // Community profile
    comm_artist_label: 'Artist',
    comm_tracks_published: 'tracks published',
    dyn_tracks_label: 'tracks',
    comm_my_posts: 'My posts',
    comm_edit_profile: 'Edit my profile',
    comm_stage_name: 'Stage Name',
    comm_music_genre: 'Music Genre',
    comm_location: 'Country / City',
    comm_bio_ph: 'Your style, your journey...',
    comm_social_media: 'Social Media',
    comm_publish_track: 'Publish a Track',
    comm_track_title: 'Track title',
    comm_track_url: 'Track URL',
    comm_beat_used: 'Beat used',
    comm_choose_beat: 'Choose a beat',
    comm_description: 'Description',
    comm_desc_ph: 'A few words about this track...',
    comm_publish_btn: 'Publish track',
    // Freestyle playing
    fs_playing: 'Playing...',
    // PayPal toasts
    pay_validating: 'Validating payment...',
    pay_validation_error: 'Validation error',
    pay_cancelled: 'PayPal payment cancelled.',
    pay_error: 'An error occurred.',
    // Freestyle
    fs_mic_level: 'Mic level',
    // Contact
    contact_email_ph: 'your@email.com',
    // Studio labels
    studio_title: 'VIRTUAL STUDIO',
    studio_subtitle: 'PRODUCTION · MIX · MASTER · HD EXPORT',
    studio_ready: 'READY',
    studio_close: 'Close',
    studio_waveform: 'Waveform — Your voice',
    studio_eq: 'Equalizer (EQ)',
    studio_compressor: 'Compressor',
    studio_reverb: 'Reverb',
    studio_vocal_gain: 'Vocal Gain',
    studio_presets: 'Voice Presets',
    studio_open_btn: 'Open Studio',
    export_login_required: 'Please sign in first',
    export_no_recording: '❌ No recording to export',
    export_preparing: '⏳ Preparing export...',
    export_success: '✅ Freestyle exported successfully',
    export_error: '❌ Export error',
    publish_preparing: '⏳ Publishing...',
    publish_success: '✅ Freestyle published on your profile',
    publish_error: '❌ Publishing error',
    share_link_copied: '✅ Link copied',
    publish_upload_error: '❌ Upload error',
  }
};
 
// ─── Current language state ───
let currentLang = localStorage.getItem('jsb_lang') || 'fr';
 
// ─── Get translation ───
function t(key, ...args) {
  currentLang = localStorage.getItem('jsb_lang') || currentLang || 'fr';
  if (!['fr', 'en'].includes(currentLang)) currentLang = 'fr';
  const lang = translations[currentLang] || translations['fr'];
  let str = lang[key] || translations['fr'][key] || key;
  args.forEach(a => { str = str.replace('%s', a); });
  return str;
}
 
// ─── Apply translations to all data-i18n elements ───
function applyTranslations() {
  currentLang = localStorage.getItem('jsb_lang') || currentLang || 'fr';
  if (!['fr', 'en'].includes(currentLang)) currentLang = 'fr';
  // Text elements
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const val = t(key);
    if (el.innerHTML !== val) el.innerHTML = val;
  });
  // Placeholder elements
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const key = el.getAttribute('data-i18n-ph');
    el.placeholder = t(key);
  });
  // Other data-i18n-* attributes (e.g. data-i18n-pay)
  // Scan attributes on all elements and apply translations for any attribute that starts with 'data-i18n-'
  document.querySelectorAll('*').forEach(el => {
    Array.from(el.attributes).forEach(attr => {
      if (!attr.name.startsWith('data-i18n-') || attr.name === 'data-i18n' || attr.name === 'data-i18n-ph') return;
      const key = attr.value;
      if (!key) return;
      if (attr.name === 'data-i18n-title') {
        el.title = t(key);
      } else if (attr.name === 'data-i18n-alt') {
        el.alt = t(key);
      } else if (attr.name === 'data-i18n-value') {
        el.value = t(key);
      } else {
        el.textContent = t(key);
      }
    });
  });
  // Update html lang attribute
  document.documentElement.lang = currentLang;
  // Update lang button
  const flag = document.getElementById('langFlag');
  const label = document.getElementById('langLabel');
  if (flag && label) {
    if (currentLang === 'fr') { flag.textContent = '🇬🇧'; label.textContent = 'EN'; }
    else { flag.textContent = '🇫🇷'; label.textContent = 'FR'; }
  }
  const accountBtn = document.getElementById('accountBtn');
  if (accountBtn) accountBtn.title = t('nav_account');
  // Update dynamic UI strings that are rendered via JS
  updateDynamicStrings();
}
 
// ─── Update strings that are rendered in JS ───
function updateDynamicStrings() {
  // Cart empty state
  const ci = document.getElementById('cartItems');
  if (ci) {
    const empty = ci.querySelector('.cart-empty');
    if (empty) empty.innerHTML = '<i class="fas fa-shopping-bag"></i>' + t('dyn_cart_empty');
  }
  // Auth button
  const authBtn = document.getElementById('authBtn');
  if (authBtn) {
    const sp = authBtn.querySelector('[data-i18n="nav_login"]');
    if (sp) sp.textContent = t('nav_login');
  }
  // Re-render freestyle UI
  updateFreestylePageStrings();
  if (typeof window.updateFreestyleTranslations === 'function') {
    window.updateFreestyleTranslations();
  }
  const commProfiles = document.getElementById('comm-profiles');
  if (commProfiles && commProfiles.style.display !== 'none') renderArtistsGrid();
  const commMyProfile = document.getElementById('comm-my-profile');
  if (commMyProfile && commMyProfile.style.display !== 'none') renderMyProfile();
  const commFeed = document.getElementById('comm-feed');
  if (commFeed && commFeed.style.display !== 'none') renderFeed();
  // Re-apply payment translations if modal is open
  if (document.getElementById('paymentModal')?.classList.contains('show')) {
    applyPayTranslations();
    renderPaySummary();
  }
  // Update studioPlayBtn if not currently playing
  const studioPlayBtn = document.getElementById('studioPlayBtn');
  if (studioPlayBtn && !studioPlaying) {
    studioPlayBtn.innerHTML = '<i class="fas fa-play" id="studioPlayIcon"></i> <span data-i18n="studio_play_mix">' + t('studio_play_mix') + '</span>';
  }
  // Update export format <option> text
  const exportFormat = document.getElementById('exportFormat');
  if (exportFormat) {
    const fmtKeys = ['studio_fmt_webm', 'studio_fmt_wav', 'studio_fmt_voice'];
    exportFormat.querySelectorAll('option').forEach((opt, i) => {
      if (fmtKeys[i]) opt.textContent = t(fmtKeys[i]);
    });
  }
  // Update export quality <option> text
  const exportQuality = document.getElementById('exportQuality');
  if (exportQuality) {
    const qKeys = ['studio_q_high', 'studio_q_ultra', 'studio_q_lossless'];
    exportQuality.querySelectorAll('option').forEach((opt, i) => {
      if (qKeys[i]) opt.textContent = t(qKeys[i]);
    });
  }
  // Update studio status label if not mid-processing
  const studioStatusLabel = document.getElementById('studioStatusLabel');
  if (studioStatusLabel && studioStatusLabel.hasAttribute('data-i18n')) {
    studioStatusLabel.textContent = t(studioStatusLabel.getAttribute('data-i18n'));
  }
}

function updateFreestylePageStrings() {
  const fsBeatMeta = document.getElementById('fsBeatMeta');
  if (fsBeatMeta && !fsSelectedBeat) {
    fsBeatMeta.textContent = t('fs_select_hint');
  }
  const fsBeatName = document.getElementById('fsBeatName');
  if (fsBeatName && !fsSelectedBeat) {
    fsBeatName.textContent = t('fs_no_beat_selected');
  }
  const fsBeatPlayBtn = document.getElementById('fsBeatPlayBtn');
  if (fsBeatPlayBtn) {
    fsBeatPlayBtn.innerHTML = fsPlaying
      ? `<i class='fas fa-pause'></i> ${t('dyn_pause_beat')}`
      : `<i class='fas fa-play'></i> ${t('fs_play_beat')}`;
  }
  const recordStatus = document.getElementById('recordStatus');
  const isRecording = typeof studioInstance !== 'undefined' && studioInstance?.vocalRecorder?.isRecording;
  if (recordStatus && !isRecording && !fsRecording) {
    const resultVisible = document.getElementById('recordingResultSection')?.style.display !== 'none';
    if (!resultVisible) recordStatus.textContent = t('dyn_rec_default');
  }
  const studioReadyLabel = document.getElementById('studioReadyLabel');
  if (studioReadyLabel && studioReadyLabel.hasAttribute('data-i18n')) {
    studioReadyLabel.textContent = t(studioReadyLabel.getAttribute('data-i18n'));
  }
}
 
// ─── Toggle language ───
function toggleLang() {
  currentLang = currentLang === 'fr' ? 'en' : 'fr';
  localStorage.setItem('jsb_lang', currentLang);
  applyTranslations();
  // Re-render dynamic content
  renderAll();
  renderCartItems();
}
 
// ─── Override showToast to use translations where applicable ───
const _origShowToast = showToast;
 
// ─── Patch dynamic JS strings to use t() ───
// These patches ensure runtime messages also switch language
function patchDynamicStrings() {
  // Override filterBeats empty state rendering
  const origRenderBeatsGrid = renderBeatsGrid;
  // Already defined above; we patch the no-beats message via renderAll → renderBeatsGrid
}
 
// ─── Override renderCartItems for translated empty cart ───
const _origRenderCartItems = renderCartItems;
function renderCartItems() {
  const ci = document.getElementById('cartItems');
  const cf = document.getElementById('cartFoot');
  if (!ci) return;
  if (cart.length === 0) {
    ci.innerHTML = `<div class="cart-empty"><i class="fas fa-shopping-bag"></i>${t('dyn_cart_empty')}</div>`;
    if (cf) cf.style.display = 'none';
    return;
  }
  if (cf) cf.style.display = 'block';
  ci.innerHTML = cart.map(c => `
    <div class="cart-item">
      <img src="${c.cover || 'image_beat.jpeg'}" alt="${c.title}" onerror="this.src='image_beat.jpeg'">
      <div class="cart-item-inf">
        <div class="cart-item-nm">${c.title}</div>
        <div class="cart-item-pr">$${c.price} · ${c.license} · ${formatUsdAsCurrency(c.price, 'XOF')}</div>
      </div>
      <button class="cart-rm" data-cart-id="${String(c.id).replace(/"/g, '&quot;')}"><i class="fas fa-times"></i></button>
    </div>`).join('');
  const total = cartTotalUsd();
  document.getElementById('cartTotVal').textContent = '$' + total + ' · ' + formatUsdAsCurrency(total, 'XOF');
}
 
// Apply translations on load
document.addEventListener('DOMContentLoaded', () => {
  applyTranslations();
  initBeatUploadZones();
  initCurrencyRateUpdater();
  setupFsImportInput('fsImportInput');
  if (document.getElementById('recordingsList')) renderRecordingsList();
});
// Also apply after a short delay to catch late-rendered elements
setTimeout(applyTranslations, 300);
 
document.getElementById('cartModal').addEventListener('click', e=>{if(e.target===e.currentTarget)toggleCart();});
document.getElementById('editModal').addEventListener('click', e=>{if(e.target===e.currentTarget)closeEdit();});

document.addEventListener('click', (event) => {
  const removeBtn = event.target.closest('.cart-rm');
  if (!removeBtn) return;
  const itemId = removeBtn.dataset.cartId;
  if (!itemId) return;
  event.preventDefault();
  removeFromCart(itemId);
});

// ═══════════════════════════════════════════════════════
// ═══  STUDIO VIRTUEL — Moteur Audio Web API          ═══
// ═══════════════════════════════════════════════════════

let studioCtx = null;
let studioVoiceBuffer = null;
let studioBeatBuffer = null;
let studioSourceVoice = null;
let studioSourceBeat = null;
let studioGainVoice = null;
let studioGainBeat = null;
let studioCompressor = null;
let studioEQNodes = {};
let studioReverbNode = null;
let studioReverbGain = null;
let studioDryGain = null;
let studioPlaying = false;
let studioStartTime = 0;
let studioAnimFrame = null;

function openStudio() {
  const panel = document.getElementById('studioPanel');
  panel.style.display = 'block';
  panel.scrollIntoView({behavior:'smooth', block:'start'});
  initStudioContext();
  drawStudioWaveform();
  setStudioStatus(currentLang==='en'?'READY':'PRÊT', '#4ade80');
}

function closeStudio() {
  studioStopMix();
  document.getElementById('studioPanel').style.display = 'none';
}

function setStudioStatus(label, color) {
  const dot = document.getElementById('studioStatusDot');
  const lbl = document.getElementById('studioStatusLabel');
  if (dot) { dot.style.background = color; dot.style.boxShadow = `0 0 8px ${color}`; }
  if (lbl) lbl.textContent = label;
}

function initStudioContext() {
  if (studioCtx && studioCtx.state !== 'closed') return;
  studioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

// ─── Dessiner la waveform de l'enregistrement ───
function drawStudioWaveform() {
  const canvas = document.getElementById('studioWaveform');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth * window.devicePixelRatio || 800;
  canvas.height = canvas.offsetHeight * window.devicePixelRatio || 160;
  ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
  const W = canvas.offsetWidth, H = canvas.offsetHeight;

  ctx.clearRect(0, 0, W, H);

  if (!fsRecordings.length) {
    // Waveform décorative si pas d'enregistrement
    ctx.strokeStyle = 'rgba(5,150,105,0.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x < W; x++) {
      const y = H/2 + Math.sin(x * 0.05) * 15 * Math.sin(x * 0.02);
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(167,139,250,0.3)';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(currentLang==='en'?'— Record a freestyle to see the waveform —':'— Enregistre ton freestyle pour voir la waveform —', W/2, H/2+4);
    return;
  }

  // Décoder et dessiner le vrai signal audio
  fetch(fsRecordings[0].url)
    .then(r => r.arrayBuffer())
    .then(buf => {
      if (!studioCtx) initStudioContext();
      studioCtx.decodeAudioData(buf, decoded => {
        studioVoiceBuffer = decoded;
        const data = decoded.getChannelData(0);
        const step = Math.ceil(data.length / W);
        const gradient = ctx.createLinearGradient(0, 0, W, 0);
        gradient.addColorStop(0, '#059669');
        gradient.addColorStop(0.5, '#34d399');
        gradient.addColorStop(1, '#065f46');
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < W; i++) {
          let min = 1, max = -1;
          for (let j = 0; j < step; j++) {
            const d = data[i * step + j] || 0;
            if (d < min) min = d;
            if (d > max) max = d;
          }
          const yMin = H/2 + min * (H/2 * 0.85);
          const yMax = H/2 + max * (H/2 * 0.85);
          ctx.moveTo(i, yMin);
          ctx.lineTo(i, yMax);
        }
        ctx.stroke();
      }, () => {});
    }).catch(() => {});
}

// ─── Construire la chaîne audio du studio ───
// ─── Decode voice depuis le Blob stocké en mémoire (zéro CORS) ───
async function decodeVoiceFromBlob() {
  if (!studioCtx) initStudioContext();
  if (studioCtx.state === 'suspended') await studioCtx.resume();
  if (!fsRecordings.length) return null;

  const rec = fsRecordings[0];

  // Méthode 1 : Blob directement en mémoire (le plus fiable)
  if (rec.blob instanceof Blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        studioCtx.decodeAudioData(e.target.result.slice(0), buf => resolve(buf), err => reject(new Error(currentLang==='en'?'Audio decode failed':'Décodage audio échoué')));
      };
      reader.onerror = () => reject(new Error(currentLang==='en'?'Cannot read Blob':'Lecture Blob impossible'));
      reader.readAsArrayBuffer(rec.blob);
    });
  }

  // Méthode 2 : fallback XHR sur blob URL
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', rec.url, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = () => {
      studioCtx.decodeAudioData(xhr.response.slice(0), buf => resolve(buf), () => reject(new Error(currentLang==='en'?'Decode failed':'Décodage échoué')));
    };
    xhr.onerror = () => reject(new Error(currentLang === 'en' ? 'Cannot read audio blob' : 'Impossible de lire le blob audio'));
    xhr.send();
  });
}

async function buildStudioChain() {
  if (!studioCtx) initStudioContext();
  if (studioCtx.state === 'suspended') await studioCtx.resume();

  // ─ Decode voix depuis blob local (sans fetch, pas de CORS) ─
  studioVoiceBuffer = await decodeVoiceFromBlob();

  // ─ Beat : on utilise l'élément Audio existant (fsAudio) via MediaElementSource
  //   car l'URL Firebase peut bloquer fetch(). On ne décode pas le beat en buffer.
  studioGainVoice = studioCtx.createGain();
  const vocalVolElem = document.getElementById('vocalVolSlider');
  studioGainVoice.gain.value = (vocalVolElem ? parseFloat(vocalVolElem.value) : 80) / 100;

  studioGainBeat = studioCtx.createGain();
  const beatVolElem = document.getElementById('beatVolSlider');
  studioGainBeat.gain.value = (beatVolElem ? parseFloat(beatVolElem.value) : 70) / 100;

  // ─ Compresseur ─
  studioCompressor = studioCtx.createDynamicsCompressor();
  studioCompressor.threshold.value = -50;
  studioCompressor.ratio.value = 12;
  studioCompressor.attack.value = 0.003;
  studioCompressor.release.value = 0.25;
  studioCompressor.knee.value = 10;

  // ─ EQ (BiquadFilters) sur la voix ─
  const eqFreqs = { eq60: 60, eq250: 250, eq1k: 1000, eq4k: 4000, eq12k: 12000 };
  const eqTypes = { eq60: 'lowshelf', eq250: 'peaking', eq1k: 'peaking', eq4k: 'peaking', eq12k: 'highshelf' };
  let prevNode = studioGainVoice;
  studioEQNodes = {};
  for (const [id, freq] of Object.entries(eqFreqs)) {
    const filter = studioCtx.createBiquadFilter();
    filter.type = eqTypes[id];
    filter.gain.value = 0;
    filter.frequency.value = freq;
    filter.Q.value = 1.4;
    filter.gain.value = parseFloat(document.getElementById(id).value);
    prevNode.connect(filter);
    studioEQNodes[id] = filter;
    prevNode = filter;
  }

  // ─ Reverb (FeedbackDelay) ─
  const reverbSize = parseFloat(document.getElementById('reverbSize').value) / 100;
  const reverbWet = parseFloat(document.getElementById('reverbWet').value) / 100;
  const preDelay = parseFloat(document.getElementById('reverbDelay').value) / 1000;
  studioDryGain = studioCtx.createGain();
  studioDryGain.gain.value = 1 - reverbWet * 0.5;
  studioReverbGain = studioCtx.createGain();
  studioReverbGain.gain.value = reverbWet;
  const reverbDelay = studioCtx.createDelay(2.0);
  reverbDelay.delayTime.value = preDelay + reverbSize * 0.4;
  const reverbFeedback = studioCtx.createGain();
  reverbFeedback.gain.value = reverbSize * 0.5;
  const reverbFilter = studioCtx.createBiquadFilter();
  reverbFilter.type = 'lowpass';
  reverbFilter.frequency.value = Math.max(500, 4000 - reverbSize * 2000);
  prevNode.connect(studioDryGain);
  prevNode.connect(reverbDelay);
  reverbDelay.connect(reverbFilter);
  reverbFilter.connect(reverbFeedback);
  reverbFeedback.connect(reverbDelay);
  reverbFilter.connect(studioReverbGain);

  // ─ Merger final ─
  const merger = studioCtx.createGain();
  merger.gain.value = 1.0;
  studioDryGain.connect(studioCompressor);
  studioReverbGain.connect(studioCompressor);
  studioCompressor.connect(merger);
  studioGainBeat.connect(merger);
  merger.connect(studioCtx.destination);

  return merger;
}

// ─── Play Mix Traité ───
let studioBeatMediaSource = null; // MediaElementSource pour le beat

async function studioPlayMix() {
  if (!fsRecordings.length) { showToast(currentLang==='en'?'⚠ Record a freestyle first!':'⚠ Enregistre d\'abord un freestyle !'); return; }
  if (studioPlaying) { studioStopMix(); return; }

  setStudioStatus(currentLang==='en'?'LOADING...':'CHARGEMENT...', '#f59e0b');
  const btn = document.getElementById('studioPlayBtn');
  if (btn) btn.disabled = true;

  try {
    studioStopMix(true);
    studioVoiceBuffer = null;

    await buildStudioChain();
    if (!studioVoiceBuffer) throw new Error(currentLang==='en'?'Cannot decode voice audio':'Impossible de décoder la voix');

    // ─ Source voix (BufferSource depuis blob local) ─
    studioSourceVoice = studioCtx.createBufferSource();
    studioSourceVoice.buffer = studioVoiceBuffer;
    const pitchSemitones = parseFloat(document.getElementById('pitchShift').value);
    studioSourceVoice.playbackRate.value = Math.pow(2, pitchSemitones / 12);
    studioSourceVoice.connect(studioGainVoice);
    studioSourceVoice.onended = () => { if (studioPlaying) studioStopMix(); };

    // ─ Source beat via MediaElementSource (évite le CORS) ─
    const studioAudioSource = resolveBeatAudioSource(fsSelectedBeat);
    if (fsSelectedBeat && studioAudioSource && fsAudio.src) {
      try {
        // Réutiliser ou créer le MediaElementSource
        if (!studioBeatMediaSource) {
          studioBeatMediaSource = studioCtx.createMediaElementSource(fsAudio);
        }
        studioBeatMediaSource.connect(studioGainBeat);
        fsAudio.currentTime = 0;
        fsAudio.loop = false;
      } catch(e) {
        // Si déjà connecté ou autre erreur, on joue le beat normalement en parallèle
        console.warn('MediaElementSource beat:', e.message);
        fsAudio.currentTime = 0;
        const beatVolElem = document.getElementById('beatVolSlider');
        fsAudio.volume = (beatVolElem ? parseFloat(beatVolElem.value) : 70) / 100;
        fsAudio.play().catch(() => {});
      }
    }

    const startAt = studioCtx.currentTime + 0.1;
    studioSourceVoice.start(startAt);
    // Lancer le beat en parallèle si MediaElementSource connecté
    if (studioBeatMediaSource && fsSelectedBeat) {
      setTimeout(() => { fsAudio.play().catch(() => {}); }, 100);
    }

    studioStartTime = studioCtx.currentTime;
    studioPlaying = true;
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-pause" id="studioPlayIcon"></i> ' + (currentLang==='en'?'Pause':'Pause'); }
    setStudioStatus(currentLang==='en'?'PLAYING':'EN LECTURE', '#4ade80');

    const voiceDuration = studioVoiceBuffer.duration;
    function animProgress() {
      if (!studioPlaying) return;
      const elapsed = studioCtx.currentTime - studioStartTime;
      const pct = Math.min(100, (elapsed / voiceDuration) * 100);
      const bar = document.getElementById('studioProgBar');
      if (bar) bar.style.width = pct + '%';
      if (pct < 100) studioAnimFrame = requestAnimationFrame(animProgress);
      else studioStopMix();
    }
    studioAnimFrame = requestAnimationFrame(animProgress);

  } catch(e) {
    console.error('Studio play error:', e);
    showToast((currentLang==='en'?'❌ Studio error: ':'❌ Erreur studio : ') + e.message);
    setStudioStatus(currentLang==='en'?'ERROR':'ERREUR', '#ef4444');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-play" id="studioPlayIcon"></i> <span data-i18n="studio_play_mix">' + t('studio_play_mix') + '</span>'; }
  }
}

function studioStopMix(silent = false) {
  try { if (studioSourceVoice) studioSourceVoice.stop(); } catch(e) {}
  studioSourceVoice = null;
  studioPlaying = false;
  // Stopper le beat (via fsAudio)
  try { if (fsAudio && !fsAudio.paused) { fsAudio.pause(); fsAudio.currentTime = 0; } } catch(e) {}
  if (studioAnimFrame) cancelAnimationFrame(studioAnimFrame);
  const bar = document.getElementById('studioProgBar');
  if (bar) bar.style.width = '0%';
  const btn = document.getElementById('studioPlayBtn');
  if (btn) btn.innerHTML = '<i class="fas fa-play" id="studioPlayIcon"></i> <span data-i18n="studio_play_mix">' + t('studio_play_mix') + '</span>';
  if (!silent) setStudioStatus(currentLang==='en'?'STOPPED':'ARRÊTÉ', '#94a3b8');
}

// ─── Update EQ en temps réel ───
function updateEQ() {
  const eqFreqs = { eq60: 60, eq250: 250, eq1k: 1000, eq4k: 4000, eq12k: 12000 };
  for (const id of Object.keys(eqFreqs)) {
    const val = parseFloat(document.getElementById(id).value);
    document.getElementById(id + 'Val').textContent = (val > 0 ? '+' : '') + val + 'dB';
    if (studioEQNodes[id]) studioEQNodes[id].gain.value = val;
  }
}

function resetEQ() {
  ['eq60','eq250','eq1k','eq4k','eq12k'].forEach(id => {
    document.getElementById(id).value = 0;
    document.getElementById(id + 'Val').textContent = '0dB';
    if (studioEQNodes[id]) studioEQNodes[id].gain.value = 0;
  });
}

function updateCompressor() {
  if (!studioCompressor) return;
  studioCompressor.threshold.value = parseFloat(document.getElementById('compThreshold').value);
  studioCompressor.ratio.value = parseFloat(document.getElementById('compRatio').value);
  studioCompressor.attack.value = parseFloat(document.getElementById('compAttack').value) / 1000;
  studioCompressor.release.value = parseFloat(document.getElementById('compRelease').value) / 1000;
}

function updateReverb() { /* Recalculated on next play */ }

function updatePitch() {
  if (studioSourceVoice) {
    const st = parseFloat(document.getElementById('pitchShift').value);
    studioSourceVoice.playbackRate.value = Math.pow(2, st / 12);
  }
}

function updateVocalGain() {
  if (studioGainVoice) {
    const vocalVolElem = document.getElementById('vocalVolSlider');
    studioGainVoice.gain.value = (vocalVolElem ? parseFloat(vocalVolElem.value) : 80) / 100;
  }
}

function updateBeatVolStudio() {
  if (studioGainBeat) {
    const beatVolElem = document.getElementById('beatVolSlider');
    studioGainBeat.gain.value = (beatVolElem ? parseFloat(beatVolElem.value) : 70) / 100;
  }
}

// ─── Presets ───
const studioPresets = {
  clean: { eq60:0, eq250:0, eq1k:0, eq4k:0, eq12k:2, compThreshold:-18, compRatio:3, compAttack:30, compRelease:200, reverbSize:20, reverbWet:10, reverbDelay:15, pitchShift:0 },
  rap:   { eq60:4, eq250:-2, eq1k:2, eq4k:3, eq12k:4, compThreshold:-24, compRatio:6, compAttack:10, compRelease:150, reverbSize:15, reverbWet:8,  reverbDelay:10, pitchShift:0 },
  rnb:   { eq60:2, eq250:0,  eq1k:-1, eq4k:2, eq12k:5, compThreshold:-20, compRatio:4, compAttack:50, compRelease:300, reverbSize:50, reverbWet:30, reverbDelay:30, pitchShift:0 },
  trap:  { eq60:6, eq250:-3, eq1k:1,  eq4k:2, eq12k:3, compThreshold:-28, compRatio:8, compAttack:5,  compRelease:100, reverbSize:35, reverbWet:20, reverbDelay:20, pitchShift:-1 },
  afro:  { eq60:3, eq250:2,  eq1k:3,  eq4k:4, eq12k:5, compThreshold:-22, compRatio:4, compAttack:40, compRelease:250, reverbSize:30, reverbWet:15, reverbDelay:25, pitchShift:0 },
  raw:   { eq60:-2, eq250:3, eq1k:0,  eq4k:-2, eq12k:-3, compThreshold:-30, compRatio:2, compAttack:100, compRelease:500, reverbSize:60, reverbWet:40, reverbDelay:50, pitchShift:0 }
};

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZATION SCRIPT — Démarrage du site
// ═══════════════════════════════════════════════════════════════════════════

async function initializeApp() {
  console.log('Initializing Je Suis Beatz...');
  
  try {
    // 1. Attendre que Firebase soit initialisé
    if (typeof firebase === 'undefined' || !window.db) {
      console.warn('Waiting for Firebase to initialize...');
      return setTimeout(initializeApp, 500);
    }
    
    // 2. Initialiser l'authentification
    auth.useDeviceLanguage();
    auth.onAuthStateChanged((user) => {
      if (user) {
        console.log('User logged in:', user.email);
        currentUser = {
          uid: user.uid,
          email: user.email,
          name: user.displayName || user.email.split('@')[0],
          role: 'user'
        };
        sessionStorage.setItem('jsb_user2', JSON.stringify(currentUser));
        updateAuth();
      } else {
        console.log('No user logged in');
        currentUser = null;
        sessionStorage.removeItem('jsb_user2');
        updateAuth();
      }
    });

    // 2.1. Vérifier si l'utilisateur revient d'un lien de vérification email Firebase
    handleEmailVerificationReturn();

    // 2.2. Attendre que Firebase Auth termine la restauration de session
    try {
      await waitForAuthUser(1200);
    } catch (e) {
      // Pas de session active dans le timeout, continuer quand même.
    }
    
    // 3. Charger les beats depuis Firestore
    console.log('Loading beats from Firestore...');
    await loadBeatsFromFirestore();
    
    // 4. Initialiser les taux de change
    console.log('Initializing currency rates...');
    initCurrencyRateUpdater();
    
    // 5. Afficher la page demandée via hash ou route
    console.log('Showing initial route...');
    const initialPage = getPageFromLocation();
    showPage(initialPage);

    window.addEventListener('hashchange', () => {
      const routePage = getPageFromLocation();
      if (routePage !== getCurrentActivePage()) {
        showPage(routePage);
      }
    });
    
    // 6. Initialiser les traductions
    console.log('Initializing translations...');
    setTimeout(() => {
      applyTranslations();
    }, 300);
    
    console.log('Je Suis Beatz initialized successfully! ✓');
    
  } catch (error) {
    console.error('Error during initialization:', error);
    // Afficher un message d'erreur
    showToast('⚠ Erreur d\'initialisation');
  }
}

// Lancer l'initialisation quand le DOM est prêt
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  // DOM est déjà prêt
  initializeApp();
}

function handleEmailVerificationReturn() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  const actionCode = params.get('oobCode');

  if (mode === 'verifyEmail' && actionCode) {
    auth.applyActionCode(actionCode).then(async () => {
      if (auth.currentUser) {
        await auth.currentUser.reload();
      }
      const nextPage = localStorage.getItem('jsb_last_page_before_login') || 'home';
      localStorage.removeItem('jsb_last_page_before_login');
      showToast(currentLang === 'en'
        ? '✅ Email verified! Redirecting...'
        : '✅ Email vérifié ! Redirection en cours...'
      );
      window.history.replaceState({}, document.title, window.location.pathname);
      showPage(nextPage);
    }).catch((error) => {
      console.warn('Email verification failed:', error);
      showToast(currentLang === 'en'
        ? '⚠ Verification failed. Please try again.'
        : '⚠ Échec de la vérification. Réessayez.'
      );
      window.history.replaceState({}, document.title, window.location.pathname);
    });
  }
}

function getPageFromLocation() {
  const hash = window.location.hash.replace(/^#/, '').trim();
  if (hash) return hash;
  const path = window.location.pathname.replace(/^\/+/,'').replace(/\/+$/,'').trim();
  if (path && path !== 'index.html') return path;
  return 'home';
}

function getCurrentActivePage() {
  const active = document.querySelector('.page.active');
  return active ? active.id.replace(/^page-/, '') : 'home';
}

function accountTab(tab, el) {
  document.querySelectorAll('.account-sidebar-item').forEach(btn => {
    btn.classList.toggle('active', btn === el);
  });
  document.querySelectorAll('.account-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `account-panel-${tab}`);
  });
  const panel = document.getElementById(`account-panel-${tab}`);
  if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function getAccountFavorites() {
  try {
    const stored = JSON.parse(localStorage.getItem('jsb_favorites') || '[]');
    return Array.isArray(stored) ? stored.map(String) : [];
  } catch (e) {
    return [];
  }
}

async function renderAccountDashboard() {
  if (!currentUser) return;

  const purchasesEl = document.getElementById('accountPurchasesList');
  const licensesEl = document.getElementById('accountLicensesList');
  const favoritesEl = document.getElementById('accountFavoritesList');
  const billingEl = document.getElementById('accountBillingList');
  const nameInput = document.getElementById('accountName');
  const emailInput = document.getElementById('accountEmail');
  const photoInput = document.getElementById('accountPhotoFile');
  const photoPreview = document.getElementById('accountPhotoPreview');
  const msgEl = document.getElementById('accountSettingsMsg');

  if (nameInput) nameInput.value = currentUser.username || '';
  if (emailInput) emailInput.value = currentUser.email || '';
  if (photoInput) photoInput.value = '';
  if (msgEl) msgEl.textContent = '';

  let userData = {};
  try {
    const userDoc = await db.collection('users').doc(currentUser.uid).get();
    if (userDoc.exists) userData = userDoc.data();
  } catch (e) {
    console.warn('renderAccountDashboard: failed loading user profile', e);
  }

  if (userData.username && nameInput) nameInput.value = sanitize(userData.username);
  const previewUrl = (userData.photoURL || currentUser.photoURL) || '';
  if (previewUrl) {
    currentUser.photoURL = previewUrl;
    sessionStorage.setItem('jsb_user2', JSON.stringify(currentUser));
  }
  if (photoPreview) updateAccountPhotoPreview(previewUrl);

  const orders = [];
  try {
    const ordersSnap = await db.collection('orders').where('userId', '==', currentUser.uid).get();
    ordersSnap.forEach(doc => orders.push({ id: doc.id, ...doc.data() }));
  } catch (e) {
    console.warn('renderAccountDashboard: failed loading orders', e);
  }

  const sortedOrders = orders.slice().sort((a, b) => {
    const aTime = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().getTime() : 0;
    const bTime = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().getTime() : 0;
    return bTime - aTime;
  });

  const favoritesIds = getAccountFavorites();
  const favoriteBeats = beats.filter(b => b.id != null && favoritesIds.includes(String(b.id)));

  function emptyPlaceholder(text) {
    return `<div class="account-placeholder">${sanitize(text)}</div>`;
  }

  const dateLocale = currentLang === 'en' ? 'en-US' : 'fr-FR';
  const orderLabel = t('account_order');
  const paymentLabel = t('account_payment_method');
  const totalLabel = t('account_total');
  const favoriteLabel = t('account_favorite');

  if (purchasesEl) {
    purchasesEl.innerHTML = sortedOrders.length ? sortedOrders.map(order => {
      const createdAt = order.createdAt && order.createdAt.toDate ? order.createdAt.toDate() : new Date();
      const subtotal = Array.isArray(order.cartItems) ? order.cartItems.reduce((sum, item) => sum + Number(item.price || 0), 0) : Number(order.total || order.totalUSD || 0);
      const itemsHtml = Array.isArray(order.cartItems) ? order.cartItems.map(item => `
        <div class="account-subitem">
          <div class="account-subitem-title">${sanitize(item.title)} · ${sanitize(item.license || t('account_license'))}</div>
          <div class="account-subitem-meta">${sanitize(item.price ? '$' + item.price : '—')}</div>
        </div>`).join('') : '';
      return `
        <div class="account-card">
          <div class="account-item-row">
            <div>
              <div class="account-item-title">${sanitize(orderLabel)} ${sanitize(order.orderId || order.id)}</div>
              <div class="account-item-meta">${sanitize(createdAt.toLocaleDateString(dateLocale))} · ${sanitize(order.paymentMethod || '')}</div>
            </div>
            <span class="account-badge">${sanitize(order.status || t('account_status'))}</span>
          </div>
          ${itemsHtml}
          <div class="account-item-row" style="margin-top:12px;justify-content:flex-end;">
            <strong>${sanitize(totalLabel)} : $${subtotal.toFixed(2)}</strong>
          </div>
        </div>`;
    }).join('') : emptyPlaceholder(t('account_no_purchases'));
  }

  const licenseItems = [];
  sortedOrders.forEach(order => {
    (Array.isArray(order.cartItems) ? order.cartItems : []).forEach(item => {
      licenseItems.push({
        title: item.title,
        license: item.license,
        price: item.price,
        orderId: order.orderId || order.id,
        date: order.createdAt && order.createdAt.toDate ? order.createdAt.toDate() : new Date()
      });
    });
  });

  if (licensesEl) {
    licensesEl.innerHTML = licenseItems.length ? licenseItems.map(item => `
      <div class="account-card">
        <div class="account-item-row">
          <div>
            <div class="account-item-title">${sanitize(item.title)}</div>
            <div class="account-item-meta">${sanitize(item.license || t('account_license'))} · ${sanitize(orderLabel)} ${sanitize(item.orderId)}</div>
          </div>
          <span class="account-badge">${sanitize(item.date.toLocaleDateString(dateLocale))}</span>
        </div>
        <div class="account-item-meta">${sanitize(totalLabel)} : $${Number(item.price || 0).toFixed(2)}</div>
      </div>`).join('') : emptyPlaceholder(t('account_no_licenses'));
  }

  if (favoritesEl) {
    favoritesEl.innerHTML = favoriteBeats.length ? favoriteBeats.map(beat => `
      <div class="account-card">
        <div class="account-item-row">
          <div>
            <div class="account-item-title">${sanitize(beat.title || beat.name || t('account_beat'))}</div>
            <div class="account-item-meta">${sanitize(beat.genre || t('account_unknown_genre'))}</div>
          </div>
          <span class="account-badge">${sanitize(favoriteLabel)}</span>
        </div>
      </div>`).join('') : emptyPlaceholder(t('account_no_favorites'));
  }

  if (billingEl) {
    const totalSpent = licenseItems.reduce((sum, item) => sum + Number(item.price || 0), 0);
    const summaryHtml = totalSpent ? `
      <div class="account-card">
        <div class="account-item-title">${sanitize(t('account_total_spent'))}</div>
        <div class="account-item-meta">$${totalSpent.toFixed(2)}</div>
      </div>` : '';
    billingEl.innerHTML = summaryHtml + (sortedOrders.length ? sortedOrders.map(order => `
      <div class="account-card">
        <div class="account-item-row">
          <div>
            <div class="account-item-title">${sanitize(orderLabel)} ${sanitize(order.orderId || order.id)}</div>
            <div class="account-item-meta">${sanitize(order.paymentMethod || t('account_payment_method'))}</div>
          </div>
          <span class="account-badge">${sanitize(order.status || t('account_status'))}</span>
        </div>
        <div class="account-item-meta">${sanitize(order.createdAt && order.createdAt.toDate ? order.createdAt.toDate().toLocaleDateString(dateLocale) : '')}</div>
      </div>`).join('') : emptyPlaceholder(t('account_no_billing')));
  }
}

async function saveAccountProfile() {
  if (!currentUser) return showToast('⚠ Connectez-vous d\'abord.');
  const name = document.getElementById('accountName')?.value.trim() || '';
  const photoFile = document.getElementById('accountPhotoFile')?.files?.[0] || null;
  const msgEl = document.getElementById('accountSettingsMsg');
  if (!name) {
    if (msgEl) msgEl.textContent = 'Veuillez saisir un nom.';
    return;
  }
  let photoURL = currentUser.photoURL || '';
  try {
    if (!photoURL) {
      const existingDoc = await db.collection('users').doc(currentUser.uid).get();
      if (existingDoc.exists) {
        photoURL = existingDoc.data()?.photoURL || photoURL;
      }
    }
    if (photoFile) {
      const ext = (photoFile.name.split('.').pop() || 'jpg').toLowerCase();
      const safeExt = /^(jpg|jpeg|png|webp|gif)$/i.test(ext) ? ext : 'jpg';
      const uploadPath = `avatars/${currentUser.uid}/${Date.now()}.${safeExt}`;
      photoURL = await uploadFileToStorage(photoFile, uploadPath);
    }
    await db.collection('users').doc(currentUser.uid).set({ username: name, photoURL }, { merge: true });
    if (auth.currentUser && typeof auth.currentUser.updateProfile === 'function') {
      await auth.currentUser.updateProfile({ displayName: name, photoURL: photoURL || null });
    }
    currentUser.username = name;
    currentUser.photoURL = photoURL;
    sessionStorage.setItem('jsb_user2', JSON.stringify(currentUser));
    if (document.getElementById('accountPhotoFile')) document.getElementById('accountPhotoFile').value = '';
    if (document.getElementById('accountPhotoPreview')) updateAccountPhotoPreview(photoURL || '');
    updateAuth();
    if (msgEl) msgEl.textContent = t('account_profile_saved');
    showToast(t('account_profile_saved'));
  } catch (e) {
    console.warn('saveAccountProfile failed', e);
    if (msgEl) msgEl.textContent = t('account_profile_error');
  }
}

function onAccountPhotoSelected(input) {
  const file = input.files?.[0];
  if (!file) return;
  const allowed = /^(image\/jpeg|image\/png|image\/webp|image\/gif)$/i;
  if (!allowed.test(file.type)) {
    showToast('⚠ Format de photo invalide. Utilisez JPG, PNG, WEBP ou GIF.');
    input.value = '';
    return;
  }
  const previewUrl = URL.createObjectURL(file);
  updateAccountPhotoPreview(previewUrl);
}

function updateAccountPhotoPreview(url) {
  const preview = document.getElementById('accountPhotoPreview');
  if (!preview) return;
  preview.innerHTML = '';
  if (!url) {
    const placeholder = document.createElement('div');
    placeholder.className = 'avatar-placeholder';
    placeholder.innerHTML = '<i class="fas fa-user"></i>';
    preview.appendChild(placeholder);
    return;
  }
  const img = document.createElement('img');
  img.src = url;
  img.alt = 'Photo de profil';
  img.onload = () => URL.revokeObjectURL(url);
  preview.appendChild(img);
}

async function updateAccountPassword() {
  if (!currentUser) return showToast('⚠ Connectez-vous d\'abord.');
  const currentPwd = document.getElementById('accountCurrentPwd')?.value || '';
  const newPwd = document.getElementById('accountNewPwd')?.value || '';
  const msgEl = document.getElementById('accountSettingsMsg');
  if (newPwd.length < 8) {
    if (msgEl) msgEl.textContent = 'Le nouveau mot de passe doit contenir au moins 8 caractères.';
    return;
  }
  try {
    const user = auth.currentUser;
    if (!user) throw new Error('Utilisateur non connecté');
    const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPwd);
    await user.reauthenticateWithCredential(credential);
    await user.updatePassword(newPwd);
    if (msgEl) msgEl.textContent = 'Mot de passe mis à jour.';
    document.getElementById('accountCurrentPwd').value = '';
    document.getElementById('accountNewPwd').value = '';
    showToast('✓ Mot de passe mis à jour.');
  } catch (e) {
    console.warn('updateAccountPassword failed', e);
    if (msgEl) msgEl.textContent = e.code === 'auth/wrong-password' ? 'Mot de passe actuel incorrect.' : 'Impossible de mettre à jour le mot de passe.';
  }
}

function applyPreset(name) {
  const p = studioPresets[name];
  if (!p) return;
  // EQ
  ['eq60','eq250','eq1k','eq4k','eq12k'].forEach(id => {
    const elem = document.getElementById(id);
    if (elem) elem.value = p[id];
  });
  try { updateEQ(); } catch(e) {}
  // Compressor
  const compThreshElem = document.getElementById('compThreshold');
  if (compThreshElem) {
    compThreshElem.value = p.compThreshold;
    const threshVal = document.getElementById('compThreshVal');
    if (threshVal) threshVal.textContent = p.compThreshold + 'dB';
  }
  const compRatioElem = document.getElementById('compRatio');
  if (compRatioElem) {
    compRatioElem.value = p.compRatio;
    const ratioVal = document.getElementById('compRatioVal');
    if (ratioVal) ratioVal.textContent = p.compRatio + ':1';
  }
  const compAttackElem = document.getElementById('compAttack');
  if (compAttackElem) {
    compAttackElem.value = p.compAttack;
    const attackVal = document.getElementById('compAttackVal');
    if (attackVal) attackVal.textContent = p.compAttack + 'ms';
  }
  const compReleaseElem = document.getElementById('compRelease');
  if (compReleaseElem) {
    compReleaseElem.value = p.compRelease;
    const releaseVal = document.getElementById('compReleaseVal');
    if (releaseVal) releaseVal.textContent = p.compRelease + 'ms';
  }
  // Reverb
  const reverbSizeElem = document.getElementById('reverbSize');
  if (reverbSizeElem) {
    reverbSizeElem.value = p.reverbSize;
    const reverbSizeVal = document.getElementById('reverbSizeVal');
    if (reverbSizeVal) reverbSizeVal.textContent = p.reverbSize + '%';
  }
  const reverbWetElem = document.getElementById('reverbWet');
  if (reverbWetElem) {
    reverbWetElem.value = p.reverbWet;
    const reverbWetVal = document.getElementById('reverbWetVal');
    if (reverbWetVal) reverbWetVal.textContent = p.reverbWet + '%';
  }
  const reverbDelayElem = document.getElementById('reverbDelay');
  if (reverbDelayElem) {
    reverbDelayElem.value = p.reverbDelay;
    const reverbDelayVal = document.getElementById('reverbDelayVal');
    if (reverbDelayVal) reverbDelayVal.textContent = p.reverbDelay + 'ms';
  }
  // Pitch
  const pitchShiftElem = document.getElementById('pitchShift');
  if (pitchShiftElem) {
    pitchShiftElem.value = p.pitchShift;
    const pitchVal = document.getElementById('pitchVal');
    if (pitchVal) pitchVal.textContent = (p.pitchShift > 0 ? '+' : '') + p.pitchShift + ' st';
  }
  try { updateCompressor(); } catch(e) {}
  document.querySelectorAll('.studio-preset-btn').forEach(b => b.classList.remove('active'));
  event && event.target && event.target.classList.add('active');
  showToast((currentLang==='en'?'✓ Preset ':'✓ Preset ') + name.toUpperCase() + (currentLang==='en'?' applied!':' appliqué !'));
}

// ─── Export Studio Haute Qualité ───
async function exportStudio() {
  if (!fsRecordings.length) { showToast(currentLang==='en'?'⚠ No recording to export!':'⚠ Aucun enregistrement à exporter !'); return; }
  const format = document.getElementById('exportFormat').value;
  const quality = document.getElementById('exportQuality').value;
  const progressEl = document.getElementById('exportProgress');
  const progressBar = document.getElementById('exportProgressBar');
  const statusTxt = document.getElementById('exportStatusTxt');

  progressEl.style.display = 'block';
  progressBar.style.width = '0%';
  setStudioStatus(currentLang==='en'?'EXPORTING...':'EXPORT...', '#f59e0b');

  const isEn = currentLang === 'en';
  const steps = [
    { txt: isEn?'Initializing audio context...':'Initialisation du contexte audio...', pct: 10 },
    { txt: isEn?'Decoding vocal recording...':'Décodage de l\'enregistrement vocal...', pct: 25 },
    { txt: isEn?'Applying EQ and compressor...':'Application de l\'EQ et du compresseur...', pct: 45 },
    { txt: isEn?'Processing reverb...':'Traitement de la réverbération...', pct: 60 },
    { txt: isEn?'Rendering final mix...':'Rendu du mix final...', pct: 80 },
    { txt: isEn?'Encoding in high quality...':'Encodage en haute qualité...', pct: 95 },
  ];

  try {
    for (const step of steps) {
      statusTxt.textContent = step.txt;
      progressBar.style.width = step.pct + '%';
      await new Promise(r => setTimeout(r, 350));
    }

    if (format === 'voice-only') {
      // Export voix seule (déjà en WebM)
      const a = document.createElement('a');
      a.href = fsRecordings[0].url;
      a.download = `freestyle_${fsRecordings[0].beatTitle || 'mix'}_voix.webm`;
      a.click();
      statusTxt.textContent = currentLang==='en'?'Voice export done!':'Export voix terminé !';
      progressBar.style.width = '100%';
      showToast(currentLang==='en'?'✅ Voice exported successfully!':'✅ Voix exportée avec succès !');
    } else if (format === 'wav-mix' || format === 'webm') {
      // Offline rendering pour exporter le mix traité
      await exportOfflineRender(format, quality);
    }

    setStudioStatus(currentLang==='en'?'EXPORTED ✓':'EXPORT OK ✓', '#4ade80');
    setTimeout(() => { progressEl.style.display = 'none'; setStudioStatus(currentLang==='en'?'READY':'PRÊT', '#4ade80'); }, 3000);

  } catch(e) {
    console.error('Export error:', e);
    showToast((currentLang==='en'?'❌ Export error: ':'❌ Erreur export : ') + e.message);
    setStudioStatus(currentLang==='en'?'ERROR':'ERREUR', '#ef4444');
    progressEl.style.display = 'none';
  }
}

async function exportOfflineRender(format, quality) {
  const statusTxt = document.getElementById('exportStatusTxt');
  const progressBar = document.getElementById('exportProgressBar');

  // Décoder la voix depuis le Blob en mémoire (le plus fiable, zéro CORS)
  const voiceBuf = await new Promise((resolve, reject) => {
    const tmpCtx = new (window.AudioContext || window.webkitAudioContext)();
    const rec = fsRecordings[0];

    const decodeArrayBuf = (arrayBuf) => {
      tmpCtx.decodeAudioData(arrayBuf.slice(0), buf => { tmpCtx.close(); resolve(buf); }, err => reject(new Error(currentLang==='en'?'Voice decode failed':'Décodage voix échoué')));
    };

    if (rec.blob instanceof Blob) {
      // Utiliser le Blob directement (toujours disponible en mémoire)
      const reader = new FileReader();
      reader.onload = e => decodeArrayBuf(e.target.result);
      reader.onerror = () => reject(new Error(currentLang==='en'?'Cannot read Blob for export':'Lecture Blob export impossible'));
      reader.readAsArrayBuffer(rec.blob);
    } else {
      // Fallback XHR
      const xhr = new XMLHttpRequest();
      xhr.open('GET', rec.url, true);
      xhr.responseType = 'arraybuffer';
      xhr.onload = () => decodeArrayBuf(xhr.response);
      xhr.onerror = () => reject(new Error(currentLang==='en'?'Cannot read blob (XHR)':'Lecture blob XHR impossible'));
      xhr.send();
    }
  });

  const sampleRate = 48000;
  const numChannels = 2;
  const duration = voiceBuf.duration + 1.0;

  statusTxt.textContent = currentLang==='en'?'Offline rendering (OfflineAudioContext)...':'Rendu hors-ligne (OfflineAudioContext)...';
  progressBar.style.width = '85%';

  const offlineCtx = new OfflineAudioContext(numChannels, Math.ceil(sampleRate * duration), sampleRate);

  // Voice source
  const voiceSource = offlineCtx.createBufferSource();
  voiceSource.buffer = voiceBuf;
  const pitchSemitones = parseFloat(document.getElementById('pitchShift').value);
  voiceSource.playbackRate.value = Math.pow(2, pitchSemitones / 12);

  // Gain vocal
  const gainVoice = offlineCtx.createGain();
  const vocalVolElem2 = document.getElementById('vocalVolSlider');
  gainVoice.gain.value = Math.max(0.1, Math.min(1, (vocalVolElem2 ? parseFloat(vocalVolElem2.value) : 80) / 100));

  // EQ chain
  const eqDefs = [
    { id:'eq60',  type:'lowshelf',  freq:60   },
    { id:'eq250', type:'peaking',   freq:250  },
    { id:'eq1k',  type:'peaking',   freq:1000 },
    { id:'eq4k',  type:'peaking',   freq:4000 },
    { id:'eq12k', type:'highshelf', freq:12000}
  ];
  let chain = gainVoice;
  for (const eq of eqDefs) {
    const f = offlineCtx.createBiquadFilter();
    f.type = eq.type; f.frequency.value = eq.freq; f.Q.value = 1.4;
    const eqElem = document.getElementById(eq.id);
    f.gain.value = eqElem ? parseFloat(eqElem.value) : 0;  // Default to 0dB if slider missing
    chain.connect(f); chain = f;
  }

  // Compressor
  const comp = offlineCtx.createDynamicsCompressor();
  const compThreshElem = document.getElementById('compThreshold');
  const compRatioElem = document.getElementById('compRatio');
  const compAttackElem = document.getElementById('compAttack');
  const compReleaseElem = document.getElementById('compRelease');
  comp.threshold.value = compThreshElem ? parseFloat(compThreshElem.value) : -50;
  comp.ratio.value = compRatioElem ? parseFloat(compRatioElem.value) : 12;
  comp.attack.value = (compAttackElem ? parseFloat(compAttackElem.value) : 3) / 1000;
  comp.release.value = (compReleaseElem ? parseFloat(compReleaseElem.value) : 250) / 1000;
  comp.knee.value = 10;
  chain.connect(comp);
  comp.connect(offlineCtx.destination);

  voiceSource.connect(gainVoice);
  voiceSource.start(0);

  // Si format mix, tenter de charger le beat via XHR (meilleur effort)
  const beatSourceUrl = resolveBeatAudioSource(fsSelectedBeat);
  if (format === 'wav-mix' && fsSelectedBeat && beatSourceUrl) {
    try {
      const beatBuf = await new Promise((resolve, reject) => {
        const xhr2 = new XMLHttpRequest();
        xhr2.open('GET', beatSourceUrl, true);
        xhr2.responseType = 'arraybuffer';
        xhr2.onload = () => {
          offlineCtx.decodeAudioData(xhr2.response, buf => resolve(buf), err => reject(err));
        };
        xhr2.onerror = () => reject(new Error('Beat CORS'));
        xhr2.send();
      });
      const beatSource = offlineCtx.createBufferSource();
      beatSource.buffer = beatBuf;
      const gainBeat2 = offlineCtx.createGain();
      const beatVolElem2 = document.getElementById('beatVolSlider');
      gainBeat2.gain.value = Math.max(0.1, Math.min(1, (beatVolElem2 ? parseFloat(beatVolElem2.value) : 70) / 100));
      beatSource.connect(gainBeat2);
      gainBeat2.connect(offlineCtx.destination);
      beatSource.start(0);
    } catch(e) {
      console.warn('Beat non inclus dans export (CORS Firebase) :', e.message);
      showToast(currentLang==='en'?'ℹ️ Processed voice exported (beat excluded, CORS blocked)':'ℹ️ Voix traitée exportée (beat non inclus, bloqué par CORS)');
    }
  }

  const renderedBuffer = await offlineCtx.startRendering();

  statusTxt.textContent = currentLang==='en'?'Converting to WAV...':'Conversion en WAV...';
  progressBar.style.width = '95%';

  // Convert to WAV
  const wavBlob = audioBufferToWav(renderedBuffer);
  const url = URL.createObjectURL(wavBlob);
  const beatName = (fsSelectedBeat ? fsSelectedBeat.title : 'mix').replace(/[^a-z0-9]/gi, '_');
  const filename = format === 'wav-mix'
    ? `JeSuisBeatz_${beatName}_full_mix.wav`
    : `JeSuisBeatz_freestyle_traite.wav`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  statusTxt.textContent = currentLang==='en'?'✓ WAV export done!':'✓ Export WAV terminé !';
  progressBar.style.width = '100%';
  showToast(currentLang==='en'?'🎵 High quality export done!':'🎵 Export haute qualité terminé !');
}

// ─── Convertir AudioBuffer en WAV ───
function audioBufferToWav(buffer) {
  const numCh = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numCh * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataLength = buffer.length * blockAlign;
  const wavBuffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(wavBuffer);

  function writeStr(offset, str) { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); }
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeStr(36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }
  return new Blob([wavBuffer], { type: 'audio/wav' });
}

// ─── Re-draw waveform when new recording added ───
const _origRenderRecordingsList = typeof renderRecordingsList === 'function' ? renderRecordingsList : null;
 
// Scroll navbar
window.addEventListener('scroll', () => {
  document.getElementById('mainNav').classList.toggle('scrolled', window.scrollY > 40);
});
 
// Init
buildWave();
renderAll();
updateAuth();
showPage('home');