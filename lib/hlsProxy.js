'use strict';

const { VIMEOS_HOSTS, SPINFLIX_PLAYBACK_HEADERS, spinFlixMedia, spinFlixPlaybackUrl, workerPlaybackPath, expiryOf } = require('./vimeosPlayback');

/**
 * /hls?u=<URL del CDN> consulta el CDN directo. via=spinflix selecciona
 * el endpoint de reproducción fijo de SpinFlix para medios de Vimeos.
 * Reescribimos variantes, audio, claves y segmentos para que no salgan
 * del transporte elegido cuando el cliente abre la playlist.
 */

/** Extensiones que un reproductor HLS pide de verdad. */
const ALLOWED_EXT = /\.(?:m3u8|ts|m4s|mp4|vtt|key)(?:$|[?#])/i;

const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 12_000;

/** ¿El host es de la lista blanca (o subdominio de uno de ellos)? */
function hostAllowed(hostname, allowed) {
  const host = String(hostname || '').toLowerCase();
  return allowed.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
}

function allowedHosts(env) {
  const extra = String((env && env.HLS_PROXY_HOSTS) || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...VIMEOS_HOSTS, ...extra])];
}

/** Cabeceras que acompañan a cada petición al CDN. */
function upstreamHeaders(referer) {
  return {
    // Sin Referer muchos CDN devuelven 403; con el de la web de origen,
    // responden. Es el mismo truco que usa su propio proxy.
    ...(referer ? { Referer: referer } : {}),
    'User-Agent': 'Mozilla/5.0 (compatible; CatalogosPlus/1.5; +https://github.com/noe359866-code/SAS5)',
    Accept: '*/*',
  };
}

/**
 * Reescribe una playlist para que sus referencias vuelvan a pasar por el
 * proxy. Se conservan las líneas `#EXT…` y se sustituyen las URI.
 */
function rewritePlaylist(text, baseUrl, proxyPath, referer, useSpinFlix = false) {
  const base = new URL(baseUrl);
  const proxify = (raw) => {
    const uri = String(raw || '').trim();
    if (!uri) return uri;
    if (useSpinFlix) {
      const media = spinFlixMedia(uri, base);
      if (!media) throw new Error('El manifiesto hace referencia a un medio no permitido.');
      return workerPlaybackPath(media);
    }
    let absolute;
    try {
      absolute = new URL(uri, base).toString();
    } catch (_) {
      return uri;
    }
    // Ya viene proxificada: no se vuelve a envolver (bucle infinito).
    // Se compara la RUTA exacta, no una subcadena: `/hls2/a/seg-1.ts` del CDN
    // contiene «/hls» y se quedaba sin reescribir.
    try {
      if (new URL(absolute).pathname === proxyPath) return uri;
    } catch (_) { /* se proxifica igual */ }
    return `${proxyPath}?${referer ? `ref=${encodeURIComponent(referer)}&` : ''}u=${encodeURIComponent(absolute)}`;
  };

  return String(text || '')
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (!trimmed.startsWith('#')) return proxify(trimmed); // URI suelta
      // URI="…" dentro de #EXT-X-MEDIA / #EXT-X-KEY / #EXT-X-MAP / I-FRAME
      return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${proxify(uri)}"`);
    })
    .join('\n');
}

async function readPlaylist(res) {
  if (Number(res.headers.get('content-length')) > MAX_PLAYLIST_BYTES) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return '';
  let size = 0;
  let text = '';
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > MAX_PLAYLIST_BYTES) return null;
      text += decoder.decode(value, { stream: true });
    }
  } finally { await reader.cancel().catch(() => {}); }
}

function signedCache(seconds, expiresAt) {
  const ttl = expiresAt ? Math.min(seconds, Math.floor((expiresAt - Date.now()) / 1000)) : seconds;
  return ttl > 0 ? `public, max-age=${ttl}` : 'no-store';
}

/**
 * Atiende una petición de proxy. Devuelve una `Response` lista para el
 * cliente; nunca lanza.
 *
 * @param {Request} request
 * @param {URL} url
 * @param {object} [env]
 * @returns {Promise<Response>}
 */
