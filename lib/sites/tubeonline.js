'use strict';

/**
 * www.tubeonline.net — WordPress con el tema Dooplay.
 *
 * Estructura medida el 19-11-2026:
 *   ficha de película `/pelicula/<slug>/` y de serie `/serie/<slug>/`
 *   episodios `/episodio/<slug>-<t>-<e>/` dentro de `#seasons .episodios`
 *   cada servidor es un `<li id="player-option-N" data-post data-nume data-type>`
 *   y el embed real se pide por `POST /wp-admin/admin-ajax.php` con
 *   `action=doo_player_ajax&post=…&nume=…&type=movie|tv` (respuesta JSON
 *   `{ embed_url }`). Los visores vistos: Byse (extraíble), Streamtape,
 *   Vidara/Vidmoly/Lulustream (descartados: JS ofuscado o Cloudflare).
 *
 * Serie: se busca la fila `Temporada N` y, dentro, el enlace del episodio por
 * su `numerando` («1 - 2»). No se construyen slugs a mano.
 */

const { load } = require('cheerio');
const config = require('../config');
const { providerHttp } = require('../providerHttp');
const { extractEmbed, extractorFor, UA } = require('../extractors');
const { titleScore, yearOf } = require('../providerTitles');

const BASE = 'https://www.tubeonline.net';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const AJAX = `${BASE}/wp-admin/admin-ajax.php`;

const FLAG_AUDIO = { es: 'Castellano', mx: 'Latino', ar: 'Latino', lat: 'Latino', us: 'Inglés', en: 'Inglés' };

