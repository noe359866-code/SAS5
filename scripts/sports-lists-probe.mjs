#!/usr/bin/env node
/**
 * Sonda 11 de deportes (24-11-2026): listas públicas de iptv-org.
 * Se descargan la lista de deportes y las de países latinos, se filtran los
 * canales pedidos (ESPN, Fox Sports, DSports/DGO, DAZN, TNT, TyC, TUDN, Win…)
 * y se verifica cada URL: HTTP 200 + #EXTM3U sin cabeceras especiales.
 * No se imprimen credenciales; las URLs firmadas se redactan.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TIMEOUT = 12_000;

const LISTS = [
  'https://iptv-org.github.io/iptv/categories/sports.m3u',
  'https://iptv-org.github.io/iptv/countries/ar.m3u',
  'https://iptv-org.github.io/iptv/countries/mx.m3u',
  'https://iptv-org.github.io/iptv/countries/co.m3u',
  'https://iptv-org.github.io/iptv/countries/cl.m3u',
  'https://iptv-org.github.io/iptv/countries/pe.m3u',
  'https://iptv-org.github.io/iptv/countries/es.m3u',
];

const WANT = /espn|fox ?sport|dsports?|directv|dazn|tnt ?sport|tyc|tudn|win ?sport|bein|liga ?1|movistar|gol ?tv|gol ?peru|claro ?sport|depor(tv)?|fox deportes|espn deportes/i;

const out = [];
const say = (line) => { out.push(line); console.log(line); };
const redact = (raw) => {
  try {
    const url = new URL(String(raw));
    return `${url.hostname}${url.pathname.slice(0, 55)}${url.search ? `?(${url.search.length} B)` : ''}`;
  } catch { return String(raw || '').slice(0, 80); }
};

async function get(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': UA, ...headers } });
    return { status: res.status, url: res.url, body: (await res.text()).slice(0, 4_000_000) };
  } catch (err) {
    return { status: 0, url, body: '', error: `${err?.name || 'err'}:${err?.cause?.code || ''}` };
  } finally { clearTimeout(timer); }
}

function parseM3U(text, source) {
  const entries = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXTINF')) continue;
    const name = (line.split(',').pop() || '').trim();
    const logo = (/tvg-logo="([^"]+)"/.exec(line) || [])[1] || '';
    const group = (/group-title="([^"]+)"/.exec(line) || [])[1] || '';
    // la URL es la siguiente línea no-#
    let url = '';
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const l = lines[j].trim();
      if (!l) continue;
      if (l.startsWith('#')) continue;
      url = l;
      break;
    }
    if (name && url) entries.push({ name, logo, group, url, source });
  }
  return entries;
}

(async () => {
 try {
  say('# Sonda 11: canales de deportes en listas públicas (iptv-org)');
  say('');
  say(`Fecha: ${new Date().toISOString()}`);
  say('');

  const all = [];
  for (const list of LISTS) {
    const res = await get(list);
    say(`lista ${list.split('/').slice(-2).join('/')}: HTTP ${res.status} · ${res.body.length} B`);
    if (res.status === 200) all.push(...parseM3U(res.body, list.split('/').slice(-2).join('/')));
  }
  const wanted = all.filter((e) => WANT.test(e.name));
  say(`\ncanales que coinciden: ${wanted.length} de ${all.length} entradas`);
  say('');
  say('| Canal | Lista | Grupo | URL | Verificación |');
  say('|---|---|---|---|---|');

  const seen = new Set();
  let checked = 0;
  for (const e of wanted) {
    const key = `${e.name}→${e.url.split('?')[0]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (checked >= 40) { say(`| ${e.name} | ${e.source} | ${e.group} | ${redact(e.url)} | sin verificar (tope) |`); continue; }
    checked++;
    const t0 = Date.now();
    const res = await get(e.url, { Range: 'bytes=0-400' });
    const ms = Date.now() - t0;
    const head = (res.body || '').slice(0, 400);
    const ok = res.status === 200 && /#EXTM3U/.test(head);
    const variants = (head.match(/#EXT-X-STREAM-INF/g) || []).length;
    const state = ok ? `HLS VÁLIDO${variants ? ` ${variants}v` : ''} · ${ms} ms`
      : `HTTP ${res.status}${res.error ? ` ${res.error}` : ''} · ${redact(head.slice(0, 40)) || '—'}`;
    say(`| ${e.name} | ${e.source} | ${e.group || '—'} | ${redact(e.url)} | ${state} |`);
  }

 } catch (err) {
  say(`\nERROR de sonda: ${err && err.message}`);
 } finally {
  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/sports-lists.md', out.join('\n') + '\n');
  console.log('\n.probe/sports-lists.md');
 }
})();
