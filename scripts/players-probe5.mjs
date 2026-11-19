#!/usr/bin/env node
/**
 * Sonda v5 (diagnóstico): estructura de series, buscadores y menús.
 * Guarda el HTML en .probe/html y resume:
 *   - enlaces de temporada/episodio (regex por sitio)
 *   - formularios de búsqueda y URL del buscador
 *   - bloque de resultados del buscador (primeras coincidencias)
 */

import fs from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TIMEOUT = 15_000;

async function req(url, { referer, body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { method: body ? 'POST' : 'GET', body, redirect: 'follow', signal: controller.signal,
      headers: { 'User-Agent': UA, 'Accept-Language': 'es-MX,es;q=0.9', Accept: 'text/html,*/*;q=0.8',
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(referer ? { Referer: referer } : {}) } });
    const buf = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, size: buf.byteLength, body: new TextDecoder().decode(buf.slice(0, 500 * 1024)), finalUrl: res.url };
  } catch (err) { return { status: 0, error: String(err?.name || err?.message).slice(0, 60), body: '', size: 0 }; }
  finally { clearTimeout(timer); }
}

const uniq = (arr) => [...new Set(arr)];

function describe(name, res, { save, patterns = [] } = {}) {
  console.log(`\n## ${name} → ${res.status}${res.error ? ` ${res.error}` : ''} ${res.size}b ${res.finalUrl ? `(${res.finalUrl.slice(0, 80)})` : ''}`);
  if (!res.body) return {};
  if (save) fs.writeFileSync(`.probe/html/${save}.html`, res.body);
  const out = { status: res.status, size: res.size, finalUrl: res.finalUrl };
  out.forms = uniq([...res.body.matchAll(/<form[^>]*?(?:action="([^"]*)")?[^>]*>([\s\S]{0,600}?)<\/form>/gi)].slice(0, 4)
    .map((m) => `${m[1] || '(misma página)'} [${uniq([...m[2].matchAll(/name="([^"]+)"/g)].map((x) => x[1])).join(',')}]`));
  out.nav = uniq([...res.body.matchAll(/<a[^>]+href="([^"]+)"[^>]*>\s*(?:<[^>]+>\s*)*([^<]{2,28})\s*</g)]
    .filter((m) => /serie|temporada|season|episod|cap[ií]tulo|buscar|search/i.test(`${m[1]} ${m[2]}`))
    .map((m) => `${m[2].trim().slice(0, 22)} → ${m[1].slice(0, 90)}`)).slice(0, 10);
  for (const { re, label } of patterns) {
    out[label] = uniq([...res.body.matchAll(re)].map((m) => m[1] || m[0])).slice(0, 8);
  }
  for (const [key, value] of Object.entries(out)) {
    if (Array.isArray(value) && value.length) console.log(`  ${key}: ${value.join('  |  ').slice(0, 600)}`);
  }
  return out;
}

async function main() {
  fs.mkdirSync('.probe/html', { recursive: true });
  const report = {};

  // ── ver.gnula.one ──
  report.gnulaSerie = describe('gnula: ficha de serie', await req('https://ver.gnula.one/tvshows/the-last-of-us/', { referer: 'https://ver.gnula.one/' }),
    { save: 'gnula-serie', patterns: [
      { re: /href="(https:\/\/ver\.gnula\.one\/[^"]*(?:temporada|season|episod|\d+x\d+)[^"]*)"/gi, label: 'episodios' },
      { re: /data-season="([^"]+)"/g, label: 'data-season' },
      { re: /(?:episode|season)[-_]?(?:id|slug|post)["']?\s*[:=]\s*["']?([\w-]+)/gi, label: 'ids' },
    ] });
  report.gnulaSearch = describe('gnula: buscador ?s=', await req('https://ver.gnula.one/?s=spider-man', { referer: 'https://ver.gnula.one/' }),
    { save: 'gnula-search', patterns: [
      { re: /href="(https:\/\/ver\.gnula\.one\/movies\/[^"]+)"/g, label: 'resultados' },
      { re: /(challenge|Just a moment|cf-browser)/i, label: 'bloqueo' },
    ] });
  report.gnulaSearchAlt = describe('gnula: buscador /?s= (otra UA)', await req('https://ver.gnula.one/search/spider-man/', { referer: 'https://ver.gnula.one/' }));

  // ── tubeonline ──
  report.tubeSerie = describe('tubeonline: ficha de serie', await req('https://www.tubeonline.net/serie/el-agente-nocturno/', { referer: 'https://www.tubeonline.net/' }),
    { save: 'tube-serie', patterns: [
      { re: /href="(https:\/\/www\.tubeonline\.net\/(?:episodio|episode)[^"]*)"/g, label: 'episodios' },
      { re: /href="(https:\/\/www\.tubeonline\.net\/serie\/[^"]*?(?:temporada|season)[^"]*)"/gi, label: 'temporadas' },
      { re: /data-post="(\d+)"[^>]*data-nume="(\d+)"/g, label: 'dooplay' },
      { re: /(season|temporada)\s*(\d+)/gi, label: 'texto temporada' },
    ] });
  report.tubeSearch = describe('tubeonline: buscador ?s=', await req('https://www.tubeonline.net/?s=spider-man', { referer: 'https://www.tubeonline.net/' }),
    { save: 'tube-search', patterns: [
      { re: /href="(https:\/\/www\.tubeonline\.net\/(?:pelicula|serie)\/[^"]+)"/g, label: 'resultados' },
    ] });

  // ── verpeliculasultra ──
  report.ultraHome = describe('ultra: portada (menú)', await req('https://verpeliculasultra.com/', { referer: 'https://verpeliculasultra.com/' }),
    { save: 'ultra-home', patterns: [
      { re: /href="(https:\/\/verpeliculasultra\.com\/[a-z-]+\/)"/g, label: 'secciones' },
    ] });
  const dleBody = 'do=search&subaction=search&story=F1+la+pelicula';
  report.ultraSearchPost = describe('ultra: POST index.php?do=search', await req('https://verpeliculasultra.com/index.php?do=search', { referer: 'https://verpeliculasultra.com/', body: dleBody }),
    { save: 'ultra-search', patterns: [
      { re: /href="(https:\/\/verpeliculasultra\.com\/[a-z-]+\/\d+-[a-z0-9-]+\.html)"/g, label: 'resultados' },
      { re: /class="([^"]*short[^"]*)"/g, label: 'shortstory' },
    ] });
  report.ultraSearchGet = describe('ultra: GET index.php?do=search&story=', await req('https://verpeliculasultra.com/index.php?do=search&subaction=search&story=F1+la+pelicula'));

  // ── mirandogratis ──
  report.mirandoSearch = describe('mirando: buscador ?s=', await req('https://mirandogratis.com/?s=el+reino+prohibido', { referer: 'https://mirandogratis.com/' }),
    { save: 'mirando-search', patterns: [
      { re: /href="(https:\/\/mirandogratis\.com\/[a-z0-9-]+\.html)"/g, label: 'resultados' },
    ] });

  fs.writeFileSync('.probe/structure.json', JSON.stringify(report, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
