'use strict';

/**
 * SpinFlix (https://spinoff.link/pelis/): scraper ligero sobre su API JSON
 * pública (lamoviebot, espejo estructurado de lamovie.org).
 *
 * Flujo (3–4 subrequests en frío, 1 con la caché caliente):
 *   /search?q=… → /pelicula|serie|anime/{slug} (verificación)
 *   → /serie|anime/{slug}/{s}/{e} si es episodio
 *   → /streamurl?url={embed} → master .m3u8 de vimeos.net
 *
 * Los .m3u8 de vimeos.net exigen Referer y su token caduca a las 12 h
 * (`e=43200`, `i=0.0`: no ligado a IP), así que el stream se sirve a través
 * del proxy HLS de la propia web (reescribe playlists y añade el Referer)
 * y, por si acaso, con `proxyHeaders` equivalentes. La caché de HLS dura
 * 2 h: muy por debajo de la caducidad del token.
 *
 * Si /streamurl falla se recurre al embed de vimeos.net directamente:
 * su reproductor JW viene empaquetado con el desempaquetador de
 * Dean Edwards `eval(function(p,a,c,k,e,d)…)`, del que salen el .m3u8
 * y las pistas .vtt de subtítulos.
 */

const config = require('./config');
const cache = require('./cache');
const { fetchJson, fetchText } = require('./http');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; CatalogosPlus/1.2; +https://github.com/noe359866-code/SAS5)',
  Accept: 'application/json, text/html, */*',
};
const MAX_CANDIDATES = 3; // detalles a verificar por búsqueda
const MAX_EMBEDS = 3;     // servidores por título (suele haber 1)
const SLUG_TTL_SECONDS = 24 * 3600;
const HLS_TTL_SECONDS = 2 * 3600;

