'use strict';

// Verifica los adaptadores reales e inventaría la estructura pública de
// fichas conocidas. No registra enlaces firmados ni ejecuta código remoto.
const { load } = require('cheerio');
const { runProviders } = require('../lib/streams');
const { fetchText } = require('../lib/http');
const { annotate } = require('./providers-live');

const controls = {
  flixlatam: [
    { title: 'Matrix', year: '1999', mediaType: 'movie', page: 'https://flixlatam.com/pelicula/matrix' },
    { title: 'En Ruta de Escape', year: '2026', mediaType: 'movie', page: 'https://flixlatam.com/pelicula/en-ruta-de-escape-N6sitT' },
    { title: 'Breaking Bad', year: '2008', mediaType: 'series', season: 1, episode: 2, page: 'https://flixlatam.com/serie/breaking-bad' },
  ],
  cuevana3: [
    { title: 'Matrix', year: '1999', mediaType: 'movie', page: 'https://cuevanas3.pro/peliculas/matrix-1999/' },
    { title: 'El Efecto Mariposa', year: '2004', mediaType: 'movie', page: 'https://cuevanas3.pro/peliculas/el-efecto-mariposa-2004/' },
    { title: 'Breaking Bad', year: '2008', mediaType: 'series', season: 1, episode: 2, page: 'https://cuevanas3.pro/episodio/breaking-bad-temporada-1-episodio-2/' },
  ],
};

const embedHosts = new Set(['embed69.org', 'uqload.vc', 'uqload.cx', 'uqload.is']);
const inspected = new Set();
const frames = 'iframe[src],iframe[data-src]';
const mediaExt = /\.(?:m3u8|mp4|m4v|webm)$/i;
const problem = (err) => err.challenge ? 'challenge' : err.status ? `HTTP ${err.status}` : err.timeout ? 'timeout' : 'error de red o formato';
const list = (items, max = 9) => [...new Set(items)].slice(0, max).join(', ') || '—';

function urlOf(raw, page) {
  if (!raw || !/^(?:https:\/\/|\/)/i.test(raw)) return null;
  try {
    const url = new URL(raw, page);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url : null;
  } catch { return null; }
}

function urlShape(raw, page) {
  const parsed = urlOf(raw, page);
  if (parsed) return `${parsed.hostname}${mediaExt.exec(parsed.pathname)?.[0] || ''}`;
  if (raw && raw.length < 2048 && /^[a-z0-9+/]+={0,2}$/i.test(raw)) {
    const decoded = urlOf(Buffer.from(raw, 'base64').toString('utf8'), page);
    if (decoded) return `base64:${decoded.hostname}${mediaExt.exec(decoded.pathname)?.[0] || ''}`;
  }
  return !raw ? 'vacío' : String(raw).startsWith('#') ? 'ancla' : 'sin URL directa';
}

