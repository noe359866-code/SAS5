#!/usr/bin/env node
/**
 * Sonda 7 de deportes (24-11-2026): capo8play.com/capo.js (bootstrap del
 * reproductor capo), playcapo.st completo y el reproductor inyectado por JS
 * de tvlibrehd.com. Volcados completos redactados (archivos pequeños).
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
    return { status: res.status, url: res.url, body: (await res.text()).slice(0, 1_500_000), ct: res.headers.get('content-type') || '' };
  } catch (err) {
    return { status: 0, url, body: '', error: err?.name || String(err).slice(0, 60), ct: '' };
  } finally { clearTimeout(timer); }
}

(async () => {
 try {
  say('# Sonda 7: capo8play.js, playcapo.st completo y player de tvlibrehd');
  say('');
  say(`Fecha: ${new Date().toISOString()}`);
  say('');

  // ── 1) playcapo.st/update/capof1.php COMPLETO ────────────────────────────
  const capo = await get('https://playcapo.st/update/capof1.php', { Referer: 'https://pirlotv.fyi/' });
  say(`## playcapo.st/update/capof1.php — HTTP ${capo.status} · ${capo.body.length} B`);
  if (capo.status === 200) say(`\`\`\`html\n${redact(capo.body).slice(0, 3000)}\n\`\`\``);

  // ── 2) capo8play.com/capo.js COMPLETO ────────────────────────────────────
  const js = await get('https://capo8play.com/capo.js', { Referer: 'https://playcapo.st/' });
  say(`## capo8play.com/capo.js — HTTP ${js.status} · ${js.body.length} B · ${js.ct}`);
  if (js.status === 200) say(`\`\`\`js\n${redact(js.body).slice(0, 4000)}\n\`\`\``);

  // ── 3) tvlibrehd.com: ¿cómo se inyecta el reproductor? ───────────────────
  const tv = await get('https://www.tvlibrehd.com/en-vivo/espn/');
  say(`## tvlibrehd espn — HTTP ${tv.status} · ${tv.body.length} B`);
  if (tv.status === 200) {
    // Fragmentos alrededor de «player», «embed», «iframe», «canal»
    for (const m of [...tv.body.matchAll(/.{0,140}(?:id=["']player|class=["'][^"']*player|<embed|data-iframe|var canal|iframesrc|playerarea|videojs|jwplayer)[\s\S]{0,400}/gi)].slice(0, 6)) {
      say(`\`\`\`\n${redact(m[0]).slice(0, 700)}\n\`\`\``);
    }
    // El JS raro de la página
    const odd = await get('https://www.tvlibrehd.com/54c4624ecf_44.js', { Referer: tv.url });
    say(`## tvlibrehd 54c4624ecf_44.js — HTTP ${odd.status} · ${odd.body.length} B`);
    if (odd.status === 200) say(`\`\`\`js\n${redact(odd.body).slice(0, 2500)}\n\`\`\``);
  }

 } catch (err) {
   say(`\nERROR de sonda: ${err && err.message}`);
 } finally {
  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/sports-players.md', out.join('\n') + '\n');
  console.log('\n.probe/sports-players.md');
 }
})();
