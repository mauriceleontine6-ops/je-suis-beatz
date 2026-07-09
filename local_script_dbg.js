// Firebase est dÃ©jÃ  initialisÃ© dans index.html

// â•â•â• SÃ‰CURITÃ‰ â€” Rate Limiting pour Connexion â•â•â•
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

// â•â•â• SÃ‰CURITÃ‰ â€” Toggle Password Visibility â•â•â•
function togglePasswordVisibility(fieldId) {
  const field = document.getElementById(fieldId);
  const toggleBtn = document.getElementById(fieldId + 'Toggle');
  if (!field) return;
  
  const isPassword = field.type === 'password';
  field.type = isPassword ? 'text' : 'password';
  
  // Changer l'icÃ´ne
  if (toggleBtn) {
    toggleBtn.className = isPassword ? 'fas fa-eye-slash' : 'fas fa-eye';
  }
}

// Cloud Functions â€” rÃ©gion explicite (2nd gen, us-central1)
function cloudFunctions() {
  if (!window._cloudFns) {
    window._cloudFns = firebase.app().functions('us-central1');
  }
  return window._cloudFns;
}

// Attend que Firebase Auth soit prÃªt (Ã©vite "Connexion requise" si session pas encore restaurÃ©e)
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

// Appel Cloud Function â€” SDK Firebase (auth auto) + repli fetch Bearer
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
  // Utiliser l'URL Run fournie par le dÃ©ploiement (fonctions 2nd gen)
  cloudFunctionURL: 'https://creategeniuspayment-qyfkwosfca-uc.a.run.app',
  // URL de callback pour redirection aprÃ¨s paiement
  successURL: window.location.origin + '/?payment_status=success',
  failureURL: window.location.origin + '/?payment_status=failure'
};

// â•â•â• DEVISES â€” taux mid-market (1 USD = 566,677 XOF â†’ 300 $ = 170 003,10 FCFA)
const CURRENCY_RATES = {
  USD: { symbol: '$', rate: 1, flag: 'ðŸ‡ºðŸ‡¸', label: 'USD', decimals: 0 },
  EUR: { symbol: 'â‚¬', rate: 0.8578, flag: 'ðŸ‡ªðŸ‡º', label: 'EUR', decimals: 2 },
  XOF: { symbol: 'FCFA', rate: 566.677, flag: 'ðŸ‡¨ðŸ‡®', label: 'XOF', decimals: 2 },
  GNF: { symbol: 'GNF', rate: 8640, flag: 'ðŸ‡¬ðŸ‡³', label: 'GNF', decimals: 0 },
  GHS: { symbol: 'â‚µ', rate: 15.5, flag: 'ðŸ‡¬ðŸ‡­', label: 'GHS', decimals: 2 },
  NGN: { symbol: 'â‚¦', rate: 1580, flag: 'ðŸ‡³ðŸ‡¬', label: 'NGN', decimals: 2 }
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
  if (change > 0) return ` <span style="color:#4ade80">â–² ${change.toFixed(3)}</span>`;
  if (change < 0) return ` <span style="color:#f87171">â–¼ ${Math.abs(change).toFixed(3)}</span>`;
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
    cartTotVal.textContent = '$' + total + ' Â· ' + formatUsdAsCurrency(total, 'XOF');
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

// â•â•â• DATA â•â•â•
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
  // Ne pas rÃ©Ã©crire .mpeg â†’ .mp3 dans les URLs Storage (le fichier reste .mpeg)
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
  if (/firebasestorage\.googleapis\.com|storage\.googleapis\.com/i.test(direct)) {
    return `https://audioproxy-qyfkwosfca-uc.a.run.app?u=${encodeURIComponent(direct)}`;
  }
  return direct;
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

// Panier : on garde une copie locale pour l'UX temps rÃ©el, mais on sync avec Firestore
let cart = sanitizeCartItems(JSON.parse(localStorage.getItem('jsb_cart2') || '[]'));
let currentUser = JSON.parse(sessionStorage.getItem('jsb_user2') || 'null');
// âš ï¸ Le mot de passe admin n'est PLUS stockÃ© en localStorage.
// L'admin se connecte uniquement via Firebase Auth + custom claim "admin:true".
// Pour dÃ©finir le claim admin, utilise Firebase Admin SDK cÃ´tÃ© serveur (Cloud Function).
let currentFilter = 'Tous';
// Global audio element used for playback â€” expose it on `window` so other scripts/devtools can access it.
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
 
// â•â•â• FIRESTORE HELPERS â•â•â•

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

// Charger les beats depuis Firestore (catalogue rÃ©el uniquement)
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
 
// VÃ©rifie la session Firebase avant toute action admin
async function ensureAdminAuth() {
  let user;
  try {
    user = await waitForAuthUser();
    await user.getIdToken(true);
  } catch {
    showToast('âš  ' + (currentLang === 'en' ? 'Please log in first' : 'Connectez-vous d\'abord'));
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

  showToast('âš  ' + (currentLang === 'en' ? 'Admin access denied' : 'AccÃ¨s admin refusÃ©'));
  return false;
}

// Sauvegarder un beat (ajout ou mise Ã  jour)
async function saveBeatToFirestore(beatData, docId) {
  if (!(await ensureAdminAuth())) return null;
  const title = normalizeBeatTitle(beatData.title);
  const payload = normalizeBeatRecord({ ...beatData, title });
  delete payload.id;

  const validationError = validateAdminBeatPayload(payload);
  if (validationError) {
    showToast('âš  ' + validationError);
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
    showToast('âš  Erreur de sauvegarde : ' + (cloudErr.message || cloudErr.code || 'permission refusÃ©e'));
  }
  return null;
}

function isCatalogOnlyId(id) {
  return String(id).startsWith('catalog-');
}

// â•â•â• ADMIN â€” TÃ‰LÃ‰VERSEMENT BEATS (Firebase Storage) â•â•â•
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
  // Upload direct Storage (rÃ¨gles admin par email)
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
    setUploadProgress(100, 'âœ“');
    return url;
  } catch (directErr) {
    console.warn('Upload direct indisponible, repli URL signÃ©e:', directErr.message);
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
    setUploadProgress(100, 'âœ“');
    return downloadUrl;
  } catch (signedErr) {
    throw signedErr;
  }
}

function onCoverFileSelected(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (!ADMIN_IMAGE_TYPES.includes(file.type)) {
    showToast('âš  ' + (currentLang === 'en' ? 'Invalid image format' : 'Format image invalide'));
    input.value = '';
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('âš  ' + (currentLang === 'en' ? 'Image max 10 MB' : 'Image max 10 Mo'));
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
    showToast('âš  ' + (currentLang === 'en' ? 'Invalid audio format' : 'Format audio invalide'));
    input.value = '';
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    showToast('âš  ' + (currentLang === 'en' ? 'Audio max 50 MB' : 'Audio max 50 Mo'));
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
    setUploadProgress(5, currentLang === 'en' ? 'Uploading coverâ€¦' : 'Envoi imageâ€¦');
    urls.cover = await uploadFileToStorage(pendingCoverFile, `covers/${slug}.${ext}`);
  }
  if (pendingAudioFile) {
    const ext = pendingAudioFile.name.split('.').pop().toLowerCase();
    setUploadProgress(pendingCoverFile ? 50 : 5, currentLang === 'en' ? 'Uploading audioâ€¦' : 'Envoi audioâ€¦');
    urls.audio = await uploadFileToStorage(pendingAudioFile, `beats/${slug}.${ext}`);
  }
  if (pendingCoverFile || pendingAudioFile) setUploadProgress(100, 'âœ“');
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
    showToast('âš  Suppression impossible : ' + (e.message || e.code || 'permission refusÃ©e'));
    return false;
  }

  showToast('âš  Beat introuvable');
  return false;
}

// â•â•â• PARAMÃˆTRES SITE (Admin) â•â•â•
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
    console.warn('Chargement paramÃ¨tres admin:', e);
  }
}

async function saveAdminSettings() {
  if (!currentUser || currentUser.role !== 'admin') {
    showToast('âš  AccÃ¨s admin requis');
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
    showToast('âœ“ ' + t('admin_saved_toast'));
  } catch (e) {
    console.error('Erreur save settings', e);
    showToast('âš  Erreur de sauvegarde');
  }
}
 
// â•â•â• PROFILS (Firestore) â•â•â•
async function loadProfiles() {
  try {
    const snap = await db.collection('profiles').get();
    return snap.docs.map(d => ({uid: d.id, ...d.data()}));
  } catch(e) { return []; }
}
async function saveProfileToFirestore(uid, data) {
  try { await db.collection('profiles').doc(uid).set(data, {merge:true}); }
  catch(e) { console.error('Erreur save profil', e); showToast('âš  Erreur de sauvegarde du profil'); }
}
async function loadMyProfile(uid) {
  try {
    const doc = await db.collection('profiles').doc(uid).get();
    return doc.exists ? doc.data() : {};
  } catch(e) { return {}; }
}
 
// â•â•â• PUBLICATIONS (Firestore) â•â•â•
async function loadPosts() {
  try {
    const snap = await db.collection('posts').orderBy('createdAt','desc').get();
    return snap.docs.map(d => ({id: d.id, ...d.data()}));
  } catch(e) { return []; }
}
async function addPostToFirestore(post) {
  try {
    await db.collection('posts').add({...post, createdAt: firebase.firestore.FieldValue.serverTimestamp()});
  } catch(e) { console.error('Erreur post Firestore', e); showToast('âš  Erreur de publication'); }
}
async function deletePostFromFirestore(docId) {
  try { await db.collection('posts').doc(String(docId)).delete(); }
  catch(e) { console.error('Erreur delete post', e); }
}
 
// â•â•â• PANIER (Firestore) â•â•â•
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
 
// â•â•â• INIT â•â•â•
window.addEventListener('load', async () => {
  buildWave();
  updateAuth();
  updateCartBadge();
  checkReturnFromCinetPay();
  checkReturnFromGeniusPay();
  window.addEventListener('scroll', () => {
    document.getElementById('mainNav').classList.toggle('scrolled', window.scrollY > 40);
  });
  // Catalogue beats en temps rÃ©el depuis Firestore
  subscribeBeatsFromFirestore();
  // Charger le panier depuis Firestore si connectÃ©
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
 
// â•â•â• BEATS â•â•â•
function saveBeats() { /* RemplacÃ© par Firestore â€” voir saveBeatToFirestore() */ }
 
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
        <span><i class="fas fa-tag" style="color:var(--cyan)"></i> ${b.genre}${b.subgenre?' Â· '+b.subgenre:''}</span>
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
  if (!title || !bpm) { showToast('âš  '+t('err_title_bpm_required')); return; }

  const btn = document.getElementById('addBeatBtn');
  const origBtnHtml = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${currentLang==='en'?'Uploadingâ€¦':'TÃ©lÃ©versementâ€¦'}`; }

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
      ? (currentLang === 'en' ? 'Admin rights missing â€” log out and log back in' : 'Droits admin manquants â€” dÃ©connectez-vous puis reconnectez-vous')
      : (e.message || e.code || '');
    showToast('âš  ' + (currentLang === 'en' ? 'Upload failed' : 'Ã‰chec du tÃ©lÃ©versement') + (detail ? ' : ' + detail : ''));
    if (btn) { btn.disabled = false; btn.innerHTML = origBtnHtml; }
    return;
  }

  if (!audioUrl && !pendingAudioFile) {
    showToast('âš  ' + (currentLang === 'en' ? 'Please upload or provide an audio file' : 'TÃ©lÃ©versez ou indiquez un fichier audio'));
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
    showToast('âš  ' + (currentLang === 'en' ? 'Forbidden beat removed' : 'Beat interdit supprimÃ©'));
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
      showToast('âš  ' + (currentLang === 'en' ? 'Beat saved but not found â€” retry refresh' : 'Beat enregistrÃ© introuvable â€” actualisez la page'));
    }
  } catch (verifyErr) {
    console.warn('Beat verify after save:', verifyErr);
  }
  ['nTitle','nBpm','nSub','nCover','nIcon','nAudio','nDesc','nDescEn','nPb','nPp','nPw','nPu','nPe'].forEach(id => document.getElementById(id) && (document.getElementById(id).value = ''));
  resetBeatUploadForm();
  await loadBeatsFromFirestore();
  if (btn) { btn.disabled = false; btn.innerHTML = origBtnHtml; }
  showToast('âœ“ ' + t('dyn_beat_added').replace('%s', b.title));
  adminPanel('manage');
}

async function repairBeatsFromStorage() {
  if (!(await ensureAdminAuth())) return;
  const btn = document.getElementById('btnRepairStorage');
  const origHtml = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> â€¦'; }
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
      ? `âœ“ ${repaired} beat(s) rÃ©cupÃ©rÃ©(s) depuis Storage`
      : (currentLang === 'en' ? 'âœ“ Catalog already synced with Storage' : 'âœ“ Catalogue dÃ©jÃ  synchronisÃ© avec Storage'));
  } catch (err) {
    console.error('repairBeatsFromStorage:', err);
    showToast('âš  ' + (currentLang === 'en' ? 'Storage sync failed' : 'Synchronisation Storage impossible'));
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
  showToast('âœ“ ' + t('dyn_beat_deleted'));
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
    showToast('âš  ' + t('err_title_bpm_required'));
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
  showToast('âœ“ '+t('admin_beat_edited'));
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
    if (res && res.ok) showToast('âœ“ Traduction automatique terminÃ©e');
    else showToast('âš  Traduction impossible');
  }).catch(e => { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-language"></i> Auto-translate missing'; } showToast('âš  Erreur traduction'); });
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
      <div class="stat-g-card"><div class="stat-g-num" id="adminUserCount">â€¦</div><div class="stat-g-lbl"><i class="fas fa-users"></i> ${t('admin_stat_users')}</div></div>
      ${baseCards}`;
  } else {
    el.innerHTML = baseCards;
  }
}

async function renderAdminUsers(force = false) {
  const tbl = document.getElementById('adminUsersTbl');
  const note = document.getElementById('adminUsersNote');
  if (!tbl) return;
  if (adminUserStatsLoaded && !force) return;
  try {
    const fn = cloudFunctions().httpsCallable('getAdminUserStats');
    const result = await fn();
    const { count, users, partial } = result.data || {};
    const countEl = document.getElementById('adminUserCount');
    if (countEl) countEl.textContent = count ?? 'â€”';
    if (note) {
      note.textContent = currentLang === 'en'
        ? 'Latest registered users are shown here. Total count may be larger.'
        : 'Les derniers utilisateurs inscrits sont affichÃ©s ici. Le nombre total peut Ãªtre plus important.';
    }
    if (!users?.length) {
      tbl.innerHTML = `<tbody><tr><td colspan="3" style="text-align:center;color:gray;padding:20px">${currentLang==='en'?'No users yet':'Aucun utilisateur'}</td></tr></tbody>`;
      adminUserStatsLoaded = true;
      return;
    }
    tbl.innerHTML = `
      <thead><tr><th>Username</th><th>Email</th><th>${currentLang==='en'?'Registered':'Inscrit le'}</th></tr></thead>
      <tbody>${users.map(u => `<tr>
        <td><strong>${sanitize(u.username)}</strong></td>
        <td>${sanitize(u.email)}</td>
        <td>${u.createdAt ? new Date(u.createdAt).toLocaleDateString('fr-FR') : 'â€”'}</td>
      </tr>`).join('')}</tbody>`;
    if (partial && note) {
      note.textContent += currentLang === 'en' ? ' (partial list)' : ' (liste partielle)';
    }
    adminUserStatsLoaded = true;
  } catch (e) {
    const countEl = document.getElementById('adminUserCount');
    if (countEl) countEl.textContent = 'â€”';
    if (note) note.textContent = currentLang === 'en' ? 'Unable to load user list.' : 'Impossible de charger la liste.';
    tbl.innerHTML = '';
    console.warn('getAdminUserStats failed:', e);
  }
}
 
// â•â•â• AUDIO â•â•â•

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
 
