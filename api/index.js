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
const { PLATFORM_KEYS, STUDIO_KEYS, PLATFORMS, STUDIOS } = require('../lib/catalogs');
const { PROVIDER_KEYS: STREAM_KEYS, activeProviders, diagnose: diagnoseStreams } = require('../lib/streams');
const cache = require('../lib/cache');
const debridCredentials = require('../lib/debridCredentials');
const debridProviders = require('../lib/debridProviders');
const debridConnect = require('../lib/debridConnect');
const realDebridOAuth = require('../lib/realDebridOAuth');
const rateLimit = require('../lib/rateLimit');
const mirrors = require('../lib/mirrors');

const app = express();

// 1. CORS permisivo (Stremio Web/Desktop/Mobile/Android TV)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '4kb', strict: true }));

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

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (origin) {
    try {
      return new URL(origin).origin === new URL(requestBase(req).baseUrl).origin;
    } catch (_) {
      return false;
    }
  }
  // Igual que en el Worker: los navegadores integrados (webview de Stremio,
  // QtWebEngine, WebViews de Android) a veces omiten `Origin` en POST
  // same-origin; `Sec-Fetch-Site` y `Referer` son señales válidas del mismo sitio.
  const secFetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (secFetchSite === 'same-origin' || secFetchSite === 'none') return true;
  const referer = req.headers.referer;
  if (referer) {
    try {
      return new URL(referer).origin === new URL(requestBase(req).baseUrl).origin;
    } catch (_) {
      return false;
    }
  }
  return false;
}

// 3. Assets estáticos (logo)
app.use('/assets', express.static(path.join(__dirname, '..', 'assets'), { maxAge: '7d' }));

function buildCacheControl(cacheSeconds, staleSeconds = 86400) {
  if (!cacheSeconds || cacheSeconds <= 0) return 'no-store';
  const swr = Math.max(cacheSeconds, staleSeconds);
  return `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}, stale-while-revalidate=${swr}, stale-if-error=604800`;
}

// 4. Healthcheck
app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    addon: addonInterface.manifest.id,
    version: addonInterface.manifest.version,
    catalogs: addonInterface.manifest.catalogs.length,
    platforms: PLATFORMS.length,
    studios: STUDIOS.length,
    configurable: true,
    sources: {
      tmdb: config.tmdbConfigured,
      tvmaze: true,
      omdb: config.omdbConfigured,
      // knaben, torlock, blackholebay, nyaa, yts, eztv, rarbg, torrentindexer, torrentioes: true si está activo
      ...Object.fromEntries(STREAM_KEYS.map((key) => [key, activeProviders(null).includes(key)])),
    },
    streamProviders: activeProviders(null),
    debrid: { providers: debridProviders.PROVIDERS.map((provider) => provider.key) },
    realDebrid: {
      supported: true,
      mode: 'oauth-personal-library',
      oauthConfigured: realDebridOAuth.isConfigured(),
      credentialStorageReady: debridCredentials.isConfigured(),
      credentialStorage: debridCredentials.storageKind(),
    },
    // Donaciones: enlace a la página de Ko-fi (se paga allí con PayPal o tarjeta).
    donations: { provider: 'kofi', enabled: config.kofiEnabled, page: config.kofiUrl || null },
    cache: cache.stats(),
    // Espejos de cuota: cuántos despliegues suman y cuál es el techo real.
    mirrors: mirrors.report({ self: requestBase(req).baseUrl, mirrors: config.mirrorOrigins }),
    language: config.tmdbLanguage,
    watchRegion: config.watchRegion,
    watchRegionFallback: config.watchRegionFallback,
  });
});

// 4b. Página de configuración + branding (logos vía TMDB)
app.get('/configure', async (req, res) => {
  const { baseUrl, host } = requestBase(req);
  const hasOAuthParams = Boolean(req.query.debrid_credential || req.query.debrid_error);
  const trending = await loadTrending();
  res.setHeader('Cache-Control', hasOAuthParams ? 'no-store' : buildCacheControl(1800, 86400));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderConfigure({
    origin: baseUrl,
    host,
    trendingMovies: trending.movies,
    trendingSeries: trending.series,
    mirrors: config.mirrorOrigins,
  }));
});

