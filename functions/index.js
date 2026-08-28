// Cloud Functions entrypoint for Je Suis Beatz
// Deploy with: firebase deploy --only functions

const functions = require('firebase-functions');
const adminSdk  = require('firebase-admin');
const axios     = require('axios');
const crypto    = require('crypto');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

// Optional params API (firebase-functions v7+). Use if available, otherwise null.
let GENIUSPAY_KEY_PARAM = null;
let GENIUSPAY_SECRET_PARAM = null;
try {
  const { defineString } = require('firebase-functions/params');
  if (typeof defineString === 'function') {
    GENIUSPAY_KEY_PARAM = defineString('GENIUSPAY_KEY');
    GENIUSPAY_SECRET_PARAM = defineString('GENIUSPAY_SECRET');
  }
} catch (e) {
  // params module not available — we'll fall back to env vars below
}

adminSdk.initializeApp();
const db = adminSdk.firestore();

async function callerIsAdmin(context) {
  if (!context.auth) return false;
  if (context.auth.token.admin === true) return true;

  const uid = context.auth.uid;
  let authEmail = (context.auth.token.email || '').toLowerCase();
  try {
    const authUser = await adminSdk.auth().getUser(uid);
    if (authUser.email) authEmail = authUser.email.toLowerCase();
  } catch (e) { /* Firestore role checks may still authorize the caller */ }
  if (BOOTSTRAP_ADMIN_EMAILS.includes(authEmail) || BOOTSTRAP_ADMIN_UIDS.includes(uid)) return true;

  const adminDoc = await db.collection('admins').doc(uid).get();
  if (adminDoc.exists) {
    const adminData = adminDoc.data();
    if (adminData.isAdmin === true || adminData.admin === true) {
      return true;
    }
  }

  const userDoc = await db.collection('users').doc(uid).get();
  if (userDoc.exists && userDoc.data().role === 'admin') return true;

  let email = (context.auth.token.email || '').toLowerCase();
  if (!email && userDoc.exists) {
    email = (userDoc.data().email || '').toLowerCase();
  }
  if (!email) {
    try {
      const record = await adminSdk.auth().getUser(uid);
      email = (record.email || '').toLowerCase();
    } catch (e) { /* ignore */ }
  }

  if (BOOTSTRAP_ADMIN_EMAILS.includes(email)) {
    await db.collection('admins').doc(uid).set({ isAdmin: true, email }, { merge: true });
    await db.collection('users').doc(uid).set({ role: 'admin', email }, { merge: true });
    if (context.auth.token.admin !== true) {
      await adminSdk.auth().setCustomUserClaims(uid, { admin: true });
    }
    return true;
  }

  return false;
}

const BOOTSTRAP_ADMIN_EMAILS = ['jesuisthebeatmaker@gmail.com'];
const BOOTSTRAP_ADMIN_UIDS = ['l7wKvkWH7rXcHcUW63c382TWCRq1'];

// Secret Manager client for fetching secrets at runtime
const secretManagerClient = new SecretManagerServiceClient();

// Cache for secrets (to avoid repeated API calls)
const secretCache = {};

async function getSecretFromSecretManager(secretName) {
  // Check cache first
  if (secretCache[secretName]) {
    return secretCache[secretName];
  }

  try {
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
    if (!projectId) {
      console.warn(`Project ID not available for secret ${secretName}`);
      return null;
    }

    const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;
    const [version] = await secretManagerClient.accessSecretVersion({ name });
    const secretValue = version.payload.data.toString('utf8');
    
    // Cache the secret
    secretCache[secretName] = secretValue;
    return secretValue;
  } catch (e) {
    console.error(`Failed to fetch secret ${secretName}:`, e.message);
    return null;
  }
}

function cfg(path) {
  // Map dotted config path to environment variable name, e.g. "geniuspay.key" -> "GENIUSPAY_KEY"
  const envKey = path.replace(/\./g, '_').toUpperCase();
  const val = process.env[envKey];
  if (val !== undefined) return val;
  // Try legacy functions.config() (helps when params CLI isn't available)
  try {
    const fc = (typeof functions.config === 'function') ? functions.config() : null;
    if (fc) {
      const parts = path.split('.');
      let v = fc;
      for (const p of parts) {
        if (v && Object.prototype.hasOwnProperty.call(v, p)) v = v[p];
        else { v = null; break; }
      }
      if (v !== null && v !== undefined) return v;
    }
  } catch (e) {
    // ignore
  }
  // If not set, throw a descriptive error so logs are clear
  throw new Error(`Config manquante (env ${envKey}) : ${path}`);
}

function cfgOptional(path) {
  try {
    return cfg(path);
  } catch (e) {
    return null;
  }
}

async function verifyFirebaseRequest(req) {
  const authHeader = String(req.headers?.authorization || req.headers?.Authorization || '').trim();
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader;
  const token = bearer || String(req.headers?.['x-firebase-auth'] || '').trim();
  if (!token) return null;
  try {
    const decoded = await adminSdk.auth().verifyIdToken(token);
    return decoded;
  } catch (e) {
    console.warn('Firebase auth verify failed:', e.message || e);
    return null;
  }
}

exports.getUserEmailByUsername = functions.https.onCall(async (data, context) => {
  const { username } = data;
  if (!username || typeof username !== 'string' || username.length > 30) {
    throw new functions.https.HttpsError('invalid-argument', 'Username invalide');
  }

  const cleanUsername = username.trim().toLowerCase();

  const snap = await db.collection('users')
    .where('username', '==', cleanUsername)
    .limit(1)
    .get();

  if (snap.empty) {
    throw new functions.https.HttpsError('not-found', 'Identifiants incorrects');
  }

  const email = snap.docs[0].data().email;
  if (!email) {
    throw new functions.https.HttpsError('not-found', 'Identifiants incorrects');
  }

  return { email };
});

