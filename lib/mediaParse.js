'use strict';

/**
 * Decodificador y validador de medios para los extractores.
 *
 * Todo lo de este módulo es **síncrono y local**: no hace red. Sirve para:
 *
 *   1. `parseHlsManifest(texto)`: lee un manifiesto maestro o de variantes y
 *      devuelve la mejor variante (o la lista de segmentos si es un media
 *      playlist). Es el mismo lector que ya usa `hlsManifest.js`, ampliado con
 *      atributos, audio y subtítulos para no publicar un enlace a ciegas.
 *   2. `mediaKind(url)`: HLS/MP4/desconocido.
 *   3. `normalizeMediaUrl(url, base)`: resuelve relativos y descarta esquemas
 *      raros, credenciales y `data:`/`blob:`.
 *   4. `resolvePlayback(json, { decrypt })`: interpreta el campo `playback` de
 *      Byse (AES-256-GCM con `key_parts` troceados) y devuelve la lista de
 *      fuentes. `decrypt` se inyecta para poder probarlo sin WebCrypto.
 *   5. `fromPacker(source)`: desempaqueta el formato Dean Edwards que usan
 *      MixDrop y varios visores; devuelve `null` si no lo reconoce.
 *
 * El objetivo es que ningún extractor publique una URL sin comprobar su forma:
 * una URL que no pasa por aquí no sale del addon.
 */

const HLS_ATTR = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;

/** Convierte la lista de atributos de una línea `#EXT-X-...` en un objeto. */
function hlsAttributes(text) {
  const attrs = {};
  if (!text) return attrs;
  for (const match of String(text).matchAll(HLS_ATTR)) {
    const value = match[2].replace(/^"|"$/g, '');
    attrs[match[1]] = /^\d+$/.test(value) ? Number(value) : value;
  }
  return attrs;
}

function absoluteUrl(uri, base) {
  if (!uri) return null;
  try {
    const url = new URL(String(uri).trim(), base || undefined);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    return url;
  } catch { return null; }
}

/**
 * Lector de manifiestos HLS.
 *
 * - Manifiesto maestro (`#EXT-X-STREAM-INF`): devuelve las variantes con su
 *   resolución, códec, audio declarado y ancho de banda, ordenadas de mayor a
 *   menor calidad. `best` es la primera.
 * - Media playlist (`#EXTINF`): devuelve la lista de segmentos absueltos.
 * - Si no empieza por `#EXTM3U`, devuelve `null` (no es HLS).
 */
function parseHlsManifest(text, base) {
  const body = String(text || '').replace(/^\uFEFF/, '');
  if (!/^\s*#EXTM3U/.test(body)) return null;
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  const audio = new Map();
  for (const line of lines) {
    if (!line.startsWith('#EXT-X-MEDIA:')) continue;
    const attrs = hlsAttributes(line.slice('#EXT-X-MEDIA:'.length));
    if (attrs.TYPE !== 'AUDIO' || !attrs['GROUP-ID']) continue;
    const group = audio.get(attrs['GROUP-ID']) || [];
    group.push({
      name: attrs.NAME || '', language: (attrs.LANGUAGE || '').toLowerCase(),
      default: attrs.DEFAULT === 'YES', uri: absoluteUrl(attrs.URI, base)?.href || null,
    });
    audio.set(attrs['GROUP-ID'], group);
  }
  const variants = [];
  let pending = null;
  let segments = [];
  let pendingDuration = null;
  for (const line of lines.slice(1)) {
    if (!line) continue;
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      pending = hlsAttributes(line.slice('#EXT-X-STREAM-INF:'.length));
      continue;
    }
    if (line.startsWith('#EXTINF:')) {
      pendingDuration = Number(line.slice('#EXTINF:'.length).split(',')[0]) || 0;
      continue;
    }
    if (line.startsWith('#')) continue;
    const url = absoluteUrl(line, base);
    if (pending) {
      if (url) {
        const height = Number(String(pending.RESOLUTION || '').split('x')[1]) || null;
        variants.push({
          uri: url.href, height,
          bandwidth: Number(pending.BANDWIDTH) || null,
          codecs: pending.CODECS || '',
          audioGroup: pending.AUDIO || '',
          audio: audio.get(pending.AUDIO) || [],
        });
      }
      pending = null;
    } else if (pendingDuration !== null) {
      if (url) segments.push({ uri: url.href, duration: pendingDuration });
      pendingDuration = null;
    }
  }
  if (variants.length) {
    variants.sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bandwidth || 0) - (a.bandwidth || 0));
    return { type: 'master', variants, best: variants[0], segments: [] };
  }
  if (segments.length) {
    return { type: 'media', variants: [], best: null, segments };
  }
  return null;
}

