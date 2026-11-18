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
 *   TMDB_API_KEY | TMDB_ACCESS_TOKEN, OMDB_API_KEY
 *   Vars no secretas: WATCH_REGION, ADDON_NAME, TMDB_LANGUAGE, TMDB_MIN_VOTE_COUNT, CACHE_TTL_SECONDS,
 *                     SUPPORT_URL (soporte), KOFI_USERNAME (botón de donaciones) y
 *                     DEBRID_VALIDATE_TIMEOUT_MS (plazo al validar claves debrid en /configure)
 * Rutas debrid: ver lib/debridConnect.js (validación + mensajes) y lib/debridShared.js (red).
 */

import config from './lib/config.js';
import responseCache from './lib/responseCache.js';
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
import debridConnect from './lib/debridConnect.js';
import realDebridOAuth from './lib/realDebridOAuth.js';
import rateLimit from './lib/rateLimit.js';
// Proxy HLS propio: evita depender del proxy de la web de SpinFlix y pone el
// Referer en CADA segmento, no solo en la primera playlist.
import hlsProxy from './lib/hlsProxy.js';
import logoData from './lib/logoData.js';
import configRegistry from './lib/configRegistry.js';
// Espejos de cuota: reparto de usuarios entre varios despliegues del addon.
import mirrors from './lib/mirrors.js';

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

function buildCacheControl(cacheSeconds, staleSeconds = 86400) {
  if (!cacheSeconds || cacheSeconds <= 0) return 'no-store';
  const swr = Math.max(cacheSeconds, staleSeconds);
  return `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}, stale-while-revalidate=${swr}, stale-if-error=604800`;
}

function jsonResponse(data, status = 200, cacheSeconds = 3600, explicitCacheControl) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': explicitCacheControl || buildCacheControl(cacheSeconds),
    }),
  });
}

function htmlResponse(html, cacheSeconds = 0) {
  return new Response(html, {
    status: 200,
    headers: corsHeaders({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': cacheSeconds > 0 ? buildCacheControl(cacheSeconds, 86400) : 'no-store',
    }),
  });
}

/**
 * Cache compartida de Cloudflare para las respuestas públicas repetidas.
 * Permite pasar una URL canónica (`cacheUrl`) para que usuarios con distinto
 * prefijo `/<cfg>/` (p. ej. distinto debridId o distintos filtros de streams)
 * compartan la misma entrada de catálogo/meta/stream-público en el PoP local.
 */
/**
 * Segundos de vida de una respuesta según el `Cache-Control` que publicamos.
 * Así la caché en memoria y la Cache API no contradicen la promesa pública.
 */
function cacheTtl(policy) {
  const swr = /(?:^|,\s*)stale-while-revalidate=(\d+)/i.exec(policy || '');
  const fresh = /(?:^|,\s*)s-maxage=(\d+)/i.exec(policy || '')
    || /(?:^|,\s*)max-age=(\d+)/i.exec(policy || '');
  return {
    ttl: fresh ? Number(fresh[1]) : 0,
    stale: swr ? Number(swr[1]) : 0,
  };
}

/**
 * Tres niveles, en orden de coste:
 *  1. Memoria del isolate (funciona siempre, incluido `*.workers.dev`).
 *  2. Cache API del borde (solo opera en dominio propio).
 *  3. Ejecutar el handler (fan-out real: TMDB, indexadores…).
 *
 * Las respuestas `no-store`/`private` (Debrid, degradadas) nunca se guardan.
 */