// â•â•â• CART â•â•â•
 
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
      descFr: 'MP3 taggÃ© Â· 10 000 streams Â· Non commercial',
      descEn: 'Tagged MP3 Â· 10,000 streams Â· Non-commercial'
    },
    {
      key: 'Premium',
      price: b.pricePremium || 50,
      icon: 'fas fa-star',
      color: '#f9c74f',
      labelFr: 'Premium', labelEn: 'Premium',
      descFr: 'WAV + MP3 Â· 500K streams Â· Commercial Â· Radio',
      descEn: 'WAV + MP3 Â· 500K streams Â· Commercial Â· Radio'
    },
    {
      key: 'WAV + Stems',
      price: b.priceWav || 100,
      icon: 'fas fa-layer-group',
      color: '#D4AF37',
      labelFr: 'WAV + Stems', labelEn: 'WAV + Stems',
      descFr: 'WAV HD + Stems Â· 100K streams Â· Mixage pro',
      descEn: 'HD WAV + Stems Â· 100K streams Â· Pro mixing'
    },
    {
      key: 'UNLIMITED',
      price: b.priceUnlimited || 150,
      icon: 'fas fa-infinity',
      color: '#00d084',
      labelFr: 'UNLIMITED', labelEn: 'UNLIMITED',
      descFr: 'Streams illimitÃ©s Â· Beat en catalogue Â· Usage commercial',
      descEn: 'Unlimited streams Â· Beat stays in catalog Â· Commercial use'
    },
    {
      key: 'Exclusif',
      price: b.priceExclusive || 499,
      icon: 'fas fa-crown',
      color: '#ff6b6b',
      labelFr: 'Exclusif', labelEn: 'Exclusive',
      descFr: 'PropriÃ©tÃ© totale Â· Streams illimitÃ©s Â· RetirÃ© du catalogue',
      descEn: 'Full ownership Â· Unlimited streams Â· Removed from catalog'
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
      <div style="font-family:var(--font-mono);font-size:0.62rem;color:var(--text-dim);margin-bottom:20px">${b.genre}${b.subgenre ? ' Â· ' + b.subgenre : ''} Â· ${b.bpm} BPM</div>
 
      <!-- Currency picker -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;align-items:center">
        <span style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);letter-spacing:2px">${isEn ? 'CURRENCY' : 'DEVISE'} :</span>
        ${Object.entries(CURRENCY_RATES).map(([code, info]) => `
          <button onclick="window.currentLicenseCurrency='${code}';document.querySelectorAll('.cur-btn').forEach(x=>x.classList.remove('active'));this.classList.add('active');document.getElementById('licCardsWrap').innerHTML=renderLicCards('${code}')" class="cur-btn${code==='USD'?' active':''}" data-code="${code}" style="font-family:var(--font-mono);font-size:0.65rem;padding:5px 12px;border-radius:20px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:#fff;cursor:pointer;transition:all 0.2s" onmouseover="this.style.borderColor='var(--cyan)'" onmouseout="if(!this.classList.contains('active'))this.style.borderColor='rgba(255,255,255,0.15)'">${info.symbol} ${code}</button>`).join('')}
      </div>
 
      <div id="licCardsWrap">${renderLicCards(window.currentLicenseCurrency || 'USD')}</div>
 
      <div style="font-family:var(--font-mono);font-size:0.58rem;color:var(--text-dim);text-align:center;margin-top:6px"><i class="fas fa-info-circle" style="color:var(--cyan)"></i> ${isEn ? 'Prices shown in selected currency Â· 1 USD = ' + CURRENCY_RATES[window.currentLicenseCurrency || 'USD'].rate + ' ' + (window.currentLicenseCurrency || 'USD') : 'Prix affichÃ©s en devise sÃ©lectionnÃ©e Â· 1 USD = ' + CURRENCY_RATES[window.currentLicenseCurrency || 'USD'].rate.toLocaleString('fr-FR') + ' ' + (window.currentLicenseCurrency || 'USD')} ${getRateChangeLabel(window.currentLicenseCurrency || 'USD')}</div>
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
  showToast((currentLang === 'en' ? 'âœ“ Added: ' : 'âœ“ AjoutÃ© : ') + b.title + ' Â· ' + licenseKey);
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
        <div class="cart-item-pr">$${c.price} Â· ${c.license} Â· ${formatUsdAsCurrency(c.price, 'XOF')}</div>
      </div>
      <button type="button" class="cart-rm" data-cart-id="${String(c.id).replace(/"/g, '&quot;')}"><i class="fas fa-times"></i></button>
    </div>`).join('');

  const total = cartTotalUsd();
  if (cartTotVal) {
    cartTotVal.textContent = '$' + total + ' Â· ' + formatUsdAsCurrency(total, 'XOF');
  }
}
function checkout() {
  if (!currentUser) { toggleCart(); showToast(t('dyn_pay_login')); setTimeout(()=>showPage('login'),1200); return; }
  if (cart.length === 0) return;
  toggleCart();
  openPaymentModal();
}
 
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â•â•â•  SYSTÃˆME DE PAIEMENT MULTI-MÃ‰THODES â•â•
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 
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
  // RÃ©initialiser les boutons PayPal pour la prochaine ouverture
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
        <i class="fas fa-shopping-bag"></i> ${isEn ? 'Order summary' : 'RÃ©capitulatif'}
      </div>
      ${cart.map(c=>`
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
          <div>
            <div style="font-family:var(--font-display);font-size:0.9rem;color:#fff;letter-spacing:1px">${c.title}</div>
            <div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim)">${c.license} ${isEn?'License':'Licence'} Â· <span style="color:rgba(0,229,255,0.6)">$${c.price} USD</span></div>
          </div>
          <div style="text-align:right">
            <div style="font-family:var(--font-display);font-size:1rem;color:var(--cyan)">${formatUsdAsCurrency(c.price, currency)}</div>
          </div>
        </div>`).join('')}
      <div style="display:flex;justify-content:space-between;align-items:center;padding-top:12px;font-family:var(--font-display);font-size:1.2rem">
        <span style="color:#fff">Total</span>
        <div style="text-align:right">
          <div style="color:var(--cyan)">${formatUsdAsCurrency(total, currency)}</div>
          ${currency !== 'USD' ? `<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim)">â‰ˆ $${total} USD</div>` : `<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim)">â‰ˆ ${formatUsdAsCurrency(total, 'XOF')} (GeniusPay)</div>`}
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
  // â”€â”€ Init PayPal buttons quand on sÃ©lectionne PayPal â”€â”€
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
  document.getElementById('cryptoNetworkLabel').textContent = `${isEn?'Network':'RÃ©seau'} : ${networks[coin]}`;
}
 
function copyCryptoAddr() {
  const addr = cryptoAddresses[selectedCrypto];
  navigator.clipboard.writeText(addr).then(() => {
    showToast(currentLang==='en' ? 'âœ“ Address copied!' : 'âœ“ Adresse copiÃ©e !');
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
 
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â•â•â•  CONFIGURATION PAIEMENTS â€” Ã€ REMPLIR            â•â•â•
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 
// ðŸ”‘ CinetPay â€” rÃ©cupÃ¨re ces valeurs sur dashboard.cinetpay.com
const CINETPAY_APIKEY  = 'VOTRE_APIKEY_CINETPAY';   // ex: "174323661757617531bf99c9.80613927"
const CINETPAY_SITE_ID = 0;                           // ex: 393509  (nombre entier)
const CINETPAY_MODE    = 'TEST';                      // 'TEST' â†’ sandbox | 'PRODUCTION' â†’ vrai argent
 
// ðŸ”‘ Firebase Cloud Functions URL (aprÃ¨s "firebase deploy --only functions")
const CLOUD_FUNCTIONS_BASE_URL = 'https://YOUR_REGION-je-suis-beatz.cloudfunctions.net';
 
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 
async function payCinetPay() {
  const isEn = currentLang === 'en';
  const phoneInput = document.getElementById('cinetPhone');
  const countrySelect = document.getElementById('cinetCountry');
  const fullPhone = (countrySelect?.value || '+225') + (phoneInput?.value?.replace(/\s/g,'') || '');
 
  if (!phoneInput?.value?.trim()) {
    showToast('âš  ' + (isEn ? 'Enter your phone number' : 'Entrez votre numÃ©ro de tÃ©lÃ©phone'));
    return;
  }
  if (cart.length === 0) { showToast('âš  ' + (isEn ? 'Your cart is empty' : 'Panier vide')); return; }
 
  const btn = document.getElementById('cinetPayBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${isEn?'Connecting...':'Connexion Ã  CinetPay...'}`; }
 
  const totalUSD   = cartTotalUsd();
  const amountXOF  = convertUsdToXofPayment(totalUSD);
  const transactionId = 'JSB-' + Date.now() + '-' + Math.floor(Math.random()*9999);
  const description = cart.map(c => `${c.title} (${c.license})`).join(', ');
 
  // Sauvegarder la transaction ET la commande en attente dans Firestore
  // Le webhook serveur passera les deux Ã  'completed'/'SUCCESS'
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

    // Document commande (liÃ© Ã  la transaction pour le webhook)
    const orderRef = db.collection('orders').doc();
    batch.set(orderRef, {
      orderId:       transactionId,
      transactionId,
      userId:        currentUser?.uid || 'guest',
      customerEmail: currentUser?.email || '',
      cartItems:     cart,
      total:         totalUSD,
      status:        'pending', // â† uniquement pending cÃ´tÃ© client
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
      description: `Je Suis Beatz â€” ${description}`,
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
 
    // FAILLE CORRIGÃ‰E : CinetPay.waitResponse ne doit PLUS Ã©crire 'SUCCESS' cÃ´tÃ© client.
    // Le webhook serveur (cinetpayWebhook) met Ã  jour Firestore via Admin SDK.
    // On Ã©coute simplement le rÃ©sultat CinetPay pour informer l'UX,
    // puis on interroge la Cloud Function getOrderStatus pour confirmer.
    CinetPay.waitResponse(async function(payData) {
      if (payData.cpm_result === '00') {
        // âœ… CinetPay dit succÃ¨s â€” on affiche un Ã©cran d'attente
        // La confirmation rÃ©elle viendra du webhook serveur (10-30 secondes)
        showPayPendingConfirmation(transactionId, 'cinetpay');
      } else {
        // âŒ Paiement refusÃ©
        showToast('âŒ ' + (isEn ? 'Payment refused' : 'Paiement refusÃ©') + (payData.cpm_error_message ? ' : ' + payData.cpm_error_message : ''));
        if (btn) { btn.disabled = false; btn.innerHTML = `<i class="fas fa-coins"></i> <span>${isEn?'Pay with CinetPay':'Payer avec CinetPay'}</span>`; }
      }
    });
 
    CinetPay.onError(function(error) {
      showToast('âŒ CinetPay : ' + (error.message || (isEn ? 'Connection error' : 'Erreur de connexion')));
      if (btn) { btn.disabled = false; btn.innerHTML = `<i class="fas fa-coins"></i> <span>${isEn?'Pay with CinetPay':'Payer avec CinetPay'}</span>`; }
    });
 
  } catch(err) {
    showToast('âŒ ' + (err.message || (isEn ? 'Server error' : 'Erreur serveur')));
    if (btn) { btn.disabled = false; btn.innerHTML = `<i class="fas fa-coins"></i> <span>${isEn?'Pay with CinetPay':'Payer avec CinetPay'}</span>`; }
  }
}
 
