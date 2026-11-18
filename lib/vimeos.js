'use strict';

const config = require('./config');
const { isDirectMedia } = require('./directMedia');
const { hostAllowed, allowedHosts, rewritePlaylist } = require('./hlsProxy');
const { parseManifest } = require('./hlsManifest');
const { expiryOf, spinFlixPlaybackUrl, SPINFLIX_PLAYBACK_HEADERS } = require('./vimeosPlayback');

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

// Validación local (sin red) antes de gastar uno de los intentos de HLS.
function hlsCandidate(master) {
  if (typeof master !== 'string' || !allowedVideoUrl(master) || !isDirectMedia(master, null, false)
    || !/\.m3u8$/i.test(new URL(master).pathname)) return null;
  const expiresAt = expiryOf(master);
  return expiresAt && expiresAt <= Date.now() + 30_000 ? null : { master, expiresAt };
}

async function inspectVimeos(master, http, { spinflixPlayback = false } = {}) {
  const candidate = hlsCandidate(master);
  if (!candidate) return null;
  const { expiresAt } = candidate;

  const proxy = spinflixPlayback && spinFlixPlaybackUrl(master);
  let transportCheck = spinflixPlayback ? 'proxy-unsupported-path' : null;
  if (proxy) {
    transportCheck = 'proxy-read-error';
    try {
      const text = await http.text(proxy, {
        headers: SPINFLIX_PLAYBACK_HEADERS, timeoutMs: 1800, maxBytes: 512 * 1024,
      });
      transportCheck = 'proxy-invalid-hls';
      const manifest = parseManifest(text);
      if (manifest) {
        // Usar el transporte que comprobamos, no el CDN directo; el proxy de
        // SpinFlix deja algunas URI directas en las listas (incluido el audio).
        transportCheck = 'proxy-invalid-uri';
        rewritePlaylist(text, master, '/hls', '', true);
        return { master, expiresAt, resolution: manifest.resolution, verification: 'manifest-ok', transport: 'spinflix' };
      }
    } catch (err) {
      if (err.requestLimit) throw err;
      if (err.timeout) transportCheck = 'proxy-timeout';
      else if (err.challenge) transportCheck = 'proxy-challenge';
      else if (err.status) transportCheck = `proxy-http-${err.status}`;
      // Conservar la salida directa de antes, sin confundir sus diagnósticos.
    }
  }
  const candidateInfo = { ...candidate, ...(transportCheck ? { transportCheck } : {}) };
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
      return { ...candidateInfo, resolution: null, verification: err.status ? `cdn-http-${err.status}` : 'cdn-unverified' };
    }
    return null;
  }
  const manifest = parseManifest(text);
  if (!manifest) return null;
  return { ...candidateInfo, resolution: manifest.resolution, verification: 'manifest-ok' };
}

async function resolveVimeosEmbed(embed, referer, http, tried = new Set(), playbackOptions) {
  if (!allowedVideoUrl(embed, ['lamovie.link'])) return null;
  const html = await http.text(embed, { headers: { ...HEADERS, Referer: referer }, maxBytes: 1024 * 1024 });
  const { hls, subtitles } = extractFromEmbedHtml(html);
  let alternative = null;
  for (const master of hls.filter((url) => !tried.has(url) && hlsCandidate(url)).slice(0, 2)) {
    let inspected;
    try {
      inspected = await inspectVimeos(master, http, playbackOptions);
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
  REFERER, allowedVideoUrl, proxiedHls, unpackPacked, extractFromEmbedHtml,
  hlsCandidate, inspectVimeos, resolveVimeosEmbed, vimeosCacheSeconds,
};
