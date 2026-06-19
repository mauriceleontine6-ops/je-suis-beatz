# ⚡ ACTIONS IMMÉDIATES — RÉSUMÉ EXÉCUTIF

## 🎯 Priorité 1 (Critique) — À faire AVANT tout déploiement

### 1. Remplacer le PayPal Client ID
**Fichier** : [index.html](index.html#L21)
```html
<!-- AVANT (DANGEREUX) -->
<script src="https://www.paypal.com/sdk/js?client-id=TON_CLIENT_ID_PAYPAL...">

<!-- APRÈS (ton vrai ID) -->
<script src="https://www.paypal.com/sdk/js?client-id=ABCDEF1234567890...">
```
**Où trouver :** https://developer.paypal.com → Apps & Credentials

### 2. Configurer CinetPay API Key & Site ID
**Fichier** : `index.html` vers ligne 2250 (chercher `const CINETPAY_APIKEY`)
```javascript
// AVANT
const CINETPAY_APIKEY  = 'VOTRE_APIKEY_CINETPAY';
const CINETPAY_SITE_ID = 0;
const CINETPAY_MODE    = 'TEST';

// APRÈS (tes vraies valeurs)
const CINETPAY_APIKEY  = '174323661757617531bf99c9.80613927';  // ta clé API
const CINETPAY_SITE_ID = 393509;  // ton site ID
const CINETPAY_MODE    = 'PRODUCTION';  // PAS 'TEST' en prod !
```
**Où trouver :** https://dashboard.cinetpay.com → API Settings

### 3. Configurer les secrets Firebase Cloud Functions
```bash
# ═══ PayPal ═══
firebase functions:config:set \
  paypal.client_id="YOUR_REAL_ID" \
  paypal.client_secret="YOUR_REAL_SECRET" \
  paypal.webhook_id="YOUR_WEBHOOK_ID"

# ═══ CinetPay ═══
firebase functions:config:set \
  cinetpay.api_key="YOUR_API_KEY" \
  cinetpay.site_id="393509"

# ═══ SendGrid (pour emails de livraison) ═══
firebase functions:config:set \
  sendgrid.api_key="SG.XXXXXXXXXXXXX"

# Vérifier
firebase functions:config:get
```

### 4. Restreindre la clé API Firebase
1. Va sur https://console.cloud.google.com
2. Sélectionne `je-suis-beatz` → **APIs & Services → Credentials**
3. Clique sur la clé `Browser key`
4. **Application restrictions** → Ajoute :
   ```
   https://je-suis-beatz.web.app/*
   https://je-suis-beatz.firebaseapp.com/*
   ```
5. **API restrictions** → Sélectionne UNIQUEMENT :
   - Cloud Firestore API
   - Identity Toolkit API
   - Firebase Installations API
6. **Save**

---

## 🎯 Priorité 2 (Élevée) — À faire avant le déploiement

### 5. Configurer les webhooks PayPal
1. https://developer.paypal.com → **Webhooks**
2. **Create Webhook**
   - URL : `https://us-central1-je-suis-beatz.cloudfunctions.net/paypalWebhook`
   - Event : `PAYMENT.CAPTURE.COMPLETED` (UNIQUEMENT)
   - Save → Copier le **Webhook ID**
3. Configurer dans Firebase :
   ```bash
   firebase functions:config:set paypal.webhook_id="YOUR_WEBHOOK_ID"
   ```

### 6. Configurer les webhooks CinetPay
1. https://dashboard.cinetpay.com → **Paramètres → IPN/Webhooks**
2. **Ajouter Webhook**
   - URL : `https://us-central1-je-suis-beatz.cloudfunctions.net/cinetpayWebhook`
   - Méthode : `POST`
   - Save
3. **Tester** : Bouton "Test webhook"

### 7. Créer compte SendGrid (emails de confirmation)
1. https://sendgrid.com → **Sign Up** (gratuit : 100 emails/jour)
2. **Settings → API Keys → Create API Key** (Full Access)
3. Copier la clé → Configurer dans Firebase
4. **Settings → Sender Authentication** → Vérifier l'email `jesuisthebeatmaker@gmail.com`

---

## 🎯 Priorité 3 (Modérée) — Avant la première mise en production complète

### 8. Tester les règles Firestore localement
```bash
firebase emulators:start
# Ouvrir https://localhost:5000 → DevTools Console

# Test 1 : Utilisateur ne peut pas modifier le rôle
db.collection('users').doc(auth.currentUser.uid).update({ role: 'admin' })
// ✅ CORRECT : Permission denied

# Test 2 : Utilisateur ne peut pas valider un paiement
db.collection('orders').doc('anyOrderId').update({ status: 'completed' })
// ✅ CORRECT : Permission denied

# Test 3 : Utilisateur ne peut pas lire tous les utilisateurs
db.collection('users').get()
// ✅ CORRECT : Permission denied
```

### 9. Vérifier la CSP (Content Security Policy)
1. Ouvre https://je-suis-beatz.web.app
2. DevTools → Console
3. Cherche les erreurs CSP (messages rouges "Refused to load...")
4. ✅ CORRECT : Aucune erreur CSP
5. ❌ DANGER : Si affiche des erreurs, fix immédiatement

### 10. Tester un paiement complet (simulation)
1. Ouvre le site
2. Crée un compte test
3. Ajoute un beat au panier
4. Passe la commande (Sandbox PayPal ou Mode TEST CinetPay)
5. ✅ CORRECT : Email de confirmation + lien téléchargement
6. Vérifier dans Firestore → orders : status = `completed`

---

## 📋 Fichiers de Référence Créés

| Fichier | Objectif |
|---------|----------|
| [RAPPORT_SECURITE_2026.md](RAPPORT_SECURITE_2026.md) | Analyse détaillée des failles |
| [CHECKLIST_SECURITE_PREDEPLOIEMENT.md](CHECKLIST_SECURITE_PREDEPLOIEMENT.md) | ✅ Checklist complète à cocher |
| [GUIDE_DEPLOIEMENT_SECURISE.md](GUIDE_DEPLOIEMENT_SECURISE.md) | 🚀 Guide étape-par-étape |
| [firestore.rules](firestore.rules) | ✅ Règles Firestore sécurisées |
| [firebase-hosting-config.json](firebase-hosting-config.json) | 🔒 En-têtes HTTP de sécurité |
| [.gitignore](.gitignore) | 🔐 Protège les secrets |

---

## 🚀 Déploiement en 5 étapes (après avoir complété Priorités 1 & 2)

```bash
# 1. Vérifier tout est bon
firebase functions:config:get
firebase projects:describe je-suis-beatz

# 2. Déployer dans cet ORDRE exact
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only functions
firebase deploy --only hosting

# 3. Attendre que tout se déploie (5-10 min)

# 4. Vérifier les logs
firebase functions:log --limit 20

# 5. Tester en production
# → Ouvrir https://je-suis-beatz.web.app
# → Vérifier CSP (DevTools Console)
# → Tester un paiement test
```

---

## ⏱️ Timeline Recommandée

| Quand | Quoi | Temps |
|-------|------|-------|
| **Jour 1** | Priorités 1, 2, 3 | 2-3h |
| **Jour 2** | Tests locaux (émulateur) | 1-2h |
| **Jour 3** | Déploiement Staging (test) | 30 min |
| **Jour 4** | Tests post-déploiement | 1-2h |
| **Jour 5** | Déploiement Production + monitoring | 30 min |

---

## 🔍 Après le déploiement : Monitoring 24/7

```bash
# Daily checks (chaque matin)
firebase functions:log --limit 50 | grep -i error

# Weekly security review
gcloud functions logs read paypalWebhook --region=us-central1 --limit 100
gcloud functions logs read cinetpayWebhook --region=us-central1 --limit 100

# Monthly audit
# → Google Cloud Console → Audit Logs
# → Vérifier : aucune tentative de piratage, pas d'erreurs critiques
```

---

## 🆘 Besoin d'aide ?

- **Erreur déploiement** : Lire [GUIDE_DEPLOIEMENT_SECURISE.md](GUIDE_DEPLOIEMENT_SECURISE.md) section "En cas de problème"
- **Faille de sécurité** : Lire [RAPPORT_SECURITE_2026.md](RAPPORT_SECURITE_2026.md)
- **Avant chaque étape** : Consulter [CHECKLIST_SECURITE_PREDEPLOIEMENT.md](CHECKLIST_SECURITE_PREDEPLOIEMENT.md)

---

**Généré le 12 Juin 2026 — Je Suis Beatz Security Team**

> ⚠️ **IMPORTANT** : NE JAMAIS mettre en production sans avoir complété au minimum les **Priorités 1 & 2**.
> Un déploiement hâtif peut coûter de l'argent (fraude paiement) ou des données (piratage compte).