// VÃ©rifier si l'utilisateur revient d'une redirection CinetPay (iOS/mobile)
// CORRIGÃ‰ : on n'affiche plus "Paiement confirmÃ© !" sans vÃ©rification serveur
function checkReturnFromCinetPay() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('payment') === 'success' && params.get('tid')) {
    const tid = params.get('tid');
    // Message neutre â€” la vraie confirmation vient du webhook serveur par email
    showToast(currentLang === 'en'
      ? 'â³ Payment received, verifying... Check your email.'
      : 'â³ Paiement reÃ§u, vÃ©rification en cours... Consultez vos emails.'
    );
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

// â•â•â• GENIUSPAY RETURN HANDLER â•â•â•
function checkReturnFromGeniusPay() {
  const params = new URLSearchParams(window.location.search);
  const paymentId = params.get('payment_id');
  
  if (paymentId) {
    // RÃ©cupÃ©rer les donnÃ©es de l'order stockÃ©es
    const orderData = sessionStorage.getItem('jsb_order_data');
    sessionStorage.removeItem('jsb_payment_id');
    sessionStorage.removeItem('jsb_order_data');
    
    // Afficher un message de vÃ©rification
    showToast(currentLang === 'en'
      ? 'â³ Payment received, verifying... Check your email.'
      : 'â³ Paiement reÃ§u, vÃ©rification en cours... Consultez vos emails.'
    );
    
    // Nettoyer l'URL
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}
 
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â•â•â•  PAYPAL â€” Paiement international par carte      â•â•â•
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 
let paypalButtonsRendered = false;
 
function initPayPalButtons() {
  if (paypalButtonsRendered) return;
  if (typeof paypal === 'undefined') {
    document.getElementById('paypal-loading').style.display = 'block';
    document.getElementById('paypal-button-container').style.display = 'none';
    showToast('âš  SDK PayPal non chargÃ©. VÃ©rifiez votre Client ID.');
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
 
    // CrÃ©ation de la commande PayPal
    createOrder: function(data, actions) {
      const total = cart.reduce((s,c) => s+c.price, 0);
      const description = cart.map(c => `${c.title} (${c.license})`).join(', ');
      return actions.order.create({
        purchase_units: [{
          description: `Je Suis Beatz â€” ${description}`,
          amount: {
            currency_code: 'USD',
            value: total.toFixed(2),
            breakdown: {
              item_total: { currency_code: 'USD', value: total.toFixed(2) }
            }
          },
          items: cart.map(c => ({
            name: `${c.title} â€” Licence ${c.license}`,
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
 
    // Paiement approuvÃ© par l'utilisateur
    onApprove: async function(data, actions) {
      showToast('â³ ' + t('pay_validating'));
      try {
        const details = await actions.order.capture();
        const paypalOrderId = details.id;
        const orderId = 'JSB-PP-' + paypalOrderId;

        // FAILLE CORRIGÃ‰E : statut 'pending' uniquement cÃ´tÃ© client.
        // Le webhook PayPal serveur (Cloud Function) passera Ã  'completed'
        // aprÃ¨s vÃ©rification de la signature PayPal.
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

        // Afficher l'Ã©cran d'attente â€” pas de succÃ¨s immÃ©diat
        showPayPendingConfirmation(orderId, 'paypal');
        paypalButtonsRendered = false;
      } catch(err) {
        showToast('âŒ ' + t('pay_validation_error') + ': ' + err.message);
      }
    },
 
    // Paiement annulÃ©
    onCancel: function() {
      showToast(t('pay_cancelled'));
    },
 
    // Erreur PayPal
    onError: function(err) {
      console.error('PayPal error:', err);
      showToast('âŒ PayPal : ' + t('pay_error'));
    }
  }).render('#paypal-button-container');
}
 
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â•â•â•  simulatePay â€” CORRIGÃ‰ : mÃ©thodes non implÃ©mentÃ©es
// â•â•â•  Les mÃ©thodes ci-dessous affichent un message clair
// â•â•â•  au lieu de simuler un faux paiement rÃ©ussi.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function simulatePay(method) {
  if (method === 'geniuspay') {
    // IntÃ©gration GeniusPay rÃ©elle
    processGeniusPayment();
    return;
  }

  const isEn = currentLang === 'en';

  // FAILLE CORRIGÃ‰E : Ces mÃ©thodes ne sont pas encore intÃ©grÃ©es.
  // On informe l'utilisateur de contacter directement le vendeur.
  // Aucune commande n'est crÃ©Ã©e, aucun paiement n'est simulÃ©.
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

  // Afficher un modal d'information (pas de succÃ¨s !)
  const isEn2 = currentLang === 'en';
  const btn = document.querySelector('.pay-submit-btn');
  if (btn) { btn.disabled = false; }

  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
    <div style="background:#0f0f1a;border:1px solid rgba(255,165,0,0.4);border-radius:20px;padding:32px;max-width:440px;width:100%;text-align:center">
      <div style="font-size:2.5rem;margin-bottom:16px">âš™ï¸</div>
      <div style="font-family:var(--font-display);font-size:1.3rem;color:#f59e0b;letter-spacing:2px;margin-bottom:12px">
        ${isEn2 ? 'Integration in progress' : 'IntÃ©gration en cours'}
      </div>
      <p style="color:rgba(255,255,255,0.7);font-size:0.9rem;line-height:1.6;margin-bottom:20px">
        ${isEn2
          ? `<strong>${label}</strong> is not yet integrated. Please contact us directly to finalize your purchase.`
          : `<strong>${label}</strong> n'est pas encore intÃ©grÃ©. Contactez-nous directement pour finaliser votre achat.`
        }
      </p>
      <a href="mailto:jesuisthebeatmaker@gmail.com?subject=Achat%20beat%20-%20${encodeURIComponent(label)}&body=Bonjour%2C%20je%20souhaite%20acheter%20%3A%20${encodeURIComponent(cart.map(c=>c.title+' ('+c.license+')').join(', '))}"
         style="display:inline-block;background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:0.9rem;margin-bottom:12px">
        <i class="fas fa-envelope"></i> ${isEn2 ? 'Contact by email' : 'Contacter par email'}
      </a>
      <br>
      <button onclick="this.closest('div[style*=\"fixed\"]').remove()"
        style="background:none;border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.6);padding:8px 20px;border-radius:8px;cursor:pointer;margin-top:8px;font-size:0.85rem">
        ${isEn2 ? 'Choose another method' : 'Choisir une autre mÃ©thode'}
      </button>
    </div>`;
  document.body.appendChild(modal);
}

// â•â•â• GENIUSPAY PAYMENT INTEGRATION â•â•â•
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
      showToast('âš  ' + (isEn ? 'Minimum amount is 200 FCFA' : 'Montant minimum : 200 FCFA'));
      return;
    }

    // Afficher un loading
    showToast('â³ ' + (isEn ? 'Processing payment...' : 'Traitement du paiement...'));

    const licenseSummary = cart.map(c => `${c.title} (${c.license} Â· $${c.price})`).join(', ');

    // PrÃ©parer les donnÃ©es de commande â€” GeniusPay attend le montant en XOF entier (pas en centimes)
    const orderData = {
      amount: amountXOF,
      currency: 'XOF',
      customer_phone: '+225' + (currentUser.phone || '0707000000'),
      customer_name: currentUser.username || 'Customer',
      customer_email: currentUser.email,
      description: `Je Suis Beatz â€” ${licenseSummary}`,
      items: cart.map(c => ({
        name: `${c.title} â€” ${c.license}`,
        quantity: 1,
        unit_price: convertUsdToXofPayment(c.price),
        description: `${c.license} License Â· $${c.price} USD`
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

    // Appel serveur (Cloud Function) pour crÃ©er le paiement en toute sÃ©curitÃ©
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
    showToast('âŒ ' + (currentLang === 'en' ? 'Payment failed' : 'Le paiement a Ã©chouÃ©'));
    closePaymentModal();
  }
}

// FAILLE CORRIGÃ‰E : showPaySuccess remplacÃ©e par showPayPendingConfirmation.
// On n'affiche plus un faux "Paiement rÃ©ussi !" immÃ©diat cÃ´tÃ© client.
// On affiche un Ã©cran d'attente pendant que le webhook serveur confirme.
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
    isEn ? 'â³ Verifying payment...' : 'â³ VÃ©rification en cours...';
  document.getElementById('paySuccessMsg').textContent =
    isEn
      ? 'Your payment has been received. We are verifying it with the payment provider. You will receive a download link by email at ' + (currentUser?.email || 'your address') + ' once confirmed (usually under 2 minutes).'
      : 'Votre paiement a Ã©tÃ© reÃ§u. Nous le vÃ©rifions auprÃ¨s du prestataire. Vous recevrez le lien de tÃ©lÃ©chargement par email Ã  ' + (currentUser?.email || 'votre adresse') + ' aprÃ¨s confirmation (gÃ©nÃ©ralement en moins de 2 minutes).';

  document.getElementById('paySuccessOrder').innerHTML = `
    <div style="background:rgba(0,229,255,0.05);border:1px solid rgba(0,229,255,0.2);border-radius:12px;padding:16px;margin-top:16px;font-family:var(--font-mono);font-size:0.68rem">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <span style="color:var(--text-dim)">${isEn?'Order ID':'NÂ° commande'}</span>
        <span style="color:var(--cyan)">${orderId}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <span style="color:var(--text-dim)">${isEn?'Amount':'Montant'}</span>
        <span style="color:#fff">$${total}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <span style="color:var(--text-dim)">${isEn?'Method':'MÃ©thode'}</span>
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
        ? 'Payment verified server-side â€” your beat will only be delivered after real confirmation.'
        : 'Paiement vÃ©rifiÃ© cÃ´tÃ© serveur â€” votre beat ne sera livrÃ© qu\'aprÃ¨s confirmation rÃ©elle.'}
    </div>`;

  document.getElementById('paySuccessBtn').textContent =
    isEn ? 'Keep listening' : 'Continuer l\'Ã©coute';

  // Vider le panier uniquement aprÃ¨s que la commande est enregistrÃ©e
  cart = [];
  if (currentUser?.uid) {
    await db.collection('carts').doc(currentUser.uid)
      .set({items:[], updatedAt: firebase.firestore.FieldValue.serverTimestamp()})
      .catch(()=>{});
  }
  localStorage.setItem('jsb_cart2', '[]');
  updateCartBadge();

  // Polling lÃ©ger : vÃ©rifier le statut toutes les 5s pendant 3 minutes max
  // via la Cloud Function getOrderStatus (lecture sÃ©curisÃ©e)
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
          if (badge) badge.innerHTML = `<span style="color:#4ade80">âœ… ${isEn?'Confirmed! Check your email.':'ConfirmÃ© ! VÃ©rifiez vos emails.'}</span>`;
          const titleEl = document.getElementById('paySuccessTitle');
          if (titleEl) titleEl.textContent = isEn ? 'âœ… Payment confirmed!' : 'âœ… Paiement confirmÃ© !';
          showToast(isEn ? 'ðŸŽµ Your beat is on its way!' : 'ðŸŽµ Votre beat arrive dans votre boÃ®te mail !');
        }

        if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
          const badge = document.getElementById('orderStatusBadge');
          if (badge) badge.innerHTML = `<span style="color:#f59e0b">â³ ${isEn?'Check your email in a few minutes.':'VÃ©rifiez vos emails dans quelques minutes.'}</span>`;
        }
      } catch(e) {
        // Silencieux â€” le webhook serveur reste la source de vÃ©ritÃ©
      }
    }, 5000);
  }
}

// ConservÃ© pour rÃ©trocompatibilitÃ© interne (appelÃ© nulle part en production)
async function showPaySuccess(method, transactionId) {
  return showPayPendingConfirmation(transactionId || ('JSB-'+Date.now()), method);
}


 
function applyPayTranslations() {
  const isEn = currentLang === 'en';
  const setTxt = (id, fr, en) => { const el=document.getElementById(id); if(el) el.textContent = isEn?en:fr; };
  const setHtml = (id, fr, en) => { const el=document.getElementById(id); if(el) el.innerHTML = isEn?en:fr; };
  setTxt('payModalTitle', 'Choisir un moyen de paiement', 'Choose a payment method');
  setTxt('payLblIntl', 'Paiement', 'Payment');
  setTxt('payLblAfrica', 'Mobile Money â€” Afrique', 'Mobile Money â€” Africa');
  setTxt('paySecureLabel', 'Paiement 100% sÃ©curisÃ© Â· Livraison digitale immÃ©diate', '100% secure payment Â· Instant digital delivery');
  setTxt('payBackLabel', 'Retour', 'Back');
  setTxt('paypalLoadingTxt', 'Chargement PayPal...', 'Loading PayPal...');
  // Card
  setTxt('payCardTitle', 'Carte Bancaire', 'Credit Card');
  setTxt('lblCardName', 'Nom sur la carte', 'Name on card');
  setTxt('lblCardNum', 'NumÃ©ro de carte', 'Card number');
  setTxt('lblCardExp', 'Expiration', 'Expiry');
  setTxt('payNoteCard', 'En cliquant, vous acceptez les conditions de vente. Transaction sÃ©curisÃ©e via SSL.', 'By clicking, you accept the terms of sale. SSL secured transaction.');
  // PayPal
  setTxt('payPaypalMsg', 'Vous allez Ãªtre redirigÃ© vers PayPal pour finaliser votre paiement en toute sÃ©curitÃ©.', 'You will be redirected to PayPal to complete your payment securely.');
  setTxt('lblPaypalEmail', 'Email PayPal', 'PayPal email');
  setTxt('payPaypalBtn', 'Continuer avec PayPal', 'Continue with PayPal');
  // Stripe
  setTxt('lblStripeCard', 'NumÃ©ro de carte', 'Card number');
  setTxt('lblStripeExp', 'Expiration', 'Expiry');
  setTxt('payOrLabel', 'ou payer par carte', 'or pay by card');
  setTxt('payStripeBtnLabel', 'Payer avec Stripe', 'Pay with Stripe');
  // Wave
  setTxt('payWaveMsg', 'Entrez votre numÃ©ro Wave pour recevoir une demande de paiement sur votre application.', 'Enter your Wave number to receive a payment request on your app.');
  setTxt('lblWavePhone', 'NumÃ©ro de tÃ©lÃ©phone Wave', 'Wave phone number');
  setTxt('payWaveBtn', 'Payer avec Wave', 'Pay with Wave');
  // Orange
  setTxt('payOrangeMsg', 'Entrez votre numÃ©ro Orange Money pour recevoir une demande de paiement.', 'Enter your Orange Money number to receive a payment request.');
  setTxt('lblOrangePhone', 'NumÃ©ro Orange Money', 'Orange Money number');
  setTxt('lblOrangePin', 'Code PIN Orange Money', 'Orange Money PIN');
  setTxt('payOrangeBtn', 'Payer avec Orange Money', 'Pay with Orange Money');
  // MTN
  setTxt('payMtnMsg', 'Entrez votre numÃ©ro MTN MoMo pour recevoir une demande de paiement.', 'Enter your MTN MoMo number to receive a payment request.');
  setTxt('lblMtnPhone', 'NumÃ©ro MTN MoMo', 'MTN MoMo number');
  setTxt('payMtnBtn', 'Payer avec MTN MoMo', 'Pay with MTN MoMo');
  // Moov
  setTxt('payMoovMsg', 'Entrez votre numÃ©ro Moov pour recevoir une demande de paiement.', 'Enter your Moov number to receive a payment request.');
  setTxt('lblMoovPhone', 'NumÃ©ro Moov Money', 'Moov Money number');
  setTxt('payMoovBtn', 'Payer avec Moov Money', 'Pay with Moov Money');
  // CinetPay
  setTxt('payCinetMsg', 'CinetPay regroupe tous les moyens de paiement mobile africains en un seul endroit.', 'CinetPay aggregates all African mobile payment methods in one place.');
  setTxt('lblCinetPhone', 'NumÃ©ro de tÃ©lÃ©phone', 'Phone number');
  setTxt('payCinetBtn', 'Payer avec CinetPay', 'Pay with CinetPay');
  setTxt('payGeniusMsg', 'Payez avec GeniusPay pour un paiement rapide et sÃ©curisÃ©.', 'Pay with GeniusPay for the fastest and most secure checkout.');
  setTxt('payGeniusBtnLabel', 'Payer avec GeniusPay', 'Pay with GeniusPay');
  setTxt('payGeniusNote', 'Si GeniusPay est indisponible, contactez le support.', 'If GeniusPay is unavailable, contact support.');
  // Crypto
  setTxt('payCryptoMsg', "Choisissez votre cryptomonnaie et envoyez le montant exact Ã  l'adresse indiquÃ©e.", 'Choose your cryptocurrency and send the exact amount to the address shown.');
  setTxt('lblCopyCrypto', "Copier l'adresse", 'Copy address');
  setTxt('cryptoAmountLabel', 'Montant Ã  envoyer :', 'Amount to send:');
  setTxt('payCryptoBtn', "J'ai effectuÃ© le virement", 'I have sent the payment');
  setTxt('payNoteCrypto', 'Le paiement crypto est vÃ©rifiÃ© manuellement. Vous recevrez votre beat sous 1h aprÃ¨s confirmation.', 'Crypto payments are manually verified. You will receive your beat within 1h of confirmation.');
  // Update card pay button amount
  const total = cart.reduce ? cart.reduce((s,c)=>s+c.price,0) : 0;
  const payCardBtnLabel = document.getElementById('payCardBtnLabel');
  if (payCardBtnLabel) payCardBtnLabel.textContent = isEn ? 'Pay' : 'Payer';
}
 
document.getElementById('paymentModal').addEventListener('click', e=>{if(e.target===e.currentTarget)closePaymentModal();});
 
// â•â•â• AUTH â•â•â•
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

// Active le rÃ´le admin cÃ´tÃ© serveur
async function activateAdminRole(firebaseUser) {
  if (!firebaseUser) return false;

  // VÃ©rifier document admins (lecture autorisÃ©e pour son propre uid)
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

// Synchronise le rÃ´le admin via Cloud Function (source de vÃ©ritÃ© serveur)
async function syncAdminRole(firebaseUser) {
  return activateAdminRole(firebaseUser);
}

// Sanitisation XSS â€” Ã©chappe les caractÃ¨res dangereux
function sanitize(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(String(str||'')));
  return div.innerHTML;
}
function sanitizeIconClass(icon) {
  const val = String(icon || '').trim();
  return /^(fa[srb]?\s+fa-[a-z0-9-]+)(\s+fa-[a-z0-9-]+)*$/i.test(val) ? val : '';
}
// Validation email simple
function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
// Validation username (alphanumÃ©rique + tirets, 3-20 chars)
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

    // FAILLE CORRIGÃ‰E : plus de lecture directe de /users par username.
    // On passe par la Cloud Function qui ne retourne que l'email
    // et ne permet pas d'Ã©numÃ©rer les utilisateurs.
    if (!isValidEmail(u)) {
      try {
        const getUserEmail = cloudFunctions().httpsCallable('getUserEmailByUsername');
        const result = await getUserEmail({ username: u });
        email = result.data.email;
      } catch(fnErr) {
        // DÃ©lai intentionnel pour Ã©viter le timing attack (brute force)
        recordLoginAttempt(u);
        await new Promise(r => setTimeout(r, 600));
        err.textContent = t('err_wrong_creds');
        err.style.display = 'block';
        return;
      }
    }

    const cred = await auth.signInWithEmailAndPassword(email, p);
    const uid = cred.user.uid;

    // âœ… SÃ‰CURITÃ‰ : VÃ©rifier que l'email est confirmÃ©
    if (!cred.user.emailVerified) {
      let verificationResent = true;
      let verificationError = null;
      try {
        await cred.user.sendEmailVerification(getVerificationActionSettings());
        console.log('Email de vÃ©rification renvoyÃ© Ã :', cred.user.email);
      } catch (e) {
        verificationResent = false;
        verificationError = e;
        console.warn('Erreur lors de l\'envoi de l\'email de vÃ©rification:', e);
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

    // Effacer les tentatives de connexion rÃ©ussies
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

    // Ne pas masquer immÃ©diatement la carte de connexion.
    // L'utilisateur voit clairement le succÃ¨s avant d'aller sur home.
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
      console.warn('Erreur lors de l\'envoi du mail de vÃ©rification:', e);
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
    // FAILLE CORRIGÃ‰E : vÃ©rification username via Cloud Function (pas de lecture directe /users)
    // Si la CF trouve l'email â†’ username pris. Si elle lÃ¨ve une erreur 'not-found' â†’ libre.
    try {
      const checkFn = cloudFunctions().httpsCallable('getUserEmailByUsername');
      await checkFn({ username: u.toLowerCase() });
      // Si on arrive ici â†’ username dÃ©jÃ  pris
      err.textContent = t('err_username_taken');
      err.style.display = 'block';
      return;
    } catch(fnErr) {
      if (fnErr.code !== 'functions/not-found') {
        // Erreur inattendue â€” on laisse continuer (meilleure expÃ©rience, Firebase Auth bloquera si besoin)
        console.warn('Username check warning:', fnErr.code);
      }
      // code === 'not-found' â†’ username disponible, on continue
    }

    // CrÃ©er le compte Firebase Auth
    const cred = await auth.createUserWithEmailAndPassword(e, p);
    const uid  = cred.user.uid;

    const userData = {
      username:  sanitize(u),
      email:     sanitize(e),
      role:      'user',
      uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      emailVerified: false  // âœ… Tracer l'Ã©tat de vÃ©rification
    };
    await db.collection('users').doc(uid).set(userData);

    // âœ… SÃ‰CURITÃ‰ : Envoyer automatiquement l'email de vÃ©rification
    let verificationSent = true;
    let verificationError = null;
    try {
      await cred.user.sendEmailVerification(getVerificationActionSettings());
    } catch (emailErr) {
      verificationSent = false;
      verificationError = emailErr;
      console.warn('Erreur lors de l\'envoi de l\'email de vÃ©rification:', emailErr);
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

    showToast('ðŸ“§ VÃ©rifiez votre email pour continuer!');
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
  if (currentUser) document.getElementById('logoutName').textContent = sanitize(currentUser.username);
  renderStats();
  if (document.getElementById('page-beats')?.classList.contains('active') || document.getElementById('page-admin')?.classList.contains('active')) {
    renderAll();
  }
}

// âœ… SÃ‰CURITÃ‰ : Ã€ l'init, on revalide le token Firebase si l'user est dÃ©jÃ  connectÃ©
auth.onAuthStateChanged(async (firebaseUser) => {
  if (firebaseUser) {
    try {
      const isAdmin = await syncAdminRole(firebaseUser);
      let stored = JSON.parse(sessionStorage.getItem('jsb_user2') || 'null');
      if (!stored || stored.uid !== firebaseUser.uid) {
        const doc = await db.collection('users').doc(firebaseUser.uid).get();
        const userData = doc.exists ? doc.data() : {};
        stored = {
          username: sanitize(userData.username || firebaseUser.email),
          email: firebaseUser.email,
          role: (isAdmin || isOwnerEmail(firebaseUser.email)) ? 'admin' : 'user',
          uid: firebaseUser.uid,
        };
      } else {
        stored.role = (isAdmin || isOwnerEmail(firebaseUser.email)) ? 'admin' : 'user';
        stored.email = firebaseUser.email || stored.email;
      }
      currentUser = stored;
      sessionStorage.setItem('jsb_user2', JSON.stringify(currentUser));
      cart = await loadCartFromFirestore(firebaseUser.uid);
      updateCartBadge();
      updateAuth();
    } catch (e) { console.warn('Token refresh failed:', e); }
  } else {
    // Firebase dit que personne n'est connectÃ© : nettoyer
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
  if (n.length < 6) { showToast('âš  ' + t('err_pwd_too_short')); return; }
  // âœ… SÃ‰CURITÃ‰ : Changement de mot de passe via Firebase Auth â€” jamais en localStorage
  try {
    const user = auth.currentUser;
    if (!user) { showToast('âš  Non connectÃ©'); return; }
    // Re-authentification requise avant changement de mot de passe
    const cred = firebase.auth.EmailAuthProvider.credential(user.email, o);
    await user.reauthenticateWithCredential(cred);
    await user.updatePassword(n);
    document.getElementById('oldPwd').value = '';
    document.getElementById('newPwd').value = '';
    showToast('âœ“ ' + t('admin_pwd_changed'));
  } catch(e) {
    if (e.code === 'auth/wrong-password') showToast('âš  ' + t('err_wrong_pwd'));
    else showToast('âš  ' + (e.message || 'Erreur'));
  }
}
 
// â•â•â• NAVIGATION â•â•â•
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
      showToast('â›” AccÃ¨s refusÃ©');
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
    showToast('â›” AccÃ¨s refusÃ©');
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
  // Ferme le menu uniquement sur mobile (largeur â‰¤ 768px)
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
 
// â•â•â• TOAST â•â•â•
function showToast(msg) {
  document.querySelectorAll('.toast').forEach(t=>t.remove());
  const t=document.createElement('div');
  t.className='toast'; t.innerHTML=msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),3100);
}

function showWarningToast(messageKey, fallback) {
  const msg = (typeof t === 'function' ? t(messageKey) : null) || fallback || '';
  showToast(msg.startsWith('âš ') ? msg : `âš  ${msg}`);
}
 
 
// â•â•â• FREESTYLE â•â•â•
let fsAudio = new Audio();
fsAudio.setAttribute('playsinline', '');
fsAudio.setAttribute('webkit-playsinline', '');
window.fsAudio = fsAudio;
fsAudio.preload = 'auto';
let fsPlaybackAttempt = false;

function clearFsAudioCrossOrigin() {
  fsAudio.removeAttribute('crossorigin');
  fsAudio.crossOrigin = null;
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
    console.log('âœ… Audio metadata loaded:', audioEl.duration, 'seconds');
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
let fsRecordings = JSON.parse(localStorage.getItem('jsb_recordings') || '[]');
let fsSelectedBeat = null;
window.fsSelectedBeat = fsSelectedBeat;
window.pendingStudioBeat = null;
let fsRecording = false;
let fsTimerInterval = null;
let fsSeconds = 0;
let micStream = null;
let analyserNode = null;
let micAnimFrame = null;
 
async function ensureFsAudioGraph() {
  // Lecture simple via <audio> â€” pas de graphe Web Audio requis pour le freestyle.
  // (createMediaElementSource + crossOrigin provoquait des Ã©checs CORS sur Storage.)
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
      <span class="fs-beat-meta">${b.bpm} BPM Â· ${b.genre}</span>
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
  // Si c'est une URL Firebase Storage, utiliser le proxy pour Ã©viter les erreurs CORS
  if (proxyBeatUrl && /firebasestorage\.googleapis\.com|storage\.googleapis\.com/i.test(directBeatUrl)) {
    console.log('Using audio proxy for freestyle beat (CORS-sensitive source):', proxyBeatUrl);
    beatUrl = proxyBeatUrl;
  }
  if (!beatUrl) {
    showWarningToast('dyn_no_beat_audio', 'Impossible de charger le beat');
    return;
  }
  console.log('selectFsBeat URL:', beatUrl, 'audioSource:', audioSource, 'beatId:', fsSelectedBeat?.id);
  clearFsAudioCrossOrigin();
  fsAudio.src = beatUrl;
  fsAudio.loop = true;
  fsAudio.preload = 'auto';
  fsAudio.muted = false;
  fsAudio.volume = fsBeatVolume > 0.05 ? fsBeatVolume : 1.0;
  try {
    fsAudio.load();
  } catch(e) {
    console.warn('Audio load:', e);
  }
  const nameEl = document.getElementById('fsBeatName');
  const metaEl = document.getElementById('fsBeatMeta');
  const coverEl = document.getElementById('fsBeatCover');
  const durationEl = document.getElementById('fsBeatDuration');
  const playBtn = document.getElementById('fsBeatPlayBtn');
  if (nameEl) nameEl.textContent = fsSelectedBeat.title;
  if (metaEl) metaEl.textContent = fsSelectedBeat.bpm + ' BPM Â· ' + fsSelectedBeat.genre;
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
    console.log('Studio pas encore prÃªt, beat en attente:', beat.title || beat.name);
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
    try {
      await studioInstance.loadBeatFromURL(directUrl, beatInfo);
      console.log('âœ… Studio loaded beat from freestyle selector:', beatInfo.name, directUrl);
    } catch (directErr) {
      console.warn('Studio direct load failed, trying proxy:', directErr);
      if (proxyUrl && proxyUrl !== directUrl) {
        await studioInstance.loadBeatFromURL(proxyUrl, beatInfo);
        console.log('âœ… Studio loaded beat via proxy:', beatInfo.name, proxyUrl);
      } else {
        throw directErr;
      }
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
  clearFsAudioCrossOrigin();
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
    if (proxyUrl && proxyUrl !== directUrl) {
      await tryPlay(proxyUrl);
    } else {
      throw err;
    }
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
  }
  if (typeof fsAudio.volume === 'number') {
    fsAudio.volume = preservedFsAudioVolume;
    fsBeatVolume = preservedFsAudioVolume;
  }
  try {
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    if (ctx.state === 'suspended') await ctx.resume();
    const src = ctx.createMediaStreamSource(micStream);
    analyserNode = ctx.createAnalyser(); analyserNode.fftSize = 256;
    src.connect(analyserNode);
    animMicLevel();
  } catch(e) {}
  fsChunks = [];
  const selectedMimeType = getSupportedRecorderMimeType() || (isIOS() ? 'audio/mp4' : 'audio/webm');
  try {
    fsMediaRecorder = selectedMimeType
      ? new MediaRecorder(micStream, { mimeType: selectedMimeType, audioBitsPerSecond: 192000 })
      : new MediaRecorder(micStream);
  } catch (e) {
    try {
      fsMediaRecorder = new MediaRecorder(micStream);
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
      beatTitle: fsSelectedBeat ? fsSelectedBeat.title : 'â€”',
      beatId: fsSelectedBeat ? fsSelectedBeat.id : null,
      url,
      blob,
      mimeType: mimeUsed,
      duration: fsSeconds,
      date: new Date().toLocaleDateString('fr'),
      label: 'Take ' + (fsRecordings.length + 1)
    };
    fsRecordings.unshift(rec);
    renderRecordingsList();
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
    <div style="display:flex;align-items:center;gap:12px;padding:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(0,229,255,0.1);border-radius:12px">
      <button onclick="playRecording('${r.url}')" style="width:36px;height:36px;border-radius:50%;background:rgba(0,229,255,0.1);border:1px solid var(--cyan);color:var(--cyan);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:0.8rem">
        <i class="fas fa-play" style="margin-left:2px"></i>
      </button>
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--font-mono);font-size:0.7rem;color:#fff">${r.label}</div>
        <div style="font-family:var(--font-mono);font-size:0.58rem;color:var(--text-dim)">${r.beatTitle} Â· ${r.date} Â· ${fmt(r.duration)}</div>
      </div>
      <a href="${r.url}" download="freestyle.webm" style="color:var(--cyan);font-size:0.85rem;text-decoration:none" title="${t('fs_download_voice')}"><i class="fas fa-download"></i></a>
      <button onclick="deleteRecording(${i})" style="background:none;border:none;color:rgba(255,100,100,0.5);cursor:pointer;font-size:0.85rem"><i class="fas fa-trash"></i></button>
    </div>`).join('');
  // Refresh studio waveform if studio is open
  if (document.getElementById('studioPanel') && document.getElementById('studioPanel').style.display !== 'none') {
    setTimeout(drawStudioWaveform, 200);
  }
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
 
function playRecording(url) { const a=new Audio(url); a.play(); }
function deleteRecording(i) {
  fsRecordings.splice(i,1); renderRecordingsList();
  if (!fsRecordings.length) document.getElementById('mixSection').style.display='none';
}
function downloadLastRecording() {
  if (!fsRecordings.length) { showToast(t('dyn_no_recording')); return; }
  const a=document.createElement('a'); a.href=fsRecordings[0].url; a.download='freestyle.webm'; a.click();
}
async function playMix() {
  if (!fsRecordings.length || !fsSelectedBeat) { showToast(t('dyn_no_freestyle')); return; }
  const voiceEl = new Audio(fsRecordings[0].url);
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

  fsAudio.currentTime = 0;
  fsAudio.loop = false;
  fsAudio.muted = false;
  fsAudio.volume = fsBeatVolume > 0.05 ? fsBeatVolume : 1.0;

  const playBtn = document.getElementById('mixPlayBtn');
  if (playBtn) playBtn.disabled = true;

  try {
    await waitForAudioReady(fsAudio, 2500);
    await waitForAudioReady(voiceEl, 2500);

    const beatPromise = fsAudio.play().catch(err => {
      console.warn('Beat playback failed:', err);
      return null;
    });
    const voicePromise = voiceEl.play().catch(err => {
      console.warn('Voice playback failed:', err);
      return null;
    });

    await Promise.all([beatPromise, voicePromise]);

    if (playBtn) {
      playBtn.disabled = false;
      playBtn.innerHTML = `<i class='fas fa-pause'></i> ${t('fs_playing')}`;
    }
  } catch (err) {
    console.warn('playMix error:', err);
    if (playBtn) playBtn.disabled = false;
  }

  voiceEl.onended = () => {
    try { fsAudio.pause(); } catch (e) {}
    if (playBtn) playBtn.innerHTML = `<i class='fas fa-play'></i> ${t('fs_listen_mix')}`;
  };
}
async function postFreestyleToProfile() {
  if (!currentUser) { showToast(t('dyn_login_first')); showPage('login'); return; }
  if (!fsRecordings.length) { showToast(t('dyn_no_sound_pub')); return; }
  const post = { type:'freestyle', username:currentUser.username, beatTitle:fsRecordings[0].beatTitle, date:new Date().toLocaleDateString('fr'), url:fsRecordings[0].url, likes:0, comments:[] };
  await addPostToFirestore(post);
  showToast(t('dyn_freestyle_published'));
  showPage('community');
}
 
// â•â•â• COMMUNITY â•â•â•
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
  // âœ… SÃ‰CURITÃ‰ : Toutes les donnÃ©es Firestore sont sanitisÃ©es avant injection dans innerHTML
  const safeUsername = sanitize(p.username || '');
  const safeGenre    = sanitize(p.genre || t('comm_artist_label'));
  const safeLocation = sanitize(p.location || 'International');
  const safeBio      = sanitize(p.bio || t('dyn_no_bio'));
  const safeJoined   = sanitize(String(p.joined || '2026'));
  // URLs des rÃ©seaux sociaux : on vÃ©rifie qu'elles commencent par https://
  const safeUrl = (url) => (url && /^https:\/\//.test(url)) ? encodeURI(url) : '#';
  const postCount = p.postCount || 0;
  return `<div style="background:rgba(255,255,255,0.03);backdrop-filter:blur(20px);border:1px solid rgba(0,229,255,0.12);border-radius:20px;overflow:hidden;transition:all 0.3s" onmouseover="this.style.borderColor='rgba(0,229,255,0.3)'" onmouseout="this.style.borderColor='rgba(0,229,255,0.12)'">
    <div style="height:90px;background:linear-gradient(135deg,rgba(0,100,180,0.3),rgba(0,229,255,0.1));position:relative"></div>
    <div style="padding:12px 20px 20px;margin-top:-28px">
      <div style="width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,var(--cyan),#0070a0);border:3px solid rgba(3,8,15,0.9);display:flex;align-items:center;justify-content:center;font-size:1.4rem;color:var(--dark);font-family:var(--font-display);margin-bottom:10px">${safeUsername.charAt(0).toUpperCase()}</div>
      <div style="font-family:var(--font-display);font-size:1.2rem;color:#fff;letter-spacing:1px">${safeUsername}</div>
      <div style="font-family:var(--font-mono);font-size:0.62rem;color:var(--cyan);margin:4px 0 10px">${safeGenre} Â· ${safeLocation}</div>
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
  const allPosts = await loadPosts();
  const myPosts = allPosts.filter(p=>p.username===currentUser.username);
  el.innerHTML=`
  <div style="display:grid;grid-template-columns:1fr 1.4fr;gap:28px;align-items:start" class="profile-grid">
    <div>
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(0,229,255,0.15);border-radius:20px;overflow:hidden;margin-bottom:20px">
        <div style="height:80px;background:linear-gradient(135deg,rgba(0,100,180,0.4),rgba(0,229,255,0.15))"></div>
        <div style="padding:0 20px 20px;margin-top:-30px">
          <div style="width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,var(--cyan),#0070a0);border:3px solid var(--dark);display:flex;align-items:center;justify-content:center;font-family:var(--font-display);font-size:1.6rem;color:var(--dark);margin-bottom:10px">${currentUser.username.charAt(0).toUpperCase()}</div>
          <div style="font-family:var(--font-display);font-size:1.3rem;color:#fff">${currentUser.username}</div>
          <div style="font-family:var(--font-mono);font-size:0.62rem;color:var(--cyan);margin-bottom:10px">${myP.genre||t('comm_artist_label')} Â· ${myP.location||''}</div>
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
          <option ${myP.genre==='CoupÃ©-DÃ©calÃ©'?'selected':''}>CoupÃ©-DÃ©calÃ©</option>
          <option ${myP.genre==='Zouglou'?'selected':''}>Zouglou</option>
          <option ${myP.genre==='Afropop'?'selected':''}>Afropop</option>
        </select>
      </div>
      <div class="form-row"><label class="form-lbl">${t('comm_location')}</label><input class="form-inp" id="pLocation" value="${myP.location||''}" placeholder="Ex: Abidjan, CÃ´te d'Ivoire"></div>
      <div class="form-row"><label class="form-lbl">Bio</label><textarea class="form-inp" id="pBio" rows="3" placeholder="${t('comm_bio_ph')}">${myP.bio||''}</textarea></div>
      <div style="font-family:var(--font-mono);font-size:0.62rem;letter-spacing:2px;color:var(--cyan);margin:18px 0 12px;text-transform:uppercase"><i class="fas fa-share-alt"></i> ${t('comm_social_media')}</div>
      <div class="form-row"><label class="form-lbl"><i class="fab fa-instagram"></i> Instagram</label><input class="form-inp" id="pInsta" value="${myP.instagram||''}" placeholder="https://instagram.com/..."></div>
      <div class="form-row"><label class="form-lbl"><i class="fab fa-youtube"></i> YouTube</label><input class="form-inp" id="pYt" value="${myP.youtube||''}" placeholder="https://youtube.com/..."></div>
      <div class="form-row"><label class="form-lbl"><i class="fab fa-tiktok"></i> TikTok</label><input class="form-inp" id="pTk" value="${myP.tiktok||''}" placeholder="https://tiktok.com/..."></div>
      <div class="form-row"><label class="form-lbl"><i class="fab fa-soundcloud"></i> SoundCloud</label><input class="form-inp" id="pSc" value="${myP.soundcloud||''}" placeholder="https://soundcloud.com/..."></div>
      <div class="form-row"><label class="form-lbl"><i class="fab fa-spotify"></i> Spotify</label><input class="form-inp" id="pSpotify" value="${myP.spotify||''}" placeholder="https://open.spotify.com/..."></div>
      <div style="font-family:var(--font-mono);font-size:0.62rem;letter-spacing:2px;color:var(--cyan);margin:18px 0 12px;text-transform:uppercase"><i class="fas fa-music"></i> ${t('comm_publish_track')}</div>
      <div class="form-row"><label class="form-lbl">${t('comm_track_title')}</label><input class="form-inp" id="pSongTitle" placeholder="Ex: Ma vie â€” Feat. Je Suis Beatz"></div>
      <div class="form-row"><label class="form-lbl">${t('comm_track_url')}</label><input class="form-inp" id="pSongUrl" placeholder="https://soundcloud.com/..."></div>
      <div class="form-row"><label class="form-lbl">${t('comm_beat_used')}</label>
        <select class="form-inp" id="pSongBeat"><option value="">â€” ${t('comm_choose_beat')} â€”</option>${beats.map(b=>`<option value="${b.title}">${b.title}</option>`).join('')}</select>
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
  const prof = { username:document.getElementById('pUsername').value||currentUser.username, genre:document.getElementById('pGenre').value, location:document.getElementById('pLocation').value, bio:document.getElementById('pBio').value, instagram:document.getElementById('pInsta').value, youtube:document.getElementById('pYt').value, tiktok:document.getElementById('pTk').value, soundcloud:document.getElementById('pSc').value, spotify:document.getElementById('pSpotify').value, joined:new Date().getFullYear().toString() };
  const uid = currentUser.uid || currentUser.username;
  await saveProfileToFirestore(uid, prof);
  showToast(t('dyn_profile_saved'));
  renderMyProfile();
}
 
async function publishSong() {
  if (!currentUser) { showToast(t('dyn_login_first')); return; }
  const title=sanitize(document.getElementById('pSongTitle').value.trim());
  const url=document.getElementById('pSongUrl').value.trim();
  if (!title||!url) { showToast('âš  '+t('err_title_url_required')); return; }
  if(!/^https?:\/\//i.test(url)){ showToast('âš  '+t('err_invalid_url')); return; }
  const post = { type:'song', username:sanitize(currentUser.username), title, url:encodeURI(url), beatTitle:sanitize(document.getElementById('pSongBeat').value), desc:sanitize(document.getElementById('pSongDesc').value), date:new Date().toLocaleDateString('fr'), likes:0, comments:[] };
  await addPostToFirestore(post);
  document.getElementById('pSongTitle').value=''; document.getElementById('pSongUrl').value=''; document.getElementById('pSongDesc').value='';
  showToast(t('dyn_song_published'));
  renderMyProfile();
}
 
function postCard(p, mine) {
  // âœ… SÃ‰CURITÃ‰ : DonnÃ©es Firestore sanitisÃ©es + URLs validÃ©es
  const safeTitle    = sanitize(p.title || (t('fs_chip') + ' Â· ' + sanitize(p.beatTitle || '')));
  const safeBeatTitle= sanitize(p.beatTitle || '');
  const safeDate     = sanitize(p.date || '');
  const safeDesc     = sanitize(p.desc || '');
  const safeUrl      = (p.url && /^https?:\/\//.test(p.url)) ? encodeURI(p.url) : '#';
  return `<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(0,229,255,0.1);border-radius:14px;padding:16px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
      <div>
        <div style="font-family:var(--font-display);font-size:1rem;color:#fff;letter-spacing:1px">${safeTitle}</div>
        <div style="font-family:var(--font-mono);font-size:0.58rem;color:var(--text-dim);margin-top:3px">${safeBeatTitle?`<i class="fas fa-music" style="color:var(--cyan)"></i> ${safeBeatTitle} Â· `:''}<i class="fas fa-calendar" style="color:var(--cyan)"></i> ${safeDate}</div>
      </div>
      <span style="font-family:var(--font-mono);font-size:0.55rem;padding:3px 10px;border-radius:100px;background:rgba(0,229,255,0.1);border:1px solid rgba(0,229,255,0.2);color:var(--cyan)">${p.type==='freestyle'?'ðŸŽ¤ Freestyle':'ðŸŽµ '+t('dyn_tracks_label')}</span>
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
      <span style="margin-left:auto;font-family:var(--font-mono);font-size:0.55rem;padding:4px 12px;border-radius:100px;background:rgba(0,229,255,0.08);border:1px solid rgba(0,229,255,0.2);color:var(--cyan)">${p.type==='freestyle'?'ðŸŽ¤ Freestyle':'ðŸŽµ '+t('comm_published_track')}</span>
    </div>
    ${postCard(p, currentUser&&currentUser.username===p.username)}
  </div>`;
  }).join('');
}
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â•â•â•  SYSTÃˆME BILINGUE FR / EN  â•â•â•â•â•â•â•â•â•â•â•
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 
const translations = {
  fr: {
    // Nav
    nav_home: 'Accueil',
    nav_artists: 'Artistes',
    nav_licenses: 'Licences',
    nav_login: 'Connexion',
    nav_freestyle: 'Freestyle',
    // Hero
    hero_badge: "CÃ´te d'Ivoire Â· Distribution Internationale",
    hero_explore: 'Explorer les Beats',
    hero_licenses: 'Voir les Licences',
    // Stats
    stat_available: 'Disponible',
    // Featured
    featured_chip: 'Nouveau drop',
    featured_title: 'Beat en Vedette',
    // Footer
    footer_desc: "Producteur basÃ© en CÃ´te d'Ivoire. Des sons premium conÃ§us pour dominer les charts internationaux. <em style=\"color:var(--cyan);font-style:italic\">I am the sound you are looking for.</em>",
    footer_nav: 'Navigation',
    footer_catalog: 'Catalogue Beats',
    footer_freestyle: 'Mode Freestyle',
    footer_artists: 'Espace Artistes',
    footer_rights: 'Â© 2026 Je Suis Beatz Â· Tous droits rÃ©servÃ©s Â· Abidjan, CÃ´te d\'Ivoire',
    // Beats
    beats_chip: 'Catalogue',
    beats_title: 'Tous les Beats',
    beats_sub: 'Des productions premium pour tous les styles. TÃ©lÃ©chargement immÃ©diat aprÃ¨s achat.',
    filter_all: 'Tous',
    // Licenses
    lic_title: 'Choisissez votre Licence',
    lic_sub: 'Des licences adaptÃ©es Ã  chaque projet, du morceau amateur Ã  la sortie commerciale internationale.',
    lic_basic_name: 'BASIC',
    lic_basic_tagline: 'Pour dÃ©marrer',
    lic_basic_feat_mp3: 'âœ… Fichier MP3 taggÃ© (320 kbps)',
    lic_basic_feat_streams: 'âœ… 50 000 streams (YouTube, Spotify, Apple Music)',
    lic_basic_feat_social: 'âœ… RÃ©seaux sociaux & contenu personnel',
    lic_basic_feat_oneartist: 'âœ… 1 artiste uniquement',
    lic_basic_feat_nonexclusive: 'âœ… Licence perpÃ©tuelle non-exclusive',
    lic_basic_feat_no_commercial: 'âŒ Pas dâ€™usage commercial',
    lic_basic_feat_no_wav: 'âŒ WAV non inclus',
    lic_basic_note: 'Licence perpÃ©tuelle non-exclusive Ã  usage personnel et non-commercial, limitÃ©e Ã  50 000 streams cumulÃ©s sur toutes plateformes.',
    lic_basic_tag: 'Pour dÃ©marrer',
    lic_choose_basic: 'Choisir Basic',
    lic_premium_badge: 'RecommandÃ©',
    lic_premium_name: 'PREMIUM',
    lic_premium_tagline: 'Le plus populaire Â· RecommandÃ©',
    lic_premium_feat_files: 'âœ… Fichiers MP3 + WAV non taggÃ©s (qualitÃ© studio)',
    lic_premium_feat_streams: 'âœ… 150 000 streams (toutes plateformes)',
    lic_premium_feat_commercial: 'âœ… Usage commercial (vente, streaming monÃ©tisÃ©)',
    lic_premium_feat_radio: 'âœ… Radio & YouTube monÃ©tisÃ© OK',
    lic_premium_feat_physical: 'âœ… Ventes physiques : jusquâ€™Ã  2 000 copies',
    lic_premium_feat_distribution: 'âœ… Distribution mondiale',
    lic_premium_feat_oneartist: 'âœ… 1 artiste uniquement',
    lic_premium_feat_nonexclusive: 'âœ… Licence perpÃ©tuelle non-exclusive',
    lic_premium_feat_no_stems: 'âŒ Stems non inclus',
    lic_premium_feat_catalog: 'âŒ Beat reste en catalogue',
    lic_premium_note: 'Licence perpÃ©tuelle non-exclusive Ã  usage commercial, dans les limites de streams et de copies physiques dÃ©finies ci-dessus.',
    lic_choose_premium: 'Choisir Premium',
    lic_wav_name: 'WAV + STEMS',
    lic_wav_tagline: 'Production complÃ¨te',
    lic_wav_feat_files: 'âœ… MP3 + WAV Haute qualitÃ© + Stems sÃ©parÃ©s (kick, snare, mÃ©lodie, basseâ€¦)',
    lic_wav_feat_streams: 'âœ… 500 000 streams (toutes plateformes)',
    lic_wav_feat_commercial: 'âœ… Usage commercial illimitÃ©',
    lic_wav_feat_sync: 'âœ… Radio, TV & sync autorisÃ©s',
    lic_wav_feat_physical: 'âœ… Ventes physiques : jusquâ€™Ã  5 000 copies',
    lic_wav_feat_distribution: 'âœ… Distribution mondiale',
    lic_wav_feat_mastering: 'âœ… Mix & Mastering professionnel facilitÃ© (fichiers sources sÃ©parÃ©s)',
    lic_wav_feat_oneartist: 'âœ… 1 artiste uniquement',
    lic_wav_feat_nonexclusive: 'âœ… Licence perpÃ©tuelle non-exclusive',
    lic_wav_feat_catalog: 'âŒ Beat reste en catalogue',
    lic_wav_note: 'Licence perpÃ©tuelle non-exclusive Ã  usage commercial Ã©tendu, incluant les fichiers sources (stems) pour usage en production professionnelle, dans les limites dÃ©finies.',
    lic_choose_wav: 'Choisir WAV + Stems',
    lic_unlimited_name: 'UNLIMITED',
    lic_unlimited_tagline: 'Streams illimitÃ©s Â· Beat en catalogue',
    lic_unlimited_feat_files: 'âœ… MP3 + WAV + Stems sÃ©parÃ©s',
    lic_unlimited_feat_streams: 'âœ… Streams illimitÃ©s sur toutes plateformes',
    lic_unlimited_feat_commercial: 'âœ… Usage commercial illimitÃ©',
    lic_unlimited_feat_sync: 'âœ… Radio, TV, Sync & PublicitÃ© autorisÃ©s',
    lic_unlimited_feat_physical: 'âœ… Ventes physiques illimitÃ©es',
    lic_unlimited_feat_distribution: 'âœ… Distribution mondiale',
    lic_unlimited_feat_oneartist: 'âœ… 1 artiste uniquement',
    lic_unlimited_feat_nonexclusive: 'âœ… Licence perpÃ©tuelle non-exclusive',
    lic_unlimited_feat_catalog: 'âŒ Beat reste en catalogue (dâ€™autres peuvent lâ€™acheter)',
    lic_unlimited_note: 'Licence perpÃ©tuelle non-exclusive Ã  usage commercial illimitÃ©, sans plafond de streams ni de copies, sur tous territoires et supports.',
    lic_choose_unlimited: 'Choisir Unlimited',
    lic_exclusive_name: 'EXCLUSIF',
    lic_exclusive_tagline: 'Droits totaux Â· Cession dÃ©finitive',
    lic_exclusive_feat_files: 'âœ… MP3 + WAV + Stems sÃ©parÃ©s (qualitÃ© master)',
    lic_exclusive_feat_streams: 'âœ… Streams & ventes illimitÃ©s',
    lic_exclusive_feat_use: 'âœ… Tous usages : commercial, radio, TV, cinÃ©ma, publicitÃ©, sync',
    lic_exclusive_feat_distribution: 'âœ… Distribution mondiale illimitÃ©e',
    lic_exclusive_feat_removed: 'âœ… Beat retirÃ© du catalogue dÃ©finitivement',
    lic_exclusive_feat_contract: 'âœ… Contrat de cession officiel signÃ© (PDF)',
    lic_exclusive_feat_support: 'âœ… Support prioritaire',
    lic_exclusive_feat_valid: 'âœ… Les licences non-exclusives dÃ©jÃ  vendues restent valides',
    lic_exclusive_note: 'Cession exclusive et dÃ©finitive de tous droits patrimoniaux dâ€™exploitation sur le beat, sans limitation de durÃ©e, de territoire ou dâ€™usage.',
    lic_choose_exclusive: 'Choisir Exclusif',
    lic_legal_note: 'Toutes les licences sont rÃ©gies par les lois de la RÃ©publique de CÃ´te dâ€™Ivoire et les standards internationaux de propriÃ©tÃ© intellectuelle (OMPI/WIPO). Lâ€™achat dâ€™une licence vaut acceptation des conditions gÃ©nÃ©rales dâ€™utilisation.',
    // FAQ
    faq_title: 'Questions frÃ©quentes',
    faq_q1: 'Comment tÃ©lÃ©charger aprÃ¨s achat ?',
    faq_a1: 'AprÃ¨s le paiement, vous recevez un lien de tÃ©lÃ©chargement immÃ©diat par email. Le fichier est disponible pendant 30 jours.',
    faq_q2: 'Puis-je utiliser le beat sur toutes les plateformes ?',
    faq_a2: "Oui, selon votre licence. Le Premium et l'Exclusif couvrent Spotify, Apple Music, YouTube, TikTok et toutes les plateformes internationales.",
    faq_q3: 'Quels moyens de paiement acceptez-vous ?',
    faq_a3: 'GeniusPay â€” paiement rapide et sÃ©curisÃ©. Paiement 100% sÃ©curisÃ©.',
    // Contact
    contact_title: 'Travaillons Ensemble',
    contact_sub: "Une question, une collaboration, un projet ? N'hÃ©sitez pas Ã  m'Ã©crire.",
    contact_based: 'BasÃ© Ã ',
    contact_dist: 'Distribution',
    contact_dist_val: 'Mondiale â€” Livraison digitale immÃ©diate',
    contact_form_title: 'Envoyer un Message',
    contact_name: 'Nom complet',
    contact_name_ph: 'Votre nom',
    contact_subject: 'Sujet',
    contact_subject_ph: 'Collaboration, question, achat...',
    contact_msg: 'Message',
    contact_msg_ph: 'DÃ©crivez votre projet...',
    contact_send: 'Envoyer le Message',
    // Freestyle
    fs_title: 'Mode Freestyle',
    fs_sub: 'Choisis un beat, enregistre ton freestyle directement sur le site, rÃ©Ã©coute-le et partage-le.',
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
    dyn_no_beat_audio: 'âš  Ce beat n\'a pas de fichier audio',
    dyn_already_cart: 'âš  DÃ©jÃ  dans le panier !',
    dyn_added_cart: 'âœ“ "%s" ajoutÃ© au panier !',
    dyn_stop: 'ArrÃªter',
    dyn_restart: 'Recommencer',
    dyn_pause: 'Pause',
    dyn_cart_empty: 'Votre panier est vide',
    dyn_pay_login: 'âš  Connectez-vous pour payer !',
    dyn_profile_saved: 'âœ“ Profil enregistrÃ© !',
    dyn_song_published: 'âœ“ Morceau publiÃ© !',
    dyn_freestyle_published: 'âœ“ Freestyle publiÃ© sur ton profil !',
    dyn_login_welcome: 'âœ“ Bienvenue %s !',
    dyn_account_created: 'âœ“ Compte crÃ©Ã© ! Bienvenue %s !',
    dyn_disconnected: 'DÃ©connectÃ©',
    dyn_recording_saved: 'âœ… Enregistrement sauvegardÃ©',
    dyn_no_recording: 'âš  Aucun enregistrement',
    dyn_select_beat_first: 'âš  SÃ©lectionne un beat d\'abord !',
    dyn_mic_denied: 'âš  AccÃ¨s au micro refusÃ©. Autorise le micro dans ton navigateur.',
    dyn_recording_status: 'Enregistrement en cours...',
    dyn_recording_done: 'Enregistrement terminÃ© âœ“',
    dyn_recording_stopped: 'Enregistrement arrÃªtÃ©',
    dyn_recording_prepare: 'PrÃªt pour un nouvel enregistrement',
    dyn_rec_default: 'PrÃªt Ã  enregistrer',
    dyn_no_freestyle: 'âš  Enregistre un freestyle d\'abord',
    dyn_login_first: 'âš  Connecte-toi pour publier !',
    dyn_no_sound_pub: 'âš  Aucun enregistrement Ã  publier',
    dyn_loading: 'Chargement...',
    dyn_feed_empty_title: 'Fil vide',
    dyn_feed_empty_sub: 'Sois le premier Ã  publier un freestyle ou un morceau !',
    dyn_msg_sent: 'âœ“ Message envoyÃ© ! Je rÃ©pondrai sous 24h.',
    dyn_beat_added: 'âœ“ "%s" ajoutÃ© !',
    dyn_beat_deleted: 'Beat supprimÃ©',
    dyn_no_artists: 'Aucun artiste inscrit.',
    dyn_be_first: 'Sois le premier !',
    dyn_no_bio: 'Pas encore de bio.',
    dyn_no_pub: 'Aucune publication',
    dyn_sold_label: 'Vendu',
    dyn_available_label: 'Disponible',
    dyn_no_audio: 'âš  Pas de fichier audio pour ce beat',
    dyn_play_error: 'âš  Impossible de lire le fichier audio',
    dyn_pause_beat: 'Pause Beat',
    dyn_rec_deleted: 'Publication supprimÃ©e',
    dyn_connect_first: 'Connecte-toi d\'abord',
    dyn_connect_to_create: 'Tu dois te connecter pour crÃ©er ton profil artiste.',
    dyn_sign_in: 'Se connecter',
    dyn_no_beat_selected: 'â€”',
    dyn_songs_count: '%s morceaux',
    dyn_download_started: 'â¬‡ï¸ TÃ©lÃ©chargement lancÃ©',
    comm_my_profile: 'Mon Profil',
    comm_feed: 'Fil d\'actualitÃ©',
    fs_my_rec: 'Mes enregistrements',
    dyn_no_rec_static: 'Aucun enregistrement',
    // Admin panel
    admin_add_beat: 'Ajouter un Beat',
    admin_manage_beats: 'GÃ©rer les Beats',
    admin_settings: 'ParamÃ¨tres',
    admin_view_site: 'Voir le site',
    admin_welcome: 'Bienvenue dans votre espace admin',
    admin_recent_beats: 'Beats rÃ©cents',
    admin_add_beat_sub: 'Ajoutez un nouveau beat Ã  votre catalogue',
    admin_upload_title: 'TÃ©lÃ©verser les fichiers',

    admin_upload_hint: 'Glissez-dÃ©posez ou cliquez pour sÃ©lectionner. MP3, WAV, MPEG Â· JPG, PNG, WEBP',
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
    admin_security: 'SÃ©curitÃ©',

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
    admin_saved_toast: 'ParamÃ¨tres enregistrÃ©s',
    admin_old_pwd: 'Ancien mot de passe',
    admin_new_pwd: 'Nouveau mot de passe',
    admin_change_pwd: 'Changer',
    admin_pwd_changed: 'Mot de passe changÃ© !',
    admin_beat_edited: 'Beat mis Ã  jour !',
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
    fs_choose_beat: 'SÃ©lectionner un Beat',
    fs_selected_beat: 'Beat sÃ©lectionnÃ©',
    fs_no_beat_selected: 'Aucun beat sÃ©lectionnÃ©',
    fs_recording_label: 'Enregistrement Vocal',
    fs_listen_mix: 'Ã‰couter le mix',
    fs_download_voice: 'TÃ©lÃ©charger',
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
    studio_eq_title: 'Ã‰galiseur 3-Bandes',
    studio_band_bass: 'BASSES',
    studio_band_mid: 'MÃ‰DIUMS',
    studio_band_treble: 'AIGUS',
    fs_export_mp3: 'Exporter en MP3',
    fs_publish: 'Publier',
    fs_share_link: 'Copier Lien',
    fs_recording_ready: 'Enregistrement terminÃ© â€” Ã‰coute ton take',
    fs_listen_recording: 'Ã‰couter l\'enregistrement',
    fs_discard_recording: 'Supprimer',
    fs_listen_mix: 'Ã‰couter le mix',
    fs_play_mode_mix: 'Mix Studio',
    fs_play_mode_vocal: 'Voix seule',
    fs_monitoring_active: 'ðŸŽ§ Monitoring actif â€” Beat + Voix',
    fs_monitoring_label: 'Monitoring Studio',
    fs_studio_rec_started: 'ðŸŽ§ Studio actif â€” chantez sur le beat',
    fs_mix_ready: 'âœ… Mix studio prÃªt â€” Ã©coute beat + voix',
    fs_mix_playback_hint: 'Mix studio â€” beat et voix synchronisÃ©s',
    fs_vocal_playback_hint: 'Ã‰coute ta voix seule',
    dyn_recording_processing: 'Traitement de l\'enregistrement...',
    dyn_recording_failed: 'âŒ Ã‰chec de l\'enregistrement',
    dyn_no_active_recording: 'Aucun enregistrement en cours',
    dyn_recording_discarded: 'Enregistrement supprimÃ©',
    dyn_playback_failed: 'âš  Utilise le lecteur audio pour Ã©couter',
    studio_mic_error: 'Impossible d\'accÃ©der au microphone',
    studio_spectral_analyzer: 'Analyseur Spectral',
    studio_export_title: 'Export & Partage',
    studio_recording_started: 'ðŸ”´ Enregistrement synchronisÃ© dÃ©marrÃ©',
    studio_recording_stopped_toast: 'â¹ï¸ Enregistrement arrÃªtÃ©. PrÃªt Ã  Ã©couter.',
    studio_loading: 'Studio en cours de chargement...',
    studio_error_init: 'Erreur lors de l\'initialisation du studio',
    studio_select_beat_first: 'SÃ©lectionnez un beat avant d\'enregistrer',
    studio_mic_denied: 'Micro refusÃ© â€” autorise l\'accÃ¨s dans RÃ©glages > Safari/Chrome',
    studio_mic_not_found: 'Aucun micro dÃ©tectÃ© sur cet appareil',
    studio_mic_unsupported: 'Enregistrement non supportÃ© â€” utilise Safari ou Chrome Ã  jour',
    studio_beat_not_found: 'âŒ Beat introuvable. VÃ©rifiez votre connexion ou choisissez un autre beat.',
    studio_beat_selected: 'âœ… Beat sÃ©lectionnÃ©: %s',
    studio_recording_started: 'ðŸ”´ Enregistrement synchronisÃ© dÃ©marrÃ©',
    studio_recording_stopped_toast: 'â¹ï¸ Enregistrement arrÃªtÃ©. PrÃªt Ã  Ã©couter.',
    // Community
    comm_chip: 'Community',
    // Error messages
    err_all_fields: 'Tous les champs sont requis',
    err_wrong_creds: 'Identifiants incorrects',
    err_username_format: 'Pseudo : 3-20 caractÃ¨res, lettres/chiffres/tirets uniquement',
    err_invalid_email: 'Adresse email invalide',
    err_pwd_short: 'Mot de passe trop court (minimum 8 caractÃ¨res)',
    err_pwd_format: 'Le mot de passe doit contenir au moins 1 majuscule et 1 chiffre',
    err_username_taken: 'Pseudo dÃ©jÃ  utilisÃ©',
    err_email_taken: 'Email dÃ©jÃ  utilisÃ©',
    err_wrong_pwd: 'Mot de passe incorrect',
    err_pwd_too_short: 'Trop court (min 6 caractÃ¨res)',
    err_title_bpm_required: 'Titre et BPM requis !',
    err_title_url_required: 'Titre et URL requis !',
    err_invalid_url: 'URL invalide (doit commencer par par https://)',
    // Payment modal
    pay_card_name: 'Card',
    pay_paypal_sub: 'Secure payment',
    pay_loading_paypal: 'Loading PayPal...',
    pay_paypal_note: 'Secure payment via PayPal Â· Visa, Mastercard, PayPal account accepted.',
    // Featured (dynamic)
    feat_listen: 'Listen',
    feat_add_cart: 'Add to Cart',
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
    pay_cancelled: 'Paiement PayPal annulÃ©.',
    pay_error: 'Une erreur est survenue.',
    // Freestyle
    fs_mic_level: 'Niveau Micro',
    // Contact
    contact_email_ph: 'votre@email.com',
    // Studio labels
    studio_title: 'STUDIO PRO',
    studio_subtitle: 'PRODUCTION Â· MIX Â· MASTER Â· EXPORT',
    studio_ready: 'PRÃŠT',
    studio_close: 'Fermer',
    studio_waveform: 'Waveform â€” Ta voix',
    studio_eq: 'Ã‰galiseur (EQ)',
    studio_compressor: 'Compresseur',
    studio_reverb: 'Reverb',
    studio_vocal_gain: 'Gain vocal',
    studio_presets: 'PrÃ©rÃ©glages Voix',
    studio_open_btn: 'Ouvrir le Studio',
    export_login_required: 'Connecte-toi d\'abord',
    export_no_recording: 'âŒ Aucun enregistrement Ã  exporter',
    export_preparing: 'â³ PrÃ©paration de l\'export...',
    export_success: 'âœ… Freestyle exportÃ© avec succÃ¨s',
    export_error: 'âŒ Erreur lors de l\'export',
    publish_preparing: 'â³ Publication en cours...',
    publish_success: 'âœ… Freestyle publiÃ© sur ton profil',
    publish_error: 'âŒ Erreur lors de la publication',
    share_link_copied: 'âœ… Lien copiÃ©',
    publish_upload_error: 'âŒ Erreur lors du tÃ©lÃ©chargement',
    // Login section (FR)
    login_title: 'Connexion',
    login_sub: 'AccÃ©dez Ã  votre espace',
    login_email_label: 'Email ou Pseudo',
    login_pwd_label: 'Mot de passe',
    login_email_placeholder: 'Email ou Pseudo',
    login_pwd_placeholder: 'â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢',
    login_btn: 'Se Connecter',
    login_no_account: 'Pas de compte ?',
    login_register: 'S\'inscrire',
    login_back: 'Retour au site',
    login_resend_verify: 'Renvoyer l\'email de vÃ©rification',
    reg_pseudo: 'Pseudo',
    reg_pseudo_placeholder: 'Votre pseudo',
    reg_email: 'Email',
    reg_email_placeholder: 'votre@email.com',
    reg_pwd: 'Mot de passe',
    reg_pwd_placeholder: 'Min. 6 caractÃ¨res',
    reg_btn: 'CrÃ©er un Compte',
    reg_already: 'DÃ©jÃ  inscrit ?',
    login_verify_required: 'âœ… Veuillez vÃ©rifier votre email avant de continuer. Un lien de vÃ©rification a Ã©tÃ© envoyÃ© Ã  %s. Si vous ne le recevez pas, vÃ©rifiez votre dossier spam ou renvoyez-le.',
    login_verify_resend_error: 'âš  Impossible de renvoyer l\'email de vÃ©rification. RÃ©essayez plus tard.',
    login_already_verified: 'âœ… Votre adresse est dÃ©jÃ  vÃ©rifiÃ©e. Vous pouvez maintenant vous connecter.',
    login_verification_resent: 'âœ… Email de vÃ©rification renvoyÃ© Ã  %s. VÃ©rifiez votre boÃ®te de rÃ©ception et votre dossier spam.',
    login_resend_enter_credentials: 'Veuillez entrer votre email/pseudo et votre mot de passe pour renvoyer l\'email de vÃ©rification.',
    login_resend_username_not_found: 'Pseudo introuvable. VÃ©rifiez vos informations et rÃ©essayez.',
    login_verify_send_failed: 'âš  Compte crÃ©Ã©, mais l\'email de vÃ©rification n\'a pas pu Ãªtre envoyÃ©. VÃ©rifiez votre adresse ou rÃ©essayez plus tard.',
    login_verify_sent: 'âœ… Compte crÃ©Ã© ! Un lien de vÃ©rification a Ã©tÃ© envoyÃ© Ã  %s. Veuillez vÃ©rifier votre email avant de vous connecter.',
  },
  en: {
    // Nav
    nav_home: 'Home',
    nav_artists: 'Artists',
    nav_licenses: 'Licenses',
    nav_login: 'Login',
    nav_freestyle: 'Freestyle',
    // Hero
    hero_badge: "Ivory Coast Â· International Distribution",
    hero_explore: 'Explore Beats',
    hero_licenses: 'View Licenses',
    // Licenses page
    lic_title: 'Choose your License',
    lic_sub: 'Licenses for every project â€” from amateur releases to international commercial distribution.',
    lic_basic_name: 'BASIC',
    lic_basic_tagline: 'Get started',
    lic_basic_feat_mp3: 'âœ… Tagged MP3 file (320 kbps)',
    lic_basic_feat_streams: 'âœ… 50,000 streams (YouTube, Spotify, Apple Music)',
    lic_basic_feat_social: 'âœ… Social media & personal use',
    lic_basic_feat_oneartist: 'âœ… Single artist only',
    lic_basic_feat_nonexclusive: 'âœ… Perpetual non-exclusive license',
    lic_basic_feat_no_commercial: 'âŒ No commercial use',
    lic_basic_feat_no_wav: 'âŒ WAV not included',
    lic_basic_note: 'Perpetual non-exclusive license for personal and non-commercial use; limited to 50,000 cumulative streams across platforms.',
    lic_choose_basic: 'Choose Basic',
    lic_premium_badge: 'Recommended',
    lic_premium_name: 'PREMIUM',
    lic_premium_tagline: 'Most popular Â· Recommended',
    lic_premium_feat_files: 'âœ… MP3 + WAV (studio quality)',
    lic_premium_feat_streams: 'âœ… 150,000 streams (all platforms)',
    lic_premium_feat_commercial: 'âœ… Commercial use (sales, monetized streaming)',
    lic_premium_feat_radio: 'âœ… Radio & monetized YouTube OK',
    lic_premium_feat_physical: 'âœ… Physical sales up to 2,000 copies',
    lic_premium_feat_distribution: 'âœ… Worldwide distribution',
    lic_premium_feat_oneartist: 'âœ… Single artist only',
    lic_premium_feat_nonexclusive: 'âœ… Perpetual non-exclusive license',
    lic_premium_feat_no_stems: 'âŒ Stems not included',
    lic_premium_feat_catalog: 'âŒ Beat remains in catalog',
    lic_premium_note: 'Perpetual non-exclusive commercial license within the stream and physical copy limits above.',
    lic_choose_premium: 'Choose Premium',
    lic_wav_name: 'WAV + STEMS',
    lic_wav_tagline: 'Complete production',
    lic_wav_feat_files: 'âœ… MP3 + WAV high quality + separated stems (kick, snare, melody, bassâ€¦)',
    lic_wav_feat_streams: 'âœ… 500,000 streams (all platforms)',
    lic_wav_feat_commercial: 'âœ… Unlimited commercial use',
    lic_wav_feat_sync: 'âœ… Radio, TV & sync allowed',
    lic_wav_feat_physical: 'âœ… Physical sales up to 5,000 copies',
    lic_wav_feat_distribution: 'âœ… Worldwide distribution',
    lic_wav_feat_mastering: 'âœ… Mix & mastering friendly (separated source files)',
    lic_wav_feat_oneartist: 'âœ… Single artist only',
    lic_wav_feat_nonexclusive: 'âœ… Perpetual non-exclusive license',
    lic_wav_feat_catalog: 'âŒ Beat remains in catalog',
    lic_wav_note: 'Perpetual non-exclusive commercial license including source files (stems) for professional production.',
    lic_choose_wav: 'Choose WAV + Stems',
    lic_unlimited_name: 'UNLIMITED',
    lic_unlimited_tagline: 'Unlimited streams Â· Beat remains in catalog',
    lic_unlimited_feat_files: 'âœ… MP3 + WAV + separated stems',
    lic_unlimited_feat_streams: 'âœ… Unlimited streams on all platforms',
    lic_unlimited_feat_commercial: 'âœ… Unlimited commercial use',
    lic_unlimited_feat_sync: 'âœ… Radio, TV, sync & advertising allowed',
    lic_unlimited_feat_physical: 'âœ… Unlimited physical sales',
    lic_unlimited_feat_distribution: 'âœ… Worldwide distribution',
    lic_unlimited_feat_oneartist: 'âœ… Single artist only',
    lic_unlimited_feat_nonexclusive: 'âœ… Perpetual non-exclusive license',
    lic_unlimited_feat_catalog: 'âŒ Beat remains in catalog (others can still buy it)',
    lic_unlimited_note: 'Perpetual non-exclusive commercial license with unlimited streams, copies, and territories.',
    lic_choose_unlimited: 'Choose Unlimited',
    lic_exclusive_name: 'EXCLUSIVE',
    lic_exclusive_tagline: 'Full rights Â· Permanent transfer',
    lic_exclusive_feat_files: 'âœ… MP3 + WAV + separated stems (master quality)',
    lic_exclusive_feat_streams: 'âœ… Unlimited streams & sales',
    lic_exclusive_feat_use: 'âœ… All uses: commercial, radio, TV, film, advertising, sync',
    lic_exclusive_feat_distribution: 'âœ… Worldwide unlimited distribution',
    lic_exclusive_feat_removed: 'âœ… Beat removed from catalog permanently',
    lic_exclusive_feat_contract: 'âœ… Official transfer agreement signed (PDF)',
    lic_exclusive_feat_support: 'âœ… Priority support',
    lic_exclusive_feat_valid: 'âœ… Previously sold non-exclusive licenses remain valid',
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
    footer_rights: 'Â© 2026 Je Suis Beatz Â· All rights reserved Â· Abidjan, Ivory Coast',
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
    faq_a3: 'GeniusPay â€” fast and secure checkout. 100% secure payment.',
    // Contact
    contact_title: "Let's Work Together",
    contact_sub: 'A question, a collaboration, a project? Feel free to reach out.',
    contact_based: 'Based in',
    contact_dist: 'Distribution',
    contact_dist_val: 'Worldwide â€” Instant digital delivery',
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
    fs_play_beat: 'Play Beat',
    fs_rec_hint: 'Press to record',
    // Community
    comm_title: 'Artists Space',
    comm_sub: 'Create your artist profile, share your socials, publish your tracks made with Je Suis Beatz beats.',
    // Login
    login_title: 'Login',
    login_sub: 'Access your space',
    login_email_label: 'Email or Username',
    login_pwd_label: 'Password',
    login_email_placeholder: 'Email or Username',
    login_pwd_placeholder: 'â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢',
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
    login_verify_required: 'âœ… Please verify your email before continuing. A verification link has been sent to %s. If you do not receive it, check your spam folder or use the resend link below.',
    login_verify_resend_error: 'âš  Unable to resend the verification email. Please try again later.',
    login_already_verified: 'âœ… Your email is already verified. You can now sign in.',
    login_verification_resent: 'âœ… Verification email sent to %s. Check your inbox and spam folder.',
    login_resend_enter_credentials: 'Please enter your email/username and password to resend the verification email.',
    login_resend_username_not_found: 'Username not found. Check your details and try again.',
    login_verify_send_failed: 'âš  Account created, but the verification email could not be sent. Please check your address or try again later.',
    login_verify_sent: 'âœ… Account created! A verification link has been sent to %s. Check your email before signing in.',
    // Cart
    cart_title: 'Cart',
    cart_pay: 'Pay',
    // Edit modal
    edit_beat_title: 'Edit Beat',
    // Dynamic strings
    dyn_no_beat_audio: 'âš  This beat has no audio file',
    dyn_already_cart: 'âš  Already in cart!',
    dyn_added_cart: 'âœ“ "%s" added to cart!',
    dyn_stop: 'Stop',
    dyn_restart: 'Restart',
    dyn_pause: 'Pause',
    dyn_cart_empty: 'Your cart is empty',
    dyn_pay_login: 'âš  Please log in to pay!',
    dyn_profile_saved: 'âœ“ Profile saved!',
    dyn_song_published: 'âœ“ Track published!',
    dyn_freestyle_published: 'âœ“ Freestyle published on your profile!',
    dyn_login_welcome: 'âœ“ Welcome %s!',
    dyn_account_created: 'âœ“ Account created! Welcome %s!',
    dyn_disconnected: 'Logged out',
    dyn_recording_saved: 'âœ“ Freestyle recorded!',
    dyn_no_recording: 'âš  No recordings',
    dyn_select_beat_first: 'âš  Select a beat first!',
    dyn_mic_denied: 'âš  Microphone access denied. Allow mic access in your browser.',
    dyn_recording_status: 'Recording...',
    dyn_recording_done: 'Recording complete',
    dyn_recording_stopped: 'Recording stopped',
    dyn_recording_prepare: 'Preparing a new take...',
    dyn_rec_default: 'Press to record',
    dyn_no_freestyle: 'âš  Record a freestyle first',
    dyn_login_first: 'âš  Log in to publish!',
    dyn_no_sound_pub: 'âš  No recording to publish',
    dyn_loading: 'Loading...',
    dyn_feed_empty_title: 'Empty feed',
    dyn_feed_empty_sub: 'Be the first to post a freestyle or a track!',
    dyn_msg_sent: 'âœ“ Message sent! I\'ll reply within 24h.',
    dyn_beat_added: 'âœ“ "%s" added!',
    dyn_beat_deleted: 'Beat deleted',
    dyn_no_artists: 'No artists registered.',
    dyn_be_first: 'Be the first!',
    dyn_no_bio: 'No bio yet.',
    dyn_no_pub: 'No publications',
    dyn_sold_label: 'Sold',
    dyn_available_label: 'Available',
    dyn_no_audio: 'âš  No audio file for this beat',
    dyn_play_error: 'âš  Unable to play the audio file',
    dyn_pause_beat: 'Pause Beat',
    dyn_rec_deleted: 'Post deleted',
    dyn_connect_first: 'Login first',
    dyn_connect_to_create: 'You must be logged in to create your artist profile.',
    dyn_sign_in: 'Sign In',
    dyn_no_beat_selected: 'â€”',
    dyn_songs_count: '%s tracks',
    dyn_download_started: 'â¬‡ï¸ Download started',
    comm_my_profile: 'My Profile',
    comm_feed: 'News Feed',
    fs_my_rec: 'My recordings',
    dyn_no_rec_static: 'No recordings',
    // Admin panel
    admin_add_beat: 'Add a Beat',
    admin_manage_beats: 'Manage Beats',
    admin_settings: 'Settings',
    admin_view_site: 'View Site',
    admin_welcome: 'Welcome to your administration panel',
    admin_recent_beats: 'Recent Beats',
    admin_add_beat_sub: 'Add a new beat to your catalog',
    admin_upload_title: 'Upload files',
    admin_upload_hint: 'Drag & drop or click to select. MP3, WAV, MPEG Â· JPG, PNG, WEBP',
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
    fs_recording_ready: 'Recording complete â€” Listen to your take',
    fs_listen_recording: 'Listen to recording',
    fs_discard_recording: 'Delete',
    fs_listen_mix: 'Listen to mix',
    fs_play_mode_mix: 'Studio Mix',
    fs_play_mode_vocal: 'Vocals only',
    fs_monitoring_active: 'ðŸŽ§ Monitoring active â€” Beat + Vocals',
    fs_monitoring_label: 'Studio Monitoring',
    fs_studio_rec_started: 'ðŸŽ§ Studio live â€” rap over the beat',
    fs_mix_ready: 'âœ… Studio mix ready â€” listen beat + vocals',
    fs_mix_playback_hint: 'Studio mix â€” beat and vocals synced',
    fs_vocal_playback_hint: 'Listen to your vocals only',
    dyn_recording_processing: 'Processing recording...',
    dyn_recording_failed: 'âŒ Recording failed',
    dyn_no_active_recording: 'No active recording',
    dyn_recording_discarded: 'Recording deleted',
    dyn_playback_failed: 'âš  Use the audio player to listen',
    studio_mic_error: 'Unable to access the microphone',
    studio_spectral_analyzer: 'Spectral Analyzer',
    studio_export_title: 'Export & Share',
    studio_recording_started: 'ðŸ”´ Synchronized recording started',
    studio_recording_stopped_toast: 'â¹ï¸ Recording stopped. Ready to listen.',
    studio_loading: 'Studio is loading...',
    studio_error_init: 'Error initializing the studio',
    studio_select_beat_first: 'Select a beat before recording',
    studio_mic_denied: 'Mic denied â€” allow access in browser settings',
    studio_mic_not_found: 'No microphone detected on this device',
    studio_mic_unsupported: 'Recording not supported â€” use an up-to-date Safari or Chrome',
    studio_beat_not_found: 'âŒ Beat not found. Check your connection or choose another beat.',
    studio_beat_selected: 'âœ… Beat selected: %s',
    studio_recording_started: 'ðŸ”´ Synchronized recording started',
    studio_recording_stopped_toast: 'â¹ï¸ Recording stopped. Ready to listen.',
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
    pay_paypal_note: 'Secured by PayPal Â· Visa, Mastercard, PayPal account accepted.',
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
    studio_subtitle: 'PRODUCTION Â· MIX Â· MASTER Â· HD EXPORT',
    studio_ready: 'READY',
    studio_close: 'Close',
    studio_waveform: 'Waveform â€” Your voice',
    studio_eq: 'Equalizer (EQ)',
    studio_compressor: 'Compressor',
    studio_reverb: 'Reverb',
    studio_vocal_gain: 'Vocal Gain',
    studio_presets: 'Voice Presets',
    studio_open_btn: 'Open Studio',
    export_login_required: 'Please sign in first',
    export_no_recording: 'âŒ No recording to export',
    export_preparing: 'â³ Preparing export...',
    export_success: 'âœ… Freestyle exported successfully',
    export_error: 'âŒ Export error',
    publish_preparing: 'â³ Publishing...',
    publish_success: 'âœ… Freestyle published on your profile',
    publish_error: 'âŒ Publishing error',
    share_link_copied: 'âœ… Link copied',
    publish_upload_error: 'âŒ Upload error',
  }
};
 
// â”€â”€â”€ Current language state â”€â”€â”€
let currentLang = localStorage.getItem('jsb_lang') || 'fr';
 
// â”€â”€â”€ Get translation â”€â”€â”€
function t(key, ...args) {
  currentLang = localStorage.getItem('jsb_lang') || currentLang || 'fr';
  if (!['fr', 'en'].includes(currentLang)) currentLang = 'fr';
  const lang = translations[currentLang] || translations['fr'];
  let str = lang[key] || translations['fr'][key] || key;
  args.forEach(a => { str = str.replace('%s', a); });
  return str;
}
 
// â”€â”€â”€ Apply translations to all data-i18n elements â”€â”€â”€
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
      if (attr.name.startsWith('data-i18n-') && attr.name !== 'data-i18n' && attr.name !== 'data-i18n-ph') {
        const key = attr.value;
        if (key) el.textContent = t(key);
      }
    });
  });
  // Update html lang attribute
  document.documentElement.lang = currentLang;
  // Update lang button
  const flag = document.getElementById('langFlag');
  const label = document.getElementById('langLabel');
  if (flag && label) {
    if (currentLang === 'fr') { flag.textContent = 'ðŸ‡¬ðŸ‡§'; label.textContent = 'EN'; }
    else { flag.textContent = 'ðŸ‡«ðŸ‡·'; label.textContent = 'FR'; }
  }
  // Update dynamic UI strings that are rendered via JS
  updateDynamicStrings();
}
 
// â”€â”€â”€ Update strings that are rendered in JS â”€â”€â”€
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
 
// â”€â”€â”€ Toggle language â”€â”€â”€
function toggleLang() {
  currentLang = currentLang === 'fr' ? 'en' : 'fr';
  localStorage.setItem('jsb_lang', currentLang);
  applyTranslations();
  // Re-render dynamic content
  renderAll();
  renderCartItems();
}
 
// â”€â”€â”€ Override showToast to use translations where applicable â”€â”€â”€
const _origShowToast = showToast;
 
// â”€â”€â”€ Patch dynamic JS strings to use t() â”€â”€â”€
// These patches ensure runtime messages also switch language
function patchDynamicStrings() {
  // Override filterBeats empty state rendering
  const origRenderBeatsGrid = renderBeatsGrid;
  // Already defined above; we patch the no-beats message via renderAll â†’ renderBeatsGrid
}
 
// â”€â”€â”€ Override renderCartItems for translated empty cart â”€â”€â”€
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
        <div class="cart-item-pr">$${c.price} Â· ${c.license} Â· ${formatUsdAsCurrency(c.price, 'XOF')}</div>
      </div>
      <button class="cart-rm" data-cart-id="${String(c.id).replace(/"/g, '&quot;')}"><i class="fas fa-times"></i></button>
    </div>`).join('');
  const total = cartTotalUsd();
  document.getElementById('cartTotVal').textContent = '$' + total + ' Â· ' + formatUsdAsCurrency(total, 'XOF');
}
 
// Apply translations on load
document.addEventListener('DOMContentLoaded', () => {
  applyTranslations();
  initBeatUploadZones();
  initCurrencyRateUpdater();
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â•â•â•  STUDIO VIRTUEL â€” Moteur Audio Web API          â•â•â•
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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
  setStudioStatus(currentLang==='en'?'READY':'PRÃŠT', '#4ade80');
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

// â”€â”€â”€ Dessiner la waveform de l'enregistrement â”€â”€â”€
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
    // Waveform dÃ©corative si pas d'enregistrement
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
    ctx.fillText(currentLang==='en'?'â€” Record a freestyle to see the waveform â€”':'â€” Enregistre ton freestyle pour voir la waveform â€”', W/2, H/2+4);
    return;
  }

  // DÃ©coder et dessiner le vrai signal audio
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

// â”€â”€â”€ Construire la chaÃ®ne audio du studio â”€â”€â”€
// â”€â”€â”€ Decode voice depuis le Blob stockÃ© en mÃ©moire (zÃ©ro CORS) â”€â”€â”€
async function decodeVoiceFromBlob() {
  if (!studioCtx) initStudioContext();
  if (studioCtx.state === 'suspended') await studioCtx.resume();
  if (!fsRecordings.length) return null;

  const rec = fsRecordings[0];

  // MÃ©thode 1 : Blob directement en mÃ©moire (le plus fiable)
  if (rec.blob instanceof Blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        studioCtx.decodeAudioData(e.target.result.slice(0), buf => resolve(buf), err => reject(new Error(currentLang==='en'?'Audio decode failed':'DÃ©codage audio Ã©chouÃ©')));
      };
      reader.onerror = () => reject(new Error(currentLang==='en'?'Cannot read Blob':'Lecture Blob impossible'));
      reader.readAsArrayBuffer(rec.blob);
    });
  }

  // MÃ©thode 2 : fallback XHR sur blob URL
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', rec.url, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = () => {
      studioCtx.decodeAudioData(xhr.response.slice(0), buf => resolve(buf), () => reject(new Error(currentLang==='en'?'Decode failed':'DÃ©codage Ã©chouÃ©')));
    };
    xhr.onerror = () => reject(new Error(currentLang === 'en' ? 'Cannot read audio blob' : 'Impossible de lire le blob audio'));
    xhr.send();
  });
}

async function buildStudioChain() {
  if (!studioCtx) initStudioContext();
  if (studioCtx.state === 'suspended') await studioCtx.resume();

  // â”€ Decode voix depuis blob local (sans fetch, pas de CORS) â”€
  studioVoiceBuffer = await decodeVoiceFromBlob();

  // â”€ Beat : on utilise l'Ã©lÃ©ment Audio existant (fsAudio) via MediaElementSource
  //   car l'URL Firebase peut bloquer fetch(). On ne dÃ©code pas le beat en buffer.
  studioGainVoice = studioCtx.createGain();
  studioGainVoice.gain.value = parseFloat(document.getElementById('vocalGain').value) / 100;

  studioGainBeat = studioCtx.createGain();
  studioGainBeat.gain.value = parseFloat(document.getElementById('beatVolStudio').value) / 100;

  // â”€ Compresseur â”€
  studioCompressor = studioCtx.createDynamicsCompressor();
  studioCompressor.threshold.value = parseFloat(document.getElementById('compThreshold').value);
  studioCompressor.ratio.value = parseFloat(document.getElementById('compRatio').value);
  studioCompressor.attack.value = parseFloat(document.getElementById('compAttack').value) / 1000;
  studioCompressor.release.value = parseFloat(document.getElementById('compRelease').value) / 1000;
  studioCompressor.knee.value = 10;

  // â”€ EQ (BiquadFilters) sur la voix â”€
  const eqFreqs = { eq60: 60, eq250: 250, eq1k: 1000, eq4k: 4000, eq12k: 12000 };
  const eqTypes = { eq60: 'lowshelf', eq250: 'peaking', eq1k: 'peaking', eq4k: 'peaking', eq12k: 'highshelf' };
  let prevNode = studioGainVoice;
  studioEQNodes = {};
  for (const [id, freq] of Object.entries(eqFreqs)) {
    const filter = studioCtx.createBiquadFilter();
    filter.type = eqTypes[id];
    filter.frequency.value = freq;
    filter.Q.value = 1.4;
    filter.gain.value = parseFloat(document.getElementById(id).value);
    prevNode.connect(filter);
    studioEQNodes[id] = filter;
    prevNode = filter;
  }

  // â”€ Reverb (FeedbackDelay) â”€
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

  // â”€ Merger final â”€
  const merger = studioCtx.createGain();
  merger.gain.value = 1.0;
  studioDryGain.connect(studioCompressor);
  studioReverbGain.connect(studioCompressor);
  studioCompressor.connect(merger);
  studioGainBeat.connect(merger);
  merger.connect(studioCtx.destination);

  return merger;
}

// â”€â”€â”€ Play Mix TraitÃ© â”€â”€â”€
let studioBeatMediaSource = null; // MediaElementSource pour le beat

async function studioPlayMix() {
  if (!fsRecordings.length) { showToast(currentLang==='en'?'âš  Record a freestyle first!':'âš  Enregistre d\'abord un freestyle !'); return; }
  if (studioPlaying) { studioStopMix(); return; }

  setStudioStatus(currentLang==='en'?'LOADING...':'CHARGEMENT...', '#f59e0b');
  const btn = document.getElementById('studioPlayBtn');
  if (btn) btn.disabled = true;

  try {
    studioStopMix(true);
    studioVoiceBuffer = null;

    await buildStudioChain();
    if (!studioVoiceBuffer) throw new Error(currentLang==='en'?'Cannot decode voice audio':'Impossible de dÃ©coder la voix');

    // â”€ Source voix (BufferSource depuis blob local) â”€
    studioSourceVoice = studioCtx.createBufferSource();
    studioSourceVoice.buffer = studioVoiceBuffer;
    const pitchSemitones = parseFloat(document.getElementById('pitchShift').value);
    studioSourceVoice.playbackRate.value = Math.pow(2, pitchSemitones / 12);
    studioSourceVoice.connect(studioGainVoice);
    studioSourceVoice.onended = () => { if (studioPlaying) studioStopMix(); };

    // â”€ Source beat via MediaElementSource (Ã©vite le CORS) â”€
    const studioAudioSource = resolveBeatAudioSource(fsSelectedBeat);
    if (fsSelectedBeat && studioAudioSource && fsAudio.src) {
      try {
        // RÃ©utiliser ou crÃ©er le MediaElementSource
        if (!studioBeatMediaSource) {
          studioBeatMediaSource = studioCtx.createMediaElementSource(fsAudio);
        }
        studioBeatMediaSource.connect(studioGainBeat);
        fsAudio.currentTime = 0;
        fsAudio.loop = false;
      } catch(e) {
        // Si dÃ©jÃ  connectÃ© ou autre erreur, on joue le beat normalement en parallÃ¨le
        console.warn('MediaElementSource beat:', e.message);
        fsAudio.currentTime = 0;
        fsAudio.volume = parseFloat(document.getElementById('beatVolStudio').value) / 100;
        fsAudio.play().catch(() => {});
      }
    }

    const startAt = studioCtx.currentTime + 0.1;
    studioSourceVoice.start(startAt);
    // Lancer le beat en parallÃ¨le si MediaElementSource connectÃ©
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
    showToast((currentLang==='en'?'âŒ Studio error: ':'âŒ Erreur studio : ') + e.message);
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
  if (!silent) setStudioStatus(currentLang==='en'?'STOPPED':'ARRÃŠTÃ‰', '#94a3b8');
}

// â”€â”€â”€ Update EQ en temps rÃ©el â”€â”€â”€
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
  if (studioGainVoice) studioGainVoice.gain.value = parseFloat(document.getElementById('vocalGain').value) / 100;
}

function updateBeatVolStudio() {
  if (studioGainBeat) studioGainBeat.gain.value = parseFloat(document.getElementById('beatVolStudio').value) / 100;
}

// â”€â”€â”€ Presets â”€â”€â”€
const studioPresets = {
  clean: { eq60:0, eq250:0, eq1k:0, eq4k:0, eq12k:2, compThreshold:-18, compRatio:3, compAttack:30, compRelease:200, reverbSize:20, reverbWet:10, reverbDelay:15, pitchShift:0 },
  rap:   { eq60:4, eq250:-2, eq1k:2, eq4k:3, eq12k:4, compThreshold:-24, compRatio:6, compAttack:10, compRelease:150, reverbSize:15, reverbWet:8,  reverbDelay:10, pitchShift:0 },
  rnb:   { eq60:2, eq250:0,  eq1k:-1, eq4k:2, eq12k:5, compThreshold:-20, compRatio:4, compAttack:50, compRelease:300, reverbSize:50, reverbWet:30, reverbDelay:30, pitchShift:0 },
  trap:  { eq60:6, eq250:-3, eq1k:1,  eq4k:2, eq12k:3, compThreshold:-28, compRatio:8, compAttack:5,  compRelease:100, reverbSize:35, reverbWet:20, reverbDelay:20, pitchShift:-1 },
  afro:  { eq60:3, eq250:2,  eq1k:3,  eq4k:4, eq12k:5, compThreshold:-22, compRatio:4, compAttack:40, compRelease:250, reverbSize:30, reverbWet:15, reverbDelay:25, pitchShift:0 },
  raw:   { eq60:-2, eq250:3, eq1k:0,  eq4k:-2, eq12k:-3, compThreshold:-30, compRatio:2, compAttack:100, compRelease:500, reverbSize:60, reverbWet:40, reverbDelay:50, pitchShift:0 }
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// INITIALIZATION SCRIPT â€” DÃ©marrage du site
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

async function initializeApp() {
  console.log('Initializing Je Suis Beatz...');
  
  try {
    // 1. Attendre que Firebase soit initialisÃ©
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

    // 2.1. VÃ©rifier si l'utilisateur revient d'un lien de vÃ©rification email Firebase
    handleEmailVerificationReturn();

    // 2.2. Attendre que Firebase Auth termine la restauration de session
    try {
      await waitForAuthUser(1200);
    } catch (e) {
      // Pas de session active dans le timeout, continuer quand mÃªme.
    }
    
    // 3. Charger les beats depuis Firestore
    console.log('Loading beats from Firestore...');
    await loadBeatsFromFirestore();
    
    // 4. Initialiser les taux de change
    console.log('Initializing currency rates...');
    initCurrencyRateUpdater();
    
    // 5. Afficher la page demandÃ©e via hash ou route
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
    
    console.log('Je Suis Beatz initialized successfully! âœ“');
    
  } catch (error) {
    console.error('Error during initialization:', error);
    // Afficher un message d'erreur
    showToast('âš  Erreur d\'initialisation');
  }
}

// Lancer l'initialisation quand le DOM est prÃªt
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  // DOM est dÃ©jÃ  prÃªt
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
        ? 'âœ… Email verified! Redirecting...'
        : 'âœ… Email vÃ©rifiÃ© ! Redirection en cours...'
      );
      window.history.replaceState({}, document.title, window.location.pathname);
      showPage(nextPage);
    }).catch((error) => {
      console.warn('Email verification failed:', error);
      showToast(currentLang === 'en'
        ? 'âš  Verification failed. Please try again.'
        : 'âš  Ã‰chec de la vÃ©rification. RÃ©essayez.'
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

  if (purchasesEl) {
    purchasesEl.innerHTML = sortedOrders.length ? sortedOrders.map(order => {
      const createdAt = order.createdAt && order.createdAt.toDate ? order.createdAt.toDate() : new Date();
      const subtotal = Array.isArray(order.cartItems) ? order.cartItems.reduce((sum, item) => sum + Number(item.price || 0), 0) : Number(order.total || order.totalUSD || 0);
      const itemsHtml = Array.isArray(order.cartItems) ? order.cartItems.map(item => `
        <div class="account-subitem">
          <div class="account-subitem-title">${sanitize(item.title)} Â· ${sanitize(item.license || 'Licence')}</div>
          <div class="account-subitem-meta">${sanitize(item.price ? '$' + item.price : 'â€”')}</div>
        </div>`).join('') : '';
      return `
        <div class="account-card">
          <div class="account-item-row">
            <div>
              <div class="account-item-title">Commande ${sanitize(order.orderId || order.id)}</div>
              <div class="account-item-meta">${sanitize(createdAt.toLocaleDateString('fr-FR'))} Â· ${sanitize(order.paymentMethod || '')}</div>
            </div>
            <span class="account-badge">${sanitize(order.status || 'En attente')}</span>
          </div>
          ${itemsHtml}
          <div class="account-item-row" style="margin-top:12px;justify-content:flex-end;">
            <strong>Total : $${subtotal.toFixed(2)}</strong>
          </div>
        </div>`;
    }).join('') : emptyPlaceholder('Aucun achat trouvÃ© pour le moment.');
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
            <div class="account-item-meta">${sanitize(item.license || 'Licence')} Â· Commande ${sanitize(item.orderId)}</div>
          </div>
          <span class="account-badge">${sanitize(item.date.toLocaleDateString('fr-FR'))}</span>
        </div>
        <div class="account-item-meta">Prix : $${Number(item.price || 0).toFixed(2)}</div>
      </div>`).join('') : emptyPlaceholder('Aucune licence trouvÃ©e.');
  }

  if (favoritesEl) {
    favoritesEl.innerHTML = favoriteBeats.length ? favoriteBeats.map(beat => `
      <div class="account-card">
        <div class="account-item-row">
          <div>
            <div class="account-item-title">${sanitize(beat.title || beat.name || 'Beat')}</div>
            <div class="account-item-meta">${sanitize(beat.genre || 'Genre inconnu')}</div>
          </div>
          <span class="account-badge">Favori</span>
        </div>
      </div>`).join('') : emptyPlaceholder('Aucun favori enregistrÃ©. Ajoutez des beats aux favoris pour les retrouver ici.');
  }

  if (billingEl) {
    const totalSpent = licenseItems.reduce((sum, item) => sum + Number(item.price || 0), 0);
    const summaryHtml = totalSpent ? `
      <div class="account-card">
        <div class="account-item-title">DÃ©penses totales</div>
        <div class="account-item-meta">$${totalSpent.toFixed(2)}</div>
      </div>` : '';
    billingEl.innerHTML = summaryHtml + (sortedOrders.length ? sortedOrders.map(order => `
      <div class="account-card">
        <div class="account-item-row">
          <div>
            <div class="account-item-title">Commande ${sanitize(order.orderId || order.id)}</div>
            <div class="account-item-meta">${sanitize(order.paymentMethod || 'Paiement')}</div>
          </div>
          <span class="account-badge">${sanitize(order.status || 'pending')}</span>
        </div>
        <div class="account-item-meta">${sanitize(order.createdAt && order.createdAt.toDate ? order.createdAt.toDate().toLocaleDateString('fr-FR') : '')}</div>
      </div>`).join('') : emptyPlaceholder('Aucun historique de facturation disponible.'));
  }
}

