#!/usr/bin/env node
/**
 * Sexta sonda de deportes (24-11-2026): volcar el HTML crudo de
 * streamtp.site/channel/dsports.html y probar global2.php?stream=…, la
 * variante de «reproducción automática» que anuncia la portada.
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

function decodeGlobal(body) {
  const m = /var k=\[([\d,\s]+)\],\s*e='([^']+)'/.exec(body);
  if (!m) return null;
  const key = m[1].split(',').map((n) => String.fromCharCode(Number(n.trim()))).join('');
  const data = Buffer.from(m[2], 'base64');
  return Buffer.from(data.map((b, i) => b ^ key.charCodeAt(i % key.length))).toString('utf8');
}

(async () => {
  say('# Sonda 4: HTML crudo de canal activo en streamtp');
  say('');
  say(`Fecha: ${new Date().toISOString()}`);
  say('');

  // 1) channel/dsports.html crudo (completo, redactado)
  const ch = await get('https://streamtp.site/channel/dsports.html');
  say(`## channel/dsports.html — HTTP ${ch.status} · ${ch.body.length} B`);
  if (ch.status === 200) say(`\`\`\`html\n${redact(ch.body.slice(0, 6000))}\n\`\`\``);

  // 2) global2.php (reproducción automática)
  for (const slug of ['dsports', 'foxsports1usa', 'daznlaliga']) {
    const g2 = await get(`https://streamtp.site/global2.php?stream=${slug}`);
    say(`## global2 ${slug} — HTTP ${g2.status}${g2.error ? ` (${g2.error})` : ''} · ${g2.body.length} B`);
    if (g2.status !== 200) continue;
    const m3 = (g2.body.match(/https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/) || [])[0];
    const decoded = decodeGlobal(g2.body);
    if (m3) say(`- m3u8 directo: ${redact(m3)}`);
    if (decoded) {
      const urls = [...decoded.matchAll(/https?:\/\/[^\s"'<>\\]+/g)].map((u) => redact(u[0])).slice(0, 6);
      say(`- decodificado ${decoded.length} B: ${urls.join(' | ') || redact(decoded).slice(0, 200)}`);
    }
    if (!m3 && !decoded) say(`\`\`\`html\n${redact(g2.body.slice(0, 2500))}\n\`\`\``);
  }

  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/sports-chain.md', out.join('\n') + '\n');
  console.log('\n.probe/sports-chain.md');
})();
