'use strict';

const VIMEOS_HOSTS = Object.freeze(['vimeos.net', 'vimeos.com', 'vimeos.zip', 'vimeos.xyz', 'vimeos.site', 'vimeos.org']);
const SPINFLIX_PLAYBACK = 'https://spinoff.link/pelis/proxy.php';
const SPINFLIX_PLAYBACK_HEADERS = Object.freeze({
  Referer: 'https://spinoff.link/pelis/',
  'User-Agent': 'Mozilla/5.0 (compatible; CatalogosPlus/1.5; +https://github.com/noe359866-code/SAS5)',
  Accept: '*/*',
});
const MEDIA_EXT = /\.(?:m3u8|ts|m4s|mp4|vtt|key)$/i;
const TRANSPORT_CHECK_RE = /^proxy-(?:unsupported-path|read-error|invalid-hls|invalid-uri|timeout|challenge|http-[1-5]\d{2})$/;

/** El proxy de SpinFlix envuelve unas URI y devuelve otras directamente. */
function spinFlixMedia(raw, base) {
  if (!raw) return null;
  try {
    let url = new URL(raw, base);
    if (`${url.origin}${url.pathname}` === SPINFLIX_PLAYBACK && !url.username && !url.password && !url.hash) {
      url = new URL(url.searchParams.get('url'));
    }
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash
      && VIMEOS_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
      && /^\/hls\d*\//i.test(url.pathname) && MEDIA_EXT.test(url.pathname) ? url : null;
  } catch { return null; }
}

function spinFlixPlaybackUrl(raw) {
  const media = spinFlixMedia(raw);
  if (!media) return null;
  const url = new URL(SPINFLIX_PLAYBACK);
  url.searchParams.set('url', media.href);
  url.searchParams.set('ref', `${media.origin}/`);
  return url.href;
}

function workerPlaybackPath(raw) {
  const media = spinFlixMedia(raw);
  return media && `/hls?via=spinflix&u=${encodeURIComponent(media.href)}`;
}

// La firma declara instante de emisión (s) y validez en segundos (e).
function expiryOf(raw) {
  const params = new URL(raw).searchParams;
  const issued = Number(params.get('s'));
  const duration = Number(params.get('e'));
  return issued > 1e9 && duration > 0 && duration <= 7 * 86400 ? (issued + duration) * 1000 : null;
}

module.exports = { VIMEOS_HOSTS, SPINFLIX_PLAYBACK_HEADERS, TRANSPORT_CHECK_RE, spinFlixMedia, spinFlixPlaybackUrl, workerPlaybackPath, expiryOf };
