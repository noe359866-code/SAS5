#!/usr/bin/env node
/**
 * Sonda de poseidonhd2.co (solo diagnóstico).
 *
 * El sitio es una aplicación Next.js: el HTML público trae `__NEXT_DATA__` con
 * el JSON ya resuelto en el servidor, así que no hace falta ejecutar JS.
 *
 *   1. Ficha  `/pelicula/<tmdb>/<slug>` → `pageProps.thisMovie.videos` con
 *      grupos `latino` / `spanish` / `english` y, en cada uno, pares
 *      `{cyberlocker, result, quality}`.
 *   2. Episodio `/serie/<tmdb>/<slug>/temporada/<N>/episodio/<M>` →
 *      `pageProps.episode.videos`.
 *   3. `result` es un salto propio (`player.poseidonhd2.co/player.php?h=…`):
 *      aquí se comprueba si redirige al visor real, si publica un `.m3u8` en su
 *      HTML o si el medio solo aparece al ejecutar JS.
 *   4. Buscador `/search?q=` (SSR) y si el slug importa para la ficha.
 *
 * No imprime URLs firmadas completas ni descarga segmentos.
 */

const BASE = 'https://www.poseidonhd2.co';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const TIMEOUT = 15_000;
const MAX = 2 * 1024 * 1024;

const redact = (raw) => {
  try {
    const u = new URL(raw);
    const names = [...u.searchParams.keys()];
    return `${u.origin}${u.pathname}${names.length ? '?' + names.map((n) => `${n}=…`).join('&') : ''}`;
  } catch { return String(raw || '').slice(0, 160); }
};

async function get(url, { referer, manual } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: { ...HEADERS, ...(referer ? { Referer: referer } : {}) },
      redirect: manual ? 'manual' : 'follow',
      signal: controller.signal,
    });
    const body = manual ? '' : (await res.text()).slice(0, MAX);
    return {
      status: res.status,
      type: (res.headers.get('content-type') || '').split(';')[0],
      location: res.headers.get('location') || '',
      type2: (res.headers.get('location') || ''),
      body,
    };
  } catch (err) {
    return { status: 0, type: '-', location: '', body: '', error: err.message };
  } finally { clearTimeout(timer); }
}

