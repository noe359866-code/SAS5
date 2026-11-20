#!/usr/bin/env node
'use strict';

/**
 * Sonda en vivo de los adaptadores nuevos (solo diagnóstico).
 *
 * Ejecuta `lib/sites/*` con peticiones reales desde el runner de GitHub
 * Actions y resume, por título y por fuente, qué devolvió: aceptados, motivo
 * del descarte y peticiones gastadas. No imprime URLs firmadas ni descarga
 * segmentos de vídeo: de cada enlace publicado se lee solo la primera línea
 * del manifiesto, para distinguir un HLS real de una página del reproductor.
 *
 * Uso:
 *   node scripts/sites-live.js                       # todos los adaptadores y proveedores
 *   node scripts/sites-live.js cuevanas3 animeflv  # solo esos
 *   node scripts/sites-live.js --json                # escribe .probe/sites-live.json
 */

const fs = require('node:fs');
const streams = require('../lib/streams');
const { UA } = require('../lib/extractors');
const sites = {
  cuevanas3: require('../lib/sites/cuevanas3'),
  animeflv: require('../lib/sites/animeflv'),
  animeav1: require('../lib/sites/animeav1'),
  fuegocine: require('../lib/sites/fuegocine'),
  pelisjuanita: require('../lib/sites/pelisjuanita'),
  allpeliculas: require('../lib/sites/allpeliculas'),
  lamovie: require('../lib/sites/lamovie'),
};

const CONTROLS = [
  { type: 'movie', id: 'tt33033798', tmdb: 969681, fallback: { title: 'Spider-Man: Un nuevo día', year: '2026' } },
  { type: 'movie', id: 'tt1375666', fallback: { title: 'El Origen', year: '2010' } },
  { type: 'series', id: 'tt0903747:1:1', tmdb: 1396, fallback: { title: 'Breaking Bad', year: '2008', season: 1, episode: 1 } },
  { type: 'movie', id: 'tt18412256', tmdb: 945961, fallback: { title: 'Alien: Romulus', year: '2024' } },
  { type: 'movie', id: 'tt6263850', tmdb: 533535, fallback: { title: 'Deadpool & Wolverine', year: '2024' } },
  { type: 'movie', id: 'tt22022452', tmdb: 1022789, fallback: { title: 'Intensa-Mente 2', year: '2024' } },
  { type: 'movie', title: 'El reino prohibido', fallback: { title: 'El reino prohibido', year: '2008' } },
  { type: 'series', id: 'tt0409591:1:1', fallback: { title: 'Naruto', year: '2002', season: 1, episode: 1 } },
  { type: 'series', title: 'Ao Ashi Season 2', fallback: { title: 'Ao Ashi Season 2', year: '2026', season: 2, episode: 7 } },
  { type: 'series', title: 'Black Clover 2nd Season', fallback: { title: 'Black Clover 2nd Season', year: '2026', season: 2, episode: 7 } },
  // Controles con ficha comprobada en fuegocine: uno por cada camino del
  // adaptador (película con audio subtitulado y serie por temporada).
  { type: 'movie', title: 'La Odisea', fallback: { title: 'La Odisea', year: '2026' } },
  { type: 'series', title: 'VisionQuest', fallback: { title: 'VisionQuest', year: '2026', season: 1, episode: 1 } },
];

