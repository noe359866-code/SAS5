#!/usr/bin/env node
/**
 * Séptima sonda de deportes (24-11-2026): cadena completa por canal activo de
 * streamtp.site: global2.php → hls.php → respuesta (JSON/redirect/manifiesto)
 * → verificación del HLS con su Referer. Salida redactada.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'es-MX,es;q=0.9' };
const TIMEOUT = 15_000;

const out = [];
const say = (line) => { out.push(line); console.log(line); };
const redact = (raw) => {
  try {
    const url = new URL(String(raw));
    return `${url.hostname}${url.pathname.slice(0, 60)}${url.search ? `?(${url.search.length} B)` : ''}`;
  } catch { return String(raw || '').slice(0, 100); }
};

async function get(url, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { ...HEADERS, ...extraHeaders } });
    const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    return { status: res.status, url: res.url, body: (await res.text()).slice(0, 800_000), contentType: res.headers.get('content-type') || '', cookies, cf: res.headers.get('cf-mitigated') || '' };
  } catch (err) {
    return { status: 0, url, body: '', error: err?.name || String(err).slice(0, 40), contentType: '' };
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
 try {
  say('# Sonda 5: hls.php de streamtp, canal por canal');
  say('');
  say(`Fecha: ${new Date().toISOString()}`);
  say('');

  const home = await get('https://streamtp.site/');
  const active = [...new Set([...home.body.matchAll(/channel\/([a-z0-9]+)\.html/gi)].map((m) => m[1]))];
  say(`canales activos: ${active.join(', ')}`);
  say('');
  say('| Canal | hls.php | Tipo | Contenido | m3u8 | HLS | ms |');
  say('|---|---|---|---|---|---|---|');
  let m3col = '—';

  for (const slug of active) {
    const g = await get(`https://streamtp.site/global2.php?stream=${slug}`);
    if (g.status !== 200) { say(`| ${slug} | ${g.status} | — | — | — | global2 falló | — |`); continue; }
    const decoded = decodeGlobal(g.body) || '';
    const hlsPhp = (decoded.match(/https?:\/\/[^\s"'<>\\]+hls\.php[^\s"'<>\\]*/) || [])[0];
    if (!hlsPhp) { say(`| ${slug} | — | — | ${redact(decoded).slice(0, 60)} | — | sin hls.php | — |`); continue; }
    if (slug === 'dsports') {
      say(`\nConfig decodificado de dsports (redactado):\n\`\`\`\n${redact(decoded)}\n\`\`\`\n`);
      say(`Cookies de global2: ${g.cookies.join(' ; ') || 'ninguna'} · cf-mitigated: ${g.cf || 'no'}\n`);
    }
    const t0 = Date.now();
    const cookie = g.cookies.map((c) => c.split(';')[0]).join('; ');
    const h = await get(hlsPhp, { Referer: g.url, ...(cookie ? { Cookie: cookie } : {}) });
    if (slug === 'dsports') say(`hls.php con cookie → HTTP ${h.status} · cf: ${h.cf || 'no'} · ${redact((h.body || '').slice(0, 200))}\n`);
    const ms = Date.now() - t0;
    const head = (h.body || '').slice(0, 200);
    // ¿Qué devolvió hls.php?
    const urlIn = (h.body.match(/https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/) || [])[0]
      || (/#EXTM3U/.test(head) ? h.url : null);
    let estado;
    m3col = '—';
    if (urlIn) {
      m3col = redact(urlIn);
      const man = /#EXTM3U/.test(head) ? h : await get(urlIn, { Referer: h.url });
      const ok = man.status === 200 && /#EXTM3U/.test((man.body || '').slice(0, 400));
      const variants = ((man.body || '').match(/#EXT-X-STREAM-INF/g) || []).length;
      estado = ok ? `VÁLIDO${variants ? ` ${variants}v` : ''}` : `HTTP ${man.status} no-HLS`;
    } else {
      estado = redact(head) || h.error || `HTTP ${h.status}`;
    }
    say(`| ${slug} | ${h.status} | ${h.contentType.split(';')[0] || '—'} | ${estado} | ${m3col} | ${urlIn ? 'verificado' : '—'} | ${ms} |`);
  }

 } catch (err) {
   say(`\nERROR de sonda: ${err && err.message}`);
 } finally {
  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/sports-chain.md', out.join('\n') + '\n');
  console.log('\n.probe/sports-chain.md');
 }
})();
