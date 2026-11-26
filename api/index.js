'use strict';

/** API mínima de Stremio: manifest, catálogos, fichas, streams y proxy M3U. */
const path = require('node:path');
const { Readable } = require('node:stream');
const express = require('express');
const addonInterface = require('../addon');
const core = require('../lib/core');
const m3uProxy = require('../lib/m3uProxy');
const config = require('../lib/config');

const app = express();
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// Vercel puede enviar la ruta real en x-matched-path.
app.use((req, _res, next) => {
  const matchedPath = req.headers['x-matched-path'];
  if (matchedPath && (req.url === '/api' || req.url.startsWith('/api?'))) req.url = matchedPath;
  next();
});

function requestOrigin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${config.port}`;
  const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
  return `${proto}://${host}`;
}

function sendProxyResponse(res, response) {
  res.status(response.status);
  response.headers.forEach((value, name) => res.setHeader(name, value));
  if (!response.body) return res.end();
  return Readable.fromWeb(response.body).pipe(res);
}

async function streamResult(type, id, req) {
  const result = await core.handleStream(type, id, null);
  if (!id.startsWith('rlch:m3u:')) return result;
  const secret = process.env.M3U_PROXY_SECRET;
  if (!secret || String(secret).length < 24) {
    return result;
  }
  try {
    result.streams = await m3uProxy.maskedStreams(result.streams, { origin: requestOrigin(req), secret });
  } catch (error) {
    console.error('[API m3uProxy]', error?.message);
  }
  return result;
}

app.get('/', (_req, res) => res.redirect(302, '/manifest.json'));
app.get('/healthz', (_req, res) => res.json({
  ok: true,
  addon: addonInterface.manifest.id,
  version: addonInterface.manifest.version,
  catalogs: addonInterface.manifest.catalogs.length,
  channelsOnly: true,
  configurable: false,
  m3uProxyConfigured: Boolean(process.env.M3U_PROXY_SECRET),
}));
app.get('/assets/logo.png', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(__dirname, '..', 'assets', 'logo.png'));
});
app.get(['/manifest.json', '/api/manifest.json'], (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(core.buildManifest(`${requestOrigin(req)}/assets/logo.png`));
});

async function catalogRoute(req, res) {
  const type = req.params.type;
  const id = req.params.id;
  const extra = { ...req.query };
  if (req.params.extra) Object.assign(extra, Object.fromEntries(new URLSearchParams(req.params.extra)));
  const result = await core.handleCatalog(type, id, null, extra);
  res.setHeader('Cache-Control', `public, max-age=${result.cacheMaxAge || 60}`);
  res.json(result);
}
app.get('/catalog/:type/:id.json', catalogRoute);
app.get('/catalog/:type/:id/:extra.json', catalogRoute);
app.get('/meta/:type/:id.json', async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(await core.handleMeta(req.params.type, req.params.id));
});
app.get('/stream/:type/:id.json', async (req, res) => {
  const result = await streamResult(req.params.type, req.params.id, req);
  res.setHeader('Cache-Control', core.streamCacheControl(result.cacheMaxAge));
  res.json(result);
});
app.get('/__channel/:token', async (req, res) => {
  try {
    const response = await m3uProxy.proxyRequest(req, req.params.token, {
      secret: process.env.M3U_PROXY_SECRET,
      origin: requestOrigin(req),
    });
    return sendProxyResponse(res, response);
  } catch {
    return res.status(502).end();
  }
});

app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
app.use((err, _req, res, _next) => {
  console.error('[API]', err && err.message);
  if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
});

module.exports = app;
