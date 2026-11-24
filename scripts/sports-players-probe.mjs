#!/usr/bin/env node
/**
 * Sonda 9 de deportes (24-11-2026): capo.php?live=capo<canal> — volcar TODO
 * el JS inline y TODOS los base64 (cualquier tamaño) para hallar el ch= real
 * por canal, y verificar /hls/stream.m3u8?ch=<code> con Referer.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'es-MX,es;q=0.9' };
const TIMEOUT = 15_000;

const FIDS = ['capoespn', 'capodsports', 'capodsports2', 'capotntar', 'capof1'];

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
    return { status: 0, url, body: '', error: err?.name || String(err).slice(0, 60), cookies: [] };
  } finally { clearTimeout(timer); }
}

(async () => {
  say('# Sonda 9: ch= real por canal en capo8play');
  say('');
  say(`Fecha: ${new Date().toISOString()}`);
  say('');

  for (const fid of FIDS) {
    const url = `https://capo8play.com/capo.php?player=desktop&live=${fid}`;
    const res = await get(url, { Referer: `https://playcapo.st/update/${fid}.php` });
    say(`## ${fid} — HTTP ${res.status}${res.error ? ` (${res.error})` : ''} · ${res.body.length} B`);
    if (res.status !== 200) continue;

    // Todos los base64 de cualquier longitud
    const codes = new Set();
    for (const m of res.body.matchAll(/(?:atob\(['"])?([A-Za-z0-9+/=]{12,2000})['"]?\)?/g)) {
      let text = '';
      try { text = Buffer.from(m[1], 'base64').toString('utf8'); } catch { continue; }
      // buscar ch=, m3u8, /hls/
      for (const mm of text.matchAll(/(?:ch=([a-z0-9_-]+)|(\/hls\/[^\s"'<>\\]+)|https?:\/\/[^\s"'<>\\]+)/gi)) {
        codes.add(mm[0].slice(0, 120));
      }
    }
    for (const c of [...codes].slice(0, 10)) say(`- decodificado: ${redact(c)}`);

    // También ch= en claro en el HTML
    for (const m of res.body.matchAll(/ch=([a-z0-9_-]+)/gi)) say(`- ch= en claro: ${m[1]}`);

    // Scripts inline completos del primero (capoespn) para estudiar el flujo
    if (fid === 'capoespn') {
      const inline = [...res.body.matchAll(/<script(?![^>]+src)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].trim()).filter((t) => t.length > 30 && !/aclib|_Hasync|histats/i.test(t));
      for (const script of inline.slice(0, 5)) say(`\`\`\`\n${redact(script).slice(0, 1500)}\n\`\`\``);
    }

    // Verificar /hls/stream.m3u8?ch=<code> para los códigos hallados
    for (const c of [...codes].filter((x) => x.startsWith('ch=')).slice(0, 2)) {
      const m3 = `https://capo8play.com/hls/stream.m3u8?${c}`;
      const cookie = res.cookies.map((ck) => ck.split(';')[0]).join('; ');
      const man = await get(m3, { Referer: res.url, ...(cookie ? { Cookie: cookie } : {}) });
      const ok = man.status === 200 && /#EXTM3U/.test((man.body || '').slice(0, 400));
      say(`  → ${c}: HTTP ${man.status} ${ok ? 'HLS VÁLIDO' : redact((man.body || '').slice(0, 80)) || man.error || ''}`);
      if (ok) {
        const lines = (man.body || '').split('\n').map((l) => l.trim()).filter(Boolean);
        say(`    ${lines.slice(0, 6).map((l) => redact(l)).join(' ⏎ ')}`.slice(0, 320));
        const v = lines.find((l) => !l.startsWith('#'));
        if (v) {
          const vabs = new URL(v, man.url).href;
          const bare = await get(vabs, { Range: 'bytes=0-300' });
          say(`    variante sin cookie: HTTP ${bare.status} ${/#EXTM3U|#EXTINF/.test((bare.body || '').slice(0, 300)) || bare.status === 206 ? '· DIRECTA' : '· protegida'} ${redact(vabs)}`);
        }
      }
    }
  }

  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/sports-players.md', out.join('\n') + '\n');
  console.log('\n.probe/sports-players.md');
})();
