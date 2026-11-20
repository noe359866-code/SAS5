#!/usr/bin/env node
/**
 * «La película existe en la web pero el addon no la encuentra».
 *
 * Se consulta el **buscador crudo** de cada fuente con el título que el addon
 * usa de verdad (TMDB en español) y con el original, y se imprime lo que
 * devuelve: así se distingue entre que la web no la tenga con ese nombre, que
 * la tenga y el filtro de identidad la descarte, o que el visor sea lo que
 * falla.
 *
 * Los sitios limitan por velocidad (en una pasada sin pausa respondieron 522 y
 * timeouts), así que se consulta de una en una, con pausa, y se anota el estado
 * HTTP de cada intento: un fallo de la sonda no debe parecer un «no-match».
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { providerHttp } = require('../lib/providerHttp');
const { DIALECTS } = require('../lib/sites/vimeosJson');
const allpeliculas = require('../lib/sites/allpeliculas');
const lamovie = require('../lib/sites/lamovie');
const cuevanas3 = require('../lib/sites/cuevanas3');

const rows = [];
const row = (step, note) => { rows.push({ step, note }); console.log(`| ${step} | ${note} |`); };
const short = (err) => `${err?.status ? `HTTP ${err.status} ` : ''}${String(err?.message || err).slice(0, 70)}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Películas que existen en los sitios y hoy no salen (o salen a medias). */
const MOVIES = [
  { es: 'Intensa-Mente 2', alt: 'Intensamente 2', en: 'Inside Out 2', year: 2024 },
  { es: 'El Origen', alt: 'Inception', en: 'Inception', year: 2010 },
  { es: 'El reino prohibido', en: 'The Forbidden Kingdom', year: 2008 },
  { es: 'Alien: Romulus', en: 'Alien: Romulus', year: 2024 },
];

const SITES = [
  { key: 'cuevanas3', api: cuevanas3.FAST },
  { key: 'allpeliculas', api: allpeliculas.API },
  { key: 'lamovie', api: lamovie.API },
];

async function searchRaw(http, site, query) {
  const url = DIALECTS.wpa.search(site.api, query, { mediaType: 'movie' });
  const started = Date.now();
  const data = await http.json(url, { maxBytes: 512 * 1024 });
  const posts = data?.data?.posts || [];
  return { posts, ms: Date.now() - started };
}

async function steps() {
  const http = providerHttp(12_000, 60);
  for (const movie of MOVIES) {
    row(`— ${movie.es} (${movie.year}) —`, '·');
    for (const site of SITES) {
      for (const query of [movie.es, movie.alt, movie.en].filter(Boolean)) {
        await wait(1200);
        try {
          const { posts, ms } = await searchRaw(http, site, query);
          const list = posts.slice(0, 5).map((p) => `${String(p.title || '').slice(0, 40)} [${p.type || '—'}/${String(p.release_date || '').slice(0, 4) || '—'}]`);
          row(`${site.key} «${query}»`, `${ms}ms · ${posts.length} resultados · ${list.join(' · ') || 'ninguno'}`);
          if (posts.length) break; // con resultados no hace falta seguir probando nombres
        } catch (err) { row(`${site.key} «${query}»`, `error ${short(err)}`); }
      }
    }
  }

  // El filtro del adaptador, ya con los resultados en la mano.
  row('— filtro de identidad —', '·');
  for (const movie of MOVIES) {
    const resolved = { title: movie.es, altTitle: movie.en, year: String(movie.year), mediaType: 'movie' };
    for (const site of SITES) {
      await wait(1200);
      let posts = [];
      try { ({ posts } = await searchRaw(http, site, movie.es)); }
      catch (err) { row(`${site.key} filtro «${movie.es}»`, `sin datos: ${short(err)}`); continue; }
      const pick = site.key === 'cuevanas3' ? cuevanas3.pickPost : site.key === 'allpeliculas' ? allpeliculas.pickPost : lamovie.pickPost;
      const post = pick(posts, resolved);
      row(`${site.key} filtro «${movie.es}»`, post ? `acepta «${post.title}» [${post.type}]` : `descarta los ${posts.length} resultados`);
    }
  }
}

async function main() {
  const fs = await import('node:fs');
  fs.mkdirSync('.probe', { recursive: true });
  try { await steps(); } catch (err) { row('error', short(err)); console.error(err); }
  const md = ['| Paso | Resultado |', '|---|---|'];
  for (const r of rows) md.push(`| ${r.step} | ${String(r.note).replace(/\|/g, '/')} |`);
  md.push('', 'Buscador crudo y filtro de identidad para películas que el addon no encuentra.');
  fs.writeFileSync('.probe/movies-reach.md', `${md.join('\n')}\n`);
  console.log(`\n${md.join('\n')}`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
