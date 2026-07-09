#!/usr/bin/env node
const express = require('express');
const fetch = require('node-fetch');
const app = express();
const PORT = process.env.PORT || 8080;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/', async (req, res) => {
  const u = req.query.u || req.query.url;
  if (!u) return res.status(400).send('missing u param');
  try {
    const upstream = await fetch(u, { redirect: 'follow', headers: { 'User-Agent': 'jsb-proxy/1.0' } });
    res.status(upstream.status);
    upstream.headers.forEach((v, k) => {
      // avoid interfering with transfer encoding
      if (k.toLowerCase() === 'transfer-encoding') return;
      res.setHeader(k, v);
    });
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (!upstream.body) return res.sendStatus(204);
    upstream.body.pipe(res);
  } catch (err) {
    console.error('proxy error', err && err.message ? err.message : err);
    res.status(502).send('proxy error');
  }
});

app.listen(PORT, () => console.log(`Proxy listening on http://localhost:${PORT}`));