app.get('/internal/branding.json', async (req, res) => {
  try {
    const lang = req.query.lang;
    res.setHeader('Cache-Control', buildCacheControl(86400, 604800));
    res.json(await branding(lang));
  } catch (err) {
    console.error('[Branding] ->', err.message);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ providers: {}, studios: {}, tmdbConfigured: config.tmdbConfigured });
  }
});

app.get('/internal/streams-test.json', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
  if (!rateLimit.allow(`streams-test:${clientIp}`, { limit: 6, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'rate_limited', message: 'Demasiadas pruebas seguidas. Espera un minuto.' });
  }
  const type = req.query.type === 'series' ? 'series' : 'movie';
  const testId = req.query.id || 'tt1160419';
  const diagKey = `diag:${type}:${testId}`;
  const diag = await cache.coalesce(diagKey, async () => {
    const cached = cache.get(diagKey);
    if (cached) return cached;
    const fresh = await diagnoseStreams(type, testId, null);
    cache.set(diagKey, fresh, 30);
    return fresh;
  });
  return res.json(diag);
});

app.get('/internal/cache.json', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(cache.stats());
});

// Espejos de cuota: cuántos despliegues suman cuota y cuál es el techo real.
app.get('/internal/mirrors.json', (req, res) => {
  const { baseUrl } = requestBase(req);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(mirrors.report({ self: baseUrl, mirrors: config.mirrorOrigins }));
});

function redirectConfigure(req, res, query = {}) {
  const destination = new URL('/configure', requestBase(req).baseUrl);
  for (const [key, value] of Object.entries(query)) destination.searchParams.set(key, String(value));
  res.status(302).setHeader('Location', destination.toString());
  res.end();
}

app.get('/internal/debrid/real-debrid/authorize', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const { baseUrl, proto } = requestBase(req);
  if (!debridCredentials.isConfigured()) {
    return redirectConfigure(req, res, { debrid_error: 'storage_not_configured' });
  }
  try {
    const authorization = realDebridOAuth.makeAuthorization({ origin: baseUrl });
    res.setHeader('Set-Cookie', realDebridOAuth.stateCookie(authorization.state, proto === 'https'));
    res.redirect(302, authorization.authorizationUrl);
  } catch (err) {
    redirectConfigure(req, res, {
      debrid_error: err && err.code === 'realdebrid_oauth_not_configured' ? 'oauth_not_configured' : 'oauth_failed',
    });
  }
});

app.get('/internal/debrid/real-debrid/callback', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const { proto } = requestBase(req);
  const secure = proto === 'https';
  res.setHeader('Set-Cookie', realDebridOAuth.clearStateCookie(secure));
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  if (!realDebridOAuth.verifyState(state, req.headers.cookie)) {
    return redirectConfigure(req, res, { debrid_error: 'oauth_failed' });
  }
  if (typeof req.query.error === 'string') {
    return redirectConfigure(req, res, { debrid_error: 'oauth_denied' });
  }
  try {
    const result = await realDebridOAuth.completeAuthorization(req.query.code);
    return redirectConfigure(req, res, { debrid_credential: result.credentialId });
  } catch (_) {
    console.error('[Debrid] No se pudo completar OAuth de Real-Debrid.');
    return redirectConfigure(req, res, { debrid_error: 'oauth_failed' });
  }
});

app.post('/internal/debrid/connect', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!sameOrigin(req)) {
    return res.status(403).json({
      error: 'origin_not_allowed',
      message: 'La petición no se ve venir de este dominio. Abre /configure de este servidor en el navegador y vuelve a intentarlo.',
    });
  }
  if (!rateLimit.allow(`debrid-connect:${req.ip || 'unknown'}`, { limit: 8, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'rate_limited', message: 'Espera un minuto antes de volver a conectar.' });
  }
  // Misma validación, mismo cifrado y mismos mensajes que el Worker de Cloudflare.
  const { status, payload } = await debridConnect.connect(req.body || {}, {
    storageMessage: 'El servidor debe configurar almacenamiento privado y DEBRID_ENCRYPTION_KEY.',
  });
  return res.status(status).json(payload);
});

