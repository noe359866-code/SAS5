#!/usr/bin/env node
/**
 * Depuración de AnimeAV1 contra el sitio real, con el mismo cliente que usa el
 * adaptador (`providerHttp`, que no sigue redirecciones sin comprobarlas).
 *
 * La validación en vivo dio `no-extractable-embed` en el episodio medido: el
 * visor propio se rechazó. Aquí se repite paso a paso para ver **qué** falla:
 * la búsqueda, la ficha, los episodios, la reescritura a `/m3u8/<hex>` o la
 * lectura del manifiesto.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { providerHttp } = require('../lib/providerHttp');
const anime = require('../lib/sites/animeav1');

const rows = [];
const row = (step, note) => { rows.push({ step, note }); console.log(`| ${step} | ${note} |`); };
const short = (err) => `${err?.status ? `HTTP ${err.status} ` : ''}${String(err?.message || err).slice(0, 90)}`;

async function steps() {
  const http = providerHttp(20_000, 20);

  // 1. Buscador con el cliente del adaptador.
  const searchUrl = `${anime.BASE}/catalogo?search=${encodeURIComponent('ore dake level up na ken')}`;
  try {
    const body = await http.text(searchUrl, { headers: { 'Accept-Language': 'es-MX,es;q=0.9' }, maxBytes: 1024 * 1024 });
    row('/catalogo?search=', `ok ${body.length}B · articles=${(body.match(/<article/gi) || []).length}`);
  } catch (err) { row('/catalogo?search=', `error ${short(err)}`); }

  // 2. Ficha del episodio que falló (Ao Ashi se midió en vivo; aquí se usa la
  //    ficha que ya conocemos y otra con temporada).
  for (const page of ['https://animeav1.com/media/ore-dake-level-up-na-ken']) {
    let html = '';
    try { html = await http.text(page, { maxBytes: 1024 * 1024 }); row(`GET ${page.replace('https://animeav1.com', '')}`, `ok ${html.length}B`); }
    catch (err) { row(`GET ${page.replace('https://animeav1.com', '')}`, `error ${short(err)}`); continue; }
    const eps = anime.episodesOf(html, page);
    row('episodios', `${eps.length} · primero=${eps[0]?.number} ${eps[0]?.url || ''}`);

    // 3. Episodio y visores.
    const episodeUrl = eps[0]?.url || `${page}/1`;
    let episode = '';
    try { episode = await http.text(episodeUrl, { headers: { Referer: page }, maxBytes: 1024 * 1024 }); row('GET episodio', `ok ${episode.length}B`); }
    catch (err) { row('GET episodio', `error ${short(err)}`); continue; }
    const servers = anime.serversOf(episode);
    row('servidores', `${servers.length} · ${servers.slice(0, 6).map((s) => `${s.server}/${s.group}`).join(' ')}`);

    // 4. La reescritura del visor propio, por separado.
    for (const server of servers.filter((s) => s.server === 'HLS')) {
      const manifest = anime.manifestOf(server.url);
      row(`  ${server.group} play→m3u8`, manifest || 'sin reescritura');
      if (!manifest) continue;
      try {
        const body = await http.text(manifest, { headers: { Referer: episodeUrl, Accept: '*/*' }, maxBytes: 4096 });
        row(`  ${server.group} manifiesto`, `ok ${body.length}B hls=${/^\s*#EXTM3U/.test(body)} cabeza=«${body.slice(0, 40).replace(/\s+/g, ' ')}»`);
      } catch (err) { row(`  ${server.group} manifiesto`, `error ${short(err)}`); }
    }
  }

  // 5. Recorrido completo del adaptador, cronometrado.
  const resolved = { title: 'Ore dake Level Up na Ken', altTitle: 'Solo Leveling', year: 2024, mediaType: 'series', season: 1, episode: 1 };
  const started = Date.now();
  try {
    const out = await anime.searchAnimeAv1(null, resolved, resolved.title, 20_000);
    row('searchAnimeAv1', `${Date.now() - started}ms · hits=${out.hits?.length || 0} · ${out.reason || 'ok'}${out.notes ? ` ${JSON.stringify(out.notes)}` : ''}`);
    for (const hit of (out.hits || []).slice(0, 4)) row('  hit', `${hit.quality} ${hit.audioLabel} · ${hit.url.replace(/[a-f0-9]{16,}/g, '«hex»')}`);
  } catch (err) { row('searchAnimeAv1', `error ${short(err)}`); }

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
