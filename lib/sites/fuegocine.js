'use strict';

/**
 * fuegocine.com — CMS propio (no WordPress), catálogo de películas y series.
 *
 * Estructura medida el 19-11-2026 con `scripts/sites-probe.mjs` y
 * `scripts/fuegocine-probe.mjs`:
 *
 *   buscador   `GET /search_elastic?s=<texto>` → HTML con secciones
 *              `<h3>Películas</h3>` / `<h3>Series</h3>` y tarjetas
 *              `.single-video > a[href]` + `.video-item-content` (título).
 *              Los slugs llevan acentos («spider-man-un-nuevo-día»), así que
 *              no se deducen: se busca siempre.
 *   ficha      `/movies/details/<slug>/<id>` y `/shows/details/<slug>/<id>`.
 *              Solo trae el tráiler (FWDEVPlayer con `videoSource` en base64,
 *              que apunta a YouTube).
 *   reproducir `/movies/watch/<slug>/<id>` y, en series, cada episodio en
 *              `/shows/<slug>/<SSxEE-titulo>/<id>` (los enlaces salen de
 *              `/shows/<slug>/seasons/temporada-<N>/<id>`).
 *              La página publica tres `<iframe>`: videro.my (Cloudflare),
 *              abyssplayer (JS) y **unlimplay.com**, que es el único que
 *              entrega el medio.
 *   visor      `unlimplay.com/f/embed/movie/<tmdb>` publica en el HTML
 *              `const EMBEDS = { "latino": { direct: …, … }, "subtitulado": { … } }`
 *              con un HLS por idioma en `cps.php?t=…&e=<caducidad>&s=…&x=.m3u8`.
 *
 * Ventaja: el idioma del audio viene declarado por el propio visor («latino»,
 * «subtitulado»), así que no hay que adivinarlo del título ni de la ficha.
 */

const { load } = require('cheerio');
const config = require('../config');
const { providerHttp, isNotFound } = require('../providerHttp');
const { UA } = require('../extractors');
const { titleScore } = require('../providerTitles');

const BASE = 'https://fuegocine.com';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const MAX_HTML = 2 * 1024 * 1024;
const UNLIMPLAY = /(?:^|\.)unlimplay\.com$/i;
// El visor solo publica el medio en su propio `cps.php` firmado.
const CPS = /^\/cps\.php$/;

const AUDIO_LABELS = {
  latino: 'Latino', lat: 'Latino', latam: 'Latino',
  castellano: 'Castellano', espanol: 'Castellano', 'español': 'Castellano', esp: 'Castellano',
  subtitulado: 'Subtitulado', sub: 'Subtitulado', subs: 'Subtitulado',
  ingles: 'Inglés', english: 'Inglés',
};

const hostOf = (raw) => { try { return new URL(raw).hostname; } catch { return ''; } };