app.delete('/internal/debrid/connect', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!sameOrigin(req)) return res.status(403).json({ error: 'origin_not_allowed' });
  try {
    await debridCredentials.disconnect(req.body && req.body.credentialId);
    res.json({ ok: true });
  } catch (err) {
    if (err && (err.code === 'debrid_storage_not_configured' || err.code === 'debrid_encryption_not_configured')) {
      return res.status(503).json({ error: 'debrid_not_configured' });
    }
    console.error('[Debrid] No se pudo desconectar la cuenta.');
    return res.status(503).json({ error: 'debrid_unavailable' });
  }
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
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderConfigure({
    origin: baseUrl,
    host,
    trendingMovies: trending.movies,
    trendingSeries: trending.series,
    initialCfg: cfg,
    mirrors: config.mirrorOrigins,
  }));
});

app.get('/:cfg/manifest.json', (req, res) => {
  const cfg = decodeUserConfig(req, res);
  if (!cfg) return;
  const { baseUrl } = requestBase(req);
  res.setHeader('Cache-Control', cfg.debridId ? 'no-store' : buildCacheControl(300, 3600));
  res.json(core.buildManifest(`${baseUrl}/assets/logo.png`, cfg));
});

app.get(['/:cfg/catalog/:type/:id.json', '/:cfg/catalog/:type/:id/:extra.json'], async (req, res) => {
  const cfg = decodeUserConfig(req, res);
  if (!cfg) return;
  let id;
  try { id = decodeURIComponent(req.params.id); } catch (_) { id = req.params.id; }
  const result = await core.handleCatalog(req.params.type, id, cfg, { ...req.query, ...Object.fromEntries(new URLSearchParams(req.params.extra || '')) });
  res.setHeader('Cache-Control', buildCacheControl(result.cacheMaxAge));
  res.json(result);
});

app.get('/:cfg/meta/:type/:id.json', async (req, res) => {
  const cfg = decodeUserConfig(req, res);
  if (!cfg) return;
  let id;
  try { id = decodeURIComponent(req.params.id); } catch (_) { return res.status(400).json({ error: 'invalid_id' }); }
  const result = await core.handleMeta(req.params.type, id, cfg);
  res.setHeader('Cache-Control', buildCacheControl(result.cacheMaxAge));
  res.json(result);
});

app.get('/:cfg/stream/:type/:id.json', async (req, res) => {
  const cfg = decodeUserConfig(req, res);
  if (!cfg) return;
  let id;
  try { id = decodeURIComponent(req.params.id); } catch (_) { return res.status(400).json({ error: 'invalid_id' }); }
  const result = await core.handleStream(req.params.type, id, cfg);
  res.setHeader('Cache-Control', cfg.debridId ? 'no-store' : buildCacheControl(result.cacheMaxAge));
  res.json(result);
});

// 5. Manifest dinámico: logo apuntando al host actual
app.get(['/manifest.json', '/api/manifest.json'], (req, res) => {
  const { baseUrl } = requestBase(req);
  res.setHeader('Cache-Control', buildCacheControl(300, 3600));
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
    mirrors: config.mirrorOrigins,
  });
  res.setHeader('Cache-Control', buildCacheControl(1800, 86400));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// 7. Router oficial del SDK (/catalog/:type/:id.json y /meta/:type/:id.json)
app.use(getRouter(addonInterface));

// Errores del parser JSON de las rutas internas (sin cuerpos de excepción).
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'body_too_large' });
  if (err instanceof SyntaxError && err.status === 400) return res.status(400).json({ error: 'invalid_body' });
  return next(err);
});

// 8. 404 limpio
app.use((req, res) => {
  res.status(404).json({ error: 'not_found', message: 'Ruta no encontrada. Prueba /manifest.json' });
});

module.exports = app;
