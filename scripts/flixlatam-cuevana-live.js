'use strict';

// Controles aislados: nunca se usa otra fuente para completar un resultado.
// No se escribe HTML/JSON del proveedor, firmas ni URLs de vídeo en los logs.
const { appendFileSync } = require('node:fs');
const { load } = require('cheerio');
const { runProviders } = require('../lib/streams');
const { fetchText } = require('../lib/http');
const { annotate, probeMedia } = require('./providers-live');

const breakingBad = { title: 'Breaking Bad', year: '2008', imdbId: 'tt0903747', tmdbId: 1396, mediaType: 'series', season: 1, episode: 2 };
const matrix = { title: 'Matrix', altTitle: 'The Matrix', year: '1999', imdbId: 'tt0133093', tmdbId: 603, mediaType: 'movie' };
const controls = {
  flixlatam: [
    { ...matrix, page: 'https://flixlatam.com/pelicula/matrix' },
    { title: 'En Ruta de Escape', year: '2026', mediaType: 'movie', page: 'https://flixlatam.com/pelicula/en-ruta-de-escape-N6sitT' },
    { ...breakingBad, page: 'https://flixlatam.com/serie/breaking-bad' },
  ],
  cuevana3: [matrix, { title: 'El Efecto Mariposa', year: '2004', mediaType: 'movie' }, breakingBad],
};

const problem = (err) => err.challenge ? 'challenge' : err.status ? `HTTP ${err.status}` : err.timeout ? 'timeout' : 'error de red o formato';

async function inspectFlix(fixture) {
  const page = new URL(fixture.page);
  const get = (url, options = {}) => fetchText(url, { redirect: 'manual', timeoutMs: 5000, maxBytes: 512 * 1024, ...options });
  try {
    let html;
    let state = 'ficha';
    if (fixture.mediaType === 'series') {
      const [, type, slug] = page.pathname.split('/');
      const endpoint = `${page.origin}/api/episodio/${type}/${slug}/${fixture.season}/${fixture.episode}`;
      const data = JSON.parse(await get(endpoint, { headers: { Accept: 'application/json', Referer: page.href } }));
      if (data?.success !== true || data.type !== type || data.slug !== slug || data.temporada !== fixture.season
        || data.episodio !== fixture.episode || typeof data.html !== 'string' || !data.html.trim()) return 'Fragmento no identificado';
      html = data.html;
      state = 'fragmento del episodio exacto';
    } else {
      html = await get(page.href, { maxBytes: 2 * 1024 * 1024 });
    }
    const $ = load(html);
    const frames = $('iframe[src],iframe[data-src],iframe[srcdoc]').toArray().map((el) => {
      try {
        const url = new URL(el.attribs['data-src'] || el.attribs.src);
        return url.protocol === 'https:' ? url.hostname : 'sin URL HTTPS';
      } catch { return 'sin URL HTTPS'; }
    });
    const videos = $('video[src],video[data-src],video source[src],video source[data-src]').length;
    return `${state}; iframes=${frames.length} (${[...new Set(frames)].slice(0, 6).join(', ') || 'ninguno'}); etiquetas de vídeo=${videos}`;
  } catch (err) { return `${fixture.mediaType === 'series' ? 'fragmento' : 'ficha'}: ${problem(err)}`; }
}

async function main(key) {
  if (!Object.hasOwn(controls, key)) throw new Error('Usa flixlatam o cuevana3');
  const rows = [];
  for (const fixture of controls[key]) {
    const title = `${fixture.title}${fixture.season ? ` T${fixture.season}E${fixture.episode}` : ''}`;
    const report = {};
    const hits = await runProviders([key], fixture.title, fixture, fixture.title, report, undefined, { ignorePause: true });
    const entry = report[key];
    const cdnStatus = /^cdn-http-(\d{3})$/.exec(entry.reason || '')?.[1];
    const state = cdnStatus ? `manifiesto HLS: CDN HTTP ${cdnStatus}` : `${entry.reason || entry.skipped || 'medio aceptado'}${entry.status ? ` (HTTP ${entry.status})` : ''}`;
    const checks = await Promise.all(hits.slice(0, 2).map(async (hit) => `${hit.audioLabel} (${hit.verification || 'URL directa'}; ${await probeMedia(hit)})`));
    if (key === 'flixlatam' && !hits.length && !['challenge', 'access-denied', 'rate-limited'].includes(entry.reason)) checks.push(await inspectFlix(fixture));
    const note = checks.join('; ') || '—';
    annotate(`${key} / ${title}`, `${state}; aceptados=${entry.accepted || 0}; ${note}`);
    rows.push(`| ${title} | ${state} | ${entry.accepted || 0} | ${note.replace(/\|/g, '\\|')} |`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    `### ${key}`, '', '| Control | Resultado | Aceptados | Observaciones |', '|---|---|---:|---|', ...rows, '',
    'Sonda informativa desde Actions. La respuesta HTTP y las etiquetas no verifican reproducción ni audio en Stremio.', '',
  ].join('\n'));
}

main(process.argv[2]).catch(() => { console.error('No se completó la sonda enfocada'); process.exitCode = 1; });
