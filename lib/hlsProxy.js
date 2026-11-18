/**
 * Proxy HLS del addon.
 *
 * SpinFlix entrega un `.m3u8` de vimeos.net. El CDN sirve las playlists sin
 * `Referer`, pero los segmentos `.ts` son otra historia: si el CDN empieza a
 * pedir `Referer` (o el proxy de la web de origen se cae), la reproducción se
 * queda a medias sin ningún aviso. Este proxy cierra ese hueco:
 *
 *   GET /hls?u=<url absoluta del CDN>
 *
 * Reglas de seguridad (un proxy abierto es un abuso esperando a ocurrir):
 *  - Solo HTTPS y solo hosts de una lista blanca (los CDN que usamos).
 *  - Solo `.m3u8`, `.ts`, `.vtt`, `.key`, `.m4s` y `.mp4`: nada de HTML.
 *  - Tope de tamaño para las listas y de tiempo para la descarga.
 *  - Las playlists se reescriben para que SUS segmentos también pasen por
 *    aquí: así el `Referer` se pone en cada petición y no solo en la primera.
 */

// vimeos sirve el mismo CDN bajo varios TLD y rota entre ellos según la
// sesión: el mismo embed de Fanpelis devolvió `s9.vimeos.net` y
// `p3.vimeos.zip` en dos pasadas seguidas. Si falta uno, el proxy responde
// 403 y el stream se queda sin reproducir, así que van todos.
const DEFAULT_HOSTS = ['vimeos.net', 'vimeos.com', 'vimeos.zip', 'vimeos.xyz', 'vimeos.site', 'vimeos.org'];

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
  return [...new Set([...DEFAULT_HOSTS, ...extra])];
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
function rewritePlaylist(text, baseUrl, proxyPath, referer) {
  const base = new URL(baseUrl);
  const proxify = (raw) => {
    const uri = String(raw || '').trim();
    if (!uri) return uri;
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

  const referer = url.searchParams.get('ref') || '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(upstream.toString(), {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: upstreamHeaders(referer),
      redirect: 'manual',
      signal: controller.signal,
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return plain(`El CDN respondió ${res.status}.`, 502);
    }

    const contentType = res.headers.get('content-type') || '';
    const isPlaylist = /mpegurl/i.test(contentType) || /\.m3u8(?:$|[?#])/i.test(upstream.pathname);

    if (!isPlaylist) {
      // Segmento, subtítulo, clave: se pasa tal cual, en streaming.
      return new Response(res.body, {
        status: 200,
        headers: {
          'Content-Type': contentType || 'application/octet-stream',
          'Cache-Control': 'public, max-age=600',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Lista: tope de tamaño para no tragarse algo enorme por error.
    const length = Number(res.headers.get('content-length') || 0);
    if (length > MAX_PLAYLIST_BYTES) return plain('Lista demasiado grande.', 502);
    const text = await res.text();
    if (request.method !== 'HEAD' && !/^\s*#EXTM3U(?:\r?\n|$)/.test(text)) return plain('El CDN no devolvió HLS.', 502);
    if (text.length > MAX_PLAYLIST_BYTES) return plain('Lista demasiado grande.', 502);
    const rewritten = rewritePlaylist(text, upstream.toString(), url.pathname, referer);
    return new Response(rewritten, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
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