// ── Diagnóstico: qué URLs probó cada adaptador y qué devolvió la última ──
const trace = [];
const liveDigest = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const response = await originalFetch(url, options);
  const type = response.headers.get('content-type') || '';
  let html = '';
  if (/html|text|json/i.test(type)) {
    try { html = await response.clone().text(); } catch (_) { /* cuerpo no legible */ }
  }
  const text = html.replace(/\s+/g, ' ');
  // Contexto alrededor de las señales que busca cada adaptador: es el dato
  // que falta cuando la ficha responde 200 pero no hay coincidencia.
  const marks = ['trembed', 'player-option', 'data-src', 'iframe', 'episodios', 'f-info', 'numerando', 'mejs-container'];
  const context = {};
  for (const mark of marks) {
    const at = text.indexOf(mark);
    if (at >= 0) context[mark] = text.slice(Math.max(0, at - 120), at + 220);
  }
  // HTML completo de las páginas que importan para corregir selectores,
  // incluidos los POST de los buscadores del sitio.
  if (/html|text/i.test(type) && html.length) {
    const host = (() => { try { return new URL(String(url)).hostname; } catch { return ''; } })();
    if (/(?:cuevanas3|allpeliculas|lamovie|animeflv|animeav1|fuegocine|pelisjuanita|unlimplay|vimeos)/.test(host)) {
      const name = (String(options.method || 'GET') === 'GET' ? '' : 'post-')
        + String(url).replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 80);
      try { fs.mkdirSync('.probe/html', { recursive: true }); fs.writeFileSync(`.probe/html/live-${name}.html`, html); } catch (_) {}
    }
  }
  // Host del embed que devuelve Dooplay (sin la URL firmada).
  if (/admin-ajax\.php/.test(String(url)) && /json/i.test(type) && html) {
    try {
      const data = JSON.parse(html);
      const embed = typeof data?.embed_url === 'string' ? data.embed_url : '';
      if (embed) {
        trace.push({ url: `embed-host: ${new URL(embed).hostname}`, status: 200, type: 'embed', location: '', title: '', h1: '', marks: [], bytes: 0 });
        // La URL del embed (código, no firmada) para reproducir el fallo del
        // extractor fuera de la sonda. Se acumulan: hay uno por servidor.
        try { fs.mkdirSync('.probe/html', { recursive: true }); fs.appendFileSync('.probe/html/live-embed.txt', embed + '\n'); } catch (_) {}
      }
    } catch (_) {}
  }
  if (/\/api\/videos\//.test(String(url)) && /json/i.test(type) && html) {
    try {
      const data = JSON.parse(html);
      const pb = data && typeof data === 'object' ? data.playback : null;
      const shape = pb && typeof pb === 'object'
        ? `playback{${Object.keys(pb).join(',')} algo=${pb.algorithm} parts=${Array.isArray(pb.key_parts) ? pb.key_parts.length : 'no'} ivLen=${String(pb.iv || '').length} payloadLen=${String(pb.payload || '').length}`
        : `keys=${data && typeof data === 'object' ? Object.keys(data).join(',') : typeof data}`;
      trace.push({ url: `byse-api: ${shape}`, status: response.status, type: 'byse', location: '', title: '', h1: '', marks: [], bytes: html.length });
      try { fs.mkdirSync('.probe/html', { recursive: true }); fs.writeFileSync('.probe/html/live-byse-api.json', html); } catch (_) {}
    } catch (_) {}
  }
  trace.push({ url: String(url).slice(0, 150), status: response.status, type: type.split(';')[0],
    location: response.headers.get('location') || '',
    title: /<title[^>]*>([^<]{0,80})/i.exec(text)?.[1]?.trim() || '',
    h1: /<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i.exec(text)?.[1]?.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim().slice(0, 90) || '',
    marks: Object.keys(context), bytes: html.length });
  if (Object.keys(context).length) {
    liveDigest.push(`\n## ${response.status} ${String(url).slice(0, 120)}\n  h1: ${trace[trace.length - 1].h1}\n  title: ${trace[trace.length - 1].title}\n` +
      Object.entries(context).map(([mark, ctx]) => `  [${mark}] ${ctx}`).join('\n'));
  }
  return response;
};

const host = (raw) => { try { return new URL(raw).hostname; } catch { return ''; } };

const redact = (raw) => {
  try { const url = new URL(raw); return `${url.origin}${url.pathname}`; } catch { return '—'; }
};

