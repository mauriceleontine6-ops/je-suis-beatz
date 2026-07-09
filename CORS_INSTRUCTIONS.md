How to allow CORS for Firebase Storage (recommended)

1) Preferred: use `gsutil` (Google Cloud SDK)

Install and authenticate:

```bash
gcloud auth login
gcloud config set project je-suis-beatz
```

Create a CORS JSON (example already included at `tools/storage-cors.json`). Then apply:

```bash
gsutil cors set tools/storage-cors.json gs://je-suis-beatz.firebasestorage.app
```

2) Alternative: use the included `apply-cors.js` Node script

Place a service account JSON key at `tools/firebase-adminsdk-key.json` (or update the path in the script), then run:

```bash
node apply-cors.js
```

The script uses `@google-cloud/storage` and applies the JSON in `tools/storage-cors.json` to the bucket.

3) Quick note: after applying CORS, clients may still see cached failures — clear browser cache or wait a few minutes.

If you want, I can try to deploy a small Cloud Run proxy that returns `Access-Control-Allow-Origin: *` for your beats, but applying proper Storage CORS is the safest and most performant approach.