exports.paypalWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const event = req.body;
  const eventType = event.event_type;

  if (eventType !== 'PAYMENT.CAPTURE.COMPLETED') {
    return res.status(200).send('Event ignored');
  }

  try {
    const webhookId = cfg('paypal.webhook_id');
    const verified = await verifyPaypalSignature(req.headers, req.rawBody, webhookId);
    if (!verified) {
      console.error('PayPal webhook signature invalide');
      return res.status(400).send('Invalid signature');
    }

    const captureId   = event.resource.id;
    const orderId     = event.resource.supplementary_data?.related_ids?.order_id;
    const amountValue = parseFloat(event.resource.amount?.value || 0);
    const currency    = event.resource.amount?.currency_code || 'USD';
    const payerEmail  = event.resource.payer?.email_address || '';

    const existingSnap = await db.collection('orders')
      .where('captureId', '==', captureId)
      .limit(1)
      .get();
    if (!existingSnap.empty) {
      console.warn('CaptureId déjà traité:', captureId);
      return res.status(200).send('Already processed');
    }

    const ordersSnap = await db.collection('orders')
      .where('transactionId', '==', orderId)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (ordersSnap.empty) {
      console.warn('Aucune commande pending pour PayPal orderId:', orderId);
      return res.status(200).send('Order not found');
    }

    const orderDoc  = ordersSnap.docs[0];
    const orderData = orderDoc.data();

    if (Math.abs(amountValue - orderData.total) > 0.01) {
      console.error(`Montant PayPal incorrect: reçu ${amountValue}, attendu ${orderData.total}`);
      await orderDoc.ref.update({ status: 'amount_mismatch', captureId, flaggedAt: adminSdk.firestore.FieldValue.serverTimestamp() });
      return res.status(200).send('Amount mismatch — flagged');
    }

    await orderDoc.ref.update({
      status:      'completed',
      captureId,
      payerEmail,
      currency,
      confirmedAt: adminSdk.firestore.FieldValue.serverTimestamp()
    });

    await sendPurchaseLicenseEmail(orderData, payerEmail, orderDoc.id);

    console.log('✅ Commande PayPal confirmée:', orderDoc.id);
    return res.status(200).send('OK');

  } catch (e) {
    console.error('Erreur webhook PayPal:', e);
    return res.status(500).send('Internal error');
  }
});

exports.cinetpayWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { cpm_trans_id, cpm_amount, cpm_currency, cpm_error_message, cpm_result } = req.body;

  const expectedSiteId = String(cfg('cinetpay.site_id'));
  const receivedSiteId = String(req.body.cpm_site_id || '');
  if (receivedSiteId !== expectedSiteId) {
    console.error('CinetPay site_id invalide:', receivedSiteId);
    return res.status(400).send('Invalid site_id');
  }

  if (cpm_result !== '00') {
    console.warn('CinetPay paiement échoué:', cpm_error_message);
    if (cpm_trans_id) {
      await db.collection('transactions').doc(cpm_trans_id).update({
        status: 'FAILED',
        errorMessage: cpm_error_message || 'Payment refused',
        updatedAt: adminSdk.firestore.FieldValue.serverTimestamp()
      }).catch(()=>{});
    }
    return res.status(200).send('Payment failed — noted');
  }

  try {
    const txDoc = await db.collection('transactions').doc(cpm_trans_id).get();
    if (txDoc.exists && txDoc.data().status === 'SUCCESS') {
      console.warn('Transaction CinetPay déjà traitée:', cpm_trans_id);
      return res.status(200).json({ code: '00', message: 'Already processed' });
    }

    const apiKey  = cfg('cinetpay.api_key');
    const siteId  = cfg('cinetpay.site_id');
    const checkRes = await axios.post('https://api-checkout.cinetpay.com/v2/payment/check', {
      apikey:         apiKey,
      site_id:        siteId,
      transaction_id: cpm_trans_id,
      amount:         parseInt(cpm_amount),
      currency:       cpm_currency
    }, { timeout: 10000 });

    if (checkRes.data?.code !== '00') {
      console.error('CinetPay vérification échouée pour:', cpm_trans_id);
      return res.status(200).send('Verification failed');
    }

    const snap = await db.collection('orders')
      .where('transactionId', '==', cpm_trans_id)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (snap.empty) {
      console.warn('Aucune commande pending pour CinetPay trans:', cpm_trans_id);
      return res.status(200).send('Order not found');
    }

    const orderDoc  = snap.docs[0];
    const orderData = orderDoc.data();

    const batch = db.batch();

    batch.update(orderDoc.ref, {
      status:      'completed',
      cinetpayRef: cpm_trans_id,
      confirmedAt: adminSdk.firestore.FieldValue.serverTimestamp()
    });

    batch.update(db.collection('transactions').doc(cpm_trans_id), {
      status:    'SUCCESS',
      paidAt:    adminSdk.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();

    await sendPurchaseLicenseEmail(orderData, orderData.customerEmail, orderDoc.id);

    console.log('✅ Commande CinetPay confirmée:', orderDoc.id);
    return res.status(200).json({ code: '00', message: 'OK' });

  } catch (e) {
    console.error('Erreur webhook CinetPay:', e);
    return res.status(500).send('Internal error');
  }
});

exports.registerStream = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required');
  }

  const { beatId } = data;
  if (!beatId || typeof beatId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'beatId invalide');
  }

  const uid = context.auth.uid;
  const now = Date.now();
  const cooldownMs = 30 * 60 * 1000;

  const rateLimitRef = db.collection('_stream_rate_limits').doc(`${uid}_${beatId}`);
  const rateLimitDoc = await rateLimitRef.get();

  if (rateLimitDoc.exists) {
    const lastStream = rateLimitDoc.data().lastStream?.toMillis() || 0;
    if (now - lastStream < cooldownMs) {
      return { counted: false, reason: 'rate_limited' };
    }
  }

  await db.runTransaction(async (tx) => {
    const beatRef = db.collection('beats').doc(String(beatId));
    const beatDoc = await tx.get(beatRef);
    if (!beatDoc.exists) throw new Error('Beat introuvable');
    tx.update(beatRef, { streams: adminSdk.firestore.FieldValue.increment(1) });
    tx.set(rateLimitRef, {
      uid, beatId,
      lastStream: adminSdk.firestore.FieldValue.serverTimestamp()
    });
  });

  return { counted: true };
});

