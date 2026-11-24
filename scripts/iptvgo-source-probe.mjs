#!/usr/bin/env node
/**
 * Sonda 14 (24-11-2026): la fuente iptvgo.cc a fondo (petición del usuario).
 *
 * Patrón Xtream Codes: /live/<usuario>/<clave>/<id>.m3u8. Se mide:
 *  1. Requisitos de acceso: UA de lista / UA genérico / sin UA / con Referer;
 *     cabeceras CORS y content-type del canal de ejemplo (id 1455).
 *  2. Cadena completa de reproducción: playlist → variante → primer segmento
 *     con bytes MPEG-TS/fMP4, en una muestra de IDs.
 *  3. Xtream player_api.php: si responde, el host deja de ser un saco de IDs
 *     anónimos: get_live_streams trae nombre, logo y categoría de cada canal.
 *  4. Enumerabilidad del rango de IDs con la credencial dada.
 *
 * No se imprimen credenciales; las URLs se redactan.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');

const GENERIC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36';
const TIMEOUT = 15_000;
const CONCURRENCY = 10;

// Credencial compartida por el usuario en la URL de ejemplo.
const BASE = 'http://iptvgo.cc';
const AUTH = 'Will1/Will1';
const qs = 'username=Will1&password=Will1';

const out = [];
const say = (line) => { out.push(line); console.log(line); };
const redact = (raw) => String(raw).replace(AUTH, '<cred>').replace(qs, 'username=…&password=…');

async function get(url, headers = {}, range = 'bytes=0-2048', maxBody = 2_000_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const h = { ...headers };
    if (range) h.Range = range;
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: h });
    const body = (await res.text()).slice(0, maxBody);
    return {
      status: res.status,
      body,
      contentType: res.headers.get('content-type') || '',
      cors: res.headers.get('access-control-allow-origin') || '',
      server: res.headers.get('server') || '',
      setCookie: res.headers.get('set-cookie') || '',
    };
  } catch (err) {
    return { status: 0, body: '', error: `${err?.name || 'err'}:${err?.cause?.code || ''}` };
  } finally { clearTimeout(timer); }
}

/** playlist → variante → primer segmento con bytes de vídeo. */
async function fullChain(url, headers, directTs = null) {
  const master = await get(url, headers, 'bytes=0-8192');
  if ((master.status !== 200 && master.status !== 206) || !/#EXTM3U/.test(master.body)) {
    return { ok: false, detail: `playlist HTTP ${master.status}${master.error ? ' ' + master.error : ''}` };
  }
  let mediaUrl = url, body = master.body, variants = 0;
  if (/#EXT-X-STREAM-INF/.test(master.body)) {
    const lines = master.body.split('\n');
    const idx = lines.findIndex((l) => /#EXT-X-STREAM-INF/.test(l));
    const rel = (lines[idx + 1] || '').trim();
    if (!rel) return { ok: false, detail: 'maestra sin variante legible' };
    variants = (master.body.match(/#EXT-X-STREAM-INF/g) || []).length;
    mediaUrl = new URL(rel, url).toString();
    const media = await get(mediaUrl, headers, 'bytes=0-8192');
    if ((media.status !== 200 && media.status !== 206) || !/#EXTM3U/.test(media.body)) {
      return { ok: false, detail: `variante HTTP ${media.status}` };
    }
    body = media.body;
  }
  const segLine = body.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
  if (!segLine) return { ok: false, detail: 'playlist sin segmentos' };
  const segUrl = new URL(segLine, mediaUrl).toString();
  // La playlist contesta a todos; el segmento es lo protegido. Se prueba la
  // batería: con Range, sin Range, con Referer, con UA de reproductor.
  const segHost = (() => { try { return new URL(segUrl).host; } catch { return '?'; } });
  const cookie = (master.setCookie || '').split(';')[0];
  const attempts = [
    ['con Range', { ...headers, Range: 'bytes=0-188' }],
    ['sin Range', { ...headers }],
    ['con Referer', { ...headers, Referer: `${BASE}/` }],
    ['UA VLC', { 'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20' }],
    ...(cookie ? [['con Cookie de sesión', { ...headers, Cookie: cookie }]] : []),
    ['auth por query', { ...headers }],
  ];
  let segUrlFinal = segUrl;
  const tried = [`host ${segHost}${cookie ? ' · hay cookie' : ''}`];
  for (const [label, h] of attempts) {
    const target = label === 'auth por query' ? `${segUrl}${segUrl.includes('?') ? '&' : '?'}${qs}` : segUrl;
    const seg = await get(target, h, h.Range ? h.Range : null, 4_000);
    const bh = seg.body || '';
    const looksTs = bh.charCodeAt(0) === 0x47;
    const looksFmp4 = bh.slice(4, 8) === 'ftyp' || bh.slice(0, 12).includes('ftyp');
    tried.push(`${label}: ${seg.status}${looksTs ? ' TS' : looksFmp4 ? ' fMP4' : ''}${seg.error ? ' ' + seg.error : ''}`);
    if ((seg.status === 200 || seg.status === 206) && (looksTs || looksFmp4)) {
      return { ok: true, detail: `${tried.join(' → ')} · ${variants || '—'} variantes` };
    }
  }
  // Plan B Xtream: stream TS directo sin playlist (/live/<u>/<p>/<id>.ts)
  if (directTs) {
    const ts = await get(directTs, headers, 'bytes=0-188', 4_000);
    const bh = ts.body || '';
    tried.push(`TS directo: ${ts.status}${bh.charCodeAt(0) === 0x47 ? ' MPEG-TS' : ''}`);
    if ((ts.status === 200 || ts.status === 206) && bh.charCodeAt(0) === 0x47) {
      return { ok: true, detail: tried.join(' → '), directTs: true };
    }
  }
  return { ok: false, detail: tried.join(' → ') };
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
  say('# Sonda 14: iptvgo.cc a fondo (patrón Xtream /live/<u>/<p>/<id>.m3u8)');
  say('');
  say(`Fecha: ${new Date().toISOString()}`);
  say('');

  const EXAMPLE = `${BASE}/live/${AUTH}/1455.m3u8`;

  // 1) Acceso
  say('## 1. Acceso al canal de ejemplo (id 1455)');
  say('');
  say('| Intento | HTTP | Content-Type | CORS | ¿#EXTM3U? |');
  say('|---|---|---|---|---|');
  for (const [label, headers] of [
    ['UA Android (como en las listas)', { 'User-Agent': ANDROID_UA }],
    ['UA navegador genérico', { 'User-Agent': GENERIC_UA }],
    ['Sin User-Agent', {}],
    ['Con Referer al host', { 'User-Agent': ANDROID_UA, Referer: `${BASE}/` }],
  ]) {
    const r = await get(EXAMPLE, headers, 'bytes=0-400');
    say(`| ${label} | ${r.status}${r.error ? ' ' + r.error : ''} | ${r.contentType || '—'} | ${r.cors || '—'} | ${/#EXTM3U/.test(r.body) ? 'sí' : 'no'} |`);
  }
  say('');

  // 2) Cadena completa en muestra
  say('## 2. Cadena completa (playlist → variante → segmento)');
  say('');
  say('| ID | Resultado | Detalle |');
  say('|---|---|---|');
  for (const id of [1455, 500, 1500, 2000]) {
    const r = await fullChain(`${BASE}/live/${AUTH}/${id}.m3u8`, { 'User-Agent': GENERIC_UA }, `${BASE}/live/${AUTH}/${id}.ts`);
    say(`| ${id} | ${r.ok ? 'OK' : 'falla'} | ${r.detail} |`);
  }
  say('');

  // 3) Xtream player_api: ¿nombres y categorías?
  say('## 3. Xtream player_api (nombres, logos, categorías)');
  say('');
  const login = await get(`${BASE}/player_api.php?${qs}`, { 'User-Agent': GENERIC_UA }, null, 1_000_000);
  let loginOk = false;
  try {
    const j = JSON.parse(login.body);
    loginOk = Boolean(j && j.user_info && String(j.user_info.status).toLowerCase() === 'active');
    say(`login: HTTP ${login.status} · status ${j?.user_info?.status || '—'} · expira ${j?.user_info?.exp_date || '—'} · max conexiones ${j?.user_info?.max_connections || '—'}`);
  } catch {
    say(`login: HTTP ${login.status} · respuesta no-JSON (${login.body.length} B)${login.error ? ' · ' + login.error : ''}`);
  }
  if (loginOk) {
    const cats = await get(`${BASE}/player_api.php?${qs}&action=get_live_categories`, { 'User-Agent': GENERIC_UA }, null, 5_000_000);
    let catCount = 0;
    try { const c = JSON.parse(cats.body); catCount = Array.isArray(c) ? c.length : 0; } catch { /* abajo */ }
    say(`categorías en vivo: ${catCount}`);
    const streams = await get(`${BASE}/player_api.php?${qs}&action=get_live_streams`, { 'User-Agent': GENERIC_UA }, null, 60_000_000);
    try {
      const arr = JSON.parse(streams.body);
      say(`canales en vivo anunciados: ${Array.isArray(arr) ? arr.length : '?'}`);
      if (Array.isArray(arr) && arr.length) {
        const withLogo = arr.filter((c) => c.stream_icon).length;
        say(`con logo: ${withLogo} · muestra de nombres: ${arr.slice(0, 12).map((c) => c.name).join(' · ')}`);
        const byCat = {};
        for (const c of arr) byCat[c.category_id] = (byCat[c.category_id] || 0) + 1;
        say(`categorías con canales: ${Object.keys(byCat).length} · ids máx: ${Math.max(...arr.map((c) => +c.stream_id || 0))}`);
        try {
          const catArr = JSON.parse(cats.body);
          const catName = new Map(catCount ? catArr.map((c) => [String(c.category_id), c.category_name]) : []);
          const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 24)
            .map(([id, n]) => `${catName.get(id) || id}: ${n}`);
          say(`top categorías: ${top.join(' · ')}`);
        } catch { /* sin nombres de categoría */ }
      }
    } catch {
      say(`get_live_streams: HTTP ${streams.status} · no-JSON (${streams.body.length} B)`);
    }
  }
  say('');

  // 4) Enumeración de IDs
  say('## 4. Enumeración de IDs (/live/<cred>/<n>.m3u8)');
  say('');
  const sampleIds = [];
  for (let n = 1; n <= 50; n++) sampleIds.push(n);            // bloque bajo denso
  for (let n = 100; n <= 2000; n += 50) sampleIds.push(n);    // barrido grueso
  for (let n = 1440; n <= 1470; n++) sampleIds.push(n);       // alrededor del ejemplo
  const uniqueIds = [...new Set(sampleIds)];
  const enumResults = await mapLimit(uniqueIds, CONCURRENCY, async (n) => {
    const r = await get(`${BASE}/live/${AUTH}/${n}.m3u8`, { 'User-Agent': GENERIC_UA }, 'bytes=0-200');
    return { n, ok: (r.status === 200 || r.status === 206) && /#EXTM3U/.test(r.body), status: r.status };
  });
  const alive = enumResults.filter((r) => r.ok);
  say(`muestreados ${uniqueIds.length} ids · vivos: ${alive.length}`);
  say(`vivos: ${alive.map((r) => r.n).join(', ') || 'ninguno'}`);
  const byStatus = {};
  for (const r of enumResults) if (!r.ok) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  say(`no vivos por HTTP: ${Object.entries(byStatus).map(([k, v]) => `${k}×${v}`).join(' · ') || '—'}`);
  say('');

  say('## Conclusión automática');
  say('');
  const noUa = await get(EXAMPLE, {}, 'bytes=0-200');
  say(`- ¿Exige User-Agent? ${(noUa.status === 200 || noUa.status === 206) && /#EXTM3U/.test(noUa.body) ? 'NO (responde sin UA)' : 'SÍ o caído ahora mismo'}`);
  say(`- player_api usable: ${loginOk ? 'SÍ (nombres y logos disponibles)' : 'NO'}`);
 } catch (err) {
  say(`\nERROR de sonda: ${err && err.message}`);
 } finally {
  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/iptvgo-source.md', out.join('\n') + '\n');
  console.log('\n.probe/iptvgo-source.md');
 }
})();
