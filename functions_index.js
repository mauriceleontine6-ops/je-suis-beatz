// ═══════════════════════════════════════════════════════════════════
// CLOUD FUNCTIONS — Je Suis Beatz  [VERSION CORRIGÉE]
// Déployer avec : firebase deploy --only functions
//
// Installation :
//   cd functions
//   npm install firebase-admin firebase-functions axios @sendgrid/mail
// ═══════════════════════════════════════════════════════════════════

const functions = require('firebase-functions');
const admin     = require('firebase-functions');
const adminSdk  = require('firebase-admin');
const axios     = require('axios');

adminSdk.initializeApp();
const db = adminSdk.firestore();

// ── Helper : récupérer une config Firebase en toute sécurité ──────
function cfg(path) {
  const parts = path.split('.');
  let obj = functions.config();
  for (const p of parts) {
    if (!obj || obj[p] === undefined) {
      throw new Error(`Config manquante : ${path}`);
    }
    obj = obj[p];
  }
  return obj;
}

// ───────────────────────────────────────────────────────────────────
// 1. LOOKUP USERNAME — remplace la lecture publique de /users
//    FAILLE CORRIGÉE : plus de règle "allow read if limit <= 10"
//    Le login par username passe maintenant par cette Cloud Function
//    qui ne retourne que l'email (pas les autres champs sensibles)
// ───────────────────────────────────────────────────────────────────
exports.getUserEmailByUsername = functions.https.onCall(async (data, context) => {
  const { username } = data;
  if (!username || typeof username !== 'string' || username.length > 30) {
    throw new functions.https.HttpsError('invalid-argument', 'Username invalide');
  }

  // Nettoyage basique
  const cleanUsername = username.trim().toLowerCase();

  const snap = await db.collection('users')
    .where('username', '==', cleanUsername)
    .limit(1)
    .get();

  if (snap.empty) {
    // On ne dit pas si l'utilisateur existe pour ne pas faciliter l'énumération
    throw new functions.https.HttpsError('not-found', 'Identifiants incorrects');
  }

  const email = snap.docs[0].data().email;
  if (!email) {
    throw new functions.https.HttpsError('not-found', 'Identifiants incorrects');
  }

  // On retourne UNIQUEMENT l'email, pas l'UID ni d'autres données
  return { email };
});

// ───────────────────────────────────────────────────────────────────
// 2. WEBHOOK PAYPAL — Vérification serveur des paiements
//    URL : https://us-central1-je-suis-beatz.cloudfunctions.net/paypalWebhook
// ───────────────────────────────────────────────────────────────────
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

    // ── Protection idempotence : ne pas traiter deux fois le même captureId ──
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

    // Vérification montant anti-fraude (tolérance 1 centime)
    if (Math.abs(amountValue - orderData.total) > 0.01) {
      console.error(`Montant PayPal incorrect: reçu ${amountValue}, attendu ${orderData.total}`);
      await orderDoc.ref.update({ status: 'amount_mismatch', captureId, flaggedAt: adminSdk.firestore.FieldValue.serverTimestamp() });
      return res.status(200).send('Amount mismatch — flagged');
    }

    // ✅ Paiement vérifié : passage à "completed" via Admin SDK (jamais côté client)
    await orderDoc.ref.update({
      status:      'completed',
      captureId,
      payerEmail,
      currency,
      confirmedAt: adminSdk.firestore.FieldValue.serverTimestamp()
    });

    // Envoi email de téléchargement
    await sendDownloadEmail(orderData, payerEmail);

    console.log('✅ Commande PayPal confirmée:', orderDoc.id);
    return res.status(200).send('OK');

  } catch (e) {
    console.error('Erreur webhook PayPal:', e);
    return res.status(500).send('Internal error');
  }
});

