# 🔐 CHECKLIST SÉCURITÉ PRÉ-DÉPLOIEMENT
**Avant de mettre le site en production, vérifier TOUS les points ci-dessous.**

---

## 1. 🔑 AUTHENTIFICATION & SECRETS

- [ ] **PayPal Client ID remplacé** : `index.html` ligne ~21
  ```bash
  # ❌ Ne doit PAS rester : TON_CLIENT_ID_PAYPAL
  # ✅ Doit être : abcdef1234567890 (real ID from developer.paypal.com)
  grep "TON_CLIENT_ID_PAYPAL" index.html  # Doit être VIDE !
  ```

- [ ] **CinetPay API Key & Site ID configurés** : `index.html` ligne ~2250
  ```javascript
  // ✅ Doit avoir des valeurs réelles
  const CINETPAY_APIKEY  = '174323661757617531bf99c9.80613927';
  const CINETPAY_SITE_ID = 393509;
  const CINETPAY_MODE    = 'PRODUCTION'; // PAS 'TEST'
  ```

- [ ] **Cloud Functions secrets configurés**
  ```bash
  firebase functions:config:get  # Vérifier paypal.*, cinetpay.*, sendgrid.*
  ```

- [ ] **Aucun secret hardcodé** dans le code client
  ```bash
  grep -r "SG\." . --include="*.js" --include="*.html"  # SendGrid key
  grep -r "AIzaSy" . --include="*.js"  # Firebase key ✅ OK (publique par design)
  grep -r "Bearer " . --include="*.js"  # Auth tokens ❌ Mauvais
  ```

- [ ] **Firebase API Key restreinte**
  1. https://console.cloud.google.com → Project `je-suis-beatz`
  2. **APIs & Services → Credentials**
  3. Clique sur la clé `Browser key`
  4. **Application restrictions** → HTTP referrers
     ```
     https://je-suis-beatz.web.app/*
     https://je-suis-beatz.firebaseapp.com/*
     ```
  5. **API restrictions** → Sélectionne UNIQUEMENT :
     - Identity Toolkit API
     - Cloud Firestore API
     - Firebase Installations API

---

## 2. 🚨 PAIEMENTS & COMMANDES

- [ ] **Paiements JAMAIS validés côté client**
  ```bash
  # ❌ DANGER : ces fonctions ne doivent PAS exister
  grep -r "status.*:.*['\"]PAID['\"]" index.html
  grep -r "status.*:.*['\"]completed['\"]" index.html
  grep -r "simulatePay" index.html
  ```

- [ ] **Webhooks PayPal configurés**
  1. https://developer.paypal.com → **Webhooks** (Sandbox + Production)
  2. URL : `https://us-central1-je-suis-beatz.cloudfunctions.net/paypalWebhook`
  3. Event : `PAYMENT.CAPTURE.COMPLETED` (UNIQUEMENT ce type)
  4. Copier le **Webhook ID** → `firebase functions:config:set paypal.webhook_id="..."`

- [ ] **Webhooks CinetPay configurés**
  1. https://dashboard.cinetpay.com → **Paramètres → IPN/Webhook**
  2. URL : `https://us-central1-je-suis-beatz.cloudfunctions.net/cinetpayWebhook`
  3. Méthode : **POST**
  4. Tester : Bouton "Test webhook" sur le dashboard

- [ ] **Anti-fraude : Vérification montant**
  ```javascript
  // Cloud Function doit vérifier :
  // montant reçu == montant attendu (tolérance 0,01$)
  // Si mismatch → flag la commande, NE PAS confirmer
  ```

- [ ] **Anti-replay : Idempotence**
  ```javascript
  // Cloud Function doit vérifier :
  // si captureId/txId existe déjà → "Already processed"
  // NE PAS traiter 2x la même transaction
  ```

---

## 3. 🔒 FIRESTORE SECURITY RULES

- [ ] **Règles déployées**
  ```bash
  firebase deploy --only firestore:rules
  ```

