'use strict';

/**
 * otakustv2.com — anime subtitulado (y algunas fichas con audio latino).
 *
 * Estructura medida el 24-11-2026 con `scripts/anime-otakustv-probe.mjs` y
 * `.probe/otakustv-structure.md`:
 *
 *   ficha     `/anime/<slug>` → `<h1><strong>Nombre <i>Sub Español</i>`,
 *             `Estreno: Oct 20 de 1999`, `Audio: …` y los enlaces a
 *             `/ver/<slug>-<N>`. La ficha no publica temporadas: sus episodios
 *             están numerados de forma absoluta (One Piece llega al 1180).
 *   episodio  `/ver/<slug>-<N>` → `<h1>Ver <título> episodio N Sub Español`
 *             y un atributo `data-dwn` con un array JSON de visores.
 *   visores   Byse (`bysesukior.com`, extraíble por el addon) y varios hosts
 *             opacos. El idioma lo declara la ficha, no cada servidor.
 *
 * Para no devolver el episodio equivocado, las temporadas > 1 solo se aceptan
 * cuando la ficha lo dice en el título o en el slug (`…-season-2`,
 * `-2nd-season`); el resto de las búsquedas se limitan a la temporada 1, que
 * coincide con la numeración absoluta del sitio.
 */

const { load } = require('cheerio');
const config = require('../config');
const { providerHttp, isNotFound } = require('../providerHttp');
const { extractEmbed, extractorFor, UA } = require('../extractors');
const { isDirectMedia } = require('../directMedia');
const { titleScore } = require('../providerTitles');
const { slugify, titleVariants } = require('./animeflv');

const BASE = 'https://otakustv2.com';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const MAX_HTML = 2 * 1024 * 1024;

const hostOf = (raw) => { try { return new URL(raw).hostname; } catch { return ''; } };

async function fetchText(http, url, referer) {
  return http.text(url, { headers: { ...HEADERS, ...(referer ? { Referer: referer } : {}) }, maxBytes: MAX_HTML });
}

/** El título limpio: el `<i>` añade «Sub Español» y no forma parte del nombre. */
function detailTitle(html) {
  const $ = load(html, { xml: { xmlMode: false, decodeEntities: true } });
  const node = $('h1').first().clone();
  node.find('i').remove();
  return node.text().replace(/\s+/g, ' ').trim();
}

/** Año de «Estreno: Oct 20 de 1999». */
function detailYear(html) {
  const value = String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const match = /Estreno\s*:\s*[^<]*?\b((?:19|20)\d{2})\b/i.exec(value);
  return match ? Number(match[1]) : null;
}

/** Audio declarado por la ficha. */
function audioOf(html) {
  const value = String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  if (/Audio\s*:\s*Español\s+Latino/i.test(value)) return 'Latino';
  if (/Audio\s*:\s*Castellano/i.test(value)) return 'Castellano';
  return 'Subtitulado';
}

/** Temporada anunciada en el título de la ficha o en el slug. */
function seasonOf(text, page) {
  const value = `${text || ''} ${page || ''}`;
  const match = /(?:season\s*|temporada\s*)(\d+)|-(\d+)(?:st|nd|rd|th)-season|-season-(\d+)/i.exec(value);
  if (!match) return null;
  return Number(match[1] || match[2] || match[3]);
}

/** Fichas candidatas del buscador (su `?s=` devuelve la portada: no sirve). */
function listingMatches(html, resolved, limit = 3) {
  const $ = load(html, { xml: { xmlMode: false, decodeEntities: true } });
  const wanted = titleVariants(resolved);
  const found = [];
  for (const el of $('a[href*="/anime/"]').toArray()) {
    const node = $(el);
    let url;
    try { url = new URL(String(node.attr('href') || ''), BASE); } catch { continue; }
    if (url.origin !== BASE || !/^\/anime\/[a-z0-9-]+\/?$/.test(url.pathname)) continue;
    const label = (node.attr('title') || node.text() || '').replace(/^Ver\s+/i, '')
      .replace(/\s+Online\s+Gratis.*$/i, '').replace(/\s+/g, ' ').trim();
    if (titleScore([label], wanted) !== 2) continue;
    if (!found.includes(url.href)) found.push(url.href);
    if (found.length >= limit) break;
  }
  return found;
}