async function edgeCached(request, ctx, createResponse, cacheUrl) {
  const edge = globalThis.caches && globalThis.caches.default;
  const key = cacheUrl || request.url;
  if (request.method !== 'GET') return createResponse();

  // 1) Memoria del isolate (gratis: ni CPU ni subpeticiones).
  const fromMemory = responseCache.get(key);
  if (fromMemory) return rebuildResponse(fromMemory);

  // 1b) Caducado pero en su ventana de gracia: se sirve y se recalcula en
  //     segundo plano (stale-while-revalidate), como promete la cabecera.
  const stale = responseCache.getStale(key);
  if (stale) {
    const refresh = responseCache.coalesce(key, () => runAndCache(key, createResponse, ctx, edge)).catch(() => {});
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(refresh);
    return rebuildResponse(stale);
  }

  // 2) Cache API del borde. `match` cuenta como subpetición, así que solo se
  //    consulta cuando la memoria no tiene nada.
  if (!edge) return responseCache.coalesce(key, () => runAndCache(key, createResponse, ctx, null));

  try {
    const cached = await edge.match(new Request(key, { method: 'GET' }));
    if (cached) {
      try {
        cached.headers.set('X-Catalogos-Cache', 'edge');
      } catch (_) { /* cabeceras inmutables: solo instrumentación */ }
      return cached;
    }
  } catch (_) { /* Cache API no disponible (p. ej. en local) */ }

  // 3) Ejecutar el handler una sola vez para las peticiones concurrentes.
  return responseCache.coalesce(key, () => runAndCache(key, createResponse, ctx, edge));
}

/** Reconstruye una respuesta guardada como texto + cabeceras. */
function rebuildResponse(entry, level = 'memory') {
  const stored = JSON.parse(entry);
  const response = new Response(stored.body, { status: stored.status, headers: stored.headers });
  try {
    response.headers.set('X-Catalogos-Cache', level);
  } catch (_) { /* cabeceras inmutables: solo instrumentación */ }
  return response;
}

/** Serializa una respuesta para guardarla en la memoria del isolate. */
async function serializeResponse(response) {
  const clone = response.clone();
  const body = await clone.text();
  return JSON.stringify({
    status: response.status,
    headers: [...response.headers],
    body,
  });
}

async function runAndCache(key, createResponse, ctx, edge) {
  const response = await createResponse();
  try {
    response.headers.set('X-Catalogos-Cache', 'miss');
  } catch (_) { /* cabeceras inmutables: solo instrumentación */ }
  const policy = response.headers.get('Cache-Control') || '';
  const cacheable = response.status === 200 && !/(?:no-store|private)/i.test(policy);
  if (!cacheable) return response;
  const { ttl, stale } = cacheTtl(policy);
  if (edge) {
    const put = Promise.resolve()
      .then(() => edge.put(new Request(key, { method: 'GET' }), response.clone()))
      .catch(() => {});
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(put);
    else await put;
  }
  if (ttl > 0) {
    const store = Promise.resolve()
      .then(() => serializeResponse(response))
      // La ventana de gracia se toma del `stale-while-revalidate` publicado (hasta
      // 24 h): mientras siga en memoria, la petición no ejecuta el handler.
      .then((entry) => responseCache.set(key, entry, ttl, { staleSeconds: stale || 3600 }))
      .catch(() => {});
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(store);
    else await store;
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
  if (origin) {
    try {
      return new URL(origin).origin === new URL(request.url).origin;
    } catch (_) {
      return false;
    }
  }
  // Algunos navegadores integrados (el webview de Stremio, QtWebEngine,
  // algunas WebViews de Android) no mandan `Origin` en un POST same-origin.
  // Sin comprobar el mismo sitio, /configure devolvía 403 y el usuario solo veía
  // «No se pudo conectar TorBox». `Sec-Fetch-Site` es la señal moderna y fiable;
  // el `Referer` queda como respaldo.
  const secFetchSite = String(request.headers.get('sec-fetch-site') || '').toLowerCase();
  if (secFetchSite === 'same-origin' || secFetchSite === 'none') return true;
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return new URL(referer).origin === new URL(request.url).origin;
    } catch (_) {
      return false;
    }
  }
  return false;
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

function canonicalCatalogCacheUrl(requestUrl, type, id, cfg, extra) {
  const u = new URL(requestUrl);
  const lang = (cfg && cfg.lang) || config.tmdbLanguage || 'es';
  const region = (cfg && cfg.region) || config.watchRegion || 'NI';
  const skip = Number(extra && extra.skip ? extra.skip : 0) || 0;
  return `${u.origin}/__edge/catalog/${type}/${encodeURIComponent(id)}?lang=${encodeURIComponent(lang)}&region=${encodeURIComponent(region)}&skip=${skip}`;
}

function canonicalMetaCacheUrl(requestUrl, type, id, cfg) {
  const u = new URL(requestUrl);
  const lang = (cfg && cfg.lang) || config.tmdbLanguage || 'es';
  const region = (cfg && cfg.region) || config.watchRegion || 'NI';
  return `${u.origin}/__edge/meta/${type}/${encodeURIComponent(id)}?lang=${encodeURIComponent(lang)}&region=${encodeURIComponent(region)}`;
}

