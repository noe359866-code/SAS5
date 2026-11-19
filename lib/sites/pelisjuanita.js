'use strict';

/**
 * pelisjuanita.org — SPA «vidapi» (tema `popr`) con API REST propia.
 *
 * Estructura medida el 19-11-2026 con `scripts/pelisjuanita-probe{,2,3}.mjs`:
 *
 *   búsqueda   `GET /api/rest/v1/search?q=<título>` →
 *              `{items:[{kind, slug, title, year, tmdb_id, catalog_item_id,
 *              url}], pagination, q}`. `kind` es `movie`, `serie` o `anime`
 *              (anime y serie comparten las rutas `/serie|anime/<slug>` con
 *              `temporada-N/episodio-M`).
 *   ficha      `GET /api/rest/v1/content/<movie|serie>/<slug>`: solo
 *              metadatos (`item`, `cast`, `related`…), **sin servidores**.
 *   episodios  `GET /api/rest/v1/episode-seasons?item_id=<catalog_item_id>` →
 *              `seasons[]`, y
 *              `GET /api/rest/v1/episodes?item_id=<…>&season=<N>` →
 *              `episodes[]` con `playable` y `player_url`.
 *   reproductor `https://videoapp.mov/e/movie/<tmdb_id>` y
 *              `/e/tv/<tmdb_id>/<temporada>/<episodio>` (es el `player_url` de
 *              cada episodio). Publica un único `<iframe id="frame">` de
 *              `vimeos.net/embed-….html?cf=<JWT>`.
 *   visor      El embed de Vimeos trae el HLS firmado (`master.m3u8?t=…&e=…`)
 *              y declara la versión en `"subDub"`: `sub` (subtitulada) o
 *              `lat`/`dub` (doblada). Además publica los `.vtt` en
 *              `default_subs`.
 *
 * Ventaja: el título sale de la API del propio sitio (con `tmdb_id` y año), así
 * que no hay que adivinar slugs ni resolver el visor por ID de TMDB a ciegas.
 *
 * Límite conocido: el audio lo declara `subDub`; si el visor no lo trae, el
 * medio se descarta en lugar de anunciar un idioma sin pruebas.
 */

const config = require('../config');
const { providerHttp, isNotFound } = require('../providerHttp');
const { UA } = require('../extractors');
const { titleScore, catalogYear } = require('../providerTitles');
const { allowedVideoUrl, extractFromEmbedHtml, vimeosMedia } = require('../vimeos');

const BASE = 'https://pelisjuanita.org';
const PLAYER = 'https://videoapp.mov';
const HEADERS = { 'User-Agent': UA, Accept: 'application/json,text/html;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const MAX_JSON = 1024 * 1024;
const MAX_HTML = 1024 * 1024;

const SERIES_KINDS = new Set(['serie', 'series', 'anime', 'tv']);
const AUDIO_LABELS = { sub: 'Subtitulado', subtitulado: 'Subtitulado', subs: 'Subtitulado', lat: 'Latino', latino: 'Latino', dub: 'Latino', doblado: 'Latino', cas: 'Castellano', castellano: 'Castellano' };

const kindOf = (value) => String(value || '').toLowerCase().trim();

/** Etiqueta de audio de la versión que declara el visor (`subDub`). */
function audioOf(value) {
  return AUDIO_LABELS[kindOf(value)] || '';
}

/** `{items:[…]}` → candidatos con el tipo ya normalizado. */
function candidatesOf(payload) {
  const items = payload?.items || payload?.data?.items;
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    url: item.url || null,
    title: String(item.title || '').trim(),
    year: catalogYear(item),
    kind: SERIES_KINDS.has(kindOf(item.kind)) ? 'series' : 'movie',
    tmdbId: Number(item.tmdb_id) || null,
    itemId: Number(item.catalog_item_id) || null,
    slug: item.slug || null,
  })).filter((item) => item.title && (item.tmdbId || item.itemId));
}

/** Elige la ficha: mismo tipo, mejor título y, a igualdad, el año más cercano. */
function pick(candidates, resolved) {
  if (!Array.isArray(candidates)) return null;
  const wanted = [resolved?.title, resolved?.altTitle].map((value) => String(value || '').trim()).filter(Boolean);
  if (!wanted.length) return null;
  const kind = resolved.mediaType === 'movie' ? 'movie' : 'series';
  const year = Number(resolved.year) || null;
  let best = null;
  for (const item of candidates) {
    if (item.kind !== kind) continue;
    const score = titleScore([item.title], wanted);
    if (score === 0) continue;
    const distance = year && item.year ? Math.abs(item.year - year) : 99;
    // Un título exacto pasa siempre; uno parcial necesita además el año.
    if (score < 2 && distance > 1) continue;
    const rank = score * 100 - distance;
    if (!best || rank > best.rank) best = { item, rank };
  }
  // Dos obras distintas pueden llamarse igual: si el año no cuadra, no se elige.
  if (best && year && best.item.year && Math.abs(best.item.year - year) > 1) return null;
  return best?.item || null;
}

