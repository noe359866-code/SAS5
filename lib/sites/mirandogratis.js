'use strict';

/**
 * mirandogratis.com — WordPress clásico, fichas planas `/<slug>.html`.
 *
 * Estructura medida el 19-11-2026:
 *   ficha `/<slug>.html` con pestañas `#opzero`, `#op0`, `#op1`… y un bloque
 *   `<div class="mejs-container">` por opción; el enlace real va en un `<iframe>`
 *   a un visor (Byse y MixDrop en los dos títulos revisados).
 *   El texto `Audio: Subtitulado|Latino|Castellano` de la ficha describe la
 *   opción por defecto; cada iframe puede ser otro idioma.
 *
 * Ventaja: no hay que adivinar IDs. El slug se deduce del título y, si la ficha
 * responde, la comprobación de identidad es por `h1` + año del bloque de info.
 */

const { load } = require('cheerio');
const config = require('../config');
const { providerHttp, isNotFound } = require('../providerHttp');
const { extractEmbed, extractorFor, UA } = require('../extractors');
const { normalizeMediaUrl } = require('../mediaParse');
const { titleScore, yearOf } = require('../providerTitles');

const BASE = 'https://mirandogratis.com';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };

const slugify = (title) => String(title || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** `Audio: Latino` del bloque de información (no el SEO). */
function declaredAudio($) {
  // El bloque de información es `<b>Audio</b>: <span>Latino</span>`; se lee
  // del HTML (no del texto plano) para quedarse con el valor, no con la lista.
  const block = /Audio\s*<\/b>\s*:?\s*(?:<[^>]+>)*\s*([^<]{2,40})/i.exec($.html() || '');
  const value = block?.[1] || /Audio\s*:?\s*([^\n<]{2,40})/i.exec($('body').text())?.[1] || '';
  if (/latino/i.test(value)) return 'Latino';
  if (/castellano/i.test(value)) return 'Castellano';
  if (/subtitulad/i.test(value)) return 'Subtitulado';
  return '';
}

function matchDetail($, resolved) {
  // «Ver Pelicula El reino prohibido Online Gratis en Español Latino Completa»
  const heading = $('h1').first().text().replace(/\s+/g, ' ')
    .replace(/^\s*Ver\s+(?:Pelicula|Pel[íi]cula)?\s*/i, '')
    .replace(/\s+Online.*$/i, '')
    .replace(/\s+(?:Gratis|Completa|en Espa[ñn]ol.*)$/i, '')
    .trim();
  const title = $('.TITULO, .titulo, h2.titulo').first().text().trim();
  const names = [heading, title, $('meta[property="og:title"]').attr('content') || ''];
  if (titleScore(names, [resolved.title, resolved.altTitle]) === 0) return false;
  const body = $('body').text().slice(0, 60_000);
  const year = yearOf(/A[ñn]o\s*:?\s*((?:19|20)\d{2})/i.exec(body)?.[1]);
  const wanted = yearOf(resolved.year);
  return wanted ? year === wanted : Boolean(year);
}

/** Iframes de las opciones (`#opzero`, `#op0`, …), sin YouTube ni publicidad. */
function playerFrames($, page) {
  const out = [];
  for (const el of $('[id^="op"] iframe[src], iframe[src]').toArray()) {
    const url = normalizeMediaUrl($(el).attr('src'), page);
    if (!url) continue;
    const host = new URL(url).hostname;
    if (/(?:^|\.)(?:youtube|youtu|facebook|twitter|google)\./.test(host)) continue;
    if (!out.some((item) => item.url === url)) out.push({ url, host });
    if (out.length >= 4) break;
  }
  return out;
}

async function searchMirandoGratis(_query, resolved, queryTitle, timeoutMs = config.streamProviderTimeoutMs) {
  if (!resolved) return { skipped: 'identity-required' };
  if (queryTitle && queryTitle !== resolved.title) return { skipped: 'alternative-already-checked' };
  if (resolved.mediaType !== 'movie') return { skipped: 'series-not-supported' };
  const year = yearOf(resolved.year);
  const titles = [resolved.title, resolved.altTitle].map((t) => String(t || '').trim()).filter(Boolean);
  if (!titles.length) return { skipped: 'identity-required' };
  const http = providerHttp(timeoutMs, 6);
  // 1) Slug deducido del título. 2) Buscador de WordPress (`/?s=`), que lista
  // las fichas `/<slug>.html` cuando el slug no se adivina (p. ej. con año).
  const pages = [...new Set(titles.slice(0, 2).map((title) => `${BASE}/${slugify(title)}.html`))].filter((url) => url !== `${BASE}/.html`);
  for (const title of titles.slice(0, 1)) {
    const search = await http.text(`${BASE}/?s=${encodeURIComponent(title)}`, { headers: HEADERS, maxBytes: 2 * 1024 * 1024 }).catch(() => '');
    if (search) pages.push(...searchLinks(search, resolved));
  }
  for (const page of [...new Set(pages)]) {
    let html;
    try { html = await http.text(page, { headers: HEADERS, maxBytes: 2 * 1024 * 1024 }); }
    catch (err) { if (isNotFound(err, page)) continue; throw err; }
    const $ = load(html);
    if (!matchDetail($, resolved)) continue;
    const audio = declaredAudio($);
    const frames = playerFrames($, page);
    if (!frames.length) return { hits: [], reason: 'no-players' };
    const hits = [];
    const notes = { opaque: 0, extracted: 0, unsupported: 0 };
    for (const frame of frames) {
      const kind = extractorFor(frame.url);
      if (!kind || kind === 'opaque') { notes.opaque += 1; continue; }
      const extracted = await extractEmbed(frame.url, { timeoutMs, referer: page });
      if (!extracted.ok) { notes.unsupported += 1; continue; }
      notes.extracted += 1;
      for (const source of extracted.sources) {
        hits.push({ provider: 'mirandogratis', title: `${resolved.title} MirandoGratis`, url: source.url,
          ...(source.kind === 'hls' ? { playbackOrigin: new URL(frame.url).origin } : {}),
          quality: source.kind === 'mp4' ? 'MP4' : 'HLS', resolution: null, audioLabel: audio || extracted.audioLabel || '',
          ...(extracted.subtitles?.length ? { subtitles: extracted.subtitles } : {}) });
      }
      if (hits.length >= 3) break;
    }
    if (hits.length) return { hits };
    return { hits: [], reason: 'no-extractable-embed', notes };
  }
  return { hits: [], reason: 'no-match', year };
}

/**
 * Enlaces de ficha del buscador de WordPress (`/?s=`): `/<slug>.html` con
 * coincidencia de título. El slug deducido falla cuando el sitio añade el año
 * o un sufijo; el buscador sí lista la ficha real.
 */
function searchLinks(html, resolved) {
  const $ = load(html);
  const wanted = [resolved.title, resolved.altTitle].map((value) => String(value || '').trim()).filter(Boolean);
  const found = [];
  for (const el of $('a[href]').toArray()) {
    const url = new URL($(el).attr('href') || '/', BASE);
    if (url.origin !== BASE || !/^\/[a-z0-9-]+\.html$/.test(url.pathname)) continue;
    const label = $(el).attr('title') || $(el).text() || $(el).find('img').attr('alt') || '';
    if (titleScore([label], wanted) === 0) continue;
    if (!found.includes(url.href)) found.push(url.href);
    if (found.length >= 3) break;
  }
  return found;
}

module.exports = { BASE, slugify, declaredAudio, matchDetail, playerFrames, searchLinks, searchMirandoGratis };