exports.getOrderStatus = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required');
  }

  const { orderId } = data;
  if (!orderId || typeof orderId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'orderId invalide');
  }

  const snap = await db.collection('orders')
    .where('orderId', '==', orderId)
    .where('userId', '==', context.auth.uid)
    .limit(1)
    .get();

  if (snap.empty) {
    throw new functions.https.HttpsError('not-found', 'Commande introuvable');
  }

  const order = snap.docs[0].data();

  return {
    status:        order.status,
    orderId:       order.orderId,
    total:         order.total,
    paymentMethod: order.method,
    createdAt:     order.createdAt?.toMillis() || null,
    confirmedAt:   order.confirmedAt?.toMillis() || null
  };
});

exports.ensureAdminClaim = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Connexion requise');
  }

  const uid = context.auth.uid;
  let email = (context.auth.token.email || '').toLowerCase();

  // Email source de vérité : Firebase Auth (le token peut ne pas contenir l'email)
  try {
    const record = await adminSdk.auth().getUser(uid);
    if (record.email) email = record.email.toLowerCase();
  } catch (e) {
    console.warn('ensureAdminClaim getUser:', e.message);
  }

  const adminDoc = await db.collection('admins').doc(uid).get();
  let isAdmin = false;
  if (adminDoc.exists) {
    const adminData = adminDoc.data();
    isAdmin = adminData.isAdmin === true || adminData.admin === true;
    if (adminData.admin === true && adminData.isAdmin !== true) {
      await db.collection('admins').doc(uid).set({ isAdmin: true }, { merge: true });
    }
  }

  const userDoc = await db.collection('users').doc(uid).get();
  if (!email && userDoc.exists) {
    email = (userDoc.data().email || '').toLowerCase();
  }

  // Comptes admin historiques (users.role) ou email propriétaire du site
  if (!isAdmin) {
    const legacyAdmin = userDoc.exists && userDoc.data().role === 'admin';
    const bootstrapAdmin = BOOTSTRAP_ADMIN_EMAILS.includes(email);
    if (legacyAdmin || bootstrapAdmin) {
      await db.collection('admins').doc(uid).set({ isAdmin: true, admin: true, email }, { merge: true });
      await db.collection('users').doc(uid).set({ role: 'admin', email }, { merge: true });
      isAdmin = true;
    }
  }

  if (isAdmin && context.auth.token.admin !== true) {
    try {
      await adminSdk.auth().setCustomUserClaims(uid, { admin: true });
      return { isAdmin: true, claimUpdated: true };
    } catch (e) {
      console.error('setCustomUserClaims:', e.message);
      return { isAdmin: true, claimUpdated: false };
    }
  }

  if (context.auth.token.admin === true) {
    if (!adminDoc.exists) {
      await db.collection('admins').doc(uid).set({ isAdmin: true, email }, { merge: true });
    }
    return { isAdmin: true, claimUpdated: false };
  }

  console.log('ensureAdminClaim result', { uid, email, isAdmin });
  return { isAdmin, claimUpdated: false };
});

// URL signée pour téléverser cover/audio (contourne les règles Storage client)
function normalizeBeatTitle(title) {
  return String(title || '').trim().toUpperCase();
}

function isValidPublicUrl(url) {
  return typeof url === 'string' && /^https?:\/\/.+/.test(url);
}

function validateBeatPayload(beat) {
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
  if (beat.cover && !isValidPublicUrl(beat.cover)) return 'Cover URL invalide';
  if (beat.audio && !isValidPublicUrl(beat.audio)) return 'Audio URL invalide';
  return null;
}

