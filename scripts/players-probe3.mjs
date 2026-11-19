#!/usr/bin/env node
/**
 * Sonda v4 (diagnóstico): detalles finales para el extractor nativo.
 *   1. Byse: JSON completo de /api/videos/<code> (qué campo trae el medio).
 *   2. streamwish / hglink / hgcloud: tamaño y forma de /main.js (¿pesado?).
 *   3. verpeliculasultra: buscador (form y URL) y ficha de serie.
 *   4. ver.gnula.one: buscador y ficha de episodio.
 *   5. tubeonline: numeración de episodios (data-post/data-nume).
 */

import fs from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TIMEOUT = 12_000;

async function req(url, { referer, maxBytes = 300 * 1024 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal,
      headers: { 'User-Agent': UA, 'Accept-Language': 'es-MX,es;q=0.9', ...(referer ? { Referer: referer } : {}) } });
    const buf = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, type: (res.headers.get('content-type') || '').split(';')[0],
      body: new TextDecoder().decode(buf.slice(0, maxBytes)), size: buf.byteLength };
  } catch (err) { return { status: 0, error: String(err?.name || err?.message).slice(0, 60), body: '', size: 0 }; }
  finally { clearTimeout(timer); }
}

const clean = (s, n = 200) => String(s || '').replace(/\s+/g, ' ').slice(0, n);

async function byse() {
  const res = await req('https://byseraguci.com/api/videos/intdacsm8cvn', { referer: 'https://mirandogratis.com/' });
  let json = null;
  try { json = JSON.parse(res.body); } catch { /* no json */ }
  const keys = json ? Object.keys(json) : [];
  const urls = json ? [...JSON.stringify(json).matchAll(/https?:\/\/[^"\\ ]+/g)].map((m) => m[0]) : [];
  console.log(`byse: ${res.status} keys=${keys.join(',')}`);
  console.log(`  urls: ${urls.slice(0, 6).map((u) => u.slice(0, 110)).join('\n        ')}`);
  return { status: res.status, keys, urls: urls.slice(0, 6), sample: clean(res.body, 900) };
}

async function mainJs() {
  const out = [];
  for (const [name, url] of [['streamwish', 'https://streamwish.to/main.js?v=1.1.9'], ['hglink', 'https://hglink.to/main.js?v=1.1.9'], ['hgcloud', 'https://hgcloud.to/main.js?v=1.1.9']]) {
    const res = await req(url);
    const hints = [...new Set([...(res.body.matchAll(/["'`](\/?[\w/.-]*(?:dl|api|embed|hls|m3u8|file)[\w/.?=&-]*)["'`]/gi))].map((m) => m[1]))].slice(0, 12);
    console.log(`${name}/main.js → ${res.status} ${res.size}b hints=${hints.slice(0, 8).join(' | ')}`);
    if (res.body) fs.writeFileSync(`.probe/html/${name}-main.js`, res.body);
    out.push({ name, status: res.status, size: res.size, hints, head: clean(res.body, 400) });
  }
  return out;
}

async function ultra() {
  const search = await req('https://verpeliculasultra.com/index.php?do=search&subaction=search&story=F1%20la%20pelicula');
  const forms = [...search.body.matchAll(/<form[^>]*action="([^"]*)"[^>]*>([\s\S]{0,400}?)<\/form>/gi)].slice(0, 3)
    .map((m) => ({ action: m[1], inputs: [...m[2].matchAll(/name="([^"]+)"/g)].map((x) => x[1]) }));
  const results = [...new Set([...search.body.matchAll(/href="(https:\/\/verpeliculasultra\.com\/[a-z-]+\/\d+-[a-z0-9-]+\.html)"/g)].map((m) => m[1]))].slice(0, 5);
  const serial = await req('https://verpeliculasultra.com/xfsearch/series/');
  const serialLinks = [...new Set([...serial.body.matchAll(/href="(https:\/\/verpeliculasultra\.com\/[^"]*\/\d+-[^"]*\.html)"/g)].map((m) => m[1]))].slice(0, 4);
  console.log(`ultra: search ${search.status} ${search.size}b forms=${JSON.stringify(forms)} results=${results.slice(0, 3).join(' ')}`);
  console.log(`  series index ${serial.status} ${serial.size}b ${serialLinks.join(' ')}`);
  return { search: { status: search.status, size: search.size, forms, results }, serial: { status: serial.status, size: serial.size, links: serialLinks }, http: search.body.match(/HTTP (\d{3})/)?.[1] };
}

async function gnula() {
  const res = await req('https://ver.gnula.one/?s=spider-man');
  const links = [...new Set([...res.body.matchAll(/href="(https:\/\/ver\.gnula\.one\/(?:movies|tvshows)\/[^"#]+)"/g)].map((m) => m[1]))].slice(0, 4);
  const season = await req('https://ver.gnula.one/tvshows/the-last-of-us/');
  const epLinks = [...new Set([...season.body.matchAll(/href="(https:\/\/ver\.gnula\.one\/(?:tvshows|episodes)\/[^"#]*(?:-\d+x\d+|\/season\/)[^"#]*)"/g)].map((m) => m[1]))].slice(0, 5);
  const trids = [...new Set([...season.body.matchAll(/trembed=(\d+)&(?:amp;)?trid=(\d+)&(?:amp;)?trtype=(\d+)/g)].map((m) => m.slice(1).join('/')))].slice(0, 6);
  console.log(`gnula: search ${res.status} ${res.size}b ${links.join(' ')}`);
  console.log(`  episodios: ${epLinks.join(' ')}`);
  console.log(`  trembed (season page): ${trids.join(' ')}`);
  return { search: { status: res.status, size: res.size, links }, season: { status: season.status, size: season.size, epLinks, trids } };
}

async function tube() {
  const res = await req('https://www.tubeonline.net/serie/el-agente-nocturno/');
  const players = [...res.body.matchAll(/data-post="(\d+)"\s+data-nume="(\d+)"\s+data-type="([^"]+)"/g)].slice(0, 6).map((m) => m.slice(1));
  const seasons = [...new Set([...res.body.matchAll(/href="(https:\/\/www\.tubeonline\.net\/serie\/[^"]*?(?:season|temporada)[^"]*?)"/gi)].map((m) => m[1]))].slice(0, 5);
  const episodes = [...new Set([...res.body.matchAll(/href="(https:\/\/www\.tubeonline\.net\/episodio\/[^"]+)"/g)].map((m) => m[1]))].slice(0, 5);
  console.log(`tube: serie ${res.status} ${res.size}b players=${JSON.stringify(players.slice(0, 3))}`);
  console.log(`  seasons=${seasons.join(' ')}`);
  console.log(`  episodios=${episodes.join(' ')}`);
  return { status: res.status, size: res.size, players, seasons, episodes };
}

const tasks = { byse, mainJs, ultra, gnula, tube };

async function main() {
  const only = process.argv.slice(2).filter((arg) => tasks[arg]);
  const keys = only.length ? only : Object.keys(tasks);
  const out = {};
  for (const key of keys) {
    console.log(`\n## ${key}`);
    try { out[key] = await tasks[key](); } catch (err) { out[key] = { error: String(err).slice(0, 140) }; }
  }
  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/players-v4.json', JSON.stringify(out, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
