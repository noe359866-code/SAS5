'use strict';

/**
 * Proxy de medios opcional con caché de borde.
 *
 * ── Por qué existe y por qué está apagado por defecto ─────────────────────
 * Algunos CDN rechazan la petición si falta `Referer`/`Origin`, y el cliente de
 * Stremio no siempre puede añadirlas (HLS en TV, web, etc.). Este módulo
 * permite que el propio Worker pida el manifiesto, la variante, la pista o el
 * segmento y lo entregue firmado.
 *
 * Pero retransmitir vídeo NO es gratis ni inocuo:
 *   · Cada petición de reproducción pasa a ser una invocación del Worker. En
 *     el plan gratuito son 100.000/día para toda la cuenta; un solo capítulo
 *     de 45 min consume ~700 segmentos.
 *   · La Cache API **no hace nada en `*.workers.dev`**. Para que un acierto de
 *     caché no invoque el Worker hacen falta dominio propio + Cache Rule sobre
 *     `/p/*` (ver `docs/proxy-cache-cloudflare.md`).
 *   · El acuerdo de autoservicio de Cloudflare restringe servir vídeo alojado
 *     fuera de Cloudflare a través de su CDN; revisa los términos antes de
 *     activarlo en producción.
 *
 * Por eso `MEDIA_PROXY` vale `off` por defecto y, aunque valga `on`, no se
 * activa sin `PROXY_SECRET` y una lista `PROXY_ALLOWED_HOSTS`. Sin firma no hay
 * proxy: un endpoint abierto se convertiría en un relé para terceros.
 *
 * ── Diseño para muchos usuarios ───────────────────────────────────────────
 * La firma es determinista (HMAC del destino + referer, sin caducidad ni nonce
 * por usuario): dos personas que ven el mismo capítulo reciben exactamente la
 * misma URL de proxy y comparten entrada de caché. Rotar `PROXY_SECRET` invalida
 * todas las URLs emitidas.
 *
 * Formato: `/p/<base64url(destino)>?r=<base64url(referer)>&s=<firma>`
 * El destino va en la ruta (no en un parámetro `?url=`) para que una Cache Rule
 * pueda cubrir `/p/*` sin tocar el resto del addon.
 */

const DEFAULT_MANIFEST_TTL = 60; // s: un manifiesto puede cambiar (VOD firmado)
const DEFAULT_SEGMENT_TTL = 86400; // s: un segmento es inmutable mientras viva
const DEFAULT_TIMEOUT_MS = 20000;
const MAX_REDIRECTS = 3;
const MAX_TARGET_LENGTH = 4096;
const MAX_PATH_TOKEN = 6000;
const SIGNATURE_CHARS = 22; // ~132 bits de un SHA-256 en base64url

const EXT = /\.(?:m3u8|ts|m4s|mp4|m4v|webm|aac|m4a|vtt|srt|key|cmfv|cmfa|mpd)$/i;
const TOKEN_PATH = /\/(?:m3u8|hls)\/[A-Za-z0-9._~-]{8,}$/;
const SEGMENT = /\.(?:ts|m4s|aac|m4a|cmfv|cmfa|vtt|srt)$/i;
const MANIFEST = /\.(?:m3u8|mpd)$/i;
const KEY_PATH = /(?:^|\/)keys?\//i;
const KEY_EXT = /\.key$/i;
const REDIRECT = new Set([301, 302, 303, 307, 308]);
const PASS_STATUS = new Set([200, 203, 204, 206, 304]);

