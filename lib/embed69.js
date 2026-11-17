'use strict';

/**
 * Embed69 (https://embed69.org): API de embeds en **español latino** (con
 * parte de castellano y subtitulado). Es la que usan PelisPlusHD y Cuevana3,
 * así que cubre el hueco que no cubren ni SpinFlix ni los indexadores.
 *
 * Cómo funciona (verificado en el código de un solver público, nov-2026):
 *
 *   1. GET /f/{imdbId}/            (película)
 *      GET /f/{imdbId}-{s}x{e}/    (episodio)
 *      Devuelve una página con:
 *        const POW_CHALLENGE = '…'; const POW_DIFFICULTY = N; const POW_SALT = '…';
 *        dataLink = [{ video_language: 'LAT', sortedEmbeds: [{ servername, link }] }];
 *
 *   2. Cada `link` viene en uno de dos formatos:
 *      a) `a.<base64>.c` → base64 de un JSON con la URL real («link»).
 *      b) base64 cifrado en AES-CBC (IV de 16 bytes al principio), con la
 *         clave derivada del PoW:
 *           i tal que sha256(challenge + i) empieza por `difficulty` ceros
 *           clave = sha256(challenge + i + salt)          (32 bytes)
 *
 * El PoW es **CPU puro**: con dificultad 5 son ~126.000 SHA-256 y ~8,8 s en
 * un núcleo de Node; en un Worker del plan free (10 ms de CPU) eso es
 * inviable y además se comería la cuota. Por eso:
 *
 *   · El PoW se cachea por challenge (dura ~10 min): el coste se paga UNA vez
 *     por CDN de caché, no por petición.
 *   · Se puede precalentar con `npm run embed69:pow` y publicar el resultado
 *     en la KV (`EMBED69_POW`), con lo que el Worker no calcula nada.
 *   · `EMBED69_POW=off` desactiva el proveedor sin tocar el resto.
 *
 * Las URLs que devuelve son de hosts externos (streamwish, vidhide, filemoon…),
 * no HLS directo: se entregan como stream con `notWebReady` y sus
 * `proxyHeaders`, que es lo que Stremio sabe reproducir.
 */

const config = require('./config');
const cache = require('./cache');
const { fetchText, fetchJson } = require('./http');

const DEFAULT_BASE = 'https://embed69.org';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; CatalogosPlus/1.5; +https://github.com/noe359866-code/SAS5)',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'es-ES,es;q=0.9',
};
const POW_TTL_SECONDS = 6 * 3600; // el challenge cambia cada pocos minutos
const SOLVED_TTL_SECONDS = 45 * 60; // el resultado sirve mientras el challenge viva
const MAX_POW_ITERATIONS = 4_000_000; // cordura: nunca colgar un isolate
const MAX_LINKS_PER_TITLE = 8;

/** Idioma de Embed69 → etiqueta que entienden los filtros e insignias. */
const LANGUAGE_LABELS = { LAT: 'Latino', ESP: 'Castellano', SUB: 'Subtitulado', JAP: 'Japonés' };

function baseUrl() {
  return String(config.embed69Url || DEFAULT_BASE).replace(/\/+$/, '');
}

/** URL de la ficha: película por IMDb, episodio como `{imdb}-{s}x{e}`. */
function pageUrl(resolved) {
  const imdb = String((resolved && resolved.imdbId) || '');
  if (!/^tt\d+$/.test(imdb)) return null;
  const base = baseUrl();
  if (resolved.mediaType !== 'movie') {
    const season = Number(resolved.season);
    const episode = Number(resolved.episode);
    if (!(season >= 1 && episode >= 1)) return null;
    return `${base}/f/${imdb}-${season}x${episode}/`;
  }
  return `${base}/f/${imdb}/`;
}

/**
 * Extrae el PoW y la lista `dataLink` del HTML del reproductor.
 * Exportada para pruebas: es el parser que puede romperse si cambian la página.
 */
function parsePlayerPage(html) {
  const text = String(html || '');
  const challenge = /POW_CHALLENGE\s*=\s*'([^']+)'/.exec(text);
  const difficulty = /POW_DIFFICULTY\s*=\s*(\d+)/.exec(text);
  const salt = /POW_SALT\s*=\s*'([^']+)'/.exec(text);

  let items = [];
  const start = text.indexOf('dataLink');
  if (start !== -1) {
    const open = text.indexOf('[', start);
    if (open !== -1) {
      // Se recorre con contador de corchetes: el JSON lleva objetos anidados y
      // una expresión regular se cortaría en el primer `]`.
      let depth = 0;
      for (let i = open; i < text.length; i++) {
        const ch = text[i];
        if (ch === '[') depth++;
        else if (ch === ']') {
          depth--;
          if (depth === 0) {
            try {
              items = JSON.parse(text.slice(open, i + 1));
            } catch (_) {
              items = [];
            }
            break;
          }
        }
      }
    }
  }

  return {
    pow: challenge && difficulty && salt
      ? { challenge: challenge[1], difficulty: Number(difficulty[1]), salt: salt[1] }
      : null,
    items: Array.isArray(items) ? items : [],
  };
}