async function handleHlsProxy(request, url, env) {
  const target = url.searchParams.get('u') || '';
  let upstream;
  try {
    upstream = new URL(target);
  } catch (_) {
    return plain('Falta la URL (u=).', 400);
  }
  if (upstream.protocol !== 'https:' || upstream.username || upstream.password || upstream.port) return plain('Solo HTTPS estándar.', 400);
  if (!hostAllowed(upstream.hostname, allowedHosts(env))) {
    return plain(`Host no permitido: ${upstream.hostname}`, 403);
  }
  if (!ALLOWED_EXT.test(upstream.pathname)) return plain('Tipo de archivo no permitido.', 403);

  const via = url.searchParams.get('via');
  if (via && via !== 'spinflix') return plain('Transporte no permitido.', 400);
  const useSpinFlix = via === 'spinflix';
  // Este modo no acepta ampliar la lista de destinos con HLS_PROXY_HOSTS,
  // ni toma el destino del proxy o el Referer de los parámetros del cliente.
  const destination = useSpinFlix ? spinFlixPlaybackUrl(upstream) : upstream.href;
  if (!destination) return plain('Medio no permitido para SpinFlix.', 403);
  const expiresAt = useSpinFlix ? expiryOf(upstream) : null;
  if (expiresAt && expiresAt <= Date.now()) return plain('El enlace ha caducado.', 410);

  const referer = url.searchParams.get('ref') || '';
  const isHead = request.method === 'HEAD';
  const manifestPath = /\.m3u8$/i.test(upstream.pathname);
  const headers = useSpinFlix ? { ...SPINFLIX_PLAYBACK_HEADERS } : upstreamHeaders(referer);
  const range = request.headers?.get('range');
  if (!manifestPath && /^bytes=(?:\d+-\d*|-\d+)$/.test(range || '')) headers.Range = range;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(destination, {
      method: isHead ? 'HEAD' : 'GET', headers, redirect: 'manual', signal: controller.signal,
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return plain(`${useSpinFlix ? 'SpinFlix' : 'El CDN'} respondió ${res.status}.`, 502);
    }

    const contentType = res.headers.get('content-type') || '';
    const isPlaylist = manifestPath || (!useSpinFlix && /mpegurl/i.test(contentType));
    if (!isPlaylist) {
      if (useSpinFlix && /html|json|mpegurl|^text\/(?!vtt)/i.test(contentType)) {
        await res.body?.cancel().catch(() => {});
        return plain('SpinFlix no devolvió el medio solicitado.', 502);
      }
      // Segmento, subtítulo, clave: se pasa tal cual, sin almacenar el vídeo.
      const outgoing = new Headers({
        'Content-Type': contentType || 'application/octet-stream',
        'Cache-Control': signedCache(600, expiresAt),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges',
      });
      for (const name of ['content-range', 'accept-ranges']) {
        if (res.headers.has(name)) outgoing.set(name, res.headers.get(name));
      }
      if (isHead) await res.body?.cancel().catch(() => {});
      return new Response(isHead ? null : res.body, { status: res.status, headers: outgoing });
    }

    let rewritten = null;
    if (!isHead) {
      const text = await readPlaylist(res);
      if (text === null) return plain('Lista demasiado grande.', 502);
      if (!/^\s*#EXTM3U(?:\r?\n|$)/.test(text)) return plain('El CDN no devolvió HLS.', 502);
      try { rewritten = rewritePlaylist(text, upstream.href, url.pathname, referer, useSpinFlix); }
      catch { return plain('El manifiesto hace referencia a un medio no permitido.', 502); }
    }
    return new Response(rewritten, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'Cache-Control': signedCache(60, expiresAt),
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    const timedOut = err && (err.name === 'AbortError' || err.name === 'TimeoutError');
    return plain(timedOut ? 'El CDN no respondió a tiempo.' : 'No se pudo alcanzar el CDN.', 504);
  } finally {
    clearTimeout(timer);
  }
}

function plain(message, status) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

module.exports = { handleHlsProxy, rewritePlaylist, hostAllowed, allowedHosts, ALLOWED_EXT };
