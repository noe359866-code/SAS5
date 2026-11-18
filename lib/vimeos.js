'use strict';

const { isDirectMedia } = require('./directMedia');
const { parseManifest } = require('./hlsManifest');

const VIMEOS_HOSTS = ['vimeos.net', 'vimeos.com', 'vimeos.zip', 'vimeos.xyz', 'vimeos.site', 'vimeos.org'];
const MAX_UNPACKED_LENGTH = 1024 * 1024;
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
  const payload = m[1].replace(/\\'/g, "'");
  const radix = Number(m[2]);
  const count = Number(m[3]);
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
  const lookup = new Map();
  for (let i = 0; i < Math.min(count, keywords.length); i++) {
    if (keywords[i]) lookup.set(encode(i), keywords[i]);
  }
  // Una sola pasada: no volver a reemplazar palabras recién desempaquetadas.
  const chunks = [];
  let size = payload.length;
  let cursor = 0;
  if (size > MAX_UNPACKED_LENGTH) return '';
  for (const match of payload.matchAll(/\b\w+\b/g)) {
    const word = match[0];
    const replacement = lookup.get(word);
    if (!replacement || replacement === word) continue;
    size += replacement.length - word.length;
    if (size > MAX_UNPACKED_LENGTH) return '';
    chunks.push(payload.slice(cursor, match.index), replacement);
    cursor = match.index + word.length;
  }
  chunks.push(payload.slice(cursor));
  return chunks.join('');
}

// Algunos reproductores serializan barras o delimitadores de URL en cadenas JS.
function unescapeUrl(raw) {
  return raw.replace(/\\(?:\/|x(?:2f|3a|26|3d|3f)|u00(?:2f|3a|26|3d|3f))/gi, (value) => (
    value === '\\/' ? '/' : String.fromCharCode(parseInt(value.slice(-2), 16))
  )).replace(/&amp;/gi, '&');
}

/** .m3u8 y subtítulos .vtt del visor, sin ejecutar su JavaScript. */
function extractFromEmbedHtml(html) {
  const source = String(html || '');
  const unpacked = unpackPacked(source);
  const hls = new Set();
  const subtitles = new Map();
  for (const text of new Set([unpacked, source])) {
    const decoded = unescapeUrl(text);
    for (const [url] of decoded.matchAll(/https?:\/\/[^\s"'\\<>]+/gi)) {
      if (isDirectMedia(url) && /\.m3u8$/i.test(new URL(url).pathname)) hls.add(url);
    }
    for (const [object, raw] of decoded.matchAll(/\{[^{}]*?["']?\bfile["']?\s*:\s*["'](https?:\/\/[^"'\s<>]+)["'][^{}]*\}/gi)) {
      try {
        if (!/\.vtt$/i.test(new URL(raw).pathname) || subtitles.has(raw)) continue;
        const kind = /["']?\bkind["']?\s*:\s*["']([^"']+)/i.exec(object)?.[1];
        if (kind && !/^(?:captions|subtitles)$/i.test(kind)) continue;
        const label = /["']?\blabel["']?\s*:\s*["']([^"']+)/i.exec(object)?.[1] || 'Subtítulos';
        subtitles.set(raw, { url: raw, lang: /span|esp/i.test(label) ? 'es' : 'und', title: label });
      } catch { /* URL ilegible */ }
    }
  }
  return { hls: [...hls], subtitles: [...subtitles.values()] };
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

async function inspectVimeos(master, http) {
  const candidate = hlsCandidate(master);
  if (!candidate) return null;
  // Solo se sondea el manifiesto directo. Ni el Worker ni el addon sirven
  // las variantes, pistas, claves o segmentos del reproductor.
  let text;
  try {
    text = await http.text(master, { headers: HEADERS, timeoutMs: 1500, maxBytes: 512 * 1024 });
  } catch (err) {
    if (err.requestLimit) throw err;
    // El CDN puede negar al runner o al Worker y sí servir al cliente. Las
    // firmas caducadas, 404/410 y HTML en lugar de HLS no son candidatos.
    // Mantener la URL conocida sin anunciar calidad ni darla por verificada.
    if (err.challenge || err.timeout || err instanceof TypeError || [401, 403, 429].includes(err.status)
        || (err.status >= 300 && err.status < 400) || err.status >= 500) {
      return { ...candidate, resolution: null, verification: err.status ? `cdn-http-${err.status}` : 'cdn-unverified' };
    }
    return null;
  }
  const manifest = parseManifest(text, (uri) => allowedVideoUrl(new URL(uri, master).href));
  if (!manifest) return null;
  return { ...candidate, resolution: manifest.resolution, verification: 'manifest-ok' };
}

async function resolveVimeosEmbed(embed, referer, http, tried = new Set()) {
  if (!allowedVideoUrl(embed, ['lamovie.link'])) return null;
  const html = await http.text(embed, { headers: { ...HEADERS, Referer: referer }, maxBytes: 1024 * 1024 });
  const { hls, subtitles } = extractFromEmbedHtml(html);
  let alternative = null;
  for (const master of hls.filter((url) => !tried.has(url) && hlsCandidate(url)).slice(0, 2)) {
    let inspected;
    try {
      inspected = await inspectVimeos(master, http);
    } catch (err) {
      if (err.requestLimit || err.timeout) {
        if (alternative) return alternative;
        throw err;
      }
      continue;
    }
    if (!inspected) continue;
    const media = { ...inspected, subtitles: subtitles.filter((entry) => allowedVideoUrl(entry.url)) };
    if (inspected.verification === 'manifest-ok') return media;
    alternative ||= media;
  }
  return alternative;
}

function vimeosCacheSeconds(expiresAt) {
  const remaining = expiresAt ? Math.floor((expiresAt - Date.now()) / 1000) - 30 : Infinity;
  return Math.max(0, Math.min(900, remaining));
}

module.exports = {
  REFERER, allowedVideoUrl, unpackPacked, extractFromEmbedHtml,
  hlsCandidate, inspectVimeos, resolveVimeosEmbed, vimeosCacheSeconds,
};