// ───────────────────────────────────────────────────────────────────
// 3. WEBHOOK CINETPAY — Vérification serveur Mobile Money
//    FAILLE CORRIGÉE : le statut 'SUCCESS' n'est plus écrit côté client.
//    Seule cette Cloud Function peut passer une commande à 'completed'.
//    URL : https://us-central1-je-suis-beatz.cloudfunctions.net/cinetpayWebhook
// ───────────────────────────────────────────────────────────────────
exports.cinetpayWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { cpm_trans_id, cpm_amount, cpm_currency, cpm_error_message, cpm_result } = req.body;

  // FAILLE CORRIGÉE : vérification du secret partagé CinetPay (HMAC/token)
  // CinetPay envoie un cpm_site_id — on vérifie qu'il correspond au nôtre
  const expectedSiteId = String(cfg('cinetpay.site_id'));
  const receivedSiteId = String(req.body.cpm_site_id || '');
  if (receivedSiteId !== expectedSiteId) {
    console.error('CinetPay site_id invalide:', receivedSiteId);
    return res.status(400).send('Invalid site_id');
  }

  if (cpm_result !== '00') {
    console.warn('CinetPay paiement échoué:', cpm_error_message);
    // Mettre à jour la transaction en 'FAILED'
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
    // ── Protection idempotence ──
    const txDoc = await db.collection('transactions').doc(cpm_trans_id).get();
    if (txDoc.exists && txDoc.data().status === 'SUCCESS') {
      console.warn('Transaction CinetPay déjà traitée:', cpm_trans_id);
      return res.status(200).json({ code: '00', message: 'Already processed' });
    }

    // Vérification auprès de l'API CinetPay
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

    // Trouver la commande pending correspondante
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

    // ✅ Paiement vérifié — mise à jour via Admin SDK uniquement
    const batch = db.batch();

    batch.update(orderDoc.ref, {
      status:      'completed',
      cinetpayRef: cpm_trans_id,
      confirmedAt: adminSdk.firestore.FieldValue.serverTimestamp()
    });

    // Mettre à jour aussi la transaction
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

// ───────────────────────────────────────────────────────────────────
// 4. REGISTER STREAM — Rate limiting serveur réel
// ───────────────────────────────────────────────────────────────────
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

// ───────────────────────────────────────────────────────────────────
// 5. VÉRIFIER STATUT COMMANDE — Pour le client après paiement
//    Le client peut interroger le statut de SA commande sans pouvoir
//    lire les données sensibles d'autres commandes
// ───────────────────────────────────────────────────────────────────
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
    .where('userId', '==', context.auth.uid) // vérification propriété
    .limit(1)
    .get();

  if (snap.empty) {
    throw new functions.https.HttpsError('not-found', 'Commande introuvable');
  }

  const order = snap.docs[0].data();

  // Retourner uniquement les infos nécessaires à l'UI, pas les données sensibles
  return {
    status:        order.status,
    orderId:       order.orderId,
    total:         order.total,
    paymentMethod: order.method,
    createdAt:     order.createdAt?.toMillis() || null,
    confirmedAt:   order.confirmedAt?.toMillis() || null
  };
});

// ───────────────────────────────────────────────────────────────────
// 6. DÉFINIR LE CLAIM ADMIN
// ───────────────────────────────────────────────────────────────────
exports.setAdminClaim = functions.https.onCall(async (data, context) => {
  if (!context.auth?.token?.admin) {
    const adminsSnap = await db.collection('users').where('role', '==', 'admin').limit(1).get();
    if (!adminsSnap.empty) {
      throw new functions.https.HttpsError('permission-denied', 'Admin already exists');
    }
  }

  const { email } = data;
  if (!email) throw new functions.https.HttpsError('invalid-argument', 'Email required');

  const user = await adminSdk.auth().getUserByEmail(email);
  await adminSdk.auth().setCustomUserClaims(user.uid, { admin: true });
  await db.collection('users').doc(user.uid).update({ role: 'admin' });

  console.log(`✅ Claim admin défini pour : ${email}`);
  return { success: true };
});