/** `__NEXT_DATA__` de una página de Next.js. */
function nextData(html) {
  const match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(String(html || ''));
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

const iframesOf = (html) => [...new Set(
  [...String(html).matchAll(/<iframe[^<>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]),
)];

const mediaOf = (html) => [...new Set(
  [...String(html).matchAll(/https?:\\?\/\\?\/[^\s"'\\<>]+?(?:\.m3u8|\.mp4)[^\s"'\\<>]*/gi)]
    .map((m) => m[0].replace(/\\\//g, '/')),
)];

const hostOf = (raw) => { try { return new URL(raw).hostname; } catch { return '?'; } };

const rows = [];
const log = (row) => { rows.push(row); console.log(`| ${row.step} | ${row.status} | ${row.type || '-'} | ${row.bytes ?? '-'} | ${row.note} |`); };

async function main() {
  const fs = await import('node:fs');
  fs.mkdirSync('.probe/html', { recursive: true });

  // 1) Buscador: películas y series, con su TMDbId y el slug canónico.
  for (const term of ['odisea', 'policias de chicago', 'visionquest']) {
    const url = `${BASE}/search?q=${encodeURIComponent(term)}`;
    const res = await get(url);
    const data = nextData(res.body);
    const pp = data?.props?.pageProps || {};
    const shape = Object.entries(pp)
      .filter(([, value]) => Array.isArray(value))
      .map(([key, value]) => `${key}=${value.length}`)
      .join(' ');
    const first = Object.values(pp).find((value) => Array.isArray(value) && value.length)?.[0];
    log({ step: `search «${term}»`, url: redact(url), status: res.status, type: res.type, bytes: res.body.length,
      note: `${shape || 'sin listas'}${first ? ` · primero: TMDbId=${first.TMDbId} slug=${first.url?.slug}` : ''}` });
    if (res.status === 200) fs.writeFileSync(`.probe/html/pose-search-${term.replace(/[^a-z0-9]+/gi, '-')}.html`, res.body);
  }

  // 2) ¿Importa el slug de la ficha?
  for (const slug of ['la-odisea', 'slug-inventado']) {
    const url = `${BASE}/pelicula/1368337/${slug}`;
    const res = await get(url);
    log({ step: `pelicula slug=${slug}`, url: redact(url), status: res.status, type: res.type, bytes: res.body.length,
      note: res.status === 200 ? 'sirve la ficha con cualquier slug' : 'el slug tiene que ser el real' });
  }

  // 3) Película: vídeos declarados y qué hay detrás de player.php.
  const movieUrl = `${BASE}/pelicula/1368337/la-odisea`;
  const movie = await get(movieUrl);
  const movieData = nextData(movie.body);
  const thisMovie = movieData?.props?.pageProps?.thisMovie;
  const videos = thisMovie?.videos || {};
  const langs = Object.entries(videos).map(([key, value]) => `${key}=${Array.isArray(value) ? value.length : '?'}`).join(' ');
  log({ step: 'pelicula NEXT_DATA', url: redact(movieUrl), status: movie.status, type: movie.type, bytes: movie.body.length,
    note: `thisMovie=${thisMovie ? 'sí' : 'no'} · videos ${langs}` });
  if (movie.status === 200) fs.writeFileSync('.probe/html/pose-movie.html', movie.body);

  const sample = (videos.latino || []).slice(0, 3);
  for (const item of sample) {
    const target = item.result;
    const direct = await get(target, { referer: movieUrl, manual: true });
    const followed = await get(target, { referer: movieUrl });
    const frames = iframesOf(followed.body);
    const media = mediaOf(followed.body);
    log({ step: `player ${item.cyberlocker}`, url: redact(target), status: followed.status, type: followed.type,
      bytes: followed.body.length,
      note: `manual=${direct.status}${direct.location ? ` → ${redact(direct.location)}` : ''} · iframes=${frames.length}${frames.length ? ` (${[...new Set(frames.map(hostOf))].join(',')})` : ''} · medios=${media.length}${media.length ? ` (${[...new Set(media.map(hostOf))].join(',')})` : ''}` });
    if (followed.status === 200) {
      fs.writeFileSync(`.probe/html/pose-player-${item.cyberlocker}.html`, followed.body);
    }
  }

  // 4) Episodio de serie: misma estructura de vídeos.
  const epUrl = `${BASE}/serie/58841/policias-de-chicago/temporada/13/episodio/21`;
  const ep = await get(epUrl);
  const epData = nextData(ep.body);
  const episode = epData?.props?.pageProps?.episode;
  const epVideos = episode?.videos || {};
  log({ step: 'episodio NEXT_DATA', url: redact(epUrl), status: ep.status, type: ep.type, bytes: ep.body.length,
    note: `episode=${episode ? 'sí' : 'no'} · videos ${Object.entries(epVideos).map(([k, v]) => `${k}=${Array.isArray(v) ? v.length : '?'}`).join(' ')}` });
  if (ep.status === 200) fs.writeFileSync('.probe/html/pose-episode.html', ep.body);

  const epFirst = Object.values(epVideos).find((value) => Array.isArray(value) && value.length)?.[0];
  if (epFirst) {
    const followed = await get(epFirst.result, { referer: epUrl });
    log({ step: `player episodio ${epFirst.cyberlocker}`, url: redact(epFirst.result), status: followed.status,
      type: followed.type, bytes: followed.body.length,
      note: `iframes=${iframesOf(followed.body).length} medios=${mediaOf(followed.body).length}` });
  }

  // 5) Muestreo de repuestos: ¿alguna ficha usa un visor que sí se pueda
  //    extraer, o publica un medio directo? Se recorren las listas de la
  //    portada y se cuentan los `cyberlocker` distintos.
  const home = await get(BASE);
  const homeData = nextData(home.body);
  const slugs = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.url?.slug) slugs.push(node.url.slug);
    for (const value of Object.values(node)) walk(value);
  };
  walk(homeData?.props?.pageProps || {});
  const unique = [...new Set(slugs)];
  const lockers = new Map();
  const directMedia = [];
  // Los slugs vienen como `movies/<id>/<nombre>` o `series/<id>/<nombre>`; la
  // ruta real es `/pelicula/…` o `/serie/…`.
  const pageUrl = (slug) => {
    const parts = String(slug).split('/');
    if (parts.length < 3) return '';
    const kind = parts[0] === 'movies' ? 'pelicula' : parts[0] === 'series' ? 'serie' : null;
    return kind ? `${BASE}/${kind}/${parts[1]}/${parts.slice(2).join('/')}` : '';
  };
  for (const slug of unique.slice(0, 10)) {
    const page = await get(pageUrl(slug));
    const data = nextData(page.body);
    const node = data?.props?.pageProps?.thisMovie || data?.props?.pageProps?.episode
      || data?.props?.pageProps?.serie || null;
    const groups = node?.videos || {};
    for (const [language, list] of Object.entries(groups)) {
      for (const item of Array.isArray(list) ? list : []) {
        if (!item?.cyberlocker) continue;
        const entry = lockers.get(item.cyberlocker) || { count: 0, languages: new Set(), host: '' };
        entry.count += 1;
        entry.languages.add(language);
        if (!entry.host) { try { entry.host = new URL(item.result).hostname; } catch { entry.host = '?'; } }
        lockers.set(item.cyberlocker, entry);
        if (/\/(?:[^/]*\.)?(?:m3u8|mp4)(?:$|[?#])/.test(String(item.result))) directMedia.push(`${slug} ${item.cyberlocker}`);
      }
    }
  }
  log({ step: 'muestreo de repuestos', url: `${BASE}/`, status: home.status, type: home.type, bytes: home.body.length,
    note: `${unique.length} fichas en portada, 10 recorridas · visores: ${[...lockers.entries()].map(([k, v]) => `${k}(${v.count}${v.host && v.host !== 'player.poseidonhd2.co' ? `→${v.host}` : ''})`).join(', ') || 'ninguno'} · medios directos: ${directMedia.length}` });

  // 6) ¿Se puede extraer algo? Para cada visor distinto se resuelve el salto
  //    propio y se prueba el extractor del addon; Doodstream se prueba aparte
  //    (pass_md5 -> MP4) porque aún no tiene extractor.
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { extractorFor } = require('../lib/extractors');
  const samples = new Map();
  for (const slug of unique.slice(0, 10)) {
    const page = await get(pageUrl(slug));
    const data = nextData(page.body);
    const node = data?.props?.pageProps?.thisMovie || data?.props?.pageProps?.episode
      || data?.props?.pageProps?.serie || null;
    for (const list of Object.values(node?.videos || {})) {
      for (const item of Array.isArray(list) ? list : []) {
        if (item?.cyberlocker && !samples.has(item.cyberlocker)) samples.set(item.cyberlocker, item.result);
      }
    }
  }
  const found = (html) => [...new Set(String(html).matchAll(/https?:\/\/[^"'<> ]{10,160}/g)
    .map((m) => m[0]).filter((url) => !/poseidonhd2|yandex|cloudflare|adangle|agl003|adme2|doo\.lat|google|gstatic/.test(url)))][0] || '';
  for (const [locker, result] of samples) {
    const jump = await get(result, { referer: `${BASE}/` });
    const embed = found(jump.body);
    const kind = embed ? extractorFor(embed) : 'sin-enlace';
    let verdict = `${kind || 'desconocido'}`;
    if (!embed) verdict = 'el player.php no publica el destino';
    else if (kind && kind !== 'opaque') {
      // El visor puede exigir un Referer concreto: se prueban los tres que
      // tienen sentido (ninguno, el del salto propio y el de la ficha).
      const { extractEmbed } = require('../lib/extractors');
      const referers = [null, 'https://player.poseidonhd2.co/', `${BASE}/`];
      const results = [];
      for (const referer of referers) {
        try {
          const out = await extractEmbed(embed, { timeoutMs: 9000, ...(referer ? { referer } : {}) });
          results.push(`${referer ? new URL(referer).hostname : 'sin-referer'}=${out.ok ? `ok(${out.sources.length})` : (out.reason || 'no')}`);
        } catch (err) {
          results.push(`${referer ? new URL(referer).hostname : 'sin-referer'}=error:${String(err?.message || err).slice(0, 30)}`);
        }
      }
      verdict = `${kind} → ${results.join(' ')}`;
    } else if (kind === 'opaque') verdict = 'opaque (JS / Cloudflare)';
    else if (/(?:^|\.)doodstream\./.test(hostOf(embed))) {
      const pass = /\/pass_md5\/[^"'\\ ]+/i.exec(jump.body);
      const emb = await get(embed, { referer: `${BASE}/` });
      verdict = `doodstream sin extractor · embed ${emb.status} ${emb.type} ${emb.body.length}B`;
      if (pass) {
        const api = await get(`${new URL(embed).origin}${pass[0]}`, { referer: embed });
        const looksUrl = /^https?:\/\//.test(api.body.trim());
        verdict += ` · pass_md5 ${api.status} ${api.type} ${looksUrl ? 'devuelve URL base' : 'no es URL'}`;
      } else verdict += ' · sin pass_md5 en el embed';
    }
    log({ step: `extracción ${locker}`, url: redact(result), status: jump.status, type: jump.type, bytes: jump.body.length,
      note: `${embed ? redact(embed) : '—'} · ${verdict}` });
  }

  // Resumen en markdown para poder leerlo desde la rama.
  const md = ['| Paso | HTTP | Tipo | Bytes | Nota |', '|---|---|---|---:|---|'];
  for (const row of rows) md.push(`| ${row.step} | ${row.status} | ${row.type || '-'} | ${row.bytes ?? '-'} | ${row.note} |`);
  md.push('', 'Sonda de poseidonhd2: solo HTML y JSON del sitio; sin segmentos de vídeo.');
  fs.writeFileSync('.probe/poseidonhd2.md', `${md.join('\n')}\n`);
  console.log(`\n${md.join('\n')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
