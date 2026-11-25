'use strict';

/**
 * doramasyt.com — doramas y películas asiáticas con audio latino **y**
 * subtitulado (el enlace «-latino-» lleva doblaje; el plano, subtítulos).
 *
 * Estructura medida el 25-11-2026 (`.probe/doramasyt.md`,
 * `.probe/doramasyt-search.md`):
 *
 *   búsqueda  `/?s=<término>` (WordPress) → enlaces DIRECTOS a capítulos
 *             `/ver/<slug>-(latino-)?episodio-<N>` (toda la temporada).
 *   episodio  botones `data-player="<token>"` → GET `/reproductor?video=`
 *             → iframe al visor (Byse, Mixdrop…) → extractor del addon.
 *   ficha     `/dorama/<slug>/` existe, pero solo enlaza el capítulo 1:
 *             el buscador es la vía completa.
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

const squashSlug = (slug) => normalizeText(String(slug || '').replace(/-latino$/, '')).replace(/ /g, '');

/** ¿El slug de la serie coincide con el título buscado, sin depender del alias? */
function slugMatches(slug, wanted) {
  const squashed = squashSlug(slug);
  return wanted.some((title) => title && squashed === normalizeText(title).replace(/ /g, ''));
}

/** «…Capítulo 16 Online en Español | Doramas» → la obra, sin la coletilla. */
const listingLabel = (raw) => String(raw || '')
  .replace(/^Ver\s+/i, '')
  .replace(/\s+[|–-]\s*Doramas.*$/i, '')
  .replace(/\s+(?:Cap[ií]tulo|Episodio)\s+\d+.*$/i, '')
  .replace(/\s+Online\b[\s\S]*$/i, '')
  .replace(/\s+(?:Latino|Subtitulado|Sub\s+Español)\s*$/i, '')
  .replace(/\s+/g, ' ').trim();

/**
 * Todos los enlaces `/ver/…` de una página (resultados del buscador o ficha)
 * con su serie, capítulo y audio deducidos de la ruta.
 */
function verLinksOf(html) {
  const $ = load(html, { xml: { xmlMode: false, decodeEntities: true } });
  const found = [];
  for (const el of $('a[href*="/ver/"]').toArray()) {
    let url;
    try { url = new URL(String($(el).attr('href') || ''), BASE); } catch { continue; }
    if (url.origin !== BASE) continue;
    const path = url.pathname.replace(/\/+$/, '');
    let season = 1;
    let episode = null;
    let m = /-temporada-(\d+)-(?:episodio|capitulo)-(\d+)$/i.exec(path);
    if (m) { season = Number(m[1]); episode = Number(m[2]); }
    else if ((m = /-(?:episodio|capitulo)-(\d+)$/i.exec(path))) episode = Number(m[1]);
    else if ((m = /-(\d+)x(\d+)$/.exec(path))) { season = Number(m[1]); episode = Number(m[2]); }
    else if (/-pelicula$/i.test(path)) { season = 0; episode = 0; }
    else continue;
    const latino = /-latino(?=-|$)/i.test(path);
    const showSlug = path.split('/').pop()
      .replace(/-(?:temporada-\d+-)?(?:episodio|capitulo)-\d+$/i, '')
      .replace(/-\d+x\d+$/, '')
      .replace(/-pelicula$/i, '')
      .replace(/-latino$/i, '');
    if (!showSlug) continue;
    if (found.some((e) => e.url === url.href)) continue;
    found.push({
      showSlug, season, episode, latino, url: url.href,
      label: listingLabel($(el).attr('title') || $(el).text()),
    });
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

async function hitsFromWatchPage(http, watchUrl, audio, timeoutMs, acc, notes) {
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
    if (isDirectMedia(embed)) {
      acc.push({ embed, source: { url: embed, kind: /\.mp4$/i.test(embed) ? 'mp4' : 'hls' }, audio });
      continue;
    }
    const kind = extractorFor(embed);
    if (!kind || kind === 'opaque') { notes.opaque = (notes.opaque || 0) + 1; continue; }
    const extracted = await extractEmbed(embed, { timeoutMs, referer: watchUrl }).catch(() => ({ ok: false }));
    if (!extracted.ok) { notes.failed = (notes.failed || 0) + 1; continue; }
    for (const source of extracted.sources || []) acc.push({ embed, source, subtitles: extracted.subtitles, audio });
  }
}

function toHits(acc, resolved, series) {
  const out = [];
  const seen = new Set();
  for (const hit of acc) {
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
  return out;
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
    if (!listing) continue;
    const links = verLinksOf(listing);
    // La serie candidata: por rótulo de la tarjeta o por slug de la ruta.
    const wanted = links.filter((link) => titleScore([link.label], titles) === 2 || slugMatches(link.showSlug, titles));
    const candidates = (series
      ? wanted.filter((link) => link.season === Number(resolved.season) && link.episode === Number(resolved.episode))
      : wanted.filter((link) => link.season === 0))
      // Latino primero: es el audio que más pide el usuario del addon.
      .sort((a, b) => Number(b.latino) - Number(a.latino))
      .slice(0, 2);
    if (!candidates.length) continue;
    const acc = [];
    const notes = {};
    for (const candidate of candidates) {
      await hitsFromWatchPage(http, candidate.url, candidate.latino ? 'Latino' : 'Subtitulado', timeoutMs, acc, notes);
      if (acc.length >= 4) break;
    }
    const hits = toHits(acc, resolved, series);
    if (hits.length) return { hits };
    return { hits: [], reason: 'no-extractable-embed', notes };
  }
  return { hits: [], reason: 'no-match' };
}

module.exports = {
  BASE, listingLabel, slugMatches, verLinksOf, playersOf, embedFromPlayer, toHits, searchDoramasYt,
};