function canonicalStreamCacheUrl(requestUrl, type, id, cfg) {
  const u = new URL(requestUrl);
  const active = streams.activeProviders(cfg).slice().sort().join(',');
  const hide = Array.isArray(cfg && cfg.hide) ? cfg.hide.slice().sort().join(',') : '';
  const badges = Array.isArray(cfg && cfg.badges) ? cfg.badges.slice().sort().join(',') : 'all';
  const sort = (cfg && cfg.sort) || 'peers';
  const maxSize = Number(cfg && cfg.maxSize) || 0;
  return `${u.origin}/__edge/stream/${type}/${encodeURIComponent(id)}?p=${encodeURIComponent(active)}&h=${encodeURIComponent(hide)}&b=${encodeURIComponent(badges)}&s=${encodeURIComponent(sort)}&m=${maxSize}`;
}

function safeDecode(value) {
  try { return decodeURIComponent(value); } catch (_) { return null; }
}

async function serveCatalog(type, id, cfg, request, ctx, extraPath = '') {
  const decodedId = safeDecode(id);
  if (decodedId === null) return jsonResponse({ error: 'invalid_id' }, 400, 0);
  if (cfg) {
    const visible = catalogs.buildDefs(cfg);
    if (!visible.some((d) => d.id === decodedId && d.type === type)) {
      const empty = await core.handleCatalog(type, decodedId, cfg, {});
      return jsonResponse(empty, 200, 0);
    }
  }
  const extra = { ...Object.fromEntries(new URL(request.url).searchParams), ...Object.fromEntries(new URLSearchParams(extraPath)) };
  const cacheUrl = canonicalCatalogCacheUrl(request.url, type, decodedId, cfg, extra);
  return edgeCached(request, ctx, async () => {
    const result = await core.handleCatalog(type, decodedId, cfg, extra);
    return jsonResponse(result, 200, result.cacheMaxAge ?? 0);
  }, cacheUrl);
}

async function serveMeta(type, id, cfg, request, ctx) {
  const decodedId = safeDecode(id);
  if (decodedId === null) return jsonResponse({ error: 'invalid_id' }, 400, 0);
  const cacheUrl = canonicalMetaCacheUrl(request.url, type, decodedId, cfg);
  return edgeCached(request, ctx, async () => {
    const result = await core.handleMeta(type, decodedId, cfg);
    return jsonResponse(result, 200, result.cacheMaxAge ?? 0);
  }, cacheUrl);
}

