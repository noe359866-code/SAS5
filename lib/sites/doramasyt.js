'use strict';

/**
 * doramasyt.com — doramas con doblaje latino y versión subtitulada.
 *
 * Estructura medida el 24-11-2026 (`.probe/doramasyt.md`,
 * `.probe/dorama-candidates.md`):
 *
 *   búsqueda `/buscar?q=<término>` → tarjetas `/dorama/<slug>` con el título,
 *   el año y las dos versiones (`…-latino-sub-espanol` y `…-sub-espanol`).
 *   ficha    `/dorama/<slug>` → `h1`, «Fecha de emisión: dd de Mes de AAAA»,
 *            «Nombre alternativo: … Audio Latino» y los enlaces
 *            `/ver/<slug>-episodio-<N>`.
 *   episodio `/ver/<slug>-episodio-<N>` → botones `data-player="<token>"`.
 *   visor    `GET /reproductor?video=<token>` → iframe con el embed real.
 *
 * La versión latina se distingue por «Audio Latino» en la ficha (o por el
 * sufijo `-latino` del slug); la otra es audio original subtitulado. Byse
 * publica el HLS directo y es el primer visor que se intenta.
 */

const { load } = require('cheerio');
const config = require('../config');
const { providerHttp, isNotFound } = require('../providerHttp');
const { extractEmbed, extractorFor, UA } = require('../extractors');
const { isDirectMedia } = require('../directMedia');
const { titleScore, titleQueries, catalogYear } = require('../providerTitles');

const BASE = 'https://www.doramasyt.com';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const MAX_HTML = 2 * 1024 * 1024;
const EXTRACTABLE = ['byse', 'mixdrop', 'streamtape', 'videohel'];

const hostOf = (raw) => { try { return new URL(raw).hostname; } catch { return ''; } };

async function fetchText(http, url, referer) {
  return http.text(url, { headers: { ...HEADERS, ...(referer ? { Referer: referer } : {}) }, maxBytes: MAX_HTML });
}

/** Quita las palabras que el sitio añade al título para describir el audio. */
function cleanTitle(value) {
  return String(value || '')
    .replace(/^Ver\s+/i, '')
    .replace(/\s+Audio\s+Latino\b[\s\S]*$/i, '')
    .replace(/\s+online\b[\s\S]*$/i, '')
    .replace(/\s+en\s+español\b[\s\S]*$/i, '')
    .replace(/\s+(?:Latino|Sub\s+Español)\b[\s\S]*$/i, '')
    .replace(/\s+/g, ' ').trim();
}

/** Nombres con los que se identifica una ficha, incluido el alternativo. */
function detailTitle(html) {
  const $ = load(html, { xml: { xmlMode: false, decodeEntities: true } });
  const heading = cleanTitle($('h1').first().text());
  const alt = cleanTitle(/Nombre alternativo\s*:\s*([^<]+)/i.exec(String(html || ''))?.[1] || '');
  return [heading, alt].filter(Boolean);
}

/** «Fecha de emisión: 06 de Junio de 2018» → 2018. */
function detailYear(html) {
  const text = String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const full = /Fecha\s+de\s+emisi[oó]n\s*:\s*\d{1,2}\s+de\s+[A-Za-zÁÉÍÓÚáéíóú]+\s+de\s+((?:19|20)\d{2})/i.exec(text)?.[1];
  return full ? Number(full) : (catalogYear({ year: /\b(?:19|20)\d{2}\b/.exec(text)?.[0] }) || null);
}

/** Audio declarado por la ficha (o por el sufijo del slug). */
function audioOf(html, page) {
  const text = `${String(html || '').replace(/<[^>]+>/g, ' ')} ${page || ''}`;
  if (/Audio\s+Latino/i.test(text) || /-latino(?:-|$)/i.test(page || '')) return 'Latino';
  return 'Subtitulado';
}

/** Tarjetas del buscador, elegidas por título completo. */
function listingMatches(html, resolved, limit = 3) {
  const $ = load(html, { xml: { xmlMode: false, decodeEntities: true } });
  const wanted = [resolved.title, resolved.altTitle].filter(Boolean);
  const found = [];
  for (const el of $('a[href*="/dorama/"]').toArray()) {
    const node = $(el);
    let url;
    try { url = new URL(String(node.attr('href') || ''), BASE); } catch { continue; }
    if (url.origin !== BASE || !/^\/dorama\/[a-z0-9-]+\/?$/.test(url.pathname)) continue;
    const label = cleanTitle(node.attr('title') || node.text());
    const alt = cleanTitle(node.attr('alt') || '');
    if (titleScore([label, alt], wanted) !== 2) continue;
    if (!found.includes(url.href)) found.push(url.href);
    if (found.length >= limit) break;
  }
  return found;
}

/** Episodios `/ver/<slug>-episodio-<N>` de la ficha. */
function episodesOf(html, page) {
  const $ = load(html, { xml: { xmlMode: false, decodeEntities: true } });
  const found = new Map();
  for (const el of $('a[href*="/ver/"]').toArray()) {
    let url;
    try { url = new URL(String($(el).attr('href') || ''), page || BASE); } catch { continue; }
    const match = /^\/ver\/([a-z0-9-]+?)-episodio-(\d+)\/?$/.exec(url.pathname);
    if (!match || found.has(Number(match[2]))) continue;
    found.set(Number(match[2]), url.href);
  }
  return [...found.entries()].map(([number, url]) => ({ number, url })).sort((a, b) => a.number - b.number);
}

/** Tokens `data-player` de los botones del episodio. */
function playersOf(html) {
  const $ = load(html, { xml: { xmlMode: false, decodeEntities: true } });
  const out = [];
  for (const el of $('[data-player]').toArray()) {
    const token = String($(el).attr('data-player') || '').trim();
    if (token && !out.includes(token)) out.push(token);
  }
  return out;
}

