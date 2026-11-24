#!/usr/bin/env node
/**
 * Sonda 12 (24-11-2026): listas de canales en vivo por categorías.
 *
 * Fuentes:
 *  - Magma TV (repo JMigue85/IPTV-SV): 220 canales con User-Agent propio.
 *  - IPTVSV.m3u (mismo repo): 1900 canales; se verifican los grupos temáticos
 *    (Deportes, Entretenimiento, Cine, Infantiles, Anime, Música,
 *    Informativos, Documentales) y los países latinos + España.
 *
 * Cada canal se verifica con el User-Agent que declara la lista
 * (#EXTVLCOPT:http-user-agent) y, si falla, con el UA genérico de la sonda.
 * Se considera VÁLIDO solo HTTP 200 + #EXTM3U. No se imprimen credenciales;
 * las URLs se redactan. Además del informe, se escribe .probe/live-channels.json
 * con la ficha completa de los canales válidos (semilla para el addon).
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');

const GENERIC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TIMEOUT = 10_000;
const CONCURRENCY = 12;

const SOURCES = [
  { id: 'magma', url: 'https://raw.githubusercontent.com/JMigue85/IPTV-SV/main/Magma%20TV%20-Titan2022_XD.m3u' },
  { id: 'iptvsv', url: 'https://raw.githubusercontent.com/JMigue85/IPTV-SV/main/IPTVSV.m3u' },
];

/** group-title → categoría del addon (null = no entra en catálogo propio). */
const CATEGORY_BY_GROUP = [
  [/^(ESPN|FOX Sports|DSports|Deportes)$/i, 'deportes'],
  [/deport/i, 'deportes'],
  [/infantil|kids|niñ/i, 'infantil'],
  [/anime/i, 'anime'],
  [/m[uú]sica|music/i, 'musica'],
  [/informativ|noticias|news/i, 'noticias'],
  [/documental|cultura/i, 'documentales'],
  [/cine|pel[ií]cula|movie/i, 'cine'],
  [/entretenimiento|entreten|series|general|variedades/i, 'entretenimiento'],
  [/^(España|Spain)/i, 'espana'],
  [/^(México|Mexico)/i, 'mexico'],
  [/^(Argentina)/i, 'argentina'],
  [/^(Colombia)/i, 'colombia'],
  [/^(Chile)/i, 'chile'],
  [/^(Per[uú])/i, 'peru'],
];

const categoryOf = (group) => {
  for (const [re, cat] of CATEGORY_BY_GROUP) if (re.test(group || '')) return cat;
  return null;
};

const slugOf = (name) => String(name || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

const out = [];
const say = (line) => { out.push(line); console.log(line); };
const redact = (raw) => {
  try {
    const url = new URL(String(raw));
    return `${url.hostname}${url.pathname.slice(0, 50)}${url.search ? `?(${url.search.length} B)` : ''}`;
  } catch { return String(raw || '').slice(0, 70); }
};

async function get(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': GENERIC_UA, ...headers } });
    return { status: res.status, url: res.url, body: (await res.text()).slice(0, 4_000_000) };
  } catch (err) {
    return { status: 0, url, body: '', error: `${err?.name || 'err'}:${err?.cause?.code || ''}` };
  } finally { clearTimeout(timer); }
}

function parseM3U(text, source) {
  const entries = [];
  const lines = text.split('\n');
  let pendingUa = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#EXTVLCOPT:http-user-agent=')) { pendingUa = line.slice(28).trim(); continue; }
    if (!line.startsWith('#EXTINF')) continue;
    const name = (line.split(',').pop() || '').trim();
    const logo = (/tvg-logo="([^"]+)"/.exec(line) || [])[1] || '';
    const group = (/group-title="([^"]+)"/.exec(line) || [])[1] || '';
    let url = '', ua = pendingUa;
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const l = lines[j].trim();
      if (!l) continue;
      if (l.startsWith('#EXTVLCOPT:http-user-agent=')) { ua = l.slice(28).trim(); continue; }
      if (l.startsWith('#')) continue;
      url = l;
      break;
    }
    pendingUa = '';
    if (name && /^https?:\/\//i.test(url)) entries.push({ name, logo, group, url, ua, source });
  }
  return entries;
}

