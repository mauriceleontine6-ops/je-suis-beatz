#!/usr/bin/env node

const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const path = require('path');

// Read CORS configuration
const corsConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'tools/storage-cors.json'), 'utf8'));

// Firebase bucket name
const bucketName = 'je-suis-beatz.firebasestorage.app';

async function setCors() {
  try {
    const storage = new Storage({
      projectId: 'je-suis-beatz',
      keyFilename: path.join(__dirname, 'firebase-adminsdk-key.json') // You may need to update this path
    });

    const bucket = storage.bucket(bucketName);
    
    console.log(`Setting CORS configuration for bucket: ${bucketName}`);
    await bucket.setCorsConfiguration(corsConfig);
    
    console.log('✅ CORS configuration applied successfully!');
    console.log('Allowed origins:', corsConfig[0].origin.join(', '));
  } catch (error) {
    console.error('❌ Error applying CORS:', error.message);
    process.exit(1);
  }
}

setCors();
