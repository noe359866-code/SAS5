#!/usr/bin/env node
/**
 * Sonda 12 (24-11-2026): listas de canales en vivo por categorías.
 *
 * Proveedor ÚNICO: m3u.tvcluboficial.com, vía la lista Magma TV
 * (repo JMigue85/IPTV-SV). La sonda 13 demostró que ese host no exige
 * User-Agent y sirve CORS abierto; IPTVSV (IP:puerto rotativos) y
 * m3uts.xyz (tokens caducos) quedaron descartados como fuentes.
 *
 * Cada canal se verifica con el User-Agent que declara la lista
 * (#EXTVLCOPT:http-user-agent) y, si falla, con el UA genérico de la sonda.
 * Se considera VÁLIDO solo si la cadena completa reproduce: maestra (200 + #EXTM3U) → variante → primer segmento con bytes MPEG-TS/fMP4 (HTTP 200/206). No se imprimen credenciales;
 * las URLs se redactan. Además del informe, se escribe .probe/live-channels.json
 * con la ficha completa de los canales válidos (semilla para el addon).
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
const { enrichSeedWithLogos } = require('./live-logos.cjs');

const GENERIC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TIMEOUT = 10_000;
const CONCURRENCY = 12;

const SOURCES = [
  { id: 'magma', url: 'https://raw.githubusercontent.com/JMigue85/IPTV-SV/main/Magma%20TV%20-Titan2022_XD.m3u' },
];

/** Proveedor único de señales: solo se verifican URLs de este host. */
const PROVIDER_HOST = /(^|\.)m3u\.tvcluboficial\.com$/;

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
    if (line.startsWith('#EXTVLCOPT:http-user-agent=')) { pendingUa = line.slice(27).trim(); continue; }
    if (!line.startsWith('#EXTINF')) continue;
    const name = (line.split(',').pop() || '').trim();
    const logo = (/tvg-logo="([^"]+)"/.exec(line) || [])[1] || '';
    const group = (/group-title="([^"]+)"/.exec(line) || [])[1] || '';
    let url = '', ua = pendingUa;
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const l = lines[j].trim();
      if (!l) continue;
      if (l.startsWith('#EXTVLCOPT:http-user-agent=')) { ua = l.slice(27).trim(); continue; }
      if (l.startsWith('#')) continue;
      url = l;
      break;
    }
    pendingUa = '';
    if (name && /^https?:\/\//i.test(url)) entries.push({ name, logo, group, url, ua, source });
  }
  return entries;
}

/**
 * Verifica un canal: primero con su UA declarado; si falla, con el genérico.
 * La sonda 13 mostró playlists vivas con segmentos muertos (canal fantasma),
 * así que «válido» exige la cadena completa: maestra → variante → segmento
 * con bytes de vídeo (MPEG-TS o fMP4).
 */
async function verify(entry) {
  const tries = entry.ua && entry.ua !== GENERIC_UA
    ? [{ 'User-Agent': entry.ua }, { 'User-Agent': GENERIC_UA }]
    : [{ 'User-Agent': GENERIC_UA }];
  let last = 'sin respuesta';
  for (const headers of tries) {
    const t0 = Date.now();
    const res = await get(entry.url, { Range: 'bytes=0-3000', ...headers });
    const ms = Date.now() - t0;
    const head = (res.body || '').slice(0, 3000);
    if (res.status !== 200 || !/#EXTM3U/.test(head)) {
      last = `HTTP ${res.status}${res.error ? ` ${res.error}` : ''} · ${ms} ms`;
      continue;
    }
    // Maestra con variantes → bajar a la primera variante
    let mediaUrl = entry.url, body = head;
    const variants = (head.match(/#EXT-X-STREAM-INF/g) || []).length;
    if (variants) {
      const lines = head.split('\n');
      const idx = lines.findIndex((l) => /#EXT-X-STREAM-INF/.test(l));
      const rel = (lines[idx + 1] || '').trim();
      if (!rel) { last = 'maestra sin variante legible'; continue; }
      try { mediaUrl = new URL(rel, entry.url).toString(); } catch { last = 'variante malformada'; continue; }
      const media = await get(mediaUrl, { Range: 'bytes=0-3000', ...headers });
      if (media.status !== 200 || !/#EXTM3U/.test(media.body)) { last = `variante HTTP ${media.status}`; continue; }
      body = media.body;
    }
    // Primer segmento con bytes de vídeo
    const segLine = body.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
    if (!segLine) { last = 'playlist sin segmentos'; continue; }
    let segUrl;
    try { segUrl = new URL(segLine, mediaUrl).toString(); } catch { last = 'segmento malformado'; continue; }
    const seg = await get(segUrl, { Range: 'bytes=0-188', ...headers });
    const bh = seg.body || '';
    const looksTs = bh.charCodeAt(0) === 0x47;
    const looksFmp4 = bh.slice(4, 8) === 'ftyp' || bh.slice(0, 12).includes('ftyp');
    if ((seg.status === 200 || seg.status === 206) && (looksTs || looksFmp4)) {
      return { ok: true, ua: headers['User-Agent'] === entry.ua ? entry.ua : '',
        state: `HLS VÁLIDO${variants ? ` ${variants}v` : ''} · ${looksTs ? 'TS' : 'fMP4'} · ${ms} ms` };
    }
    last = `segmento HTTP ${seg.status} (fantasma)`;
  }
  return { ok: false, ua: '', state: last };
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
  say('# Sonda 12: canales en vivo por categorías (proveedor único: m3u.tvcluboficial.com)');
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
    let host = '';
    try { host = new URL(e.url).hostname; } catch { continue; }
    if (!PROVIDER_HOST.test(host)) continue; // solo el proveedor elegido
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
    // tvcluboficial no exige UA (sonda 13): la semilla nunca arrastra UA
    if (ok) valid.push({ name, slug: slugOf(name), category, logo, url: wanted[i].url, ua: '' });
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

  // Logos de iptv-org/database (best effort): la lista Magma no trae tvg-logo.
  // Se conservan los logos de la semilla previa cuando el casado nuevo falla.
  try {
    let prev = [];
    try { prev = JSON.parse(fs.readFileSync('lib/data/liveChannelsSeed.json', 'utf8')); } catch { /* primera vez */ }
    const withLogo = await enrichSeedWithLogos(seed, prev);
    say('');
    say(`logos iptv-org: ${withLogo}/${seed.length} canales con logo`);
  } catch (err) {
    say('');
    say(`logos iptv-org: no disponibles (${err && err.message})`);
  }

  // Orden estable del catálogo: por categoría y nombre alfabético.
  const CAT_ORDER = ['deportes', 'entretenimiento', 'cine', 'infantil', 'anime', 'musica', 'noticias', 'documentales', 'espana', 'mexico', 'argentina', 'colombia', 'chile', 'peru'];
  seed.sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category)
    || String(a.name).localeCompare(String(b.name), 'es'));

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
