#!/usr/bin/env node
/**
 * Sonda de descubrimiento para sitios candidatos (solo diagnóstico).
 *
 * No forma parte del addon y no se ejecuta en el Worker: es una herramienta de
 * laboratorio que se corre desde el runner de GitHub Actions (`Sitios en vivo`)
 * para ver, con peticiones reales, qué publica cada sitio en el HTML público:
 *
 *   1. ¿La ficha se sirve a Node con User-Agent normal o hay challenge?
 *   2. ¿Hay `<iframe>` de players, URLs `.m3u8`/`.mp4` literales o JS empaquetado?
 *   3. Si hay embed, ¿el player entrega HLS/MP4 y responde al pedir el medio?
 *
 * Criterios de salida: nunca imprime cookies, tokens ni URLs firmadas completas
 * (se recorta la query). Tampoco descarga segmentos de vídeo: solo el primer
 * tramo de un manifiesto `.m3u8` (texto pequeño) y, como mucho, un HEAD.
 *
 * Uso:
 *   node scripts/sites-probe.mjs                 # todos los sitios
 *   node scripts/sites-probe.mjs gnulaone ultra   # solo los indicados
 */

import { load } from 'cheerio';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-MX,es;q=0.9,en;q=0.6',
};
const TIMEOUT = 12_000;
const MAX_HTML = 3 * 1024 * 1024;

export const redact = (raw) => {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}${u.search ? '?…' : ''}`;
  } catch { return String(raw || '').slice(0, 120); }
};

async function get(url, { headers = {}, maxBytes = MAX_HTML, method = 'GET' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { method, headers: { ...HEADERS, ...headers }, redirect: 'follow', signal: controller.signal });
    const mitigated = (res.headers.get('cf-mitigated') || '').toLowerCase();
    const type = res.headers.get('content-type') || '';
    let body = '';
    if (method !== 'HEAD') {
      const buf = new Uint8Array(await res.arrayBuffer());
      body = new TextDecoder().decode(buf.slice(0, maxBytes));
    }
    return { status: res.status, mitigated, type, body, url: res.url, bytes: body.length };
  } catch (err) {
    return { status: 0, error: String(err?.name || err?.message || err).slice(0, 80), type: '', body: '', bytes: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/** Todos los enlaces/rutas de player que aparecen en el HTML público. */
function scanHtml(html, base) {
  const $ = load(html);
  const iframes = [];
  for (const el of $('iframe[src]').toArray()) {
    const src = $(el).attr('src');
    if (src && !/^about:/.test(src)) iframes.push(new URL(src, base).href);
  }
  const text = html;
  const media = new Set();
  for (const m of text.matchAll(/https?:\/\/[^\s"'\\<>]+?\.(?:m3u8|mp4)(?:\?[^\s"'\\<>]*)?/gi)) media.add(m[0]);
  for (const m of text.matchAll(/["']([^"']+\.m3u8(?:\?[^"']*)?)["']/gi)) {
    try { media.add(new URL(m[1].replace(/\\\//g, '/'), base).href); } catch { /* ruta inválida */ }
  }
  const dataUrls = new Set();
  for (const el of $('[data-url],[data-src],[data-file],[data-video],[data-embed],[data-link]').toArray()) {
    for (const attr of ['data-url', 'data-src', 'data-file', 'data-video', 'data-embed', 'data-link']) {
      const value = $(el).attr(attr);
      if (value && /^https?:/.test(value)) dataUrls.add(value);
    }
  }
  const packed = /eval\(function\(p,a,c,k,e,d\)/.test(text) || /\.split\('\|'\)/.test(text);
  const extPlayers = [...new Set([...iframes, ...dataUrls].map((url) => { try { return new URL(url).hostname; } catch { return null; } }).filter(Boolean))];
  return { iframes: [...new Set(iframes)], media: [...media], dataUrls: [...dataUrls], packed, extPlayers, videos: $('video, video source').length };
}

function isHls(text) {
  return /^\s*#EXTM3U/.test(String(text || '').slice(0, 512));
}

function hlsShape(text) {
  const variants = [...String(text).matchAll(/#EXT-X-STREAM-INF:.*RESOLUTION=(\d+x\d+)/g)].map((m) => m[1]);
  const audio = [...String(text).matchAll(/#EXT-X-MEDIA:.*?TYPE=AUDIO.*?(?:NAME|LANGUAGE)="([^"]+)"/g)].map((m) => m[1]);
  return { variants: variants.slice(0, 6), audio: audio.slice(0, 4), segments: (text.match(/#EXTINF/g) || []).length };
}

async function probeMedia(url, referer) {
  const headers = referer ? { Referer: referer, Origin: new URL(referer).origin } : {};
  const isManifest = /\.m3u8/i.test(url);
  const result = { url: redact(url), host: new URL(url).hostname, kind: isManifest ? 'hls' : 'mp4' };
  const res = await get(url, { headers, maxBytes: 64 * 1024 });
  result.status = res.status;
  result.type = res.type.split(';')[0];
  result.error ||= res.error;
  if (isManifest && res.status === 200) {
    result.hls = isHls(res.body);
    if (result.hls) Object.assign(result, hlsShape(res.body));
  }
  if (!isManifest && res.status === 200) {
    const head = await get(url, { headers, method: 'HEAD' });
    result.type = (head.type || result.type || '').split(';')[0];
    result.acceptRanges = head.status === 200;
  }
  return result;
}

// ───────────────────────── Sitios ─────────────────────────
// Cada entrada describe cómo llegar a una ficha concreta, nada más: la sonda
// no recorre buscadores ni listados completos.

const SITES = {
  gnulaone: {
    name: 'ver.gnula.one',
    base: 'https://ver.gnula.one',
    pages: [
      { label: 'ficha película', url: 'https://ver.gnula.one/movies/spider-man-un-nuevo-dia/' },
      { label: 'ficha serie', url: 'https://ver.gnula.one/tvshows/the-last-of-us/' },
    ],
  },
  ultra: {
    name: 'verpeliculasultra.com',
    base: 'https://verpeliculasultra.com',
    pages: [
      { label: 'ficha película', url: 'https://verpeliculasultra.com/accion/4997-f1-la-pelicula.html' },
      { label: 'listado', url: 'https://verpeliculasultra.com/xfsearch/peliculas-2025/' },
    ],
  },
  tubeonline: {
    name: 'www.tubeonline.net',
    base: 'https://www.tubeonline.net',
    pages: [
      { label: 'ficha película', url: 'https://www.tubeonline.net/pelicula/spider-man-un-nuevo-dia/' },
      { label: 'ficha serie', url: 'https://www.tubeonline.net/serie/el-agente-nocturno/' },
    ],
  },
  mirando: {
    name: 'mirandogratis.com',
    base: 'https://mirandogratis.com',
    pages: [
      { label: 'ficha película', url: 'https://mirandogratis.com/el-sacrificio-de-tess.html' },
      { label: 'ficha película 2', url: 'https://mirandogratis.com/el-reino-prohibido.html' },
    ],
  },
};

async function probeSite(site, out) {
  console.log(`\n### ${site.name}`);
  const discovered = new Set();
  for (const page of site.pages) {
    const res = await get(page.url);
    const scan = res.status === 200 ? scanHtml(res.body, page.url) : null;
    console.log(`- [${page.label}] HTTP ${res.status}${res.mitigated ? ` cf-mitigated=${res.mitigated}` : ''} ${res.bytes}b${res.error ? ` error=${res.error}` : ''}`);
    out.push({ site: site.name, page: page.label, url: redact(page.url), status: res.status, mitigated: res.mitigated,
      bytes: res.bytes, iframes: scan?.iframes.length ?? '—', media: scan?.media.length ?? '—',
      packed: scan?.packed ?? false, hosts: scan?.extPlayers.join(', ') || '—' });
    if (!scan) continue;
    for (const url of scan.iframes.slice(0, 3)) discovered.add(url);
    console.log(`  iframes=${scan.iframes.length} media=${scan.media.length} dataUrls=${scan.dataUrls.length} packed=${scan.packed} videos=${scan.videos}`);
    if (scan.extPlayers.length) console.log(`  hosts: ${scan.extPlayers.join(', ')}`);
    for (const url of [...scan.media, ...scan.dataUrls].slice(0, 4)) discovered.add(url);
  }
  // Embeds: se abren como máximo 4 y se busca el medio declarado dentro.
  for (const embed of [...discovered].slice(0, 4)) {
    const isMedia = /\.(?:m3u8|mp4)(?:\?|$)/i.test(embed);
    if (isMedia) {
      const media = await probeMedia(embed, site.base + '/');
      console.log(`  media ${media.url} → ${media.status} ${media.type || ''} ${media.hls ? `HLS ok (${media.variants.join(' ')})` : ''}`);
      out.push({ site: site.name, page: 'media', url: media.url, status: media.status, mitigated: '', bytes: '',
        iframes: '—', media: media.kind, packed: false, hosts: media.host, detail: media.hls ? `${media.variants.join(' ') || 'master'} audio=${media.audio.join('/')}` : media.type });
      continue;
    }
    const res = await get(embed, { headers: { Referer: site.base + '/' } });
    const scan = res.status === 200 ? scanHtml(res.body, embed) : null;
    console.log(`  embed ${redact(embed)} → HTTP ${res.status} ${res.bytes}b packed=${scan?.packed} media=${scan?.media.length ?? '—'} iframes=${scan?.iframes.length ?? '—'}`);
    if (scan?.media.length) for (const url of scan.media.slice(0, 2)) discovered.add(url);
    if (scan?.iframes.length) for (const url of scan.iframes.slice(0, 2)) discovered.add(url);
    out.push({ site: site.name, page: 'embed', url: redact(embed), status: res.status, mitigated: res.mitigated,
      bytes: res.bytes, iframes: scan?.iframes.length ?? '—', media: scan?.media.length ?? '—',
      packed: scan?.packed ?? false, hosts: new URL(embed).hostname });
  }
}

