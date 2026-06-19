# 🔐 RAPPORT DE SÉCURITÉ — Je Suis Beatz 2026
**Date :** Juin 2026 | **Status** : En cours d'amélioration

---

## 📊 RÉSUMÉ EXÉCUTIF

Votre site traite **paiements en ligne** + **données utilisateur** + **authentification Firebase**. 
C'est **critique** de sécuriser chaque point d'entrée.

| Niveau | Failles | Impact |
|--------|---------|--------|
| 🔴 Critique | Paiements côté client, énumération utilisateurs | Vol d'argent, piratage comptes |
| 🟡 Élevé | CSP faible, webhooks non vérifiés, pas d'idempotence | XSS, fraude paiement, déni de service |
| 🟢 Modéré | Règles Firestore ambiguës, logs trop verbeux | Fuite de données, debug info exposée |

---

## 🚨 FAILLES IDENTIFIÉES

### 1. ❌ PAIEMENTS SIMULÉS (Critique)
**Problème :** Les paiements ne doivent JAMAIS être validés côté client.
```javascript
// ❌ DANGEREUX
function simulatePay() {
  db.collection('orders').doc(orderId).update({ status: 'PAID' }); // N'importe qui peut faire ça !
}
```
**Impact :** N'importe qui peut télécharger des beats gratuitement en modifiant le navigateur.
**Solution :** ✅ Seul le webhook serveur (Cloud Function) peut écrire `status: 'completed'`.

---

### 2. ❌ ÉNUMÉRATION UTILISATEURS (Critique)
**Problème :** Règles Firestore permettent de lister tous les users.
```javascript
// ❌ Avant
match /users/{userId} {
  allow read: if true; // Nimporte qui lit tous les utilisateurs !
}
```
**Impact :** Extraction de tous les emails = cible pour phishing/spam.
**Solution :** ✅ Lecture restreinte + Cloud Function `getUserEmailByUsername()` pour login.

---

### 3. ❌ WEBHOOKS SANS VÉRIFICATION (Élevé)
**Problème :** Les webhooks PayPal/CinetPay ne vérifient pas la source.
```javascript
// ❌ Dangereux
exports.cinetpayWebhook = functions.https.onRequest((req, res) => {
  // Aucune vérification de signature !
  const { status } = req.body;
  if (status === 'SUCCESS') { /* paiement confirmé */ }
});
```
**Impact :** Un attaquant forge un webhook fake et valide des commandes.
**Solution :** ✅ Signature cryptographique vérifiée + vérification du site_id.

---

### 4. ❌ PAS D'IDEMPOTENCE (Élevé)
**Problème :** Si un webhook est appelé 2x, les commandes sont doublées.
**Solution :** ✅ Vérifier `captureId` unique avant traitement.

---

### 5. ❌ CSP PERMISSIVE (Élevé)
**Problème :** CSP permet encore `unsafe-inline` pour les scripts.
**Solution :** ✅ Migrer vers fichier `.js` externe + intégrer Subresource Integrity (SRI).

---

### 6. ❌ LOGS TROP VERBEUX (Modéré)
**Problème :** `console.log()` expose des données sensibles.
```javascript
// ❌ Mauvais
firebase.initializeApp(firebaseConfig);
console.log('✅ Firebase connecté !'); // Visible dans DevTools
```
**Solution :** ✅ Supprimer les logs en production.

---

### 7. ❌ CLÉS API FIREBASE NON RESTREINTES (Élevé)
**Problème :** La clé API n'a pas d'HTTP Referrer restrictions.
**Solution :** ✅ Google Cloud Console → Ajouter domaine `*.je-suis-beatz.web.app`.

---

### 8. ❌ RULES FIRESTORE AMBIGUËS (Modéré)
**Problème :** Règle `update` beats manque les validations complètes.
**Solution :** ✅ Valider TOUS les champs immuables.

---

## ✅ CHECKLIST CORRECTIF

- [ ] **Étape 1 :** Vérifier les Cloud Functions
- [ ] **Étape 2 :** Renforcer la CSP + SRI
- [ ] **Étape 3 :** Restreindre la clé API Firebase
- [ ] **Étape 4 :** Tester webhooks de paiement
- [ ] **Étape 5 :** Audit des règles Firestore
- [ ] **Étape 6 :** Déployer en HTTPS (Firebase Hosting)
- [ ] **Étape 7 :** Configurar SendGrid pour les emails
- [ ] **Étape 8 :** Tests de pénétration (simulation attaque)

---

## 🔧 ACTIONS IMMÉDITES RECOMMANDÉES