async function serveStream(type, id, cfg, request, env, ctx) {
  const decodedId = safeDecode(id);
  if (decodedId === null) return jsonResponse({ error: 'invalid_id' }, 400, 0);
  const create = async () => {
    const result = await core.handleStream(type, decodedId, cfg, workerRuntime(env, ctx));
    return jsonResponse(result, 200, result.cacheMaxAge ?? 0);
  };
  // Nunca guardar enlaces directos de una cuenta debrid en una caché compartida.
  if (cfg && cfg.debridId) return create();
  const cacheUrl = canonicalStreamCacheUrl(request.url, type, decodedId, cfg);
  return edgeCached(request, ctx, create, cacheUrl);
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

/**
 * Todas las respuestas del Worker llevan `X-Catalogos-Runtime: worker`. Los
 * static assets de `public/` se sirven sin pasar por aquí, así que una
 * respuesta SIN esa cabecera no consumió invocación: es la forma de auditar
 * desde fuera qué parte del tráfico es gratis (scripts/scale-audit.mjs).
 */
async function handleRequest(request, env, ctx) {
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
      if (!sameOrigin(request)) {
        return jsonResponse({
          error: 'origin_not_allowed',
          message: 'La petición no se ve venir de este dominio. Abre /configure de este Worker en el navegador (pega la URL, no la abras desde otra página) y vuelve a intentarlo.',
        }, 403, 0);
      }
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
        // Validación, almacenamiento cifrado y mensajes de error viven en
        // lib/debridConnect.js, compartidos con el servidor Express/Vercel.
        const result = await debridConnect.connect(body, { env: env || {} });
        return jsonResponse(result.payload, result.status, 0);
      } catch (err) {
        if (err && err.code === 'invalid_body') {
          return jsonResponse({ error: 'invalid_body', message: 'Envía un objeto JSON válido de hasta 4 KB.' }, 400, 0);
        }
        if (err && err.code === 'body_too_large') {
          return jsonResponse({ error: 'body_too_large', message: 'El cuerpo supera el límite de 4 KB.' }, 413, 0);
        }
        console.error('[Debrid] No se pudo procesar la conexión.');
        return jsonResponse({ error: 'debrid_unavailable', message: 'No se pudo validar el proveedor. Inténtalo más tarde.' }, 502, 0);
      }
    }
    if (path === '/internal/debrid/connect') return jsonResponse({ error: 'method_not_allowed' }, 405, 0);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return jsonResponse({ error: 'method_not_allowed' }, 405, 0);
    }

    const origin = url.origin;
    const host = url.host;

    // ── Proxy HLS (streams directos de SpinFlix) ───────────────
    // /hls?u=<url del CDN>&ref=<referer>: 0 HTML, solo media y playlists.
    if (path === '/hls') {
      return hlsProxy.handleHlsProxy(request, url, env || {});
    }

    // ── Portada estilo streaming (tendencias en vivo si hay TMDB) ─
    if (path === '/' || path === '/api') {
      const accept = request.headers.get('accept') || '';
      if (!accept.includes('text/html') && accept.includes('application/json')) {
        return edgeCached(
          request,
          ctx,
          async () => jsonResponse(core.buildManifest(`${origin}/assets/logo.png`), 200, 300),
          `${origin}/__edge/root-manifest.json`
        );
      }
      return edgeCached(request, ctx, async () => {
        const trending = await loadTrending();
        const html = renderHome({
          origin,
          host,
          trendingMovies: trending.movies,
          trendingSeries: trending.series,
          trendingAnime: trending.anime,
          apiStatus: { tmdb: config.tmdbConfigured },
          mirrors: config.mirrorOrigins,
        });
        return htmlResponse(html, 1800);
      }, `${origin}/__edge/home.html?lang=${encodeURIComponent(config.tmdbLanguage)}&region=${encodeURIComponent(config.watchRegion)}&mirrors=${mirrors.hash32(config.mirrorOrigins.join(','))}`);
    }

    // ── Página de configuración ───────────────────────────────
    if (path === '/configure') {
      const hasOAuthParams = url.searchParams.has('debrid_credential') || url.searchParams.has('debrid_error');
      const createConfigure = async () => {
        const trending = await loadTrending();
        return htmlResponse(
          renderConfigure({
            origin,
            host,
            trendingMovies: trending.movies,
            trendingSeries: trending.series,
            mirrors: config.mirrorOrigins,
          }),
          hasOAuthParams ? 0 : 1800
        );
      };
      return hasOAuthParams
        ? createConfigure()
        : edgeCached(
            request,
            ctx,
            createConfigure,
            `${origin}/__edge/configure.html?lang=${encodeURIComponent(config.tmdbLanguage)}&region=${encodeURIComponent(config.watchRegion)}&kofi=${encodeURIComponent(config.kofiUrl || '')}&sup=${encodeURIComponent(config.supportUrl || '')}&mirrors=${mirrors.hash32(config.mirrorOrigins.join(','))}`
          );
    }

    // ── Estado agregado de la caché (sin claves ni datos por usuario) ──
    if (path === '/internal/cache.json') {
      // `configs` es el registro de configuraciones vistas: qué pregenerar.
      // Solo lleva el segmento base64url (que ya viaja en la URL del manifest)
      // y la selección; nunca credenciales (las configs con debridId no entran).
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('configs')) || 40));
      return jsonResponse(
        { ...cache.stats(), responseCache: responseCache.stats(), configs: configRegistry.report({ limit }) },
        200,
        0
      );
    }

    // ── Espejos de cuota (diagnóstico, sin datos de usuario) ──
    if (path === '/internal/mirrors.json') {
      return jsonResponse(
        mirrors.report({ self: origin, mirrors: config.mirrorOrigins }),
        200,
        300
      );
    }

    // ── Branding (logos de plataformas/estudios vía TMDB) ─────
    if (path === '/internal/branding.json') {
      const lang = url.searchParams.get('lang') || config.tmdbLanguage || 'es';
      return edgeCached(
        request,
        ctx,
        async () => jsonResponse(await branding(lang), 200, 86400),
        `${origin}/__edge/branding.json?lang=${encodeURIComponent(lang)}`
      );
    }

    // ── Diagnóstico de streams (¿por qué no aparecen resultados?) ──
    if (path === '/internal/streams-test.json') {
      const clientIp = request.headers.get('cf-connecting-ip') ||
        (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
      if (!rateLimit.allow(`streams-test:${clientIp}`, { limit: 6, windowMs: 60_000 })) {
        return jsonResponse({ error: 'rate_limited', message: 'Demasiadas pruebas seguidas. Espera un minuto.' }, 429, 0);
      }
      const type = url.searchParams.get('type') === 'series' ? 'series' : 'movie';
      const testId = url.searchParams.get('id') || 'tt1160419';
      const diagKey = `diag:${type}:${testId}`;
      const diag = await cache.coalesce(diagKey, async () => {
        const cached = cache.get(diagKey);
        if (cached) return cached;
        const fresh = await streams.diagnose(type, testId, null);
        cache.set(diagKey, fresh, 30);
        return fresh;
      });
      return jsonResponse(diag, 200, 0);
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
            // knaben, torlock, blackholebay, nyaa, yts, eztv, rarbg, torrentindexer, torrentioes: true si está activo
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
            // 'kv' es duradero; 'cache' (Cache API) funciona sin configurar
            // pero es por datacenter, así que conviene crear la KV.
            credentialStorage: debridCredentials.storageKind(env || {}),
          },
          // Donaciones: enlace a la página de Ko-fi (se paga allí con PayPal o tarjeta).
          donations: { provider: 'kofi', enabled: config.kofiEnabled, page: config.kofiUrl || null },
          cache: cache.stats(),
          // Caché de respuestas del isolate: la única que funciona en
          // *.workers.dev, donde la Cache API de Cloudflare no hace nada.
          responseCache: responseCache.stats(),
          // Ahorro de cuota: cuánto del plan de estáticos está en marcha.
          // `configsTracked` son las configuraciones vistas desde este isolate;
          // `npm run prerender -- --from-url` las usa para pregenerar.
          quota: {
            freeDailyInvocations: 100_000,
            configsTracked: configRegistry.report({ limit: 1 }).totalSegments,
            staticPlan: 'static-assets + _redirects + por-configuracion',
            edgeShortcuts: config.staticShortcuts,
            hint: 'npm run prerender -- --from-url=https://tu-dominio',
          },
          // Espejos: cuántos despliegues suman cuota y cuál es el techo real.
          mirrors: mirrors.report({ self: origin, mirrors: config.mirrorOrigins }),
          language: config.tmdbLanguage,
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
        // Registro de configuraciones vistas: alimenta el planificador de
        // estáticos (`npm run prerender -- --from-url` lo lee de
        // /internal/cache.json). Se anota en las rutas de Stremio (manifest,
        // catálogo, ficha y stream) porque son las que se repiten en cada
        // sesión; /configure es una visita humana y no aporta señal.
        // Nunca registra configs con debridId: su segmento es por usuario.
        if (rest !== '/configure') configRegistry.note(prefixed[1], cfg);

        // Si alguna de estas rutas está pregenerada en public/, la petición ni
        // siquiera llega aquí (los static assets van primero): llegar significa
        // que el archivo falta y hay que resolverlo en caliente, como siempre.
        // Stremio abre /<tu-config>/configure al pulsar "Configurar":
        // debe abrir el configurador con TU región/selección ya cargada.
        if (rest === '/configure') {
          const trending = await loadTrending();
          return htmlResponse(renderConfigure({
            origin,
            host,
            trendingMovies: trending.movies,
            trendingSeries: trending.series,
            initialCfg: cfg,
            mirrors: config.mirrorOrigins,
          }));
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
}

export default {
  async fetch(request, env, ctx) {
    const response = await handleRequest(request, env, ctx);
    try {
      response.headers.set('X-Catalogos-Runtime', 'worker');
    } catch (_) { /* cabeceras inmutables: no pasa nada, es solo instrumentación */ }
    return response;
  },
};
