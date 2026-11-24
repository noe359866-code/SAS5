#!/usr/bin/env node
/**
 * Sonda 6 de deportes (24-11-2026): reproductores «capo» (capoplay.icu /
 * playcapo.st) y el canal de tvlibrehd.com. Se vuelcan los scripts inline que
 * resuelven la señal y se busca el m3u8 final. Salida redactada.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const TIMEOUT = 15_000;

const out = [];
const say = (line) => { out.push(line); console.log(line); };
const redact = (raw) => String(raw || '').replace(/[?&](?:token|auth|sig|expires|hash|key)=[^"'&\s)]+/gi, '$1…').slice(0, 300);

async function get(url, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { ...HEADERS, ...extraHeaders } });
    const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    return { status: res.status, url: res.url, body: (await res.text()).slice(0, 1_500_000), cookies, cf: res.headers.get('cf-mitigated') || '' };
  } catch (err) {
    return { status: 0, url, body: '', error: err?.name || String(err).slice(0, 60), cookies: [], cf: '' };
  } finally { clearTimeout(timer); }
}

function dumpPlayer(label, res) {
  say(`### ${label} — HTTP ${res.status}${res.error ? ` (${res.error})` : ''} · ${res.body.length} B · cf=${res.cf || 'no'}`);
  if (res.status !== 200) return [];
  const m3u8 = [...res.body.matchAll(/https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/gi)].map((m) => m[0]);
  for (const u of [...new Set(m3u8)].slice(0, 4)) say(`- m3u8: ${redact(u)}`);
  const iframes = [...res.body.matchAll(/<iframe[^>]+src\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  for (const u of [...new Set(iframes)].slice(0, 4)) say(`- iframe: ${redact(u)}`);
  const srcs = [...res.body.matchAll(/<script[^>]+src\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  if (srcs.length) say(`- scripts: ${[...new Set(srcs)].slice(0, 6).map(redact).join(' , ')}`);
  const inline = [...res.body.matchAll(/<script(?![^>]+src)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].trim()).filter((t) => t.length > 40);
  for (const script of inline) {
    if (!/https?:|m3u8|atob|eval|token|fetch\(|\.php|source|file|p2p|hls/i.test(script)) continue;
    say(`\`\`\`\n${redact(script).slice(0, 1200)}\n\`\`\``);
  }
  return [...new Set(m3u8)];
}

async function verifyHls(url, referer, cookies = []) {
  const cookie = cookies.map((c) => c.split(';')[0]).join('; ');
  const res = await get(url, { ...(referer ? { Referer: referer } : {}), ...(cookie ? { Cookie: cookie } : {}) });
  const ok = res.status === 200 && /#EXTM3U/.test((res.body || '').slice(0, 400));
  say(`  → HLS ${ok ? 'VÁLIDO' : 'no'} (HTTP ${res.status}${res.error ? ` ${res.error}` : ''}) ${redact(url)}`);
  // Variante sin cookie ni referer (¿reproducible en Stremio?)
  if (ok) {
    const lines = (res.body || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const v = lines.find((l) => !l.startsWith('#'));
    if (v) {
      const abs = new URL(v, res.url).href;
      const bare = await get(abs, { Range: 'bytes=0-300' });
      const okBare = bare.status === 200 && /#EXTM3U|^.{0,4}#/.test((bare.body || '').slice(0, 300));
      say(`  → variante sin cookie: HTTP ${bare.status} ${/#EXTM3U/.test((bare.body || '').slice(0, 300)) ? '· REPRODUCIBLE DIRECTA' : '· protegida'} ${redact(abs)}`);
    }
  }
}

(async () => {
  say('# Sonda 6: reproductores capo y tvlibrehd');
  say('');
  say(`Fecha: ${new Date().toISOString()}`);
  say('');

  // ── capoplay.icu (iframes de futboltv.mx) ───────────────────────────────
  for (const ch of ['foxsp2', 'canal5m', 'espn', 'espn2', 'dsports', 'dazn']) {
    const url = `https://capoplay.icu/player/${ch}.php`;
    const res = await get(url, { Referer: 'https://www.futboltv.mx/' });
    const found = dumpPlayer(`capoplay.icu ${ch}`, res);
    for (const u of found.slice(0, 1)) await verifyHls(u, res.url, res.cookies);
  }

  // ── playcapo.st (iframe de pirlotv.fyi) ──────────────────────────────────
  for (const path of ['update/capof1.php', 'update/espn.php', 'update/dsports.php']) {
    const url = `https://playcapo.st/${path}`;
    const res = await get(url, { Referer: 'https://pirlotv.fyi/' });
    const found = dumpPlayer(`playcapo.st ${path}`, res);
    for (const u of found.slice(0, 1)) await verifyHls(u, res.url, res.cookies);
  }

  // ── tvlibrehd.com: canal espn crudo ─────────────────────────────────────
  for (const slug of ['espn', 'espn-2', 'fox-sports', 'dsports']) {
    const res = await get(`https://www.tvlibrehd.com/en-vivo/${slug}/`);
    const found = dumpPlayer(`tvlibrehd ${slug}`, res);
    for (const u of found.slice(0, 1)) await verifyHls(u, res.url, res.cookies);
  }

  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/sports-players.md', out.join('\n') + '\n');
  console.log('\n.probe/sports-players.md');
})();