/** URL del reproductor de una película, tal como la enlaza la propia ficha. */
function playerUrlOf(candidate) {
  const id = Number(candidate?.tmdbId);
  return Number.isSafeInteger(id) && id > 0 ? `${PLAYER}/e/movie/${id}` : null;
}

/** Episodio pedido dentro de `episodes[]`, solo si el sitio lo da por reproducible. */
function episodeOf(episodes, resolved) {
  const list = Array.isArray(episodes) ? episodes : [];
  const season = Number(resolved?.season);
  const episode = Number(resolved?.episode);
  if (!(season > 0 && episode > 0)) return null;
  const found = list.find((item) => Number(item.season) === season && Number(item.episode) === episode);
  if (!found || found.playable === false) return null;
  const url = typeof found.player_url === 'string' ? found.player_url : '';
  return /^https:\/\/videoapp\.(?:mov|zip)\/e\//.test(url) ? { url, title: found.title || null } : null;
}

/**
 * Temporada pedida dentro de `seasons[]`.
 *
 * Aquí cada temporada viene numerada, así que no se sustituye la pedida por la
 * única que publique el sitio: si no está, no hay episodio.
 */
function seasonOf(payload, resolved) {
  const list = Array.isArray(payload?.seasons) ? payload.seasons : [];
  const season = Number(resolved?.season);
  if (!(season > 0) || !list.length) return null;
  return list.find((item) => Number(item.season) === season) || null;
}

/** `<iframe id="frame">` del reproductor: solo el embed de Vimeos. */
function frameOf(html) {
  const text = String(html || '');
  const match = /<iframe\b[^>]*\bid\s*=\s*["']frame["'][^>]*>/i.exec(text)
    || /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']*vimeos[^"']*)["']/i.exec(text);
  if (!match) return null;
  const src = (match[1] || (/\bsrc\s*=\s*["']([^"']+)["']/i.exec(match[0]) || [])[1] || '').replace(/&amp;/g, '&');
  return src && allowedVideoUrl(src) ? src : null;
}

