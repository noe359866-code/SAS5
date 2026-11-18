'use strict';

// Solo fichas públicas y enlaces exactos publicados dentro de ellas.
// No visita la búsqueda, APIs, descargas ni destinos de iframes. No ejecuta JS.
const { appendFileSync } = require('node:fs');
const { load } = require('cheerio');
const { providerHttp } = require('../lib/providerHttp');
const { BASE, EXCLUDED, VIDEO_SOURCES, norm, episodeLink, matchingEpisode } = require('../lib/gnulahd');
const { activeProviders, runProviders } = require('../lib/streams');
const { inspectInline } = require('./gnulahd-inspect');
const { annotate } = require('./providers-live');
const controls = [
  { title: 'Matrix', year: 1999, slug: 'matrix' },
  { title: 'El Origen', year: 2010, slug: 'el-origen' },
  { title: 'La Odisea', year: 2026, slug: 'la-odisea-2026' },
  { title: 'Marrow', year: 2026, slug: 'marrow' },
  { title: 'Breaking Bad', year: 2008, slug: 'breaking-bad', season: 2, episode: 3 },
  { title: 'VisionQuest', year: 2026, slug: 'visionquest', season: 1, episode: 2 },
];
const unique = (values, max = 8) => [...new Set(values)].slice(0, max).join(', ') || '—';
const ext = /\.(?:m3u8|mp4|m4v|webm)$/i;
const localizedAudio = /^(?:latino|castellano|subtitulado)$/i;

function httpsUrl(raw, page) {
  if (!raw) return null;
  try {
    const url = new URL(raw, page);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url : null;
  } catch { return null; }
}

function inspectPlayer($, page) {
  const rows = (selector) => $(selector).toArray().filter((node) => !$(node).closest(EXCLUDED).length);
  const video = rows('video');
  const sources = rows(VIDEO_SOURCES);
  const media = sources.map((node) => {
    const el = $(node);
    const url = httpsUrl(el.attr('data-src') || el.attr('src'), page);
    const group = el.closest('[data-lang],[data-language]');
    const audio = group.attr('data-lang') || group.attr('data-language') || '';
    return url && ext.test(url.pathname) ? `${url.hostname}${ext.exec(url.pathname)[0]}${localizedAudio.test(audio) ? ` (${audio})` : ''}` : null;
  }).filter(Boolean);
  const frames = rows('iframe');
  const hosts = frames.map((node) => httpsUrl($(node).attr('data-src') || $(node).attr('src'), page)?.hostname || 'sin URL HTTPS');
  const labels = rows('button,option,[role="option"],[role="menuitemradio"]').map((node) => $(node).text().replace(/^\s*✓\s*/, '').trim()).filter((text) => localizedAudio.test(text));
  const body = $('body').clone();
  body.find(`script,style,${EXCLUDED}`).remove();
  const text = body.text().replace(/\s+/g, ' ');
  const shell = ['Haz clic para reproducir', 'Cargando servidores'].filter((phrase) => text.includes(phrase));
  const attrs = rows('[data-src],[data-video],[data-url],[data-embed],[data-lang],[data-language],[data-player],[data-post],[data-server],[data-servers]')
    .flatMap((node) => Object.keys(node.attribs)).filter((name) => /^data-[a-z-]{1,35}$/.test(name));
  const scripts = $('script:not([src])').toArray().map((node) => $(node).html() || '').join('\n').replace(/\\\//g, '/');
  const fields = ['sources', 'player', 'servers', 'embeds', 'gnula', 'nonce', 'admin-ajax', 'hls', 'videojs', 'jwplayer', 'playlist', 'atob']
    .filter((field) => new RegExp(`\\b${field}\\b`, 'i').test(scripts));
  const literals = [...scripts.matchAll(/["'](https:\/\/[^'"<>\s\\]{1,2048})["']/gi)].map((match) => httpsUrl(match[1], page))
    .filter((url) => url && ext.test(url.pathname)).map((url) => url.hostname + ext.exec(url.pathname)[0]);
  return `etiquetas de vídeo=${video.length}; fuentes HTML de vídeo=${sources.length}; URL en vídeo=${unique(media)}; `
    + `iframes=${frames.length} (${unique(hosts)}); controles de audio HTML=${unique(labels)}; avisos HTML=${unique(shell)}; `
    + `atributos=${unique(attrs)}; JS=${unique(fields)}; literales sin verificar=${unique(literals)}; ${inspectInline($, page)}`;
}

async function probe(fixture, http = providerHttp(7000)) {
  const show = `${BASE}/ver/${fixture.slug}/`;
  const get = async (url) => load(await http.text(url, { headers: { Accept: 'text/html' }, maxBytes: 2 * 1024 * 1024 }));
  const $ = await get(show);
  const title = $('title').first().text();
  if (norm($('h1').first().text()) !== norm(fixture.title) || !title.includes(`(${fixture.year})`)) return 'ficha sin identidad confirmada';
  if (!fixture.season) return `película identificada; ${inspectPlayer($, show)}`;
  const page = episodeLink($, show, fixture.season, fixture.episode);
  if (!page) return 'serie identificada; sin enlace al episodio exacto';
  const player = await get(page);
  if (!matchingEpisode(player, page, show, [norm(fixture.title)], fixture.season, fixture.episode)) return 'serie identificada; identidad del episodio no confirmada';
  return `episodio exacto identificado; ${inspectPlayer(player, page)}`;
}

async function probeAdapter(fixture) {
  if (!activeProviders(null).includes('gnulahd')) return 'fuente desactivada en el despliegue';
  const resolved = { ...fixture, mediaType: fixture.season ? 'series' : 'movie' };
  const report = {};
  const hits = await runProviders(['gnulahd'], fixture.title, resolved, fixture.title, report);
  const result = report.gnulahd;
  const state = result.reason || result.skipped || (result.paused ? 'pausado' : 'medio HLS validado');
  return `${state}; HTTP=${result.status || '—'}; aceptados=${result.accepted || 0}; formato=${unique(hits.map((hit) => hit.quality))}`;
}

async function main(mode) {
  if (mode && mode !== 'adapter') throw new Error('Modo de sonda no válido');
  const adapter = mode === 'adapter';
  const run = adapter ? probeAdapter : probe;
  const rows = [];
  for (const fixture of controls) {
    const label = `${fixture.title}${fixture.season ? ` T${fixture.season}E${fixture.episode}` : ''}`;
    const result = await run(fixture).catch((err) => err.challenge ? 'desafío' : err.status ? `HTTP ${err.status}` : err.timeout ? 'plazo agotado' : 'error de red o formato');
    annotate(`GnulaHD${adapter ? ' (adaptador)' : ''} / ${label}`, result);
    rows.push(`| ${label} | ${result} |`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    `### GnulaHD (${adapter ? 'adaptador experimental' : 'inspección estática'})`, '', '| Control | Resultado |', '|---|---|', ...rows, '',
    adapter ? 'La validación del manifiesto no prueba audio o reproducción en Stremio.' : 'Huellas del HTML, no prueba de acceso al medio, audio o reproducción.', '',
  ].join('\n'));
}

if (require.main === module) main(process.argv[2]).catch(() => { console.error('No se completó la sonda de GnulaHD'); process.exitCode = 1; });
module.exports = { probe };
