#!/usr/bin/env node
/**
 * Alcance de episodios en las fuentes de anime, contra el sitio real.
 *
 * La pregunta que responde: ¿el adaptador llega al **último** episodio de una
 * serie larga (One Piece) o se queda en los 50 que pinta la ficha?
 *
 * Se mide, para AnimeAV1 y AnimeFLV:
 *   - cuántos episodios publica la ficha y en qué rango,
 *   - si hay paginación (`?page=`) u otro listado,
 *   - si la URL del episodio se puede **construir** con el número
 *     (`/media/<slug>/<n>`, `/ver/<slug>-<n>`) y responde con visores.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { providerHttp } = require('../lib/providerHttp');
const av1 = require('../lib/sites/animeav1');
const flv = require('../lib/sites/animeflv');

const rows = [];
const row = (step, note) => { rows.push({ step, note }); console.log(`| ${step} | ${note} |`); };
const short = (err) => `${err?.status ? `HTTP ${err.status} ` : ''}${String(err?.message || err).slice(0, 70)}`;

/** Números a sondear: el final conocido de One Piece y un poco más allá. */
const NUMBERS = [1000, 1060, 1080, 1100, 1110, 1120, 1140, 1150, 1180];

async function ficha(http, label, page, episodesOf) {
  let html = '';
  try { html = await http.text(page, { maxBytes: 2 * 1024 * 1024 }); }
  catch (err) { return row(`${label} ficha`, `error ${short(err)}`); }
  const eps = episodesOf(html);
  const numbers = eps.map((e) => Number(e.number)).filter((n) => Number.isFinite(n));
  row(`${label} ficha`, `${html.length}B · ${eps.length} episodios · min=${Math.min(...numbers)} max=${Math.max(...numbers)}`);
  const pages = [...new Set((html.match(/href="[^"]*(?:page=|paged=)[^"]*"/g) || []).map((h) => h.replace(/^href="|"$/g, '')))];
  row(`${label} paginación`, pages.slice(0, 6).join(' ') || 'sin enlaces de página');
  // Otros patrones de enlace de episodio que no sean `<slug>/<n>`.
  const weird = [...new Set((html.match(/href="[^"]*(?:episodio|episode|capitulo)[^"]*"/gi) || []))].slice(0, 4);
  if (weird.length) row(`${label} enlaces raros`, weird.join(' '));
  return eps;
}

/**
 * ¿La página construida es de verdad ese episodio? Se comprueba que el número
 * aparezca como episodio en el HTML y que un número imposible no devuelva la
 * misma página (eso convertiría la construcción en un falso positivo).
 */
async function verifyBuilt(http, label, urlOf, numbers, serversOf, impossible) {
  for (const n of [numbers[numbers.length - 1], numbers[0]]) {
    try {
      const body = await http.text(urlOf(n), { maxBytes: 512 * 1024 });
      const marks = [
        new RegExp(`(?:episodio|episode|cap[ií]tulo)\\s*0*${n}\\b`, 'i').test(body) ? 'menciona el número' : 'no menciona el número',
        new RegExp(`/media/[^"/]+/${n}\\b`).test(body) ? 'enlace propio' : 'sin enlace propio',
      ];
      const h1 = /<h1[^>]*>([\s\S]{0,120}?)<\/h1>/i.exec(body)?.[1]?.replace(/<[^>]+>/g, '').trim() || '';
      row(`${label} verifica /${n}`, `${marks.join(' · ')} · h1=«${h1.slice(0, 60)}» · visores=${serversOf(body).length}`);
    } catch (err) { row(`${label} verifica /${n}`, `error ${short(err)}`); }
  }
  try {
    const body = await http.text(urlOf(impossible), { maxBytes: 512 * 1024 });
    row(`${label} imposible /${impossible}`, `responde ${body.length}B · visores=${serversOf(body).length} (si responde igual, construir la URL no identifica el episodio)`);
  } catch (err) { row(`${label} imposible /${impossible}`, `error ${short(err)} (lo esperado)`); }
}

