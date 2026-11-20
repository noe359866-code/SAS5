#!/usr/bin/env node
/**
 * Sonda de anime, cuarta vuelta: qué hay dentro de los visores de AnimeAV1.
 *
 * La tercera vuelta encontró la cadena buena: `/catalogo?search=` →
 * `/media/<slug>` → `/media/<slug>/<n>`, con 17 embeds repartidos entre
 * `SUB` (subtitulado) y `DUB` (latino). Los hosts son el player propio
 * `player.zilla-networks.com`, `animeav1.uns.bio`, Voe, Byse y MP4Upload.
 *
 * Aquí se abre el player propio para ver si sirve un HLS (como en AnimeFLV) o
 * un iframe a otro sitio, y se reintenta Byse con más plazo y el `Referer` del
 * episodio. Si el player propio entrega manifiesto, AnimeAV1 entra en el addon
 * como fuente de anime **con doblaje latino y subtitulado**, que hoy no hay.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractorFor, extractEmbed } = require('../lib/extractors');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.6' };
const TIMEOUT = 25_000;
const MAX = 2 * 1024 * 1024;
const BASE = 'https://animeav1.com';

const rows = [];
const row = (step, note) => { rows.push({ step, note }); console.log(`| ${step} | ${note} |`); };
const hostOf = (raw) => { try { return new URL(raw).hostname; } catch { return '?'; } };

/** Ruta y nombres de parámetros, nunca sus valores. */
const shape = (raw) => {
  try {
    const u = new URL(raw);
    const names = [...u.searchParams.keys()];
    return `${u.hostname}${u.pathname}${names.length ? '?' + names.map((n) => `${n}=…`).join('&') : ''}`;
  } catch { return String(raw || '').slice(0, 60); }
};

async function req(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  const started = Date.now();
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { ...HEADERS, ...(referer ? { Referer: referer } : {}) } });
    const text = (await res.text()).slice(0, MAX);
    return { status: res.status, body: text, type: (res.headers.get('content-type') || '').split(';')[0], ms: Date.now() - started, url: res.url || url };
  } catch (err) {
    return { status: 0, body: '', type: '', ms: Date.now() - started, error: String(err?.name || err?.message || err).slice(0, 40) };
  } finally { clearTimeout(timer); }
}

async function firstBytesIsHls(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { ...HEADERS, Referer: referer } });
    const text = (await res.text()).slice(0, 200);
    return { status: res.status, hls: /^\s*#EXTM3U/.test(text), type: (res.headers.get('content-type') || '').split(';')[0] };
  } catch (err) { return { status: 0, hls: false, type: '', error: String(err?.name || err).slice(0, 30) }; } finally { clearTimeout(timer); }
}

async function main() {
  const fs = await import('node:fs');
  fs.mkdirSync('.probe', { recursive: true });

  const search = await req(`${BASE}/catalogo?search=${encodeURIComponent('solo leveling')}`, `${BASE}/`);
  const media = (search.body.match(/href="([^"]*\/media\/[^"/]+)"/) || [])[1] || '';
  if (!media) { row('buscar', 'sin ficha'); return finish(); }
  const mediaUrl = new URL(media, BASE).href;
  const detail = await req(mediaUrl, `${BASE}/`);
  const ep = (detail.body.match(/href="([^"]*\/media\/[^"]+\/1)"/) || [])[1] || `${mediaUrl}/1`;
  const episodeUrl = new URL(ep, BASE).href;
  const episode = await req(episodeUrl, mediaUrl);
  row('episodio', `${episode.status} ${episode.ms}ms ${episode.body.length}B`);

  const zone = episode.body.slice(episode.body.indexOf('embeds:'), episode.body.indexOf('embeds:') + 30000);
  const embeds = [];
  for (const group of zone.matchAll(/(SUB|DUB)\s*:\s*\[([\s\S]*?)\]/g)) {
    const audio = group[1] === 'DUB' ? 'latino' : 'subtitulado';
    for (const m of group[2].matchAll(/url\s*:\s*"((?:[^"\\]|\\.)+)"/g)) {
      const url = m[1].replace(/\\(.)/g, '$1');
      if (/^https?:/.test(url)) embeds.push({ url, audio });
    }
  }
  row('embeds', `${embeds.length} · ${[...new Set(embeds.map((e) => `${hostOf(e.url)}/${e.audio}`))].slice(0, 8).join(' ')}`);

  // Player propio: uno por idioma.
  for (const audio of ['subtitulado', 'latino']) {
    const own = embeds.find((e) => /zilla-networks/.test(e.url) && e.audio === audio);
    if (!own) { row(`player ${audio}`, 'no hay embed propio'); continue; }
    row(`player ${audio} (forma)`, shape(own.url));
    const res = await req(own.url, episodeUrl);
    const markers = ['#EXTM3U', 'm3u8', '<iframe', 'playlist', 'sources', 'file:', 'hls'].map((m) => `${m}=${(res.body.match(new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length}`).join(' ');
    row(`player ${audio} (respuesta)`, `${res.status} ${res.ms}ms ${res.type} ${res.body.length}B · ${markers}`);
    const frames = [...new Set([...res.body.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]))];
    if (frames.length) row(`player ${audio} (iframe)`, frames.slice(0, 3).map((f) => shape(new URL(f, own.url).href)).join(' · '));
    const mediaUrls = [...new Set([...res.body.matchAll(/https?:[^\s"'<>\\]+?\.m3u8[^\s"'<>\\]*/gi)].map((m) => m[0]))]
      .concat([...new Set([...res.body.matchAll(/["'](\/m3u8\/[a-f0-9]+)["']/gi)].map((m) => new URL(m[1], own.url).href))]);
    if (mediaUrls.length) {
      const probe = await firstBytesIsHls(mediaUrls[0], own.url);
      row(`player ${audio} (manifiesto)`, `${shape(mediaUrls[0])} → ${probe.status} hls=${probe.hls} ${probe.type}`);
    }
  }

  // Byse con más plazo y Referer del episodio.
  const byse = embeds.find((e) => /byselapuix|byse/.test(e.url));
  if (byse) {
    row('byse (forma)', shape(byse.url));
    try {
      const out = await extractEmbed(byse.url, { timeoutMs: 25_000, referer: episodeUrl });
      const kinds = [...new Set((out.sources || []).map((s) => s.kind))].join('/');
      row('byse (extracción)', `ok=${out.ok} fuentes=${out.sources?.length || 0}${kinds ? ` (${kinds})` : ''}${out.reason ? ` · ${out.reason}` : ''}`);
    } catch (err) { row('byse (extracción)', `error ${String(err?.message || err).slice(0, 60)}`); }
  }

  // uns.bio: ¿es otro player propio?
  const uns = embeds.find((e) => /uns\.bio/.test(e.url));
  if (uns) {
    const res = await req(uns.url, episodeUrl);
    const markers = ['#EXTM3U', 'm3u8', '<iframe', 'file:', 'sources'].map((m) => `${m}=${(res.body.match(new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length}`).join(' ');
    row('uns.bio', `${res.status} ${res.ms}ms ${res.type} ${res.body.length}B · ${markers}`);
  }

  finish();
}

function finish() {
  const fs = require('node:fs');
  const md = ['| Paso | Resultado |', '|---|---|'];
  for (const r of rows) md.push(`| ${r.step} | ${String(r.note).replace(/\|/g, '/')} |`);
  md.push('', 'AnimeAV1: player propio, Byse y visores de la página del episodio.');
  fs.writeFileSync('.probe/anime-players3.md', `${md.join('\n')}\n`);
  console.log(`\n${md.join('\n')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
