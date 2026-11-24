'use strict';

/**
 * seriesbl.net — doramas/series BL con audio original subtitulado.
 *
 * Estructura medida el 24-11-2026 (`.probe/dorama-players.md`,
 * `.probe/dorama-live.md`):
 *
 *   búsqueda  `/?s=<término>` → tarjetas `/series/<slug>`.
 *   ficha     `/series/<slug>` → `h1` «Ver <título> Online Sub Español |
 *             Series BL», año y episodios `/episode/<slug>-<T>x<E>`.
 *   episodio  `<li class="dooplay_player_option" data-post data-nume data-type>`
 *             → POST `/wp-admin/admin-ajax.php` (`doo_player_ajax`) → embed.
 *   visor     el embed es un relé (`pkaa.top`) que publica un Byse; el addon
 *             ya sabe resolverlo al HLS directo.
 */

const { load } = require('cheerio');
const config = require('../config');
const { providerHttp, isNotFound } = require('../providerHttp');
const { extractEmbed, extractorFor, UA } = require('../extractors');
const { isDirectMedia } = require('../directMedia');
const { titleScore, titleQueries } = require('../providerTitles');

const BASE = 'https://seriesbl.net';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const MAX_HTML = 2 * 1024 * 1024;
const EXTRACTABLE = ['byse', 'mixdrop', 'streamtape', 'videohel'];

const hostOf = (raw) => { try { return new URL(raw).hostname; } catch { return ''; } };

async function fetchText(http, url, referer) {
  return http.text(url, { headers: { ...HEADERS, ...(referer ? { Referer: referer } : {}) }, maxBytes: MAX_HTML });
}

/** «Ver ABO Desire Online Sub Español | Series BL» → «ABO Desire». */
function detailTitle(html) {
  const $ = load(html, { xml: { xmlMode: false, decodeEntities: true } });
  return String($('h1').first().text() || $('title').first().text() || '')
    .replace(/^Ver\s+/i, '')
    .replace(/\s+Online\b[\s\S]*$/i, '')
    .replace(/\s*[|–-]\s*Series\s*BL\s*$/i, '')
    .replace(/\s+/g, ' ').trim();
}

/** Año anunciado en la ficha (el primer año del texto, no del pie). */
function detailYear(html) {
  const text = String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  return Number(/Fecha(?: de emisión| de lanzamiento)?\s*:\s*[^<]{0,60}?\b((?:19|20)\d{2})/i.exec(text)?.[1]
    || /\b((?:19|20)\d{2})\b/.exec(text.slice(0, 20_000))?.[1]) || null;
}

/** Audio declarado por la ficha: este sitio publica solo subtitulado. */
function audioOf(html) {
  return /audio\s+latino|doblado|castellano/i.test(String(html || '').replace(/<[^>]+>/g, ' ')) ? 'Latino' : 'Subtitulado';
}

/** Fichas del buscador HTTP, elegidas por título. */
function listingMatches(html, resolved, limit = 3) {
  const $ = load(html, { xml: { xmlMode: false, decodeEntities: true } });
  const wanted = [resolved.title, resolved.altTitle].filter(Boolean);
  const found = [];
  for (const el of $('a[href*="/series/"]').toArray()) {
    const node = $(el);
    let url;
    try { url = new URL(String(node.attr('href') || ''), BASE); } catch { continue; }
    if (url.origin !== BASE || !/^\/series\/[a-z0-9-]+\/?$/.test(url.pathname)) continue;
    const label = (node.attr('title') || node.text() || '').replace(/^Ver\s+/i, '')
      .replace(/\s+Online.*$/i, '').replace(/\s+/g, ' ').trim();
    if (titleScore([label], wanted) !== 2) continue;
    if (!found.includes(url.href)) found.push(url.href);
    if (found.length >= limit) break;
  }
  return found;
}

/** Episodios `/episode/<slug>-<T>x<E>` de la ficha. */
function episodesOf(html, page) {
  const $ = load(html, { xml: { xmlMode: false, decodeEntities: true } });
  const found = new Map();
  for (const el of $('a[href*="/episode/"]').toArray()) {
    let url;
    try { url = new URL(String($(el).attr('href') || ''), page || BASE); } catch { continue; }
    const match = /^\/episode\/([a-z0-9-]+)-(\d+)x(\d+)\/?$/.exec(url.pathname);
    if (!match) continue;
    const key = `${Number(match[2])}x${Number(match[3])}`;
    if (!found.has(key)) found.set(key, { season: Number(match[2]), episode: Number(match[3]), url: url.href });
  }
  return [...found.values()];
}

