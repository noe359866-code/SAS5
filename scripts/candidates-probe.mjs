#!/usr/bin/env node
/**
 * Sonda de candidatas (solo diagnóstico): seriesretro.com, seriesflix.life y
 * documaniatv.com.
 *
 * El escaneo genérico de `scripts/sites-probe.mjs` ya dice si hay iframes,
 * medios o players de Dooplay en el HTML. Aquí se mira lo que ese escaneo no
 * cuenta:
 *
 *   · seriesretro — marcadores del tema (data-post/data-nume, #playeroptionsul,
 *     admin-ajax) y si el HTML que ve el runner es el mismo que el navegador;
 *     si hay players, se pide el embed por `doo_player_ajax` y se prueba el
 *     extractor del addon.
 *   · seriesflix — de dónde carga los datos una SPA: scripts, configuraciones
 *     embebidas y rutas de API.
 *   · documaniatv — el runner recibe 403 de Cloudflare; se comprueba si con
 *     cabeceras de navegador cambia algo y, si responde, si publica el vídeo.
 *
 * No descarga segmentos ni imprime URLs firmadas.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BROWSER = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.6',
  'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};
const TIMEOUT = 15_000;
const MAX = 2 * 1024 * 1024;

const redact = (raw) => {
  try {
    const u = new URL(raw);
    const names = [...u.searchParams.keys()];
    return `${u.origin}${u.pathname}${names.length ? '?' + names.map((n) => `${n}=…`).join('&') : ''}`;
  } catch { return String(raw || '').slice(0, 120); }
};

async function get(url, { headers = {}, method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { method, body, redirect: 'follow', signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*;q=0.8', 'Accept-Language': 'es-ES,es;q=0.9', ...headers } });
    const text = method === 'HEAD' ? '' : (await res.text()).slice(0, MAX);
    return { status: res.status, cf: (res.headers.get('cf-mitigated') || '').toLowerCase(), type: (res.headers.get('content-type') || '').split(';')[0], body: text };
  } catch (err) {
    return { status: 0, cf: '', type: '', body: '', error: String(err?.message || err).slice(0, 60) };
  } finally { clearTimeout(timer); }
}

const count = (text, needle) => (String(text).match(new RegExp(needle, 'gi')) || []).length;

const rows = [];
const log = (step, url, res, note) => {
  const row = { step, url, status: res?.status ?? '—', bytes: res?.body?.length ?? '—', note };
  rows.push(row);
  console.log(`| ${step} | ${row.status} | ${row.bytes} | ${note} |`);
};

async function seriesretro(fs) {
  const page = 'https://seriesretro.com/peliculas/la-odisea';
  for (const [label, headers] of [['UA', {}], ['navegador', BROWSER]]) {
    const res = await get(page, { headers });
    const marks = ['data-post', 'data-nume', 'playeroptionsul', 'vimeos', 'admin-ajax', 'doo_player', '<iframe', '<video', '.m3u8', '.mp4']
      .map((mark) => `${mark}=${count(res.body, mark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))}`).join(' ');
    const ids = [...new Set([...res.body.matchAll(/(?:id|class)=["']([^"']*(?:player|server|option|video|embed|online|reprodu)[^"']*)["']/gi)].map((m) => m[1]))].slice(0, 8);
    const scripts = [...new Set([...res.body.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]))]
      .map((src) => { try { return new URL(src, page).hostname; } catch { return '?'; } });
    const excerptAt = (needle) => {
      const at = res.body.toLowerCase().indexOf(needle.toLowerCase());
      return at < 0 ? '' : res.body.slice(Math.max(0, at - 60), at + 160).replace(/\s+/g, ' ').replace(/</g, '‹').slice(0, 200);
    };
    log(`seriesretro película (${label})`, redact(page), res, `${marks} · tipo=${res.type} · ids=${ids.join(',') || '—'} · scripts=${[...new Set(scripts)].join(',') || '—'} · reproducir=«${excerptAt('Reproduc') || 'sin sección'}»`);
    if (label === 'navegador' && res.body) fs.writeFileSync('.probe/html/seriesretro-pelicula.html', res.body);

    // Players de Dooplay → embed por admin-ajax.
    const players = [...res.body.matchAll(/data-post=["']?(\d+)["']?[^>]*?data-nume=["']?(\d+)["']?/g)].slice(0, 2);
    for (const match of players) {
      const body = new URLSearchParams({ action: 'doo_player_ajax', post: match[1], nume: match[2], type: 'movie' }).toString();
      const ajax = await get('https://seriesretro.com/wp-admin/admin-ajax.php', {
        method: 'POST', body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest',
          Referer: page, Origin: 'https://seriesretro.com' },
      });
      let embed = '';
      try { embed = JSON.parse(ajax.body)?.embed_url || ''; } catch { /* no JSON */ }
      log(`seriesretro ajax ${match[2]}`, 'admin-ajax.php', ajax, embed ? `embed ${redact(embed)}` : ajax.body.slice(0, 80).replace(/\s+/g, ' '));
      if (embed) await probeEmbed(embed, page);
    }
  }

  // Serie: el episodio va en una ruta aparte.
  const serie = await get('https://seriesretro.com/series/dexter-resurrection', { headers: BROWSER });
  const seasons = [...serie.body.matchAll(/href=["']([^"']*temporada[^"']*|https:\/\/seriesretro\.com\/episodio[^"']*)["']/gi)].slice(0, 3);
  log('seriesretro serie', 'seriesretro.com/series/dexter-resurrection', serie,
    `data-post=${count(serie.body, 'data-post')} temporadas/enlaces=${seasons.length}${seasons.length ? ` (${redact(seasons[0][1])})` : ''}`);
}

async function probeEmbed(embed, referer) {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { extractorFor, extractEmbed } = require('../lib/extractors');
  const kind = extractorFor(embed) || 'desconocido';
  const page = await get(embed, { headers: { Referer: referer } });
  let verdict = `${kind} · embed ${page.status} ${page.type} ${page.body.length}B`;
  if (kind && kind !== 'opaque' && kind !== 'desconocido') {
    try {
      const out = await extractEmbed(embed, { timeoutMs: 9000, referer });
      verdict += ` → ok=${out.ok} fuentes=${out.sources?.length || 0}${out.reason ? ` (${out.reason})` : ''}`;
    } catch (err) { verdict += ` → error ${String(err?.message || err).slice(0, 40)}`; }
  }
  const media = [...new Set([...page.body.matchAll(/https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4)/gi)].map((m) => m[0]))];
  if (media.length) verdict += ` · medios=${media.length} (${[...new Set(media.map((u) => { try { return new URL(u).hostname; } catch { return '?'; } }))].join(',')})`;
  log(`  embed ${kind}`, redact(embed), page, verdict);
}

async function seriesflix(fs) {
  const home = await get('https://seriesflix.life/', { headers: BROWSER });
  const scripts = [...new Set([...home.body.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]))];
  const hosts = [...new Set(scripts.map((src) => { try { return new URL(src, 'https://seriesflix.life').hostname; } catch { return '?'; } }))];
  const marks = ['__NEXT_DATA__', '__NUXT__', 'window.__', 'apiUrl', 'api/', 'tmdb', 'graphql', '.m3u8', '.mp4']
    .map((mark) => `${mark}=${count(home.body, mark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))}`).join(' ');
  log('seriesflix portada', 'seriesflix.life/', home, `${marks} · scripts=${scripts.length} (${hosts.slice(0, 6).join(',')})`);
  fs.writeFileSync('.probe/html/seriesflix-portada.html', home.body);

  // De dónde cuelga la API: primeras pistas del bundle principal.
  for (const src of scripts.slice(0, 3)) {
    const url = new URL(src, 'https://seriesflix.life').href;
    const js = await get(url, { headers: { ...BROWSER, Accept: '*/*', Referer: 'https://seriesflix.life/' } });
    const absolute = [...new Set([...js.body.matchAll(/["'](https?:\/\/[a-z0-9.-]+\/(?:api|v\d|wp-json)[^"']{0,40})["']/gi)].map((m) => m[1]))].slice(0, 4);
    const relative = [...new Set([...js.body.matchAll(/["'](\/(?:api|v\d|wp-json)\/[^"']{0,40})["']/gi)].map((m) => m[1]))].slice(0, 6);
    const fetches = count(js.body, 'fetch\\(');
    log(`seriesflix script ${hosts[scripts.indexOf(src)] || '?'}`, redact(url), js,
      `fetch()=${fetches} · rutas absolutas: ${absolute.length ? absolute.map(redact).join(' ') : '—'} · relativas: ${relative.length ? relative.join(' ') : '—'}`);
  }

  const search = await get('https://seriesflix.life/search?q=odisea', { headers: BROWSER });
  const frames = [...new Set([...search.body.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]))];
  log('seriesflix buscador', 'seriesflix.life/search?q=odisea', search, `iframes=${frames.length}${frames.length ? ` (${frames.map((f) => { try { return new URL(f).hostname; } catch { return '?'; } }).join(',')})` : ''}`);
}

