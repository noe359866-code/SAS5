'use strict';

const { isDirectMedia } = require('./directMedia');
const { parseManifest } = require('./hlsManifest');

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
  const manifest = parseManifest(text);
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
