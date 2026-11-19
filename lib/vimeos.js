'use strict';

const { isDirectMedia } = require('./directMedia');

const VIMEOS_HOSTS = ['vimeos.net', 'vimeos.com', 'vimeos.zip', 'vimeos.xyz', 'vimeos.site', 'vimeos.org'];
const REFERER = 'https://vimeos.net/';
const HEADERS = { Referer: REFERER, Accept: '*/*' };

function allowedVideoUrl(raw, extraHosts = []) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash
      && [...VIMEOS_HOSTS, ...extraHosts].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch { return false; }
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

// La firma declara instante de emisión (s) y validez en segundos (e).
function expiryOf(raw) {
  const params = new URL(raw).searchParams;
  const issued = Number(params.get('s'));
  const duration = Number(params.get('e'));
  return issued > 1e9 && duration > 0 && duration <= 7 * 86400 ? (issued + duration) * 1000 : null;
}
// Validación local (sin red) antes de gastar uno de los intentos de HLS.
function hlsCandidate(master) {
  if (typeof master !== 'string' || !allowedVideoUrl(master) || !isDirectMedia(master)
    || !/\.m3u8$/i.test(new URL(master).pathname)) return null;
  const expiresAt = expiryOf(master);
  return expiresAt && expiresAt <= Date.now() + 30_000 ? null : { master, expiresAt };
}

/**
 * Candidato sin sondeo.
 *
 * El addon ya no descarga manifiestos ni segmentos: solo valida la forma de la
 * URL (host conocido, extensión `.m3u8`, sin credenciales y con firma viva).
 * Así una búsqueda no gasta peticiones en el CDN y tampoco se descarta un
 * enlace que el CDN sirve al cliente pero niega al Worker.
 */
function vimeosMedia(master) {
  const candidate = hlsCandidate(master);
  return candidate ? { ...candidate, resolution: null } : null;
}

/** Embed de Vimeos → primer `.m3u8` válido del HTML, sin abrir el manifiesto. */
async function resolveVimeosEmbed(embed, referer, http, tried = new Set()) {
  if (!allowedVideoUrl(embed, ['lamovie.link'])) return null;
  const html = await http.text(embed, { headers: { ...HEADERS, Referer: referer }, maxBytes: 1024 * 1024 });
  const { hls, subtitles } = extractFromEmbedHtml(html);
  for (const master of hls.filter((url) => !tried.has(url)).slice(0, 2)) {
    const media = vimeosMedia(master);
    if (!media) continue;
    return { ...media, subtitles: subtitles.filter((entry) => allowedVideoUrl(entry.url)) };
  }
  return null;
}

function vimeosCacheSeconds(expiresAt) {
  const remaining = expiresAt ? Math.floor((expiresAt - Date.now()) / 1000) - 30 : Infinity;
  return Math.max(0, Math.min(900, remaining));
}

module.exports = {
  REFERER, allowedVideoUrl, unpackPacked, extractFromEmbedHtml,
  hlsCandidate, vimeosMedia, resolveVimeosEmbed, vimeosCacheSeconds,
};
