# 🔍 PLACEHOLDERS À REMPLACER
**Avant le déploiement, il faut remplacer TOUS les placeholders ci-dessous.**

---

## 🚨 Placeholders critiques (DOIT être remplacé)

### 1. PayPal Client ID
**Fichier** : `index.html` ligne ~21
**Avant** :
```html
<script src="https://www.paypal.com/sdk/js?client-id=TON_CLIENT_ID_PAYPAL&currency=USD&locale=fr_FR"...
```

**À chercher** : 
```bash
grep "TON_CLIENT_ID_PAYPAL" index.html
```

**Comment corriger** :
1. Va sur https://developer.paypal.com
2. Clique sur **Apps & Credentials**
3. Sélectionne **Sandbox** ou **Live** selon besoin
4. Copie le **Client ID** sous **REST API apps**
5. Remplace dans `index.html` :
```html
<!-- EXEMPLE avec un faux ID pour montrer le format -->
<script src="https://www.paypal.com/sdk/js?client-id=ABCDEF1234567890GHIJ&currency=USD&locale=fr_FR"...
```

---

### 2. CinetPay API Key
**Fichier** : `index.html` vers ligne 2250 (chercher `const CINETPAY_APIKEY`)
**Avant** :
```javascript
const CINETPAY_APIKEY  = 'VOTRE_APIKEY_CINETPAY';
```

**À chercher** :
```bash
grep "VOTRE_APIKEY_CINETPAY" index.html
```

**Comment corriger** :
1. Va sur https://dashboard.cinetpay.com
2. Connecte-toi avec tes identifiants
3. Va dans **Paramètres** → **API**
4. Copie le **API Key**
5. Remplace dans `index.html` :
```javascript
// EXEMPLE
const CINETPAY_APIKEY  = '174323661757617531bf99c9.80613927';
```

---

### 3. CinetPay Site ID
**Fichier** : `index.html` vers ligne 2250
**Avant** :
```javascript
const CINETPAY_SITE_ID = 0;
```

**À chercher** :
```bash
grep "const CINETPAY_SITE_ID = 0" index.html
```

**Comment corriger** :
1. Va sur https://dashboard.cinetpay.com
2. Cherche ton **Site ID** (numéro à 6 chiffres)
3. Remplace dans `index.html` :
```javascript
const CINETPAY_SITE_ID = 393509;  // Exemple : 393509
```

---

### 4. CinetPay Mode (TEST vs PRODUCTION)
**Fichier** : `index.html` vers ligne 2250
**Avant** :
```javascript
const CINETPAY_MODE    = 'TEST';
```

**À chercher** :
```bash
grep "CINETPAY_MODE" index.html
```

**Comment corriger** :
```javascript
// ✅ En développement/test :
const CINETPAY_MODE    = 'TEST';

// ✅ En production (ATTENTION : paiements réels) :
const CINETPAY_MODE    = 'PRODUCTION';
```

---

### 5. Cloud Functions Base URL
**Fichier** : `index.html` vers ligne 2250
**Avant** :
```javascript
const CLOUD_FUNCTIONS_BASE_URL = 'https://YOUR_REGION-je-suis-beatz.cloudfunctions.net';
```

**À chercher** :
```bash
grep "YOUR_REGION-je-suis-beatz" index.html
```

**Comment corriger** :
```javascript
// La région par défaut est 'us-central1', donc :
const CLOUD_FUNCTIONS_BASE_URL = 'https://us-central1-je-suis-beatz.cloudfunctions.net';
```

---

## 🔧 Placeholders de configuration (Firebase Cloud Functions)

Ces placeholders NE SONT PAS dans le code client, mais dans la configuration Firebase.
À configurer avec `firebase functions:config:set`.

### 6. PayPal Client Secret
```bash
# À configurer
firebase functions:config:set paypal.client_secret="TON_SECRET"

# À obtenir sur
https://developer.paypal.com → Apps & Credentials → REST API apps → Secret
```

### 7. PayPal Webhook ID
```bash
# À configurer
firebase functions:config:set paypal.webhook_id="TON_WEBHOOK_ID"

# À obtenir sur
https://developer.paypal.com → Webhooks → Webhook ID
```

### 8. SendGrid API Key
```bash
# À configurer
firebase functions:config:set sendgrid.api_key="SG.XXXXXXXXXXXXX"

# À obtenir sur
https://sendgrid.com → Settings → API Keys → Create API Key
```

---

## ✅ Vérification final

### Avant le déploiement, exécute :
```bash
# Cherche les placeholders restants dans le code client
grep -r "TON_CLIENT_ID_PAYPAL\|VOTRE_APIKEY_CINETPAY\|YOUR_REGION\|YOUR_SECRET" . \
  --include="*.html" \
  --include="*.js"

# Doit retourner : (empty result = bon !)
# Sinon : des placeholders non remplacés !

# Vérifie les secrets Firebase
firebase functions:config:get

# Doit afficher quelque chose comme :
# paypal:
#   client_id: "ABCDEF1234567890"
#   client_secret: "xyz..."
#   webhook_id: "WH-..."
# cinetpay:
#   api_key: "174323..."
#   site_id: 393509
# sendgrid:
#   api_key: "SG.xxx..."
```

---

## 🚀 Après remplacement : Commandes de déploiement

```bash
# 1. Vérifier la config
firebase functions:config:get

# 2. Déployer
firebase deploy --only functions

# 3. Vérifier les logs
firebase functions:log --limit 10

# 4. Tester
# Ouvrir https://je-suis-beatz.web.app et tester un paiement
```

---

## 📋 Checklist avant de cliquer sur "Déployer"

- [ ] PayPal Client ID remplacé ✅
- [ ] CinetPay API Key remplacé ✅
- [ ] CinetPay Site ID remplacé ✅
- [ ] CinetPay Mode = "PRODUCTION" (ou "TEST" si test) ✅
- [ ] Cloud Functions URL correcte ✅
- [ ] Secrets Firebase configurés via `firebase functions:config:set` ✅
- [ ] `grep` pour vérifier qu'il n'y a plus de placeholders ✅
- [ ] Tests locaux passés ✅
- [ ] Webhooks configurés et testés ✅
- [ ] Email SendGrid test envoyé ✅

---

**Une fois tout coché ✅, tu es prêt pour le déploiement !**
