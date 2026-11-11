/**
 * Catálogos+ — Addon de Stremio para Cloudflare Workers
 *
 * Rutas:
 *   GET /                               Landing
 *   GET /configure                      Configurar idioma/región/plataformas/estudios
 *   GET /manifest.json                  Manifest por defecto (todo activado)
 *   GET /<config>/manifest.json         Manifest personal (config base64url)
 *   GET /catalog/:type/:id.json         Catálogos (config por defecto)
 *   GET /<config>/catalog/:type/:id.json
 *   GET /meta/:type/:id.json
 *   GET /<config>/meta/:type/:id.json
 *   GET /internal/branding.json         Logos de plataformas/estudios (vía TMDB)
 *   GET /healthz · GET /assets/logo.png
 *
 * Secrets/vars del Worker (ver wrangler.toml y README):
 *   TMDB_API_KEY | TMDB_ACCESS_TOKEN, OMDB_API_KEY, WATCHMODE_API_KEY, TVDB_API_KEY (+TVDB_PIN)
 *   Vars no secretas: WATCH_REGION, ADDON_NAME, TMDB_LANGUAGE, TMDB_MIN_VOTE_COUNT, CACHE_TTL_SECONDS,
 *                     SUPPORT_URL (soporte) y KOFI_USERNAME (botón de donaciones)
 */

import config from './lib/config.js';
import watchApiModule from './lib/watchApi.js';
import core from './lib/core.js';
import { renderHome } from './lib/homePage.js';
import { renderConfigure } from './lib/configurePage.js';
import tmdbClient from './lib/tmdb.js';
import { branding } from './lib/branding.js';
import userConfig from './lib/userConfig.js';
import catalogs from './lib/catalogs.js';
import streams from './lib/streams.js';
import cache from './lib/cache.js';
import debridCredentials from './lib/debridCredentials.js';
import debridProviders from './lib/debridProviders.js';
import realDebridOAuth from './lib/realDebridOAuth.js';
import rateLimit from './lib/rateLimit.js';
import logoData from './lib/logoData.js';

const LOGO_BYTES = Uint8Array.from(atob(logoData.base64), (c) => c.charCodeAt(0));
const CATALOG_RE = /^\/catalog\/(movie|series|anime)\/([^/]+?)(?:\/([^/]+))?\.json$/;
const META_RE = /^\/meta\/(movie|series)\/(.+)\.json$/;
const STREAM_RE = /^\/stream\/(movie|series)\/(.+)\.json$/;
// Mismo límite que lib/userConfig.js: una config "completa" generada por
// /configure ocupa ~600 caracteres, así que un tope de 512 la rechazaba
// (404 invalid_config → Stremio sin manifest ni streams).
const CONFIG_SEGMENT_MAX = userConfig.MAX_CONFIG_SEGMENT || 4096;
const CONFIG_PREFIX_RE = new RegExp(`^/([A-Za-z0-9_-]{8,${CONFIG_SEGMENT_MAX}})(/.*)$`);

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400',
    ...extra,
  };
}

function jsonResponse(data, status = 200, cacheSeconds = 3600) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : 'no-store',
    }),
  });
}

function htmlResponse(html) {
  return new Response(html, {
    status: 200,
    headers: corsHeaders({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }),
  });
}

/** Cache compartida de Cloudflare para las respuestas públicas repetidas. */
async function edgeCached(request, ctx, createResponse) {
  const edge = globalThis.caches && globalThis.caches.default;
  if (!edge || request.method !== 'GET') return createResponse();
  const key = new Request(request.url, { method: 'GET' });
  try {
    const cached = await edge.match(key);
    if (cached) return cached;
  } catch (_) { /* Cache API no disponible en algunos entornos locales */ }

  const response = await createResponse();
  const policy = response.headers.get('Cache-Control') || '';
  const cacheable = response.status === 200 && !/(?:no-store|private)/i.test(policy);
  if (cacheable) {
    const put = edge.put(key, response.clone()).catch(() => {});
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(put);
    else await put;
  }
  return response;
}

function workerRuntime(env, ctx) {
  return {
    env,
    waitUntil: ctx && typeof ctx.waitUntil === 'function' ? (promise) => ctx.waitUntil(promise) : undefined,
  };
}

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch (_) {
    return false;
  }
}

async function readJsonBody(request) {
  const length = Number(request.headers.get('content-length')) || 0;
  if (length > 4096) {
    const error = new Error('body_too_large');
    error.code = 'body_too_large';
    throw error;
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 4096) {
    const error = new Error('body_too_large');
    error.code = 'body_too_large';
    throw error;
  }
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid_body');
    return body;
  } catch (_) {
    const error = new Error('invalid_body');
    error.code = 'invalid_body';
    throw error;
  }
}