async function saveAccountProfile() {
  if (!currentUser) return showToast('âš  Connectez-vous d\'abord.');
  const name = document.getElementById('accountName')?.value.trim() || '';
  const photoFile = document.getElementById('accountPhotoFile')?.files?.[0] || null;
  const msgEl = document.getElementById('accountSettingsMsg');
  if (!name) {
    if (msgEl) msgEl.textContent = 'Veuillez saisir un nom.';
    return;
  }
  let photoURL = currentUser.photoURL || '';
  try {
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
    if (msgEl) msgEl.textContent = 'Profil enregistrÃ©.';
    showToast('âœ“ Profil mis Ã  jour.');
  } catch (e) {
    console.warn('saveAccountProfile failed', e);
    if (msgEl) msgEl.textContent = 'Erreur lors de la sauvegarde du profil.';
  }
}

function onAccountPhotoSelected(input) {
  const file = input.files?.[0];
  if (!file) return;
  const allowed = /^(image\/jpeg|image\/png|image\/webp|image\/gif)$/i;
  if (!allowed.test(file.type)) {
    showToast('âš  Format de photo invalide. Utilisez JPG, PNG, WEBP ou GIF.');
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
  if (!currentUser) return showToast('âš  Connectez-vous d\'abord.');
  const currentPwd = document.getElementById('accountCurrentPwd')?.value || '';
  const newPwd = document.getElementById('accountNewPwd')?.value || '';
  const msgEl = document.getElementById('accountSettingsMsg');
  if (newPwd.length < 8) {
    if (msgEl) msgEl.textContent = 'Le nouveau mot de passe doit contenir au moins 8 caractÃ¨res.';
    return;
  }
  try {
    const user = auth.currentUser;
    if (!user) throw new Error('Utilisateur non connectÃ©');
    const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPwd);
    await user.reauthenticateWithCredential(credential);
    await user.updatePassword(newPwd);
    if (msgEl) msgEl.textContent = 'Mot de passe mis Ã  jour.';
    document.getElementById('accountCurrentPwd').value = '';
    document.getElementById('accountNewPwd').value = '';
    showToast('âœ“ Mot de passe mis Ã  jour.');
  } catch (e) {
    console.warn('updateAccountPassword failed', e);
    if (msgEl) msgEl.textContent = e.code === 'auth/wrong-password' ? 'Mot de passe actuel incorrect.' : 'Impossible de mettre Ã  jour le mot de passe.';
  }
}