// Hosts que jamás deben resolverse desde el Worker (SSRF / metadata interna).
const BLOCKED_HOSTS = new Set([
  'localhost', 'localhost.localdomain', 'metadata.google.internal',
  '169.254.169.254', '0.0.0.0', '[::1]', '::1',
]);
const PRIVATE_V4 = /^(?:0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const state = {
  enabled: false,
  secret: '',
  hosts: new Set(),
  manifestTtl: DEFAULT_MANIFEST_TTL,
  segmentTtl: DEFAULT_SEGMENT_TTL,
  timeoutMs: DEFAULT_TIMEOUT_MS,
};

let keyCache = { secret: '', promise: null };

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function normalizeHost(value) {
  return String(value || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^\*\./, '')
    .replace(/^\./, '');
}

/** Aplica la configuración del entorno. La llamada `config.js` en cada reload. */
function configure(options = {}) {
  const hosts = Array.isArray(options.hosts)
    ? options.hosts
    : String(options.hosts || '').split(',');
  state.enabled = options.enabled === true;
  state.secret = String(options.secret || '').trim();
  state.hosts = new Set(hosts.map(normalizeHost).filter(Boolean));
  state.manifestTtl = clamp(options.manifestTtl == null ? DEFAULT_MANIFEST_TTL : options.manifestTtl, 0, 86400);
  state.segmentTtl = clamp(options.segmentTtl == null ? DEFAULT_SEGMENT_TTL : options.segmentTtl, 0, 31536000);
  state.timeoutMs = clamp(options.timeoutMs == null ? DEFAULT_TIMEOUT_MS : options.timeoutMs, 1000, 60000);
  return state;
}

/** `ready` es lo que de verdad habilita el proxy: flag + secreto + allowlist. */
function status() {
  return {
    enabled: state.enabled,
    ready: Boolean(state.enabled && state.secret && state.hosts.size),
    hosts: [...state.hosts],
    manifestTtl: state.manifestTtl,
    segmentTtl: state.segmentTtl,
  };
}

/* ───────────────────────────── base64url ───────────────────────────── */

function bytesToB64url(bytes) {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(text) {
  const raw = String(text || '').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) throw new Error('base64url inválido');
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function b64urlEncode(text) {
  return bytesToB64url(encoder.encode(text));
}

function b64urlDecode(token) {
  return decoder.decode(b64urlToBytes(token));
}

/* ───────────────────────────── firma ───────────────────────────── */

async function hmacKey(secret) {
  if (keyCache.secret === secret && keyCache.promise) return keyCache.promise;
  keyCache = {
    secret,
    promise: globalThis.crypto.subtle.importKey(
      'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    ),
  };
  return keyCache.promise;
}

async function sign(secret, target, referer) {
  const key = await hmacKey(secret);
  const signature = await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(`${target}\n${referer}`));
  return bytesToB64url(new Uint8Array(signature)).slice(0, SIGNATURE_CHARS);
}

/** Comparación en tiempo constante (misma longitud; si no, falso). */
function equalSignature(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length || !left.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

/* ─────────────────────────── validación ─────────────────────────── */

function normalizeReferer(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    if (url.username || url.password) return '';
    return url.href;
  } catch (_) {
    return '';
  }
}

function hostAllowed(hostname) {
  const host = normalizeHost(hostname);
  if (!host || BLOCKED_HOSTS.has(host) || PRIVATE_V4.test(host) || host.includes(':')) return false;
  for (const allowed of state.hosts) {
    if (host === allowed || host.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

/** Destino normalizado o '' si no es http(s) válido. */
function normalizeTarget(raw) {
  const text = String(raw || '').trim();
  if (!text || text.length > MAX_TARGET_LENGTH) return '';
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    if (url.username || url.password) return '';
    return url.href;
  } catch (_) {
    return '';
  }
}

function isMediaPath(pathname) {
  let path;
  try { path = decodeURIComponent(pathname).toLowerCase(); } catch (_) { return false; }
  return EXT.test(path) || TOKEN_PATH.test(path);
}

/** ¿El Worker puede pedir este destino? */
function isAllowedTarget(raw) {
  const target = normalizeTarget(raw);
  if (!target) return false;
  let url;
  try { url = new URL(target); } catch (_) { return false; }
  if (!hostAllowed(url.hostname)) return false;
  return isMediaPath(url.pathname);
}

/* ─────────────────────────── construcción ─────────────────────────── */

/**
 * URL de proxy para un medio. Devuelve '' si el proxy no está listo o el
 * destino no es elegible: quien llama debe conservar entonces la URL directa.
 */
async function buildProxyUrl(rawUrl, { origin = '', referer = '' } = {}) {
  if (!state.enabled || !state.secret || !state.hosts.size) return '';
  const target = normalizeTarget(rawUrl);
  if (!target || !isAllowedTarget(target)) return '';
  const base = String(origin || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  const safeReferer = normalizeReferer(referer);
  const signature = await sign(state.secret, target, safeReferer);
  const query = `s=${signature}${safeReferer ? `&r=${b64urlEncode(safeReferer)}` : ''}`;
  return `${base}/p/${b64urlEncode(target)}?${query}`;
}

function parseProxyPath(pathname) {
  const match = /^\/p\/([A-Za-z0-9_-]+)$/.exec(String(pathname || ''));
  if (!match || match[1].length > MAX_PATH_TOKEN) return null;
  try {
    const target = b64urlDecode(match[1]);
    return normalizeTarget(target) === target ? target : null;
  } catch (_) {
    return null;
  }
}

/** Reemplaza las URLs de un stream por las del proxy (quita proxyHeaders). */
async function rewriteStream(stream, options = {}) {
  if (!stream || typeof stream.url !== 'string') return stream;
  const headers = stream.behaviorHints && stream.behaviorHints.proxyHeaders;
  const referer = headers && headers.request && headers.request.Referer
    ? headers.request.Referer
    : '';
  const proxied = await buildProxyUrl(stream.url, { origin: options.origin, referer });
  if (!proxied) return stream;
  const behaviorHints = { ...(stream.behaviorHints || {}) };
  // El Worker ya añade Referer/Origin: pedir además el proxy de Stremio
  // duplicaría saltos y rompería la URL firmada.
  delete behaviorHints.proxyHeaders;
  return { ...stream, url: proxied, behaviorHints };
}

async function rewriteStreams(list, options = {}) {
  if (!Array.isArray(list) || !state.enabled || !state.secret || !state.hosts.size) return list;
  return Promise.all(list.map((stream) => rewriteStream(stream, options)));
}

/* ─────────────────────────── respuesta ─────────────────────────── */

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Origin, Referer, Accept',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    ...extra,
  };
}

function textError(status, code) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }),
  });
}

