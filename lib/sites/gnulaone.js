'use strict';

/**
 * ver.gnula.one — WordPress con fichas `/movies/<slug>/` y `/tvshows/<slug>/`.
 *
 * Estructura medida en la sonda del 19-11-2026:
 *   ficha de película → `/movies/<slug>/` con enlaces `?trembed=N&trid=<id>&trtype=1`
 *   ese enlace → HTML mínimo con un `<iframe>` a `links.fiuxy2.com/play/…`
 *   ese hub     → botones `data-src="https://<visor>/e/…"` (Streamwish, Vidhide, Voe…)
 *
 * Aquí se publican las fuentes de los visores que el addon sabe extraer; los
 * demás se cuentan como `opaque-player` y no gastan peticiones.
 *
 * Series: la página de la serie no lista episodios en el HTML (se cargan por
 * JS). Cuando la ficha no expone el episodio, se devuelve `series-needs-js`
 * en vez de inventar una URL.
 */

const { load } = require('cheerio');
const config = require('../config');
const { providerHttp } = require('../providerHttp');
const { extractEmbed, extractorFor, UA } = require('../extractors');
const { normalizeMediaUrl, mediaKind } = require('../mediaParse');
const { titleScore, titleQueries, yearOf } = require('../providerTitles');

const BASE = 'https://ver.gnula.one';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };

const slugify = (title) => String(title || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Candidatos de ficha sin buscador: el slug se deduce del título y del año. */
function candidatePages(titles, year, mediaType) {
  const section = mediaType === 'series' ? 'tvshows' : 'movies';
  const pages = new Set();
  for (const title of titles.slice(0, 2)) {
    const slug = slugify(title);
    if (!slug || slug.length > 90) continue;
    pages.add(`${BASE}/${section}/${slug}/`);
    if (year) pages.add(`${BASE}/${section}/${slug}-${year}/`);
  }
  return [...pages];
}

/** Ficha: título del `h1`, año y `og:type`/JSON-LD para no confundir homónimos. */
function matchDetail($, titles, year, mediaType) {
  const heading = $('h1').first().text().replace(/^Ver\s+|\s+online$/gi, '').trim();
  const clean = heading.replace(/\s*\((?:19|20)\d{2}\)(?:.*)?$/i, '').trim();
  if (titleScore([clean, heading], titles) === 0) return false;
  const body = $('body').text().slice(0, 400_000);
  const declaredYear = yearOf(/((?:19|20)\d{2})/.exec(body)?.[1]);
  if (year && declaredYear && declaredYear !== yearOf(year)) return false;
  const wantsSeries = mediaType === 'series';
  const looksSeries = /\/(?:tvshows)\//.test($('link[rel="canonical"]').attr('href') || '')
    || $('meta[property="og:type"]').attr('content') === 'video.tv_show';
  if (looksSeries !== wantsSeries && $('meta[property="og:type"]').attr('content')) return false;
  return true;
}

/** Todos los `?trembed=…` de la ficha, en orden y sin repetir. */
function embedLinks($, page) {
  const links = new Map();
  for (const el of $('a[href*="trembed="]').toArray()) {
    const href = $(el).attr('href');
    const url = normalizeMediaUrl(href, page);
    if (!url) continue;
    const parsed = new URL(url);
    if (parsed.origin !== BASE) continue;
    const trid = parsed.searchParams.get('trid');
    if (!trid || !/^\d+$/.test(trid)) continue;
    // El texto del enlace («Latino · Voe») identifica idioma y visor.
    links.set(`${trid}:${parsed.searchParams.get('trembed')}`, { url, label: $(el).text().trim().slice(0, 40) });
  }
  return [...links.values()];
}

function audioFromLink(label) {
  const text = String(label || '').toLowerCase();
  if (/\blat(?:ino)?\b/.test(text)) return 'Latino';
  if (/\bcastellano|\bcast\b|\besp\b/.test(text)) return 'Castellano';
  return '';
}

/** El enlace trembed devuelve HTML con un iframe (hub) o un medio directo. */
function followEmbed(html, page) {
  const $ = load(html);
  const frame = $('iframe[src]').first().attr('src');
  const direct = $('video source[src], video[src]').first().attr('src');
  const src = frame || direct;
  const url = normalizeMediaUrl(src, page);
  return url ? { url, direct: mediaKind(url) } : null;
}

/** Hub de Fiuxy: botones `data-src="visor#idioma"`. */
function hubLinks(html, page) {
  const $ = load(html);
  const out = [];
  for (const el of $('[data-src]').toArray()) {
    const raw = $(el).attr('data-src') || '';
    if (!/^https?:\/\//.test(raw)) continue;
    const [link, ...rest] = raw.split('#');
    const url = normalizeMediaUrl(link, page);
    if (!url || url === page) continue;
    const audio = audioFromLink(rest.join(' ') || $(el).text());
    out.push({ url, audio, host: new URL(url).hostname });
  }
  // Respuesta intermedia que solo trae el `<iframe>` del hub (`links.*`).
  if (!out.length) {
    const frame = normalizeMediaUrl($('iframe[src]').first().attr('src'), page);
    if (frame && frame !== page) out.push({ url: frame, audio: '', host: new URL(frame).hostname, iframe: true });
  }
  return out;
}

async function searchGnulaOne(_query, resolved, queryTitle, timeoutMs = config.streamProviderTimeoutMs) {
  if (!resolved) return { skipped: 'identity-required' };
  if (queryTitle && queryTitle !== resolved.title) return { skipped: 'alternative-already-checked' };
  if (resolved.mediaType === 'series') return { skipped: 'series-needs-js' };
  const year = yearOf(resolved.year);
  const titles = [resolved.title, resolved.altTitle].map((t) => String(t || '').trim()).filter(Boolean);
  if (!titles.length) return { skipped: 'identity-required' };

  const http = providerHttp(timeoutMs, 6);
  let matched = false;
  for (const page of candidatePages(titles, year, resolved.mediaType)) {
    let html;
    try { html = await http.text(page, { headers: HEADERS, maxBytes: 2 * 1024 * 1024 }); }
    catch (err) { if (err.status === 404 || err.status === 410) continue; throw err; }
    const $ = load(html);
    if (!matchDetail($, titles, resolved.year, resolved.mediaType)) continue;
    matched = true;
    const hits = [];
    const notes = { opaque: 0, extracted: 0, unsupported: 0 };
    for (const link of embedLinks($, page).slice(0, 6)) {
      let targets = [];
      const hop = await http.text(link.url, { headers: { ...HEADERS, Referer: page }, maxBytes: 512 * 1024 }).catch(() => '');
      // El enlace `trembed` puede devolver: (a) el medio directo, (b) un
      // `<iframe>` a un hub `links.*` o (c) el hub ya con `data-src`.
      const direct = followEmbed(hop, link.url);
      if (direct?.direct) {
        targets = [{ url: direct.url, audio: link.audio }];
      } else {
        const hub = hubLinks(hop, link.url);
        const nested = hub.filter((item) => item.iframe || /\/play\//i.test(new URL(item.url).pathname));
        targets = hub.filter((item) => !nested.includes(item)).map((item) => ({ url: item.url, audio: item.audio || link.audio }));
        for (const hop2 of nested.slice(0, 1)) {
          const inner = await http.text(hop2.url, { headers: { ...HEADERS, Referer: link.url }, maxBytes: 512 * 1024 }).catch(() => '');
          targets.push(...hubLinks(inner, hop2.url).map((item) => ({ url: item.url, audio: item.audio || link.audio })));
        }
      }
      if (!targets.length) { notes.unsupported += 1; continue; }
      for (const target of targets.slice(0, 4)) {
        const kind = extractorFor(target.url);
        if (!kind || kind === 'opaque') { notes.opaque += 1; continue; }
        const extracted = await extractEmbed(target.url, { timeoutMs, referer: link.url });
        if (!extracted.ok) { notes.unsupported += 1; continue; }
        notes.extracted += 1;
        for (const source of extracted.sources) {
          if (hits.some((hit) => hit.url === source.url)) continue;
          hits.push({
            provider: 'gnulaone', title: `${resolved.title} Gnula`, url: source.url,
            quality: source.kind === 'mp4' ? 'MP4' : 'HLS', resolution: null,
            audioLabel: target.audio || extracted.audioLabel || '',
            ...(extracted.subtitles?.length ? { subtitles: extracted.subtitles } : {}),
          });
        }
      }
      if (hits.length >= 4) break;
    }
    if (hits.length) return { hits };
    return { hits: [], reason: 'no-extractable-embed', notes };
  }
  return { hits: [], reason: matched ? 'no-embed' : 'no-match' };
}

/** Botones del hub (exportado para pruebas con HTML real). */
module.exports = { BASE, slugify, candidatePages, embedLinks, hubLinks, followEmbed, audioFromLink, matchDetail, searchGnulaOne };