function applyPreset(name) {
  const p = studioPresets[name];
  if (!p) return;
  // EQ
  ['eq60','eq250','eq1k','eq4k','eq12k'].forEach(id => {
    document.getElementById(id).value = p[id];
  });
  updateEQ();
  // Compressor
  document.getElementById('compThreshold').value = p.compThreshold; document.getElementById('compThreshVal').textContent = p.compThreshold + 'dB';
  document.getElementById('compRatio').value = p.compRatio; document.getElementById('compRatioVal').textContent = p.compRatio + ':1';
  document.getElementById('compAttack').value = p.compAttack; document.getElementById('compAttackVal').textContent = p.compAttack + 'ms';
  document.getElementById('compRelease').value = p.compRelease; document.getElementById('compReleaseVal').textContent = p.compRelease + 'ms';
  // Reverb
  document.getElementById('reverbSize').value = p.reverbSize; document.getElementById('reverbSizeVal').textContent = p.reverbSize + '%';
  document.getElementById('reverbWet').value = p.reverbWet; document.getElementById('reverbWetVal').textContent = p.reverbWet + '%';
  document.getElementById('reverbDelay').value = p.reverbDelay; document.getElementById('reverbDelayVal').textContent = p.reverbDelay + 'ms';
  // Pitch
  document.getElementById('pitchShift').value = p.pitchShift; document.getElementById('pitchVal').textContent = (p.pitchShift > 0 ? '+' : '') + p.pitchShift + ' st';
  updateCompressor();
  document.querySelectorAll('.studio-preset-btn').forEach(b => b.classList.remove('active'));
  event && event.target && event.target.classList.add('active');
  showToast((currentLang==='en'?'âœ“ Preset ':'âœ“ Preset ') + name.toUpperCase() + (currentLang==='en'?' applied!':' appliquÃ© !'));
}

