'use strict';

/**
 * Servidor Express + Router del SDK de Stremio (mismo entrypoint local y serverless).
 *  - GET /                 → landing page con botón de instalación
 *  - GET /manifest.json    → manifest (logo resuelto al host actual)
 *  - GET /assets/logo.png  → logo generado
 *  - GET /healthz          → estado del servicio y de las fuentes de datos
 *  - /catalog/... y /meta/... → servidos por el SDK oficial de Stremio
 */

const path = require('path');
const express = require('express');
const cors = require('cors');
const { getRouter } = require('stremio-addon-sdk');

const addonInterface = require('../addon');
const config = require('../lib/config');
const { renderLanding } = require('../lib/landingPage');

const app = express();

// 1. CORS permisivo (Stremio Web/Desktop/Mobile/Android TV)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
app.use(cors({ origin: '*' }));

// 2. Normalizador de rutas para Vercel (x-matched-path / ?path=)
app.use((req, res, next) => {
  const matchedPath = req.headers['x-matched-path'];
  if (matchedPath && (req.url === '/api' || req.url.startsWith('/api?'))) {
    req.url = matchedPath;
  }
  next();
});

function requestBase(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${config.port}`;
  const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
  return { host, proto, baseUrl: `${proto}://${host}` };
}

// 3. Assets estáticos (logo)
app.use('/assets', express.static(path.join(__dirname, '..', 'assets'), { maxAge: '7d' }));

// 4. Healthcheck
app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    addon: addonInterface.manifest.id,
    version: addonInterface.manifest.version,
    catalogs: addonInterface.manifest.catalogs.length,
    sources: {
      tmdb: config.tmdbConfigured,
      tvmaze: true,
      omdb: config.omdbConfigured,
      watchmode: config.watchmodeConfigured,
    },
    watchRegion: config.watchRegion,
  });
});

// 5. Manifest dinámico: inyecta el logo apuntando al host actual
app.get(['/manifest.json', '/api/manifest.json'], (req, res) => {
  const { baseUrl } = requestBase(req);
  const manifest = { ...addonInterface.manifest, logo: `${baseUrl}/assets/logo.png` };
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(manifest);
});

// 6. Landing page en la raíz (navegador)
app.get(['/', '/api'], (req, res, next) => {
  const accept = req.headers.accept || '';
  if (accept.includes('application/json') && !accept.includes('text/html')) return next();

  const { host, proto, baseUrl } = requestBase(req);
  const manifestUrl = `${baseUrl}/manifest.json`;
  const stremioDeepLink = `stremio://${host}/manifest.json`;
  const html = renderLanding({
    manifestUrl,
    stremioDeepLink,
    manifest: { ...addonInterface.manifest, catalogs: addonInterface.manifest.catalogs },
    apiStatus: {
      tmdb: config.tmdbConfigured,
      omdb: config.omdbConfigured,
      watchmode: config.watchmodeConfigured,
      watchRegion: config.watchRegion,
    },
  });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// 7. Router oficial del SDK (/catalog/:type/:id.json y /meta/:type/:id.json)
app.use(getRouter(addonInterface));

// 8. 404 limpio
app.use((req, res) => {
  res.status(404).json({ error: 'not_found', message: 'Ruta no encontrada. Prueba /manifest.json' });
});

module.exports = app;
