/**
 * Active les droits admin pour jesuisthebeatmaker@gmail.com
 * Usage: node tools/bootstrap_admin.js
 */
const admin = require('../functions/node_modules/firebase-admin');

const EMAIL = 'jesuisthebeatmaker@gmail.com';
const PROJECT_ID = 'je-suis-beatz';

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

async function main() {
  const user = await admin.auth().getUserByEmail(EMAIL);
  console.log('Utilisateur trouvé:', user.uid, user.email);

  await admin.auth().setCustomUserClaims(user.uid, { admin: true });
  await db.collection('admins').doc(user.uid).set({
    isAdmin: true,
    email: EMAIL,
    bootstrappedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  await db.collection('users').doc(user.uid).set({ role: 'admin', email: EMAIL }, { merge: true });

  const updated = await admin.auth().getUser(user.uid);
  console.log('Custom claims:', updated.customClaims);
  console.log('✓ Admin activé pour', EMAIL);
}

main().catch((e) => {
  console.error('Erreur:', e.message);
  process.exit(1);
});