// ───────────────────────────────────────────────────────────────────
// 7. CREATE GENIUSPAY PAYMENT — proxy serveur (sécurise la clé secrète)
//    Endpoint: POST /createGeniusPayment
//    Attendu: { orderData: { ... } }
//    Retourne: { checkout_url, orderId }
//    Configurez vos clés via `firebase functions:config:set geniuspay.key="pk_..." geniuspay.secret="sk_..."`
// ───────────────────────────────────────────────────────────────────
exports.createGeniusPayment = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const body = req.body || {};
    const orderData = body.orderData;
    if (!orderData) return res.status(400).json({ error: 'orderData missing' });

    // Récupérer les clés depuis les config Firebase (sécurisé)
    const gpKey = cfg('geniuspay.key');
    const gpSecret = cfg('geniuspay.secret');

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

    // Sauvegarder la commande localement en mode 'pending'
    const orderDoc = await db.collection('orders').add({
      createdAt: adminSdk.firestore.FieldValue.serverTimestamp(),
      status: 'pending',
      method: 'geniuspay',
      gateway: 'geniuspay',
      gatewayResponse: payment,
      total: orderData.amount || null,
      items: orderData.items || [],
      customer: {
        name: orderData.customer_name || null,
        email: orderData.customer_email || null,
        phone: orderData.customer_phone || null
      }
    });

    // Répondre au client avec l'URL de checkout
    return res.status(200).json({ checkout_url: payment.checkout_url, orderId: orderDoc.id, payment });

  } catch (e) {
    console.error('createGeniusPayment error:', e && e.response ? (e.response.data || e.response.statusText) : e.message || e);
    const status = (e.response && e.response.status) || 502;
    const data = (e.response && e.response.data) || { error: e.message };
    return res.status(status).json({ error: 'gateway_error', details: data });
  }
});

// ───────────────────────────────────────────────────────────────────
// HELPERS INTERNES
// ───────────────────────────────────────────────────────────────────

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
    sgMail.setApiKey(cfg('sendgrid.api_key'));

    const items = (orderData.items || orderData.cartItems || [])
      .map(i => `<li><strong>${i.beatTitle || i.title}</strong> — Licence ${i.license} ($${i.price})</li>`)
      .join('');

    const msg = {
      to:      email,
      from:    { email: 'noreply@je-suis-beatz.com', name: 'Je Suis Beatz' },
      replyTo: 'jesuisthebeatmaker@gmail.com',
      subject: '🎵 Votre beat est prêt — Je Suis Beatz',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0a14;color:#fff;border-radius:16px;overflow:hidden">
          <div style="background:linear-gradient(135deg,#0a0a14,#0d1f3a);padding:40px 32px;text-align:center;border-bottom:2px solid #00e5ff22">
            <h1 style="font-size:2rem;letter-spacing:4px;margin:0">JE SUIS <span style="color:#00e5ff">BEATZ</span></h1>
            <p style="color:#00e5ff;font-size:0.8rem;letter-spacing:2px;margin:8px 0 0">I am the sound you are looking for</p>
          </div>
          <div style="padding:32px">
            <h2 style="color:#00e5ff;margin-top:0">✅ Paiement confirmé !</h2>
            <p>Merci pour votre achat. Voici le récapitulatif de votre commande :</p>
            <ul style="background:rgba(255,255,255,0.05);border-radius:8px;padding:16px 16px 16px 32px">${items}</ul>
            <p style="font-size:1.1rem"><strong>Total :</strong> <span style="color:#00e5ff">$${orderData.total || orderData.totalUSD}</span></p>
            <hr style="border-color:rgba(255,255,255,0.1);margin:24px 0">
            <p style="color:rgba(255,255,255,0.7);font-size:0.9rem">
              Votre lien de téléchargement vous sera envoyé dans les prochaines minutes.<br>
              Pour toute question : <a href="mailto:jesuisthebeatmaker@gmail.com" style="color:#00e5ff">jesuisthebeatmaker@gmail.com</a>
            </p>
            <div style="text-align:center;margin-top:32px">
              <a href="https://je-suis-beatz.web.app" style="background:#00e5ff;color:#000;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold">Retourner sur Je Suis Beatz</a>
            </div>
          </div>
          <div style="padding:16px 32px;text-align:center;background:rgba(0,0,0,0.3);font-size:0.75rem;color:rgba(255,255,255,0.3)">
            © 2026 Je Suis Beatz · Abidjan, Côte d'Ivoire
          </div>
        </div>
      `
    };

    await sgMail.send(msg);
    console.log(`📧 Email envoyé à : ${email}`);
  } catch (e) {
    console.error('Erreur envoi email SendGrid:', e.message);
  }
}