async function documaniatv(fs) {
  const page = 'https://www.documaniatv.com/social/sicarios-video_fd2ea8244.html';
  const plain = await get(page);
  log('documaniatv (UA)', redact(page), plain, `cf=${plain.cf || '-'} tipo=${plain.type}`);
  const browser = await get(page, { headers: BROWSER });
  log('documaniatv (navegador)', redact(page), browser,
    `cf=${browser.cf || '-'} tipo=${browser.type} video=${count(browser.body, '<video')} mp4=${count(browser.body, '.mp4')} m3u8=${count(browser.body, '.m3u8')} iframe=${count(browser.body, '<iframe')}`);
  if (browser.status === 200) fs.writeFileSync('.probe/html/documaniatv-video.html', browser.body);
}

async function main() {
  const fs = await import('node:fs');
  fs.mkdirSync('.probe/html', { recursive: true });
  await seriesretro(fs);
  await seriesflix(fs);
  await documaniatv(fs);
  const md = ['| Paso | HTTP | Bytes | Nota |', '|---|---|---:|---|'];
  for (const row of rows) md.push(`| ${row.step} | ${row.status} | ${row.bytes} | ${row.note} |`);
  md.push('', 'Sonda de candidatas: solo HTML/JS público; sin segmentos de vídeo.');
  fs.writeFileSync('.probe/candidates.md', `${md.join('\n')}\n`);
  console.log(`\n${md.join('\n')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
