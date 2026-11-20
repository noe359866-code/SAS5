#!/usr/bin/env node
/**
 * «La película existe en la web pero el addon no la encuentra».
 *
 * Se consulta el **buscador crudo** de cada fuente con varios títulos y se
 * imprime lo que devuelve (título, año, tipo). Así se distingue:
 *
 *   - la web no tiene la película con ese nombre (título en latino distinto),
 *   - la web sí la tiene y el filtro de identidad la descarta (año, tipo, signos),
 *   - la web la encuentra y lo que falla es el visor.
 *
 * Se prueban las dos formas del título: la que usa el addon (TMDB en español) y
 * la original, porque los sitios guardan una u otra según la ficha.
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

/** Películas que existen en los sitios y hoy no salen (o salen a medias). */
const MOVIES = [
  { es: 'Intensamente 2', en: 'Inside Out 2', year: 2024 },
  { es: 'Origen', en: 'Inception', year: 2010 },
  { es: 'El reino prohibido', en: 'The Forbidden Kingdom', year: 2008 },
  { es: 'Deadpool & Wolverine', en: 'Deadpool & Wolverine', year: 2024 },
  { es: 'Alien: Romulus', en: 'Alien: Romulus', year: 2024 },
];

const SITES = [
  { key: 'cuevanas3', api: cuevanas3.FAST, dialect: 'wpa' },
  { key: 'allpeliculas', api: allpeliculas.API, dialect: 'wpa' },
  { key: 'lamovie', api: lamovie.API, dialect: 'wpa' },
];

async function dump(http, site, movie) {
  const paths = DIALECTS[site.dialect];
  for (const query of [...new Set([movie.es, movie.en])].filter(Boolean)) {
    const url = paths.search(site.api, query, 'movie');
    let data = null;
    try { data = await http.json(url, { maxBytes: 512 * 1024 }); }
    catch (err) { row(`${site.key} «${query}»`, `error ${short(err)}`); continue; }
    const posts = data?.data?.posts || [];
    const list = posts.slice(0, 6).map((p) => `${String(p.title || p.name || '').slice(0, 44)} [${p.type}/${p.release_date || '—'}]`);
    row(`${site.key} «${query}»`, `${posts.length} resultados · ${list.join(' · ') || 'ninguno'}`);
    const hit = posts.find((p) => String(p.title || '').toLowerCase().includes(String(movie.year)));
    if (!hit && posts.length) row(`${site.key} «${query}» (año)`, 'ninguna ficha declara el año pedido');
  }
}

async function steps() {
  const http = providerHttp(20_000, 80);
  for (const movie of MOVIES) {
    row(`— ${movie.es} (${movie.year}) —`, '·');
    for (const site of SITES) await dump(http, site, movie);
  }
  // El filtro del adaptador, con la ficha que la web sí devuelve.
  row('— filtro de identidad —', '·');
  for (const movie of MOVIES) {
    const resolved = { title: movie.es, altTitle: movie.en, year: String(movie.year), mediaType: 'movie' };
    for (const [key, pick] of [['cuevanas3', cuevanas3.pickPost], ['allpeliculas', allpeliculas.pickPost], ['lamovie', lamovie.pickPost]]) {
      const paths = DIALECTS.wpa;
      const api = SITES.find((s) => s.key === key).api;
      let posts = [];
      try { posts = (await http.json(paths.search(api, movie.es, 'movie'), { maxBytes: 512 * 1024 }))?.data?.posts || []; }
      catch { posts = []; }
      const post = pick(posts, resolved);
      row(`${key} filtro «${movie.es}»`, post ? `acepta ${post.title} [${post.type}]` : `descarta ${posts.length} resultados`);
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