function cuevanaShape($, page) {
  const inline = $('script:not([src])').toArray().map((el) => $(el).html() || '').join('\n').replace(/\\\//g, '/');
  const endpoints = ['fastApi', 'apiUrl'].map((key) => {
    const raw = new RegExp(`["']?${key}["']?\\s*:\\s*["']([^"']+)["']`).exec(inline)?.[1];
    const url = urlOf(raw, page);
    if (!url) return null;
    const path = /^\/(?:[a-z_-]{1,24}\/){0,5}(?:v\d{1,2}\/?)?$/i.test(url.pathname + (url.pathname.endsWith('/') ? '' : '/')) ? url.pathname : '';
    return `${key}=${url.hostname}${path}`;
  });
  const links = $('a[href]').toArray().filter((el) => /\/(?:peliculas?|series?|episodio)\//i.test($(el).attr('href'))).length;
  return `enlaces de catálogo=${links}; ${list(endpoints.filter(Boolean))}`;
}

function playerShape($, page, episode) {
  const inline = $('script:not([src])').toArray().map((el) => $(el).html() || '').join('\n').replace(/\\\//g, '/');
  const signals = [...inline.matchAll(/\b([a-z_][a-z0-9_]{0,36})["']?\s*(?:=|:)\s*(?=[\[{'"`])/gi)]
    .map((m) => m[1]).filter((name) => /episode|season|player|embed|server|dataLink|source|video|ajax/i.test(name));
  const literals = [...inline.matchAll(/['"]((?:https:\/\/|\/)[^'"<>\s\\]{2,2048})['"]/g)].map((m) => urlOf(m[1], page))
    .filter((url) => url && mediaExt.test(url.pathname)).map((url) => urlShape(url.href, page));
  const scripts = $('script[src]').toArray().map((el) => $(el).attr('src')).map((raw) => {
    try {
      const url = new URL(raw, page);
      return url.origin === new URL(page).origin && /^\/[a-z0-9_./-]{1,160}\.js$/i.test(url.pathname) ? url.pathname : null;
    } catch { return null; }
  }).filter(Boolean);
  const attrs = (sel, cap) => $(sel).toArray().slice(0, cap).map((el) => {
    const names = Object.keys(el.attribs).filter((name) => /^(?:data-(?:play|video|embed|url|src|source|server|lang|episode|season|id)[a-z0-9-]*|src|onclick)$/i.test(name));
    if (!names.length) return null;
    const readable = names.map((name) => /^(?:data-)?(?:src|url|embed|video|file)$/.test(name) ? `${name}:${urlShape($(el).attr(name), page)}` : name);
    const classes = ($(el).attr('class') || '').split(/\s+/).filter((cls) => /^(?:[a-z_-]*)(?:player|server|embed|frame|episode|tab)(?:[a-z_-]*)$/i.test(cls));
    return `${el.name}${classes.length ? `.${classes.slice(0, 3).join('.')}` : ''}[${readable.join(',')}]`;
  }).filter(Boolean);
  const vids = $('video[src],video[data-src],video source[src],video source[data-src]').toArray().map((el) => urlShape($(el).attr('data-src') || $(el).attr('src'), page));
  const playerAttrs = attrs(`${frames},[data-url],[data-video],[data-server],[data-embed],[data-player],[data-source],.pframe [onclick],[class*="server"] [onclick]`, 28);
  const hash = episode && `#s${episode.season}-e${episode.episode}`;
  const link = hash && $(`a[href$="${hash}"]`);
  const row = link && link.first().closest('li');
  const names = (el) => (el?.toArray() || []).flatMap((node) => Object.keys(node.attribs)).filter((name) => /^data-[a-z0-9-]+$|^onclick$/.test(name));
  const ep = link && `; anclas exactas=${link.length}; atributos de fila=${list([...names(link), ...names(row), ...names(row.find('button,a,iframe'))])}; panel=${$(hash).length}`;
  return `vídeo=${list(vids)}; literales=${list(literals)}; atributos=${list(playerAttrs)}; JS=${list(signals)}; scripts propios=${list(scripts, 6)}${ep || ''}`;
}

async function inspectEmbed(raw, page) {
  const frame = urlOf(raw, page);
  if (!frame || !embedHosts.has(frame.hostname) || inspected.has(frame.hostname)) return null;
  inspected.add(frame.hostname);
  try {
    const html = await fetchText(frame.href, { redirect: 'manual', headers: { Referer: new URL(page).origin + '/' }, timeoutMs: 3500, maxBytes: 384 * 1024 });
    if (/Anubis|making sure you.re not a bot|just a moment/i.test(html)) return `${frame.hostname}: challenge`;
    if (/file (?:is no longer available|was removed|not found|expired)|expired or has been deleted/i.test(html)) return `${frame.hostname}: archivo no disponible`;
    return `${frame.hostname}: ${playerShape(load(html), frame.href)}`;
  } catch (err) { return `${frame.hostname}: ${problem(err)}`; }
}

async function probe(key, fixture) {
  const report = {};
  const hits = await runProviders([key], fixture.title, fixture, fixture.title, report, undefined, { ignorePause: true });
  const entry = report[key];
  const state = `${entry.reason || entry.skipped || 'candidatos'}; aceptados=${entry.accepted || 0}; HTTP ${entry.status || '—'}${hits.length ? `; ${list(hits.map((hit) => hit.verification || hit.quality || 'medio directo'))}` : ''}`;
  if (entry.reason === 'challenge' || entry.reason === 'access-denied') return state;
  try {
    const html = await fetchText(fixture.page, { redirect: 'manual', timeoutMs: 7000, maxBytes: 2 * 1024 * 1024 });
    const $ = load(html);
    const embeds = await Promise.all($(frames).toArray().slice(0, 6).map((el) => inspectEmbed($(el).attr('data-src') || $(el).attr('src'), fixture.page)));
    const shape = key === 'cuevana3' ? `${cuevanaShape($, fixture.page)}; ${cuevanaShape(load(await fetchText('https://cuevanas3.pro/search/' + encodeURIComponent(fixture.title.toLowerCase()) + '/', { redirect: 'manual', timeoutMs: 4000, maxBytes: 2 * 1024 * 1024 })), fixture.page)} en búsqueda\n` : '';
    return `${state}\n${shape}${playerShape($, fixture.page, fixture.season && fixture)}${embeds.some(Boolean) ? `\n${embeds.filter(Boolean).join('\n')}` : ''}`;
  } catch (err) { return `${state}; visor: ${problem(err)}`; }
}

async function main(key) {
  if (!Object.hasOwn(controls, key)) throw new Error('Usa flixlatam o cuevana3');
  for (const fixture of controls[key]) {
    const title = `${key} / ${fixture.title}${fixture.season ? ` T${fixture.season}E${fixture.episode}` : ''}`;
    annotate(title, await probe(key, fixture));
  }
}

main(process.argv[2]).catch((error) => { console.error(error instanceof TypeError ? 'Falló la sonda de proveedores' : 'No se completó la sonda enfocada'); process.exitCode = 1; });
