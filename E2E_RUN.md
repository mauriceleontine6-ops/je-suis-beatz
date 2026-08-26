E2E Run Instructions

This file documents how to run the Playwright E2E checks locally and recommended dev steps.

Prerequisites:
- Node.js installed
- `npm install` run in repo root
- Dev server serving the repo at `http://127.0.0.1:8000` (the app expects this URL)
- Optional: local proxy for Storage CORS at `http://localhost:8080` (see `proxy/server.js`)

Quick commands (Windows PowerShell):

1) Start local static server (from project root):

```powershell
# using Python
python -m http.server 8000
# or using Node http-server
npx http-server -p 8000
```

2) Start the local CORS proxy (in a separate terminal):

```powershell
npm run start-proxy
```

3) Run Playwright tests (browsers must be installed):

```powershell
# Install playwright browsers (only necessary once after installing deps)
npx playwright install

# Run tests (fixture-based deterministic test included)
npm run test:e2e
```

Debug/headed mode:

```powershell
npx playwright test --headed --debug
```

Notes & troubleshooting:
- For real end-to-end testing against Firebase Storage you need either applied Storage CORS (recommended) or the proxy running. See `CORS_INSTRUCTIONS.md` and `apply-cors.js`.
- The test suite contains a deterministic fixture test at `tests/fixtures/mix_stub.html` that validates mix generation logic without relying on the full UI.
- To create a robust full-UI test we need to handle login modals and dynamic content; I can implement that next (simulate auth via localStorage or add test-time stubs).

If you want I can now:
- Implement full UI E2E (handle auth and dynamic UI), or
- Keep tests lightweight as-is and add CI configuration to run them.

Proxy & CORS options (automatable):

- Deploy the local proxy to Cloud Run (workflow added at `.github/workflows/deploy-proxy.yml`). The workflow requires these repository secrets:
	- `GCP_SA_KEY` — contents of a service account key JSON
	- `GCP_PROJECT_ID` — GCP project id
	- `GCP_REGION` — region, e.g. `us-central1`
	- `PROXY_SERVICE_NAME` — desired Cloud Run service name

- Apply Storage CORS automatically using the included Node script `apply-cors.js` (workflow `.github/workflows/apply-cors.yml`). Set `GCP_SA_KEY` in repository secrets and run the workflow.

If you prefer not to provide secrets, run these steps locally:

```powershell
# Deploy proxy locally
npm run start-all

# Or apply CORS locally with gcloud/gsutil:
gcloud auth login
gcloud config set project <PROJECT_ID>
gsutil cors set tools/storage-cors.json gs://<BUCKET_NAME>
```
