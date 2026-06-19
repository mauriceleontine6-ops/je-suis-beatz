# 🔐 Guide de Déploiement Sécurisé — Je Suis Beatz
## VERSION CORRIGÉE — Toutes les failles identifiées sont corrigées

---

## Récapitulatif des failles corrigées dans cette version

| # | Faille | Fichier corrigé | Gravité |
|---|--------|-----------------|---------|
| 1 | `simulatePay()` créait de faux paiements réussis | `index.html` | 🔴 Critique |
| 2 | CinetPay écrivait `status:'PAID'` côté client | `index.html` | 🔴 Critique |
| 3 | PayPal écrivait `status:'PAID'` côté client | `index.html` | 🔴 Critique |
| 4 | Lecture publique de `/users` (énumération emails) | `firestore.rules` + `index.html` | 🔴 Critique |
| 5 | `renderStats()` lisait `/users` sans auth | `index.html` | 🟡 Élevée |
| 6 | CSP trop permissive / manque PayPal+CinetPay | `index.html` | 🟡 Élevée |
| 7 | `console.log("✅ Firebase connecté !")` | `index.html` | 🟢 Faible |
| 8 | CinetPay webhook sans vérification `site_id` | `functions/index.js` | 🟡 Élevée |
| 9 | Pas d'idempotence sur webhooks | `functions/index.js` | 🟡 Élevée |
| 10 | Email de livraison non implémenté | `functions/index.js` | 🟡 Élevée |
| 11 | `checkReturnFromCinetPay` affichait succès sans vérification | `index.html` | 🟡 Élevée |
| 12 | Règle Firestore `update` beats ambiguë | `firestore.rules` | 🟢 Modérée |

---

## ÉTAPE 1 — Prérequis

```bash
npm install -g firebase-tools
firebase login
firebase use je-suis-beatz
```

---

## ÉTAPE 2 — Remplacer les fichiers

Copie les fichiers suivants depuis le dossier `je-suis-beatz-fixed/` vers ta racine de projet :

```
je-suis-beatz-fixed/
├── firestore.rules          → remplace firestore.rules
├── index.html               → remplace index.html
└── functions/
    ├── index.js             → remplace functions/index.js
    └── package.json         → remplace functions/package.json
```

---

## ÉTAPE 3 — Remplacer le Client ID PayPal dans index.html

Ligne 21 de `index.html` :
```html
<!-- AVANT -->
<script src="https://www.paypal.com/sdk/js?client-id=TON_CLIENT_ID_PAYPAL...">

<!-- APRÈS (remplace par ton vrai Client ID) -->
<script src="https://www.paypal.com/sdk/js?client-id=ABXYZ1234567890&currency=USD&locale=fr_FR"...>
```

Récupère ton Client ID sur : https://developer.paypal.com → Apps & Credentials

---

## ÉTAPE 4 — Installer les dépendances des Cloud Functions

```bash
cd functions
npm install
cd ..
```

---

## ÉTAPE 5 — Configurer les secrets (variables d'environnement)

⚠️ **Ne jamais mettre ces clés dans le code source ou git.**

```bash
# ── PayPal ──────────────────────────────────────────────────────
# Récupère sur : developer.paypal.com → Apps & Credentials
firebase functions:config:set paypal.client_id="TON_CLIENT_ID_PAYPAL"
firebase functions:config:set paypal.client_secret="TON_CLIENT_SECRET_PAYPAL"
firebase functions:config:set paypal.webhook_id="TON_WEBHOOK_ID_PAYPAL"

# ── CinetPay ─────────────────────────────────────────────────────
# Récupère sur : dashboard.cinetpay.com → API
firebase functions:config:set cinetpay.api_key="TA_API_KEY_CINETPAY"
firebase functions:config:set cinetpay.site_id="393509"

# ── SendGrid (email de livraison) ─────────────────────────────────
# Crée un compte sur : sendgrid.com (gratuit : 100 emails/jour)
# Puis : Settings → API Keys → Create API Key (Full Access)
firebase functions:config:set sendgrid.api_key="SG.XXXXXXXXXXXXXXXX"
```

Vérifier que tout est bien enregistré :
```bash
firebase functions:config:get
```

---

## ÉTAPE 6 — Mettre à jour les constantes dans index.html

Dans `index.html`, vers la ligne 2229, remplace les placeholders :

```javascript
// AVANT
const CINETPAY_APIKEY  = 'VOTRE_APIKEY_CINETPAY';
const CINETPAY_SITE_ID = 0;
const CINETPAY_MODE    = 'TEST';
const CLOUD_FUNCTIONS_BASE_URL = 'https://YOUR_REGION-je-suis-beatz.cloudfunctions.net';

// APRÈS (exemple avec tes vraies valeurs)
const CINETPAY_APIKEY  = '174323661757617531bf99c9.80613927'; // ta clé
const CINETPAY_SITE_ID = 393509;                               // ton site_id (nombre)
const CINETPAY_MODE    = 'PRODUCTION';                         // 'TEST' → sandbox, 'PRODUCTION' → vrai argent
const CLOUD_FUNCTIONS_BASE_URL = 'https://us-central1-je-suis-beatz.cloudfunctions.net';
```