/** Verifica un canal: primero con su UA declarado; si falla, con el genérico. */
async function verify(entry) {
  const tries = entry.ua && entry.ua !== GENERIC_UA
    ? [{ 'User-Agent': entry.ua }, { 'User-Agent': GENERIC_UA }]
    : [{ 'User-Agent': GENERIC_UA }];
  for (const headers of tries) {
    const t0 = Date.now();
    const res = await get(entry.url, { Range: 'bytes=0-400' });
    const ms = Date.now() - t0;
    const head = (res.body || '').slice(0, 400);
    if (res.status === 200 && /#EXTM3U/.test(head)) {
      const variants = (head.match(/#EXT-X-STREAM-INF/g) || []).length;
      return { ok: true, ua: headers['User-Agent'] === entry.ua ? entry.ua : '', state: `HLS VÁLIDO${variants ? ` ${variants}v` : ''} · ${ms} ms` };
    }
    var last = `HTTP ${res.status}${res.error ? ` ${res.error}` : ''} · ${ms} ms`;
  }
  return { ok: false, ua: '', state: last || 'sin respuesta' };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }));
  return results;
}

(async () => {
 try {
  say('# Sonda 12: canales en vivo por categorías (Magma TV + IPTVSV)');
  say('');
  say(`Fecha: ${new Date().toISOString()}`);
  say('');

  const all = [];
  for (const src of SOURCES) {
    const res = await get(src.url);
    say(`lista ${src.id}: HTTP ${res.status} · ${res.body.length} B`);
    if (res.status === 200) all.push(...parseM3U(res.body, src.id));
  }

  // Dedupe por URL base; solo entradas con categoría reconocida.
  const seen = new Set();
  const wanted = [];
  for (const e of all) {
    const category = categoryOf(e.group);
    if (!category) continue;
    const key = e.url.split('?')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    wanted.push({ ...e, category, slug: slugOf(e.name) });
  }
  const byCat = {};
  for (const e of wanted) byCat[e.category] = (byCat[e.category] || 0) + 1;
  say(`\\ncanales a verificar: ${wanted.length} (de ${all.length} entradas en crudo)`);
  say(`por categoría: ${Object.entries(byCat).map(([k, v]) => `${k}:${v}`).join(' · ')}`);
  say('');

  const checks = await mapLimit(wanted, CONCURRENCY, async (e) => ({ e, r: await verify(e) }));

  const valid = [];
  const rows = { ok: [], bad: [] };
  for (let i = 0; i < wanted.length; i++) {
    const { category, name, logo, group, source } = wanted[i];
    const { ok, ua, state } = checks[i].r;
    const line = `| ${name} | ${category} | ${group || '—'} | ${source} | ${redact(wanted[i].url)} | ${state}${ua ? ' · UA propio' : ''} |`;
    (ok ? rows.ok : rows.bad).push(line);
    if (ok) valid.push({ name, slug: slugOf(name), category, logo, url: wanted[i].url, ua: ua || '' });
  }

  say(`## Válidos (${rows.ok.length})`);
  say('');
  say('| Canal | Categoría | Grupo | Lista | URL | Verificación |');
  say('|---|---|---|---|---|---|');
  for (const l of rows.ok) say(l);
  say('');
  say(`## Sin señal válida (${rows.bad.length})`);
  say('');
  say('| Canal | Categoría | Grupo | Lista | URL | Verificación |');
  say('|---|---|---|---|---|---|');
  for (const l of rows.bad) say(l);
  say('');

  // Resumen por categoría para decidir catálogos
  const sumCat = {};
  for (const v of valid) sumCat[v.category] = (sumCat[v.category] || 0) + 1;
  say('## Resumen de válidos por categoría');
  say('');
  for (const [cat, n] of Object.entries(sumCat).sort((a, b) => b[1] - a[1])) say(`- ${cat}: ${n}`);

  // Semilla para el addon: solo válidos, sin duplicar slug por categoría.
  fs.mkdirSync('.probe', { recursive: true });
  const seedSeen = new Set();
  const seed = valid.filter((v) => {
    const k = `${v.category}:${v.slug}`;
    if (seedSeen.has(k)) return false;
    seedSeen.add(k);
    return true;
  });
  fs.writeFileSync('.probe/live-channels.json', JSON.stringify(seed, null, 1) + '\n');
  console.log(`\\n.probe/live-channels.json (${seed.length} canales válidos)`);
 } catch (err) {
  say(`\\nERROR de sonda: ${err && err.message}`);
 } finally {
  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/live-lists.md', out.join('\n') + '\n');
  console.log('\\n.probe/live-lists.md');
 }
})();
