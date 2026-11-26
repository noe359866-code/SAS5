import config from './lib/config.js';
import core from './lib/core.js';
import cache from './lib/cache.js';
import logoData from './lib/logoData.js';
import m3uProxy from './lib/m3uProxy.js';

const LOGO_BYTES = Uint8Array.from(atob(logoData.base64), (char) => char.charCodeAt(0));
const RUNTIME_HEADER = 'X-Catalogos-Runtime';

function headers(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400',
    [RUNTIME_HEADER]: 'worker',
    ...extra,
  };
}

function json(data, status = 200, cacheSeconds = 0, method = 'GET') {
  return new Response(method === 'HEAD' ? null : JSON.stringify(data), {
    status,
    headers: headers({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : 'no-store',
    }),
  });
}

function safeDecode(value) {
  try { return decodeURIComponent(value); } catch { return null; }
}

function workerRuntime(ctx) {
  return ctx && typeof ctx.waitUntil === 'function'
    ? { waitUntil: (promise) => ctx.waitUntil(promise) }
    : {};
}

async function streamResult(type, id, request, env, ctx) {
  const result = await core.handleStream(type, id, null, workerRuntime(ctx));
  if (!id.startsWith('rlch:m3u:')) return result;
  const secret = env?.M3U_PROXY_SECRET;
  if (!secret) {
    result.streams = [];
    result.proxySecretRequired = true;
    return result;
  }
  try {
    result.streams = await m3uProxy.maskedStreams(result.streams, {
      origin: new URL(request.url).origin,
      secret,
    });
  } catch {
    result.streams = [];
    result.proxySecretRequired = true;
  }
  return result;
}

async function route(request, env, ctx) {
  try { config.reload(env || {}); } catch (error) { console.error('[Worker config]', error?.message); }
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers() });
  if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'method_not_allowed' }, 405);
  const origin = url.origin;

  const token = m3uProxy.tokenFromPath(pathname);
  if (token) {
    return m3uProxy.proxyRequest(request, token, { secret: env?.M3U_PROXY_SECRET, origin });
  }

  if (pathname === '/' || pathname === '/api') {
    return new Response(null, { status: 302, headers: headers({ Location: `${origin}/manifest.json` }) });
  }
  if (pathname === '/healthz') {
    return json({
      ok: true,
      addon: 'net.ramdonlatam.catalogos',
      version: '2.1.0',
      runtime: 'cloudflare-workers',
      channelsOnly: true,
      configurable: false,
      catalogs: core.CATALOGS.length,
      m3uProxyConfigured: Boolean(env?.M3U_PROXY_SECRET),
      cache: cache.stats(),
    }, 200, 0, request.method);
  }
  if (pathname === '/assets/logo.png') {
    return new Response(request.method === 'HEAD' ? null : LOGO_BYTES, {
      status: 200,
      headers: headers({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }),
    });
  }
  if (pathname === '/manifest.json') {
    return json(core.buildManifest(`${origin}/assets/logo.png`), 200, 300, request.method);
  }

  const catalogMatch = /^\/catalog\/([^/]+)\/([^/]+?)(?:\/(.+?))?\.json$/.exec(pathname);
  if (catalogMatch) {
    const type = safeDecode(catalogMatch[1]);
    const id = safeDecode(catalogMatch[2]);
    if (!type || !id) return json({ error: 'invalid_id' }, 400);
    const extra = Object.fromEntries(url.searchParams);
    if (catalogMatch[3]) Object.assign(extra, Object.fromEntries(new URLSearchParams(catalogMatch[3])));
    const result = await core.handleCatalog(type, id, null, extra);
    return json(result, 200, result.cacheMaxAge || 60, request.method);
  }

  const metaMatch = /^\/meta\/([^/]+)\/(.+)\.json$/.exec(pathname);
  if (metaMatch) {
    const type = safeDecode(metaMatch[1]);
    const id = safeDecode(metaMatch[2]);
    if (!type || !id) return json({ error: 'invalid_id' }, 400);
    const result = await core.handleMeta(type, id);
    return json(result, 200, result.cacheMaxAge || 60, request.method);
  }

  const streamMatch = /^\/stream\/([^/]+)\/(.+)\.json$/.exec(pathname);
  if (streamMatch) {
    const type = safeDecode(streamMatch[1]);
    const id = safeDecode(streamMatch[2]);
    if (!type || !id) return json({ error: 'invalid_id' }, 400);
    const result = await streamResult(type, id, request, env, ctx);
    return json(result, 200, 0, request.method);
  }

  return json({ error: 'not_found' }, 404, 0, request.method);
}

export default {
  fetch(request, env, ctx) {
    return route(request, env, ctx).catch((error) => {
      console.error('[Worker request]', error?.message);
      return json({ error: 'internal_error' }, 500);
    });
  },
};
