#!/usr/bin/env node
/**
 * Tercera sonda de canales de deportes (24-11-2026): decodificar la
 * ofuscación de streamtp.site (atob + XOR con clave) y volcar el HTML crudo
 * del reproductor la14hd.com y del fetch() de futbollibretvapp.com.
 * Salida redactada: las URLs firmadas se truncan.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const TIMEOUT = 15_000;

const out = [];
const say = (line) => { out.push(line); console.log(line); };
const redact = (raw) => String(raw || '').replace(/[?&](?:token|auth|sig|key|expires|e|s|hash)=[^"'&\s)]+/gi, '$1…').slice(0, 220);

async function get(url, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { ...HEADERS, ...extraHeaders } });
    return { status: res.status, url: res.url, body: (await res.text()).slice(0, 1_500_000) };
  } catch (err) {
    return { status: 0, url, body: '', error: err?.name || String(err).slice(0, 40) };
  } finally { clearTimeout(timer); }
}

function tryDecodeStreamtp(html) {
  const results = [];
  // Patrón: var _k='3c8fa0813749f0a4';var _b=atob('....')
  const pairs = html.matchAll(/var _k='([0-9a-fA-F]+)';\s*var _b=atob\('([^']+)'\)/g);
  for (const m of pairs) {
    const key = Buffer.from(m[1], 'utf8');
    let data;
    try { data = Buffer.from(m[2], 'base64'); } catch { continue; }
    const variants = {
      xor: Buffer.from(data.map((b, i) => b ^ key[i % key.length])),
      plain: data,
    };
    for (const [how, buf] of Object.entries(variants)) {
      const text = buf.toString('utf8');
      if (/https?:|m3u8|file|source/.test(text)) {
        results.push({ how, key: m[1], text: redact(text) });
        break;
      }
    }
  }
  return results;
}

(async () => {
  say('# Sonda: decodificar reproductores de deportes');
  say('');
  say(`Fecha: ${new Date().toISOString()}`);
  say('');

  // ── 1) streamtp.site: ofuscación atob+XOR ────────────────────────────────
  for (const stream of ['dsports', 'tycsports', 'foxsports1usa', 'daznlaliga']) {
    const url = `https://streamtp.site/global1.php?stream=${stream}`;
    const res = await get(url);
    say(`## streamtp ${stream} — HTTP ${res.status}${res.error ? ` (${res.error})` : ''}`);
    if (res.status !== 200) continue;
    const decoded = tryDecodeStreamtp(res.body);
    if (!decoded.length) {
      say('sin pares _k/_b decodificables');
      const m = res.body.match(/<script>\(function\(\)\{[\s\S]{0,600}/);
      if (m) say(`\`\`\`\n${redact(m[0])}\n\`\`\``);
      continue;
    }
    for (const d of decoded) {
      say(`- decode=${d.how} key=${d.key}`);
      say(`\`\`\`\n${d.text}\n\`\`\``);
    }
  }

  // ── 2) pirlotvhd.com.co → iframe la14hd.com (HTML crudo) ─────────────────
  const pirlo = await get('https://pirlotvhd.com.co/es/tnt-sports4/');
  say(`## pirlotvhd tnt-sports4 — HTTP ${pirlo.status}`);
  if (pirlo.status === 200) {
    const ifr = [...pirlo.body.matchAll(/<iframe[^>]+src\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
    for (const src of ifr.slice(0, 2)) {
      say(`- iframe: ${redact(src)}`);
      const inner = await get(src, { Referer: pirlo.url });
      say(`  HTTP ${inner.status}${inner.error ? ` (${inner.error})` : ''} · ${inner.body.length} B`);
      if (inner.status === 200) {
        // Volcar scripts inline relevantes (mencionan http, token, canal, player)
        const inline = [...inner.body.matchAll(/<script(?![^>]+src)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
        for (const script of inline) {
          if (!/https?:|m3u8|atob|eval|token|canal|player|fetch\(/i.test(script)) continue;
          say(`\`\`\`\n${redact(script.trim()).slice(0, 900)}\n\`\`\``);
        }
        const srcs = [...inner.body.matchAll(/<script[^>]+src\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
        if (srcs.length) say(`scripts: ${srcs.slice(0, 8).map(redact).join(' , ')}`);
      }
    }
  }

  // ── 3) futbollibretvapp.com: fetch() del canal ───────────────────────────
  const fl = await get('https://futbollibretvapp.com/canales-en-vivo/espn1/');
  say(`## futbollibretvapp espn1 — HTTP ${fl.status}`);
  if (fl.status === 200) {
    const calls = [...fl.body.matchAll(/fetch\(\s*[`'"]([^`'"]{6,200})[`'"]([^)]{0,120})\)/gi)];
    for (const m of calls.slice(0, 4)) say(`- fetch: ${redact(m[1])} · args: ${redact(m[2])}`);
    const inline = [...fl.body.matchAll(/<script(?![^>]+src)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
    for (const script of inline) {
      if (!/fetch\(|m3u8|canal|stream|signal|api/i.test(script)) continue;
      say(`\`\`\`\n${redact(script.trim()).slice(0, 900)}\n\`\`\``);
    }
  }

  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/sports-decode.md', out.join('\n') + '\n');
  console.log('\n.probe/sports-decode.md');
})();
