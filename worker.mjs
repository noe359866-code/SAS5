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
 *   Vars no secretas: WATCH_REGION, ADDON_NAME, TMDB_LANGUAGE, TMDB_MIN_VOTE_COUNT, CACHE_TTL_SECONDS
 */

import config from './lib/config.js';
import core from './lib/core.js';
import { renderHome } from './lib/homePage.js';
import { renderConfigure } from './lib/configurePage.js';
import tmdbClient from './lib/tmdb.js';
import { branding } from './lib/branding.js';
import userConfig from './lib/userConfig.js';
import catalogs from './lib/catalogs.js';
import logoData from './lib/logoData.js';

const LOGO_BYTES = Uint8Array.from(atob(logoData.base64), (c) => c.charCodeAt(0));
const CATALOG_RE = /^\/catalog\/(movie|series|anime)\/([^/]+)\.json$/;
const META_RE = /^\/meta\/(movie|series)\/(.+)\.json$/;
const CONFIG_PREFIX_RE = /^\/([A-Za-z0-9_-]{8,512})(\/.*)$/;

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

async function serveCatalog(type, id, cfg) {
  const result = await core.handleCatalog(type, decodeURIComponent(id), cfg);
  return jsonResponse(result, 200, config.cacheTtl);
}

async function serveMeta(type, id, cfg) {
  const result = await core.handleMeta(type, decodeURIComponent(id), cfg);
  return jsonResponse(result, 200, config.cacheTtl);
}

/** Tendencias semanales TMDB (solo si hay clave; si no, estáticos). */
async function loadTrending() {
  if (!config.tmdbConfigured) return { movies: null, series: null };
  try {
    const [movies, series] = await Promise.all([
      tmdbClient.trending('movie', config.tmdbLanguage),
      tmdbClient.trending('tv', config.tmdbLanguage),
    ]);
    return { movies, series };
  } catch (err) {
    console.error('[Trending] ->', err && err.message);
    return { movies: null, series: null };
  }
}

export default {
  async fetch(request, env, _ctx) {
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
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return jsonResponse({ error: 'method_not_allowed' }, 405, 0);
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
        apiStatus: { tmdb: config.tmdbConfigured },
      });
      return htmlResponse(html);
    }

    // ── Página de configuración ───────────────────────────────
    if (path === '/configure') {
      const trending = await loadTrending();
      return htmlResponse(renderConfigure({ origin, host, trendingMovies: trending.movies, trendingSeries: trending.series }));
    }

    // ── Branding (logos de plataformas/estudios vía TMDB) ─────
    if (path === '/internal/branding.json') {
      const lang = url.searchParams.get('lang') || undefined;
      return jsonResponse(await branding(lang), 200, 3600);
    }

    // ── Healthcheck ───────────────────────────────────────────
    if (path === '/healthz') {
      return jsonResponse(
        {
          ok: true,
          addon: 'org.comunidad.catalogos.plus',
          version: '1.1.0',
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
          },
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
      return jsonResponse(core.buildManifest(`${origin}/assets/logo.png`), 200, 300);
    }

    // ── Catálogos / Metadatos con config por defecto ──────────
    let match = path.match(CATALOG_RE);
    if (match) return serveCatalog(match[1], match[2], null);
    match = path.match(META_RE);
    if (match) return serveMeta(match[1], match[2], null);

    // ── Rutas con prefijo de config de usuario: /<cfg>/... ────
    const prefixed = path.match(CONFIG_PREFIX_RE);
    if (prefixed) {
      const cfg = userConfig.decodeConfig(prefixed[1], catalogs.PLATFORM_KEYS, catalogs.STUDIO_KEYS);
      if (cfg) {
        const rest = prefixed[2].replace(/\/+$/, '') || '/';
        const logoUrl = `${origin}/assets/logo.png`;
        if (rest === '/manifest.json') {
          return jsonResponse(core.buildManifest(logoUrl, cfg), 200, 300);
        }
        let m2 = rest.match(CATALOG_RE);
        if (m2) return serveCatalog(m2[1], m2[2], cfg);
        m2 = rest.match(META_RE);
        if (m2) return serveMeta(m2[1], m2[2], cfg);
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
