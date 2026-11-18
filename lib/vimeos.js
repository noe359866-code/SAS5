'use strict';

const config = require('./config');
const { isDirectMedia } = require('./directMedia');
const { hostAllowed, allowedHosts } = require('./hlsProxy');
const { parseManifest } = require('./hlsManifest');

const REFERER = 'https://vimeos.net/';
const HEADERS = { Referer: REFERER, Accept: '*/*' };

function allowedVideoUrl(raw, extraHosts = []) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && hostAllowed(url.hostname, [...allowedHosts({ HLS_PROXY_HOSTS: config.hlsProxyHosts }), ...extraHosts]);
  } catch { return false; }
}

// Cuando no se configura el dominio del addon, conserva la URL del CDN.
function proxiedHls(masterUrl) {
  if (!masterUrl) return null;
  const base = String(config.spinflixProxyUrl || '').trim();
  // Sin proxy configurado: el proxy propio del addon.
  if (!base) {
    const origin = String(config.addonBaseUrl || '').replace(/\/+$/, '');
    if (!origin) return masterUrl; // sin dominio público, el CDN directo
    return `${origin}/hls?ref=${encodeURIComponent('https://vimeos.net/')}&u=${encodeURIComponent(masterUrl)}`;
  }
  const clean = base.replace(/\/+$/, '');
  if (clean.includes('?')) return `${clean}${encodeURIComponent(masterUrl)}`;
  return `${clean}?url=${encodeURIComponent(masterUrl)}`;
}

/** Desempaquetador de Dean Edwards (el `eval(function(p,a,c,k,e,d)…)` de vimeos.net). */
function unpackPacked(html) {
  const m = String(html || '').match(
    /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('((?:\\'|[^'])*)',(\d+),(\d+),'((?:\\'|[^'])*)'\.split\('\|'\)/
  );
  if (!m) return '';
  let payload = m[1].replace(/\\'/g, "'");
  const radix = Number(m[2]);
  let count = Number(m[3]);
  if (radix < 2 || radix > 62 || count > 4096) return '';
  const keywords = m[4].split('|');
  const encode = (n) => {
    let out = '';
    let v = n;
    do {
      const d = v % radix;
      out = (d < 36 ? d.toString(36) : String.fromCharCode(d + 29)) + out;
      v = Math.floor(v / radix);
    } while (v > 0);
    return out;
  };
  while (count--) {
    if (keywords[count]) payload = payload.replace(new RegExp(`\\b${encode(count)}\\b`, 'g'), keywords[count]);
  }
  return payload;
}

/** .m3u8 y subtítulos .vtt dentro del JS desempaquetado del embed. */
function extractFromEmbedHtml(html) {
  const text = unpackPacked(html) || String(html || '');
  const hls = [...new Set([...text.matchAll(/https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*/g)].map((x) => x[0]))].filter((url) => isDirectMedia(url));
  const subtitles = [];
  for (const m of text.matchAll(/\{[^{}]*"file"\s*:\s*"(https?:\/\/[^\"]+\.vtt[^\"]*)"[^{}]*\}/g)) {
    const label = (m[0].match(/"label"\s*:\s*"([^"]*)"/) || [])[1] || 'Subtítulos';
    subtitles.push({ url: m[1], lang: /span|esp/i.test(label) ? 'es' : 'und', title: label });
  }
  return { hls, subtitles };
}

// La firma de Vimeos declara instante de emisión (s) y validez en segundos (e).
function expiryOf(url) {
  const params = new URL(url).searchParams;
  const issued = Number(params.get('s'));
  const duration = Number(params.get('e'));
  return issued > 1e9 && duration > 0 && duration <= 7 * 86400 ? (issued + duration) * 1000 : null;
}

async function inspectVimeos(master, http) {
  if (!allowedVideoUrl(master) || !isDirectMedia(master, null, false) || !/\.m3u8$/i.test(new URL(master).pathname)) return null;
  const expiresAt = expiryOf(master);
  if (expiresAt && expiresAt < Date.now() + 30_000) return null;
  const manifest = parseManifest(await http.text(master, { headers: HEADERS, maxBytes: 512 * 1024 }));
  if (!manifest) return null;
  return { master, expiresAt, resolution: manifest.resolution };
}

async function resolveVimeosEmbed(embed, referer, http, tried = new Set()) {
  if (!allowedVideoUrl(embed, ['lamovie.link'])) return null;
  const html = await http.text(embed, { headers: { ...HEADERS, Referer: referer }, maxBytes: 1024 * 1024 });
  const { hls, subtitles } = extractFromEmbedHtml(html);
  for (const master of hls.filter((url) => !tried.has(url)).slice(0, 2)) {
    const inspected = await inspectVimeos(master, http).catch((err) => {
      if (err.timeout) throw err;
      return null;
    });
    if (inspected) return { ...inspected, subtitles: subtitles.filter((entry) => allowedVideoUrl(entry.url)) };
  }
  return null;
}

function vimeosCacheSeconds(expiresAt) {
  const remaining = expiresAt ? Math.floor((expiresAt - Date.now()) / 1000) - 30 : Infinity;
  return Math.max(0, Math.min(900, remaining));
}

module.exports = {
  REFERER, allowedVideoUrl, proxiedHls, unpackPacked, extractFromEmbedHtml,
  inspectVimeos, resolveVimeosEmbed, vimeosCacheSeconds,
};
