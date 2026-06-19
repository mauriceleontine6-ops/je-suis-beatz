// Firebase est déjà initialisé dans index.html

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
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data: data || {} }),
    });
    const json = await resp.json();
    if (json.error) {
      const err = new Error(json.error.message || json.error.status || 'Erreur serveur');
      err.code = json.error.status;
      throw err;
    }
    return { data: json.result };
  }
}

const OWNER_ADMIN_EMAIL = 'jesuisthebeatmaker@gmail.com';

function isOwnerEmail(email) {
  return (email || '').toLowerCase() === OWNER_ADMIN_EMAIL;
}
const GENIUSPAY_CONFIG = {
  baseURL: 'https://geniuspay.ci',
  publicKey: 'pk_sandbox_G12CBSd9zEwAJQjUALoiVY8dBAkvskfE',
  apiKey: 'pk_sandbox_G12CBSd9zEwAJQjUALoiVY8dBAkvskfE',
  environment: 'sandbox',
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

// Premier beat du catalogue — seed Firestore une seule fois si la collection est vide.
// Ensuite, l'admin ajoute / gère les beats via le panneau Admin.
const INITIAL_CATALOG_BEATS = [{
  title: 'GHOST',
  bpm: 142,
  genre: 'Drill',
  subgenre: 'Afro',
  priceBasic: 25,
  pricePremium: 50,
  priceWav: 100,
  priceExclusive: 300,
  cover: 'image_beat_Ghost.jpeg',
  audio: 'Ghost.mpeg',
  status: 'available',
  desc_fr: 'Un beat Drill/Afro sombre et hypnotique, parfait pour les punchlines et le storytelling cinématique.',
  desc_en: 'A dark and hypnotic Drill/Afro beat, perfect for punchlines and cinematic storytelling.',
}];

function normalizeBeatAsset(path) {
  if (!path || typeof path !== 'string') return '';
  if (/^https?:\/\//i.test(path)) return path;
  return path.replace(/^\.\//, '');
}

function normalizeBeatRecord(beat) {
  const b = { ...beat };
  if (b.audio) b.audio = normalizeBeatAsset(b.audio);
  if (b.cover) b.cover = normalizeBeatAsset(b.cover);
  if (!b.priceBasic && b.priceBasic !== 0) b.priceBasic = 25;
  if (!b.pricePremium && b.pricePremium !== 0) b.pricePremium = 50;
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
        priceExclusive: merged[idx].priceExclusive ?? seed.priceExclusive,
        status: merged[idx].status || seed.status,
      });
    }
  }
  return merged;
}

let beats = mergeInitialCatalogBeats([]);
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
if (currentUser) currentUser.role = 'user';
// ⚠️ Le mot de passe admin n'est PLUS stocké en localStorage.
// L'admin se connecte uniquement via Firebase Auth + custom claim "admin:true".
// Pour définir le claim admin, utilise Firebase Admin SDK côté serveur (Cloud Function).
let currentFilter = 'Tous';
let audioEl = new Audio();
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

// Charger les beats depuis Firestore (catalogue réel uniquement)
async function loadBeatsFromFirestore() {
  try {
    const snap = await db.collection('beats').get();
    beats = snap.docs.map(d => normalizeBeatRecord({ id: d.id, ...d.data() }))
      .filter(b => !isTrapBeat(b));
    beats.sort((a, b) => {
      const ta = a.createdAt?.seconds ?? a.createdAt?._seconds ?? 0;
      const tb = b.createdAt?.seconds ?? b.createdAt?._seconds ?? 0;
      return tb - ta;
    });
  } catch (e) {
    console.warn('Firestore beats indisponible, catalogue local utilisé', e);
    beats = mergeInitialCatalogBeats([]);
  }
  renderAll();
  const statEl = document.getElementById('statBeats');
  if (statEl) statEl.textContent = beats.length;
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
    callCloudFunction('ensureAdminClaim').catch(() => {});
    return true;
  }

  try {
    const adminDoc = await db.collection('admins').doc(user.uid).get();
    if (adminDoc.exists && adminDoc.data().isAdmin === true) return true;
  } catch (e) { /* ignore */ }

  try {
    const result = await callCloudFunction('ensureAdminClaim');
    if (result.data?.isAdmin) return true;
  } catch (e) {
    console.warn('ensureAdminClaim:', e.message);
  }

  showToast('⚠ ' + (currentLang === 'en' ? 'Admin access denied' : 'Accès admin refusé'));
  return false;
}

