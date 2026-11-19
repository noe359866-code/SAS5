'use strict';

/**
 * cuevanas3.pro — SPA React sobre una API JSON propia (no se ejecuta JS).
 *
 * Estructura medida el 19-11-2026 con `scripts/sites-probe.mjs` y
 * `scripts/cuevanas3-api-probe.mjs`:
 *
 *   El HTML solo es el armazón de la SPA: la portada publica `window.siteConfig`
 *   con dos bases de datos y la lista de permisos:
 *     fastApi: https://cuevanas3.pro/wp-api/v1     (Laravel, la que usa la SPA)
 *     apiUrl:  https://cuevanas3.pro/wp-json/wpf/v1
 *
 *   GET  {fastApi}/search?q=&page=&postType=any&postsPerPage=18
 *        -> { data: { posts: [{_id, title:"Título (año)", slug, type, release_date}], pagination } }
 *   GET  {fastApi}/player?postId=<_id>
 *        -> { data: { embeds: [{server, provider, language, quality, url, season, episode}],
 *                     downloads: [{…magnet…}] } }
 *        (el parámetro es `postId` en camelCase; `id`/`post_id` responden «Invalid ID»)
 *   GET  {fastApi}/single/episodes/list?_id=<serie>&season=<n>&page=&postsPerPage=
 *        -> { data: { posts: [{_id, season_number, episode_number, …}], seasons } }
 *
 *   El `url` de cada embed es un salto intermedio en otro host
 *   (`https://cuevana3.gs/player.php?…`) cuyo cuerpo es un `<iframe>` al visor
 *   real. En las fichas revisadas el visor fue Vimeos (`vimeos.net/embed-…`),
 *   que el addon ya resuelve sin abrir el manifiesto.
 *
 * Ventaja sobre los scrapeos HTML: la API da ya el idioma («Latino - Inglés»),
 * la calidad y, en series, la temporada y el episodio del embed, así que la
 * identidad se comprueba con esos campos en vez de adivinar slugs.
 */

const config = require('../config');
const cache = require('../cache');
const { providerHttp } = require('../providerHttp');
const { extractEmbed, extractorFor, UA } = require('../extractors');
const { resolveVimeosEmbed, vimeosCacheSeconds, allowedVideoUrl } = require('../vimeos');
const { catalogYear, titleScore, titleQueries } = require('../providerTitles');

const BASE = 'https://cuevanas3.pro';
const FAST = `${BASE}/wp-api/v1`;
const HEADERS = { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'es-MX,es;q=0.9' };
const VIMEOS_HOSTS = ['vimeos.net', 'vimeos.com', 'vimeos.zip', 'vimeos.xyz', 'vimeos.site', 'vimeos.org'];

const hostOf = (raw) => { try { return new URL(raw).hostname; } catch { return ''; } };

/**
 * La API guarda el título con entidades HTML («Deadpool &amp; Wolverine
 * (2024)»): sin decodificarlas, `normalizeText` convierte el `&amp;` en la
 * palabra «amp» y la ficha nunca coincide con el título pedido.
 */