- [ ] **Test : Utilisateur ne peut PAS modifier son rôle**
  ```javascript
  // Depuis la console du client :
  db.collection('users').doc(currentUser.uid).update({ role: 'admin' });
  // ✅ CORRECT : Permission denied
  // ❌ BUG : Si ça marche, faille critique !
  ```

- [ ] **Test : Utilisateur ne peut PAS lire tous les users**
  ```javascript
  db.collection('users').get();
  // ✅ CORRECT : Permission denied
  // ❌ BUG : Si affiche la liste, faille énumération !
  ```

- [ ] **Test : Utilisateur ne peut PAS modifier le statut d'une commande**
  ```javascript
  db.collection('orders').doc(anyOrderId).update({ status: 'completed' });
  // ✅ CORRECT : Permission denied
  // ❌ BUG : Si accepte, faille critique fraude !
  ```

- [ ] **Indices Firestore déployés**
  ```bash
  firebase deploy --only firestore:indexes
  ```

---

## 4. 🌐 SÉCURITÉ HTTP & CSP

- [ ] **HTTPS enforced**
  ```bash
  # Vérifier dans firebase.json
  # X-Content-Type-Options: nosniff ✅
  # X-Frame-Options: DENY ✅
  # Strict-Transport-Security: ... ✅
  curl -I https://je-suis-beatz.web.app | grep -i "strict\|nosniff\|frame"
  ```

- [ ] **CSP valide**
  ```bash
  # Ouvrir DevTools → Console → charger la page
  # ✅ CORRECT : Aucun "Refused to load the script" ou "CSP violation"
  # ❌ BUG : Erreurs CSP = resources bloquées
  ```

- [ ] **Pas de logs sensibles**
  ```bash
  # Ouvrir DevTools → Console
  grep -r "console.log" index.html | grep -i "firebase\|apikey\|secret"
  # ❌ DANGER : Si trouve des logs sensibles, supprimer
  ```

---

## 5. 🔐 CLOUD FUNCTIONS

- [ ] **Functions déployées**
  ```bash
  firebase deploy --only functions
  ```