// Sauvegarder un beat (ajout ou mise à jour)
async function saveBeatToFirestore(beatData, docId) {
  if (!(await ensureAdminAuth())) return null;
  const payload = normalizeBeatRecord({ ...beatData });
  delete payload.id;
  try {
    if (docId && !String(docId).startsWith('catalog-')) {
      await db.collection('beats').doc(String(docId)).set(payload, { merge: true });
      return String(docId);
    }
    const ref = await db.collection('beats').add({
      ...payload,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
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
      await db.collection('beats').doc(String(docId)).delete();
      deleted += 1;
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
async function loadProfiles() {
  try {
    const snap = await db.collection('profiles').get();
    return snap.docs.map(d => ({uid: d.id, ...d.data()}));
  } catch(e) { return []; }
}
async function saveProfileToFirestore(uid, data) {
  try { await db.collection('profiles').doc(uid).set(data, {merge:true}); }
  catch(e) { console.error('Erreur save profil', e); showToast('⚠ Erreur de sauvegarde du profil'); }
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
  // Charger les données depuis Firestore
  await loadBeatsFromFirestore();
  await purgeTrapBeatsIfAdmin();
  if (trapBeatsPurged) { await loadBeatsFromFirestore(); renderAll(); }
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
  const adminActive = document.getElementById('page-admin')?.classList.contains('active');
  if (!adminActive) {
    renderBeatsGrid();
    renderFeatured();
  }
  if (adminActive) {
    renderAdminTables();
  }
  renderStats();
  const statBeatsEl = document.getElementById('statBeats');
  if (statBeatsEl) statBeatsEl.textContent = beats.length;
  // Freestyle & Community — only render if elements exist on page
  if (!adminActive) {
    if (document.getElementById('fsBeatList')) renderFsBeatList();
    if (document.getElementById('recordingsList')) renderRecordingsList();
  }
  // Ensure mobile/touch elements in freestyle page trigger click handlers
  if (typeof bindFsTouchHandlers === 'function') bindFsTouchHandlers();
}
 
function renderBeatsGrid() {
  const filtered = currentFilter === 'Tous'
    ? beats
    : beats.filter(b => b.genre === currentFilter || b.subgenre === currentFilter);
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
  const streams = b.streams || 0;
  const earnings = ((streams * 0.004)).toFixed(2); // $0.004 per stream (Spotify-like rate)
  const streamsLabel = streams >= 1000 ? (streams/1000).toFixed(1)+'K' : streams;
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
      <!-- Streaming Stats Bar -->
      <div class="beat-stream-bar" id="stream-bar-${b.id}">
        <div class="stream-stat">
          <i class="fas fa-headphones"></i>
          <span class="stream-count" id="stream-count-${b.id}">${streamsLabel}</span>
          <span class="stream-lbl">${currentLang==='en'?'streams':'écoutes'}</span>
        </div>
        <div class="stream-divider"></div>
        <div class="stream-stat">
          <i class="fas fa-coins" style="color:#D4AF37"></i>
          <span class="stream-earn" id="stream-earn-${b.id}">$${earnings}</span>
          <span class="stream-lbl">${currentLang==='en'?'earned':'générés'}</span>
        </div>
        <div class="stream-progress-wrap">
          <div class="stream-progress-fill" id="stream-prog-${b.id}" style="width:${Math.min(100,(streams/10000)*100)}%"></div>
        </div>
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
    priceExclusive: parseInt(document.getElementById('nPe').value) || 300,
    cover: coverUrl || DEFAULT_BEAT_COVER,
    audio: audioUrl || '',
    status: document.getElementById('nStatus').value,
    desc: document.getElementById('nDesc').value,
    desc_fr: document.getElementById('nDesc').value,
    desc_en: document.getElementById('nDescEn').value || document.getElementById('nDesc').value,
  };
  const iconVal = document.getElementById('nIcon')?.value.trim();
  if (iconVal) b.icon = sanitizeIconClass(iconVal);
  const newId = await saveBeatToFirestore(b);
  if (!newId) {
    if (btn) { btn.disabled = false; btn.innerHTML = origBtnHtml; }
    return;
  }
  b.id = newId;
  beats.unshift(b);
  renderAll();
  ['nTitle','nBpm','nSub','nCover','nIcon','nAudio','nDesc','nDescEn','nPb','nPp','nPw','nPe'].forEach(id => document.getElementById(id) && (document.getElementById(id).value = ''));
  resetBeatUploadForm();
  if (btn) { btn.disabled = false; btn.innerHTML = origBtnHtml; }
  showToast('✓ ' + t('dyn_beat_added').replace('%s', b.title));
  adminPanel('manage');
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

function openEdit(id) {
  const b = beats.find(x => String(x.id) === String(id));
  if (!b) return;
  document.getElementById('eId').value = String(id);
  document.getElementById('eTitle').value = b.title;
  document.getElementById('eBpm').value = b.bpm;
  document.getElementById('eGenre').value = b.genre;
  document.getElementById('ePb').value = b.priceBasic;
  document.getElementById('ePp').value = b.pricePremium;
  document.getElementById('ePw').value = b.priceWav || 100;
  document.getElementById('ePe').value = b.priceExclusive || 300;
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
    priceExclusive: parseInt(document.getElementById('ePe').value, 10) || 300,
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
    const safeId = JSON.stringify(String(b.id));
    return `<tr>
      <td><strong>${b.title}</strong></td><td>${b.genre}</td><td>${b.bpm}</td><td>$${b.priceBasic}</td>
      <td style="color:${b.status==='sold'?'#fff':'var(--cyan)'}"><i class="fas fa-circle" style="font-size:.5rem;margin-right:6px"></i>${b.status==='sold'?t('dyn_sold_label'):t('dyn_available_label')}</td>
      <td><div style="display:flex;gap:8px">
        <button class="tbl-edit" onclick="openEdit(${safeId})"><i class="fas fa-pen"></i></button>
        <button class="tbl-del" onclick="deleteBeat(${safeId})"><i class="fas fa-trash"></i></button>
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
 
function renderStats() {
  const el = document.getElementById('statsG');
  if (!el) return;
  const totalStreams  = beats.reduce((s,b) => s + (b.streams||0), 0);
  const totalEarnings = (totalStreams * STREAM_RATE).toFixed(2);

  const baseCards = `
    <div class="stat-g-card"><div class="stat-g-num">${beats.length}</div><div class="stat-g-lbl"><i class="fas fa-music"></i> Beats</div></div>
    <div class="stat-g-card"><div class="stat-g-num">${beats.filter(b=>b.status!=='sold').length}</div><div class="stat-g-lbl"><i class="fas fa-check"></i> ${t('admin_stat_available')}</div></div>
    <div class="stat-g-card"><div class="stat-g-num">${beats.filter(b=>b.status==='sold').length}</div><div class="stat-g-lbl"><i class="fas fa-lock"></i> ${t('admin_stat_sold')}</div></div>
    <div class="stat-g-card" style="border-color:rgba(0,229,255,0.3)"><div class="stat-g-num" style="color:var(--cyan)">${totalStreams >= 1000 ? (totalStreams/1000).toFixed(1)+'K' : totalStreams}</div><div class="stat-g-lbl"><i class="fas fa-headphones" style="color:var(--cyan)"></i> Streams</div></div>
    <div class="stat-g-card" style="border-color:rgba(212,175,55,0.3)"><div class="stat-g-num" style="color:#D4AF37">$${totalEarnings}</div><div class="stat-g-lbl"><i class="fas fa-coins" style="color:#D4AF37"></i> ${currentLang==='en'?'Earned':'Générés'}</div></div>`;

  if (currentUser?.role === 'admin') {
    el.innerHTML = `
      <div class="stat-g-card"><div class="stat-g-num" id="adminUserCount">…</div><div class="stat-g-lbl"><i class="fas fa-users"></i> ${t('admin_stat_users')}</div></div>
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

  // Show loading state immediately
  tbl.innerHTML = `<tbody><tr><td colspan="3" style="text-align:center;color:var(--cyan);padding:20px">⏳ ${currentLang==='en'?'Loading...':'Chargement...'}</td></tr></tbody>`;

  try {
    const fn = cloudFunctions().httpsCallable('getAdminUserStats');
    const result = await fn();
    const { count, users, partial } = result.data || {};
    const countEl = document.getElementById('adminUserCount');
    if (countEl) countEl.textContent = count ?? '—';
    if (note) {
      note.textContent = currentLang === 'en'
        ? 'Latest registered users are shown here. Total count may be larger.'
        : 'Les derniers utilisateurs inscrits sont affichés ici. Le nombre total peut être plus important.';
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
    tbl.innerHTML = `<tbody><tr><td colspan="3" style="text-align:center;color:#ff6b6b;padding:20px">${currentLang==='en'?'Error loading users':'Erreur de chargement'}</td></tr></tbody>`;
    console.warn('getAdminUserStats failed:', e);
  }
}
 
// ═══ AUDIO ═══
// ═══ STREAMING SYSTEM ═══
const STREAM_RATE = 0.004;        // $0.004 par stream (taux Spotify-like)
const STREAM_THRESHOLD = 30;      // 30 secondes = 1 écoute comptabilisée
let streamTimer = null;
let streamCounted = false;
let streamSeconds = 0;
let lastStreamTime = null;

// ✅ SÉCURITÉ : Map de rate-limiting côté client (1 stream/beat/30min max)
// Note : la vraie protection doit être dans les Firestore Security Rules (voir firestore.rules)
const _streamRateMap = new Map();

function _canRegisterStream(beatId) {
  const key = String(beatId);
  const now = Date.now();
  const last = _streamRateMap.get(key) || 0;
  const cooldown = 30 * 60 * 1000; // 30 minutes entre 2 streams du même beat
  if (now - last < cooldown) return false;
  _streamRateMap.set(key, now);
  return true;
}

function startStreamTracking(beatId) {
  stopStreamTracking();
  streamCounted = false;
  streamSeconds = 0;
  lastStreamTime = Date.now();
  streamTimer = setInterval(() => {
    if (!isPlaying) return;
    streamSeconds++;
    if (!streamCounted && streamSeconds >= STREAM_THRESHOLD) {
      streamCounted = true;
      _doRegisterStream(beatId); // fonction interne non exposée globalement
    }
  }, 1000);
}

function stopStreamTracking() {
  if (streamTimer) { clearInterval(streamTimer); streamTimer = null; }
}

// ✅ SÉCURITÉ : Renommée en _doRegisterStream (préfixe _ = privée par convention)
// Appelle la Cloud Function côté serveur (rate-limiting réel) avec fallback Firestore direct
async function _doRegisterStream(beatId) {
  if (!_canRegisterStream(beatId)) {
    console.info('[Stream] Rate limit client atteint pour ce beat.');
    return;
  }
  const b = beats.find(x => String(x.id) === String(beatId));
  if (!b) return;
  b.streams = (b.streams || 0) + 1;
  _updateStreamUI(b);
  try {
    // ✅ Appel Cloud Function (rate-limiting serveur réel)
    const registerStreamFn = cloudFunctions().httpsCallable('registerStream');
    const result = await registerStreamFn({ beatId: String(beatId) });
    if (result.data?.counted === false) {
      console.info('[Stream] Rate limit serveur:', result.data.reason);
    }
  } catch(e) {
    // Fallback : écriture directe Firestore (protégée par les Security Rules)
    console.warn('[Stream] Cloud Function indisponible, fallback Firestore:', e.message);
    try {
      await db.collection('beats').doc(String(beatId)).update({
        streams: firebase.firestore.FieldValue.increment(1)
      });
    } catch(e2) {
      console.warn('Stream Firestore fallback failed:', e2);
    }
  }
}

function _updateStreamUI(b) {
  const streams = b.streams || 0;
  const earnings = (streams * STREAM_RATE).toFixed(2);
  const streamsLabel = streams >= 1000 ? (streams/1000).toFixed(1)+'K' : streams;
  const countEl = document.getElementById('stream-count-'+b.id);
  const earnEl  = document.getElementById('stream-earn-'+b.id);
  const progEl  = document.getElementById('stream-prog-'+b.id);
  if (countEl) {
    countEl.textContent = streamsLabel;
    countEl.classList.add('stream-pulse');
    setTimeout(() => countEl.classList.remove('stream-pulse'), 800);
  }
  if (earnEl) {
    earnEl.textContent = '$'+earnings;
    earnEl.classList.add('stream-pulse');
    setTimeout(() => earnEl.classList.remove('stream-pulse'), 800);
  }
  if (progEl) progEl.style.width = Math.min(100,(streams/10000)*100)+'%';
  showToast(currentLang==='en'
    ? `🎵 +1 stream on "${sanitize(b.title)}" · $${earnings} total earned`
    : `🎵 +1 écoute sur "${sanitize(b.title)}" · $${earnings} générés au total`);
}

function playBeat(idx) {
  const b = beats[idx];
  if (!b || !b.audio) { showToast(t('dyn_no_audio')); return; }
  if (currentIdx === idx && isPlaying) { togglePlay(); return; }
  currentIdx = idx;
  audioEl.src = b.audio;
  audioEl.preload = 'auto';
  audioEl.volume = 0.8;
  audioEl.load();
  audioEl.play().catch(() => showToast('⚠ Impossible de lire le fichier audio'));
  isPlaying = true;
  document.getElementById('playBtn').innerHTML = '<i class="fas fa-pause"></i>';
  document.getElementById('audioTitle').textContent = b.title;
  const thumb = document.getElementById('audioThumb');
  thumb.src = b.cover || 'image_beat.jpeg';
  thumb.onerror = () => thumb.src = 'image_beat.jpeg';
  document.getElementById('beatIcon').innerHTML = b.icon ? `<i class="${sanitizeIconClass(b.icon)}"></i>` : `<img src="${b.cover || DEFAULT_BEAT_COVER}" alt="beat icon" class="beat-default-icon"/>`;
  document.getElementById('audioBar').classList.add('show');
  // Démarrer le tracking du stream
  startStreamTracking(b.id);
}
 
function togglePlay() {
  if (!audioEl.src) return;
  if (isPlaying) {
    audioEl.pause();
    document.getElementById('playBtn').innerHTML = '<i class="fas fa-play"></i>';
    stopStreamTracking();
  } else {
    audioEl.play();
    document.getElementById('playBtn').innerHTML = '<i class="fas fa-pause"></i>';
    if (currentIdx >= 0) startStreamTracking(beats[currentIdx].id);
  }
  isPlaying = !isPlaying;
}
function prevTrack() { if (currentIdx > 0) playBeat(currentIdx-1); }
function nextTrack() { if (currentIdx < beats.length-1) playBeat(currentIdx+1); }
function closePlayer() { audioEl.pause(); isPlaying=false; stopStreamTracking(); document.getElementById('audioBar').classList.remove('show'); }
function setVol(v) { audioEl.volume = v/100; }
function seekAudio(e) { const r = e.offsetX/e.currentTarget.offsetWidth; if (audioEl.duration) audioEl.currentTime = r*audioEl.duration; }
function fmt(s) { if (isNaN(s)) return '0:00'; const m=Math.floor(s/60),sc=Math.floor(s%60); return m+':'+(sc<10?'0':'')+sc; }
 
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
function addToCart(idx) {
  const b = beats[idx];
  if (!b || b.status === 'sold') return;
  if (cart.find(c => String(c.id) === String(b.id))) { showToast(t('dyn_already_cart')); return; }
 
  const isEn = currentLang === 'en';
 
  // Build currency display for each license
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
      key: 'Exclusif',
      price: b.priceExclusive || 300,
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
          <button onclick="document.querySelectorAll('.cur-btn').forEach(x=>x.classList.remove('active'));this.classList.add('active');document.getElementById('licCardsWrap').innerHTML=renderLicCards('${code}')" class="cur-btn${code==='USD'?' active':''}" data-code="${code}" style="font-family:var(--font-mono);font-size:0.65rem;padding:5px 12px;border-radius:20px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:#fff;cursor:pointer;transition:all 0.2s" onmouseover="this.style.borderColor='var(--cyan)'" onmouseout="if(!this.classList.contains('active'))this.style.borderColor='rgba(255,255,255,0.15)'">${info.symbol} ${code}</button>`).join('')}
      </div>
 
      <div id="licCardsWrap">${renderLicCards('USD')}</div>
 
      <div style="font-family:var(--font-mono);font-size:0.58rem;color:var(--text-dim);text-align:center;margin-top:6px"><i class="fas fa-info-circle" style="color:var(--cyan)"></i> ${isEn ? 'Prices in USD · 1 USD = ' + CURRENCY_RATES.XOF.rate + ' FCFA' : 'Prix en USD · 1 USD = ' + CURRENCY_RATES.XOF.rate.toLocaleString('fr-FR') + ' FCFA'}</div>
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
        ${currency !== 'USD' ? `<div style="font-family:var(--font-mono);font-size:0.52rem;color:var(--text-dim);margin-top:8px"><i class="fas fa-info-circle" style="color:var(--cyan)"></i> ${isEn ? '1 USD = ' + CURRENCY_RATES.XOF.rate + ' FCFA · GeniusPay charged in XOF' : '1 USD = ' + CURRENCY_RATES.XOF.rate.toLocaleString('fr-FR') + ' FCFA · Paiement GeniusPay en XOF'}</div>` : `<div style="font-family:var(--font-mono);font-size:0.52rem;color:var(--text-dim);margin-top:8px"><i class="fas fa-info-circle" style="color:var(--cyan)"></i> ${isEn ? 'GeniusPay checkout: ' + formatUsdAsCurrency(total, 'XOF') : 'Paiement GeniusPay : ' + formatUsdAsCurrency(total, 'XOF')}</div>`}
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
    if (adminDoc.exists && adminDoc.data().isAdmin === true) return true;
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
        await new Promise(r => setTimeout(r, 600));
        err.textContent = t('err_wrong_creds');
        err.style.display = 'block';
        return;
      }
    }

    const cred = await auth.signInWithEmailAndPassword(email, p);
    const uid = cred.user.uid;
    const ownerAccount = isOwnerEmail(cred.user.email || email);
    currentUser = {
      username: sanitize(u),
      email: cred.user.email || email,
      role: ownerAccount ? 'admin' : 'user',
      uid
    };
    sessionStorage.setItem('jsb_user2', JSON.stringify(currentUser));
    updateAuth();
    showPage(currentUser.role === 'admin' ? 'admin' : 'home');
    showToast(t('dyn_login_welcome').replace('%s', sanitize(currentUser.username)));

    // Defer non-critical operations to avoid blocking redirect
    setTimeout(() => {
      Promise.allSettled([
        syncAdminRole(cred.user).then((isAdmin) => {
          if (isAdmin && currentUser) {
            currentUser.role = 'admin';
            sessionStorage.setItem('jsb_user2', JSON.stringify(currentUser));
            updateAuth();
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
    }, 0);
  } catch(ex) {
    await new Promise(r => setTimeout(r, 600)); // anti-brute force timing
    err.textContent = t('err_wrong_creds');
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
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('users').doc(uid).set(userData);

    currentUser = { username: sanitize(u), email: sanitize(e), role: 'user', uid };
    sessionStorage.setItem('jsb_user2', JSON.stringify(currentUser));
    updateAuth();
    showPage('home');
    showToast(t('dyn_account_created').replace('%s', sanitize(u)));
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
}

// ✅ SÉCURITÉ : À l'init, on revalide le token Firebase si l'user est déjà connecté
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
  if (name === 'admin' && (!currentUser || currentUser.role !== 'admin')) {
    showPage('login');
    return;
  }
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-links a').forEach(a=>a.classList.remove('active'));
  const pg=document.getElementById('page-'+name);
  if(pg) pg.classList.add('active');
  const nav=document.getElementById('nav-'+name);
  if(nav) nav.classList.add('active');
  window.scrollTo(0,0);
  if (name === 'admin') {
    // Load admin settings asynchronously (non-blocking)
    loadAdminSettings();
    if (!adminPageInitialized) {
      adminPageInitialized = true;
      // Defer heavy operations to avoid blocking page render
      setTimeout(() => {
        purgeTrapBeatsIfAdmin()
          .catch(e => console.warn('purgeTrapBeatsIfAdmin failed:', e))
          .finally(() => loadBeatsFromFirestore().catch(e => console.warn('loadBeatsFromFirestore admin init:', e)));
        renderAdminUsers();
      }, 100);
    }
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
 
 
// ═══ FREESTYLE ═══
let fsAudio = new Audio();
fsAudio.setAttribute('playsinline', '');
fsAudio.setAttribute('webkit-playsinline', '');
fsAudio.preload = 'auto';
let fsPlaying = false;
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
  fsAudio.src = fsSelectedBeat.audio || '';
  fsAudio.loop = true;
  fsAudio.preload = 'auto';
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
  if (!beat || !beat.audio) return;
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
    const beatUrl = new URL(beat.audio, window.location.href).href;
    await studioInstance.loadBeatFromURL(beatUrl, beatInfo);
    console.log('✅ Studio loaded beat from freestyle selector:', beatInfo.name, beatUrl);
    window.pendingStudioBeat = null;
  } catch (error) {
    console.warn('Studio beat load failed:', error);
  }
};
 
async function toggleFsBeat() {
  if (!fsSelectedBeat || !fsSelectedBeat.audio) { showToast(t('dyn_no_beat_audio')); return; }
  if (fsPlaying) {
    fsAudio.pause(); fsPlaying = false;
    document.getElementById('fsBeatPlayBtn').innerHTML = `<i class='fas fa-play'></i> ${t('fs_play_beat')}`;
  } else {
    try {
      await ensureFsBeatPlayback();
      fsPlaying = true;
      document.getElementById('fsBeatPlayBtn').innerHTML = `<i class='fas fa-pause'></i> ${t('dyn_pause_beat')}`;
    } catch (e) {
      showToast('⚠ ' + (t('dyn_play_error') || 'Lecture impossible'));
    }
  }
}
 
async function ensureFsBeatPlayback() {
  if (!fsSelectedBeat || !fsSelectedBeat.audio) return;
  fsAudio.src = fsSelectedBeat.audio;
  fsAudio.loop = true;
  fsAudio.currentTime = 0;
  fsAudio.muted = false;
  fsAudio.volume = 0.85;
  try {
    const playPromise = fsAudio.play();
    if (playPromise && typeof playPromise.then === 'function') {
      await playPromise;
    }
    if (fsAudio.paused) {
      await new Promise((resolve, reject) => {
        let timer = null;
        const onPlaying = () => { cleanup(); resolve(); };
        const onError = (ev) => { cleanup(); reject(ev.error || new Error('Beat playback failed')); };
        const cleanup = () => {
          fsAudio.removeEventListener('playing', onPlaying);
          fsAudio.removeEventListener('error', onError);
          if (timer) clearTimeout(timer);
        };
        fsAudio.addEventListener('playing', onPlaying);
        fsAudio.addEventListener('error', onError);
        timer = setTimeout(() => {
          cleanup();
          if (!fsAudio.paused) resolve();
          else reject(new Error('Beat playback timeout'));
        }, 1200);
      });
    }
  } catch (err) {
    console.warn('ensureFsBeatPlayback error', err);
    throw err;
  }
}
 
function stopFsBeat() {
  fsAudio.pause(); fsAudio.currentTime = 0; fsPlaying = false;
  const btn = document.getElementById('fsBeatPlayBtn');
  if (btn) btn.innerHTML = `<i class='fas fa-play'></i> ${t('fs_play_beat')}`;
}
 
fsAudio.addEventListener('timeupdate', () => {
  if (!fsAudio.duration) return;
  const p = (fsAudio.currentTime/fsAudio.duration)*100;
  const pf = document.getElementById('fsProgFill');
  if (pf) pf.style.width = p+'%';
  const ct = document.getElementById('fsCurT'), dt = document.getElementById('fsDurT');
  if (ct) ct.textContent = fmt(fsAudio.currentTime);
  if (dt) dt.textContent = fmt(fsAudio.duration);
});
fsAudio.addEventListener('loadedmetadata', () => {
  const dt = document.getElementById('fsDurT');
  if (dt && fsAudio.duration) dt.textContent = fmt(fsAudio.duration);
});
 
function seekFsBeat(e) {
  if (!fsAudio.duration) return;
  fsAudio.currentTime = (e.offsetX/e.currentTarget.offsetWidth)*fsAudio.duration;
}

async function toggleRecord() {
  if (fsRecording) { stopRecord(); } else { await startRecord(); }
}
 
async function startRecord() {
  if (!fsSelectedBeat) { showToast(t('dyn_select_beat_first')); return; }
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
  if (!fsPlaying && fsSelectedBeat.audio) {
    try {
      await ensureFsBeatPlayback();
      fsPlaying = true;
      document.getElementById('fsBeatPlayBtn').innerHTML = `<i class='fas fa-pause'></i> ${t('dyn_pause_beat')}`;
    } catch (e) {
      showToast('⚠ ' + (t('dyn_play_error') || 'Lecture impossible'));
      return;
    }
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
      beatTitle: fsSelectedBeat ? fsSelectedBeat.title : '—',
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
        <div style="font-family:var(--font-mono);font-size:0.58rem;color:var(--text-dim)">${r.beatTitle} · ${r.date} · ${fmt(r.duration)}</div>
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
function playMix() {
  if (!fsRecordings.length || !fsSelectedBeat) { showToast(t('dyn_no_freestyle')); return; }
  const voiceEl = new Audio(fsRecordings[0].url);
  fsAudio.currentTime=0; fsAudio.loop=false;
  fsAudio.play(); voiceEl.play();
  document.getElementById('mixPlayBtn').innerHTML=`<i class='fas fa-pause'></i> ${t('fs_playing')}`;
  voiceEl.onended = ()=>{ fsAudio.pause(); document.getElementById('mixPlayBtn').innerHTML=`<i class='fas fa-play'></i> ${t('fs_listen_mix')}`; };
}
async function postFreestyleToProfile() {
  if (!currentUser) { showToast(t('dyn_login_first')); showPage('login'); return; }
  if (!fsRecordings.length) { showToast(t('dyn_no_sound_pub')); return; }
  const post = { type:'freestyle', username:currentUser.username, beatTitle:fsRecordings[0].beatTitle, date:new Date().toLocaleDateString('fr'), url:fsRecordings[0].url, likes:0, comments:[] };
  await addPostToFirestore(post);
  showToast(t('dyn_freestyle_published'));
  showPage('community');
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
  // URLs des réseaux sociaux : on vérifie qu'elles commencent par https://
  const safeUrl = (url) => (url && /^https:\/\//.test(url)) ? encodeURI(url) : '#';
  const postCount = p.postCount || 0;
  return `<div style="background:rgba(255,255,255,0.03);backdrop-filter:blur(20px);border:1px solid rgba(0,229,255,0.12);border-radius:20px;overflow:hidden;transition:all 0.3s" onmouseover="this.style.borderColor='rgba(0,229,255,0.3)'" onmouseout="this.style.borderColor='rgba(0,229,255,0.12)'">
    <div style="height:90px;background:linear-gradient(135deg,rgba(0,100,180,0.3),rgba(0,229,255,0.1));position:relative"></div>
    <div style="padding:12px 20px 20px;margin-top:-28px">
      <div style="width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,var(--cyan),#0070a0);border:3px solid rgba(3,8,15,0.9);display:flex;align-items:center;justify-content:center;font-size:1.4rem;color:var(--dark);font-family:var(--font-display);margin-bottom:10px">${safeUsername.charAt(0).toUpperCase()}</div>
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
    nav_freestyle: 'Freestyle',
    // Hero
    hero_badge: "Côte d'Ivoire · Distribution Internationale",
    hero_explore: 'Explorer les Beats',
    hero_licenses: 'Voir les Licences',
    // Stats
    stat_available: 'Disponible',
    // Featured
    featured_chip: 'Nouveau drop',
    featured_title: 'Beat en Vedette',
    // Footer
    footer_desc: "Producteur basé en Côte d'Ivoire. Des sons premium conçus pour dominer les charts internationaux. <em style=\"color:var(--cyan);font-style:italic\">I am the sound you are looking for.</em>",
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
    lic_basic_tag: 'Pour démarrer',
    lic_b1: 'Usage non commercial',
    lic_b2: '10 000 streams inclus',
    lic_b3: 'Fichier MP3 taggé',
    lic_b4: '1 artiste uniquement',
    lic_b5: 'Réseaux sociaux OK',
    lic_b6: 'WAV non inclus',
    lic_choose_basic: 'Choisir Basic',
    lic_recommended: 'Recommandé',
    lic_premium_tag: 'Le plus populaire',
    lic_p1: 'Usage commercial',
    lic_p3: 'WAV + MP3 Non taggé',
    lic_p4: 'Radio & YouTube OK',
    lic_p5: 'Ventes physiques : 2 000',
    lic_p6: 'Distribution mondiale',
    lic_choose_premium: 'Choisir Premium',
    lic_excl_tag: 'Droits totaux',
    lic_e1: 'Propriété exclusive',
    lic_e2: 'Streams illimités',
    lic_e3: 'WAV + MP3 + Stems',
    lic_e4: 'Contrat officiel signé',
    lic_e5: 'Retiré du catalogue',
    lic_e6: 'Support prioritaire',
    lic_choose_excl: 'Choisir Exclusif',
    lic_wav_tag: 'Production complète',
    lic_w1: 'Usage commercial',
    lic_w2: 'WAV Haute qualité + Stems',
    lic_w3: 'Mixage & Mastering facilité',
    lic_w4: '100 000 streams',
    lic_w5: 'Distribution mondiale',
    lic_w6: 'Beat reste en catalogue',
    lic_choose_wav: 'Choisir WAV + Stems',
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
    // Admin panel
    admin_add_beat: 'Add Beat',
    admin_manage_beats: 'Manage Beats',
    admin_settings: 'Settings',
    admin_view_site: 'View Site',
    admin_welcome: 'Welcome to your admin area',
    admin_recent_beats: 'Recent Beats',
    admin_add_beat_sub: 'Ajoutez un nouveau beat à votre catalogue',
    admin_upload_title: 'Téléverser les fichiers',
    admin_upload_hint: 'Glissez-déposez ou cliquez pour sélectionner. MP3, WAV, MPEG · JPG, PNG, WEBP',
    admin_upload_cover: 'Image de couverture',
    admin_upload_cover_sub: 'Cliquez ou glissez une image',
    admin_upload_audio: 'Fichier audio du beat',
    admin_upload_audio_sub: 'Cliquez ou glissez un audio',
    admin_url_fallback: 'Ou utiliser des URLs externes (optionnel)',
    admin_info: 'Informations',
    admin_manage_beats_sub: 'Edit or remove your existing beats',
    admin_full_catalog: 'Full catalog',
    admin_settings_sub: 'Site configuration',
    admin_artist_info: 'Artist information',
    admin_security: 'Security',
    admin_title_field: 'Title *',
    admin_bpm_field: 'BPM *',
    admin_genre_field: 'Genre *',
    admin_subgenre_field: 'Subgenre',
    admin_price_basic: 'Basic Price ($)',
    admin_price_premium: 'Premium Price ($)',
    admin_price_excl: 'Exclusive Price ($)',
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
    err_all_fields: 'All fields are required',
    err_wrong_creds: 'Incorrect credentials',
    err_username_format: 'Username: 3-20 characters, letters/numbers/dashes only',
    err_invalid_email: 'Invalid email address',
    err_pwd_short: 'Password too short (8 characters minimum)',
    err_pwd_format: 'Password must include at least 1 uppercase letter and 1 number',
    err_username_taken: 'Username already taken',
    err_email_taken: 'Email already taken',
    err_wrong_pwd: 'Incorrect password',
    err_pwd_too_short: 'Too short (min 6 chars)',
    err_title_bpm_required: 'Title and BPM required!',
    err_title_url_required: 'Title and URL required!',
    err_invalid_url: 'Invalid URL (must start with https://)',
    // Payment modal
    pay_card_name: 'Card',
    pay_paypal_sub: 'Secure payment',
    pay_loading_paypal: 'Loading PayPal...',
    pay_paypal_note: 'Secure payment via PayPal · Visa, Mastercard, PayPal account accepted.',
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
  },
  en: {
    // Nav
    nav_home: 'Home',
    nav_artists: 'Artists',
    nav_licenses: 'Licenses',
    nav_login: 'Login',
    nav_freestyle: 'Freestyle',
    // Hero
    hero_badge: "Ivory Coast · International Distribution",
    hero_explore: 'Explore Beats',
    hero_licenses: 'View Licenses',
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
    lic_e2: 'Unlimited streams',
    lic_e3: 'WAV + MP3 + Stems',
    lic_e4: 'Official signed contract',
    lic_e5: 'Removed from catalog',
    lic_e6: 'Priority support',
    lic_choose_excl: 'Choose Exclusive',
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
    login_btn: 'Sign In',
    login_no_account: 'No account?',
    login_register: 'Sign up',
    login_back: 'Back to site',
    reg_pseudo: 'Username',
    reg_btn: 'Create Account',
    reg_already: 'Already registered?',
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
  const lang = translations[currentLang] || translations['fr'];
  let str = lang[key] || translations['fr'][key] || key;
  args.forEach(a => { str = str.replace('%s', a); });
  return str;
}
 
// ─── Apply translations to all data-i18n elements ───
function applyTranslations() {
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
    if (currentLang === 'fr') { flag.textContent = '🇬🇧'; label.textContent = 'EN'; }
    else { flag.textContent = '🇫🇷'; label.textContent = 'FR'; }
  }
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
  studioGainVoice.gain.value = parseFloat(document.getElementById('vocalGain').value) / 100;

  studioGainBeat = studioCtx.createGain();
  studioGainBeat.gain.value = parseFloat(document.getElementById('beatVolStudio').value) / 100;

  // ─ Compresseur ─
  studioCompressor = studioCtx.createDynamicsCompressor();
  studioCompressor.threshold.value = parseFloat(document.getElementById('compThreshold').value);
  studioCompressor.ratio.value = parseFloat(document.getElementById('compRatio').value);
  studioCompressor.attack.value = parseFloat(document.getElementById('compAttack').value) / 1000;
  studioCompressor.release.value = parseFloat(document.getElementById('compRelease').value) / 1000;
  studioCompressor.knee.value = 10;

  // ─ EQ (BiquadFilters) sur la voix ─
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
    if (fsSelectedBeat && fsSelectedBeat.audio && fsAudio.src) {
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
        fsAudio.volume = parseFloat(document.getElementById('beatVolStudio').value) / 100;
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
  if (studioGainVoice) studioGainVoice.gain.value = parseFloat(document.getElementById('vocalGain').value) / 100;
}

function updateBeatVolStudio() {
  if (studioGainBeat) studioGainBeat.gain.value = parseFloat(document.getElementById('beatVolStudio').value) / 100;
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
  if (format === 'wav-mix' && fsSelectedBeat && fsSelectedBeat.audio) {
    try {
      const beatBuf = await new Promise((resolve, reject) => {
        const xhr2 = new XMLHttpRequest();
        xhr2.open('GET', fsSelectedBeat.audio, true);
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