/**
 * Seed GHOST beat: upload cover + audio to Firebase Storage, upsert Firestore doc.
 * Run from project root: node tools/seed_ghost_beat.js
 * Requires: gcloud auth application-default login  OR  GOOGLE_APPLICATION_CREDENTIALS
 */
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.join(__dirname, '..');
const FUNCTIONS_ROOT = path.join(PROJECT_ROOT, 'functions');
const admin = require(path.join(FUNCTIONS_ROOT, 'node_modules', 'firebase-admin'));
const BUCKET = 'je-suis-beatz.firebasestorage.app';

const GHOST = {
  title: 'GHOST',
  bpm: 142,
  genre: 'Drill',
  subgenre: 'Afro',
  priceBasic: 25,
  pricePremium: 50,
  priceWav: 100,
  priceExclusive: 300,
  status: 'available',
  desc_fr: 'Un beat Drill/Afro sombre et hypnotique, parfait pour les punchlines et le storytelling cinématique.',
  desc_en: 'A dark and hypnotic Drill/Afro beat, perfect for punchlines and cinematic storytelling.',
};

const COVER_LOCAL = path.join(PROJECT_ROOT, 'image_beat_Ghost.jpeg');
const AUDIO_LOCAL = path.join(PROJECT_ROOT, 'Ghost.mpeg');
const COVER_STORAGE = 'covers/ghost.jpeg';
const AUDIO_STORAGE = 'beats/ghost.mpeg';

function storagePublicUrl(bucketName, storagePath) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media`;
}

async function uploadIfExists(bucket, localPath, dest, contentType) {
  if (!fs.existsSync(localPath)) {
    throw new Error(`Fichier introuvable: ${localPath}`);
  }
  await bucket.upload(localPath, {
    destination: dest,
    metadata: {
      contentType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });
  console.log(`Uploaded ${path.basename(localPath)} → ${dest}`);
  return storagePublicUrl(bucket.name, dest);
}

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: 'je-suis-beatz',
      storageBucket: BUCKET,
    });
  }

  const bucket = admin.storage().bucket();
  const db = admin.firestore();

  const coverUrl = await uploadIfExists(bucket, COVER_LOCAL, COVER_STORAGE, 'image/jpeg');
  const audioUrl = await uploadIfExists(bucket, AUDIO_LOCAL, AUDIO_STORAGE, 'audio/mpeg');

  const payload = {
    ...GHOST,
    cover: coverUrl,
    audio: audioUrl,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const snap = await db.collection('beats').where('title', '==', 'GHOST').limit(1).get();
  if (snap.empty) {
    payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
    const ref = await db.collection('beats').add(payload);
    console.log('GHOST créé dans Firestore:', ref.id);
    console.log(JSON.stringify({ id: ref.id, cover: coverUrl, audio: audioUrl }, null, 2));
  } else {
    const doc = snap.docs[0];
    await doc.ref.set(payload, { merge: true });
    console.log('GHOST mis à jour dans Firestore:', doc.id);
    console.log(JSON.stringify({ id: doc.id, cover: coverUrl, audio: audioUrl }, null, 2));
  }
}

main().catch((err) => {
  console.error('Échec seed GHOST:', err.message || err);
  process.exit(1);
});