exports.getBeatUploadUrl = functions.https.onCall(async (data, context) => {
  if (!(await callerIsAdmin(context))) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { path, contentType } = data || {};
  if (!path || typeof path !== 'string' || !/^(covers|beats)\/[a-zA-Z0-9._-]+$/.test(path)) {
    throw new functions.https.HttpsError('invalid-argument', 'Chemin invalide');
  }

  const allowedTypes = [
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/m4a', 'audio/flac', 'audio/ogg'
  ];
  const finalContentType = String(contentType || '').trim().toLowerCase();
  if (!allowedTypes.includes(finalContentType)) {
    throw new functions.https.HttpsError('invalid-argument', 'Type de contenu invalide');
  }

  const bucket = adminSdk.storage().bucket();
  const file = bucket.file(path);
  const expires = Date.now() + 20 * 60 * 1000;
  const [uploadUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires,
    contentType: finalContentType,
  });

  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media`;
  return { uploadUrl, downloadUrl };
});

// Sauvegarde beat via Admin SDK (contourne les règles Firestore client)
exports.adminSaveBeat = functions.https.onCall(async (data, context) => {
  if (!(await callerIsAdmin(context))) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { beat, beatId } = data || {};
  if (!beat || typeof beat !== 'object') {
    throw new functions.https.HttpsError('invalid-argument', 'Données beat invalides');
  }

  const payload = { ...beat };
  delete payload.id;
  payload.title = normalizeBeatTitle(payload.title);

  const validationError = validateBeatPayload(payload);
  if (validationError) {
    throw new functions.https.HttpsError('invalid-argument', validationError);
  }

  const serverTs = adminSdk.firestore.FieldValue.serverTimestamp();

  if (beatId && typeof beatId === 'string' && !beatId.startsWith('catalog-')) {
    const docRef = db.collection('beats').doc(beatId);
    const existing = await docRef.get();
    const patch = { ...payload, updatedAt: serverTs };
    if (!existing.exists || !existing.data()?.createdAt) {
      patch.createdAt = serverTs;
    }
    await docRef.set(patch, { merge: true });
    return { id: beatId, action: 'updated' };
  }

  const ref = await db.collection('beats').add({
    ...payload,
    createdAt: serverTs,
    updatedAt: serverTs,
  });
  return { id: ref.id, action: 'created' };
});

exports.purgeDuplicateBeats = functions.https.onCall(async (data, context) => {
  if (!(await callerIsAdmin(context))) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const collectionName = String(data?.collection || 'beats');
  if (collectionName !== 'beats') {
    throw new functions.https.HttpsError('invalid-argument', 'Collection non autorisée');
  }

  const snap = await db.collection(collectionName).get();
  const keeper = new Map();
  const duplicates = [];

  for (const doc of snap.docs) {
    const beat = doc.data();
    const title = normalizeBeatTitle(beat.title);
    if (!title) continue;
    const current = keeper.get(title);
    const currentTs = current?.createdAt?.toMillis?.() || current?.createdAt?.seconds * 1000 || 0;
    const candidateTs = beat.createdAt?.toMillis?.() || beat.createdAt?.seconds * 1000 || 0;
    if (!current || candidateTs > currentTs) {
      keeper.set(title, doc);
    }
  }

  for (const doc of snap.docs) {
    const beat = doc.data();
    const title = normalizeBeatTitle(beat.title);
    if (!title) continue;
    const keeperDoc = keeper.get(title);
    if (keeperDoc && keeperDoc.id !== doc.id) {
      duplicates.push(doc.id);
    }
  }

  const deleted = [];
  for (const docId of duplicates) {
    await db.collection(collectionName).doc(docId).delete();
    deleted.push(docId);
  }

  return { success: true, deleted, count: deleted.length };
});

exports.getAdminUserStats = functions.https.onCall(async (data, context) => {
  if (!(await callerIsAdmin(context))) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const totalSnapshot = await db.collection('users').count().get();
  const totalCount = totalSnapshot.data()?.count || 0;
  const limit = Math.min(Math.max(Number(data?.limit) || 500, 50), 2000);
  const usersSnap = await db.collection('users')
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  const users = usersSnap.docs.map((doc) => {
    const d = doc.data();
    return {
      uid: doc.id,
      username: d.username || '—',
      email: d.email || '—',
      role: d.role || 'user',
      createdAt: d.createdAt?.toMillis?.() || d.createdAt?._seconds * 1000 || null,
    };
  });

  return { count: totalCount, users, partial: users.length < totalCount, limit };
});

exports.adminDeleteUser = functions.https.onCall(async (data, context) => {
  const callerUid = context.auth?.uid || '';
  const callerEmail = String(context.auth?.token?.email || '').trim().toLowerCase();
  const ownerIsCalling = callerUid === 'l7wKvkWH7rXcHcUW63c382TWCRq1'
    || callerEmail === 'jesuisthebeatmaker@gmail.com';
  if (!ownerIsCalling && !(await callerIsAdmin(context))) {
    throw new functions.https.HttpsError(
      'permission-denied',
      `Admin only (uid=${callerUid || 'missing'}, email=${callerEmail || 'missing'})`,
    );
  }

  const uid = String(data?.uid || '').trim();
  if (!uid) {
    throw new functions.https.HttpsError('invalid-argument', 'User uid required');
  }
  if (uid === context.auth.uid) {
    throw new functions.https.HttpsError('failed-precondition', 'You cannot delete yourself');
  }

  const [target, userDoc, adminDoc] = await Promise.all([
    adminSdk.auth().getUser(uid).catch(() => null),
    db.collection('users').doc(uid).get(),
    db.collection('admins').doc(uid).get(),
  ]);
  if (!target && !userDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }
  if (target?.customClaims?.admin === true
    || (userDoc.exists && userDoc.data().role === 'admin')
    || (adminDoc.exists && (adminDoc.data().isAdmin === true || adminDoc.data().admin === true))) {
    throw new functions.https.HttpsError('failed-precondition', 'Administrators are protected');
  }

  if (target) await adminSdk.auth().deleteUser(uid);
  await Promise.all([
    db.collection('users').doc(uid).delete(),
    db.collection('profiles').doc(uid).delete(),
  ]);

  return { success: true, uid };
});

// HTTP fallback for clients where the callable SDK does not forward Auth context.
exports.adminDeleteUserHttp = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Firebase-Auth');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const auth = await verifyFirebaseRequest(req);
  const callerUid = auth?.uid || '';
  const callerEmail = String(auth?.email || '').trim().toLowerCase();
  const ownerIsCalling = callerUid === 'l7wKvkWH7rXcHcUW63c382TWCRq1'
    || callerEmail === 'jesuisthebeatmaker@gmail.com';
  if (!auth || (!ownerIsCalling && !(await callerIsAdmin({ auth })))) {
    return res.status(403).json({ error: 'Admin only' });
  }

  const uid = String(req.body?.uid || req.body?.data?.uid || '').trim();
  if (!uid) return res.status(400).json({ error: 'User uid required' });
  if (uid === callerUid) return res.status(409).json({ error: 'You cannot delete yourself' });

  try {
    const [target, userDoc, adminDoc] = await Promise.all([
      adminSdk.auth().getUser(uid).catch(() => null),
      db.collection('users').doc(uid).get(),
      db.collection('admins').doc(uid).get(),
    ]);
    if (!target && !userDoc.exists) return res.status(404).json({ error: 'User not found' });
    if (target?.customClaims?.admin === true
      || (userDoc.exists && userDoc.data().role === 'admin')
      || (adminDoc.exists && (adminDoc.data().isAdmin === true || adminDoc.data().admin === true))) {
      return res.status(409).json({ error: 'Administrators are protected' });
    }
    if (target) await adminSdk.auth().deleteUser(uid);
    await Promise.all([
      db.collection('users').doc(uid).delete(),
      db.collection('profiles').doc(uid).delete(),
    ]);
    return res.status(200).json({ result: { success: true, uid } });
  } catch (e) {
    console.error('adminDeleteUserHttp error:', e.message || e);
    return res.status(500).json({ error: 'User deletion failed' });
  }
});

exports.setAdminClaim = functions.https.onCall(async (data, context) => {
  const { email } = data;
  if (!email) throw new functions.https.HttpsError('invalid-argument', 'Email required');

  const targetEmail = email.toLowerCase();
  let allowed = false;

  if (context.auth?.token?.admin === true) {
    allowed = true;
  } else if (context.auth) {
    let callerEmail = (context.auth.token.email || '').toLowerCase();
    try {
      const record = await adminSdk.auth().getUser(context.auth.uid);
      if (record.email) callerEmail = record.email.toLowerCase();
    } catch (e) { /* ignore */ }
    if (callerEmail === targetEmail && BOOTSTRAP_ADMIN_EMAILS.includes(callerEmail)) {
      allowed = true;
    }
  }

  if (!allowed) {
    const adminsSnap = await db.collection('admins').where('isAdmin', '==', true).limit(1).get();
    if (!adminsSnap.empty) {
      throw new functions.https.HttpsError('permission-denied', 'Admin already exists');
    }
    if (!BOOTSTRAP_ADMIN_EMAILS.includes(targetEmail)) {
      throw new functions.https.HttpsError('permission-denied', 'Not allowed');
    }
  }

  const user = await adminSdk.auth().getUserByEmail(targetEmail);
  await adminSdk.auth().setCustomUserClaims(user.uid, { admin: true });
  await db.collection('admins').doc(user.uid).set({ isAdmin: true, email: targetEmail }, { merge: true });
  await db.collection('users').doc(user.uid).set({ role: 'admin', email: targetEmail }, { merge: true });

  console.log(`✅ Claim admin défini pour : ${targetEmail}`);
  return { success: true };
});

async function verifyPaypalSignature(headers, rawBody, webhookId) {
  try {
    const clientId     = cfg('paypal.client_id');
    const clientSecret = cfg('paypal.client_secret');
    const base64       = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const tokenRes = await axios.post(
      'https://api-m.paypal.com/v1/oauth2/token',
      'grant_type=client_credentials',
      { headers: { Authorization: `Basic ${base64}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const accessToken = tokenRes.data.access_token;

    const verifyRes = await axios.post(
      'https://api-m.paypal.com/v1/notifications/verify-webhook-signature',
      {
        auth_algo:         headers['paypal-auth-algo'],
        cert_url:          headers['paypal-cert-url'],
        transmission_id:   headers['paypal-transmission-id'],
        transmission_sig:  headers['paypal-transmission-sig'],
        transmission_time: headers['paypal-transmission-time'],
        webhook_id:        webhookId,
        webhook_event:     JSON.parse(rawBody)
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    return verifyRes.data?.verification_status === 'SUCCESS';
  } catch (e) {
    console.error('Erreur vérification signature PayPal:', e.message);
    return false;
  }
}

async function sendPurchaseLicenseEmail(orderData, email, orderId) {
  if (!email) return;

  try {
    const orderRef = orderId ? db.collection('orders').doc(orderId) : null;
    const existingLicense = orderRef ? await orderRef.get() : null;
    if (existingLicense?.exists && existingLicense.data()?.licenseSentAt) {
      console.log('Licence déjà envoyée pour la commande:', orderId);
      return;
    }

    const sgMail = require('@sendgrid/mail');
    
    // Try to get API key from multiple sources
    let apiKey = cfgOptional('sendgrid.api_key');
    if (!apiKey) {
      // Try to fetch from Secret Manager
      apiKey = await getSecretFromSecretManager('SENDGRID_API_KEY');
    }
    
    if (!apiKey) {
      console.error('Erreur envoi email : sendgrid.api_key manquant');
      return;
    }
    
    sgMail.setApiKey(apiKey);

    const items = (orderData.items || orderData.cartItems || []).map((item) => ({
      title: item.beatTitle || item.title || item.name || 'Beat',
      license: item.license || item.licenseName || 'Standard',
      price: item.price ?? item.price_usd ?? item.unit_price ?? '',
    }));
    const licenseNumber = `JSB-${String(orderId || 'ORDER').slice(-8).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const issuedAt = new Date().toISOString();
    const isEnglish = orderData.language === 'en' || orderData.locale === 'en';
    const licensePayload = {
      licenseNumber,
      orderId: orderId || orderData.orderId || null,
      buyerEmail: email.toLowerCase(),
      buyerName: orderData.customer?.name || orderData.customer_name || orderData.customerName || 'Acheteur',
      items,
      total: orderData.total ?? orderData.totalUSD ?? orderData.metadata?.total_usd ?? null,
      currency: orderData.currency || 'USD',
      issuedAt,
      status: 'payment_confirmed',
    };
    const signingSecret = process.env.GENIUSPAY_SECRET || process.env.LICENSE_SIGNING_SECRET || 'je-suis-beatz-license-v1';
    const licenseHash = crypto.createHash('sha256')
      .update(JSON.stringify(licensePayload) + signingSecret)
      .digest('hex');
    const itemHtml = items.map(i => `<li><strong>${escapeHtml(i.title)}</strong> — Licence ${escapeHtml(i.license)}${i.price !== '' ? ` (${escapeHtml(String(i.price))})` : ''}</li>`).join('');

    const msg = {
      to:      email,
      from:    { email: 'noreply@je-suis-beatz.com', name: 'Je Suis Beatz' },
      replyTo: 'jesuisthebeatmaker@gmail.com',
      subject: isEnglish
        ? `Your authenticated purchase license ${licenseNumber} — Je Suis Beatz`
        : `Votre licence d'achat ${licenseNumber} — Je Suis Beatz`,
      html: isEnglish ? `
    <h2>Authenticated purchase license</h2>
    <p>Hello ${escapeHtml(String(licensePayload.buyerName))},</p>
    <p>Your payment has been confirmed. This license is the proof of authentication for your purchase from Je Suis Beatz.</p>
    <p><strong>License number:</strong> ${licenseNumber}<br>
    <strong>Order:</strong> ${escapeHtml(String(licensePayload.orderId || '—'))}<br>
    <strong>Issue date:</strong> ${issuedAt}<br>
    <strong>Status:</strong> Payment confirmed</p>
    <h3>Rights acquired</h3>
    <ul>${itemHtml}</ul>
    <p><strong>Authentication fingerprint:</strong><br><code>${licenseHash}</code></p>
    <p>Keep this email: the license number and fingerprint can be used to verify its authenticity.</p>
    <p>Je Suis Beatz<br>jesuisthebeatmaker@gmail.com</p>
    ` : `
    <h2>Licence d'achat authentifiée</h2>
    <p>Bonjour ${escapeHtml(String(licensePayload.buyerName))},</p>
    <p>Votre paiement a été confirmé. Cette licence constitue la preuve d'authentification de votre achat auprès de Je Suis Beatz.</p>
    <p><strong>Numéro de licence :</strong> ${licenseNumber}<br>
    <strong>Commande :</strong> ${escapeHtml(String(licensePayload.orderId || '—'))}<br>
    <strong>Date d'émission :</strong> ${issuedAt}<br>
    <strong>Statut :</strong> Paiement confirmé</p>
    <h3>Droits acquis</h3>
    <ul>${itemHtml}</ul>
    <p><strong>Empreinte d'authentification :</strong><br><code>${licenseHash}</code></p>
    <p>Conservez cet e-mail : le numéro de licence et son empreinte permettent de vérifier l'authenticité de cette licence.</p>
    <p>Je Suis Beatz<br>jesuisthebeatmaker@gmail.com</p>
`
    };

    await sgMail.send(msg);
    if (orderRef) {
      await orderRef.set({
        licenseNumber,
        licenseHash,
        licenseIssuedAt: adminSdk.firestore.Timestamp.fromDate(new Date(issuedAt)),
        licenseSentAt: adminSdk.firestore.FieldValue.serverTimestamp(),
        licenseStatus: 'payment_confirmed',
      }, { merge: true });
    }
  } catch (e) {
    console.error('Erreur envoi email:', e.message || e);
  }
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

// ───────────────────────────────────────────────────────────────────
// CREATE GENIUSPAY PAYMENT — Endpoint serveur sécurisé pour paiements GeniusPay
// URL: POST https://us-central1-je-suis-beatz.cloudfunctions.net/createGeniusPayment
// Input: { orderData: { amount, currency, customer_name, customer_email, items, etc. } }
// Output: { checkout_url, orderId, payment }
// ───────────────────────────────────────────────────────────────────
exports.createGeniusPayment = functions.https.onRequest(async (req, res) => {
  // CORS handling
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const auth = await verifyFirebaseRequest(req);
  if (!auth || !auth.uid) {
    return res.status(401).json({ success: false, error: 'unauthenticated' });
  }

  try {
    const body = req.body || {};
    const orderData = body.orderData || body.data?.orderData || body.data || null;
    
    if (!orderData || typeof orderData !== 'object') {
      return res.status(400).json({ error: 'orderData missing' });
    }

    const amount = Number(orderData.amount || orderData.totalXOF || orderData.total || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, error: 'invalid_amount' });
    }

    // Récupérer les clés depuis les params (si définis), sinon env vars, sinon functions.config()
    let gpKey = process.env.GENIUSPAY_KEY || null;
    let gpSecret = process.env.GENIUSPAY_SECRET || null;
    try {
      if (!gpKey) gpKey = cfg('geniuspay.key');
      if (!gpSecret) gpSecret = cfg('geniuspay.secret');
    } catch (e) {
      // ignore — we'll error below if still missing
    }

    if (!gpKey || !gpSecret) {
      console.error('Missing GeniusPay keys: ensure functions params, env vars, or functions.config are set');
      return res.status(500).json({ success: false, error: 'missing_payment_keys' });
    }

    console.log('Creating GeniusPay payment for uid:', auth.uid, 'amount:', amount);

    // Appel à l'API GeniusPay
    const gpRes = await axios.post('https://geniuspay.ci/api/v1/merchant/payments', orderData, {
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': gpKey,
        'X-API-Secret': gpSecret
      },
      timeout: 15000
    });

    const payment = gpRes.data || {};

    console.log('GeniusPay response:', payment);
    const paymentData = (payment && payment.data) ? payment.data : {};
    const paymentId = paymentData.id != null ? String(paymentData.id) : null;
    const paymentRef = paymentData.reference || paymentData.external_reference || null;

    // Sauvegarder la commande en mode 'pending' dans Firestore
    const orderDoc = await db.collection('orders').add({
      createdAt: adminSdk.firestore.FieldValue.serverTimestamp(),
      status: 'pending',
      method: 'geniuspay',
      gateway: 'geniuspay',
      gatewayPaymentId: paymentId,
      gatewayReference: paymentRef != null ? String(paymentRef) : null,
      gatewayResponse: payment,
      total: orderData.metadata?.total_usd ?? null,
      totalXOF: orderData.amount ?? null,
      totalUSD: orderData.metadata?.total_usd ?? null,
      currency: orderData.currency || 'XOF',
      language: orderData.language === 'en' ? 'en' : 'fr',
      metadata: orderData.metadata || null,
      cartItems: orderData.metadata?.cart || [],
      items: orderData.items || [],
      customer: {
        name: orderData.customer_name || null,
        email: orderData.customer_email || null,
        phone: orderData.customer_phone || null
      },
      userId: auth.uid
    });

    console.log('Order saved with ID:', orderDoc.id);

    // Répondre au client avec l'URL de checkout
    return res.status(200).json({
      success: true,
      checkout_url: paymentData.checkout_url || payment.checkout_url || null,
      orderId: orderDoc.id,
      paymentId: paymentId,
      gatewayReference: paymentRef,
      payment
    });

  } catch (e) {
    console.error('createGeniusPayment error:', e.message || e);
    
    const status = (e.response && e.response.status) || 502;
    const data = (e.response && e.response.data) || { error: e.message };
    
    return res.status(status).json({
      success: false,
      error: 'gateway_error',
      message: e.message,
      details: data
    });
  }
});