function decodeEntities(value) {
  return String(value || '')
    .replace(/&#(\d{1,5});/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&(?:amp|#0*38);/gi, '&')
    .replace(/&quot;|&#0*34;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');
}
const isVimeos = (raw) => VIMEOS_HOSTS.some((host) => hostOf(raw) === host || hostOf(raw).endsWith(`.${host}`));

/**
 * Etiqueta de audio del embed. La API mezcla idiomas en un solo campo
 * («Latino - Inglés», «Latino/Inglés»): se declara el doblaje español, que es
 * lo que pide el addon, y se deja el texto original si no hay ninguno.
 */
function audioOf(embed) {
  const text = String(embed?.languageLabel || embed?.language || embed?.lang || '').trim();
  const plain = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/castellano|\bespana\b|\besp\b/.test(plain)) return 'Castellano';
  if (/latino|latam/.test(plain)) return 'Latino';
  if (/subtitulad|\bsub\b/.test(plain) && !/audio|dual|doblado/.test(plain)) return 'Subtitulado';
  return text;
}

/** Tipos de la API que sirven a cada clase de obra del addon. */
function typesFor(mediaType) {
  return mediaType === 'movie' ? ['movies'] : ['tvshows', 'animes'];
}

/**
 * Ficha de la API que corresponde a la obra pedida.
 *
 * La `title` trae el año pegado («Spider-Man: Un nuevo día (2026)») y
 * `release_date` da el año exacto: se exigen coincidencia de título y, si se
 * conoce, de año; una serie de animación no vale para un documental.
 */
function pickPost(posts, resolved) {
  if (!Array.isArray(posts)) return null;
  const allowed = typesFor(resolved.mediaType);
  const wanted = [resolved.title, resolved.altTitle].map((value) => String(value || '').trim()).filter(Boolean);
  const year = catalogYear({ year: resolved.year });
  let best = null;
  for (const post of posts) {
    if (!post || !post._id || !allowed.includes(post.type)) continue;
    const score = titleScore([decodeEntities(post.title), decodeEntities(post.name)], wanted);
    if (score === 0) continue;
    const postYear = catalogYear(post);
    if (year && postYear && postYear !== year) continue;
    const rank = score * 10 + (year && postYear === year ? 5 : 0) + (post.type === allowed[0] ? 1 : 0);
    if (!best || rank > best.rank) best = { post, rank };
  }
  return best?.post || null;
}

/** Episodio pedido dentro del listado de la temporada. */
function pickEpisode(posts, resolved) {
  if (!Array.isArray(posts)) return null;
  for (const post of posts) {
    if (!post || !post._id) continue;
    if (Number(post.season_number) !== Number(resolved.season)) continue;
    if (Number(post.episode_number) !== Number(resolved.episode)) continue;
    return post;
  }
  return null;
}

async function fetchJson(http, url, referer) {
  const data = await http.json(url, { headers: { ...HEADERS, ...(referer ? { Referer: referer } : {}) }, maxBytes: 512 * 1024 });
  return data?.data ?? null;
}

/**
 * Embeds de una ficha. En series el propio embed declara temporada y episodio:
 * los que no coinciden con lo pedido son de otro episodio y se descartan.
 */
async function embedsOf(http, post, resolved) {
  const data = await fetchJson(http, `${FAST}/player?postId=${encodeURIComponent(post._id)}`, `${BASE}/`);
  const list = Array.isArray(data?.embeds) ? data.embeds : [];
  return list.filter((embed) => {
    if (!embed || typeof embed.url !== 'string' || !/^https?:\/\//.test(embed.url)) return false;
    if (resolved.mediaType === 'movie') return true;
    const season = Number(embed.season);
    const episode = Number(embed.episode);
    if (!season && !episode) return true;
    return season === Number(resolved.season) && episode === Number(resolved.episode);
  });
}

/**
 * Visores dentro del salto intermedio (`player.php`), sin ejecutar JS: el
 * cuerpo es un `<iframe src>` al visor. Si el enlace ya apunta a un visor
 * conocido se devuelve tal cual para no gastar una petición.
 */
function frameUrls(html, page) {
  const out = [];
  const push = (raw) => {
    if (!raw) return;
    let url;
    try { url = new URL(String(raw).replace(/&amp;/g, '&'), page).href; } catch { return; }
    if (!/^https?:\/\//.test(url)) return;
    if (!out.includes(url)) out.push(url);
  };
  for (const m of String(html || '').matchAll(/<iframe[^<>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) push(m[1]);
  if (!out.length) {
    for (const m of String(html || '').matchAll(/["'](https?:\\?\/\\?\/[^"'\\]+)["']/gi)) {
      const raw = m[1].replace(/\\\//g, '/');
      if (/\/e(mbed)?[-/]|player\.php|\/v\/|\.html$/.test(raw)) push(raw);
    }
  }
  return out;
}

const REDIRECTS = [301, 302, 303, 307, 308];

/**
 * Texto de una página siguiendo **a mano** los 301 del propio sitio.
 *
 * `providerHttp` pide con `redirect: 'manual'` y solo sigue el 301 canónico de
 * misma ruta y origen. El salto intermedio rompe esa regla a propósito: el
 * enlace se publica en `cuevana3.gs` y responde `301` a
 * `https://cuevanas3.pro/player.php?t=…`, es decir, al dominio del propio
 * sitio. Se siguen hasta dos saltos y solo si el destino es del sitio.
 */
async function fetchPage(http, url, { referer, maxBytes = 256 * 1024 } = {}) {
  let target = url;
  for (let hop = 0; hop < 3; hop += 1) {
    try {
      const headers = { ...HEADERS, Accept: 'text/html,*/*' };
      if (referer) headers.Referer = referer;
      return await http.text(target, { headers, maxBytes });
    } catch (err) {
      if (!REDIRECTS.includes(err?.status) || !err.location) throw err;
      let next;
      try { next = new URL(err.location, target); } catch { throw err; }
      if (!/^https?:$/.test(next.protocol)) throw err;
      target = next.href;
    }
  }
  return '';
}

async function framesOf(http, embedUrl, referer) {
  if (isVimeos(embedUrl) || extractorFor(embedUrl)) return [embedUrl];
  const html = await fetchPage(http, embedUrl, { referer }).catch(() => '');
  return frameUrls(html, embedUrl);
}

/** Un visor → medios publicados (HLS de Vimeos o lo que extraiga el extractor). */
async function mediaOf(http, url, referer, timeoutMs) {
  if (isVimeos(url)) {
    const cacheKey = `cuevanas3:vimeos:${url}`;
    const cached = cache.get(cacheKey);
    const media = cached ?? await resolveVimeosEmbed(url, referer, http);
    if (media && !cached) {
      const ttl = vimeosCacheSeconds(media.expiresAt);
      if (ttl > 0) cache.set(cacheKey, media, ttl);
    }
    if (!media) return null;
    return { sources: [{ url: media.master, kind: 'hls' }], subtitles: media.subtitles, expiresAt: media.expiresAt };
  }
  const kind = extractorFor(url);
  if (!kind || kind === 'opaque') return { opaque: true };
  const extracted = await extractEmbed(url, { timeoutMs, referer });
  if (!extracted.ok) return { unsupported: true };
  return { sources: extracted.sources, subtitles: extracted.subtitles, audioLabel: extracted.audioLabel };
}

async function searchCuevanas3(_query, resolved, queryTitle, timeoutMs = config.streamProviderTimeoutMs) {
  if (!resolved) return { skipped: 'identity-required' };
  if (queryTitle && queryTitle !== resolved.title) return { skipped: 'alternative-already-checked' };
  const series = resolved.mediaType !== 'movie';
  if (series && !(resolved.season > 0 && resolved.episode > 0)) return { skipped: 'episode-required' };
  const titles = [resolved.title, resolved.altTitle].map((value) => String(value || '').trim()).filter(Boolean);
  if (!titles.length) return { skipped: 'identity-required' };
  const http = providerHttp(timeoutMs, 10);

  // El buscador es un `LIKE` sobre el título almacenado, y ese título lleva
  // entidades y signos que rompen la frase («Deadpool &amp; Wolverine» no se
  // encuentra ni con «Deadpool & Wolverine» ni con «Deadpool Wolverine»). Se
  // prueba la consulta literal, sin signos y, como último recurso, la primera
  // palabra, que es la que sí devuelve la ficha para luego compararla entera.
  const firstWord = titles[0].split(/[\s:&,/]+/).find((word) => word.length >= 3) || '';
  const queries = [...new Set([
    ...base,
    ...base.map((title) => title.replace(/&/g, ' ').replace(/\s+/g, ' ').trim()),
    firstWord,
  ])].filter(Boolean);

  let post = null;
  for (const query of queries.slice(0, 4)) {
    const params = new URLSearchParams({ q: query, page: '1', postType: 'any', postsPerPage: '18' });
    const data = await fetchJson(http, `${FAST}/search?${params}`, `${BASE}/`).catch(() => null);
    post = pickPost(data?.posts, resolved);
    if (post) break;
  }
  if (!post) return { hits: [], reason: 'no-match' };

  if (series) {
    const params = new URLSearchParams({ _id: String(post._id), season: String(resolved.season), page: '1', postsPerPage: '50' });
    const data = await fetchJson(http, `${FAST}/single/episodes/list?${params}`, `${BASE}/`).catch(() => null);
    const episode = pickEpisode(data?.posts, resolved);
    if (!episode) return { hits: [], reason: 'no-episode' };
    post = episode;
  }

  const embeds = await embedsOf(http, post, resolved).catch(() => []);
  if (!embeds.length) return { hits: [], reason: 'no-players' };

  const hits = [];
  const notes = { opaque: 0, extracted: 0, unsupported: 0 };
  for (const embed of embeds.slice(0, 3)) {
    let frames = [];
    try { frames = await framesOf(http, embed.url, `${BASE}/`); }
    catch { notes.unsupported += 1; continue; }
    if (!frames.length) { notes.unsupported += 1; continue; }
    const label = audioOf(embed) || '';
    for (const frame of frames.slice(0, 3)) {
      const media = await mediaOf(http, frame, `${BASE}/`, timeoutMs).catch(() => null);
      if (!media) { notes.unsupported += 1; continue; }
      if (media.opaque) { notes.opaque += 1; continue; }
      if (media.unsupported) { notes.unsupported += 1; continue; }
      notes.extracted += 1;
      const audio = label || media.audioLabel || '';
      for (const source of media.sources) {
        const direct = allowedVideoUrl(source.url) || /^https:\/\//.test(source.url);
        if (!direct) continue;
        hits.push({
          provider: 'cuevanas3',
          title: `${resolved.title}${series ? ` S${resolved.season}E${resolved.episode}` : ''} Cuevana3`,
          url: source.url,
          quality: source.kind === 'mp4' ? 'MP4' : 'HLS',
          resolution: null,
          audioLabel: audio,
          ...(media.subtitles?.length ? { subtitles: media.subtitles } : {}),
          ...(media.expiresAt ? { expiresAt: media.expiresAt } : {}),
        });
      }
      if (hits.length >= 3) break;
    }
    if (hits.length >= 3) break;
  }
  if (hits.length) return { hits };
  return { hits: [], reason: 'no-extractable-embed', notes };
}

module.exports = {
  BASE, FAST, decodeEntities, audioOf, typesFor, pickPost, pickEpisode, embedsOf, frameUrls, framesOf, fetchPage, mediaOf, searchCuevanas3,
};
