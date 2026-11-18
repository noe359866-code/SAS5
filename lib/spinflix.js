'use strict';
const { resolutionToken } = require('./resolution');

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
 * Verificado (nov-2026): /search es solo en español («interstellar» → 0,
 * «interestelar» → 1); /streamurl responde con el master .m3u8 pero marca el
 * CDN como «bloqueado 403» (falta Referer), así que la URL reproducible es el
 * proxy de su web, que sí devuelve master y variantes. El token dura 12 h.
 *
 * Si /streamurl falla se recurre al embed de vimeos.net directamente:
 * su reproductor JW viene empaquetado con el desempaquetador de
 * Dean Edwards `eval(function(p,a,c,k,e,d)…)`, del que salen el .m3u8
 * y las pistas .vtt de subtítulos.
 */

const config = require('./config');
const { isDirectMedia } = require('./directMedia');
const cache = require('./cache');
const { fetchJson, fetchText } = require('./http');
const { hitMatches } = require('./streamChoices');
const { hostAllowed, allowedHosts } = require('./hlsProxy');
function allowedVideoUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && hostAllowed(url.hostname, allowedHosts());
  } catch { return false; }
}

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
    if (!slug || !/^[a-z0-9_-]+$/i.test(slug)) continue;
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


/**
 * Etiqueta de audio que entienden los filtros y las insignias (texto que va
 * en el título sintético del release: «Latino», «Castellano»…).
 */
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

const AUDIO_LABELS = [
  [/\blatino\b|\blatam\b/, 'Lat'],
  [/castellano|espanol de espana/, 'Castellano'],
  [/\bingles\b|\benglish\b/, 'Inglés'],
  [/\bportugues\b/, 'Portugués'],
  [/\bfrances\b/, 'Francés'],
  [/\bitaliano\b/, 'Italiano'],
  [/\baleman\b/, 'Alemán'],
  [/\bjapones\b/, 'Japonés'],
  [/\bcoreano\b/, 'Coreano'],
  [/\bruso\b/, 'Ruso'],
  [/\bchino\b/, 'Chino'],
];

/**
 * Audio tal y como debe leerlo el usuario: «Lat», «ES», «Inglés» o la
 * combinación que traiga la ficha («Lat + Inglés», «ES + Inglés»…).
 * Un «español» a secas, sin latino ni castellano, se muestra «ES».
 */
function audioLabel(language) {
  const lang = normalizeText(language);
  if (!lang) return '';
  const out = [];
  for (const [pattern, label] of AUDIO_LABELS) {
    if (pattern.test(lang) && !out.includes(label)) out.push(label);
  }
  if (!out.length && /\bespanol\b|\bspanish\b/.test(lang)) out.push('Español');
  if (/subtitul/.test(lang)) out.push('Subtitulado');
  if (!out.length && /\bdual\b|\bmulti/.test(lang)) out.push('Dual');
  return out.join(' + ');
}

/**
 * URL reproducible de un HLS.
 *
 * Por defecto se sirve por el proxy PROPIO del addon (`/hls?u=…&ref=…`):
 *   · el Referer se pone en cada segmento, no solo en la primera playlist;
 *   · si el proxy de la web de origen se cae, el stream sigue funcionando;
 *   · no depende de un tercero para reproducir.
 *
 * Las playlists del CDN se sirven con 200 sin Referer (comprobado), así que
 * el proxy solo cubre el caso de que el CDN endurezca los segmentos.
 * `SPINFLIX_PROXY_URL` permite volver al proxy de la web o a otro.
 */
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

async function apiJson(path, timeoutMs) {
  const base = String(config.spinflixUrl || 'https://lamoviebot.tvymas.workers.dev').replace(/\/+$/, '');
  // El buscador indexa SOLO títulos en español (ver searchSpinFlix).
  return fetchJson(`${base}${path}`, { timeoutMs, headers: HEADERS, redirect: 'manual' });
}

