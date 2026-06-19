# 🚀 GUIDE DE DÉPLOIEMENT SÉCURISÉ
**Je Suis Beatz — Mise en production progressive**

---

## 📋 PRÉREQUIS

```bash
# 1. Installer Firebase CLI
npm install -g firebase-tools@latest

# 2. Se connecter à Firebase
firebase login

# 3. Sélectionner le projet
firebase use je-suis-beatz

# 4. Vérifier la configuration
firebase projects:list
firebase projects:describe je-suis-beatz
```

---

## PHASE 1 : Configuration Firebase Cloud (Avant déploiement)

### Étape 1.1 : Configurer les secrets (Cloud Functions)

```bash
# ═══ PayPal ═══
# Récupérer les infos sur : https://developer.paypal.com
# → Apps & Credentials → Sandbox / Live

firebase functions:config:set \
  paypal.client_id="YOUR_REAL_CLIENT_ID_PAYPAL" \
  paypal.client_secret="YOUR_REAL_CLIENT_SECRET_PAYPAL" \
  paypal.webhook_id="YOUR_WEBHOOK_ID_PAYPAL"

# ═══ CinetPay ═══
# Récupérer les infos sur : https://dashboard.cinetpay.com
# → API Settings

firebase functions:config:set \
  cinetpay.api_key="YOUR_API_KEY_CINETPAY" \
  cinetpay.site_id="393509"

# ═══ SendGrid ═══
# Créer un compte gratuit sur : https://sendgrid.com
# Settings → API Keys → Create API Key (Full Access)

firebase functions:config:set \
  sendgrid.api_key="SG.XXXXXXXXXXXXXXXXXXXXX"

# Vérifier que tout est bien configuré
firebase functions:config:get
```

### Étape 1.2 : Restreindre la clé API Firebase

1. Va sur https://console.cloud.google.com
2. Sélectionne le projet `je-suis-beatz`
3. **APIs & Services** → **Credentials**
4. Clique sur la clé `Browser key` (auto-créée par Firebase)
5. **Application restrictions**
   - Type : HTTP referrers
   - Ajoute :
     ```
     https://je-suis-beatz.web.app/*
     https://je-suis-beatz.firebaseapp.com/*
     ```
6. **API restrictions**
   - Clique "Restrict key"
   - Sélectionne UNIQUEMENT :
     - Cloud Firestore API
     - Identity Toolkit API
     - Firebase Installations API
7. **Save**

### Étape 1.3 : Configurer les webhooks PayPal

