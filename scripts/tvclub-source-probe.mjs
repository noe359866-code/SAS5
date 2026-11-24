#!/usr/bin/env node
/**
 * Sonda 13 (24-11-2026): la fuente m3u.tvcluboficial.com a fondo.
 *
 * Es el host principal de la lista Magma TV (183 señales verificadas en la
 * sonda 12). Aquí se mide:
 *  1. Requisitos de acceso: mismo canal con el UA que declara la lista, con un
 *     UA de navegador genérico y sin UA; cabeceras CORS y content-type.
 *  2. Cadena completa de reproducción: playlist maestra → variante → primer
 *     segmento (HTTP 200 y bytes de vídeo/TS o fMP4).
 *  3. Enumerabilidad: los IDs son /free/ReachBot/Kip/<n>.m3u8; se muestrea el
 *     rango 1..1200 para ver si hay canales vivos que la lista Magma no anuncia
 *     (los anónimos no entran al catálogo: sin nombre ni idioma no pasan la
 *     barra de calidad, pero conviene saber si la fuente es enumerable).
 *  4. Lo mismo, en pequeño, para el segundo host de la lista: tv.m3uts.xyz.
 *
 * No se imprimen credenciales; las URLs se redactan.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');

const GENERIC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MAGMA_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36';
const TIMEOUT = 10_000;
const CONCURRENCY = 10;

const out = [];
const say = (line) => { out.push(line); console.log(line); };
const redact = (raw) => {
  try {
    const url = new URL(String(raw));
    return `${url.hostname}${url.pathname.slice(0, 48)}${url.search ? `?(${url.search.length} B)` : ''}`;
  } catch { return String(raw || '').slice(0, 70); }
};

async function get(url, headers = {}, range = 'bytes=0-2048') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const h = { ...headers };
    if (range) h.Range = range;
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: h });
    const body = (await res.text()).slice(0, 64_000);
    return {
      status: res.status,
      body,
      contentType: res.headers.get('content-type') || '',
      cors: res.headers.get('access-control-allow-origin') || '',
      server: res.headers.get('server') || '',
    };
  } catch (err) {
    return { status: 0, body: '', error: `${err?.name || 'err'}:${err?.cause?.code || ''}` };
  } finally { clearTimeout(timer); }
}

/** playlist → primera variante → primer segmento. Devuelve diagnóstico. */
async function fullChain(url, ua) {
  const headers = ua ? { 'User-Agent': ua } : {};
  const master = await get(url, headers, 'bytes=0-3000');
  if (master.status !== 200 || !/#EXTM3U/.test(master.body)) {
    return { ok: false, detail: `maestra HTTP ${master.status}${master.error ? ' ' + master.error : ''}` };
  }
  // ¿Maestra con variantes o playlist de medios directa?
  const variantLine = master.body.split('\n').find((l) => l.trim().endsWith('.m3u8') || /#EXT-X-STREAM-INF/.test(l));
  let mediaUrl = url;
  let body = master.body;
  if (/#EXT-X-STREAM-INF/.test(master.body)) {
    const lines = master.body.split('\n');
    const idx = lines.findIndex((l) => /#EXT-X-STREAM-INF/.test(l));
    const rel = (lines[idx + 1] || '').trim();
    if (!rel) return { ok: false, detail: 'maestra sin variante legible' };
    mediaUrl = new URL(rel, url).toString();
    const media = await get(mediaUrl, headers, 'bytes=0-3000');
    if (media.status !== 200 || !/#EXTM3U/.test(media.body)) {
      return { ok: false, detail: `variante HTTP ${media.status}` };
    }
    body = media.body;
  }
  const segLine = body.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
  if (!segLine) return { ok: false, detail: `playlist sin segmentos${variantLine ? ' (con variantes)' : ''}` };
  const segUrl = new URL(segLine, mediaUrl).toString();
  const seg = await get(segUrl, headers, 'bytes=0-188');
  const head = seg.body || '';
  const looksTs = head.charCodeAt(0) === 0x47; // sync byte MPEG-TS
  const looksFmp4 = head.slice(4, 8) === 'ftyp' || head.slice(0, 8).includes('ftyp');
  const ok = seg.status === 200 || seg.status === 206;
  return {
    ok: ok && (looksTs || looksFmp4 || head.length > 0),
    detail: `segmento HTTP ${seg.status} · ${looksTs ? 'MPEG-TS' : looksFmp4 ? 'fMP4' : `${head.length} B`}`,
  };
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
  say('# Sonda 13: m3u.tvcluboficial.com a fondo');
  say('');
  say(`Fecha: ${new Date().toISOString()}`);
  say('');

  // 1) Requisitos de acceso sobre el ejemplo del usuario (id 293 = Distrito Comedia)
  const EXAMPLE = 'http://m3u.tvcluboficial.com/free/ReachBot/Kip/293.m3u8';
  say(`## 1. Acceso al canal de ejemplo (id 293)`);
  say('');
  say('| Intento | HTTP | Content-Type | CORS | ¿#EXTM3U? |');
  say('|---|---|---|---|---|');
  for (const [label, headers] of [
    ['UA de la lista (Android)', { 'User-Agent': MAGMA_UA }],
    ['UA navegador genérico', { 'User-Agent': GENERIC_UA }],
    ['Sin User-Agent', {}],
    ['Con Referer al host', { 'User-Agent': MAGMA_UA, Referer: 'http://m3u.tvcluboficial.com/' }],
  ]) {
    const r = await get(EXAMPLE, headers, 'bytes=0-400');
    say(`| ${label} | ${r.status}${r.error ? ' ' + r.error : ''} | ${r.contentType || '—'} | ${r.cors || '—'} | ${/#EXTM3U/.test(r.body) ? 'sí' : 'no'} |`);
  }
  say('');

  // 2) Cadena completa en una muestra de canales conocidos del host
  say('## 2. Cadena completa (playlist → variante → segmento)');
  say('');
  say('| Canal (id) | Maestra | Variante/segmento |');
  say('|---|---|---|');
  for (const id of [293, 344, 635, 155, 118, 45, 588]) {
    const url = `http://m3u.tvcluboficial.com/free/ReachBot/Kip/${id}.m3u8`;
    const r = await fullChain(url, MAGMA_UA);
    say(`| id ${id} | ${r.ok ? 'OK' : 'falla'} | ${r.detail} |`);
  }
  say('');

  // 3) Enumerabilidad del rango de IDs
  say('## 3. Enumeración de IDs (/free/ReachBot/Kip/<n>.m3u8)');
  say('');
  const sampleIds = [];
  for (let n = 1; n <= 40; n++) sampleIds.push(n);                 // bloque bajo
  for (let n = 100; n <= 1220; n += 40) sampleIds.push(n);         // barrido grueso
  for (let n = 1100; n <= 1180; n += 5) sampleIds.push(n);         // bloque alto (la lista usa hasta 1173)
  const uniqueIds = [...new Set(sampleIds)];
  const enumResults = await mapLimit(uniqueIds, CONCURRENCY, async (n) => {
    const r = await get(`http://m3u.tvcluboficial.com/free/ReachBot/Kip/${n}.m3u8`, { 'User-Agent': MAGMA_UA }, 'bytes=0-200');
    return { n, ok: r.status === 200 && /#EXTM3U/.test(r.body), status: r.status };
  });
  const alive = enumResults.filter((r) => r.ok);
  say(`muestreados ${uniqueIds.length} ids · vivos: ${alive.length}`);
  say(`vivos: ${alive.map((r) => r.n).join(', ') || 'ninguno'}`);
  say('');

  // 4) Segundo host: tv.m3uts.xyz (ruta distinta: /stream/secure/<token>/<id>.m3u8)
  say('## 4. Segundo host de la lista: tv.m3uts.xyz');
  say('');
  say('| Canal | Con UA lista | Sin UA |');
  say('|---|---|---|');
  const uts = ['http://tv.m3uts.xyz/stream/secure/DBHmCasm/1171.m3u8'];
  for (const url of uts) {
    const withUa = await get(url, { 'User-Agent': MAGMA_UA }, 'bytes=0-200');
    const noUa = await get(url, {}, 'bytes=0-200');
    say(`| ${redact(url)} | ${withUa.status}${/#EXTM3U/.test(withUa.body) ? ' HLS' : ''} | ${noUa.status}${/#EXTM3U/.test(noUa.body) ? ' HLS' : ''} |`);
  }
  say('');

  say('## Conclusión automática');
  say('');
  const example = await get(EXAMPLE, {}, 'bytes=0-200');
  say(`- ¿Exige User-Agent propio? ${example.status === 200 && /#EXTM3U/.test(example.body) ? 'NO (responde sin UA)' : 'SÍ o está caído ahora mismo'}`);
 } catch (err) {
  say(`\nERROR de sonda: ${err && err.message}`);
 } finally {
  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/tvclub-source.md', out.join('\n') + '\n');
  console.log('\n.probe/tvclub-source.md');
 }
})();
