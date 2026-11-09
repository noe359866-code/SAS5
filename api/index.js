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
const core = require('../lib/core');
const { renderHome } = require('../lib/homePage');
const { renderConfigure } = require('../lib/configurePage');
const tmdb = require('../lib/tmdb');
const { branding } = require('../lib/branding');
const userConfig = require('../lib/userConfig');
const { PLATFORM_KEYS, STUDIO_KEYS } = require('../lib/catalogs');
const { PROVIDER_KEYS: STREAM_KEYS, activeProviders, diagnose: diagnoseStreams } = require('../lib/streams');

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
    version: '1.2.0',
    catalogs: addonInterface.manifest.catalogs.length,
    configurable: true,
    sources: {
      tmdb: config.tmdbConfigured,
      tvmaze: true,
      omdb: config.omdbConfigured,
      watchmode: config.watchmodeConfigured,
      tvdb: config.tvdbConfigured,
      knaben: activeProviders(null).includes('knaben'),
      torlock: activeProviders(null).includes('torlock'),
      blackholebay: activeProviders(null).includes('blackholebay'),
    },
    streamProviders: activeProviders(null),
    watchRegion: config.watchRegion,
    watchRegionFallback: config.watchRegionFallback,
  });
});

// 4b. Página de configuración + branding (logos vía TMDB)
app.get('/configure', async (req, res) => {
  const { baseUrl, host } = requestBase(req);
  const trending = await loadTrending();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderConfigure({ origin: baseUrl, host, trendingMovies: trending.movies, trendingSeries: trending.series }));
});

app.get('/internal/branding.json', async (req, res) => {
  try {
    const lang = req.query.lang;
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(await branding(lang));
  } catch (err) {
    console.error('[Branding] ->', err.message);
    res.json({ providers: {}, studios: {}, tmdbConfigured: config.tmdbConfigured });
  }
});

app.get('/internal/streams-test.json', async (req, res) => {
  const type = req.query.type === 'series' ? 'series' : 'movie';
  const testId = req.query.id || 'tt1160419';
  res.json(await diagnoseStreams(type, testId, null));
});

// 4c. Manifest personal con config de usuario (/<base64url>/manifest.json)
function decodeUserConfig(req, res) {
  const cfg = userConfig.decodeConfig(req.params.cfg, PLATFORM_KEYS, STUDIO_KEYS, STREAM_KEYS);
  if (!cfg) {
    res.status(404).json({ error: 'invalid_config', message: 'Config inválida. Vuelve a /configure' });
    return null;
  }
  return cfg;
}

// Stremio abre /<tu-config>/configure al pulsar "Configurar": el
// configurador debe abrirse con TU región/selección ya cargada.
app.get('/:cfg/configure', async (req, res) => {
  const cfg = decodeUserConfig(req, res);
  if (!cfg) return;
  const { baseUrl, host } = requestBase(req);
  const trending = await loadTrending();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderConfigure({ origin: baseUrl, host, trendingMovies: trending.movies, trendingSeries: trending.series, initialCfg: cfg }));
});

app.get('/:cfg/manifest.json', (req, res) => {
  const cfg = decodeUserConfig(req, res);
  if (!cfg) return;
  const { baseUrl } = requestBase(req);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(core.buildManifest(`${baseUrl}/assets/logo.png`, cfg));
});

app.get('/:cfg/catalog/:type/:id.json', async (req, res) => {
  const cfg = decodeUserConfig(req, res);
  if (!cfg) return;
  const result = await core.handleCatalog(req.params.type, decodeURIComponent(req.params.id), cfg);
  res.setHeader('Cache-Control', `public, max-age=${config.cacheTtl}`);
  res.json(result);
});

app.get('/:cfg/meta/:type/:id.json', async (req, res) => {
  const cfg = decodeUserConfig(req, res);
  if (!cfg) return;
  const result = await core.handleMeta(req.params.type, decodeURIComponent(req.params.id), cfg);
  res.setHeader('Cache-Control', `public, max-age=${config.cacheTtl}`);
  res.json(result);
});

app.get('/:cfg/stream/:type/:id.json', async (req, res) => {
  const cfg = decodeUserConfig(req, res);
  if (!cfg) return;
  const result = await core.handleStream(req.params.type, decodeURIComponent(req.params.id), cfg);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json(result);
});

// 5. Manifest dinámico: logo apuntando al host actual
app.get(['/manifest.json', '/api/manifest.json'], (req, res) => {
  const { baseUrl } = requestBase(req);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(core.buildManifest(`${baseUrl}/assets/logo.png`));
});

// 6. Landing page en la raíz (navegador)
async function loadTrending() {
  if (!config.tmdbConfigured) return { movies: null, series: null, anime: null };
  try {
    const [movies, series, anime] = await Promise.all([
      tmdb.trending('movie', config.tmdbLanguage),
      tmdb.trending('tv', config.tmdbLanguage),
      tmdb.animeTrending(config.tmdbLanguage),
    ]);
    return { movies, series, anime };
  } catch (err) {
    console.error('[Trending] ->', err.message);
    return { movies: null, series: null, anime: null };
  }
}

app.get(['/', '/api'], async (req, res, next) => {
  const accept = req.headers.accept || '';
  if (accept.includes('application/json') && !accept.includes('text/html')) return next();

  const { host, baseUrl } = requestBase(req);
  const trending = await loadTrending();
  const html = renderHome({
    origin: baseUrl,
    host,
    trendingMovies: trending.movies,
    trendingSeries: trending.series,
    trendingAnime: trending.anime,
    apiStatus: { tmdb: config.tmdbConfigured },
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
