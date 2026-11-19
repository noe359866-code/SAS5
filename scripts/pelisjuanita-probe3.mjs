#!/usr/bin/env node
/**
 * Sonda 3 de pelisjuanita.org: qué declara el visor de Vimeos (solo diagnóstico).
 *
 * Cadena ya medida:
 *   `/api/rest/v1/search?q=` → `/api/rest/v1/content/<kind>/<slug>` (sin
 *   servidores) → `https://videoapp.mov/e/movie/<tmdb>` (o `/e/tv/<tmdb>/<s>/<e>`)
 *   → un único `<iframe id="frame">` de `vimeos.net/embed-….html?cf=<JWT>`.
 *
 * Falta lo importante para el addon: **si el visor declara el idioma**. Esta
 * sonda abre el embed de Vimeos y busca etiquetas de audio, pistas y el
 * manifiesto (solo la URL, nunca el contenido).
 *
 * Los HTML se guardan con el token `cf` recortado para no publicar firmas.
 */

const BASE = 'https://pelisjuanita.org';
const PLAYER = 'https://videoapp.mov';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'application/json,text/html;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const TIMEOUT = 15_000;
const MAX = 1024 * 1024;

const scrub = (text) => String(text || '')
  .replace(/([?&]cf=)[A-Za-z0-9._-]{10,}/g, '$1…')
  .replace(/([?&](?:s|sig|token|t)=)[A-Za-z0-9._-]{10,}/g, '$1…');

const redact = (raw) => {
  try {
    const u = new URL(raw, BASE);
    const names = [...u.searchParams.keys()];
    return `${u.host}${u.pathname}${names.length ? '?' + names.map((n) => `${n}=…`).join('&') : ''}`;
  } catch { return String(raw || '').slice(0, 160); }
};

async function get(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { headers: { ...HEADERS, ...(referer ? { Referer: referer } : {}) }, redirect: 'follow', signal: controller.signal });
    const body = (await res.text()).slice(0, MAX);
    return { status: res.status, cf: (res.headers.get('cf-mitigated') || '') || '-', type: (res.headers.get('content-type') || '').split(';')[0], body, final: res.url };
  } catch (err) {
    return { status: 0, cf: '-', type: '-', body: '', error: err.message };
  } finally { clearTimeout(timer); }
}

const iframesOf = (html) => [...new Set([...String(html).matchAll(/<iframe[^<>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]))];
const keysOf = (value) => (value && typeof value === 'object' ? Object.keys(value).join(',') : '-');
const jsonOf = (res) => { try { return JSON.parse(res.body); } catch { return null; } };
// Señales de idioma declaradas por el visor (sin inventar: se muestran tal cual).
const LANG_HINTS = /(?:latino|castellano|espa[ñn]ol|subtitulad\w*|"lang"\s*:|"language"\s*:|"audio"\s*:|"default_audio"|audio_tracks?|"label"\s*:)/gi;

async function main() {
  const fs = await import('node:fs');
  fs.mkdirSync('.probe/html', { recursive: true });
  const rows = [];
  const save = (name, body) => { try { fs.writeFileSync(`.probe/html/${name}`, scrub(body)); } catch { /* diagnóstico */ } };
  const note = (label, url, res, extra = '') => rows.push({ label, url: redact(url || res.final), status: res.status, type: res.type, cf: res.cf, bytes: res.body.length, extra });

  // 1) Ficha por API de ítem: ¿declara idiomas o servidores?
  for (const [label, id] of [['item película', 55079], ['item serie', 25228]]) {
    const url = `${BASE}/api/rest/v1/item?id=${id}`;
    const res = await get(url, `${BASE}/`);
    save(`pj3-item-${id}.json`, res.body);
    const payload = jsonOf(res) || {};
    const data = payload.data || payload;
    const hints = JSON.stringify(data).match(/"(?:languages?|audio\w*|idioma\w*|lang)"\s*:\s*("[^"]*"|\[[^\]]*\]|\{[^}]*\})/gi);
    note(`api ${label}`, url, res, `claves ${keysOf(data)}${hints ? ` · idioma: ${[...new Set(hints)].slice(0, 3).join(' ')}` : ' · sin campo de idioma'}`);
  }

  // 2) Player → iframe de Vimeos → embed.
  for (const [label, path] of [
    ['movie', `/e/movie/969681`],
    ['tv', `/e/tv/1396/1/1`],
  ]) {
    const page = await get(`${PLAYER}${path}`, `${BASE}/`);
    save(`pj3-player-${label}.html`, page.body);
    const frames = iframesOf(page.body);
    note(`player ${label}`, `${PLAYER}${path}`, page, `${frames.length} iframes [${frames.slice(0, 2).map((u) => redact(u)).join(' ')}]`);
    if (!frames.length) continue;

    const embed = await get(frames[0], `${PLAYER}/`);
    save(`pj3-vimeos-${label}.html`, embed.body);
    const hints = [...new Set([...String(embed.body).matchAll(LANG_HINTS)].map((m) => m[0].toLowerCase()))];
    const media = [...new Set([...String(embed.body).matchAll(/https?:\\?\/\\?\/[^\s"'\\<>]+?\.(?:m3u8|mp4|vtt)[^\s"'\\<>]*/gi)])]
      .map((m) => m[0].replace(/\\\//g, '/'));
    const packed = /eval\(function\(p,a,c,k,e,d\)/.test(embed.body);
    note(`embed vimeos ${label}`, frames[0], embed,
      `${hints.length ? `señales: ${hints.slice(0, 6).join(' ')}` : 'sin señales de idioma'} · ${media.length} medios [${media.slice(0, 3).map((u) => redact(u)).join(' ')}] · empaquetado: ${packed ? 'sí' : 'no'}`);
  }

  const lines = [
    '# Sonda 3 de pelisjuanita.org (idioma en el visor)',
    '',
    '| paso | url | estado | tipo | cf | bytes | notas |',
    '|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.label} | \`${r.url}\` | ${r.status} | ${r.type} | ${r.cf} | ${r.bytes} | ${r.extra || ''} |`),
    '',
    'Sonda de diagnóstico: las firmas se recortan antes de guardar; no se descarga el manifiesto.',
  ];
  fs.writeFileSync('.probe/pelisjuanita3.md', lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}

main().catch((err) => { console.error(err); process.exit(1); });