const SEARCHERS = {
  cuevanas3: (resolved) => sites.cuevanas3.searchCuevanas3(null, resolved, resolved.title, 9000),
  animeflv: (resolved) => sites.animeflv.searchAnimeFlv(null, resolved, resolved.title, 9000),
  animeav1: (resolved) => sites.animeav1.searchAnimeAv1(null, resolved, resolved.title, 9000),
  fuegocine: (resolved) => sites.fuegocine.searchFuegoCine(null, resolved, resolved.title, 9000),
  pelisjuanita: (resolved) => sites.pelisjuanita.searchPelisJuanita(null, resolved, resolved.title, 9000),
  allpeliculas: (resolved) => sites.allpeliculas.searchAllpeliculas(null, resolved, resolved.title, 9000),
  lamovie: (resolved) => sites.lamovie.searchLamovie(null, resolved, resolved.title, 9000),
};

// Proveedores del registro que no son «sitios»: se miden con el mismo control
// para decidir con datos, en el mismo JSON, si siguen aportando algo.
const REGISTRY = ['fanpelis', 'spinflix'];
for (const key of REGISTRY) {
  if (streams.SEARCHERS[key]) SEARCHERS[key] = (resolved) => streams.SEARCHERS[key](null, resolved, resolved.title, 9000);
}

