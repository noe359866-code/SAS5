'use strict';

/**
 * doramasyt.com — doramas y películas asiáticas con audio latino **y**
 * subtitulado (el sitio publica ambas variantes: el enlace «-latino-» lleva
 * doblaje; el plano, subtítulos).
 *
 * Estructura medida el 24-11-2026 (`.probe/dorama-candidates.md`,
 * `.probe/doramasyt.md`):
 *
 *   búsqueda  `/?s=<término>` (WordPress) → tarjetas hacia la ficha.
 *   ficha     enlaces `/ver/<slug>-(latino-)?episodio-<N>` por capítulo.
 *   episodio  botones `data-player="<token>"` → GET `/reproductor?video=`
 *             → iframe al visor (Byse, Mixdrop…) → extractor del addon.
 */

const { load } = require('cheerio');
const config = require('../config');
const { providerHttp, isNotFound } = require('../providerHttp');
const { extractEmbed, extractorFor, UA } = require('../extractors');
const { isDirectMedia } = require('../directMedia');
const { titleScore, titleQueries, normalizeText } = require('../providerTitles');

const BASE = 'https://www.doramasyt.com';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const MAX_HTML = 2 * 1024 * 1024;
const EXTRACTABLE = ['byse', 'mixdrop', 'streamtape', 'videohel'];

const hostOf = (raw) => { try { return new URL(raw).hostname; } catch { return ''; } };

async function fetchText(http, url, referer) {
  return http.text(url, { headers: { ...HEADERS, ...(referer ? { Referer: referer } : {}) }, maxBytes: MAX_HTML });
}

/** «Qué le ocurre… Capítulo 16 Online en Español | Doramas» → la obra. */
function detailTitle(html) {
  const $ = load(html, { xml: { xmlMode: false, decodeEntities: true } });
  return String($('h1').first().text() || $('title').first().text() || '')
    .replace(/^Ver\s+/i, '')
    .replace(/\s+[|–-]\s*Doramas.*$/i, '')
    .replace(/\s+Cap[ií]tulo\s+\d+.*$/i, '')
    .replace(/\s+Online\b[\s\S]*$/i, '')
    .replace(/\s+(?:Latino|Subtitulado|Sub\s+Español)\s*$/i, '')
    .replace(/\s+/g, ' ').trim();
}

/** Primer año visible de la ficha (el reparto no suele tener años). */
function detailYear(html) {
  const text = String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  return Number(/\b((?:19|20)\d{2})\b/.exec(text.slice(0, 20_000))?.[1]) || null;
}

/** Quita el «Latino»/«Sub» del rótulo del buscador antes de puntuar títulos. */
const listingLabel = (raw) => String(raw || '')
  .replace(/^Ver\s+/i, '')
  .replace(/\s+[|–-]\s*Doramas.*$/i, '')
  .replace(/\s+(?:Latino|Subtitulado|Sub\s+Español|Online|HD)\b.*$/i, '')
  .replace(/\s+/g, ' ').trim();

/** ¿La ruta de la ficha coincide con el título buscado, sin depender del alias? */
function slugMatches(pathname, wanted) {
  const slug = String(pathname || '').split('/').filter(Boolean).pop() || '';
  const squashed = normalizeText(slug.replace(/-latino$/, '')).replace(/ /g, '');
  return wanted.some((title) => title && squashed === normalizeText(title).replace(/ /g, ''));
}

/** Fichas candidatas del buscador (`/dorama/<slug>` y afines). */
function listingMatches(html, resolved, limit = 3) {
  const $ = load(html, { xml: { xmlMode: false, decodeEntities: true } });
  const wanted = [resolved.title, resolved.altTitle].filter(Boolean);
  const found = [];
  for (const el of $('a[href]').toArray()) {
    let url;
    try { url = new URL(String($(el).attr('href') || ''), BASE); } catch { continue; }
    if (url.origin !== BASE) continue;
    if (!/^\/(?:doramas?|series?|peliculas?|kshows?|shows?)\/[a-z0-9-]+\/?$/i.test(url.pathname)) continue;
    const label = listingLabel($(el).attr('title') || $(el).text());
    if (titleScore([label], wanted) !== 2 && !slugMatches(url.pathname, wanted)) continue;
    if (!found.includes(url.href)) found.push(url.href);
    if (found.length >= limit) break;
  }
  return found;
}

/**
 * Capítulos `/ver/<slug>-(latino-)?episodio-<N>` (o `-temporada-<T>-episodio-<E>`)
 * de la ficha. Cada entrada lleva su audio: «latino» en la URL = doblaje.
 */
function episodesOf(html, page) {
  const $ = load(html, { xml: { xmlMode: false, decodeEntities: true } });
  const found = [];
  for (const el of $('a[href*="/ver/"]').toArray()) {
    let url;
    try { url = new URL(String($(el).attr('href') || ''), page || BASE); } catch { continue; }
    if (url.origin !== BASE) continue;
    const path = url.pathname;
    let season = 1;
    let episode = null;
    let m = /-temporada-(\d+)-episodio-(\d+)(?:\D|$)/i.exec(path);
    if (m) { season = Number(m[1]); episode = Number(m[2]); }
    else if ((m = /-episodio-(\d+)(?:\D|$)/i.exec(path))) episode = Number(m[1]);
    else if ((m = /-(\d+)x(\d+)(?:\D|$)/.exec(path))) { season = Number(m[1]); episode = Number(m[2]); }
    else if (/-pelicula(?:\D|$)/i.test(path)) { season = 0; episode = 0; } // película
    else continue;
    if (found.some((e) => e.url === url.href)) continue;
    found.push({ season, episode, url: url.href, latino: /-latino/i.test(path) });
  }
  return found;
}

