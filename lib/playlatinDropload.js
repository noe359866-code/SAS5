'use strict';

const { load } = require('cheerio');
const { isDirectMedia } = require('./directMedia');
const { parseManifest } = require('./hlsManifest');
const { unpackPacked } = require('./vimeos');

const REFERER = 'https://dr0pstream.com/';
const MAX_EMBED_BYTES = 512 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;

function httpsUrl(value, base) {
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash ? url : null;
  } catch { return null; }
}

function droploadEmbed(value) {
  const url = httpsUrl(value);
  return url?.hostname === 'dr0pstream.com' && /^\/e\/[a-z0-9_-]{1,80}\/?$/i.test(url.pathname) ? url.href : null;
}

function droploadCdn(value, base) {
  const url = httpsUrl(value, base);
  return url && /^r\d{1,2}\.dropcdn\.io$/.test(url.hostname) ? url.href : null;
}

function droploadPlaylist(html) {
  const $ = load(html);
  const playlists = new Set();
  for (const node of $('script:not([src])').toArray()) {
    const script = $(node).text();
    if (script.length > 64 * 1024) continue;
    // Lee los literales de sources del reproductor; no ejecuta JS ni sigue enlaces.
    const text = unpackPacked(script) || script;
    if (!/\bjwplayer\s*\(/i.test(text)) continue;
    for (const [, list] of text.matchAll(/(?:^|[{,])\s*["']?sources["']?\s*:\s*\[([^\]]{1,8192})\]/g)) {
      for (const [, , value] of list.matchAll(/(?:^|[{,])\s*["']?file["']?\s*:\s*(["'])(https:\/\/[^\s"'<>\\]{1,4096})\1/g)) {
        const url = droploadCdn(value);
        if (url && /\.m3u8$/i.test(new URL(url).pathname) && isDirectMedia(url, 'playlatin', false)) playlists.add(url);
      }
    }
  }
  return playlists.size === 1 ? [...playlists][0] : null;
}

function failure(stage, error) {
  return { reason: `${stage}-${error.challenge ? 'challenge' : error.timeout ? 'timeout' : error.status ? `http-${error.status}` : 'unverified'}` };
}

async function resolveDropload(embed, page, http) {
  if (!droploadEmbed(embed)) return { reason: 'unsupported-embed' };
  let stage = 'embed';
  try {
    const html = await http.text(embed, { headers: { Referer: page }, timeoutMs: 2500, maxBytes: MAX_EMBED_BYTES });
    const url = droploadPlaylist(html);
    if (!url) return { reason: 'embed-no-public-media' };
    stage = 'cdn';
    const manifest = parseManifest(await http.text(url, { headers: { Referer: REFERER }, timeoutMs: 2000, maxBytes: MAX_MANIFEST_BYTES }));
    if (!manifest) return { reason: 'cdn-invalid-manifest' };
    return { url, referer: REFERER, resolution: manifest.resolution, verification: 'manifest-ok',
      // El visor publica enlaces firmados sin caducidad documentada. No
      // reutilizar un enlace descubierto más allá de una ventana corta.
      expiresAt: Date.now() + 120_000 };
  } catch (error) { return failure(stage, error); }
}

module.exports = { droploadEmbed, droploadCdn, resolveDropload };
