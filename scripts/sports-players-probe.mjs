#!/usr/bin/env node
/**
 * Sonda 10 de deportes (24-11-2026):
 *  1. capo.php: buscar wss:// y probar ch= derivados del fid.
 *  2. thetvapp.to: portada, página de canal y API.
 *  3. Dominio actual de DaddyLive y sus canales 24/7.
 * Salida redactada.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'es-MX,es;q=0.9' };
const TIMEOUT = 15_000;

const out = [];
const say = (line) => { out.push(line); console.log(line); };
const redact = (raw) => String(raw || '').replace(/[?&](?:token|auth|sig|expires|hash|key)=[^"'&\s)]+/gi, '$1…');

async function get(url, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { ...HEADERS, ...extraHeaders } });
    const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    return { status: res.status, url: res.url, body: (await res.text()).slice(0, 1_500_000), cookies };
  } catch (err) {
    return { status: 0, url, body: '', error: `${err?.name || 'err'}:${err?.cause?.code || ''}` || String(err).slice(0, 60), cookies: [] };
  } finally { clearTimeout(timer); }
}

(async () => {
 try {
  say('# Sonda 10: wss de capo, thetvapp y daddylive');
  say('');
  say(`Fecha: ${new Date().toISOString()}`);
  say('');

  // ── 1) capo.php: wss y ch= por fid ──────────────────────────────────────
  const capo = await get('https://capo8play.com/capo.php?player=desktop&live=capoespn', { Referer: 'https://playcapo.st/update/capoespn.php' });
  say(`## capoespn — HTTP ${capo.status} · ${capo.body.length} B`);
  if (capo.status === 200) {
    const wss = [...new Set([...capo.body.matchAll(/wss?:\/\/[^\s"'<>\\]+/gi)].map((m) => m[0]))];
    for (const w of wss.slice(0, 5)) say(`- wss: ${redact(w)}`);
    const sock = [...new Set([...capo.body.matchAll(/(?:WebSocket|io\(|socket|ws[_-]?url|server[_-]?url)[^\n]{0,140}/gi)].map((m) => m[0]))];
    for (const w of sock.slice(0, 8)) say(`- sock: ${redact(w)}`);
  }
  for (const ch of ['capoespn', 'espn1', 'espnhd', 'espnla', 'espnlatin']) {
    const m3 = `https://capo8play.com/hls/stream.m3u8?ch=${ch}`;
    const man = await get(m3, { Referer: 'https://capo8play.com/capo.php?player=desktop&live=capoespn' });
    const ok = man.status === 200 && /#EXTM3U/.test((man.body || '').slice(0, 400));
    say(`- ch=${ch}: HTTP ${man.status} ${ok ? 'HLS VÁLIDO' : redact((man.body || '').slice(0, 60)) || man.error || ''}`);
  }

  // ── 2) thetvapp.to ───────────────────────────────────────────────────────
  for (const host of ['https://thetvapp.to', 'https://thetvapp.link', 'https://thetvapp.to/tv']) {
    const res = await get(host);
    say(`## ${host} — HTTP ${res.status}${res.error ? ` (${res.error})` : ''} · ${res.body.length} B`);
    if (res.status !== 200) continue;
    const links = [...new Set([...res.body.matchAll(/href=["']([^"']*(?:channel|tv|watch|live)[^"']*)["']/gi)].map((m) => m[1]))].slice(0, 10);
    if (links.length) say(`- enlaces: ${links.map(redact).join(' | ')}`);
    const m3u8 = [...new Set([...res.body.matchAll(/https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/gi)].map((m) => m[0]))];
    for (const u of m3u8.slice(0, 3)) say(`- m3u8: ${redact(u)}`);
    break;
  }

  // ── 3) DaddyLive: dominio actual ─────────────────────────────────────────
  const DL_HOSTS = ['https://daddylive.dad', 'https://daddylivehd.com', 'https://dlhd.dad', 'https://daddyhd.com', 'https://daddylive.sx'];
  for (const host of DL_HOSTS) {
    const res = await get(`${host}/24-7-channels.php`);
    say(`## ${host}/24-7-channels.php — HTTP ${res.status}${res.error ? ` (${res.error})` : ''} · ${res.body.length} B`);
    if (res.status !== 200) continue;
    const chans = [...new Set([...res.body.matchAll(/href=["']([^"']*stream[^"']*)["'][^>]*>([^<]{2,60})/gi)].map((m) => `${m[2].trim()} → ${m[1]}`))].slice(0, 14);
    for (const c of chans) say(`- ${redact(c)}`);
    // seguir un canal
    const first = (res.body.match(/href=["']([^"']*stream\/stream-\d+\.php)["']/i) || [])[1];
    if (first) {
      const page = await get(new URL(first, res.url).href);
      const ifr = (page.body.match(/<iframe[^>]+src\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
      say(`  canal: ${redact(first)} → iframe ${redact(ifr)} (HTTP ${page.status})`);
      if (ifr) {
        const inner = await get(new URL(ifr, page.url).href, { Referer: page.url });
        const m3 = (inner.body.match(/https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/i) || [])[0];
        const fetchLike = [...new Set([...inner.body.matchAll(/(?:fetch|XMLHttpRequest|\.get|channelKey|streamUrl)[^\n]{0,120}/gi)].map((m) => m[0]))].slice(0, 6);
        say(`  iframe HTTP ${inner.status}${inner.error ? ` (${inner.error})` : ''} · m3u8=${m3 ? redact(m3) : 'no'}`);
        for (const f of fetchLike) say(`  · ${redact(f)}`);
      }
    }
    break;
  }

 } catch (err) {
  say(`\nERROR de sonda: ${err && err.message}`);
 } finally {
  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/sports-players.md', out.join('\n') + '\n');
  console.log('\n.probe/sports-players.md');
 }
})();