function audioOf(group) {
  const key = String(group || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  return AUDIO_LABELS[key] || '';
}

/**
 * Candidatos del buscador. El sitio separa «Películas» y «Series» en bloques
 * `<h3>`; el tipo del bloque manda sobre el de la URL.
 */
function candidatesOf(html) {
  const $ = load(html);
  const out = [];
  // El buscador separa «Películas» y «Series» en bloques con su `<h3>`; se
  // recorre el documento en orden y cada tarjeta hereda el tipo de la última
  // sección vista (el `<h3>` está en un div propio, no en el de las tarjetas).
  let kind = null;
  for (const el of $('h3, .single-video').toArray()) {
    const node = $(el);
    if (node.is('h3')) {
      const section = node.text().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      kind = /serie|show/.test(section) ? 'series' : /pelicul|movie/.test(section) ? 'movie' : null;
      continue;
    }
    if (!kind) continue;
    const link = node.find('a[href]').first();
    let url;
    try { url = new URL(link.attr('href') || '', BASE); } catch { continue; }
    if (url.origin !== BASE) continue;
    if (!/^\/(?:movies|shows)\/details\/[^/]+\/\d+\/?$/.test(url.pathname)) continue;
    const title = node.find('.video-item-content').first().text().replace(/\s+/g, ' ').trim()
      || node.find('img').attr('alt') || link.attr('title') || '';
    if (!title) continue;
    if (!out.some((item) => item.url === url.href)) out.push({ url: url.href, title, kind });
  }
  return out;
}

/** Ficha del buscador que corresponde a la obra pedida. */
function pick(candidates, resolved) {
  if (!Array.isArray(candidates)) return null;
  const wanted = [resolved.title, resolved.altTitle].map((value) => String(value || '').trim()).filter(Boolean);
  const kind = resolved.mediaType === 'movie' ? 'movie' : 'series';
  let best = null;
  for (const item of candidates) {
    if (item.kind !== kind) continue;
    const score = titleScore([item.title], wanted);
    if (score === 0) continue;
    if (!best || score > best.score) best = { item, score };
    if (score === 2) break;
  }
  return best?.item || null;
}

/** URL de reproducción de una película a partir de su ficha. */
function watchUrlOf(detailUrl) {
  return String(detailUrl || '').replace('/movies/details/', '/movies/watch/');
}

/** Temporadas enlazadas desde la ficha de una serie: número → URL. */
function seasonsOf(html, detailUrl) {
  const $ = load(html);
  const out = new Map();
  for (const el of $('a[href*="/seasons/"]').toArray()) {
    const href = $(el).attr('href') || '';
    let url;
    try { url = new URL(href, detailUrl); } catch { continue; }
    if (url.origin !== BASE) continue;
    const match = /\/seasons\/[^/]*?(\d+)\/?$/.exec(url.pathname) || /temporada-(\d+)/i.exec(url.pathname);
    if (!match) continue;
    const season = Number(match[1]);
    if (!out.has(season)) out.set(season, url.href);
  }
  return out;
}

/** Episodios de una temporada: el enlace trae «SSxEE» en el slug. */
function episodesOf(html, seasonUrl) {
  const $ = load(html);
  const out = [];
  for (const el of $('a[href]').toArray()) {
    const href = $(el).attr('href') || '';
    let url;
    try { url = new URL(href, seasonUrl); } catch { continue; }
    if (url.origin !== BASE) continue;
    const match = /\/(\d{1,2})x(\d{1,3})(?:-|\/)/i.exec(url.pathname);
    if (!match) continue;
    const code = `${Number(match[1])}x${Number(match[2])}`;
    if (out.some((item) => item.code === code)) continue;
    out.push({ code, season: Number(match[1]), episode: Number(match[2]), url: url.href });
  }
  return out;
}

function pickEpisode(list, resolved) {
  return (Array.isArray(list) ? list : []).find((item) => item.episode === Number(resolved.episode)
    && item.season === Number(resolved.season)) || null;
}

/**
 * Visores publicados en la página de reproducción, sin publicidad.
 *
 * Se leen con una expresión regular y no con el DOM: los episodios escriben
 * `<iframe src=…>` **sin cerrar** (visto en `/shows/visionquest/01x01-…/49`),
 * y `iframe` es un elemento de texto crudo, así que el primer `<iframe>` se
 * tragaría a los demás y solo se vería el servidor opaco de turno.
 */
function framesOf(html, page) {
  const text = String(html || '');
  const out = [];
  const re = /<iframe\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    const raw = match[1].replace(/&amp;/g, '&').trim();
    if (!raw || /^\s*javascript:/i.test(raw)) continue;
    let url;
    try { url = new URL(raw, page); } catch { continue; }
    if (!/^https?:$/.test(url.protocol)) continue;
    if (!out.includes(url.href)) out.push(url.href);
    if (out.length >= 5) break;
  }
  return out;
}

