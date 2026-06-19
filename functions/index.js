// Cloud Functions entrypoint for Je Suis Beatz
// Deploy with: firebase deploy --only functions

const functions = require('firebase-functions');
const adminSdk  = require('firebase-admin');
const axios     = require('axios');
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
  const adminDoc = await db.collection('admins').doc(uid).get();
  if (adminDoc.exists && adminDoc.data().isAdmin === true) return true;

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

    await sendDownloadEmail(orderData, payerEmail);

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

    await sendDownloadEmail(orderData, orderData.customerEmail);

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
  let isAdmin = adminDoc.exists && adminDoc.data().isAdmin === true;

  const userDoc = await db.collection('users').doc(uid).get();
  if (!email && userDoc.exists) {
    email = (userDoc.data().email || '').toLowerCase();
  }

  // Comptes admin historiques (users.role) ou email propriétaire du site
  if (!isAdmin) {
    const legacyAdmin = userDoc.exists && userDoc.data().role === 'admin';
    const bootstrapAdmin = BOOTSTRAP_ADMIN_EMAILS.includes(email);
    if (legacyAdmin || bootstrapAdmin) {
      await db.collection('admins').doc(uid).set({ isAdmin: true, email }, { merge: true });
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
exports.getBeatUploadUrl = functions.https.onCall(async (data, context) => {
  if (!(await callerIsAdmin(context))) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { path, contentType } = data || {};
  if (!path || typeof path !== 'string' || !/^(covers|beats)\/[a-zA-Z0-9._-]+$/.test(path)) {
    throw new functions.https.HttpsError('invalid-argument', 'Chemin invalide');
  }

  const bucket = adminSdk.storage().bucket();
  const file = bucket.file(path);
  const expires = Date.now() + 20 * 60 * 1000;
  const [uploadUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires,
    contentType: contentType || 'application/octet-stream',
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
  if (!beat || typeof beat !== 'object' || !beat.title || !beat.bpm) {
    throw new functions.https.HttpsError('invalid-argument', 'Données beat invalides');
  }

  const payload = { ...beat };
  delete payload.id;

  if (beatId && typeof beatId === 'string' && !beatId.startsWith('catalog-')) {
    await db.collection('beats').doc(beatId).set(payload, { merge: true });
    return { id: beatId, action: 'updated' };
  }

  const ref = await db.collection('beats').add({
    ...payload,
    createdAt: adminSdk.firestore.FieldValue.serverTimestamp(),
  });
  return { id: ref.id, action: 'created' };
});

exports.getAdminUserStats = functions.https.onCall(async (data, context) => {
  if (!(await callerIsAdmin(context))) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const totalSnapshot = await db.collection('users').count().get();
  const totalCount = totalSnapshot.data()?.count || 0;
  const usersSnap = await db.collection('users')
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();

  const users = usersSnap.docs.map((doc) => {
    const d = doc.data();
    return {
      uid: doc.id,
      username: d.username || '—',
      email: d.email || '—',
      createdAt: d.createdAt?.toMillis?.() || d.createdAt?._seconds * 1000 || null,
    };
  });

  return { count: totalCount, users, partial: users.length < totalCount };
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

async function sendDownloadEmail(orderData, email) {
  if (!email) return;

  try {
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

    const items = (orderData.items || orderData.cartItems || [])
      .map(i => `<li><strong>${i.beatTitle || i.title}</strong> — Licence ${i.license} ($${i.price})</li>`)
      .join('');

    const msg = {
      to:      email,
      from:    { email: 'noreply@je-suis-beatz.com', name: 'Je Suis Beatz' },
      replyTo: 'jesuisthebeatmaker@gmail.com',
      subject: '🎵 Votre beat est prêt — Je Suis Beatz',
      html: `
<p>Merci pour votre achat !</p>
<ul>${items}</ul>
`
    };

    await sgMail.send(msg);
  } catch (e) {
    console.error('Erreur envoi email:', e.message || e);
  }
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
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = req.body || {};
    const orderData = body.orderData;
    
    if (!orderData) {
      return res.status(400).json({ error: 'orderData missing' });
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

    console.log('Creating GeniusPay payment for amount:', orderData.amount);

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
      metadata: orderData.metadata || null,
      cartItems: orderData.metadata?.cart || [],
      items: orderData.items || [],
      customer: {
        name: orderData.customer_name || null,
        email: orderData.customer_email || null,
        phone: orderData.customer_phone || null
      }
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
    const successIndicator = gpStatus.includes('success') || gpStatus === 'paid' || gpData.scenario === 'success';

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
        await sendDownloadEmail(orderData, customerEmail);
      } catch (e) {
        console.error('geniuspayWebhook: sendDownloadEmail failed', e.message || e);
      }
    }

    console.log('✅ geniuspayWebhook: order completed', orderDoc.id);
    return res.status(200).send('OK');

  } catch (e) {
    console.error('geniuspayWebhook error:', e.message || e);
    return res.status(500).send('Internal error');
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
  priceExclusive: 300,
  cover: 'image_beat_Ghost.jpeg',
  audio: 'Ghost.mpeg',
  coverStorage: 'covers/ghost.jpeg',
  audioStorage: 'beats/ghost.mpeg',
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

  // action: delete — supprimer un beat (Admin SDK, contourne les règles client)
  if (data?.action === 'delete') {
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

  if (data?.action === 'purgeTrap') {
    return { success: true, ...(await purgeTrapBeatsFromFirestore()) };
  }

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
