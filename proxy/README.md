Local CORS proxy for Je Suis Beatz

This tiny Express proxy fetches a remote URL and returns it with CORS headers.

Run locally (dev):

```bash
npm install
npm run start-proxy
# Then open http://localhost:8080/?u=<ENCODED_URL>
```

Docker (optional):

```bash
docker build -t jsb-proxy .
docker run -p 8080:8080 jsb-proxy
```

Use in the app by replacing or adding a proxy base, for example:
`https://localhost:8080/?u=<encoded-firebasestorage-url>`