async function main() {
  const only = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  const keys = only.length ? only.filter((key) => SITES[key]) : Object.keys(SITES);
  const out = [];
  for (const key of keys) await probeSite(SITES[key], out);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = ['| Sitio | Vista | URL | HTTP | Iframes | Medios | JS packed | Hosts |', '|---|---|---|---|---|---|---|---|'];
    for (const row of out) {
      lines.push(`| ${row.site} | ${row.page} | \`${row.url}\` | ${row.status}${row.mitigated ? ' cf' : ''} | ${row.iframes} | ${row.media} | ${row.packed ? 'sí' : 'no'} | ${row.hosts} |`);
    }
    lines.push('', 'Sonda de descubrimiento: no descarga vídeo, solo HTML público y la cabecera de un manifiesto. No imprime URLs firmadas.');
    const fs = await import('node:fs');
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  }
  const fs = await import('node:fs');
  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/sites-probe.json', JSON.stringify(out, null, 2));
  fs.writeFileSync('.probe/sites-probe.md', out.map((row) => `| ${row.site} | ${row.page} | \`${row.url}\` | ${row.status}${row.mitigated ? ' cf' : ''} | ${row.iframes} | ${row.media} | ${row.packed ? 'sí' : 'no'} | ${row.hosts} | ${row.detail || ''} |`).join('\n'));
  console.log('\nJSON', JSON.stringify(out));
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