async function resolveControl(control) {
  if (control.title) {
    // Un control sin IMDb (`title` a secas) declara su temporada y episodio en
    // `fallback`: sin ellos el adaptador de series no puede abrir nada.
    const season = control.type === 'series'
      ? Number(String(control.id || '').split(':')[1]) || control.fallback?.season || null : null;
    const episode = control.type === 'series'
      ? Number(String(control.id || '').split(':')[2]) || control.fallback?.episode || null : null;
    return { title: control.title, altTitle: null, year: control.fallback?.year || null,
      mediaType: control.type, season, episode };
  }
  const resolved = await Promise.race([
    streams.resolveTitle(control.type, control.id),
    new Promise((resolve) => setTimeout(() => resolve(null), 9000)),
  ]).catch(() => null);
  const season = control.type === 'series' ? Number(control.id.split(':')[1]) : null;
  const episode = control.type === 'series' ? Number(control.id.split(':')[2]) : null;
  const base = resolved || { ...control.fallback, mediaType: control.type, altTitle: null, season, episode };
  // VideoApp trabaja solo por TMDB: si el catálogo no lo devuelve, se usa el
  // que declara el propio control para que la medición no lo salte.
  if (control.tmdb && !base.tmdbId) {
    return { ...base, tmdbId: control.tmdb, tmdbType: control.type === 'series' ? 'tv' : 'movie' };
  }
  return base;
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const keys = args.length ? args.filter((key) => SEARCHERS[key]) : Object.keys(SEARCHERS);
  const rows = [];
  for (const control of CONTROLS) {
    const resolved = await resolveControl(control);
    console.log(`\n### ${control.id || control.title}: ${resolved.title} (${resolved.year || '—'}) ${resolved.mediaType}`);
    for (const key of keys) {
      // Pausa entre fuentes: los sitios limitan por velocidad y un desafío
      // JS no se resuelve sin navegador (no se intenta).
      await new Promise((resolve) => setTimeout(resolve, 700));
      const started = Date.now();
      let result;
      try {
        result = await Promise.race([
          SEARCHERS[key](resolved),
          new Promise((resolve) => setTimeout(() => resolve({ hits: [], reason: 'probe-timeout' }), 14000)),
        ]);
      } catch (err) {
        result = { hits: [], reason: `error:${String(err && err.message || err).slice(0, 60)}` };
      }
      const hits = result.hits || [];
      const verdict = hits.length
        ? hits.map((hit) => `${hit.quality}${hit.audioLabel ? `/${hit.audioLabel}` : ''} ${redact(hit.url)}`).join(' · ')
        : `${result.reason || result.skipped || 'sin motivo'}${result.notes ? ` ${JSON.stringify(result.notes)}` : ''}`;
      console.log(`- ${key}: ${hits.length} hit(s) en ${Date.now() - started} ms → ${verdict}`);
      // Qué devuelve el enlace publicado: el registro solo acepta formas de
      // medio, así que se comprueba el contenido de la primera línea. En
      // UnLimPlay se prueban las cabeceras que cambian la respuesta (el
      // visor anuncia `x=.m3u8`, pero un GET anónimo devuelve su reproductor).
      const mediaNotes = [];
      if (hits.length) {
        const target = hits[0].url;
        const variants = /(?:^|\.)unlimplay\.com$/.test(host(target))
          ? [
            ['UA', {}],
            ['UA+Referer', { Referer: 'https://unlimplay.com/' }],
            ['UA+Accept-HLS', { Accept: 'application/vnd.apple.mpegurl,*/*' }],
          ]
          : [['UA', {}]];
        for (const [label, extra] of variants) {
          try {
            const probe = await Promise.race([
              originalFetch(target, { headers: { 'User-Agent': UA, ...extra } }),
              new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
            ]);
            if (!probe) { mediaNotes.push(`${label}: sin respuesta en 8 s`); console.log(`    medio ${label}: sin respuesta en 8 s`); continue; }
            const body = await probe.text().catch(() => '');
            const head = body.split('\n').map((line) => line.trim()).filter(Boolean)[0] || '(vacío)';
            const kind = /^#EXTM3U/.test(head) ? 'HLS' : /^</.test(head) ? 'HTML' : 'otro';
            const line = `${label}: HTTP ${probe.status} ${String(probe.headers.get('content-type') || '—').split(';')[0]} tipo=${kind} → ${head.replace(/[?#].*/, '').slice(0, 40)}`;
            mediaNotes.push(line);
            console.log(`    medio ${label}: HTTP ${probe.status} ${probe.headers.get('content-type') || '—'} tipo=${kind} → ${head.replace(/[?#].*/, '').slice(0, 60)}`);
          } catch (err) {
            mediaNotes.push(`${label}: error ${String(err && err.message || err).slice(0, 40)}`);
            console.log(`    medio ${label}: error ${String(err && err.message || err).slice(0, 60)}`);
          }
        }
      }
      // Últimas peticiones de esta fuente, para explicar el descarte.
      const recent = trace.slice(-6).map((entry) => `${entry.status} ${entry.url}${entry.location ? ` → ${entry.location.slice(0, 80)}` : ''}${entry.h1 ? ` h1="${entry.h1.slice(0, 40)}"` : ''}`);
      console.log(`    traza: ${recent.join(' | ')}`);
      rows.push({ control: control.id || control.title, title: resolved.title, provider: key, hits: hits.length, trace: recent,
        media: mediaNotes,
        ms: Date.now() - started, quality: hits.map((hit) => hit.quality),
        audio: hits.map((hit) => hit.audioLabel || '—'), hosts: hits.map((hit) => redact(hit.url)), verdict });
    }
  }
  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/sites-live.json', JSON.stringify(rows, null, 2));
  const md = ['| Control | Fuente | Hits | ms | Formato | Audio | Medio publicado | Destino |', '|---|---|---:|---:|---|---|---|---|'];
  for (const row of rows) {
    md.push(`| ${row.title} | ${row.provider} | ${row.hits} | ${row.ms} | ${row.quality.join(',') || '—'} | ${row.audio.join(',') || '—'} | ${(row.media || []).join(' · ').replace(/\|/g, '/') || '—'} | ${String(row.verdict).replace(/\|/g, '/').slice(0, 160)} |`);
  }
  md.push('', 'Sonda de adaptadores: solo ficha y embed; no descarga segmentos de vídeo ni imprime URLs firmadas.');
  fs.writeFileSync('.probe/sites-live.md', md.join('\n') + '\n');
  fs.writeFileSync('.probe/sites-live-trace.txt', trace.map((entry) => `${entry.status}\t${entry.type}\t${entry.bytes || 0}\t${entry.url}\t${entry.location.slice(0, 100)}\t${entry.h1}`).join('\n') + '\n');
  fs.writeFileSync('.probe/sites-live-digest.txt', liveDigest.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
  console.log('\nResumen escrito en .probe/sites-live.md');
}

main().catch((err) => { console.error(err); process.exit(1); });