const slugify = (title) => String(title || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function matchDetail($, resolved) {
  const title = $('h1').first().text().trim();
  const original = $('.soriginal_title, .original-title, [class*="original"]').first().text().trim();
  if (titleScore([title, original], [resolved.title, resolved.altTitle]) === 0) return false;
  const year = yearOf(/(?:19|20)\d{2}/.exec($('.srelease, .year, [class*="release"]').first().text())?.[0])
    || yearOf(/(?:19|20)\d{2}/.exec($('body').text().slice(0, 20000))?.[0]);
  const wanted = yearOf(resolved.year);
  return wanted ? year === wanted : true;
}

/** Episodio concreto en `#seasons .episodios`: `numerando` = «T - E». */
function episodeLink($, season, episode) {
  for (const item of $('#seasons .episodios li, .episodios li').toArray()) {
    const row = $(item);
    const numbering = row.find('.numerando').first().text().replace(/\s+/g, ' ').trim();
    const match = /^(\d+)\s*-\s*(\d+)$/.exec(numbering);
    if (!match || Number(match[1]) !== season || Number(match[2]) !== episode) continue;
    const href = row.find('.episodiotitle a[href], a[href*="/episodio/"]').first().attr('href');
    if (href) return new URL(href, BASE).href;
  }
  return null;
}

/** Servidores publicados en la ficha (película o episodio). */
function playerOptions($) {
  const out = [];
  for (const el of $('[id^="player-option-"], [data-post][data-nume]').toArray()) {
    const node = $(el);
    const post = node.attr('data-post');
    const nume = node.attr('data-nume');
    if (!post || !nume || !/^\d+$/.test(post) || !/^\d+$/.test(nume)) continue;
    const flag = /\/(\w{2,3})\.png/i.exec(node.find('img[src*="/flags/"]').attr('src') || '')?.[1]?.toLowerCase();
    const server = node.find('.server').text().trim() || node.attr('id') || '';
    out.push({ post, nume, server, audio: FLAG_AUDIO[flag] || '', type: node.attr('data-type') || 'movie' });
  }
  // Dooplay repite el bloque en la ficha y en el episodio: deduplicar por post/nume.
  const seen = new Set();
  return out.filter((item) => {
    const key = `${item.post}:${item.nume}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function ajaxEmbed(http, option, page) {
  const body = `action=doo_player_ajax&post=${encodeURIComponent(option.post)}&nume=${encodeURIComponent(option.nume)}&type=${encodeURIComponent(option.type || 'movie')}`;
  const data = await http.json(AJAX, {
    method: 'POST', body, maxBytes: 64 * 1024,
    headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest', Origin: BASE, Referer: page },
  }).catch(() => null);
  const url = typeof data?.embed_url === 'string' ? data.embed_url.trim() : '';
  return /^https?:\/\//.test(url) ? url : null;
}

async function searchTubeOnline(_query, resolved, queryTitle, timeoutMs = config.streamProviderTimeoutMs) {
  if (!resolved) return { skipped: 'identity-required' };
  if (queryTitle && queryTitle !== resolved.title) return { skipped: 'alternative-already-checked' };
  const series = resolved.mediaType === 'series';
  if (series && !(resolved.season > 0 && resolved.episode > 0)) return { skipped: 'episode-required' };
  const year = yearOf(resolved.year);
  const titles = [resolved.title, resolved.altTitle].map((t) => String(t || '').trim()).filter(Boolean);
  if (!titles.length) return { skipped: 'identity-required' };
  const http = providerHttp(timeoutMs, 7);
  const section = series ? 'serie' : 'pelicula';
  const pages = [];
  for (const title of titles.slice(0, 2)) {
    const slug = slugify(title);
    if (!slug) continue;
    pages.push(`${BASE}/${section}/${slug}/`);
    if (!series && year) pages.push(`${BASE}/${section}/${slug}-${year}/`);
  }
  for (const page of [...new Set(pages)]) {
    let html;
    try { html = await http.text(page, { headers: HEADERS, maxBytes: 2 * 1024 * 1024 }); }
    catch (err) { if (err.status === 404 || err.status === 410) continue; throw err; }
    let $ = load(html);
    if (!matchDetail($, resolved)) continue;
    let target = page;
    if (series) {
      const episode = episodeLink($, resolved.season, resolved.episode);
      if (!episode) return { hits: [], reason: 'no-episode-link' };
      target = episode;
      try { html = await http.text(episode, { headers: { ...HEADERS, Referer: page }, maxBytes: 2 * 1024 * 1024 }); }
      catch (err) { if (err.status === 404 || err.status === 410) return { hits: [], reason: 'no-episode-link' }; throw err; }
      $ = load(html);
    }
    const options = playerOptions($).slice(0, 6);
    if (!options.length) return { hits: [], reason: 'no-players' };
    const hits = [];
    const notes = { opaque: 0, extracted: 0, unsupported: 0 };
    for (const option of options) {
      const embed = await ajaxEmbed(http, option, target);
      if (!embed) { notes.unsupported += 1; continue; }
      const kind = extractorFor(embed);
      if (!kind || kind === 'opaque') { notes.opaque += 1; continue; }
      const extracted = await extractEmbed(embed, { timeoutMs, referer: target });
      if (!extracted.ok) { notes.unsupported += 1; continue; }
      notes.extracted += 1;
      const label = option.audio || extracted.audioLabel || '';
      for (const source of extracted.sources) {
        hits.push({ provider: 'tubeonline', title: `${resolved.title}${series ? ` S${resolved.season}E${resolved.episode}` : ''} TubeOnLine`,
          url: source.url, quality: source.kind === 'mp4' ? 'MP4' : 'HLS', resolution: null, audioLabel: label,
          ...(extracted.subtitles?.length ? { subtitles: extracted.subtitles } : {}) });
      }
      if (hits.length >= 3) break;
    }
    if (hits.length) return { hits };
    return { hits: [], reason: 'no-extractable-embed', notes };
  }
  return { hits: [], reason: 'no-match' };
}

module.exports = { BASE, AJAX, slugify, matchDetail, episodeLink, playerOptions, ajaxEmbed, searchTubeOnline, FLAG_AUDIO };
