#!/usr/bin/env node
/**
 * Sonda de fuegocine.com (solo diagnóstico).
 *
 * El sitio no es WordPress: usa `/movies/details/<slug>/<id>` para fichas y
 * `/movies/watch/<slug>/<id>` para reproducir. La ficha solo trae el tráiler
 * (FWDEVPlayer con un `videoSource` en base64 que es YouTube); los servidores
 * reales aparecen en la página de reproducción.
 *
 * Esta sonda comprueba, con peticiones reales:
 *   1. iframes de `/movies/watch/...` y de un episodio de serie
 *      (`/shows/<serie>/<SSxEE-titulo>/<id>`).
 *   2. Qué publica cada visor (`unlimplay`, `abyssplayer`, `videro`): si el
 *      medio está en el HTML o hay que ejecutar JS.
 *   3. La forma de la URL del manifiesto (sin query firmada).
 *
 * No descarga segmentos ni imprime URLs firmadas completas.
 */

const BASE = 'https://fuegocine.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const TIMEOUT = 15_000;
const MAX = 1024 * 1024;

const redact = (raw) => {
  try {
    const u = new URL(raw);
    const names = [...u.searchParams.keys()];
    return `${u.origin}${u.pathname}${names.length ? '?' + names.map((n) => `${n}=…`).join('&') : ''}`;
  } catch { return String(raw || '').slice(0, 160); }
};

async function get(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: { ...HEADERS, ...(referer ? { Referer: referer } : {}) },
      redirect: 'follow',
      signal: controller.signal,
    });
    const body = (await res.text()).slice(0, MAX);
    return { status: res.status, cf: (res.headers.get('cf-mitigated') || '') || '-', type: (res.headers.get('content-type') || '').split(';')[0], body };
  } catch (err) {
    return { status: 0, cf: '-', type: '-', body: '', error: err.message };
  } finally { clearTimeout(timer); }
}

const iframesOf = (html) => [...new Set(
  [...String(html).matchAll(/<iframe[^<>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]),
)];

// Medios citados en el HTML o dentro de un empaquetador: se listan recortados.
const mediaOf = (html) => [...new Set(
  [...String(html).matchAll(/https?:\\?\/\\?\/[^\s"'\\<>]+?(?:\.m3u8|\.mp4|cps\.php)[^\s"'\\<>]*/gi)]
    .map((m) => m[0].replace(/\\\//g, '/')),
)];

const PAGES = [
  { label: 'película', url: `${BASE}/movies/watch/la-odisea/227` },
  { label: 'episodio', url: `${BASE}/shows/visionquest/01x01-sin-ataduras/49` },
];

async function main() {
  const rows = [];
  const fs = await import('node:fs');
  fs.mkdirSync('.probe/html', { recursive: true });

  for (const page of PAGES) {
    const res = await get(page.url);
    const frames = res.status === 200 ? iframesOf(res.body) : [];
    console.log(`\n### ${page.label} ${page.url} -> ${res.status} ${res.type} ${res.body.length}B, ${frames.length} iframes`);
    rows.push({ step: `${page.label}`, url: redact(page.url), status: res.status, cf: res.cf, type: res.type, bytes: res.body.length, note: `${frames.length} iframes: ${[...new Set(frames.map((f) => { try { return new URL(f).hostname; } catch { return '?'; } }))].join(',')}` });
    if (res.status === 200) fs.writeFileSync(`.probe/html/fuego-${page.label}.html`, res.body);

    for (const frame of frames.slice(0, 4)) {
      const host = (() => { try { return new URL(frame).hostname; } catch { return '?'; } })();
      const view = await get(frame, page.url);
      const media = view.status === 200 ? mediaOf(view.body) : [];
      console.log(`  · ${host} -> ${view.status}${view.cf !== '-' ? ` cf=${view.cf}` : ''} ${view.type} ${view.body.length}B, ${media.length} medios`);
      for (const url of media.slice(0, 4)) console.log(`      ${redact(url)}`);
      // Señales de que el medio exige ejecutar JS.
      const packed = /eval\(function\(p,a,c,k,e,d\)/.test(view.body);
      const jwOrHls = /jwplayer|hls\.js|videojs|sources\s*:|file\s*:/.test(view.body);
      if (packed || jwOrHls) console.log(`      señales: packed=${packed} playerJs=${jwOrHls}`);
      rows.push({ step: `  ${page.label}·${host}`, url: redact(frame), status: view.status, cf: view.cf, type: view.type, bytes: view.body.length, note: `${media.length} medios${packed ? ' (empaquetado)' : ''}` });
      if (view.status === 200) {
        const name = `${page.label}-${host}`.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 60);
        fs.writeFileSync(`.probe/html/fuego-embed-${name}.html`, view.body);
      }
    }
  }

  const md = ['| Paso | HTTP | CF | Tipo | Bytes | Nota |', '|---|---|---|---|---|---|'];
  for (const row of rows) md.push(`| ${row.step} | ${row.status} | ${row.cf} | ${row.type} | ${row.bytes} | ${String(row.note).replace(/\|/g, '/')} |`);
  md.push('', 'Sonda de fuegocine: solo HTML de la página de reproducción y del visor; sin segmentos ni URLs firmadas.');
  fs.writeFileSync('.probe/fuegocine.md', md.join('\n') + '\n');
}

main().catch((err) => { console.error(err); process.exit(1); });