function isKeyPath(pathname) {
  let path;
  try { path = decodeURIComponent(pathname).toLowerCase(); } catch (_) { return true; }
  return KEY_EXT.test(path) || KEY_PATH.test(path);
}

/** Qué se puede cachear y cuánto. Las claves y los 206 nunca. */
function cachePolicy(target, status = 200) {
  let path = '';
  try { path = new URL(target).pathname; } catch (_) { /* destino ya validado */ }
  if (status === 206) return { cacheable: false, cacheControl: 'no-store' };
  if (isKeyPath(path)) return { cacheable: false, cacheControl: 'no-store' };
  if (MANIFEST.test(path)) {
    return { cacheable: true, cacheControl: `public, max-age=${state.manifestTtl}, s-maxage=${state.manifestTtl}` };
  }
  if (SEGMENT.test(path)) {
    return {
      cacheable: true,
      cacheControl: `public, max-age=${state.segmentTtl}, s-maxage=${state.segmentTtl}, immutable`,
    };
  }
  return { cacheable: true, cacheControl: 'public, max-age=3600, s-maxage=3600' };
}

function responseHeaders(upstream, policy) {
  const headers = new Headers(corsHeaders({ 'Cache-Control': policy.cacheControl }));
  for (const name of ['content-type', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Si el runtime descomprime, `content-length` deja de ser válido.
  const length = upstream.headers.get('content-length');
  if (length && !upstream.headers.get('content-encoding')) headers.set('Content-Length', length);
  headers.set('X-Media-Proxy', 'upstream');
  headers.set('X-Media-Proxy-Cacheable', policy.cacheable ? 'yes' : 'no');
  return headers;
}

async function timedFetch(url, init, timeoutMs, fetchImpl) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetchImpl(url, { ...init, signal: controller ? controller.signal : undefined });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Atiende `/p/...`. `options.fetchImpl` existe para los tests; en producción
 * es el `fetch` global del Worker.
 */
async function handleProxy(request, options = {}) {
  if (!state.enabled || !state.secret || !state.hosts.size) return textError(404, 'not_found');
  if (request.method !== 'GET' && request.method !== 'HEAD') return textError(405, 'method_not_allowed');

  const url = new URL(request.url);
  const target = parseProxyPath(url.pathname);
  if (!target) return textError(404, 'not_found');
  if (!isAllowedTarget(target)) return textError(403, 'host_not_allowed');

  const referer = normalizeReferer(safeB64Decode(url.searchParams.get('r')));
  const expected = await sign(state.secret, target, referer);
  if (!equalSignature(expected, url.searchParams.get('s'))) return textError(403, 'bad_signature');

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return textError(503, 'fetch_unavailable');

  const headers = new Headers();
  const range = request.headers.get('range');
  if (range) headers.set('Range', range.slice(0, 200));
  const accept = request.headers.get('accept');
  if (accept) headers.set('Accept', accept.slice(0, 200));
  if (referer) {
    headers.set('Referer', referer);
    try { headers.set('Origin', new URL(referer).origin); } catch (_) { /* referer ya validado */ }
  }
  headers.set('User-Agent', 'Mozilla/5.0 (compatible; RamdonLatamProxy/1.0)');

  let current = target;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let upstream;
    try {
      upstream = await timedFetch(current, {
        method: request.method,
        headers,
        redirect: 'manual',
      }, state.timeoutMs, fetchImpl);
    } catch (err) {
      console.error('[media-proxy] upstream ->', err && err.message);
      return textError(502, 'upstream_error');
    }

    if (REDIRECT.has(upstream.status)) {
      const location = upstream.headers.get('location');
      if (!location || hop === MAX_REDIRECTS) return textError(502, 'too_many_redirects');
      let next;
      try { next = new URL(location, current).href; } catch (_) { return textError(502, 'bad_redirect'); }
      if (!isAllowedTarget(next)) return textError(403, 'redirect_not_allowed');
      current = next;
      continue;
    }

    const policy = cachePolicy(target, upstream.status);
    if (!PASS_STATUS.has(upstream.status)) {
      // Un error del CDN no se cachea ni se reenvía con cuerpo.
      return new Response(null, {
        status: upstream.status || 502,
        headers: corsHeaders({ 'Cache-Control': 'no-store', 'X-Media-Proxy': 'upstream' }),
      });
    }
    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers: responseHeaders(upstream, policy),
    });
  }
  return textError(502, 'too_many_redirects');
}

function safeB64Decode(value) {
  if (!value) return '';
  try { return b64urlDecode(value); } catch (_) { return ''; }
}

module.exports = {
  configure,
  status,
  buildProxyUrl,
  parseProxyPath,
  isAllowedTarget,
  hostAllowed,
  normalizeTarget,
  normalizeReferer,
  cachePolicy,
  rewriteStream,
  rewriteStreams,
  handleProxy,
  DEFAULT_MANIFEST_TTL,
  DEFAULT_SEGMENT_TTL,
  MAX_REDIRECTS,
};