// â”€â”€â”€ Export Studio Haute QualitÃ© â”€â”€â”€
async function exportStudio() {
  if (!fsRecordings.length) { showToast(currentLang==='en'?'âš  No recording to export!':'âš  Aucun enregistrement Ã  exporter !'); return; }
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
    { txt: isEn?'Decoding vocal recording...':'DÃ©codage de l\'enregistrement vocal...', pct: 25 },
    { txt: isEn?'Applying EQ and compressor...':'Application de l\'EQ et du compresseur...', pct: 45 },
    { txt: isEn?'Processing reverb...':'Traitement de la rÃ©verbÃ©ration...', pct: 60 },
    { txt: isEn?'Rendering final mix...':'Rendu du mix final...', pct: 80 },
    { txt: isEn?'Encoding in high quality...':'Encodage en haute qualitÃ©...', pct: 95 },
  ];

  try {
    for (const step of steps) {
      statusTxt.textContent = step.txt;
      progressBar.style.width = step.pct + '%';
      await new Promise(r => setTimeout(r, 350));
    }

    if (format === 'voice-only') {
      // Export voix seule (dÃ©jÃ  en WebM)
      const a = document.createElement('a');
      a.href = fsRecordings[0].url;
      a.download = `freestyle_${fsRecordings[0].beatTitle || 'mix'}_voix.webm`;
      a.click();
      statusTxt.textContent = currentLang==='en'?'Voice export done!':'Export voix terminÃ© !';
      progressBar.style.width = '100%';
      showToast(currentLang==='en'?'âœ… Voice exported successfully!':'âœ… Voix exportÃ©e avec succÃ¨s !');
    } else if (format === 'wav-mix' || format === 'webm') {
      // Offline rendering pour exporter le mix traitÃ©
      await exportOfflineRender(format, quality);
    }

    setStudioStatus(currentLang==='en'?'EXPORTED âœ“':'EXPORT OK âœ“', '#4ade80');
    setTimeout(() => { progressEl.style.display = 'none'; setStudioStatus(currentLang==='en'?'READY':'PRÃŠT', '#4ade80'); }, 3000);

  } catch(e) {
    console.error('Export error:', e);
    showToast((currentLang==='en'?'âŒ Export error: ':'âŒ Erreur export : ') + e.message);
    setStudioStatus(currentLang==='en'?'ERROR':'ERREUR', '#ef4444');
    progressEl.style.display = 'none';
  }
}

