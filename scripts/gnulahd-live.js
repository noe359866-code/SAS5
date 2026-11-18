'use strict';

// Candidato: solo fichas públicas y enlaces exactos publicados dentro de ellas.
// No visita la búsqueda, APIs, descargas ni destinos de iframes. No ejecuta JS.
const { appendFileSync } = require('node:fs');
const { load } = require('cheerio');
const { providerHttp } = require('../lib/providerHttp');
const { inspectInline } = require('./gnulahd-inspect');
const { annotate } = require('./providers-live');

const BASE = 'https://ww3.gnulahd.nu';
const controls = [
  { title: 'Matrix', year: 1999, slug: 'matrix' },
  { title: 'El Origen', year: 2010, slug: 'el-origen' },
  { title: 'La Odisea', year: 2026, slug: 'la-odisea-2026' },
  { title: 'Marrow', year: 2026, slug: 'marrow' },
  { title: 'Breaking Bad', year: 2008, slug: 'breaking-bad', season: 2, episode: 3 },
  { title: 'VisionQuest', year: 2026, slug: 'visionquest', season: 1, episode: 2 },
];
const norm = (value) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const unique = (values, max = 8) => [...new Set(values)].slice(0, max).join(', ') || '—';
const ext = /\.(?:m3u8|mp4|m4v|webm)$/i;
const excluded = '[download], [class*="trailer" i], [id*="trailer" i], [class*="download" i], [id*="download" i]';
const localizedAudio = /^(?:latino|castellano|subtitulado)$/i;

function httpsUrl(raw, page) {
  if (!raw) return null;
  try {
    const url = new URL(raw, page);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url : null;
  } catch { return null; }
}

function localLink(raw, page) {
  const url = httpsUrl(raw, page);
  return url?.origin === BASE && !url.search && !url.hash ? url : null;
}

function episodeLink($, page, fixture) {
  const matches = new Set();
  for (const el of $('a[href]').toArray()) {
    const url = localLink($(el).attr('href'), page);
    const match = url && /^\/([a-z0-9-]+)-(\d+)x(\d+)\/$/i.exec(url.pathname);
    if (match && match[1] === fixture.slug && Number(match[2]) === fixture.season && Number(match[3]) === fixture.episode) matches.add(url.href);
  }
  return matches.size === 1 ? [...matches][0] : null;
}

function matchingEpisode($, page, show, fixture) {
  const label = /^\s*(?:ver\s+)?(.+?)\s+(\d+)[x×](\d+)\b/i.exec($('h1').first().text());
  return label && norm(label[1]) === norm(fixture.title) && Number(label[2]) === fixture.season && Number(label[3]) === fixture.episode
    && $('a[href]').toArray().some((el) => localLink($(el).attr('href'), page)?.href === show);
}

function inspectPlayer($, page) {
  const rows = (selector) => $(selector).toArray().filter((node) => !$(node).closest(excluded).length);
  const video = rows('video[src],video[data-src],video source[src],video source[data-src]');
  const media = video.map((node) => {
    const el = $(node);
    const url = httpsUrl(el.attr('data-src') || el.attr('src'), page);
    const group = el.closest('[data-lang],[data-language]');
    const audio = group.attr('data-lang') || group.attr('data-language') || '';
    return url && ext.test(url.pathname) ? `${url.hostname}${ext.exec(url.pathname)[0]}${localizedAudio.test(audio) ? ` (${audio})` : ''}` : null;
  }).filter(Boolean);
  const frames = rows('iframe');
  const hosts = frames.map((node) => httpsUrl($(node).attr('data-src') || $(node).attr('src'), page)?.hostname || 'sin URL HTTPS');
  const labels = $('button,option,[role="option"]').toArray().map((node) => $(node).text().trim()).filter((text) => localizedAudio.test(text));
  const attrs = rows('[data-src],[data-video],[data-url],[data-embed],[data-lang],[data-language],[data-player],[data-post],[data-server],[data-servers]')
    .flatMap((node) => Object.keys(node.attribs)).filter((name) => /^data-[a-z-]{1,35}$/.test(name));
  const scripts = $('script:not([src])').toArray().map((node) => $(node).html() || '').join('\n').replace(/\\\//g, '/');
  const fields = ['sources', 'player', 'servers', 'embeds', 'gnula', 'nonce', 'admin-ajax', 'hls', 'videojs', 'jwplayer', 'playlist', 'atob']
    .filter((field) => new RegExp(`\\b${field}\\b`, 'i').test(scripts));
  const literals = [...scripts.matchAll(/["'](https:\/\/[^'"<>\s\\]{1,2048})["']/gi)].map((match) => httpsUrl(match[1], page))
    .filter((url) => url && ext.test(url.pathname)).map((url) => url.hostname + ext.exec(url.pathname)[0]);
  return `etiquetas de vídeo=${video.length}; URL en vídeo=${unique(media)}; iframes=${frames.length} (${unique(hosts)}); menú=${unique(labels)}; atributos=${unique(attrs)}; JS=${unique(fields)}; literales sin verificar=${unique(literals)}; ${inspectInline($, page)}`;
}

async function probe(fixture, http = providerHttp(7000)) {
  const show = `${BASE}/ver/${fixture.slug}/`;
  const get = async (url) => load(await http.text(url, { headers: { Accept: 'text/html' }, maxBytes: 2 * 1024 * 1024 }));
  const $ = await get(show);
  const title = $('title').first().text();
  if (norm($('h1').first().text()) !== norm(fixture.title) || !title.includes(`(${fixture.year})`)) return 'ficha sin identidad confirmada';
  if (!fixture.season) return `película identificada; ${inspectPlayer($, show)}`;
  const page = episodeLink($, show, fixture);
  if (!page) return 'serie identificada; sin enlace al episodio exacto';
  const player = await get(page);
  if (!matchingEpisode(player, page, show, fixture)) return 'serie identificada; identidad del episodio no confirmada';
  return `episodio exacto identificado; ${inspectPlayer(player, page)}`;
}

async function main() {
  const rows = [];
  for (const fixture of controls) {
    const label = `${fixture.title}${fixture.season ? ` T${fixture.season}E${fixture.episode}` : ''}`;
    const result = await probe(fixture).catch((err) => err.challenge ? 'desafío' : err.status ? `HTTP ${err.status}` : err.timeout ? 'plazo agotado' : 'error de red o formato');
    annotate(`GnulaHD / ${label}`, result);
    rows.push(`| ${label} | ${result} |`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    '### GnulaHD (candidato)', '', '| Control | Resultado |', '|---|---|', ...rows, '',
    'Huellas del HTML, no prueba de acceso al medio, audio o reproducción. No modifica el registro activo.', '',
  ].join('\n'));
}

if (require.main === module) main().catch(() => { console.error('No se completó la sonda de GnulaHD'); process.exitCode = 1; });
module.exports = { probe };