async function serveCatalog(type, id, cfg, request, ctx, extraPath = '') {
  return edgeCached(request, ctx, async () => {
    const result = await core.handleCatalog(type, decodeURIComponent(id), cfg, { ...Object.fromEntries(new URL(request.url).searchParams), ...Object.fromEntries(new URLSearchParams(extraPath)) });
    return jsonResponse(result, 200, result.cacheMaxAge ?? 0);
  });
}

async function serveMeta(type, id, cfg, request, ctx) {
  return edgeCached(request, ctx, async () => {
    const result = await core.handleMeta(type, decodeURIComponent(id), cfg);
    return jsonResponse(result, 200, result.cacheMaxAge ?? 0);
  });
}

async function serveStream(type, id, cfg, request, env, ctx) {
  const create = async () => {
    const result = await core.handleStream(type, decodeURIComponent(id), cfg, workerRuntime(env, ctx));
    return jsonResponse(result, 200, result.cacheMaxAge ?? 0);
  };
  // Nunca guardar enlaces directos de una cuenta debrid en una caché compartida.
  return cfg && cfg.debridId ? create() : edgeCached(request, ctx, create);
}

/** Tendencias semanales TMDB (solo si hay clave; si no, estáticos). */
async function loadTrending() {
  if (!config.tmdbConfigured) return { movies: null, series: null, anime: null };
  try {
    const [movies, series, anime] = await Promise.all([
      tmdbClient.trending('movie', config.tmdbLanguage),
      tmdbClient.trending('tv', config.tmdbLanguage),
      tmdbClient.animeTrending(config.tmdbLanguage),
    ]);
    return { movies, series, anime };
  } catch (err) {
    console.error('[Trending] ->', err && err.message);
    return { movies: null, series: null, anime: null };
  }
}

