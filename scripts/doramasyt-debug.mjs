#!/usr/bin/env node
/** Diagnóstico de la cadena de DoramasYT con funciones exportadas. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
const d = require('../lib/sites/doramasyt');
const { providerHttp } = require('../lib/providerHttp');
const { fetchText } = { fetchText: (http, url) => http.text(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' }, maxBytes: 2 * 1024 * 1024 }) };

const RESOLVED = { title: 'Qué le ocurre a la secretaria Kim', altTitle: "What's Wrong with Secretary Kim?", year: '2018', mediaType: 'series', season: 1, episode: 16 };
const out = [];
const log = (line) => { out.push(line); console.log(line); };

async function main() {
  const http = providerHttp(25_000, 12);
  const listing = await fetchText(http, `${d.BASE}/buscar?q=secretaria%20kim`);
  const matches = d.listingMatches(listing, RESOLVED);
  log(`listado ${listing.length} B · fichas=${matches.length} · ${matches.join(' ')}`);
  const found = matches[0] || `${d.BASE}/dorama/whats-wrong-with-secretary-kim-latino-sub-espanol`;
  const detail = await fetchText(http, found);
  log(`ficha ${found} · nombres=${JSON.stringify(d.detailTitle(detail))} · año=${d.detailYear(detail)} · audio=${d.audioOf(detail, found)}`);
  const episodes = d.episodesOf(detail, found);
  log(`episodios=${episodes.length} · ${episodes.slice(-3).map((entry) => `${entry.number}:${entry.url}`).join(' ')}`);
  const hit = await d.hitsFromPage(http, found, RESOLVED, 12_000, true);
  log(`hitsFromPage=${JSON.stringify({ hits: hit?.hits?.length || 0, reason: hit?.reason, notes: hit?.notes })}`);
  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/doramasyt-debug.md', `${out.join('\n')}\n`);
}

main().catch((err) => { log(`error ${err?.stack || err}`); fs.mkdirSync('.probe', { recursive: true }); fs.writeFileSync('.probe/doramasyt-debug.md', `${out.join('\n')}\n`); });