/** Embed real que esconde `/reproductor?video=<token>`. */
function iframeOf(html, page) {
  const raw = String(/<iframe[^>]+src=["']([^"']+)["']/i.exec(html || '')?.[1] || '').trim();
  let url;
  try { url = new URL(raw.replace(/^\\ /, ''), page); } catch { return ''; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  return url.href;
}

/** Un embed → fuentes publicadas, con un salto opcional para reles. */
async function mediaOf(http, embed, referer, timeoutMs) {
  if (isDirectMedia(embed)) {
    return { sources: [{ url: embed, kind: /\.mp4$/i.test(embed) ? 'mp4' : 'hls' }] };
  }
  const kind = extractorFor(embed);
  if (kind && kind !== 'opaque') {
    const extracted = await extractEmbed(embed, { timeoutMs, referer });
    if (extracted.ok) return { sources: extracted.sources, subtitles: extracted.subtitles };
    return { unsupported: true };
  }
  // Algunos visores son solo un relé: su HTML sí publica el embed extraíble.
  let shell = '';
  try { shell = await fetchText(http, embed, referer); } catch { return { unsupported: true }; }
  const found = [...new Set([...shell.matchAll(/https?:\/\/[^\s"'<>\\]+/gi)]
    .map((m) => m[0].replace(/[),;]+$/, ''))
    .filter((url) => EXTRACTABLE.includes(extractorFor(url))))];
  for (const url of found.slice(0, 2)) {
    const extracted = await extractEmbed(url, { timeoutMs, referer: embed }).catch(() => ({ ok: false, sources: [] }));
    if (extracted.ok) return { sources: extracted.sources, subtitles: extracted.subtitles };
  }
  return { unsupported: true };
}

/** Recorre una ficha: identidad → episodio → jugadores → medio. */
async function hitsFromPage(http, page, resolved, timeoutMs, series) {
  let html;
  try { html = await fetchText(http, page); }
  catch (err) { if (isNotFound(err, page)) return null; throw err; }
  const names = detailTitle(html);
  if (titleScore(names, [resolved.title, resolved.altTitle].filter(Boolean)) !== 2) return null;
  const year = detailYear(html);
  if (year && resolved.year && Math.abs(year - Number(resolved.year)) > 1) return null;
  const audio = audioOf(html, page);

  const list = episodesOf(html, page);
  const wanted = series ? Number(resolved.episode) : 1;
  const episode = list.find((entry) => entry.number === wanted);
  if (!episode) return { hits: [], reason: 'no-episode' };

  let episodeHtml;
  try { episodeHtml = await fetchText(http, episode.url, page); }
  catch (err) { if (isNotFound(err, episode.url)) return { hits: [], reason: 'no-episode' }; throw err; }
  const tokens = playersOf(episodeHtml);
  if (!tokens.length) return { hits: [], reason: 'no-players' };

  const embeds = [];
  for (const token of tokens.slice(0, 4)) {
    let playerHtml = '';
    try { playerHtml = await fetchText(http, `${BASE}/reproductor?video=${encodeURIComponent(token)}`, episode.url); }
    catch { continue; }
    const embed = iframeOf(playerHtml, `${BASE}/reproductor`);
    if (!embed || embeds.includes(embed)) continue;
    embeds.push(embed);
  }
  // Primero los visores que el addon sabe resolver; los opacos no se abren.
  const rank = (url) => {
    if (isDirectMedia(url)) return 0;
    const kind = extractorFor(url);
    return EXTRACTABLE.includes(kind) ? 1 : 2;
  };
  const hits = [];
  const notes = { extracted: 0, unsupported: 0, opaque: 0 };
  for (const embed of embeds.sort((a, b) => rank(a) - rank(b)).slice(0, 3)) {
    const media = await mediaOf(http, embed, episode.url, timeoutMs).catch(() => null);
    if (!media) { notes.unsupported += 1; continue; }
    if (media.unsupported) { notes.unsupported += 1; continue; }
    notes.extracted += 1;
    for (const source of media.sources) {
      if (!/^https?:\/\//.test(source.url) || !isDirectMedia(source.url)) continue;
      hits.push({
        provider: 'doramasyt',
        playbackOrigin: hostOf(embed) ? `https://${hostOf(embed)}` : '',
        title: `${resolved.title}${series ? ` S${resolved.season}E${resolved.episode}` : ''} DoramasYT`,
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

async function searchDoramasYt(_query, resolved, queryTitle, timeoutMs = config.streamProviderTimeoutMs) {
  if (!resolved) return { skipped: 'identity-required' };
  if (queryTitle && queryTitle !== resolved.title) return { skipped: 'alternative-already-checked' };
  const series = resolved.mediaType !== 'movie';
  if (series && !(resolved.season > 0 && resolved.episode > 0)) return { skipped: 'episode-required' };
  const titles = [resolved.title, resolved.altTitle].map((value) => String(value || '').trim()).filter(Boolean);
  if (!titles.length) return { skipped: 'identity-required' };
  const http = providerHttp(timeoutMs, 12);
  for (const query of titleQueries(titles).slice(0, 3)) {
    let listing = '';
    try { listing = await fetchText(http, `${BASE}/buscar?q=${encodeURIComponent(query)}`); } catch { listing = ''; }
    for (const page of listingMatches(listing, resolved)) {
      const result = await hitsFromPage(http, page, resolved, timeoutMs, series);
      if (result) return result;
    }
  }
  return { hits: [], reason: 'no-match' };
}

module.exports = {
  BASE, cleanTitle, detailTitle, detailYear, audioOf, listingMatches, episodesOf, playersOf, iframeOf, mediaOf, hitsFromPage, searchDoramasYt,
};
