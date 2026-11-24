#!/usr/bin/env node
/**
 * Primera tanda de proveedores de canales de deportes (24-11-2026):
 * portada, lista de canales, página de canal y cadena del reproductor.
 * Solo se cuentan señales (iframe, m3u8/mpd) y se verifica UN manifiesto HLS
 * por sitio con un GET parcial. No se imprimen URLs firmadas completas.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const TIMEOUT = 15_000;

// Segunda tanda (la primera dejó: la14hd/la18hd incautados, televisionlibre
// secuestrado con otro contenido, pelotalibretv puerta legal, noveopartidos 403).
const SITES = [
  { name: 'tarjetarojatv.app', base: 'https://tarjetarojatv.app' },
  { name: 'pirlotv.bz', base: 'https://pirlotv.bz' },
  { name: 'futboltv.mx', base: 'https://www.futboltv.mx' },
  { name: 'tvlibrehd.com', base: 'https://www.tvlibrehd.com' },
  { name: 'rojadirectaya.com', base: 'https://rojadirectaya.com' },
  { name: 'thetvapp.to', base: 'https://thetvapp.to' },
];

const CHANNEL_WORD = /espn|fox|dsports?|dazn|tnt|tyc|tudn|deporte|sport|win|directv|bein|movistar|liga ?1|telemundo|canal/i;

const rows = [];
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
    return { status: res.status, url: res.url, body: (await res.text()).slice(0, 1_500_000), headers: res.headers };
  } catch (err) {
    return { status: 0, url, body: '', error: err?.name || String(err).slice(0, 40) };
  } finally { clearTimeout(timer); }
}

function extractLinks(body, page, limit = 40) {
  const out = [];
  for (const m of body.matchAll(/(?:href|src|data-src|data-url|data-href)\s*=\s*["']([^"']+)["']/gi)) {
    let url;
    try { url = new URL(String(m[1]).replace(/&amp;/g, '&'), page).href; } catch { continue; }
    if (/\.(?:css|png|jpe?g|webp|svg|gif|ico|woff2?|js)(?:\?|$)/i.test(url)) continue;
    if (!out.includes(url)) out.push(url);
    if (out.length >= limit) break;
  }
  return out;
}

function extractMediaSignals(body, page) {
  const signals = { m3u8: [], mpd: [], iframes: [], playerCfg: [] };
  for (const m of body.matchAll(/(https?:)?\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/gi)) {
    try { signals.m3u8.push(new URL(m[0].startsWith('http') ? m[0] : `https:${m[0]}`, page).href); } catch { /* ignore */ }
  }
  for (const m of body.matchAll(/(https?:)?\/\/[^\s"'<>\\]+\.mpd[^\s"'<>\\]*/gi)) {
    try { signals.mpd.push(new URL(m[0].startsWith('http') ? m[0] : `https:${m[0]}`, page).href); } catch { /* ignore */ }
  }
  for (const m of body.matchAll(/<iframe[^>]+src\s*=\s*["']([^"']+)["']/gi)) {
    try { signals.iframes.push(new URL(String(m[1]).replace(/&amp;/g, '&'), page).href); } catch { /* ignore */ }
  }
  // Configuraciones típicas de reproductor: file/source/src/hlsUrl/streamUrl
  for (const m of body.matchAll(/(?:file|source|src|hlsUrl|streamUrl|stream|url)\s*[:=]\s*["']([^"']{10,220})["']/gi)) {
    const val = String(m[1]);
    if (/\.m3u8|\.mpd|\.php|player|embed|stream/i.test(val)) {
      try { signals.playerCfg.push(new URL(val, page).href); } catch { signals.playerCfg.push(val.slice(0, 120)); }
    }
  }
  signals.m3u8 = [...new Set(signals.m3u8)].slice(0, 4);
  signals.mpd = [...new Set(signals.mpd)].slice(0, 4);
  signals.iframes = [...new Set(signals.iframes)].slice(0, 6);
  signals.playerCfg = [...new Set(signals.playerCfg)].slice(0, 6);
  return signals;
}

async function probeHls(url, referer) {
  const res = await get(url, referer ? { Referer: referer } : {});
  const head = (res.body || '').slice(0, 300);
  const ok = res.status === 200 && /#EXTM3U/.test(head);
  return { ok, status: res.status, note: ok ? 'HLS válido' : (res.error || head.slice(0, 60).replace(/\s+/g, ' ') || `HTTP ${res.status}`) };
}

(async () => {
  console.log('| Sitio | Paso | HTTP | Estado | Detalle |');
  console.log('|---|---|---|---|---|');
  for (const site of SITES) {
    // 1) Portada
    const home = await get(`${site.base}/`);
    if (home.status !== 200) {
      row(site.name, 'portada', home.status, 'error', home.error || '');
      continue;
    }
    row(site.name, 'portada', 200, 'ok', `${home.body.length} B`);

    // 2) Enlaces a canales (deportes)
    const links = extractLinks(home.body, home.url);
    const channelLinks = links.filter((l) => CHANNEL_WORD.test(l)).slice(0, 6);
    row(site.name, 'canales', 200, channelLinks.length ? 'ok' : 'vacío',
      channelLinks.length ? `${channelLinks.length} enlaces deportivos` : 'sin enlaces deportivos');
    if (!channelLinks.length) continue;

    // 3) Página de canal: señales del reproductor
    for (const link of channelLinks.slice(0, 3)) {
      const page = await get(link);
      if (page.status !== 200) { row(site.name, 'canal', page.status, 'error', `${redact(link)} ${page.error || ''}`); continue; }
      const signals = extractMediaSignals(page.body, page.url);
      const summary = [
        signals.m3u8.length ? `m3u8=${signals.m3u8.length}` : '',
        signals.mpd.length ? `mpd=${signals.mpd.length}` : '',
        signals.iframes.length ? `iframes=${signals.iframes.length}` : '',
        signals.playerCfg.length ? `cfg=${signals.playerCfg.length}` : '',
      ].filter(Boolean).join(' ') || 'sin señales';
      row(site.name, 'canal', 200, signals.m3u8.length || signals.iframes.length || signals.playerCfg.length ? 'señal' : 'vacío',
        `${redact(link)} · ${summary}`);

      // 4) Un nivel dentro del primer iframe
      for (const iframe of signals.iframes.slice(0, 2)) {
        const inner = await get(iframe, { Referer: page.url });
        const s2 = extractMediaSignals(inner.body, inner.url);
        row(site.name, 'iframe', inner.status, s2.m3u8.length || s2.iframes.length || s2.playerCfg.length ? 'señales' : 'vacío',
          `${redact(iframe)} · m3u8=${s2.m3u8.length} iframes=${s2.iframes.length} cfg=${s2.playerCfg.length}`);
        if (s2.m3u8.length) {
          const hls = await probeHls(s2.m3u8[0], inner.url);
          row(site.name, 'hls', hls.status, hls.ok ? 'OK' : 'falló', `${redact(s2.m3u8[0])} · ${hls.note}`);
        }
      }
      // 5) HLS directo en la página del canal
      if (signals.m3u8.length) {
        const hls = await probeHls(signals.m3u8[0], page.url);
        row(site.name, 'hls', hls.status, hls.ok ? 'OK' : 'falló', `${redact(signals.m3u8[0])} · ${hls.note}`);
      }
    }
  }
  fs.mkdirSync('.probe', { recursive: true });
  const md = ['# Sonda: candidatas de canales de deportes', '', `Fecha: ${new Date().toISOString()}`, '',
    '| Sitio | Paso | HTTP | Estado | Detalle |', '|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.site} | ${r.step} | ${r.http} | ${r.state} | ${r.detail} |`), ''].join('\n');
  fs.writeFileSync('.probe/sports-candidates.md', md);
  console.log('\n.probe/sports-candidates.md');
})();
