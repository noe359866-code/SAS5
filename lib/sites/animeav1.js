'use strict';

/**
 * animeav1.com — anime **con doblaje latino y subtitulado**.
 *
 * Es el sitio que faltaba: hasta hoy el addon solo tenía anime subtitulado
 * (AnimeFLV). AnimeAV1 publica las dos versiones y las declara por separado.
 *
 * Estructura medida el 20-11-2026 (`scripts/animeav1-probe.mjs`,
 * `.probe/animeav1.md`):
 *
 *   buscador  `/catalogo?search=<término>` → `<article>` con la portada en el
 *             `alt` y el título en `h3.line-clamp-2`, enlazando `/media/<slug>`.
 *             Filtra de verdad (5 fichas para «solo leveling»).
 *   ficha     `/media/<slug>` → `<h1>` con el nombre y los episodios enlazados
 *             como `/media/<slug>/<n>` (13 en la ficha medida).
 *   episodio  `/media/<slug>/<n>` → JS embebido con
 *             `embeds:{SUB:[{server,url}…],DUB:[{server,url}…]}` y, aparte,
 *             `downloads`. El audio viene dado por el grupo, no por el visor.
 *   visor     el propio es `player.zilla-networks.com/play/<hex>`: una SPA de
 *             1006 bytes que **no** trae el manifiesto en el HTML, pero el
 *             mismo host lo sirve en `/m3u8/<hex>` (200,
 *             `application/x-mpegURL`, ~14 KB). Es el mismo host y la misma
 *             forma que usa AnimeFLV, así que basta reescribir la ruta.
 *
 * Los demás visores (`uns.bio`, Voe, Byse, MP4Upload) siguen el criterio del
 * addon: Byse y los extractores conocidos se intentan, los opacos se cuentan.
 */

const { load } = require('cheerio');
const config = require('../config');
const { providerHttp, isNotFound } = require('../providerHttp');
const { extractEmbed, extractorFor, UA } = require('../extractors');
const { isDirectMedia } = require('../directMedia');
const { titleScore, titleQueries } = require('../providerTitles');
const { slugify, seasonOf, titleVariants } = require('./animeflv');

const BASE = 'https://animeav1.com';
const PLAYER = 'https://player.zilla-networks.com';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const MAX_HTML = 2 * 1024 * 1024;
/** El visor propio sirve un manifiesto real de ~14 KB (lista maestra con todas
 *  las variantes): con un tope de 2 KB la lectura se rechazaba y el visor se
 *  descartaba en vivo. Se lee entero para comprobar `#EXTM3U`. */
const MAX_MANIFEST = 256 * 1024;

/** Manifiesto servido sin extensión. */
const HLS_BY_PATH = /^https:\/\/player\.zilla-networks\.com\/m3u8\/[a-f0-9]{16,}$/i;
/** Visor propio: `/play/<hex>` → su manifiesto es `/m3u8/<hex>`. */
const OWN_PLAYER = /^https?:\/\/player\.zilla-networks\.com\/play\/([a-f0-9]{16,})/i;
// Voe, MP4Upload y UPNShare montan el vídeo con JS o exigen peticiones que el
// addon no hace; se cuentan como opacos sin abrirlos.
const OPAQUE_EXTRA = /(?:^|\.)(?:mp4upload|uns\.bio|upnshare)\./i;

const hostOf = (raw) => { try { return new URL(raw).hostname; } catch { return ''; } };

/** URL del manifiesto a partir del visor propio, si la forma coincide. */
function manifestOf(url) {
  const match = OWN_PLAYER.exec(String(url || ''));
  return match ? `${PLAYER}/m3u8/${match[1]}` : '';
}