/** `const EMBEDS = {…}` del visor: objeto JSON con un HLS por idioma. */
function embedsOf(html) {
  const text = String(html || '');
  const start = text.search(/EMBEDS\s*=\s*\{/);
  if (start < 0) return null;
  const open = text.indexOf('{', start);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(text.slice(open, index + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/**
 * HLS del visor: solo su `cps.php` firmado con `x=.m3u8`. La firma trae la
 * caducidad en `e` (segundos), que se publica como `expiresAt` sin abrir el
 * manifiesto.
 */
function cpsHls(raw) {
  let url;
  try { url = new URL(String(raw || '')); } catch { return null; }
  if (!/^https:$/.test(url.protocol)) return null;
  if (!UNLIMPLAY.test(url.hostname)) return null;
  if (!CPS.test(url.pathname)) return null;
  if (url.searchParams.get('x') !== '.m3u8') return null;
  if (!url.searchParams.get('t')) return null;
  const issued = Number(url.searchParams.get('e'));
  const expiresAt = issued > 1e9 ? issued * 1000 : null;
  if (expiresAt && expiresAt <= Date.now() + 30_000) return null;
  return { url: url.href, expiresAt };
}

/** Un grupo de idioma del visor → el mejor HLS disponible. */
function hlsFromGroup(group) {
  if (!group || typeof group !== 'object') return null;
  // «direct» es el manifiesto del propio visor; el resto de claves cps.php son
  // los mismos HLS con otro nombre de servidor.
  const direct = cpsHls(group.direct);
  if (direct) return direct;
  for (const value of Object.values(group)) {
    const media = cpsHls(value);
    if (media) return media;
  }
  return null;
}

async function fetchText(http, url, referer) {
  return http.text(url, { headers: { ...HEADERS, ...(referer ? { Referer: referer } : {}) }, maxBytes: MAX_HTML });
}

async function searchFuegoCine(_query, resolved, queryTitle, timeoutMs = config.streamProviderTimeoutMs) {
  if (!resolved) return { skipped: 'identity-required' };
  if (queryTitle && queryTitle !== resolved.title) return { skipped: 'alternative-already-checked' };
  const series = resolved.mediaType !== 'movie';
  if (series && !(resolved.season > 0 && resolved.episode > 0)) return { skipped: 'episode-required' };
  const titles = [resolved.title, resolved.altTitle].map((value) => String(value || '').trim()).filter(Boolean);
  if (!titles.length) return { skipped: 'identity-required' };
  const http = providerHttp(timeoutMs, 8);

  // 1) Buscador del sitio: es la única vía fiable (los slugs llevan acentos).
  let chosen = null;
  for (const title of titles.slice(0, 2)) {
    let html;
    const url = `${BASE}/search_elastic?s=${encodeURIComponent(title)}`;
    try { html = await fetchText(http, url, `${BASE}/`); }
    catch (err) { if (isNotFound(err, url)) continue; throw err; }
    const found = candidatesOf(html);
    chosen = pick(found, resolved);
    if (chosen) break;
  }
  if (!chosen) return { hits: [], reason: 'no-match' };

  // 2) Página de reproducción: película directa; serie, por temporada y episodio.
  let watchUrl = '';
  if (!series) {
    watchUrl = watchUrlOf(chosen.url);
  } else {
    let detail;
    try { detail = await fetchText(http, chosen.url); }
    catch (err) { if (isNotFound(err, chosen.url)) return { hits: [], reason: 'no-match' }; throw err; }
    const seasons = seasonsOf(detail, chosen.url);
    const seasonUrl = seasons.get(Number(resolved.season)) || (seasons.size === 1 ? [...seasons.values()][0] : null);
    if (!seasonUrl) return { hits: [], reason: 'no-season' };
    let seasonHtml;
    try { seasonHtml = await fetchText(http, seasonUrl, chosen.url); }
    catch (err) { if (isNotFound(err, seasonUrl)) return { hits: [], reason: 'no-season' }; throw err; }
    const episode = pickEpisode(episodesOf(seasonHtml, seasonUrl), resolved);
    if (!episode) return { hits: [], reason: 'no-episode' };
    watchUrl = episode.url;
  }

  let page;
  try { page = await fetchText(http, watchUrl); }
  catch (err) { if (isNotFound(err, watchUrl)) return { hits: [], reason: 'no-players' }; throw err; }

  const frames = framesOf(page, watchUrl);
  if (!frames.length) return { hits: [], reason: 'no-players' };

  // 3) Solo el visor de unlimplay publica el medio en el HTML; los demás se
  // cuentan como opacos sin abrirlos.
  const targets = frames.filter((url) => UNLIMPLAY.test(hostOf(url)));
  const notes = { opaque: frames.length - targets.length, extracted: 0, unsupported: 0 };
  const hits = [];
  for (const frame of targets.slice(0, 2)) {
    let html;
    try { html = await fetchText(http, frame, watchUrl); }
    catch { notes.unsupported += 1; continue; }
    const groups = embedsOf(html);
    if (!groups) { notes.unsupported += 1; continue; }
    for (const [group, value] of Object.entries(groups)) {
      const audio = audioOf(group);
      // El inglés no se publica: el addon solo admite español y subtitulado.
      if (!audio || audio === 'Inglés') continue;
      const media = hlsFromGroup(value);
      if (!media) continue;
      notes.extracted += 1;
      hits.push({
        provider: 'fuegocine',
        title: `${resolved.title}${series ? ` S${resolved.season}E${resolved.episode}` : ''} FuegoCine`,
        url: media.url,
        quality: 'HLS',
        resolution: null,
        audioLabel: audio,
        ...(media.expiresAt ? { expiresAt: media.expiresAt } : {}),
      });
      if (hits.length >= 3) break;
    }
    if (hits.length >= 3) break;
  }
  if (hits.length) return { hits };
  return { hits: [], reason: 'no-extractable-embed', notes };
}

module.exports = {
  BASE, candidatesOf, pick, watchUrlOf, seasonsOf, episodesOf, pickEpisode, framesOf, embedsOf, cpsHls, hlsFromGroup, audioOf, searchFuegoCine,
};
