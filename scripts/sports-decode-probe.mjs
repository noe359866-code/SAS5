#!/usr/bin/env node
/**
 * Cuarta sonda de deportes (24-11-2026):
 *  1. streamtp.site: decodificar `k=[char codes]` + `e=base64` (XOR) → URL.
 *  2. la14hd.com/vivo/canal.php: volcar el cuerpo completo (925 B).
 * Salida redactada.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const TIMEOUT = 15_000;

const out = [];
const say = (line) => { out.push(line); console.log(line); };
const redact = (raw) => String(raw || '').replace(/[?&](?:token|auth|sig|expires|hash)=[^"'&\s)]+/gi, '$1…').slice(0, 400);

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

(async () => {
  say('# Sonda 2: decodificar streamtp y volcar la14hd');
  say('');
  say(`Fecha: ${new Date().toISOString()}`);
  say('');

  // ── 1) streamtp.site: k=[…] (char codes) + e=base64, XOR ────────────────
  for (const stream of ['dsports', 'tycsports', 'foxsports1usa', 'daznlaliga', 'dsports2', 'dsportsplus']) {
    const url = `https://streamtp.site/global1.php?stream=${stream}`;
    const res = await get(url);
    say(`## streamtp ${stream} — HTTP ${res.status}${res.error ? ` (${res.error})` : ''}`);
    if (res.status !== 200) continue;
    const m = /var k=\[([\d,\s]+)\],\s*e='([^']+)'/.exec(res.body);
    if (!m) { say('sin patrón k/e'); continue; }
    const key = m[1].split(',').map((n) => String.fromCharCode(Number(n.trim()))).join('');
    let data;
    try { data = Buffer.from(m[2], 'base64'); } catch { say('base64 inválido'); continue; }
    const decoded = Buffer.from(data.map((b, i) => b ^ key.charCodeAt(i % key.length))).toString('utf8');
    say(`- clave: ${key} · decodificado ${decoded.length} B`);
    const urls = [...decoded.matchAll(/https?:\/\/[^\s"'<>\\]+/g)].map((u) => redact(u[0])).slice(0, 6);
    for (const u of urls) say(`  url: ${u}`);
    if (!urls.length) say(`\`\`\`\n${redact(decoded)}\n\`\`\``);
    // Si hay m3u8, verificarlo
    const m3 = urls.find((u) => u.includes('.m3u8'));
    if (m3) {
      // URL real sin redactar para la verificación
      const real = [...decoded.matchAll(/https?:\/\/[^\s"'<>\\]+/g)].map((u) => u[0]).find((u) => u.includes('.m3u8'));
      const check = await get(real, { Referer: res.url, Range: 'bytes=0-400' });
      const ok = checkHls(checkHlsBody(check));
      say(`  hls: HTTP ${check.status} · ${ok ? 'HLS VÁLIDO' : redact((check.body || '').slice(0, 80)) || check.error || ''}`);
      function checkHlsBody(r) { return (r.body || '').slice(0, 400); }
      function checkHls(head) { return check.status === 200 && /#EXTM3U/.test(head); }
    }
  }

  // ── 2) la14hd.com/vivo/canal.php — cuerpo completo ──────────────────────
  for (const stream of ['tntsports', 'espn', 'dsports', 'foxsports']) {
    const url = `https://la14hd.com/vivo/canal.php?stream=${stream}`;
    const res = await get(url, { Referer: 'https://pirlotvhd.com.co/' });
    say(`## la14hd ${stream} — HTTP ${res.status}${res.error ? ` (${res.error})` : ''} · ${res.body.length} B`);
    if (res.status === 200) say(`\`\`\`\n${redact(res.body.slice(0, 2000))}\n\`\`\``);
  }

  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/sports-decode.md', out.join('\n') + '\n');
  console.log('\n.probe/sports-decode.md');
})();