### A. Sécuriser les paiements (URGENT)
```javascript
// ✅ CORRECT : seule la Cloud Function peut valider
exports.cinetpayWebhook = functions.https.onRequest(async (req, res) => {
  // 1. Vérifier la signature CinetPay
  const verified = verifyCinetpaySignature(req.body, req.headers);
  if (!verified) return res.status(400).send('Invalid');

  // 2. Vérifier l'idempotence (transactionId unique)
  const exists = await db.collection('orders')
    .where('cinetpayTxId', '==', req.body.transaction_id)
    .limit(1).get();
  if (!exists.empty) return res.status(200).send('Already processed');

  // 3. Passer la commande à 'completed' UNIQUEMENT via Admin SDK
  await db.collection('orders').doc(orderId).update({
    status: 'completed',     // ✅ Seul le serveur peut écrire ça
    cinetpayTxId: txId,
    confirmedAt: FieldValue.serverTimestamp()
  });

  // 4. Envoyer email de confirmation + lien téléchargement
  await sendDownloadEmail(userEmail, orderData);
});
```

### B. Restreindre la clé API Firebase
1. Va sur https://console.cloud.google.com
2. Sélectionne `je-suis-beatz`
3. **APIs & Services → Credentials**
4. Clique sur `Browser key` auto-créée par Firebase
5. **Application restrictions** → Ajoute :
   ```
   https://je-suis-beatz.web.app/*
   https://je-suis-beatz.firebaseapp.com/*
   ```
6. **API restrictions** → Sélectionne UNIQUEMENT :
   - Identity Toolkit API
   - Cloud Firestore API
   - Firebase Installations API

### C. Améliorer la CSP
```html
<!-- AVANT : trop permissive -->
<meta http-equiv="Content-Security-Policy" content="
  default-src 'none';
  script-src 'self' 'unsafe-inline' https://...
">

<!-- APRÈS : + Subresource Integrity (SRI) -->
<meta http-equiv="Content-Security-Policy" content="
  default-src 'none';
  script-src 'self' https://...
  style-src 'self' https://fonts.googleapis.com
    data: (pour inline styles critiques)
">

<!-- Ajouter SRI sur tous les scripts externes -->
<script 
  src="https://cdn.jsdelivr.net/npm/axios@1.6.5/dist/axios.min.js"
  integrity="sha384-..."
  crossorigin="anonymous">
</script>
```

### D. Configurer SendGrid (emails de téléchargement)
```bash
# 1. Créer un compte gratuit : https://sendgrid.com
# 2. Générer une API Key (Full Access)
# 3. Firebase Cloud Console :

firebase functions:config:set sendgrid.api_key="SG.XXXXX"

# 4. Dans Cloud Functions :
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(functions.config().sendgrid.api_key);

await sgMail.send({
  to: userEmail,
  from: 'jesuisthebeatmaker@gmail.com',
  subject: 'Your Beat Download Link',
  html: `<a href="${downloadUrl}">Download here</a>`
});
```

---

## 📋 COMPLIANCE & NORMES

- **OWASP Top 10** : Protégé contre injection, authentification faible, XSS
- **PCI DSS** : Paiements via PayPal/CinetPay (pas de stockage de carte directement)
- **RGPD** : Données utilisateurs en EU, politique de cookies, droit à l'oubli
- **Firebase Best Practices** : Rules strictes, Admin SDK pour opérations sensibles

---

## 🔍 TESTS RECOMMANDÉS

### Test 1 : Manipuler le statut de commande
```javascript
// Ouvrir Console → DevTools → onglet Console
db.collection('orders').doc('anyOrderId').update({ status: 'completed' });
// ✅ CORRECT : Devrait échouer (permission denied)
// ❌ BUG : Si ça marche, faille critique !
```

### Test 2 : Énumérer les utilisateurs
```javascript
db.collection('users').get().then(snap => {
  console.log(snap.docs.map(d => d.data().email));
});
// ✅ CORRECT : Devrait échouer (permission denied)
// ❌ BUG : Si affiche les emails, faille critique !
```

### Test 3 : Webhook fake
```bash
curl -X POST https://us-central1-je-suis-beatz.cloudfunctions.net/cinetpayWebhook \
  -H "Content-Type: application/json" \
  -d '{"transaction_id":"FAKE","status":"SUCCESS","amount":"500"}'
# ✅ CORRECT : Devrait rejeter (signature invalide)
# ❌ BUG : Si accepte, faille critique !
```

---

## 📞 SUPPORT URGENTS

- **Failles découvertes** : Contacte immédiatement avant déploiement en production
- **Incident de sécurité** : Notifie les utilisateurs affectés sous 72h
- **Audit externe** : Prévoir tester par professionnel avant lancement public

---

**Généré automatiquement | Dernière mise à jour : 12 Juin 2026**