/** HLS si la ruta acaba en `.m3u8` (o la respuesta lo declara); MP4 si `.mp4`/`.m4v`. */
function mediaKind(url, contentType) {
  const type = String(contentType || '').toLowerCase();
  if (/mpegurl/.test(type)) return 'hls';
  if (/^video\/mp4/.test(type)) return 'mp4';
  let path = '';
  try { path = decodeURIComponent(new URL(String(url)).pathname).toLowerCase(); } catch { return null; }
  if (/\.m3u8$/.test(path)) return 'hls';
  if (/\.(?:mp4|m4v)$/.test(path)) return 'mp4';
  if (/\.(?:webm|mpd)$/.test(path)) return null; // Stremio no lo reproduce de forma fiable
  return null;
}

function normalizeMediaUrl(raw, base) {
  const url = absoluteUrl(raw, base);
  if (!url) return null;
  url.hash = '';
  return url.href;
}

/** bits/s → etiqueta de calidad aproximada cuando no hay RESOLUTION. */
function heightFromBandwidth(bandwidth) {
  const value = Number(bandwidth) || 0;
  if (value >= 6_000_000) return 2160;
  if (value >= 3_000_000) return 1080;
  if (value >= 1_400_000) return 720;
  if (value >= 700_000) return 480;
  if (value > 0) return 360;
  return null;
}

// ── Dean Edwards unpacker ────────────────────────────────────────────────
/**
 * Desempaqueta `eval(function(p,a,c,k,e,d){…}('…',62,123,'…'.split('|')))`.
 * Es el formato de MixDrop y de muchos visores de películas. No ejecuta nada:
 * hace los mismos reemplazos que el stub del packer, con un tope de tamaño.
 */