async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Bytes(input) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)));
}

/**
 * Resuelve el PoW y devuelve la clave AES (32 bytes).
 * Se guarda en caché por challenge: es lo caro.
 */
async function solvePow(pow) {
  if (!pow) return null;
  const key = `embed69:pow:${pow.challenge}:${pow.difficulty}:${pow.salt}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const target = '0'.repeat(pow.difficulty);
  let found = -1;
  for (let i = 0; i < MAX_POW_ITERATIONS; i++) {
    if ((await sha256Hex(`${pow.challenge}${i}`)).startsWith(target)) {
      found = i;
      break;
    }
  }
  if (found < 0) return null;
  const aesKey = await sha256Bytes(`${pow.challenge}${found}${pow.salt}`);
  cache.set(key, aesKey, SOLVED_TTL_SECONDS);
  return aesKey;
}

function base64ToBytes(text) {
  const clean = String(text || '').replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** AES-CBC con IV de 16 bytes al inicio; PKCS#7 lo quita `subtle`. */
async function decryptAes(encryptedB64, aesKey) {
  if (!aesKey) return null;
  try {
    const raw = base64ToBytes(encryptedB64);
    if (raw.length <= 16) return null;
    const iv = raw.slice(0, 16);
    const data = raw.slice(16);
    const cryptoKey = await crypto.subtle.importKey('raw', aesKey, { name: 'AES-CBC' }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey, data);
    return new TextDecoder().decode(plain);
  } catch (_) {
    return null;
  }
}

/** Formato `a.<base64 de {"link":"…"}>.c`. */
function decodeDottedLink(link) {
  const parts = String(link || '').split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const json = new TextDecoder().decode(base64ToBytes(parts[1]));
    const found = /"link"\s*:\s*"([^"]+)"/.exec(json);
    return found ? found[1] : null;
  } catch (_) {
    return null;
  }
}

/**
 * `dataLink` → lista de servidores con URL resuelta.
 * Exportada para pruebas: aquí está toda la lógica delicada.
 */
async function resolveEmbeds(parsed) {
  const aesKey = await solvePow(parsed.pow);
  const servers = [];
  const seen = new Set();
  for (const item of parsed.items) {
    const language = String((item && item.video_language) || '').toUpperCase();
    const label = LANGUAGE_LABELS[language] || '';
    for (const embed of (item && item.sortedEmbeds) || []) {
      const server = String((embed && embed.servername) || '');
      const link = String((embed && embed.link) || '');
      if (!link || /^download$/i.test(server)) continue;
      let url = null;
      if (link.split('.').length === 3) url = decodeDottedLink(link);
      if (!url) url = await decryptAes(link, aesKey);
      if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url);
      servers.push({ url, server, language, label });
      if (servers.length >= MAX_LINKS_PER_TITLE) break;
    }
    if (servers.length >= MAX_LINKS_PER_TITLE) break;
  }
  return servers;
}

/**
 * Buscador para `/stream/:type/:id`. No busca por texto: Embed69 indexa por
 * IMDb, así que el id es la consulta. Devuelve hits con `url` (stream directo).
 */
async function searchEmbed69(_query, resolved, queryTitle, timeoutMs = config.streamProviderTimeoutMs) {
  if (config.embed69Pow === 'off') return { skipped: 'desactivado por EMBED69_POW=off' };
  if (queryTitle && resolved && queryTitle !== resolved.title) {
    return { skipped: 'ya buscado con el título principal' };
  }
  if (!resolved || !resolved.imdbId) return { skipped: 'sin IMDb id' };
  const url = pageUrl(resolved);
  if (!url) return { skipped: 'sin temporada/episodio' };

  const cacheKey = `embed69:servers:${url}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return { hits: cached, query: `embed69 ${resolved.imdbId}` };

  const html = await fetchText(url, { timeoutMs, headers: HEADERS });
  const parsed = parsePlayerPage(html);
  if (!parsed.items.length) return { hits: [], query: `embed69 ${resolved.imdbId}` };

  const servers = await resolveEmbeds(parsed);
  const hits = servers.map((entry) => ({
    provider: 'embed69',
    title: [resolved.title, entry.label].filter(Boolean).join(' '),
    url: entry.url,
    audioLabel: entry.label || 'Latino',
    server: entry.server,
    seeders: 0,
    peers: 0,
    size: 0,
    relevant: true,
  }));
  // Corto: los enlaces de estos hosts caducan y el PoW cambia.
  cache.set(cacheKey, hits, 1800);
  return { hits, query: `embed69 ${resolved.imdbId}` };
}

module.exports = {
  searchEmbed69,
  parsePlayerPage,
  resolveEmbeds,
  decodeDottedLink,
  pageUrl,
  solvePow,
  sha256Hex,
  MAX_POW_ITERATIONS,
  POW_TTL_SECONDS,
};
