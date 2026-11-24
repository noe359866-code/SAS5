#!/usr/bin/env node
/**
 * Segunda sonda de canales de deportes (24-11-2026): la cadena del reproductor
 * en las candidatas vivas de la primera tanda. Se vuelcan fragmentos de los
 * scripts que mencionan http/m3u8/atob/eval/fetch para entender cómo se
 * resuelve la señal. URLs firmadas redactadas.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const TIMEOUT = 15_000;

const CHAINS = [
  {
    site: 'streamtp.site',
    pages: [
      'https://streamtp.site/global1.php?stream=dsports',
      'https://streamtp.site/global1.php?stream=foxsports1usa',
      'https://streamtp.site/global1.php?stream=daznlaliga',
      'https://streamtp.site/global1.php?stream=tycsports',
      'https://streamtp.site/channel/dsports.html',
    ],
  },
  {
    site: 'pirlotvhd.com.co',
    pages: [
      'https://pirlotvhd.com.co/es/espn-premium/',
      'https://pirlotvhd.com.co/es/tnt-sports4/',
      'https://pirlotvhd.com.co/es/dsports/',
      'https://pirlotvhd.com.co/es/fox-sports-premium/',
    ],
  },
  {
    site: 'pirloclick.space',
    pages: [
      'https://pirloclick.space/en-vivo/espn-1',
      'https://pirloclick.space/en-vivo/fox-sports-1',
    ],
  },
  {
    site: 'futbollibretvapp.com',
    pages: [
      'https://futbollibretvapp.com/canales-en-vivo/espn1/',
      'https://futbollibretvapp.com/canales-en-vivo/',
    ],
  },
];

const rows = [];
const snippets = [];
const row = (site, step, http, state, detail) => {
  rows.push({ site, step, http, state, detail });
  console.log(`| ${site} | ${step} | ${http} | ${state} | ${detail} |`);
};
const redact = (raw) => {
  try {
    const url = new URL(String(raw));
    return `${url.hostname}${url.pathname.slice(0, 70)}${url.search ? `?(${url.search.length} B)` : ''}`;
  } catch { return String(raw || '').slice(0, 90); }
};

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

function scan(label, body, page) {
  const out = { iframes: [], m3u8: [], scripts: [], fetchCalls: [], playerCfg: [] };
  for (const m of body.matchAll(/<iframe[^>]+src\s*=\s*["']([^"']+)["']/gi)) {
    try { out.iframes.push(new URL(String(m[1]).replace(/&amp;/g, '&'), page).href); } catch { /* ignore */ }
  }
  for (const m of body.matchAll(/(https?:)?\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/gi)) {
    try { out.m3u8.push(new URL(m[0].startsWith('http') ? m[0] : `https:${m[0]}`, page).href); } catch { /* ignore */ }
  }
  for (const m of body.matchAll(/<script[^>]+src\s*=\s*["']([^"']+)["']/gi)) {
    try { out.scripts.push(new URL(m[1], page).href); } catch { /* ignore */ }
  }
  for (const m of body.matchAll(/fetch\(\s*["'`]([^"'`]{8,160})["'`]/gi)) {
    try { out.fetchCalls.push(new URL(String(m[1]), page).href); } catch { out.fetchCalls.push(String(m[1]).slice(0, 120)); }
  }
  for (const m of body.matchAll(/(?:file|source|src|hlsUrl|streamUrl|videoSrc|playbackUrl|channelUrl)\s*[:=]\s*["']([^"']{10,220})["']/gi)) {
    out.playerCfg.push(String(m[1]).slice(0, 160));
  }
  // Fragmentos de JS con pistas de cómo se pide la señal
  const interesting = body.match(/.{0,80}(?:atob\(|eval\(|\.m3u8|XMLHttpRequest|axios|\.ajax|player\.js|source\s*:)/g) || [];
  for (const frag of interesting.slice(0, 6)) {
    snippets.push(`### ${label}\n\`\`\`\n${frag.replace(/[?&](?:token|auth|sig|key|expires)=[^"'&\s]+/gi, '$1…').slice(0, 300)}\n\`\`\``);
  }
  out.iframes = [...new Set(out.iframes)].slice(0, 5);
  out.m3u8 = [...new Set(out.m3u8)].slice(0, 5);
  out.scripts = [...new Set(out.scripts)].slice(0, 10);
  out.fetchCalls = [...new Set(out.fetchCalls)].slice(0, 5);
  out.playerCfg = [...new Set(out.playerCfg)].slice(0, 5);
  return out;
}

const fmt = (s) => [
  s.m3u8.length ? `m3u8=${s.m3u8.length}` : '',
  s.iframes.length ? `iframes=${s.iframes.length}` : '',
  s.fetchCalls.length ? `fetch=${s.fetchCalls.length}` : '',
  s.playerCfg.length ? `cfg=${s.playerCfg.length}` : '',
  s.scripts.length ? `js=${s.scripts.length}` : '',
].filter(Boolean).join(' ') || 'sin señales';

async function probeHls(url, referer) {
  const res = await get(url, referer ? { Referer: referer } : {});
  const head = (res.body || '').slice(0, 400);
  const ok = res.status === 200 && /#EXTM3U/.test(head);
  return { ok, status: res.status, note: ok ? 'HLS válido' : (res.error || head.slice(0, 60).replace(/\s+/g, ' ') || `HTTP ${res.status}`) };
}

(async () => {
  console.log('| Sitio | Paso | HTTP | Estado | Detalle |');
  console.log('|---|---|---|---|---|');
  const seenM3u8 = new Set();
  for (const chain of CHAINS) {
    for (const page of chain.pages) {
      const res = await get(page);
      if (res.status !== 200) { row(chain.site, 'página', res.status, 'error', `${redact(page)} ${res.error || ''}`); continue; }
      const s1 = scan(`${chain.site} página`, res.body, res.url);
      row(chain.site, 'página', 200, 'ok', `${redact(res.url)} · ${fmt(s1)}`);

      for (const iframe of s1.iframes.slice(0, 2)) {
        const inner = await get(iframe, { Referer: res.url });
        const s2 = scan(`${chain.site} iframe ${redact(iframe)}`, inner.body, inner.url);
        row(chain.site, 'iframe', inner.status, s2.m3u8.length || s2.playerCfg.length ? 'señales' : 'vacío', `${redact(iframe)} · ${fmt(s2)}`);
        for (const iframe2 of s2.iframes.slice(0, 2)) {
          const third = await get(iframe2, { Referer: inner.url });
          const s3 = scan(`${chain.site} iframe2 ${redact(iframe2)}`, third.body, third.url);
          row(chain.site, 'iframe2', third.status, s3Ok(s3) ? 'señales' : 'vacío', `${redact(iframe2)} · ${fmt(s3)}`);
          for (const m3 of s3.m3u8.slice(0, 1)) {
            if (seenM3u8.has(m3)) continue;
            seenM3u8.add(m3);
            const hls = await probeHls(m3, third.url);
            row(chain.site, 'hls', hls.status, hls.ok ? 'OK' : 'falló', `${redact(m3)} · ${hls.note}`);
          }
        }
        for (const m3 of s2.m3u8.slice(0, 1)) {
          if (seenM3u8.has(m3)) continue;
          seenM3u8.add(m3);
          const hls = await probeHls(m3, inner.url);
          row(chain.site, 'hls', hls.status, hls.ok ? 'OK' : 'falló', `${redact(m3)} · ${hls.note}`);
        }
      }
      for (const m3 of s1.m3u8.slice(0, 1)) {
        if (seenM3u8.has(m3)) continue;
        seenM3u8.add(m3);
        const hls = await probeHls(m3, res.url);
        row(chain.site, 'hls', hls.status, hls.ok ? 'OK' : 'falló', `${redact(m3)} · ${hls.note}`);
      }
    }
  }
  function s3Ok(s) { return s.m3u8.length || s.playerCfg.length || s.fetchCalls.length; }

  fs.mkdirSync('.probe', { recursive: true });
  const md = ['# Sonda: reproductores de canales de deportes', '', `Fecha: ${new Date().toISOString()}`, '',
    '| Sitio | Paso | HTTP | Estado | Detalle |', '|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.site} | ${r.step} | ${r.http} | ${r.state} | ${r.detail} |`), '',
    '## Fragmentos de JavaScript', '',
    ...snippets.slice(0, 24), ''].join('\n');
  fs.writeFileSync('.probe/sports-players.md', md);
  console.log('\n.probe/sports-players.md');
})();