export default {
  async fetch(request, env, ctx) {
    try {
      config.reload(env || {});
    } catch (err) {
      console.error('[Worker] reload config ->', err && err.message);
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const redirectConfigure = (query = {}, extraHeaders = {}) => {
      const destination = new URL('/configure', request.url);
      for (const [key, value] of Object.entries(query)) destination.searchParams.set(key, String(value));
      return new Response(null, {
        status: 302,
        headers: corsHeaders({ 'Location': destination.toString(), 'Cache-Control': 'no-store', ...extraHeaders }),
      });
    };

    if (path === realDebridOAuth.CALLBACK_PATH.replace(/\/$/, '') && request.method === 'GET') {
      const secure = url.protocol === 'https:';
      const clearedCookie = realDebridOAuth.clearStateCookie(secure);
      const state = url.searchParams.get('state') || '';
      const headers = { 'Referrer-Policy': 'no-referrer', 'Set-Cookie': clearedCookie };
      if (!realDebridOAuth.verifyState(state, request.headers.get('cookie'))) {
        return redirectConfigure({ debrid_error: 'oauth_failed' }, headers);
      }
      if (url.searchParams.has('error')) {
        return redirectConfigure({ debrid_error: 'oauth_denied' }, headers);
      }
      try {
        const result = await realDebridOAuth.completeAuthorization(url.searchParams.get('code'), env || {});
        return redirectConfigure({ debrid_credential: result.credentialId }, headers);
      } catch (_) {
        console.error('[Debrid] No se pudo completar OAuth de Real-Debrid.');
        return redirectConfigure({ debrid_error: 'oauth_failed' }, headers);
      }
    }

    if (path === '/internal/debrid/real-debrid/authorize' && request.method === 'GET') {
      if (!debridCredentials.isConfigured(env || {})) {
        return redirectConfigure({ debrid_error: 'storage_not_configured' }, { 'Referrer-Policy': 'no-referrer' });
      }
      try {
        const authorization = realDebridOAuth.makeAuthorization({ origin: url.origin, env: env || {} });
        return new Response(null, {
          status: 302,
          headers: corsHeaders({
            Location: authorization.authorizationUrl,
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
            'Set-Cookie': realDebridOAuth.stateCookie(authorization.state, url.protocol === 'https:'),
          }),
        });
      } catch (err) {
        const error = err && err.code === 'realdebrid_oauth_not_configured' ? 'oauth_not_configured' : 'oauth_failed';
        return redirectConfigure({ debrid_error: error }, { 'Referrer-Policy': 'no-referrer' });
      }
    }

    if (path === '/internal/debrid/real-debrid/authorize' || path === realDebridOAuth.CALLBACK_PATH) {
      return jsonResponse({ error: 'method_not_allowed' }, 405, 0);
    }

    if ((path === '/internal/debrid/connect') && (request.method === 'POST' || request.method === 'DELETE')) {
      if (!sameOrigin(request)) return jsonResponse({ error: 'origin_not_allowed' }, 403, 0);
      const clientIp = request.headers.get('cf-connecting-ip') ||
        (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
      if (request.method === 'POST' && !rateLimit.allow(`debrid-connect:${clientIp}`, { limit: 8, windowMs: 60_000 })) {
        return jsonResponse({ error: 'rate_limited', message: 'Espera un minuto antes de volver a conectar.' }, 429, 0);
      }
      try {
        const body = await readJsonBody(request);
        if (request.method === 'DELETE') {
          await debridCredentials.disconnect(body.credentialId, env || {});
          return jsonResponse({ ok: true }, 200, 0);
        }
        const provider = String(body.provider || '').trim().toLowerCase();
        const token = String(body.token || '').trim();
        if (provider === 'realdebrid') {
          return jsonResponse({ error: 'oauth_required', message: 'Real-Debrid debe conectarse mediante OAuth; no pegues tu token API privado.' }, 400, 0);
        }
        if (!['torbox', 'easydebrid', 'premiumize'].includes(provider) || !token || token.length > 1024 || /\s/.test(token)) {
          return jsonResponse({ error: 'invalid_credential', message: 'Selecciona un proveedor y pega una clave API válida.' }, 400, 0);
        }
        if (!debridCredentials.isConfigured(env || {})) {
          return jsonResponse({ error: 'debrid_not_configured', message: 'El servidor debe configurar DEBRID_KV y DEBRID_ENCRYPTION_KEY.' }, 503, 0);
        }
        await debridProviders.validateCredential(provider, token);
        const result = await debridCredentials.createCredential({ provider, token }, env || {});
        return jsonResponse({ ok: true, credentialId: result.credentialId, provider: result.provider }, 200, 0);
      } catch (err) {
        if (err && err.code === 'invalid_body') {
          return jsonResponse({ error: 'invalid_body', message: 'Envía un objeto JSON válido de hasta 4 KB.' }, 400, 0);
        }
        if (err && err.code === 'body_too_large') {
          return jsonResponse({ error: 'body_too_large', message: 'El cuerpo supera el límite de 4 KB.' }, 413, 0);
        }
        if (err && (err.code === 'invalid_credential' || err.status === 401 || err.status === 403)) {
          return jsonResponse({ error: 'invalid_credential', message: 'El proveedor rechazó la clave API. Compruébala en tu cuenta.' }, 400, 0);
        }
        if (err && (err.code === 'debrid_storage_not_configured' || err.code === 'debrid_encryption_not_configured')) {
          return jsonResponse({ error: 'debrid_not_configured', message: 'El servidor debe configurar DEBRID_KV y DEBRID_ENCRYPTION_KEY.' }, 503, 0);
        }
        if (err && err.code === 'provider_invalid') return jsonResponse({ error: 'provider_invalid' }, 400, 0);
        console.error('[Debrid] No se pudo validar una credencial de proveedor.');
        return jsonResponse({ error: 'debrid_unavailable', message: 'No se pudo validar el proveedor. Inténtalo más tarde.' }, 502, 0);
      }
    }
    if (path === '/internal/debrid/connect') return jsonResponse({ error: 'method_not_allowed' }, 405, 0);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return jsonResponse({ error: 'method_not_allowed' }, 405, 0);
    }

    if (path.startsWith('/internal/watch/')) {
      try {
        const { body, status } = await watchApiModule.watchApi(url);
        return jsonResponse(body, status, 0);
      } catch (_) { return jsonResponse({ error: 'La fuente no respondió. Inténtalo de nuevo.' }, 502, 0); }
    }

    const origin = url.origin;
    const host = url.host;

    // ── Portada estilo streaming (tendencias en vivo si hay TMDB) ─
    if (path === '/' || path === '/api') {
      const accept = request.headers.get('accept') || '';
      if (!accept.includes('text/html') && accept.includes('application/json')) {
        return jsonResponse(core.buildManifest(`${origin}/assets/logo.png`), 200, 300);
      }
      const trending = await loadTrending();
      const html = renderHome({
        origin,
        host,
        trendingMovies: trending.movies,
        trendingSeries: trending.series,
        trendingAnime: trending.anime,
        apiStatus: { tmdb: config.tmdbConfigured },
      });
      return htmlResponse(html);
    }

    // ── Página de configuración ───────────────────────────────
    if (path === '/configure') {
      const trending = await loadTrending();
      return htmlResponse(renderConfigure({ origin, host, trendingMovies: trending.movies, trendingSeries: trending.series }));
    }

    // ── Estado agregado de la caché (sin claves ni datos por usuario) ──
    if (path === '/internal/cache.json') {
      return jsonResponse(cache.stats(), 200, 0);
    }

    // ── Branding (logos de plataformas/estudios vía TMDB) ─────
    if (path === '/internal/branding.json') {
      const lang = url.searchParams.get('lang') || undefined;
      return jsonResponse(await branding(lang), 200, 3600);
    }

    // ── Diagnóstico de streams (¿por qué no aparecen resultados?) ──
    if (path === '/internal/streams-test.json') {
      const type = url.searchParams.get('type') === 'series' ? 'series' : 'movie';
      const testId = url.searchParams.get('id') || 'tt1160419';
      return jsonResponse(await streams.diagnose(type, testId, null), 200, 0);
    }

    // ── Healthcheck ───────────────────────────────────────────
    if (path === '/healthz') {
      return jsonResponse(
        {
          ok: true,
          addon: 'org.comunidad.catalogos.plus',
          version: '1.5.0',
          runtime: 'cloudflare-workers',
          configurable: true,
          catalogs: core.CATALOGS.length,
          platforms: catalogs.PLATFORMS.length,
          studios: catalogs.STUDIOS.length,
          sources: {
            tmdb: config.tmdbConfigured,
            tvmaze: true,
            omdb: config.omdbConfigured,
            watchmode: config.watchmodeConfigured,
            tvdb: config.tvdbConfigured,
            // knaben, torlock, blackholebay, nyaa, yts, eztv, rarbg: true si está activo
            ...Object.fromEntries(
              streams.PROVIDER_KEYS.map((key) => [key, streams.activeProviders(null).includes(key)])
            ),
          },
          streamProviders: streams.activeProviders(null),
          debrid: { providers: debridProviders.PROVIDERS.map((provider) => provider.key) },
          realDebrid: {
            supported: true,
            mode: 'oauth-personal-library',
            oauthConfigured: realDebridOAuth.isConfigured(env || {}),
            credentialStorageReady: debridCredentials.isConfigured(env || {}),
          },
          // Donaciones: enlace a la página de Ko-fi (se paga allí con PayPal o tarjeta).
          donations: { provider: 'kofi', enabled: config.kofiEnabled, page: config.kofiUrl || null },
          cache: cache.stats(),
          watchRegion: config.watchRegion,
          watchRegionFallback: config.watchRegionFallback,
        },
        200,
        0
      );
    }

    // ── Logo embebido ─────────────────────────────────────────
    if (path === '/assets/logo.png' || path === '/logo.png') {
      return new Response(LOGO_BYTES, {
        status: 200,
        headers: corsHeaders({
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=604800, immutable',
        }),
      });
    }

    // ── Manifest por defecto ──────────────────────────────────
    if (path === '/manifest.json') {
      return edgeCached(request, ctx, async () => jsonResponse(core.buildManifest(`${origin}/assets/logo.png`), 200, 300));
    }

    // ── Catálogos / Metadatos con config por defecto ──────────
    let match = path.match(CATALOG_RE);
    if (match) return serveCatalog(match[1], match[2], null, request, ctx, match[3]);
    match = path.match(META_RE);
    if (match) return serveMeta(match[1], match[2], null, request, ctx);
    match = path.match(STREAM_RE);
    if (match) return serveStream(match[1], match[2], null, request, env, ctx);

    // ── Rutas con prefijo de config de usuario: /<cfg>/... ────
    const prefixed = path.match(CONFIG_PREFIX_RE);
    if (prefixed) {
      const cfg = userConfig.decodeConfig(prefixed[1], catalogs.PLATFORM_KEYS, catalogs.STUDIO_KEYS, streams.PROVIDER_KEYS);
      if (cfg) {
        const rest = prefixed[2].replace(/\/+$/, '') || '/';
        const logoUrl = `${origin}/assets/logo.png`;
        // Stremio abre /<tu-config>/configure al pulsar "Configurar":
        // debe abrir el configurador con TU región/selección ya cargada.
        if (rest === '/configure') {
          const trending = await loadTrending();
          return htmlResponse(renderConfigure({ origin, host, trendingMovies: trending.movies, trendingSeries: trending.series, initialCfg: cfg }));
        }
        if (rest === '/manifest.json') {
          const createManifest = () => jsonResponse(core.buildManifest(logoUrl, cfg), 200, cfg.debridId ? 0 : 300);
          return cfg.debridId ? createManifest() : edgeCached(request, ctx, createManifest);
        }
        let m2 = rest.match(CATALOG_RE);
        if (m2) return serveCatalog(m2[1], m2[2], cfg, request, ctx, m2[3]);
        m2 = rest.match(META_RE);
        if (m2) return serveMeta(m2[1], m2[2], cfg, request, ctx);
        m2 = rest.match(STREAM_RE);
        if (m2) return serveStream(m2[1], m2[2], cfg, request, env, ctx);
      }
      // Prefijo con pinta de config pero inválida → 404 limpio
      return jsonResponse({ error: 'invalid_config', message: 'Config inválida. Vuelve a /configure' }, 404, 0);
    }

    return jsonResponse(
      { error: 'not_found', message: 'Ruta no encontrada. Prueba /manifest.json o /configure' },
      404,
      0
    );
  },
};