/** Embeds de vídeo de una ficha (película o episodio ya resuelto). */
function embedsOf(detail) {
  const list = detail && detail.embeds && Array.isArray(detail.embeds.video) ? detail.embeds.video : [];
  return list.filter((e) => e && (e.link || e.stream_url)).slice(0, MAX_EMBEDS);
}

/** Un embed → hit reproducible (con caché de 2 h, token válido 12 h). */
async function hitFromEmbed(embed, resolved, detail, timeoutMs) {
  const link = String(embed.link || '');
  if (!allowedVideoUrl(link)) return null;
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

  if ((!allowedVideoUrl(master) || !isDirectMedia(master, 'spinflix', false)) && link) {
    try {
      const html = await fetchText(link, { timeoutMs, redirect: 'manual', headers: { ...HEADERS, Referer: 'https://spinoff.link/' } });
      const extracted = extractFromEmbedHtml(html);
      master = extracted.hls[0] || null;
      subtitles = extracted.subtitles;
    } catch (_) { /* sin embed no hay stream */ }
  }
  if (!allowedVideoUrl(master) || !isDirectMedia(master, 'spinflix', false)) return null;

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
    resolution,
    title,
    audioLabel: audioLabel(embed.language),
    url: proxiedHls(master),
    directUrl: master,
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
    target = await apiJson(`/${kind}/${slug}/${resolved.season}/${resolved.episode}`, timeoutMs);
  }
  const embeds = embedsOf(target).filter((embed) => hitMatches({ audioLabel: audioLabel(embed.language) }, null));
  const hits = [];
  for (const embed of embeds) {
    const hit = await hitFromEmbed(embed, resolved, detail, timeoutMs);
    if (hit && hitMatches(hit, null)) hits.push(hit);
  }
  return hits;
}

/**
 * Títulos con los que se comprueba una ficha encontrada. Incluye los de TMDB
 * en español: la ficha de la fuente está titulada en español («Interestelar»)
 * y si solo comparáramos con el inglés la descartaríamos.
 */
function searchTitles(resolved, queryTitle, spanish) {
  const titles = knownTitles(resolved, queryTitle);
  for (const title of spanish || []) {
    if (!titles.some((seen) => normalizeText(seen) === normalizeText(title))) titles.push(title);
  }
  return titles;
}

/**
 * Consultas al buscador, en orden: primero el título en español de TMDB (el
 * único idioma que indexa la fuente) y después lo que traiga la petición, por
 * si el título de Stremio ya está en español o TMDB no está configurado.
 */
function searchQueries(resolved, queryTitle, spanish) {
  return [...new Set([...(spanish || []), queryTitle, resolved.title, resolved.altTitle].filter(Boolean))];
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
  // El buscador de la fuente es EXCLUSIVAMENTE en español: «interstellar»
  // devuelve 0 resultados y «interestelar» devuelve la ficha. Buscar solo con
  // el título en inglés dejaba el proveedor prácticamente muerto.
  const spanish = [];
  const titles = searchTitles(resolved, queryTitle, spanish);
  const queries = searchQueries(resolved, queryTitle, spanish);

  let failure = null;
  let responded = false;
  for (const q of queries) {
    let items = [];
    try {
      const data = await apiJson(`/search?q=${encodeURIComponent(q)}&page=1`, timeoutMs);
      items = (data && (data.results || data.items)) || [];
      responded = true;
    } catch (err) {
      // Un tropiezo puntual con un título no debe tumbar el resto de intentos
      // (antes el primer error abortaba la búsqueda entera).
      failure = failure || err;
      continue;
    }
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
  // Si NINGUNA consulta obtuvo respuesta, es una caída del proveedor (y se
  // pausa si insiste). Si respondieron vacías, simplemente no tiene la obra.
  if (failure && !responded) throw failure;
  return { hits: [], query: `spinflix="${queries[0] || ''}"` };
}

module.exports = {
  searchSpinFlix,
  proxiedHls,
  searchQueries,
  searchTitles,
  // exportados para tests offline
  pickCandidate,
  verifyDetail,
  resolutionToken,
  languageToken,
  audioLabel,
  unpackPacked,
  extractFromEmbedHtml,
};