async function exportOfflineRender(format, quality) {
  const statusTxt = document.getElementById('exportStatusTxt');
  const progressBar = document.getElementById('exportProgressBar');

  // DÃ©coder la voix depuis le Blob en mÃ©moire (le plus fiable, zÃ©ro CORS)
  const voiceBuf = await new Promise((resolve, reject) => {
    const tmpCtx = new (window.AudioContext || window.webkitAudioContext)();
    const rec = fsRecordings[0];

    const decodeArrayBuf = (arrayBuf) => {
      tmpCtx.decodeAudioData(arrayBuf.slice(0), buf => { tmpCtx.close(); resolve(buf); }, err => reject(new Error(currentLang==='en'?'Voice decode failed':'DÃ©codage voix Ã©chouÃ©')));
    };

    if (rec.blob instanceof Blob) {
      // Utiliser le Blob directement (toujours disponible en mÃ©moire)
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
  gainVoice.gain.value = parseFloat(document.getElementById('vocalGain').value) / 100;

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
    f.gain.value = parseFloat(document.getElementById(eq.id).value);
    chain.connect(f); chain = f;
  }

  // Compressor
  const comp = offlineCtx.createDynamicsCompressor();
  comp.threshold.value = parseFloat(document.getElementById('compThreshold').value);
  comp.ratio.value = parseFloat(document.getElementById('compRatio').value);
  comp.attack.value = parseFloat(document.getElementById('compAttack').value) / 1000;
  comp.release.value = parseFloat(document.getElementById('compRelease').value) / 1000;
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
      gainBeat2.gain.value = parseFloat(document.getElementById('beatVolStudio').value) / 100;
      beatSource.connect(gainBeat2);
      gainBeat2.connect(offlineCtx.destination);
      beatSource.start(0);
    } catch(e) {
      console.warn('Beat non inclus dans export (CORS Firebase) :', e.message);
      showToast(currentLang==='en'?'â„¹ï¸ Processed voice exported (beat excluded, CORS blocked)':'â„¹ï¸ Voix traitÃ©e exportÃ©e (beat non inclus, bloquÃ© par CORS)');
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

  statusTxt.textContent = currentLang==='en'?'âœ“ WAV export done!':'âœ“ Export WAV terminÃ© !';
  progressBar.style.width = '100%';
  showToast(currentLang==='en'?'ðŸŽµ High quality export done!':'ðŸŽµ Export haute qualitÃ© terminÃ© !');
}

// â”€â”€â”€ Convertir AudioBuffer en WAV â”€â”€â”€
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

// â”€â”€â”€ Re-draw waveform when new recording added â”€â”€â”€
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
