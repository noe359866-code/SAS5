/**
 * Catálogos+ — Addon de Stremio para Cloudflare Workers
 *
 * Rutas:
 *   GET /                         Landing con botón "Instalar en Stremio"
 *   GET /manifest.json            Manifest (logo → este Worker)
 *   GET /assets/logo.png          Logo embebido en el bundle (sin KV ni R2)
 *   GET /healthz                  Estado del addon y de las fuentes
 *   GET /catalog/:type/:id.json   Catálogos (movie/series)
 *   GET /meta/:type/:id.json      Metadatos enriquecidos
 *
 * Variables (Settings → Variables and Secrets, o `wrangler secret put`):
 *   TMDB_API_KEY | TMDB_ACCESS_TOKEN  (una de las dos, obligatoria para catálogos)
 *   OMDB_API_KEY                      (ratings IMDb/RT/Metacritic)
 *   WATCHMODE_API_KEY                 (dónde ver en streaming)
 *   WATCH_REGION = NI | MX | ES | US… (región JustWatch)
 *   ADDON_NAME, TMDB_MIN_VOTE_COUNT, CACHE_TTL_SECONDS (opcionales)
 * TVMaze no requiere clave.
 */

import config from './lib/config.js';
import core from './lib/core.js';
import { renderLanding } from './lib/landingPage.js';
import logoData from './lib/logoData.js';

const LOGO_BYTES = Uint8Array.from(atob(logoData.base64), (c) => c.charCodeAt(0));

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

export default {
  async fetch(request, env, _ctx) {
    // Aplica las vars/secrets del Worker a la configuración compartida
    try {
      config.reload(env || {});
    } catch (err) {
      console.error('[Worker] reload config ->', err && err.message);
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return jsonResponse({ error: 'method_not_allowed' }, 405, 0);
    }

    const origin = url.origin;
    const logoUrl = `${origin}/assets/logo.png`;

    // ── Landing ───────────────────────────────────────────────
    if (path === '/' || path === '/api') {
      const accept = request.headers.get('accept') || '';
      if (!accept.includes('text/html') && accept.includes('application/json')) {
        return jsonResponse(core.buildManifest(logoUrl), 200, 300);
      }
      const manifest = core.buildManifest(logoUrl);
      const html = renderLanding({
        manifestUrl: `${origin}/manifest.json`,
        stremioDeepLink: `stremio://${url.host}/manifest.json`,
        manifest,
        apiStatus: {
          tmdb: config.tmdbConfigured,
          omdb: config.omdbConfigured,
          watchmode: config.watchmodeConfigured,
          watchRegion: config.watchRegion,
        },
      });
      return htmlResponse(html);
    }

    // ── Healthcheck ───────────────────────────────────────────
    if (path === '/healthz') {
      return jsonResponse(
        {
          ok: true,
          addon: 'org.comunidad.catalogos.plus',
          version: '1.0.0',
          runtime: 'cloudflare-workers',
          catalogs: (core.CATALOGS || []).length,
          sources: {
            tmdb: config.tmdbConfigured,
            tvmaze: true,
            omdb: config.omdbConfigured,
            watchmode: config.watchmodeConfigured,
          },
          watchRegion: config.watchRegion,
        },
        200,
        0
      );
    }

    // ── Manifest ──────────────────────────────────────────────
    if (path === '/manifest.json') {
      return jsonResponse(core.buildManifest(logoUrl), 200, 300);
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

    // ── Catálogos ─────────────────────────────────────────────
    let match = path.match(/^\/catalog\/(movie|series|anime)\/([^/]+)\.json$/);
    if (match) {
      const [, type, id] = match;
      const result = await core.handleCatalog(type, decodeURIComponent(id));
      return jsonResponse(result, 200, config.cacheTtl);
    }

    // ── Metadatos ─────────────────────────────────────────────
    match = path.match(/^\/meta\/(movie|series)\/(.+)\.json$/);
    if (match) {
      const [, type, id] = match;
      const result = await core.handleMeta(type, decodeURIComponent(id));
      return jsonResponse(result, 200, config.cacheTtl);
    }

    return jsonResponse(
      { error: 'not_found', message: 'Ruta no encontrada. Prueba /manifest.json' },
      404,
      0
    );
  },
};