1. Va sur https://developer.paypal.com
2. Accède au **Business Account** (Sandbox OU Live selon besoin)
3. **Apps & Credentials** → **Webhooks** (lister les endpoints)
4. **Create Webhook** (si n'existe pas)
   - **Event Receiver URL** :
     ```
     https://us-central1-je-suis-beatz.cloudfunctions.net/paypalWebhook
     ```
   - **Events to subscribe to** : `PAYMENT.CAPTURE.COMPLETED` (UNIQUEMENT)
   - **Create Webhook**
5. Copier le **Webhook ID** → Configurer dans Firebase (Étape 1.1)
6. **Test webhook** : Envoyer un test depuis le dashboard

### Étape 1.4 : Configurer les webhooks CinetPay

1. Va sur https://dashboard.cinetpay.com
2. **Paramètres** → **IPN / Webhooks**
3. **Ajouter un webhook**
   - **URL de notification** :
     ```
     https://us-central1-je-suis-beatz.cloudfunctions.net/cinetpayWebhook
     ```
   - **Méthode** : `POST`
   - **Save**
4. **Tester le webhook** : Bouton "Test"

---

## PHASE 2 : Déploiement Local & Tests

### Étape 2.1 : Tester localement avec l'émulateur

```bash
# Lancer l'émulateur Firebase
firebase emulators:start

# Dans une autre terminal, tester les règles Firestore
firebase emulators:exec "npm test" -- --only firestore

# Vérifier que tout marche en local AVANT de déployer en production !
```

### Étape 2.2 : Tests de sécurité locaux

```bash
# Test 1 : Un utilisateur ne peut pas devenir admin
# (Ouvrir https://localhost:5000 → DevTools Console)
db.collection('users').doc(auth.currentUser.uid).update({ role: 'admin' })
// ✅ CORRECT : Permission denied

# Test 2 : Un utilisateur ne peut pas modifier une commande
db.collection('orders').doc('someOrderId').update({ status: 'completed' })
// ✅ CORRECT : Permission denied
```

---

## PHASE 3 : Déploiement en Production

### ⚠️ ORDRE CRITIQUE (NE PAS CHANGER)

```bash
# 1️⃣ FIRESTORE RULES (sécurité avant données)
firebase deploy --only firestore:rules

# 2️⃣ FIRESTORE INDEXES (pour les requêtes)
firebase deploy --only firestore:indexes

# 3️⃣ CLOUD FUNCTIONS (webhooks + logique backend)
firebase deploy --only functions

# 4️⃣ HOSTING (site web)
firebase deploy --only hosting
```

### Étape 3.1 : Déployer les règles Firestore

```bash
firebase deploy --only firestore:rules --verbose

# Vérifier qu'il n'y a pas d'erreurs
# Output doit afficher : ✓ Rules

# Attendre 30-60 secondes (propagation)
```

### Étape 3.2 : Déployer les Cloud Functions

```bash
firebase deploy --only functions --verbose

# Attendre que les functions se déploient (peut prendre 2-5 min)
# Vérifier qu'il n'y a pas d'erreurs

# Consulter les logs (optionnel)
firebase functions:log --limit 50
```

### Étape 3.3 : Déployer le site Hosting

```bash
firebase deploy --only hosting --verbose

# Vérifier l'URL : https://je-suis-beatz.web.app
# Ouvrir dans le navigateur et tester

# Vérifier les en-têtes HTTP
curl -I https://je-suis-beatz.web.app
# Doit afficher :
# - X-Content-Type-Options: nosniff
# - X-Frame-Options: DENY
# - Strict-Transport-Security: max-age=...
```

---

## PHASE 4 : Tests Post-Déploiement

### Étape 4.1 : Tester la CSP

```bash
# Ouvrir DevTools → Console
# ✅ CORRECT : Aucun message "Refused to load"
# ❌ DANGER : Si trouve des CSP violations, fix immédiatement

# Exemple d'erreur CSP :
# "Refused to load the script '<URL>' because it violates the following 
#  Content Security Policy directive"
```

### Étape 4.2 : Tester les webhooks de paiement

```bash
# ═══ CinetPay Test Webhook ═══
curl -X POST https://us-central1-je-suis-beatz.cloudfunctions.net/cinetpayWebhook \
  -H "Content-Type: application/json" \
  -d '{
    "transaction_id":"TEST123",
    "status":"SUCCESS",
    "amount":"100",
    "site_id":"393509",
    "signature":"fake"
  }'

# ✅ CORRECT : Réponse 400 (Bad Request - signature invalide)
# ❌ DANGER : Réponse 200 = webhook non sécurisé !

# ═══ Webhook test depuis le dashboard ═══
# CinetPay → Paramètres → IPN → Bouton "Test"
# Doit recevoir et traiter la requête correctement
```

### Étape 4.3 : Tester la fraude paiement

```bash
# Scénario 1 : Simuler un paiement sans webhook
# 1. Créer une commande manuelle : db.collection('orders').add({ ... })
# 2. Vérifier que status reste 'pending' (client ne peut pas changer)
# 3. Webhook du faux paiement doit être rejeté (signature)
# 4. ✅ CORRECT : Commande reste 'pending'

# Scénario 2 : Montant incorrect
# 1. Créer une commande : total = $50
# 2. Webhook envoie montant = $100
# 3. ✅ CORRECT : Commande flaggée "amount_mismatch", pas confirmée

# Scénario 3 : Replay attack (même webhook 2x)
# 1. Webhook 1 : transactionId = "TX123" → commande confirmée
# 2. Webhook 2 : même transactionId = "TX123" → rejeté ("Already processed")
# 3. ✅ CORRECT : Pas de doublon
```

### Étape 4.4 : Tester l'énumération users (protégé)

```bash
# Ouvrir DevTools → Console
db.collection('users').get()
// ✅ CORRECT : Permission denied
// ❌ DANGER : Si affiche la liste, faille critique !

# Test correct : login via Cloud Function
// Cet appel doit passer
functions.httpsCallable('getUserEmailByUsername')({ username: 'john' })
  .then(result => console.log(result.data.email))  // Retourne email seulement
  .catch(error => console.log('User not found'))
```

---

## PHASE 5 : Monitoring & Maintenance

### Étape 5.1 : Surveiller les logs

```bash
# Logs Cloud Functions
firebase functions:log --limit 20

# Filtrer les erreurs
firebase functions:log --limit 50 | grep -i error

# Ou depuis Google Cloud Console
gcloud functions logs read paypalWebhook --region=us-central1 --limit 50
gcloud functions logs read cinetpayWebhook --region=us-central1 --limit 50
```

### Étape 5.2 : Auditer les opérations Firestore

1. https://console.cloud.google.com
2. **Logging** → **Cloud Audit Logs**
3. Configurer des alertes pour :
   - Tentatives d'update de règles (✅ détecter les modifications non autorisées)
   - Accès exceptions à la base (✅ détecter les tentatives d'hacking)

### Étape 5.3 : Monitorer la performance

```bash
# Vérifier la performance des Cloud Functions
gcloud functions describe paypalWebhook --region=us-central1

# Vérifier les quotas
gcloud compute project-info describe --project=je-suis-beatz | grep quota
```

---

## 🚨 EN CAS DE PROBLÈME

### Erreur : "Permissions denied" pour Firestore Rules
```bash
# Probable cause : règles non déployées
firebase deploy --only firestore:rules --verbose

# Ou reset à une version par défaut (si vraiment bloqué)
firebase firestore:delete --recursive --project=je-suis-beatz [DANGEROUS]
```

### Erreur : Cloud Function timeout
```bash
# Vérifier les logs
firebase functions:log --limit 50

# Augmenter le timeout (par défaut 60s)
# Dans functions/index.js :
exports.paypalWebhook = functions
  .runWith({ timeoutSeconds: 300 })  // 5 minutes max
  .https.onRequest(async (req, res) => { ... })
```

### Erreur : Webhook ne reçoit pas les notifications
```bash
# 1. Vérifier l'URL est accessible
curl -I https://us-central1-je-suis-beatz.cloudfunctions.net/paypalWebhook
# Doit retourner 405 Method Not Allowed (car GET n'est pas permis)

# 2. Vérifier les logs
firebase functions:log --limit 50

# 3. Test manuel depuis PayPal/CinetPay dashboard
# → Bouton "Test webhook"
```

---

## ✅ DÉPLOIEMENT RÉUSSI = CHECKLIST FINALE

- [ ] Aucune erreur dans les logs
- [ ] Firestore Rules affiche le statut `deployed`
- [ ] Cloud Functions affichent le statut `OK` ou `✓`
- [ ] Site Hosting accessible sur https://je-suis-beatz.web.app
- [ ] En-têtes HTTP incluent X-Content-Type-Options, X-Frame-Options, HSTS
- [ ] CSP validé (aucune CSP violation dans DevTools)
- [ ] Webhooks reçoivent et traitent les notifications
- [ ] Test de fraude paiement échoue (✅)
- [ ] Test d'énumération users échoue (✅)
- [ ] Email de confirmation envoyé après paiement test

---

## 📞 SUPPORT

- **Problème Firebase** : https://firebase.google.com/support
- **Problème PayPal** : https://developer.paypal.com/support
- **Problème CinetPay** : https://support.cinetpay.com

---

**Généré : 12 Juin 2026 | Je Suis Beatz**
