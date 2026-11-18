'use strict';

// Sonda de los adaptadores usados en producción, sin mocks ni claves de TMDB.
const { appendFileSync } = require('node:fs');
const { activeProviders, runProviders } = require('../lib/streams');
const { parseManifest } = require('../lib/hlsManifest');
const { fetchText } = require('../lib/http');
const { allowedVideoUrl, REFERER } = require('../lib/vimeos');

const fixtures = {
  peliculas: [
    { title: 'Matrix', altTitle: 'The Matrix', year: '1999', mediaType: 'movie', imdbId: 'tt0133093', tmdbId: 603,
      keys: ['fanpelis', 'spinflix'], control: true },
  ],
  series: [
    { title: 'Breaking Bad', year: '2008', mediaType: 'series', season: 1, episode: 1, imdbId: 'tt0903747', tmdbId: 1396,
      keys: ['fanpelis', 'spinflix'], control: true },
  ],
  extra: [
    { title: 'Mufasa: El rey león', altTitle: 'Mufasa: The Lion King', year: '2024', mediaType: 'movie',
      imdbId: 'tt13186482', keys: ['fanpelis', 'spinflix'] },
  ],
};

function annotate(title, message) {
  if (process.env.GITHUB_ACTIONS) {
    const escape = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.log(`::notice title=${escape(title).replace(/,/g, '%2C').replace(/:/g, '%3A')}::${escape(message)}`);
  } else console.log(`${title}: ${message}`);
}

function summarize(entry) {
  if (entry?.paused) return 'en pausa';
  if (entry?.skipped) return `omitido: ${entry.skipped}`;
  if (!entry?.ok) return [entry?.reason || 'error de consulta', entry?.stage].filter(Boolean).join(' / ');
  return entry.reason || (entry.accepted ? 'medio aceptado' : 'sin medio compatible');
}

// Solo sondear playlists y un segmento en el CDN conocido; no descargar
// vídeos, consultar iframes arbitrarios, publicar firmas ni verificar audio.
async function probeMedia(hit) {
  const raw = hit?.url;
  if (!allowedVideoUrl(raw) || !/\.m3u8$/i.test(new URL(raw).pathname)) return 'no sondeado';
  const pickUrl = (uri, parent, suffix) => {
    if (!uri) return null;
    const url = new URL(uri, parent);
    return allowedVideoUrl(url.href) && suffix.test(url.pathname) ? url.href : null;
  };
  const headers = { Referer: REFERER };
  const read = async (url) => parseManifest(await fetchText(url, { redirect: 'manual', headers, timeoutMs: 3000, maxBytes: 512 * 1024 }));
  try {
    const manifest = await read(raw);
    if (!manifest) return 'HLS inválido';
    const sub = pickUrl(manifest.variants[0]?.uri, raw, /\.m3u8$/i);
    const list = sub ? await read(sub) : manifest;
    const segment = pickUrl(list?.segment, sub || raw, /\.(?:ts|m4s|mp4)$/i);
    if (!segment) return 'HLS válido, sin segmento sondeable';
    const response = await fetch(segment, { redirect: 'manual', headers: { ...headers, Range: 'bytes=0-0' }, signal: AbortSignal.timeout(3000) });
    await response.body?.cancel().catch(() => {});
    const type = response.headers.get('content-type') || '';
    return response.ok && !/html|json/i.test(type) ? `HLS y segmento HTTP ${response.status}` : `HLS válido, segmento no verificado (HTTP ${response.status})`;
  } catch (err) {
    return `falló la comprobación HLS${err.status ? ` (HTTP ${err.status})` : ''}`;
  }
}

async function main(group) {
  const selected = group ? fixtures[group] : Object.values(fixtures).flat();
  if (!selected) throw new Error('Grupo de sondas inválido');
  const enabled = activeProviders(null);
  const rows = [];
  let failed = false;
  for (const fixture of selected) {
    const label = fixture.mediaType === 'series' ? `${fixture.title} T${fixture.season}E${fixture.episode}` : fixture.title;
    // La deduplicación del addon no debe atribuir una URL compartida a una sola
    // fuente en la auditoría. Cada adaptador conserva su presupuesto habitual.
    const checks = await Promise.all(fixture.keys.map(async (key) => {
      if (!enabled.includes(key)) return { hits: [], check: 'no sondeado' };
      const report = {};
      const hits = await runProviders([key], fixture.title, fixture, fixture.title, report, 6000);
      const hit = hits.find((item) => item.verification === 'manifest-ok') || hits[0];
      const check = hit?.verification === 'manifest-ok' ? await probeMedia(hit) : 'no sondeado de nuevo';
      return { entry: report[key], hits, check: [hit?.verification, check].filter(Boolean).join('; ') };
    }));
    for (const [index, key] of fixture.keys.entries()) {
      const { entry, hits, check } = checks[index];
      const state = entry ? summarize(entry) : 'desactivado';
      const status = entry?.status || '—';
      const kinds = [...new Set(hits.map((hit) => hit.resolution || hit.quality || 'directo'))].join(', ') || '—';
      const raw = entry?.raw ?? 0;
      const accepted = entry?.accepted ?? 0;
      const note = `${state}; HTTP ${status}; aceptados ${accepted}/${raw}; formato/calidad ${kinds}; ${check}`;
      annotate(`${label} / ${key}`, note);
      rows.push(`| ${label} | ${key} | ${state} | ${status} | ${accepted}/${raw} | ${kinds} | ${check} |`);
    }
    if (fixture.control && !checks.some(({ hits }) => hits.length)) failed = true;
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    `### Scrapers: ${group || 'todos'}`, '',
    '| Control | Proveedor | Estado | HTTP | Aceptados/extraídos | Formato/calidad | Sonda CDN |',
    '|---|---|---|---|---|---|---|', ...rows, '',
    'Que el adaptador acepte una URL no prueba reproducción en Stremio. Sonda desde el runner, no desde producción.', '',
  ].join('\n'));
  if (failed) process.exitCode = 1;
}

if (require.main === module) main(process.argv[2]).catch(() => {
  console.error('Falló la ejecución de la sonda de proveedores');
  process.exitCode = 1;
});

module.exports = { annotate };