// GENIUSPAY WEBHOOK — traite les callbacks du gateway GeniusPay
// Configurez l'URL dans le dashboard GeniusPay vers:
// https://us-central1-je-suis-beatz.cloudfunctions.net/geniuspayWebhook
exports.geniuspayWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const payload = req.body || {};

    // GeniusPay sandbox webhook payload usually contains data.id and data.reference
    const gpData = payload.data || payload;
    const gpId = gpData.id || gpData.payment_id || gpData.gateway_id || null;
    const gpRef = gpData.reference || gpData.external_reference || null;
    const gpStatus = (gpData.status || gpData.scenario || payload.event || '').toString().toLowerCase();

    console.log('geniuspayWebhook received:', { gpId, gpRef, gpStatus });

    // Determine if this is a success notification
    const successIndicator = gpStatus.includes('success')
      || ['paid', 'completed', 'confirmed', 'succeeded'].includes(gpStatus)
      || gpData.scenario === 'success';

    const gpIdStr = gpId != null ? String(gpId) : null;
    const gpIdNum = (gpId != null && !Number.isNaN(Number(gpId))) ? Number(gpId) : null;
    const gpRefStr = gpRef != null ? String(gpRef) : null;

    async function findOrder(field, value) {
      if (value == null) return null;
      const snap = await db.collection('orders').where(field, '==', value).limit(1).get();
      return snap.empty ? null : snap;
    }

    let orderSnap = null;
    if (gpIdStr) {
      orderSnap = await findOrder('gatewayPaymentId', gpIdStr) || await findOrder('gatewayPaymentId', gpIdNum);
    }
    if ((!orderSnap || orderSnap.empty) && gpRefStr) {
      orderSnap = await findOrder('gatewayReference', gpRefStr);
    }
    if ((!orderSnap || orderSnap.empty) && gpIdStr) {
      orderSnap = await findOrder('gatewayResponse.data.id', gpIdStr) || await findOrder('gatewayResponse.data.id', gpIdNum);
    }
    if ((!orderSnap || orderSnap.empty) && gpRefStr) {
      orderSnap = await findOrder('gatewayResponse.data.reference', gpRefStr) || await findOrder('gatewayResponse.reference', gpRefStr);
    }

    if (!orderSnap || orderSnap.empty) {
      console.warn('geniuspayWebhook: order not found for gpId/gpRef', { gpId, gpRef });
      return res.status(200).send('Order not found — ignored');
    }

    const orderDoc = orderSnap.docs[0];
    const orderData = orderDoc.data();

    if (!successIndicator) {
      // Mark failed or update status accordingly
      await orderDoc.ref.update({ status: 'failed', gatewayResponse: gpData, updatedAt: adminSdk.firestore.FieldValue.serverTimestamp() });
      console.log('geniuspayWebhook: marked order failed', orderDoc.id);
      return res.status(200).send('Not a success event');
    }

    // Update order as completed
    await orderDoc.ref.update({
      status: 'completed',
      gatewayResponse: gpData,
      gatewayConfirmedAt: adminSdk.firestore.FieldValue.serverTimestamp(),
      confirmedAt: adminSdk.firestore.FieldValue.serverTimestamp()
    });

    // Send download email if we have customer email
    const customerEmail = orderData?.customer?.email || orderData?.customerEmail || null;
    if (customerEmail) {
      try {
        await sendPurchaseLicenseEmail(orderData, customerEmail, orderDoc.id);
      } catch (e) {
        console.error('geniuspayWebhook: purchase license email failed', e.message || e);
      }
    }

    console.log('✅ geniuspayWebhook: order completed', orderDoc.id);
    return res.status(200).send('OK');

  } catch (e) {
    console.error('geniuspayWebhook error:', e.message || e);
    return res.status(500).send('Internal error');
  }
});