/** Episodios enlazados en la ficha; la numeración es absoluta. */
function episodesOf(html, page) {
  const $ = load(html, { xml: { xmlMode: false, decodeEntities: true } });
  const seen = new Map();
  for (const el of $('a[href*="/ver/"]').toArray()) {
    let url;
    try { url = new URL(String($(el).attr('href') || ''), page || BASE); } catch { continue; }
    if (url.origin !== BASE) continue;
    const match = /^\/ver\/([a-z0-9-]+)-(\d+)\/?$/.exec(url.pathname);
    if (!match) continue;
    const number = Number(match[2]);
    if (!seen.has(number)) seen.set(number, url.href);
  }
  return [...seen.entries()].map(([number, url]) => ({ number, url })).sort((a, b) => a.number - b.number);
}

/** Visores declarados en `data-dwn` (JSON con pares `[nombre, url]`). */
function serversOf(html) {
  const $ = load(html, { xml: { xmlMode: false, decodeEntities: true } });
  const raw = String($('[data-dwn]').first().attr('data-dwn') || '').trim();
  if (!raw) return [];
  let entries;
  try { entries = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(entries)) return [];
  const out = [];
  for (const entry of entries) {
    const url = Array.isArray(entry) ? entry[1] : entry?.url;
    if (!/^https?:\/\//.test(String(url || ''))) continue;
    if (out.some((item) => item.url === url)) continue;
    out.push({ url, name: Array.isArray(entry) ? String(entry[0] || '') : String(entry?.name || '') });
  }
  return out;
}

/** Un visor → medio publicado. Solo se abren los extractores conocidos. */
async function mediaOf(http, server, referer, timeoutMs) {
  if (isDirectMedia(server.url)) {
    return { sources: [{ url: server.url, kind: /\.mp4$/i.test(server.url) ? 'mp4' : 'hls' }] };
  }
  const kind = extractorFor(server.url);
  if (!kind || kind === 'opaque') return { opaque: true };
  const extracted = await extractEmbed(server.url, { timeoutMs, referer });
  if (!extracted.ok) return { unsupported: true };
  return { sources: extracted.sources, subtitles: extracted.subtitles };
}

/** Identidad, episodio y visores de una ficha. `null` si no es la obra pedida. */
async function hitsFromPage(http, page, resolved, timeoutMs, series) {
  let html;
  try { html = await fetchText(http, page); }
  catch (err) { if (isNotFound(err, page)) return null; throw err; }
  const title = detailTitle(html);
  if (titleScore([title], titleVariants(resolved)) !== 2) return null;
  const year = detailYear(html);
  if (year && resolved.year && Math.abs(year - Number(resolved.year)) > 1) return null;

  const declaredSeason = seasonOf(title, page);
  if (series && declaredSeason && declaredSeason !== Number(resolved.season)) return null;
  if (series && !declaredSeason && Number(resolved.season) > 1) return null;

  const list = episodesOf(html, page);
  const slug = /^\/anime\/([^/]+)/.exec(new URL(page).pathname)?.[1];
  const wanted = series ? Number(resolved.episode) : 1;
  const known = list.find((entry) => entry.number === wanted);
  // La ficha solo muestra los últimos episodios; el patrón de URL es estable
  // y se comprueba en la página del episodio antes de publicar nada.
  const episode = known || (slug ? { number: wanted, url: `${BASE}/ver/${slug}-${wanted}` } : null);
  if (!episode) return { hits: [], reason: 'no-episode' };

  let episodeHtml;
  try { episodeHtml = await fetchText(http, episode.url, page); }
  catch (err) { if (isNotFound(err, episode.url)) return { hits: [], reason: 'no-episode' }; throw err; }
  const heading = load(episodeHtml)('h1').first().text().replace(/\s+/g, ' ').trim();
  if (series && !new RegExp(`episodio\\s*0*${wanted}\\b`, 'i').test(heading)) {
    return { hits: [], reason: 'no-episode' };
  }

  const servers = serversOf(episodeHtml);
  if (!servers.length) return { hits: [], reason: 'no-players' };
  const rank = (server) => (isDirectMedia(server.url) ? 0 : ['opaque', null].includes(extractorFor(server.url)) ? 2 : 1);
  const audio = audioOf(html) || audioOf(episodeHtml);
  const hits = [];
  const notes = { opaque: 0, extracted: 0, unsupported: 0 };
  for (const server of [...servers].sort((a, b) => rank(a) - rank(b)).slice(0, 5)) {
    const media = await mediaOf(http, server, episode.url, timeoutMs).catch(() => null);
    if (!media) { notes.unsupported += 1; continue; }
    if (media.opaque) { notes.opaque += 1; continue; }
    if (media.unsupported) { notes.unsupported += 1; continue; }
    notes.extracted += 1;
    for (const source of media.sources) {
      if (!/^https?:\/\//.test(source.url) || !isDirectMedia(source.url)) continue;
      hits.push({
        provider: 'otakustv',
        playbackOrigin: hostOf(server.url) ? `https://${hostOf(server.url)}` : '',
        title: `${resolved.title}${series ? ` S${resolved.season}E${resolved.episode}` : ''} OtakusTV`,
        url: source.url,
        quality: source.kind === 'mp4' ? 'MP4' : 'HLS',
        resolution: null,
        audioLabel: audio,
        ...(media.subtitles?.length ? { subtitles: media.subtitles } : {}),
      });
    }
    if (hits.length >= 3) break;
  }
  if (hits.length) return { hits };
  return { hits: [], reason: 'no-extractable-embed', notes };
}

/**
 * Busca la ficha por slug (y por temporada cuando procede). El buscador del
 * sitio no filtra, así que no se gasta una petición en él.
 */
async function searchOtakusTv(_query, resolved, queryTitle, timeoutMs = config.streamProviderTimeoutMs) {
  if (!resolved) return { skipped: 'identity-required' };
  if (queryTitle && queryTitle !== resolved.title) return { skipped: 'alternative-already-checked' };
  const series = resolved.mediaType !== 'movie';
  if (series && !(resolved.season > 0 && resolved.episode > 0)) return { skipped: 'episode-required' };
  const titles = [resolved.title, resolved.altTitle].map((value) => String(value || '').trim()).filter(Boolean);
  if (!titles.length) return { skipped: 'identity-required' };
  const http = providerHttp(timeoutMs, 8);
  const pages = [...new Set(titleVariants(resolved).map((title) => `${BASE}/anime/${slugify(title)}`))].slice(0, 4);
  for (const page of pages) {
    const result = await hitsFromPage(http, page, resolved, timeoutMs, series);
    if (result) return result;
  }
  // Un slug distinto al del título se encuentra en el directorio del sitio,
  // que sí publica las fichas con sus nombres.
  let listing = '';
  try { listing = await fetchText(http, `${BASE}/animes`); } catch { listing = ''; }
  for (const page of listingMatches(listing, resolved)) {
    const result = await hitsFromPage(http, page, resolved, timeoutMs, series);
    if (result) return result;
  }
  return { hits: [], reason: 'no-match' };
}

module.exports = {
  BASE, detailTitle, detailYear, audioOf, seasonOf, listingMatches, episodesOf, serversOf, mediaOf, hitsFromPage, searchOtakusTv,
};
