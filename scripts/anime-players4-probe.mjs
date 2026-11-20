#!/usr/bin/env node
/**
 * Sonda de anime, quinta vuelta: qué es la página `/play/<hash>` de
 * `player.zilla-networks.com`.
 *
 * La cuarta vuelta mostró que el player propio de AnimeAV1 (el mismo host que
 * usa AnimeFLV para sus HLS) responde 200 con 1006 bytes y ningún marcador de
 * vídeo. Aquí se imprime el cuerpo **recortado** (sin valores de consulta) para
 * saber si es un reproductor que carga por JS, un aviso o un muro, y se prueban
 * las variantes que sirven los demás players de ese host (`/m3u8/<token>`).
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.6' };
const TIMEOUT = 20_000;
const BASE = 'https://animeav1.com';

const rows = [];
const row = (step, note) => { rows.push({ step, note }); console.log(`| ${step} | ${note} |`); };

async function req(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  const started = Date.now();
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { ...HEADERS, ...(referer ? { Referer: referer } : {}) } });
    const text = (await res.text()).slice(0, 200_000);
    return { status: res.status, body: text, type: (res.headers.get('content-type') || '').split(';')[0], ms: Date.now() - started,
      server: res.headers.get('server') || '', cf: (res.headers.get('cf-mitigated') || '') };
  } catch (err) {
    return { status: 0, body: '', type: '', ms: Date.now() - started, error: String(err?.name || err?.message || err).slice(0, 40) };
  } finally { clearTimeout(timer); }
}

/** Cuerpo legible sin filtraciones: sin valores de consulta ni tokens. */
function digest(body) {
  return String(body)
    .replace(/https?:\/\/[^\s"'<>]+/g, (raw) => {
      try { const u = new URL(raw); return `«${u.hostname}${u.pathname}»`; } catch { return '«url»'; }
    })
    .replace(/[a-f0-9]{16,}/gi, '«hex»')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);
}

const shape = (raw) => { try { const u = new URL(raw); return `${u.hostname}${u.pathname}`; } catch { return '?' }; };

async function main() {
  const fs = await import('node:fs');
  fs.mkdirSync('.probe', { recursive: true });

  const search = await req(`${BASE}/catalogo?search=${encodeURIComponent('solo leveling')}`, `${BASE}/`);
  const media = (search.body.match(/href="([^"]*\/media\/[^"/]+)"/) || [])[1] || '';
  if (!media) { row('buscar', 'sin ficha'); return finish(); }
  const mediaUrl = new URL(media, BASE).href;
  const detail = await req(mediaUrl, `${BASE}/`);
  const epLink = (detail.body.match(/href="([^"]*\/media\/[^"]+\/1)"/) || [])[1] || `${mediaUrl}/1`;
  const episodeUrl = new URL(epLink, BASE).href;
  const episode = await req(episodeUrl, mediaUrl);

  const zone = episode.body.slice(episode.body.indexOf('embeds:'), episode.body.indexOf('embeds:') + 30000);
  const embeds = [];
  for (const group of zone.matchAll(/(SUB|DUB)\s*:\s*\[([\s\S]*?)\]/g)) {
    const audio = group[1] === 'DUB' ? 'latino' : 'subtitulado';
    for (const m of group[2].matchAll(/url\s*:\s*"((?:[^"\\]|\\.)+)"/g)) {
      const url = m[1].replace(/\\(.)/g, '$1');
      if (/^https?:/.test(url)) embeds.push({ url, audio });
    }
  }
  // Todos los embeds, con su forma: sirve para ver el reparto real por idioma.
  row('reparto', `${embeds.length} · ${embeds.map((e) => `${shape(e.url)}/${e.audio}`).slice(0, 12).join(' ')}`);

  const own = embeds.find((e) => /zilla-networks/.test(e.url));
  if (!own) { row('player propio', 'no encontrado'); return finish(); }
  const page = await req(own.url, episodeUrl);
  row('player propio', `${page.status} ${page.ms}ms ${page.type} ${page.body.length}B server=${page.server || '—'} cf=${page.cf || '—'}`);
  row('cuerpo', digest(page.body));

  const scripts = [...new Set([...page.body.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]))];
  if (scripts.length) row('scripts', scripts.slice(0, 4).map((s) => shape(new URL(s, own.url).href)).join(' · '));

  // Variantes conocidas del mismo host: `/m3u8/<token>` es lo que sirve AnimeFLV.
  const token = (own.url.match(/\/play\/([a-z0-9]+)/i) || [])[1];
  if (token) {
    for (const path of [`/m3u8/${token}`, `/play/${token}/m3u8`, `/api/play/${token}`]) {
      const res = await req(`https://player.zilla-networks.com${path}`, episodeUrl);
      const hls = /^\s*#EXTM3U/.test(res.body);
      const markers = ['#EXTM3U', 'm3u8', 'iframe', 'error', 'JSON'].map((m) => `${m}=${(res.body.match(new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length}`).join(' ');
      row(`variante ${path.replace(/[a-f0-9]{16,}/i, '«hex»')}`, `${res.status} ${res.type} ${res.body.length}B hls=${hls} · ${markers}`);
    }
  }

  finish();
}

function finish() {
  const fs = require('node:fs');
  const md = ['| Paso | Resultado |', '|---|---|'];
  for (const r of rows) md.push(`| ${r.step} | ${String(r.note).replace(/\|/g, '/')} |`);
  md.push('', 'AnimeAV1: anatomía del player propio y variantes del mismo host.');
  fs.writeFileSync('.probe/anime-players4.md', `${md.join('\n')}\n`);
  console.log(`\n${md.join('\n')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