function fromPacker(source) {
  const text = String(source || '');
  if (text.length > 512 * 1024) return null;
  const match = /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\s*\.split\(\s*(['"])\|\7\s*\)/s.exec(text);
  if (!match) return null;
  let payload = match[2].replace(/\\(['"\\])/g, '$1');
  const radix = Number(match[3]) || 36;
  let count = Number(match[4]) || 0;
  // Invalid radix 1 never terminates encode(); huge counters amplify CPU work.
  if (!Number.isInteger(radix) || radix < 2 || radix > 62 ||
      !Number.isSafeInteger(count) || count < 0 || count > 4096 ||
      count * payload.length > 8 * 1024 * 1024) return null;
  const keywords = match[6].split('|');
  const encode = (value) => {
    let out = '';
    let rest = value;
    do {
      const digit = rest % radix;
      out = (digit < 36 ? digit.toString(36) : String.fromCharCode(digit + 29)) + out;
      rest = Math.floor(rest / radix);
    } while (rest > 0);
    return out;
  };
  while (count--) {
    const word = keywords[count];
    if (!word) continue;
    const token = encode(count);
    payload = payload.replace(new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), word);
  }
  return payload;
}

// ── Byse: playback cifrado con AES-256-GCM ───────────────────────────────
function base64ToBytes(value) {
  const text = String(value || '').replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  if (!text || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  try {
    const binary = typeof atob === 'function'
      ? atob(text.padEnd(Math.ceil(text.length / 4) * 4, '='))
      : Buffer.from(text, 'base64').toString('binary');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch { return null; }
}

function concatBytes(list) {
  const total = list.reduce((sum, item) => sum + item.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const item of list) { out.set(item, offset); offset += item.length; }
  return out;
}

/**
 * Une `key_parts` en la clave real y descifra `payload` (AES-256-GCM, tag al
 * final, IV de 12 bytes). Devuelve el JSON descifrado o `null`.
 *
 * Los `key_parts` reales (medidos el 19-11-2026 en bysejikuar.com y
 * byseraguci.com) mezclan 28 señuelos de 24 bytes con las dos mitades de la
 * clave, de 16 bytes cada una. La clave es la concatenación de esas dos
 * mitades, pero el orden en que llegan no es el de la clave (varía entre
 * respuestas): se prueban los órdenes candidatos y el tag GCM autentica el
 * correcto. Si no hay partes de 16 bytes, se usa el conjunto completo
 * (formato de prueba).
 *
 * `subtle` permite inyectar un CryptoSubtle falso en pruebas; por defecto usa
 * `globalThis.crypto.subtle` (Workers y Node ≥ 18 lo tienen).
 */
async function decryptPlayback(playback, subtle = globalThis.crypto?.subtle) {
  if (!playback || playback.algorithm !== 'AES-256-GCM' || !Array.isArray(playback.key_parts)) return null;
  const entries = playback.key_parts.map((raw) => ({ raw: String(raw), bytes: base64ToBytes(raw) }));
  if (entries.some((entry) => !entry.bytes)) return null;
  const parts = entries.map((entry) => entry.bytes);
  const nonce = base64ToBytes(playback.iv);
  const data = base64ToBytes(playback.payload);
  if (!nonce || nonce.length !== 12 || !data || data.length <= 16 || !subtle) return null;

  const shares = entries.filter((entry) => entry.bytes.length === 16);
  const byBytes = (a, b) => Buffer.compare(a.bytes, b.bytes);
  const orderings = shares.length === 2
    ? [shares, [...shares].reverse(),
      [...shares].sort(byBytes), [...shares].sort((a, b) => -byBytes(a, b)),
      [...shares].sort((a, b) => (a.raw < b.raw ? -1 : 1))]
    : [entries];
  const seen = new Set();
  for (const ordering of orderings) {
    const key = concatBytes(ordering.map((entry) => entry.bytes));
    if (key.length !== 32) continue;
    const fingerprint = Buffer.from(key).toString('hex');
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    try {
      const imported = await subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
      const plain = await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, imported, data);
      return JSON.parse(new TextDecoder().decode(plain));
    } catch { /* otra ordenación */ }
  }
  return null;
}

/**
 * Convierte la respuesta de Byse (`{ playback }`) en fuentes normalizadas.
 * El JSON descifrado trae `sources` con `file` y `label`/`res`; se aceptan las
 * variantes habituales (`src`, `url`, `hls`) sin confiar en etiquetas de audio.
 */
function playbackSources(payload, base) {
  if (!payload || typeof payload !== 'object') return [];
  const raw = payload.sources || payload.source || payload.files || payload.playlist || [];
  const list = Array.isArray(raw) ? raw : Object.values(raw);
  const out = [];
  for (const entry of list) {
    if (!entry) continue;
    const url = typeof entry === 'string' ? entry : entry.file || entry.src || entry.url || entry.hls || entry.link;
    const href = normalizeMediaUrl(url, base);
    if (!href) continue;
    const kind = mediaKind(href);
    if (!kind) continue;
    out.push({ url: href, kind, label: String(entry.label || entry.res || entry.quality || '') });
  }
  return out;
}

/** Deduce idioma de audio a partir de una etiqueta de texto conocida. */
function audioFromLabel(label) {
  const text = String(label || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/\b(?:latino|latam|lat)\b/.test(text)) return 'Latino';
  if (/\b(?:castellano|espanol|espana|spa)\b/.test(text)) return 'Castellano';
  if (/\b(?:subtitulad|sub|vose|vostfr)/.test(text)) return 'Subtitulado';
  if (/\b(?:ingles|english|eng)\b/.test(text)) return 'Inglés';
  return '';
}

module.exports = {
  hlsAttributes, parseHlsManifest, mediaKind, normalizeMediaUrl, heightFromBandwidth,
  fromPacker, base64ToBytes, concatBytes, decryptPlayback, playbackSources, audioFromLabel,
};