async function probeDirect(http, label, urlOf, numbers, serversOf) {
  const found = [];
  for (const n of numbers) {
    const url = urlOf(n);
    try {
      const body = await http.text(url, { maxBytes: 512 * 1024 });
      const servers = serversOf(body);
      found.push(n);
      row(`${label} /${n}`, `ok ${body.length}B · visores=${servers.length}`);
    } catch (err) { row(`${label} /${n}`, `error ${short(err)}`); }
  }
  const max = found.length ? Math.max(...found) : null;
  row(`${label} alcance`, max ? `llega al episodio ${max} construyendo la URL` : 'no se pudo construir ninguna URL');
}

async function steps() {
  const http = providerHttp(25_000, 60);

  row('— AnimeAV1 —', '·');
  await ficha(http, 'av1', `${av1.BASE}/media/one-piece`, (html) => av1.episodesOf(html, `${av1.BASE}/media/one-piece`));
  await probeDirect(http, 'av1', (n) => `${av1.BASE}/media/one-piece/${n}`, NUMBERS, av1.serversOf);
  await verifyBuilt(http, 'av1', (n) => `${av1.BASE}/media/one-piece/${n}`, [1000, 1180], av1.serversOf, 9999);

  // La prueba de extremo a extremo: el adaptador pidiendo el último episodio.
  const resolved = { title: 'One Piece', year: 1999, mediaType: 'series', season: 1, episode: 1180 };
  const started = Date.now();
  try {
    const out = await av1.searchAnimeAv1(null, resolved, resolved.title, 9000);
    row('av1 adaptador E1180', `${Date.now() - started}ms · hits=${out.hits?.length || 0} · ${out.reason || 'ok'}${out.notes ? ` ${JSON.stringify(out.notes)}` : ''}`);
    for (const hit of (out.hits || []).slice(0, 3)) row('  hit', `${hit.quality} ${hit.audioLabel} · ${hit.title} · ${hit.url.replace(/[a-f0-9]{16,}/g, '«hex»')}`);
  } catch (err) { row('av1 adaptador E1180', `error ${short(err)}`); }

  row('— AnimeFLV —', '·');
  await ficha(http, 'flv', `${flv.BASE}/anime/one-piece/`, (html) => flv.episodesOf(html));
  let flvPrefix = '';
  try {
    const html = await http.text(`${flv.BASE}/anime/one-piece/`, { maxBytes: 2 * 1024 * 1024 });
    const eps = flv.episodesOf(html);
    const last = eps[eps.length - 1];
    row('flv permalinks', eps.slice(-3).map((e) => `${e.number}→${e.permalink}`).join(' · '));
    // El prefijo del permalink es todo lo anterior al número: se prueba con él.
    flvPrefix = last?.permalink?.replace(new RegExp(`-?${last.number}/?$`), '') || '';
    row('flv prefijo', flvPrefix || 'no se pudo derivar');
  } catch (err) { row('flv permalinks', `error ${short(err)}`); }
  if (flvPrefix) await probeDirect(http, 'flv prefijo', (n) => `${flvPrefix}-${n}`, [1000, 1100, 1150], flv.serversOf);
}

async function main() {
  const fs = await import('node:fs');
  fs.mkdirSync('.probe', { recursive: true });
  try { await steps(); } catch (err) { row('error', short(err)); console.error(err); }
  const md = ['| Paso | Resultado |', '|---|---|'];
  for (const r of rows) md.push(`| ${r.step} | ${String(r.note).replace(/\|/g, '/')} |`);
  md.push('', 'Alcance de episodios en AnimeAV1 y AnimeFLV (One Piece).');
  fs.writeFileSync('.probe/anime-reach.md', `${md.join('\n')}\n`);
  console.log(`\n${md.join('\n')}`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
