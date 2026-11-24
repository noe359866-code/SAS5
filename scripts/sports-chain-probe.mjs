#!/usr/bin/env node
/**
 * Quinta sonda de deportes (24-11-2026): verificar la cadena completa de
 * streamtp.site (global1.php → hls.php → m3u8 real) en TODOS los canales que
 * anuncia su portada, y medir la latencia. Salida redactada.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const TIMEOUT = 15_000;

const out = [];
const say = (line) => { out.push(line); console.log(line); };
const redact = (raw) => {
  try {
    const url = new URL(String(raw));
    return `${url.hostname}${url.pathname.slice(0, 60)}${url.search ? `?(${url.search.length} B)` : ''}`;
  } catch { return String(raw || '').slice(0, 90); }
};

async function get(url, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { ...HEADERS, ...extraHeaders } });
    return { status: res.status, url: res.url, body: (await res.text()).slice(0, 800_000), contentType: res.headers.get('content-type') };
  } catch (err) {
    return { status: 0, url, body: '', error: err?.name || String(err).slice(0, 40) };
  } finally { clearTimeout(timer); }
}

/** Decodifica `var k=[charcodes], e='base64'` de global1.php → texto plano. */
function decodeGlobal(body) {
  const m = /var k=\[([\d,\s]+)\],\s*e='([^']+)'/.exec(body);
  if (!m) return null;
  const key = m[1].split(',').map((n) => String.fromCharCode(Number(n.trim()))).join('');
  const data = Buffer.from(m[2], 'base64');
  return Buffer.from(data.map((b, i) => b ^ key.charCodeAt(i % key.length))).toString('utf8');
}

(async () => {
  say('# Sonda 3: cadena completa de streamtp.site');
  say('');
  say(`Fecha: ${new Date().toISOString()}`);
  say('');

  // 1) Portada → todos los slugs de canal anunciados
  const home = await get('https://streamtp.site/');
  say(`## portada — HTTP ${home.status}`);
  if (home.status !== 200) process.exit(0);
  const slugs = [...home.body.matchAll(/global1\.php\?stream=([a-z0-9]+)/gi)].map((m) => m[1]);
  const active = new Set([...home.body.matchAll(/channel\/([a-z0-9]+)\.html/gi)].map((m) => m[1]));
  say(`slugs: ${[...new Set(slugs)].join(', ')}`);
  say(`activos (channel/*.html): ${[...active].join(', ')}`);
  say('');

  // 2) Para cada slug: global1.php → hls.php → m3u8 → validar manifiesto
  say('| Canal | Activo | hls.php | URL final | Manifiesto | Estado |');
  say('|---|---|---|---|---|---|');
  for (const slug of [...new Set(slugs)]) {
    const g = await get(`https://streamtp.site/global1.php?stream=${slug}`);
    if (g.status !== 200) { say(`| ${slug} | ${active.has(slug) ? 'sí' : 'no'} | ${g.status} | — | — | global1 falló |`); continue; }
    const decoded = decodeGlobal(g.body);
    if (!decoded) { say(`| ${slug} | ${active.has(slug) ? 'sí' : 'no'} | — | — | — | sin patrón k/e |`); continue; }
    const hlsPhp = (decoded.match(/https?:\/\/[^\s"'<>\\]+hls\.php[^\s"'<>\\]*/) || [])[0];
    if (!hlsPhp) { say(`| ${slug} | ${active.has(slug) ? 'sí' : 'no'} | — | — | — | sin hls.php |`); continue; }
    const t0 = Date.now();
    const h = await get(hlsPhp, { Referer: g.url });
    const ms = Date.now() - t0;
    // hls.php puede devolver el manifiesto, una URL JSON o un redirect
    const bodyHead = (h.body || '').slice(0, 300);
    const m3u8Url = (bodyHead.match(/https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/) || [])[0]
      || (/#EXTM3U/.test(bodyHead) ? h.url : null)
      || (h.url !== hlsPhp && /\.m3u8/.test(h.url) ? h.url : null);
    let finalState = 'sin m3u8';
    let finalUrl = '—';
    if (m3u8Url) {
      const man = /#EXTM3U/.test(bodyHead) ? { status: h.status, body: h.body } : await get(m3u8Url, { Referer: h.url, Range: 'bytes=0-400' });
      const ok = man.status === 200 && /#EXTM3U/.test((man.body || '').slice(0, 400));
      const variants = ((man.body || '').match(/#EXT-X-STREAM-INF/g) || []).length;
      finalState = ok ? `HLS VÁLIDO${variants ? ` (${variants} variantes)` : ''} (${ms} ms)` : `HTTP ${man.status} no-HLS (${ms} ms)`;
      finalUrl = redact(m3u8Url);
    } else {
      finalState = `hls.php: ${h.status} · ${redact(bodyHead) || h.error || 'vacío'}`.slice(0, 90);
    }
    say(`| ${slug} | ${active.has(slug) ? 'sí' : 'no'} | ${h.status} | ${finalUrl} | ${redact(hlsPhp).split('/').pop()} | ${finalState} |`);
  }

  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/sports-chain.md', out.join('\n') + '\n');
  console.log('\n.probe/sports-chain.md');
})();