// Export translateText separately so the function is always registered.
exports.translateText = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Connexion requise');
  if (!(await callerIsAdmin(context))) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const text = (data && data.text) ? String(data.text) : '';
  const target = (data && data.target) ? String(data.target) : 'en';
  if (!text || text.length < 1) {
    throw new functions.https.HttpsError('invalid-argument', 'text missing');
  }

  // Try configured Google Translate API key first
  let apiKey = null;
  try { apiKey = cfgOptional('translate.api_key') || process.env.GOOGLE_TRANSLATE_API_KEY || null; } catch (e) { apiKey = process.env.GOOGLE_TRANSLATE_API_KEY || null; }
  if (!apiKey) {
    // Try Secret Manager
    const s = await getSecretFromSecretManager('GOOGLE_TRANSLATE_API_KEY');
    if (s) apiKey = s;
  }

  try {
    if (apiKey) {
      // Use Google Translate REST endpoint
      const url = 'https://translation.googleapis.com/language/translate/v2';
      const params = { q: text, target, format: 'text', key: apiKey };
      const resp = await axios.post(url, null, { params, timeout: 15000 });
      const translated = resp.data && resp.data.data && resp.data.data.translations && resp.data.data.translations[0] && resp.data.data.translations[0].translatedText;
      if (translated) return { translated };
    }

    // Fallback: LibreTranslate public instance
    try {
      const fallback = await axios.post('https://libretranslate.de/translate', { q: text, source: 'auto', target }, { headers: { 'Content-Type': 'application/json' }, timeout: 12000 });
      if (fallback && fallback.data && fallback.data.translatedText) {
        return { translated: fallback.data.translatedText };
      }
    } catch (e) {
      console.warn('LibreTranslate fallback failed:', e.message || e);
    }

    throw new functions.https.HttpsError('internal', 'Translation unavailable');
  } catch (e) {
    console.error('translateText error:', e && e.message ? e.message : e);
    if (e instanceof functions.https.HttpsError) throw e;
    throw new functions.https.HttpsError('internal', 'Translation failed');
  }
});

