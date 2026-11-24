#!/usr/bin/env node
/**
 * Sonda 8 de deportes (24-11-2026): capo8play.com/capo.php?live=<fid> — la
 * última capa del reproductor capo. Se prueban varios fid de canales y se
 * sigue cualquier m3u8/iframe/token. Salida redactada.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'es-MX,es;q=0.9' };
const TIMEOUT = 15_000;

const FIDS = ['capof1', 'espn', 'espn1', 'espn2', 'espn3', 'foxsports', 'foxsports1', 'dsports', 'dsports2', 'dazn', 'dazn1', 'tntsports', 'tycsports', 'tudn', 'winsports'];

const out = [];
const say = (line) => { out.push(line); console.log(line); };
const redact = (raw) => String(raw || '').replace(/[?&](?:token|auth|sig|expires|hash|key|s|e)=[^"'&\s)]+/gi, '$1…');

async function get(url, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { ...HEADERS, ...extraHeaders } });
    const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    return { status: res.status, url: res.url, body: (await res.text()).slice(0, 1_500_000), cookies, cf: res.headers.get('cf-mitigated') || '', ct: res.headers.get('content-type') || '' };
  } catch (err) {
    return { status: 0, url, body: '', error: err?.name || String(err).slice(0, 60), cookies: [], cf: '', ct: '' };
  } finally { clearTimeout(timer); }
}

(async () => {
  say('# Sonda 8: capo8play.com/capo.php?live=<fid>');
  say('');
  say(`Fecha: ${new Date().toISOString()}`);
  say('');

  for (const fid of FIDS) {
    const url = `https://capo8play.com/capo.php?player=desktop&live=${fid}`;
    const res = await get(url, { Referer: 'https://playcapo.st/' });
    say(`## ${fid} — HTTP ${res.status}${res.error ? ` (${res.error})` : ''} · ${res.body.length} B · cf=${res.cf || 'no'}`);
    if (res.status !== 200) continue;
    // atob() → rutas tipo /hls/stream.m3u8?ch=xxx
    const b64 = [...new Set([...res.body.matchAll(/atob\('([^']{8,200})'\)/gi)].map((m) => m[1]))];
    const hlsPaths = [];
    for (const b of b64) {
      let text = '';
      try { text = Buffer.from(b, 'base64').toString('utf8'); } catch { continue; }
      if (/m3u8|hls|\.php|http/.test(text)) { say(`- atob: ${redact(text)}`); if (/m3u8/.test(text)) hlsPaths.push(text); }
    }
    const m3u8 = [...new Set([...res.body.matchAll(/https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/gi)].map((m) => m[0]))];
    for (const u of m3u8.slice(0, 3)) say(`- m3u8: ${redact(u)}`);
    for (const p2 of hlsPaths.slice(0, 2)) {
      const abs = new URL(p2, res.url).href;
      const cookie = res.cookies.map((c) => c.split(';')[0]).join('; ');
      const man = await get(abs, { Referer: res.url, ...(cookie ? { Cookie: cookie } : {}) });
      const ok = man.status === 200 && /#EXTM3U/.test((man.body || '').slice(0, 400));
      say(`  → HLS ${ok ? 'VÁLIDO' : 'no'} (HTTP ${man.status}${man.error ? ` ${man.error}` : ''}) ${redact(abs)}`);
      if (ok) {
        const lines = (man.body || '').split('\n').map((l) => l.trim()).filter(Boolean);
        const v = lines.find((l) => !l.startsWith('#'));
        say(`    manifiesto: ${lines.slice(0, 5).map((l) => redact(l)).join(' ⏎ ')}`.slice(0, 300));
        if (v) {
          const vabs = new URL(v, man.url).href;
          const bare = await get(vabs, { Range: 'bytes=0-300' });
          say(`    variante sin cookie: HTTP ${bare.status} ${/#EXTM3U/.test((bare.body || '').slice(0, 300)) ? '· REPRODUCIBLE DIRECTA' : '· protegida'} ${redact(vabs)}`);
        }
      }
    }
    const iframes = [...new Set([...res.body.matchAll(/<iframe[^>]+src\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]))];
    for (const u of iframes.slice(0, 3)) say(`- iframe: ${redact(u)}`);
    const fetches = [...new Set([...res.body.matchAll(/(?:fetch|\.ajax|getJSON|load)\(\s*[`'"]([^`'"]{6,180})[`'"]/gi)].map((m) => m[1]))];
    for (const u of fetches.slice(0, 4)) say(`- fetch: ${redact(u)}`);
    // Fragmentos con pistas (solo para capof1, para no inundar)
    if (fid === 'capof1') {
      const inline = [...res.body.matchAll(/<script(?![^>]+src)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].trim()).filter((t) => t.length > 30);
      for (const script of inline.slice(0, 4)) say(`\`\`\`\n${redact(script).slice(0, 1000)}\n\`\`\``);
    }
    // Verificar el primer m3u8 con cookies del paso
    if (m3u8.length) {
      const cookie = res.cookies.map((c) => c.split(';')[0]).join('; ');
      const man = await get(m3u8[0], { Referer: res.url, ...(cookie ? { Cookie: cookie } : {}) });
      const ok = man.status === 200 && /#EXTM3U/.test((man.body || '').slice(0, 400));
      say(`  → HLS ${ok ? 'VÁLIDO' : 'no'} (HTTP ${man.status})`);
      if (ok) {
        const lines = (man.body || '').split('\n').map((l) => l.trim()).filter(Boolean);
        const v = lines.find((l) => !l.startsWith('#'));
        if (v) {
          const abs = new URL(v, man.url).href;
          const bare = await get(abs, { Range: 'bytes=0-300' });
          say(`  → variante sin cookie: HTTP ${bare.status} ${/#EXTM3U/.test((bare.body || '').slice(0, 300)) ? '· REPRODUCIBLE DIRECTA' : '· protegida'} ${redact(abs)}`);
        }
      }
    }
  }

  // ── Mapa fid: pirlotv.fyi/canales → iframe playcapo.st/update/<fid>.php ──
  say('## mapa pirlotv.fyi → fid');
  const hub = await get('https://pirlotv.fyi/canales/');
  say(`pirlotv.fyi/canales — HTTP ${hub.status} · ${hub.body.length} B`);
  if (hub.status === 200) {
    const chans = [...new Set([...hub.body.matchAll(/href=["']([^"']*\/canales\/[a-z0-9-]+\/?)["']/gi)].map((m) => m[1]))].slice(0, 30);
    say(`canales: ${chans.join(', ')}`);
    for (const c of chans.slice(0, 14)) {
      const page = await get(new URL(c, hub.url).href);
      const fid = /<script>fid="([^"]+)"/.exec(page.body)?.[1]
        || (page.body.match(/playcapo\.[a-z]+\/update\/([a-z0-9]+)\.php/i) || [])[1]
        || '';
      const ifr = (page.body.match(/<iframe[^>]+src\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
      say(`- ${c} → fid=${fid || '—'} iframe=${ifr ? redact(ifr) : '—'} (HTTP ${page.status})`);
    }
  }

  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/sports-players.md', out.join('\n') + '\n');
  console.log('\n.probe/sports-players.md');
})();
