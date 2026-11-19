'use strict';

/**
 * verpeliculasultra.com — DataLife Engine (DLE).
 *
 * Estructura medida el 19-11-2026:
 *   ficha `/accion/5276-hope.html` (categoría + `id-slug.html`)
 *   pestañas `#ts21` (Latino), `#ts2` (Esp), `#ts31` (Subtitulada), `#ts3` (Sub)
 *   cada pestaña → `<div class="mejs-container play-btn-cont" data-src="<visor>">`
 *   los visores vistos: hgcloud/hglink (descartados), powvideo (Cloudflare 403),
 *   vpge.link (Videohel, extraíble) y, en algunos títulos, streamtape.
 *
 * Solo películas: el sitio no publica un índice de series estable (la ruta
 * `/xfsearch/series/` devolvió 404 en la sonda).
 */

const { load } = require('cheerio');
const config = require('../config');
const { providerHttp } = require('../providerHttp');
const { extractEmbed, extractorFor, UA } = require('../extractors');
const { normalizeMediaUrl } = require('../mediaParse');
const { titleScore, yearOf } = require('../providerTitles');

const BASE = 'https://verpeliculasultra.com';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
// DLE: el buscador propio es un POST al propio sitio con
// `do=search&subaction=search&story=<título>` (el formulario de la cabecera
// usa `action="#"`). Devuelve las fichas con su URL `<cat>/<id>-<slug>.html`.
// `/xfsearch/peliculas-<año>/` NO es un buscador: es la portada con estrenos.
const SECTION_BY_GENRE = ['accion', 'animacion', 'aventura', 'biografico', 'ciencia-ficcion', 'comedia', 'crimen',
  'deportes', 'documental', 'drama', 'familiar', 'fantasia', 'guerra', 'historico', 'misterio', 'musical',
  'romantico', 'suspense', 'terror', 'western', 'estrenos'];

const TABS = { ts21: 'Latino', ts2: 'Español', ts31: 'Subtitulada', ts3: 'Subtitulada', ts11: 'Español', ts1: 'Español',
  ts22: 'Latino', ts2_1: 'Latino' };

/** Pestañas presentes y su idioma, en el orden del documento. */
function tabLang(id) {
  return TABS[id] || '';
}

/**
 * Alterna la pestaña con su bloque. Cada bloque `#ts<N>` puede traer un
 * `data-src` (visor) o un `iframe` ya resuelto.
 */
function playerBlocks($, page) {
  const out = [];
  for (const el of $('[id^="ts"]').toArray()) {
    const node = $(el);
    const id = node.attr('id') || '';
    if (!/^ts\d+$/.test(id)) continue;
    const language = tabLang(id);
    if (!language) continue;
    const holder = node.find('[data-src], iframe[src], video source[src]').first();
    const raw = holder.attr('data-src') || holder.attr('src');
    const url = normalizeMediaUrl(raw, page);
    if (url) out.push({ url, language, tab: id });
  }
  return out;
}

/**
 * Identidad de la ficha: `<h1>Ver Hope (2026) Online Gratis</h1>` y, en el
 * bloque `.f-info`, `Título:` / `Título original:` / `Año:` con selectores
 * propios. No basta el `<title>`: el SEO del sitio escribe «Español Latino»
 * en títulos que solo traen subtítulos.
 */
function infoValue($, label) {
  for (const title of $('.f-info-title').toArray()) {
    if (!new RegExp(`^${label}\\s*:?$`, 'i').test($(title).text().trim())) continue;
    const value = $(title).next('.f-info-text').text().trim();
    if (value) return value;
  }
  return '';
}

function matchMovie($, resolved) {
  const heading = $('h1').first().text().replace(/^Ver\s+/i, '').replace(/\s+Online Gratis.*$/i, '').trim();
  const title = infoValue($, 'Título') || heading.replace(/\s*\((?:19|20)\d{2}\).*$/, '').trim();
  const original = infoValue($, 'Título original');
  if (titleScore([title, original], [resolved.title, resolved.altTitle]) === 0) return false;
  const year = yearOf(infoValue($, 'Año')) || yearOf(/\((?:19|20)\d{2}\)/.exec(heading)?.[0]);
  const wanted = yearOf(resolved.year);
  // Un año explícito en la ficha manda; si no lo hay, el título ya coincidió.
  return wanted ? year === wanted : Boolean(year);
}