/** Botones `data-player="<token>"` de la página de capítulo. */
function playersOf(html) {
  return [...new Set([...String(html || '').matchAll(/data-player=["']([^"']+)["']/gi)].map((m) => m[1]))];
}

/** `/reproductor?video=<token>` → URL del iframe (visor externo). */
function embedFromPlayer(html) {
  const iframe = /<iframe[^>]+src=["']([^"']+)["']/i.exec(String(html || ''))?.[1] || '';
  const url = (iframe.startsWith('//') ? `https:${iframe}` : iframe).trim();
  return /^https?:\/\//i.test(url) ? url : '';
}

async function hitsFromWatchPage(http, watchUrl, audio, resolved, timeoutMs, hits, notes) {
  let html;
  try { html = await fetchText(http, watchUrl); }
  catch (err) { if (isNotFound(err, watchUrl)) return; throw err; }
  const tokens = playersOf(html);
  if (!tokens.length) { notes.noPlayers = true; return; }
  for (const token of tokens.slice(0, 5)) {
    let playerHtml = '';
    try { playerHtml = await fetchText(http, `${BASE}/reproductor?video=${encodeURIComponent(token)}`, watchUrl); }
    catch { continue; }
    const embed = embedFromPlayer(playerHtml);
    if (!embed) continue;
    const kind = extractorFor(embed);
    if (isDirectMedia(embed)) {
      hits.push({ embed, source: { url: embed, kind: /\.mp4$/i.test(embed) ? 'mp4' : 'hls' }, audio });
      continue;
    }
    if (!kind || kind === 'opaque') { notes.opaque = (notes.opaque || 0) + 1; continue; }
    const extracted = await extractEmbed(embed, { timeoutMs, referer: watchUrl }).catch(() => ({ ok: false }));
    if (!extracted.ok) { notes.failed = (notes.failed || 0) + 1; continue; }
    for (const source of extracted.sources || []) {
      hits.push({ embed, source, subtitles: extracted.subtitles, audio });
    }
  }
}

async function hitsFromPage(http, page, resolved, timeoutMs, series) {
  let html;
  try { html = await fetchText(http, page); }
  catch (err) { if (isNotFound(err, page)) return null; throw err; }
  const wanted = [resolved.title, resolved.altTitle].filter(Boolean);
  const title = detailTitle(html);
  if (titleScore([title], wanted) !== 2 && !slugMatches(new URL(page).pathname, wanted)) return null;
  const year = detailYear(html);
  if (year && resolved.year && Math.abs(year - Number(resolved.year)) > 1) return null;

  const list = episodesOf(html, page);
  const wantedEpisodes = series
    ? list.filter((e) => e.season === Number(resolved.season) && e.episode === Number(resolved.episode))
    : list.filter((e) => e.season === 0); // película: enlaces «-pelicula»
  // Latino y subtitulado del mismo capítulo: dos filas con su audio declarado.
  const picked = wantedEpisodes.slice(0, 2);
  // Una película puede tener los botones en la propia ficha (sin /ver/).
  const targets = picked.length
    ? picked
    : (!series && playersOf(html).length ? [{ url: page, latino: /latino/i.test(page) }] : []);
  if (!targets.length) return { hits: [], reason: 'no-episode' };

  const hits = [];
  const notes = {};
  for (const target of targets) {
    await hitsFromWatchPage(http, target.url, target.latino ? 'Latino' : 'Subtitulado', resolved, timeoutMs, hits, notes);
    if (hits.length >= 4) break;
  }
  const out = [];
  const seen = new Set();
  for (const hit of hits) {
    if (!hit.source || !/^https?:\/\//.test(hit.source.url) || !isDirectMedia(hit.source.url)) continue;
    if (seen.has(hit.source.url)) continue;
    seen.add(hit.source.url);
    out.push({
      provider: 'doramasyt',
      playbackOrigin: hostOf(hit.embed) ? `https://${hostOf(hit.embed)}` : '',
      title: `${resolved.title}${series ? ` S${resolved.season}E${resolved.episode}` : ''} ${hit.audio === 'Latino' ? 'Latino' : 'Sub'} DoramasYT`,
      url: hit.source.url,
      quality: hit.source.kind === 'mp4' ? 'MP4' : 'HLS',
      resolution: null,
      audioLabel: hit.audio,
      ...(hit.subtitles?.length ? { subtitles: hit.subtitles } : {}),
    });
    if (out.length >= 4) break;
  }
  if (out.length) return { hits: out };
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
    try { listing = await fetchText(http, `${BASE}/?s=${encodeURIComponent(query)}`); } catch { listing = ''; }
    for (const page of listingMatches(listing, resolved)) {
      const result = await hitsFromPage(http, page, resolved, timeoutMs, series);
      if (result) return result;
    }
  }
  return { hits: [], reason: 'no-match' };
}

module.exports = {
  BASE, detailTitle, detailYear, listingLabel, slugMatches, listingMatches, episodesOf,
  playersOf, embedFromPlayer, hitsFromPage, searchDoramasYt,
};
