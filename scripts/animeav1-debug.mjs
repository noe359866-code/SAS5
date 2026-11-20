#!/usr/bin/env node
/**
 * Depuración de AnimeAV1 contra el sitio real, con el mismo cliente que usa el
 * adaptador (`providerHttp`, que no sigue redirecciones sin comprobarlas).
 *
 * Repite buscador → ficha → episodio → reescritura `/play/<hex>`→`/m3u8/<hex>`
 * → manifiesto, y después el recorrido completo cronometrado. Se mide dos obras:
 * una serie corta y una larga (Naruto), que en vivo caía en `probe-timeout`.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { providerHttp } = require('../lib/providerHttp');
const anime = require('../lib/sites/animeav1');

const rows = [];
const row = (step, note) => { rows.push({ step, note }); console.log(`| ${step} | ${note} |`); };
const short = (err) => `${err?.status ? `HTTP ${err.status} ` : ''}${String(err?.message || err).slice(0, 90)}`;
const clean = (url) => String(url).replace('https://animeav1.com', '');

const WORKS = [
  {
    label: 'Ore dake Level Up na Ken',
    resolved: { title: 'Ore dake Level Up na Ken', altTitle: 'Solo Leveling', year: 2024, mediaType: 'series', season: 1, episode: 1 },
  },
  {
    label: 'Naruto',
    resolved: { title: 'Naruto', year: 2002, mediaType: 'series', season: 1, episode: 1 },
  },
  {
    // El único título de anime que la medición en vivo deja en `no-match`.
    label: 'Black Clover',
    resolved: { title: 'Black Clover', year: 2017, mediaType: 'series', season: 2, episode: 1 },
  },
];

async function inspect(http, work) {
  row(`— ${work.label} —`, '·');
  const { resolved } = work;
  let page = '';
  try {
    const listing = await http.text(`${anime.BASE}/catalogo?search=${encodeURIComponent(work.label)}`, { maxBytes: 1024 * 1024 });
    const candidates = anime.listingMatches(listing, resolved, 3);
    page = candidates[0] || '';
    row('/catalogo?search=', `ok ${listing.length}B · articles=${(listing.match(/<article/gi) || []).length} · fichas=${candidates.length} ${candidates.map(clean).join(' ')}`);
  } catch (err) { row('/catalogo?search=', `error ${short(err)}`); return; }
  if (!page) return;

  let html = '';
  try { html = await http.text(page, { maxBytes: 1024 * 1024 }); row(`GET ${clean(page)}`, `ok ${html.length}B · h1=«${anime.detailTitle(html)}»`); }
  catch (err) { row(`GET ${clean(page)}`, `error ${short(err)}`); return; }

  const eps = anime.episodesOf(html, page);
  row('episodios', `${eps.length} · primero=${eps[0]?.number} ${clean(eps[0]?.url || '')}`);
  const chosen = anime.pickEpisode(eps, resolved);
  if (!chosen) return row('episodio pedido', 'no está en la ficha');

  let episode = '';
  try { episode = await http.text(chosen.url, { headers: { Referer: page }, maxBytes: 1024 * 1024 }); row('GET episodio', `ok ${episode.length}B`); }
  catch (err) { row('GET episodio', `error ${short(err)}`); return; }

  const servers = anime.serversOf(episode);
  row('servidores', `${servers.length} · ${servers.slice(0, 6).map((s) => `${s.server}/${s.group}`).join(' ')}`);

  // La reescritura del visor propio, por separado.
  for (const server of servers.filter((s) => s.server === 'HLS')) {
    const manifest = anime.manifestOf(server.url);
    row(`  ${server.group} play→m3u8`, manifest || 'sin reescritura');
    if (!manifest) continue;
    const started = Date.now();
    try {
      const body = await http.text(manifest, { headers: { Referer: chosen.url, Accept: '*/*' }, maxBytes: 256 * 1024 });
      row(`  ${server.group} manifiesto`, `${Date.now() - started}ms · ok ${body.length}B hls=${/^\s*#EXTM3U/.test(body)} cabeza=«${body.slice(0, 32).replace(/\s+/g, ' ')}»`);
    } catch (err) { row(`  ${server.group} manifiesto`, `${Date.now() - started}ms · error ${short(err)}`); }
  }

  // Recorrido completo del adaptador, cronometrado.
  const started = Date.now();
  try {
    const out = await anime.searchAnimeAv1(null, resolved, resolved.title, 9000);
    row('searchAnimeAv1', `${Date.now() - started}ms · hits=${out.hits?.length || 0} · ${out.reason || 'ok'}${out.notes ? ` ${JSON.stringify(out.notes)}` : ''}`);
    for (const hit of (out.hits || []).slice(0, 4)) row('  hit', `${hit.quality} ${hit.audioLabel} · ${hit.url.replace(/[a-f0-9]{16,}/g, '«hex»')}`);
  } catch (err) { row('searchAnimeAv1', `${Date.now() - started}ms · error ${short(err)}`); }
}

async function steps() {
  const http = providerHttp(20_000, 20);
  for (const work of WORKS) {
    await inspect(http, work).catch((err) => row(`— ${work.label} —`, `error ${short(err)}`));
  }
}

async function main() {
  const fs = await import('node:fs');
  fs.mkdirSync('.probe', { recursive: true });
  try {
    await steps();
  } catch (err) {
    row('error', short(err));
    console.error(err);
  }
  // El resumen se escribe pase lo que pase: un fallo también es una medición.
  const md = ['| Paso | Resultado |', '|---|---|'];
  for (const r of rows) md.push(`| ${r.step} | ${String(r.note).replace(/\|/g, '/')} |`);
  md.push('', 'AnimeAV1: depuración con el cliente del adaptador.');
  fs.writeFileSync('.probe/animeav1-debug.md', `${md.join('\n')}\n`);
  console.log(`\n${md.join('\n')}`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