/** Rutas candidatas cuando no hay buscador utilizable: la ficha por id no se puede adivinar. */
function candidateUrls(resolved) {
  const year = yearOf(resolved.year);
  if (!year) return [];
  // El sitio publica un buscador de año (`/xfsearch/peliculas-<año>/`) que sí
  // responde con el listado completo; de ahí se elige por título y año.
  return [`${BASE}/xfsearch/peliculas-${year}/`];
}

function listingMatches(html, resolved) {
  const $ = load(html);
  const wanted = [resolved.title, resolved.altTitle].map((t) => String(t || '').trim()).filter(Boolean);
  const found = new Set();
  for (const el of $('a[href]').toArray()) {
    const href = $(el).attr('href') || '';
    const url = normalizeMediaUrl(href, BASE);
    if (!url || !/^https:\/\/verpeliculasultra\.com\/[a-z-]+\/\d+-[a-z0-9-]+\.html$/.test(url)) continue;
    const label = $(el).attr('title') || $(el).text();
    if (titleScore([label, $(el).find('img').attr('title') || ''], wanted) > 0) found.add(url);
    if (found.size >= 2) break;
  }
  return [...found];
}

async function searchUltra(_query, resolved, queryTitle, timeoutMs = config.streamProviderTimeoutMs) {
  if (!resolved) return { skipped: 'identity-required' };
  if (queryTitle && queryTitle !== resolved.title) return { skipped: 'alternative-already-checked' };
  if (resolved.mediaType !== 'movie') return { skipped: 'series-not-supported' };
  const http = providerHttp(timeoutMs, 5);
  let matched = false;
  // 1) Buscador DLE (POST): devuelve las fichas que coinciden con el título.
  const listings = [];
  for (const title of [resolved.title, resolved.altTitle].filter(Boolean).slice(0, 2)) {
    const body = `do=search&subaction=search&story=${encodeURIComponent(title)}`;
    const html = await http.text(`${BASE}/`, { method: 'POST', body, maxBytes: 2 * 1024 * 1024,
      headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } }).catch(() => '');
    if (html) listings.push(html);
  }
  // 2) Respaldo: listado por año (la portada con estrenos de ese año).
  for (const listing of candidateUrls(resolved)) {
    const html = await http.text(listing, { headers: HEADERS, maxBytes: 2 * 1024 * 1024 }).catch(() => '');
    if (html) listings.push(html);
  }
  for (const html of listings) {
    for (const page of listingMatches(html, resolved).slice(0, 2)) {
      const detail = await http.text(page, { headers: HEADERS, maxBytes: 2 * 1024 * 1024 });
      const $ = load(detail);
      if (!matchMovie($, resolved)) continue;
      matched = true;
      const hits = [];
      const notes = { opaque: 0, extracted: 0, unsupported: 0 };
      for (const block of playerBlocks($, page).slice(0, 4)) {
        const kind = extractorFor(block.url);
        if (!kind || kind === 'opaque') { notes.opaque += 1; continue; }
        const extracted = await extractEmbed(block.url, { timeoutMs, referer: page });
        if (!extracted.ok) { notes.unsupported += 1; continue; }
        notes.extracted += 1;
        for (const source of extracted.sources) {
          hits.push({ provider: 'ultra', title: `${resolved.title} Ultra`, url: source.url,
            quality: source.kind === 'mp4' ? 'MP4' : 'HLS', resolution: null, audioLabel: block.language,
            ...(extracted.subtitles?.length ? { subtitles: extracted.subtitles } : {}) });
        }
        if (hits.length >= 3) break;
      }
      if (hits.length) return { hits };
      return { hits: [], reason: 'no-extractable-embed', notes };
    }
  }
  return { hits: [], reason: matched ? 'no-embed' : 'no-match' };
}

module.exports = { BASE, SECTION_BY_GENRE, TABS, tabLang, playerBlocks, matchMovie, listingMatches, candidateUrls, searchUltra };