/** Etiqueta de audio según el grupo de `embeds`. */
function audioOf(group, server) {
  const text = `${group || ''} ${server?.server || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/dub|latino|castellano/.test(text)) return /castellano/.test(text) ? 'Castellano' : 'Latino';
  return 'Subtitulado';
}

/** «Ver <título> Online Sub Español en HD - AnimeAV1» → `<título>`. */
function titleFromDoc(value) {
  return String(value || '')
    .replace(/^Ver\s+/i, '')
    .replace(/\s+Online\b[\s\S]*$/i, '')
    .replace(/\s+Episodio\s+\d+[\s\S]*$/i, '')
    .replace(/\s+Sub\s+Espa(?:ñ|n)ol[\s\S]*$/i, '')
    .trim();
}

/**
 * Fichas del buscador. El `h3` lleva el nombre limpio y la portada el `alt`
 * («Portada de …»), que sirve de segunda opinión cuando el `h3` se recorta.
 */
function listingMatches(html, resolved, limit = 3) {
  const $ = load(html);
  const wanted = titleVariants(resolved);
  const found = [];
  for (const el of $('article').toArray()) {
    const node = $(el);
    const href = node.find('a[href*="/media/"]').first().attr('href') || '';
    let url;
    try { url = new URL(href, BASE).href; } catch { continue; }
    if (!/\/media\/[^/]+\/?$/.test(new URL(url).pathname)) continue;
    const heading = node.find('h3').first().text().replace(/\s+/g, ' ').trim();
    const alt = (node.find('img').attr('alt') || '').replace(/^Portada de\s+/i, '').trim();
    if (titleScore([heading, alt], wanted) === 0) continue;
    if (!found.includes(url)) found.push(url);
    if (found.length >= limit) break;
  }
  return found;
}

/**
 * Identidad de la ficha: el `h1` (o, en su defecto, el `<title>`) contra los
 * nombres aceptados, incluidos los sufijos de temporada del sitio.
 */
function detailTitle(html) {
  const $ = load(html);
  const heading = $('h1').first().text().replace(/\s+/g, ' ').trim();
  const documentTitle = titleFromDoc($('title').first().text());
  return heading || documentTitle;
}

function matchDetail(html, resolved) {
  const title = detailTitle(html);
  if (!title) return false;
  return titleScore([title], titleVariants(resolved)) === 2;
}

/** Episodios de la ficha: `/media/<slug>/<n>` con el número en la ruta. */
function episodesOf(html, page) {
  const $ = load(html);
  const seen = new Map();
  for (const el of $('a[href*="/media/"]').toArray()) {
    const href = $(el).attr('href') || '';
    let url;
    try { url = new URL(href, page || BASE); } catch { continue; }
    const match = /\/media\/([^/]+)\/(\d+)\/?$/.exec(url.pathname);
    if (!match) continue;
    const number = Number(match[2]);
    if (!seen.has(number)) seen.set(number, { number, url: url.href });
  }
  return [...seen.values()].sort((a, b) => a.number - b.number);
}

function pickEpisode(list, resolved) {
  if (!Array.isArray(list)) return null;
  return list.find((entry) => Number(entry.number) === Number(resolved.episode)) || null;
}

/**
 * Servidores del episodio: los dos grupos de `embeds` están escritos como JS
 * (`SUB:[{server:"HLS",url:"…"}]`). Se leen con una expresión regular sobre la
 * zona del objeto, sin ejecutar nada.
 */
function serversOf(html) {
  const text = String(html || '');
  const start = text.indexOf('embeds:');
  if (start < 0) return [];
  // Después de `embeds` viene `downloads` (Mega, 1Fichier, TransferIt…): son
  // descargas, no visores, y no deben colarse como servidores.
  const downloads = text.indexOf('downloads:', start);
  const end = downloads > start ? downloads : start + 30000;
  const zone = text.slice(start, Math.min(end, start + 30000));
  const out = [];
  for (const group of zone.matchAll(/(SUB|DUB)\s*:\s*\[([\s\S]*?)\]/g)) {
    const key = group[1];
    for (const entry of group[2].matchAll(/\{[^{}]*\}/g)) {
      const body = entry[0];
      const url = (body.match(/url\s*:\s*"((?:[^"\\]|\\.)+)"/) || [])[1];
      const server = (body.match(/server\s*:\s*"((?:[^"\\]|\\.)+)"/) || [])[1] || '';
      if (!url) continue;
      const clean = url.replace(/\\(.)/g, '$1');
      if (!/^https?:\/\//.test(clean)) continue;
      if (out.some((item) => item.url === clean)) continue;
      out.push({ url: clean, server, group: key, audio: audioOf(key, { server }) });
    }
  }
  return out;
}

/** Un servidor → medio publicado. */
async function mediaOf(http, server, referer, timeoutMs) {
  const manifest = manifestOf(server.url);
  if (manifest) {
    // El visor propio no publica el manifiesto en el HTML: se comprueba que la
    // ruta derivada responda HLS antes de anunciarla.
    try {
      const head = await http.text(manifest, { headers: { ...HEADERS, Referer: referer, Accept: '*/*' }, maxBytes: MAX_MANIFEST });
      if (/^\s*#EXTM3U/.test(String(head || ''))) return { sources: [{ url: manifest, kind: 'hls' }] };
    } catch { /* se prueba el siguiente visor */ }
    return { unsupported: true };
  }
  if (HLS_BY_PATH.test(server.url)) return { sources: [{ url: server.url, kind: 'hls' }] };
  if (isDirectMedia(server.url)) return { sources: [{ url: server.url, kind: /\.mp4$/i.test(server.url) ? 'mp4' : 'hls' }] };
  const kind = extractorFor(server.url);
  if (!kind || kind === 'opaque' || OPAQUE_EXTRA.test(hostOf(server.url))) return { opaque: true };
  const extracted = await extractEmbed(server.url, { timeoutMs, referer });
  if (!extracted.ok) return { unsupported: true };
  return { sources: extracted.sources, subtitles: extracted.subtitles };
}

async function fetchText(http, url, referer) {
  return http.text(url, { headers: { ...HEADERS, ...(referer ? { Referer: referer } : {}) }, maxBytes: MAX_HTML });
}

/** Recorre una ficha candidata; `null` si no es la obra pedida. */
/**
 * Temporada que declara el slug: el sitio abre una ficha por temporada
 * (`…-season-2`). Se usa para no confundir la temporada 1 con la 2 cuando el
 * `h1` no la menciona.
 */
function seasonOfSlug(page) {
  try {
    const path = new URL(page).pathname;
    // El sitio usa las dos formas: `-season-2` y `-2nd-season`
    // (`/media/black-clover-2nd-season`). Solo la primera se reconocía y la
    // temporada 2 de Black Clover quedaba en `no-match` (medido el 20-11-2026).
    const ordinal = /-(\d+)(?:st|nd|rd|th)-season/i.exec(path);
    if (ordinal) return Number(ordinal[1]);
    const plain = /-season-?(\d+)/i.exec(path);
    return plain ? Number(plain[1]) : null;
  } catch { return null; }
}

async function hitsFromPage(http, page, resolved, timeoutMs, series, deadline = 0) {
  let html;
  try { html = await fetchText(http, page); }
  catch (err) { if (isNotFound(err, page)) return null; throw err; }
  if (!matchDetail(html, resolved)) return null;

  if (series) {
    const wanted = Number(resolved.season);
    const slugSeason = seasonOfSlug(page);
    if (slugSeason && wanted && slugSeason !== wanted) return null;
    if (!slugSeason && wanted > 1) return null;
  }

  const title = detailTitle(html);
  const declaredSeason = seasonOf(title);
  if (series && declaredSeason) {
    const wanted = Number(resolved.season);
    if (wanted > 1 && declaredSeason !== wanted) return null;
    if (wanted === 1 && declaredSeason !== 1) return null;
  }

  const list = episodesOf(html, page);
  if (!list.length) return { hits: [], reason: 'no-episodes' };
  // Una película se publica como su propio «episodio 1» (`/media/<slug>/1`),
  // sin número que pedir: se usa la única entrada de la ficha.
  let episode = series ? pickEpisode(list, resolved) : list[0];
  if (!episode) {
    // La ficha pinta solo 50 episodios y no pagina (medido: One Piece muestra
    // 1–50), pero el sitio sirve cualquier número con el mismo patrón de URL:
    // `/media/<slug>/1180` responde con sus visores. Se construye la del
    // episodio pedido y la comprobación real es la petición: si no existe, el
    // 404 la descarta como `no-episode`.
    const wanted = Number(resolved.episode);
    if (!Number.isFinite(wanted) || wanted <= 0) return { hits: [], reason: 'no-episode' };
    episode = { number: wanted, url: `${page.replace(/\/+$/, '')}/${wanted}` };
  }

  let episodeHtml;
  try { episodeHtml = await fetchText(http, episode.url, page); }
  catch (err) { if (isNotFound(err, episode.url)) return { hits: [], reason: 'no-episode' }; throw err; }

  const servers = serversOf(episodeHtml);
  if (!servers.length) return { hits: [], reason: 'no-players' };

  // Primero el visor propio (manifiesto directo) y luego los extraíbles.
  const rank = (server) => {
    if (manifestOf(server.url) || HLS_BY_PATH.test(server.url)) return 0;
    const kind = extractorFor(server.url);
    return kind && kind !== 'opaque' && !OPAQUE_EXTRA.test(hostOf(server.url)) ? 1 : 2;
  };
  const ordered = [...servers].sort((a, b) => rank(a) - rank(b) || (a.group === 'DUB' ? -1 : 1)).slice(0, 5);

  const hits = [];
  const notes = { opaque: 0, extracted: 0, unsupported: 0 };
  // El presupuesto del proveedor es por petición: sin un plazo global, dos
  // visores lentos se comen el tiempo del turno (Naruto acabó en `probe-timeout`
  // con 14 s). Con SUB y DUB ya cubiertos no hace falta seguir abriendo.
  const covered = () => new Set(hits.map((hit) => hit.audioLabel)).size >= 2;
  // Si el episodio solo publica un grupo (hay fichas con SUB y nada de DUB), el
  // primer acierto ya da todo lo que la fuente puede ofrecer: seguir abriendo
  // opacos solo alargaba la espera (10,5 s en Ao Ashi y Black Clover).
  const singleGroup = new Set(servers.map((server) => server.group)).size === 1;
  for (const server of ordered) {
    if (deadline && Date.now() > deadline) break;
    const media = await mediaOf(http, server, episode.url, timeoutMs).catch(() => null);
    if (!media) { notes.unsupported += 1; continue; }
    if (media.opaque) { notes.opaque += 1; continue; }
    if (media.unsupported) { notes.unsupported += 1; continue; }
    notes.extracted += 1;
    for (const source of media.sources) {
      if (!/^https:\/\//.test(source.url)) continue;
      hits.push({
        provider: 'animeav1',
        title: `${resolved.title}${series ? ` S${resolved.season}E${resolved.episode}` : ''} AnimeAV1`,
        url: source.url,
        quality: source.kind === 'mp4' ? 'MP4' : 'HLS',
        resolution: null,
        audioLabel: server.audio || 'Subtitulado',
        ...(media.subtitles?.length ? { subtitles: media.subtitles } : {}),
      });
    }
    if (hits.length >= 4 || (hits.length >= 2 && covered())) break;
    if (singleGroup && hits.length) break;
  }
  if (hits.length) return { hits };
  return { hits: [], reason: deadline && Date.now() > deadline ? 'timeout' : 'no-extractable-embed', notes };
}

async function searchAnimeAv1(_query, resolved, queryTitle, timeoutMs = config.streamProviderTimeoutMs) {
  if (!resolved) return { skipped: 'identity-required' };
  if (queryTitle && queryTitle !== resolved.title) return { skipped: 'alternative-already-checked' };
  const series = resolved.mediaType !== 'movie';
  if (series && !(resolved.season > 0 && resolved.episode > 0)) return { skipped: 'episode-required' };
  const titles = [resolved.title, resolved.altTitle].map((value) => String(value || '').trim()).filter(Boolean);
  if (!titles.length) return { skipped: 'identity-required' };
  const http = providerHttp(timeoutMs, 9);
  const deadline = Date.now() + timeoutMs;

  // Buscador del sitio: filtra de verdad, así que basta una consulta por
  // variante del título y una ficha por candidato.
  const queries = [...new Set([...titleQueries(titles), ...titleVariants(resolved)])].filter(Boolean).slice(0, 3);
  for (const query of queries) {
    if (Date.now() > deadline) break;
    let listing = '';
    try { listing = await fetchText(http, `${BASE}/catalogo?search=${encodeURIComponent(query)}`, `${BASE}/`); }
    catch { listing = ''; }
    if (!listing) continue;
    let candidates = listingMatches(listing, resolved, 3);
    // Si el buscador no dio nada, se prueba el slug directo del título.
    if (!candidates.length) candidates = [`${BASE}/media/${slugify(query)}`];
    for (const page of candidates) {
      if (Date.now() > deadline) break;
      const result = await hitsFromPage(http, page, resolved, timeoutMs, series, deadline);
      if (result) return result;
    }
  }
  return { hits: [], reason: 'no-match' };
}

module.exports = {
  BASE, PLAYER, HLS_BY_PATH, manifestOf, audioOf, titleFromDoc, listingMatches, detailTitle, matchDetail,
  seasonOfSlug, episodesOf, pickEpisode, serversOf, mediaOf, hitsFromPage, searchAnimeAv1,
};