---

## ÉTAPE 7 — Déploiement dans l'ordre obligatoire

```bash
# 1. Règles Firestore d'abord (sécurité de la base)
firebase deploy --only firestore:rules

# 2. Index Firestore
firebase deploy --only firestore:indexes

# 3. Cloud Functions (webhooks + email)
firebase deploy --only functions

# 4. Site web en dernier
firebase deploy --only hosting
```

---

## ÉTAPE 8 — Définir le claim admin (UNE SEULE FOIS)

```bash
# Dans Firebase Console → Functions → Shell, ou via l'émulateur :
firebase functions:shell
# Puis :
setAdminClaim({ email: 'jesuisthebeatmaker@gmail.com' })
```

✅ Après cette étape, ferme la Cloud Function Shell — la fenêtre est automatiquement sécurisée.

---

## ÉTAPE 9 — Configurer les webhooks de paiement

### PayPal
1. https://developer.paypal.com → Webhooks
2. URL : `https://us-central1-je-suis-beatz.cloudfunctions.net/paypalWebhook`
3. Événement : `PAYMENT.CAPTURE.COMPLETED` uniquement
4. Note le **Webhook ID** → utilisé à l'étape 5

### CinetPay
1. https://dashboard.cinetpay.com → Paramètres → IPN/Webhook
2. URL de notification : `https://us-central1-je-suis-beatz.cloudfunctions.net/cinetpayWebhook`
3. Méthode : **POST**

---

## ÉTAPE 10 — Restreindre la clé API Firebase (Google Cloud Console)

⚠️ C'est une étape souvent oubliée mais importante.

1. Va sur https://console.cloud.google.com
2. Sélectionne le projet `je-suis-beatz`
3. **APIs & Services → Credentials**
4. Clique sur ta clé `Browser key (auto created by Firebase)`
5. **Application restrictions → HTTP referrers**
6. Ajoute :
   ```
   https://je-suis-beatz.web.app/*
   https://je-suis-beatz.firebaseapp.com/*
   ```
7. **API restrictions → Restrict key**
8. Sélectionne uniquement :
   - Identity Toolkit API
   - Cloud Firestore API
   - Firebase Installations API
9. Sauvegarde

---

## ÉTAPE 11 — Vérifier SendGrid

1. Crée un compte sur https://sendgrid.com
2. Va dans **Settings → Sender Authentication**
3. Vérifie le domaine `je-suis-beatz.com` (ajoute les enregistrements DNS indiqués)
4. Ou, en mode simple, vérifie uniquement l'email `jesuisthebeatmaker@gmail.com` (**Single Sender Verification**)
5. Teste l'envoi depuis la console SendGrid avant de déployer

---

## ÉTAPE 12 — Tests de validation après déploiement

Ouvre la console navigateur sur le site et vérifie que ces attaques échouent :

```javascript
// ❌ 1. Faux paiement par carte — doit afficher "Intégration en cours"
//    (plus de faux succès)
simulatePay('card')

// ❌ 2. Lecture des utilisateurs — doit retourner "Permission denied"
db.collection('users').get().then(s => console.log(s.docs.length))

// ❌ 3. Passage d'une commande à completed — doit échouer (rules)
db.collection('orders').doc('test').update({ status: 'completed' })

// ❌ 4. Écriture stream sans auth — doit échouer
db.collection('beats').doc('test').update({ streams: 99999 })

// ❌ 5. Accès admin sans token — doit rediriger vers login
showPage('admin') // sans être connecté admin
```

---

## Architecture de sécurité finale

```
Utilisateur
    │
    ▼
index.html (client)
    │ Paiement PayPal/CinetPay uniquement
    │ Status toujours = "pending"
    │
    ├──────────────────────────────────────────►  Firebase Auth
    │                                              (custom claims admin)
    │
    ▼
Firestore Security Rules
    │ beats: lecture publique, écriture admin
    │ users: lecture propriétaire/admin uniquement
    │ orders: création pending uniquement, pas de modif client
    │ _stream_rate_limits: BLOQUÉ côté client
    │
    ▼
Cloud Functions (Admin SDK — contourne les rules)
    │
    ├── paypalWebhook  ◄── PayPal servers (signature vérifiée)
    │       └── orders.update({ status: 'completed' })
    │
    ├── cinetpayWebhook ◄── CinetPay servers (site_id vérifié + re-check API)
    │       └── orders.update({ status: 'completed' })
    │
    ├── registerStream  ◄── Client (auth requise, rate-limit serveur)
    │
    ├── getUserEmailByUsername ◄── Client login (email uniquement, pas d'énumération)
    │
    └── getOrderStatus ◄── Client polling (propriétaire uniquement)
            └── SendGrid → email livraison
```

---

## Support

- Firebase Docs : https://firebase.google.com/docs/firestore/security/get-started
- Custom Claims : https://firebase.google.com/docs/auth/admin/custom-claims
- SendGrid : https://docs.sendgrid.com/for-developers/sending-email/quickstart-nodejs
- CinetPay API : https://docs.cinetpay.com
- Contact : jesuisthebeatmaker@gmail.com