// ─── Catalogue initial (GHOST) — sync Firestore via Admin SDK ───
const HOSTING_ORIGIN = 'https://je-suis-beatz.web.app';
const INITIAL_CATALOG_BEATS = [{
  title: 'GHOST',
  bpm: 142,
  genre: 'Drill',
  subgenre: 'Afro',
  priceBasic: 25,
  pricePremium: 50,
  priceWav: 100,
  priceUnlimited: 150,
  priceExclusive: 499,
  cover: 'image_beat_Ghost.jpeg',
  audio: 'Ghost.mp3',
  coverStorage: 'covers/ghost.jpeg',
  audioStorage: 'beats/ghost.mp3',
  status: 'available',
  desc_fr: 'Un beat Drill/Afro sombre et hypnotique, parfait pour les punchlines et le storytelling cinématique.',
  desc_en: 'A dark and hypnotic Drill/Afro beat, perfect for punchlines and cinematic storytelling.',
}];

function storagePublicUrl(bucketName, storagePath) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media`;
}

async function syncCatalogAssetToStorage(relativePath, storagePath, contentType) {
  if (!relativePath || /^https?:\/\//i.test(relativePath)) return relativePath;

  const bucket = adminSdk.storage().bucket();
  const file = bucket.file(storagePath);
  const hostingUrl = `${HOSTING_ORIGIN}/${relativePath.replace(/^\.\//, '')}`;

  const resp = await axios.get(hostingUrl, {
    responseType: 'arraybuffer',
    timeout: 180000,
    maxContentLength: 60 * 1024 * 1024,
    validateStatus: (s) => s === 200,
  });

  await file.save(Buffer.from(resp.data), {
    metadata: {
      contentType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });

  return storagePublicUrl(bucket.name, storagePath);
}

async function upsertCatalogBeat(beat, syncAssets = true) {
  const beatData = { ...beat };
  delete beatData.coverStorage;
  delete beatData.audioStorage;

  if (syncAssets) {
    if (beat.cover && beat.coverStorage) {
      beatData.cover = await syncCatalogAssetToStorage(
        beat.cover,
        beat.coverStorage,
        'image/jpeg',
      );
    }
    if (beat.audio && beat.audioStorage) {
      beatData.audio = await syncCatalogAssetToStorage(
        beat.audio,
        beat.audioStorage,
        'audio/mpeg',
      );
    }
  }

  const snap = await db.collection('beats').where('title', '==', beat.title).limit(1).get();
  if (snap.empty) {
    const ref = await db.collection('beats').add({
      ...beatData,
      createdAt: adminSdk.firestore.FieldValue.serverTimestamp(),
    });
    return { title: beat.title, action: 'created', id: ref.id, cover: beatData.cover, audio: beatData.audio };
  }

  await snap.docs[0].ref.set({
    ...beatData,
    updatedAt: adminSdk.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return { title: beat.title, action: 'updated', id: snap.docs[0].id, cover: beatData.cover, audio: beatData.audio };
}

async function purgeTrapBeatsFromFirestore() {
  let deleted = 0;
  const seen = new Set();

  const queries = [
    db.collection('beats').where('genre', '==', 'Trap'),
    db.collection('beats').where('title', '==', 'TRAP'),
    db.collection('beats').where('title', '==', 'Trap'),
    db.collection('beats').where('genre', '==', 'trap'),
    db.collection('beats').where('title', '==', 'trap'),
  ];

  for (const query of queries) {
    const snap = await query.get();
    for (const doc of snap.docs) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      await doc.ref.delete();
      deleted += 1;
    }
  }

  return { deleted, ids: [...seen] };
}

exports.ensureCatalogBeats = functions.https.onCall(async (data, context) => {
  if (!(await callerIsAdmin(context))) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const action = String(data?.action || '').trim();

  // action: delete — supprimer un beat (Admin SDK, contourne les règles client)
  if (action === 'delete') {
    const { beatId, title } = data;
    let deleted = 0;

    if (beatId && typeof beatId === 'string' && !beatId.startsWith('catalog-')) {
      const ref = db.collection('beats').doc(beatId);
      const doc = await ref.get();
      if (doc.exists) {
        await ref.delete();
        deleted += 1;
      }
    }

    if (title && typeof title === 'string') {
      for (const variant of [title.toUpperCase(), title]) {
        const snap = await db.collection('beats').where('title', '==', variant).get();
        for (const doc of snap.docs) {
          await doc.ref.delete();
          deleted += 1;
        }
      }
    }

    return { success: true, deleted };
  }

  if (action === 'purgeTrap') {
    return { success: true, ...(await purgeTrapBeatsFromFirestore()) };
  }

  if (action === 'seedGhost' || action === 'syncCatalog') {
    const results = [];
    const syncAssets = data?.syncAssets !== false;
    for (const beat of INITIAL_CATALOG_BEATS) {
      try {
        results.push(await upsertCatalogBeat(beat, syncAssets));
      } catch (assetErr) {
        console.error('ensureCatalogBeats failed:', beat.title, assetErr.message || assetErr);
        results.push({ title: beat.title, action: 'error', error: assetErr.message || String(assetErr) });
      }
    }
    return { success: true, results };
  }

  throw new functions.https.HttpsError('invalid-argument', 'Action must be delete, purgeTrap or seedGhost');
});

// Bootstrap one-shot : POST avec en-tête X-Seed-Key (téléverse assets + Firestore)
exports.seedGhostCatalogHttp = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  const key = req.get('X-Seed-Key') || req.query.key;
  if (key !== 'jsb-ghost-catalog-2026') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  try {
    const results = [];
    for (const beat of INITIAL_CATALOG_BEATS) {
      results.push(await upsertCatalogBeat(beat, true));
    }
    res.json({ success: true, results });
  } catch (e) {
    console.error('seedGhostCatalogHttp:', e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

exports.purgeTrapHttp = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  const key = req.get('X-Seed-Key') || req.query.key;
  if (key !== 'jsb-ghost-catalog-2026') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  try {
    const result = await purgeTrapBeatsFromFirestore();
    res.json({ success: true, ...result });
  } catch (e) {
    console.error('purgeTrapHttp:', e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Audio proxy: relaie une URL distante (ex: Firebase Storage) et ajoute les en-têtes CORS
// Usage: https://us-central1-je-suis-beatz.cloudfunctions.net/audioProxy?u=<ENCODED_URL>
exports.audioProxy = functions.https.onRequest(async (req, res) => {
  // CORS headers — allow both production and development origins
  try {
    const origin = req.get('origin') || req.get('Origin') || '';
    const allowedOrigins = [
      'https://je-suis-beatz.web.app',
      'https://je-suis-beatz.firebaseapp.com',
      'http://localhost:8000',
      'http://localhost:3000',
      'http://127.0.0.1:8000',
      'http://127.0.0.1:3000'
    ];
    
    if (allowedOrigins.includes(origin) || origin.includes('localhost') || origin.includes('127.0.0.1')) {
      res.set('Access-Control-Allow-Origin', origin || HOSTING_ORIGIN);
    } else {
      res.set('Access-Control-Allow-Origin', HOSTING_ORIGIN);
    }
    
    res.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Origin,Accept,Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).send('');

    const remoteUrl = String(req.query.u || req.query.url || '').trim();
    if (!remoteUrl) return res.status(400).send('Missing url parameter (u)');

    // Fetch remote resource as stream and pipe back to client
    const resp = await axios.get(remoteUrl, { responseType: 'stream', timeout: 30000 });
    const contentType = resp.headers['content-type'] || 'audio/mpeg';
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=3600');
    resp.data.pipe(res);
  } catch (err) {
    console.error('audioProxy error:', err && err.message ? err.message : err);
    try { return res.status(502).send('Bad gateway'); } catch(e) { /* noop */ }
  }
});

exports.purgeTrapHttp = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  const key = req.get('X-Seed-Key') || req.query.key;
  if (key !== 'jsb-ghost-catalog-2026') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  try {
    const result = await purgeTrapBeatsFromFirestore();
    res.json({ success: true, ...result });
  } catch (e) {
    console.error('purgeTrapHttp:', e);
    res.status(500).json({ error: e.message || String(e) });
  }
});