/** `subDub` del embed de Vimeos («sub», «lat»…), sin inventar idiomas. */
function subDubOf(html) {
  const match = /["']?subDub["']?\s*:\s*["']([a-z]{2,12})["']/i.exec(String(html || ''));
  return match ? match[1] : '';
}

/**
 * Subtítulos del embed. Este visor los publica como `default_subs` con
 * `{code, lang, url}` (no con `file`/`label` como otros), así que se leen
 * aparte y se etiqueta el idioma por su nombre.
 */
function subtitlesOfEmbed(html) {
  const out = [];
  const re = /\{[^{}]*?"(?:url|file)"\s*:\s*"(https?:[^"]+\.vtt[^"]*)"[^{}]*?\}/gi;
  let match;
  while ((match = re.exec(String(html || ''))) !== null) {
    if (!allowedVideoUrl(match[1])) continue;
    const block = match[0];
    const label = (/"lang"\s*:\s*"([^"]+)"/i.exec(block) || /"label"\s*:\s*"([^"]+)"/i.exec(block) || [])[1] || '';
    const code = /span/i.test(label) ? 'es' : /ingl|engl/i.test(label) ? 'en' : 'und';
    if (!out.some((entry) => entry.url === match[1])) out.push({ url: match[1], lang: code, title: label || 'Subtítulos' });
  }
  return out;
}

/** Medio del embed: HLS firmado + subtítulos y la versión declarada. */
function mediaOfEmbed(html) {
  const { hls, subtitles } = extractFromEmbedHtml(html);
  const all = subtitles.length ? subtitles.filter((entry) => allowedVideoUrl(entry.url)) : subtitlesOfEmbed(html);
  for (const master of hls.slice(0, 2)) {
    const media = vimeosMedia(master);
    if (media) return { ...media, subtitles: all };
  }
  return null;
}

const unwrap = (payload) => payload?.data ?? payload;

async function searchPelisJuanita(_query, resolved, queryTitle, timeoutMs = config.streamProviderTimeoutMs) {
  if (!resolved) return { skipped: 'identity-required' };
  if (queryTitle && queryTitle !== resolved.title) return { skipped: 'alternative-already-checked' };
  const series = resolved.mediaType !== 'movie';
  if (series && !(Number(resolved.season) > 0 && Number(resolved.episode) > 0)) return { skipped: 'episode-required' };
  const titles = [resolved.title, resolved.altTitle].map((value) => String(value || '').trim()).filter(Boolean);
  if (!titles.length) return { skipped: 'identity-required' };
  const http = providerHttp(timeoutMs, 8);

  // 1) Buscador del sitio. El API corta en 24 resultados por página, así que
  //    un título corto («Spider-Man») puede dejar la ficha buena en la segunda.
  let chosen = null;
  for (const title of titles.slice(0, 2)) {
    for (const page of [1, 2]) {
      const url = `${BASE}/api/rest/v1/search?q=${encodeURIComponent(title)}&page=${page}`;
      let text;
      try {
        text = await http.text(url, { headers: { ...HEADERS, Accept: 'application/json' }, maxBytes: MAX_JSON });
      } catch (err) {
        if (isNotFound(err, url)) continue;
        throw err;
      }
      let payload = null;
      try { payload = JSON.parse(text); } catch { payload = null; }
      chosen = pick(candidatesOf(payload), resolved);
      if (chosen) break;
      if (!payload?.pagination?.has_next) break;
    }
    if (chosen) break;
  }
  if (!chosen) return { hits: [], reason: 'no-match' };

  // 2) Reproductor: película por TMDB; serie, confirmando temporada y episodio.
  let playerUrl = null;
  if (!series) {
    playerUrl = playerUrlOf(chosen);
    if (!playerUrl) return { hits: [], reason: 'no-tmdb-id' };
  } else {
    if (!chosen.itemId) return { hits: [], reason: 'no-identity' };
    const seasonsUrl = `${BASE}/api/rest/v1/episode-seasons?item_id=${chosen.itemId}`;
    let seasonsText;
    try {
      seasonsText = await http.text(seasonsUrl, { headers: { ...HEADERS, Accept: 'application/json' }, maxBytes: MAX_JSON });
    } catch (err) {
      if (isNotFound(err, seasonsUrl)) return { hits: [], reason: 'no-season' };
      throw err;
    }
    let seasons = null;
    try { seasons = JSON.parse(seasonsText); } catch { seasons = null; }
    if (!seasonOf(unwrap(seasons), resolved)) return { hits: [], reason: 'no-season' };
    const episodesUrl = `${BASE}/api/rest/v1/episodes?item_id=${chosen.itemId}&season=${Number(resolved.season)}&limit=30&page=1`;
    let episodesText;
    try {
      episodesText = await http.text(episodesUrl, { headers: { ...HEADERS, Accept: 'application/json' }, maxBytes: MAX_JSON });
    } catch (err) {
      if (isNotFound(err, episodesUrl)) return { hits: [], reason: 'no-episode' };
      throw err;
    }
    let episodes = null;
    try { episodes = JSON.parse(episodesText); } catch { episodes = null; }
    const body = unwrap(episodes) || {};
    const episode = episodeOf(body.episodes, resolved);
    if (!episode) return { hits: [], reason: 'no-episode' };
    playerUrl = episode.url;
  }

  // 3) Página del reproductor → iframe de Vimeos.
  //
  // `videoapp.mov` solo monta el iframe si la petición viene del sitio que lo
  // incrusta: sin `Referer` devuelve una página sin reproductor (medido el
  // 19-11-2026: la sonda, que sí lo enviaba, veía el `iframe#frame`).
  let page;
  try {
    page = await http.text(playerUrl, { headers: { ...HEADERS, Accept: 'text/html', Referer: `${BASE}/` }, maxBytes: MAX_HTML });
  } catch (err) {
    if (isNotFound(err, playerUrl)) return { hits: [], reason: 'no-players' };
    throw err;
  }
  const frame = frameOf(page);
  if (!frame) return { hits: [], reason: 'no-players' };

  // 4) Embed: HLS firmado, subtítulos y versión declarada por el visor.
  let embed;
  try {
    embed = await http.text(frame, { headers: { ...HEADERS, Accept: 'text/html', Referer: `${PLAYER}/` }, maxBytes: MAX_HTML });
  } catch (err) {
    if (isNotFound(err, frame)) return { hits: [], reason: 'no-extractable-embed' };
    throw err;
  }
  const audio = audioOf(subDubOf(embed));
  const media = mediaOfEmbed(embed);
  if (!media) return { hits: [], reason: 'no-extractable-embed' };
  // Sin versión declarada no se publica: los subtítulos no prueban el audio.
  if (!audio) return { hits: [], reason: 'audio-unverified', notes: { subDub: subDubOf(embed) || null } };

  const ep = series ? ` S${String(resolved.season).padStart(2, '0')}E${String(resolved.episode).padStart(2, '0')}` : '';
  return {
    hits: [{
      provider: 'pelisjuanita',
      title: `${resolved.title}${ep} PelisJuanita`,
      url: media.master,
      quality: 'HLS',
      resolution: media.resolution || null,
      audioLabel: audio,
      ...(media.expiresAt ? { expiresAt: media.expiresAt } : {}),
      subtitles: media.subtitles || [],
    }],
  };
}

module.exports = {
  BASE, PLAYER, audioOf, candidatesOf, pick, playerUrlOf, episodeOf, seasonOf, frameOf, subDubOf, subtitlesOfEmbed, mediaOfEmbed,
  searchPelisJuanita,
};