function normalizeText(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Ruta de la API según el tipo: película, serie o anime. */
function candidateKind(item) {
  const url = String((item && item.url) || '');
  if (/\/pelicula\//.test(url) || (item && item.type === 'movies')) return 'pelicula';
  if (/\/anime\//.test(url) || (item && item.type === 'animes')) return 'anime';
  if (/\/serie\//.test(url) || (item && item.type === 'tvshows')) return 'serie';
  return null;
}

function slugOf(item) {
  if (item && item.slug) return String(item.slug);
  const m = String((item && item.url) || '').match(/\/(?:pelicula|serie|anime)\/([^/?#]+)/);
  return m ? m[1] : null;
}

/** Títulos con los que una ficha puede presentarse (inglés, original, español…). */
function knownTitles(resolved, extra) {
  const out = [];
  for (const t of [resolved && resolved.title, resolved && resolved.altTitle, extra]) {
    const clean = String(t || '').trim();
    if (clean && !out.some((seen) => normalizeText(seen) === normalizeText(clean))) out.push(clean);
  }
  return out;
}

function titleMatches(item, titles) {
  const names = [item && item.title, item && item.original_title, item && item.tmdb_title]
    .map(normalizeText).filter(Boolean);
  return titles.some((t) => names.includes(normalizeText(t)));
}

function yearMatches(itemYear, resolved) {
  const y = String(itemYear || '').slice(0, 4);
  if (!y || !resolved || !resolved.year) return true;
  return y === String(resolved.year).slice(0, 4);
}

/**
 * Elige la ficha de /search que corresponde a la obra. El `tmdb_id` de
 * /search a veces viene mal asignado por el auto-match de la fuente, así
 * que nunca descarta por sí solo: manda título + año y el tipo de medio.
 */
function pickCandidate(items, resolved, titles) {
  const wantKinds = resolved.mediaType === 'movie' ? ['pelicula'] : ['serie', 'anime'];
  const scored = [];
  for (const item of Array.isArray(items) ? items : []) {
    const kind = candidateKind(item);
    if (!kind || !wantKinds.includes(kind)) continue;
    const slug = slugOf(item);
    if (!slug) continue;
    let score = 0;
    if (resolved.tmdbId && Number(item.tmdb_id) === Number(resolved.tmdbId)) score += 4;
    if (titleMatches(item, titles)) score += 4;
    if (yearMatches(item.year || item.release_date, resolved)) score += 2;
    else score -= 3;
    if (score > 0) scored.push({ item, kind, slug, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_CANDIDATES);
}

/** La ficha de detalle sí trae ids fiables: ahí la verificación es estricta. */
function verifyDetail(detail, kind, resolved, titles) {
  if (!detail || typeof detail !== 'object') return false;
  if (resolved.imdbId && detail.imdb_id) return detail.imdb_id === resolved.imdbId;
  if (resolved.tmdbId && detail.tmdb_id) return Number(detail.tmdb_id) === Number(resolved.tmdbId);
  return titleMatches(detail, titles) && yearMatches(detail.year || detail.release_date, resolved);
}

/** «Dual 1080p», «Full HD», «HD 720p»… → token de resolución para el título. */
function resolutionToken(...texts) {
  const text = texts.filter(Boolean).join(' ');
  const m = text.match(/(\d{3,4})\s*p/i);
  if (m) return `${m[1]}p`;
  if (/full\s*hd|1080/i.test(text)) return '1080p';
  if (/\bhd\b|720/i.test(text)) return '720p';
  if (/4k|uhd|2160/i.test(text)) return '2160p';
  if (/sd|dvd/i.test(text)) return '480p';
  return '';
}

/** Etiqueta de audio que entienden los filtros y las insignias. */
function languageToken(language) {
  const lang = normalizeText(language);
  if (!lang) return '';
  const latino = /\blatino\b/.test(lang);
  const castellano = /castellano|espanol de espana/.test(lang);
  const dual = /dual|ingles/.test(lang);
  if (latino && dual) return 'Dual Latino';
  if (latino) return 'Latino';
  if (castellano && dual) return 'Dual Castellano';
  if (castellano) return 'Castellano';
  if (/subtitul/.test(lang)) return 'Subtitulado';
  return String(language).trim();
}

function proxiedHls(masterUrl) {
  if (!masterUrl) return null;
  const base = String(config.spinflixProxyUrl || 'https://spinoff.link/pelis/proxy.php').replace(/\/+$/, '');
  if (/^https?:\/\//i.test(base) && base.includes('?')) return `${base}${encodeURIComponent(masterUrl)}`;
  return `${base}?url=${encodeURIComponent(masterUrl)}`;
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
  const hls = [...new Set([...text.matchAll(/https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*/g)].map((x) => x[0]))];
  const subtitles = [];
  for (const m of text.matchAll(/\{[^{}]*"file"\s*:\s*"(https?:\/\/[^\"]+\.vtt[^\"]*)"[^{}]*\}/g)) {
    const label = (m[0].match(/"label"\s*:\s*"([^"]*)"/) || [])[1] || 'Subtítulos';
    subtitles.push({ url: m[1], lang: /span|esp/i.test(label) ? 'es' : 'und', title: label });
  }
  return { hls, subtitles };
}

async function apiJson(path, timeoutMs) {
  const base = String(config.spinflixUrl || 'https://lamoviebot.tvymas.workers.dev').replace(/\/+$/, '');
  return fetchJson(`${base}${path}`, { timeoutMs, headers: HEADERS });
}

/** Embeds de vídeo de una ficha (película o episodio ya resuelto). */
function embedsOf(detail) {
  const list = detail && detail.embeds && Array.isArray(detail.embeds.video) ? detail.embeds.video : [];
  return list.filter((e) => e && (e.link || e.stream_url)).slice(0, MAX_EMBEDS);
}

/** Un embed → hit reproducible (con caché de 2 h, token válido 12 h). */
async function hitFromEmbed(embed, resolved, detail, timeoutMs) {
  const link = String(embed.link || '');
  const cacheKey = `spinflix:hls:${link || embed.stream_url}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  let master = null;
  let subtitles = [];
  try {
    const data = await apiJson(`/streamurl?url=${encodeURIComponent(link)}`, timeoutMs);
    const qualities = Array.isArray(data && data.qualities) ? data.qualities : [];
    const best = qualities.find((q) => q && q.url) || null;
    master = (best && best.url) || (data && data.videos && data.videos.hls && data.videos.hls[0]) || null;
  } catch (_) { /* se prueba el embed directamente */ }

  if (!master && link) {
    try {
      const html = await fetchText(link, { timeoutMs, headers: { ...HEADERS, Referer: 'https://spinoff.link/' } });
      const extracted = extractFromEmbedHtml(html);
      master = extracted.hls[0] || null;
      subtitles = extracted.subtitles;
    } catch (_) { /* sin embed no hay stream */ }
  }
  if (!master || !/^https:\/\//i.test(master)) return null;

  const resolution = resolutionToken(embed.quality, detail && detail.quality);
  const lang = languageToken(embed.language);
  const ep = resolved.mediaType !== 'movie' && resolved.season != null && resolved.episode != null
    ? ` S${String(resolved.season).padStart(2, '0')}E${String(resolved.episode).padStart(2, '0')}`
    : '';
  const title = [
    `${resolved.title}${resolved.year ? ` ${resolved.year}` : ''}${ep}`,
    resolution, 'WEB-DL', lang, 'SpinFlix',
  ].filter(Boolean).join(' ');
  const hit = {
    provider: 'spinflix',
    title,
    url: proxiedHls(master),
    directUrl: master,
    seeders: 0,
    peers: 0,
    size: 0,
    relevant: true,
    ...(subtitles.length ? { subtitles } : {}),
  };
  cache.set(cacheKey, hit, HLS_TTL_SECONDS);
  return hit;
}

async function hitsFromDetail(detail, kind, slug, resolved, timeoutMs) {
  let target = detail;
  if (kind !== 'pelicula') {
    if (!(resolved.season >= 1 && resolved.episode >= 1)) return [];
    target = await apiJson(`/${kind}/${slugOf(detail) || slug}/${resolved.season}/${resolved.episode}`, timeoutMs);
  }
  const embeds = embedsOf(target);
  const hits = [];
  for (const embed of embeds) {
    const hit = await hitFromEmbed(embed, resolved, detail, timeoutMs);
    if (hit) hits.push(hit);
  }
  return hits;
}

/**
 * Buscador SpinFlix. Como el resto de proveedores hispanos, busca por su
 * cuenta (la ficha puede estar titulada en español): la pasada con el
 * título original no aporta nada y se salta.
 */
async function searchSpinFlix(_query, resolved, queryTitle, timeoutMs = config.streamProviderTimeoutMs) {
  if (queryTitle && resolved && queryTitle !== resolved.title) {
    return { skipped: 'ya buscado con el título principal' };
  }
  if (resolved.mediaType !== 'movie' && !(resolved.season >= 1 && resolved.episode >= 1)) {
    return { skipped: 'sin temporada/episodio que buscar' };
  }
  const titles = knownTitles(resolved, queryTitle);
  const queries = [...new Set([queryTitle, resolved.title, resolved.altTitle].filter(Boolean))];

  for (const q of queries) {
    const data = await apiJson(`/search?q=${encodeURIComponent(q)}&page=1`, timeoutMs);
    const items = (data && (data.results || data.items)) || [];
    const candidates = pickCandidate(items, resolved, titles);
    for (const { kind, slug } of candidates) {
      const detailKey = `spinflix:detail:${kind}:${slug}`;
      let detail = cache.get(detailKey);
      if (detail === undefined) {
        detail = await apiJson(`/${kind}/${slug}`, timeoutMs).catch(() => null);
        if (detail) cache.set(detailKey, detail, SLUG_TTL_SECONDS);
      }
      if (!verifyDetail(detail, kind, resolved, titles)) continue;
      const hits = await hitsFromDetail(detail, kind, slug, resolved, timeoutMs);
      if (hits.length) return { hits, query: `spinflix="${q}"` };
    }
  }
  return { hits: [], query: `spinflix="${queries[0] || ''}"` };
}

module.exports = {
  searchSpinFlix,
  // exportados para tests offline
  pickCandidate,
  verifyDetail,
  resolutionToken,
  languageToken,
  unpackPacked,
  extractFromEmbedHtml,
  proxiedHls,
};