/** Opciones del reproductor DooPlay. */
function playersOf(html) {
  const $ = load(html, { xml: { xmlMode: false, decodeEntities: true } });
  const out = [];
  $('li.dooplay_player_option').each((_, el) => {
    const node = $(el);
    const post = String(node.attr('data-post') || '').trim();
    const nume = String(node.attr('data-nume') || '').trim();
    if (!post || !nume) return;
    const type = String(node.attr('data-type') || 'tv').trim();
    if (!out.some((item) => item.post === post && item.nume === nume)) {
      out.push({ post, nume, type, label: node.text().replace(/\s+/g, ' ').trim().slice(0, 60) });
    }
  });
  return out;
}

/** `admin-ajax.php` → URL del embed (puede venir como iframe completo). */
function embedUrl(json) {
  const raw = typeof json?.embed_url === 'string' ? json.embed_url : '';
  const iframe = /<iframe[^>]+src=["']([^"']+)["']/i.exec(raw)?.[1] || raw;
  const url = String(iframe).replace(/\\\//g, '/').replace(/^\/\//, 'https:').trim();
  return /^https?:\/\//i.test(url) ? url : '';
}

/** Un embed → fuentes, con un salto opcional para reles como pkaa.top. */
async function mediaOf(http, embed, referer, timeoutMs) {
  if (isDirectMedia(embed)) return { sources: [{ url: embed, kind: /\.mp4$/i.test(embed) ? 'mp4' : 'hls' }] };
  const kind = extractorFor(embed);
  if (kind && kind !== 'opaque') {
    const extracted = await extractEmbed(embed, { timeoutMs, referer });
    if (extracted.ok) return { sources: extracted.sources, subtitles: extracted.subtitles };
    return { unsupported: true };
  }
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

async function hitsFromPage(http, page, resolved, timeoutMs, series) {
  let html;
  try { html = await fetchText(http, page); }
  catch (err) { if (isNotFound(err, page)) return null; throw err; }
  const title = detailTitle(html);
  if (titleScore([title], [resolved.title, resolved.altTitle].filter(Boolean)) !== 2) return null;
  const year = detailYear(html);
  if (year && resolved.year && Math.abs(year - Number(resolved.year)) > 1) return null;
  const audio = audioOf(html);
  const list = episodesOf(html, page);
  const episode = series
    ? list.find((entry) => entry.season === Number(resolved.season) && entry.episode === Number(resolved.episode))
    : list[0];
  if (!episode) return { hits: [], reason: 'no-episode' };

  let episodeHtml;
  try { episodeHtml = await fetchText(http, episode.url, page); }
  catch (err) { if (isNotFound(err, episode.url)) return { hits: [], reason: 'no-episode' }; throw err; }
  const players = playersOf(episodeHtml);
  if (!players.length) return { hits: [], reason: 'no-players' };

  const embeds = [];
  for (const player of players.slice(0, 4)) {
    const body = new URLSearchParams({ action: 'doo_player_ajax', post: player.post, nume: player.nume, type: player.type }).toString();
    let reply = '';
    try {
      reply = await http.text(`${BASE}/wp-admin/admin-ajax.php`, { method: 'POST', body,
        headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Referer: episode.url } });
    } catch { continue; }
    let url = '';
    try { url = embedUrl(JSON.parse(reply)); } catch { /* respuesta no JSON */ }
    if (url && !embeds.includes(url)) embeds.push(url);
  }
  const rank = (url) => (isDirectMedia(url) ? 0 : EXTRACTABLE.includes(extractorFor(url)) ? 1 : 2);
  const hits = [];
  const notes = { extracted: 0, unsupported: 0, opaque: 0 };
  for (const embed of embeds.sort((a, b) => rank(a) - rank(b)).slice(0, 3)) {
    const media = await mediaOf(http, embed, episode.url, timeoutMs).catch(() => null);
    if (!media || media.unsupported) { notes.unsupported += 1; continue; }
    notes.extracted += 1;
    for (const source of media.sources) {
      if (!/^https?:\/\//.test(source.url) || !isDirectMedia(source.url)) continue;
      hits.push({
        provider: 'seriesbl',
        playbackOrigin: hostOf(embed) ? `https://${hostOf(embed)}` : '',
        title: `${resolved.title}${series ? ` S${resolved.season}E${resolved.episode}` : ''} SeriesBL`,
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

async function searchSeriesBl(_query, resolved, queryTitle, timeoutMs = config.streamProviderTimeoutMs) {
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
  BASE, detailTitle, detailYear, audioOf, listingMatches, episodesOf, playersOf, embedUrl, mediaOf, hitsFromPage, searchSeriesBl,
};