- [ ] **Vérifier les logs (pas d'erreur)**
  ```bash
  firebase functions:log
  # Chercher les "Error" ou "Exception" → corriger
  ```

- [ ] **Test webhook fake (anti-fraude)**
  ```bash
  curl -X POST https://us-central1-je-suis-beatz.cloudfunctions.net/cinetpayWebhook \
    -H "Content-Type: application/json" \
    -d '{"transaction_id":"FAKE","status":"SUCCESS","amount":"999"}'
  
  # ✅ CORRECT : 400 Bad Request (signature invalide)
  # ❌ BUG : 200 OK = webhook non sécurisé !
  ```

- [ ] **Vérifier les rôles Cloud Functions**
  ```bash
  gcloud functions describe paypalWebhook --region=us-central1
  # Doit avoir UNIQUEMENT les permissions nécessaires (Firestore write, etc.)
  ```

---

## 6. 📧 EMAIL & LIVRAISON

- [ ] **SendGrid account créé & API Key configurée**
  ```bash
  firebase functions:config:get | grep sendgrid
  # Doit afficher : sendgrid.api_key: "SG.XXXXX"
  ```

- [ ] **Email de test envoyé**
  ```javascript
  // Dans la Cloud Function, avant deployer :
  await sgMail.send({
    to: 'test@gmail.com',
    from: 'jesuisthebeatmaker@gmail.com',
    subject: 'Test Email',
    html: '<p>Test OK</p>'
  });
  // Vérifier que l'email arrive
  ```

- [ ] **Domaine SendGrid vérifié** (optionnel mais recommandé)
  1. https://sendgrid.com → **Settings → Sender Authentication**
  2. Ajouter les enregistrements DNS pour `je-suis-beatz.com`
  3. OU vérifier l'email `jesuisthebeatmaker@gmail.com`

---

## 7. 🧪 TESTS DE SÉCURITÉ

### Test 1 : OWASP Top 10
- [ ] **Injection SQL** : N/A (Firestore ≠ SQL)
- [ ] **XSS** : CSP bloque les scripts malveillants
  ```bash
  # Essayer d'injecter dans un input :
  # <script>alert('XSS')</script>
  # ✅ CORRECT : Script bloqué par CSP
  ```
- [ ] **CSRF** : Form-action 'self' + SameSite cookies
- [ ] **Authentification faible** : Firebase Auth ✅
- [ ] **Données sensibles exposées** : Pas de logs sensibles ✅

### Test 2 : Fraude Paiement
- [ ] Simuler un paiement → Vérifier que seul webhook valide confirme
- [ ] Webhook avec mauvaise signature → Doit être rejeté
- [ ] Webhook avec mauvais montant → Doit être flaggé

### Test 3 : Énumération & Reconnaissance
- [ ] Essayer de lister tous les users → Permission denied ✅
- [ ] Essayer d'énumérer les beats → Lecture OK (catalogue public) ✅
- [ ] Essayer de trouver si un email existe → Cloud Function retourne erreur générique ✅

---

## 8. 📊 MONITORING & LOGS

- [ ] **Cloud Logging activé**
  ```bash
  firebase functions:log --limit 50
  # Vérifier qu'il n'y a pas d'erreurs récurrentes
  ```

- [ ] **Alerts configurés**
  1. https://console.cloud.google.com → **Monitoring → Alertes**
  2. Créer une alerte si :
     - Error rate > 5%
     - Function timeout
     - Firestore rules violations

- [ ] **Audit Firestore activé**
  ```bash
  # https://console.cloud.google.com → Cloud Audit Logs
  # Enregistrer : Firestore write operations (fraud detection)
  ```

---

## 9. 🚀 DÉPLOIEMENT FINAL

```bash
# 1. Vérifier tous les fichiers
git status
# Ne doit afficher AUCUN secret ou token

# 2. Vérifier firebase.json
cat firebase.json | grep -i "public\|ignore"

# 3. Déployer dans cet ordre (IMPORTANT) :
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only functions
firebase deploy --only hosting

# 4. Vérifier les logs post-déploiement
firebase functions:log --limit 20

# 5. Tester le site en production
curl -I https://je-suis-beatz.web.app
# Vérifier les headers de sécurité
```

---

## 10. ✅ FINAL VERIFICATION CHECKLIST

| Point | ✅/❌ | Notes |
|-------|-------|-------|
| PayPal Client ID configuré | | |
| CinetPay API Key configuré | | |
| SendGrid API Key configuré | | |
| Firebase API Key restreinte | | |
| Firestore Rules déployées | | |
| Firestore Indices déployés | | |
| Cloud Functions déployées | | |
| Webhooks PayPal testés | | |
| Webhooks CinetPay testés | | |
| CSP valide (pas d'erreurs console) | | |
| Pas de logs sensibles | | |
| HTTPS + HSTS activé | | |
| Email test envoyé avec succès | | |
| Tests de fraude paiement passés | | |
| Tests d'énumération échoués (✅) | | |

---

## 🚨 EN CAS DE PROBLÈME

**Erreur lors du déploiement :**
```bash
# Vérifier les logs
firebase deploy --only functions -- verbose

# Réinitialiser les secrets s'ils sont mal configurés
firebase functions:config:unset paypal.client_id
firebase functions:config:set paypal.client_id="NEWVALUE"
```

**Webhook qui reçoit pas les notifications :**
1. Vérifier l'URL est accessible : `curl -I https://us-central1-je-suis-beatz.cloudfunctions.net/cinetpayWebhook`
2. Vérifier les logs : `firebase functions:log --limit 50`
3. Tester manuellement depuis le dashboard CinetPay/PayPal

**Règles Firestore bloquent tout :**
```bash
firebase emulators:start  # Tester localement d'abord
# Puis fixit
firebase deploy --only firestore:rules
```

---

**🎯 Objectif final : Déployer en production UNIQUEMENT si toutes les cases ✅ sont cochées.**

Généré : 12 Juin 2026 | Projet : Je Suis Beatz
