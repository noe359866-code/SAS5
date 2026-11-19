#!/usr/bin/env node
/**
 * Sonda de descubrimiento para sitios candidatos (solo diagnóstico).
 *
 * No forma parte del addon y no se ejecuta en el Worker: es una herramienta de
 * laboratorio que se corre desde el runner de GitHub Actions (`Sitios en vivo`)
 * para ver, con peticiones reales, qué publica cada sitio en el HTML público:
 *
 *   1. ¿La ficha se sirve a Node con User-Agent normal o hay challenge?
 *   2. ¿Hay `<iframe>` de players, URLs `.m3u8`/`.mp4`, JS empaquetado o
 *      players cargados por AJAX (tema Dooplay)?
 *   3. Cadena de iframes anidados (ficha → embed → player) hasta 3 saltos.
 *   4. Si aparece un `.m3u8`, se pide SOLO la cabecera del manifiesto (texto
 *      pequeño) para comprobar que es HLS de verdad y qué variantes declara.
 *
 * Criterios de salida: nunca imprime cookies, tokens ni URLs firmadas completas
 * (se recorta la query) ni descarga segmentos de vídeo.
 *
 * Uso:
 *   node scripts/sites-probe.mjs                    # todos los sitios
 *   node scripts/sites-probe.mjs gnulaone ultra     # solo los indicados
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
const MAX_HOPS = 3;

export const redact = (raw) => {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}${u.search ? '?…' : ''}`;
  } catch { return String(raw || '').slice(0, 120); }
};

async function get(url, { headers = {}, maxBytes = MAX_HTML, method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { method, body, headers: { ...HEADERS, ...headers }, redirect: 'follow', signal: controller.signal });
    const mitigated = (res.headers.get('cf-mitigated') || '').toLowerCase();
    let text = '';
    if (method !== 'HEAD') {
      const buf = new Uint8Array(await res.arrayBuffer());
      text = new TextDecoder().decode(buf.slice(0, maxBytes));
    }
    return { status: res.status, mitigated, type: res.headers.get('content-type') || '', body: text, bytes: text.length };
  } catch (err) {
    return { status: 0, error: String(err?.name || err?.message || err).slice(0, 60), type: '', body: '', bytes: 0 };
  } finally {
    clearTimeout(timer);
  }
}

const isHls = (text) => /^\s*#EXTM3U/.test(String(text || '').slice(0, 512));

function hlsShape(text) {
  const variants = [...String(text).matchAll(/#EXT-X-STREAM-INF:.*?RESOLUTION=(\d+x\d+)/g)].map((m) => m[1]);
  const audio = [...String(text).matchAll(/#EXT-X-MEDIA:[^\n]*?TYPE=AUDIO[^\n]*?(?:NAME|LANGUAGE)="([^"]+)"/g)].map((m) => m[1]);
  return { variants: [...new Set(variants)].slice(0, 6), audio: [...new Set(audio)].slice(0, 4), segments: (text.match(/#EXTINF/g) || []).length };
}

/** Inspección estructural de una respuesta: iframes, medios, players AJAX. */
function scanHtml(html, base) {
  const $ = load(html);
  const iframes = new Set();
  for (const el of $('iframe[src]').toArray()) {
    const src = $(el).attr('src');
    try { if (src && !/^about:/.test(src)) iframes.add(new URL(src, base).href); } catch { /* src roto */ }
  }
  const media = new Set();
  for (const m of html.matchAll(/https?:\/\/[^\s"'\\<>]+?\.(?:m3u8|mp4)(?:\?[^\s"'\\<>]*)?/gi)) media.add(m[0]);
  for (const m of html.matchAll(/["']([^"']{4,300}\.m3u8(?:\?[^"']*)?)["']/gi)) {
    try { media.add(new URL(m[1].replace(/\\\//g, '/'), base).href); } catch { /* ruta inválida */ }
  }
  const dataUrls = new Set();
  for (const el of $('[data-url],[data-src],[data-file],[data-video],[data-embed],[data-link],[data-player]').toArray()) {
    for (const attr of ['data-url', 'data-src', 'data-file', 'data-video', 'data-embed', 'data-link', 'data-player']) {
      const value = $(el).attr(attr);
      if (value && /^(?:https?:)?\/\//.test(value)) dataUrls.add(new URL(value, base).href);
    }
  }
  // Dooplay (tubeonline y clones): cada servidor es un <li data-post data-nume>
  // y el embed real se pide por admin-ajax.php?action=doo_player_ajax.
  const ajaxPlayers = [];
  for (const el of $('[data-post][data-nume]').toArray()) {
    const node = $(el);
    ajaxPlayers.push({ post: node.attr('data-post'), nume: node.attr('data-nume'),
      type: node.attr('data-type') || 'movie', label: node.text().trim().slice(0, 40) });
  }
  // Botones "opción N" que en algunos temas guardan el enlace en el href/hash.
  const optionLinks = new Set();
  for (const el of $('a[href*="#op"],a[href*="#ts"]').toArray()) optionLinks.add($(el).attr('href'));
  const packed = /eval\(function\(p,a,c,k,e,d\)/.test(html) || /}\('.*?',\d+,\d+,'.*?'\.split\('\|'\)/.test(html);
  const hosts = [...new Set([...iframes, ...dataUrls].map((url) => { try { return new URL(url).hostname; } catch { return null; } }).filter(Boolean))];
  return { iframes: [...iframes], media: [...media], dataUrls: [...dataUrls], ajaxPlayers, optionLinks: [...optionLinks],
    packed, hosts, videos: $('video, video source').length, scripts: $('script[src]').length };
}

async function probeManifest(url, referer) {
  const headers = referer ? { Referer: referer, Origin: new URL(referer).origin } : {};
  const res = await get(url, { headers, maxBytes: 96 * 1024 });
  const out = { url: redact(url), host: new URL(url).hostname, status: res.status, type: res.type.split(';')[0], hls: false };
  if (res.status === 200 && isHls(res.body)) Object.assign(out, { hls: true }, hlsShape(res.body));
  if (!res.status) out.error = res.error;
  return out;
}

/** Recorre la cadena ficha → embeds → iframes anidados y anota lo que encuentra. */
async function crawl(label, url, referer, depth, rows, site, seen) {
  if (depth > MAX_HOPS || seen.has(url) || seen.size > 10) return;
  seen.add(url);
  const res = await get(url, { headers: referer ? { Referer: referer } : {} });
  const scan = res.status === 200 ? scanHtml(res.body, url) : null;
  if (res.status === 200 && res.body && /cuevanas3|animed23|animejara/.test(site) && (/json|html|text|javascript/.test(res.type) || !res.type)) {
    try {
      const fs = await import('node:fs');
      fs.mkdirSync('.probe/html', { recursive: true });
      const name = `${site}-${label}`.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 60);
      fs.writeFileSync(`.probe/html/disc-${name}.html`, res.body);
    } catch { /* diagnóstico */ }
  }
  rows.push({
    site, page: `${'·'.repeat(depth)}${label}`, url: redact(url), status: res.status, mitigated: res.mitigated,
    bytes: res.bytes, iframes: scan?.iframes.length ?? '—', media: scan?.media.length ?? '—',
    packed: scan?.packed ?? false, hosts: scan?.hosts.join(', ') || '—', detail: res.error || '',
  });
  if (!scan) return;

  // Medios literales: basta la cabecera del manifiesto.
  for (const media of scan.media.slice(0, 2)) {
    const probe = await probeManifest(media, url);
    rows.push({ site, page: `${'·'.repeat(depth + 1)}manifiesto`, url: probe.url, status: probe.status, mitigated: '',
      bytes: '', iframes: '—', media: probe.hls ? 'HLS ✓' : probe.type, packed: false, hosts: probe.host,
      detail: probe.hls ? `${probe.variants.join(' ') || 'master'} audio=${probe.audio.join('/') || '—'} seg=${probe.segments}` : (probe.error || probe.type) });
  }
  // Players AJAX de Dooplay.
  for (const player of scan.ajaxPlayers.slice(0, 2)) {
    const api = new URL('/wp-admin/admin-ajax.php', url).href;
    const body = new URLSearchParams({ action: 'doo_player_ajax', post: player.post, nume: player.nume, type: player.type }).toString();
    const ajax = await get(api, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest', Referer: url, Origin: new URL(url).origin } });
    let embed = '';
    try { embed = JSON.parse(ajax.body)?.embed_url || ''; } catch { /* respuesta no JSON */ }
    rows.push({ site, page: `${'·'.repeat(depth + 1)}ajax ${player.label || player.nume}`, url: api.replace(/\?.*/, ''), status: ajax.status,
      mitigated: ajax.mitigated, bytes: ajax.bytes, iframes: '—', media: embed ? 'embed ✓' : '—', packed: false,
      hosts: embed ? new URL(embed).hostname : '—', detail: embed ? redact(embed) : (ajax.error || ajax.body.slice(0, 60).replace(/\s+/g, ' ')) });
    if (embed) await crawl(`embed ajax ${player.nume}`, embed, url, depth + 1, rows, site, seen);
  }
  for (const child of [...scan.iframes, ...scan.dataUrls].slice(0, 4)) {
    if (/youtube\.com|facebook\.com|twitter\.com|google\.com/.test(child)) continue;
    await crawl(new URL(child).hostname, child, url, depth + 1, rows, site, seen);
  }
}

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
      { label: 'ficha película 2', url: 'https://verpeliculasultra.com/accion/5276-hope.html' },
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
  cuevanas3: {
    name: 'cuevanas3.pro',
    base: 'https://cuevanas3.pro',
    pages: [
      { label: 'portada', url: 'https://cuevanas3.pro/' },
      { label: 'wp-json', url: 'https://cuevanas3.pro/wp-json/' },
      { label: 'wp-json-wpf', url: 'https://cuevanas3.pro/wp-json/wpf/v1' },
      { label: 'wp-types', url: 'https://cuevanas3.pro/wp-json/wp/v2/types' },
      { label: 'wp-search', url: 'https://cuevanas3.pro/wp-json/wp/v2/search?search=spider-man&per_page=5' },
      { label: 'bundle', url: 'https://cuevanas3.pro/wp-content/themes/cuevana/assets/build/static/assets/index-CBH2XN48.js' },
      { label: 'chunk-search', url: 'https://cuevanas3.pro/wp-content/themes/cuevana/assets/build/static/assets/Search-DtBbp1z5.js' },
      { label: 'chunk-movie', url: 'https://cuevanas3.pro/wp-content/themes/cuevana/assets/build/static/assets/Movie-B-znf5nj.js' },
      { label: 'chunk-anime', url: 'https://cuevanas3.pro/wp-content/themes/cuevana/assets/build/static/assets/Anime-BU9eNyux.js' },
      { label: 'chunk-episode', url: 'https://cuevanas3.pro/wp-content/themes/cuevana/assets/build/static/assets/Episode-BuDNNfwB.js' },
      { label: 'chunk-wrapper', url: 'https://cuevanas3.pro/wp-content/themes/cuevana/assets/build/static/assets/Wrapper-BT-hlZyU.js' },
      { label: 'chunk-api', url: 'https://cuevanas3.pro/wp-content/themes/cuevana/assets/build/static/assets/index-CSASIiGL.js' },
      { label: 'chunk-related', url: 'https://cuevanas3.pro/wp-content/themes/cuevana/assets/build/static/assets/Related-3DG9WZ8k.js' },
      { label: 'chunk-listing', url: 'https://cuevanas3.pro/wp-content/themes/cuevana/assets/build/static/assets/Listing-B0UcKnlU.js' },
      { label: 'chunk-tvshow', url: 'https://cuevanas3.pro/wp-content/themes/cuevana/assets/build/static/assets/TvShow-3EzNr2_O.js' },
      { label: 'chunk-episodelist', url: 'https://cuevanas3.pro/wp-content/themes/cuevana/assets/build/static/assets/EpisodeList-uvlgMDbq.js' },
      { label: 'chunk-archive', url: 'https://cuevanas3.pro/wp-content/themes/cuevana/assets/build/static/assets/Archive-KaP3wzuX.js' },
    ],
  },
  animed23: {
    name: 'animed23.com',
    base: 'https://animed23.com',
    pages: [
      { label: 'portada', url: 'https://animed23.com/' },
    ],
  },
  animejara: {
    name: 'animejara.com',
    base: 'http://animejara.com',
    pages: [
      { label: 'portada', url: 'http://animejara.com/' },
    ],
  },
};

async function main() {
  const only = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  const keys = only.length ? only.filter((key) => SITES[key]) : Object.keys(SITES);
  const rows = [];
  for (const key of keys) {
    const site = SITES[key];
    console.log(`\n### ${site.name}`);
    for (const page of site.pages) {
      await crawl(page.label, page.url, site.base + '/', 0, rows, site.name, new Set());
    }
  }
  for (const row of rows) {
    console.log(`${row.site} | ${row.page} | ${row.status}${row.mitigated ? ' cf' : ''} | ${row.url} | if=${row.iframes} media=${row.media} ${row.detail}`);
  }
  const fs = await import('node:fs');
  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/sites-probe.json', JSON.stringify(rows, null, 2));
  const md = ['| Sitio | Paso | URL | HTTP | Iframes | Medios | Hosts | Detalle |', '|---|---|---|---|---|---|---|---|'];
  for (const row of rows) {
    md.push(`| ${row.site} | ${row.page} | \`${row.url}\` | ${row.status}${row.mitigated ? ' cf' : ''} | ${row.iframes} | ${row.media} | ${row.hosts} | ${String(row.detail || '').replace(/\|/g, '/')} |`);
  }
  md.push('', 'Sonda de descubrimiento: solo HTML público y la cabecera de un manifiesto; no descarga vídeo ni imprime URLs firmadas.');
  fs.writeFileSync('.probe/sites-probe.md', md.join('\n') + '\n');
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
