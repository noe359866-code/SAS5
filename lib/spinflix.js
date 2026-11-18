'use strict';
const { resolutionToken } = require('./resolution');

/** SpinFlix: búsqueda y detalle en LaMovieBot; el HLS se verifica en Vimeos. */
const config = require('./config');
const cache = require('./cache');
const { providerHttp } = require('./providerHttp');
const { hitMatches } = require('./streamChoices');
const { allowedVideoUrl, proxiedHls, inspectVimeos, resolveVimeosEmbed, vimeosCacheSeconds,
  unpackPacked, extractFromEmbedHtml } = require('./vimeos');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; CatalogosPlus/1.2; +https://github.com/noe359866-code/SAS5)',
  Accept: 'application/json, text/html, */*',
};
const MAX_CANDIDATES = 3; // detalles a verificar por búsqueda
const MAX_EMBEDS = 3;     // servidores por título (suele haber 1)
const SLUG_TTL_SECONDS = 24 * 3600;

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

async function apiJson(path, http) {
  const base = String(config.spinflixUrl || 'https://lamoviebot.tvymas.workers.dev').replace(/\/+$/, '');
  // El buscador indexa SOLO títulos en español (ver searchSpinFlix).
  return http.json(`${base}${path}`, { headers: HEADERS });
}

/** Embeds de vídeo de una ficha (película o episodio ya resuelto). */
function embedsOf(detail) {
  const list = detail && detail.embeds && Array.isArray(detail.embeds.video) ? detail.embeds.video : [];
  return list.filter((e) => e && (e.link || e.stream_url)).slice(0, MAX_EMBEDS);
}

function masterCandidates(data) {
  const failed = new Set((Array.isArray(data?.videos?.hls_status) ? data.videos.hls_status : [])
    .filter((entry) => /bloquead|forbidden|error|expir|\b[45]\d{2}\b/i.test(entry?.status || ''))
    .map((entry) => entry.url));
  const qualities = Array.isArray(data?.qualities) ? data.qualities : [];
  const all = [...qualities.map((quality) => quality?.url), ...(Array.isArray(data?.videos?.hls) ? data.videos.hls : [])];
  return [...new Set(all.filter((url) => allowedVideoUrl(url)))].sort((a, b) => Number(failed.has(a)) - Number(failed.has(b)));
}

async function hitFromEmbed(embed, resolved, http, playbackOptions) {
  const link = String(embed.link || '');
  if (!allowedVideoUrl(link)) return null;
  const cacheKey = `spinflix:hls:${playbackOptions.spinflixPlayback ? 'proxy:' : ''}${link}`;
  const cached = cache.get(cacheKey);
  const media = cached ?? await mediaFromEmbed(link, http, playbackOptions);
  if (!media) return null;
  if (!cached) {
    const ttl = vimeosCacheSeconds(media.expiresAt);
    cache.set(cacheKey, media, playbackOptions.spinflixPlayback && !media.transport ? Math.min(ttl, 30) : ttl);
  }
  return spinFlixHit(media, embed, resolved);
}

async function mediaFromEmbed(link, http, playbackOptions) {
  const tried = new Set();
  const data = await apiJson(`/streamurl?url=${encodeURIComponent(link)}`, http).catch(() => null);
  let media = null;
  for (const master of masterCandidates(data).slice(0, 2)) {
    tried.add(master);
    const verified = await inspectVimeos(master, http, playbackOptions).catch((err) => {
      if (err.timeout) throw err;
      return null;
    });
    if (verified?.verification === 'manifest-ok') { media = verified; break; }
    media ||= verified;
  }
  if (!media) media = await resolveVimeosEmbed(link, 'https://spinoff.link/', http, tried, playbackOptions).catch((err) => {
    if (err.timeout) throw err;
    return null;
  });
  return media;
}

function spinFlixHit(media, embed, resolved) {
  const { master, resolution, subtitles = [], expiresAt, verification } = media;
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
    quality: 'HLS',
    expiresAt,
    verification,
    resolution,
    title,
    audioLabel: audioLabel(embed.language),
    url: media.transport ? master : proxiedHls(master),
    directUrl: master,
    ...(media.transport ? { transport: media.transport } : {}),
    size: 0,
    relevant: true,
    ...(subtitles.length ? { subtitles } : {}),
  };
  return hit;
}

async function hitsFromDetail(detail, kind, slug, resolved, http, playbackOptions) {
  let target = detail;
  if (kind !== 'pelicula') {
    if (!(resolved.season >= 1 && resolved.episode >= 1)) return [];
    target = await apiJson(`/${kind}/${slug}/${resolved.season}/${resolved.episode}`, http);
    const expected = [resolved.season, resolved.episode];
    const numbers = [target?.season_number ?? target?.season, target?.episode_number ?? target?.episode];
    if (numbers.some((value, i) => /^\d+$/.test(value || '') && Number(value) !== expected[i])) return [];
  }
  const embeds = embedsOf(target).filter((embed) => hitMatches({ audioLabel: audioLabel(embed.language) }, null));
  const hits = [];
  for (const embed of embeds) {
    try {
      const hit = await hitFromEmbed(embed, resolved, http, playbackOptions);
      if (hit && hitMatches(hit, null)) hits.push(hit);
    } catch (err) {
      if (!hits.length) throw err;
      break; // conservar los resultados que ya superaron la validación
    }
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
async function searchSpinFlix(_query, resolved, queryTitle, timeoutMs = config.streamProviderTimeoutMs, playbackOptions = {}) {
  if (queryTitle && resolved && queryTitle !== resolved.title) {
    return { skipped: 'ya buscado con el título principal' };
  }
  if (resolved.mediaType !== 'movie' && !(resolved.season >= 1 && resolved.episode >= 1)) {
    return { skipped: 'sin temporada/episodio que buscar' };
  }
  // El buscador de la fuente es EXCLUSIVAMENTE en español: «interstellar»
  // devuelve 0 resultados y «interestelar» devuelve la ficha. Buscar solo con
  // el título en inglés dejaba el proveedor prácticamente muerto.
  const http = providerHttp(timeoutMs);
  const spanish = [];
  const titles = searchTitles(resolved, queryTitle, spanish);
  const queries = searchQueries(resolved, queryTitle, spanish);

  let failure = null;
  let responded = false;
  for (const q of queries) {
    let items = [];
    try {
      const data = await apiJson(`/search?q=${encodeURIComponent(q)}&page=1`, http);
      items = (data && (data.results || data.items)) || [];
      responded = true;
    } catch (err) {
      // Un tropiezo puntual con un título no debe tumbar el resto de intentos
      // (antes el primer error abortaba la búsqueda entera).
      if (err.timeout || err.challenge || err.status === 429) throw err;
      failure = failure || err;
      continue;
    }
    const candidates = pickCandidate(items, resolved, titles);
    for (const { kind, slug } of candidates) {
      const detailKey = `spinflix:detail:${kind}:${slug}`;
      let detail = cache.get(detailKey);
      if (detail === undefined) {
        detail = await apiJson(`/${kind}/${slug}`, http).catch((err) => {
          if (err.timeout || err.challenge || err.status === 429) throw err;
          return null;
        });
        if (detail) cache.set(detailKey, detail, SLUG_TTL_SECONDS);
      }
      if (!verifyDetail(detail, kind, resolved, titles)) continue;
      const hits = await hitsFromDetail(detail, kind, slug, resolved, http, playbackOptions);
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
