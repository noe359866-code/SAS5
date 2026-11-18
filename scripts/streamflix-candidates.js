'use strict';

// Sonda de páginas públicas de los proveedores de StreamFlix. No forma parte
// del Worker, no ejecuta las páginas y no abre hosts desconocidos.
const { appendFileSync } = require('node:fs');
const { load } = require('cheerio');
const { providerHttp } = require('../lib/providerHttp');
const { allowedVideoUrl, extractFromEmbedHtml } = require('../lib/vimeos');
const { parseManifest } = require('../lib/hlsManifest');

const controls = [
  ['CineCalidad', 'Matrix', 'https://www.cinecalidad.am/ver-pelicula/matrix/', '#playeroptionsul li[data-option]:not(.dooplay_player_option_trailer)', 'data-option'],
  ['CineCalidad', 'Mufasa', 'https://www.cinecalidad.am/ver-pelicula/mufasa-el-rey-leon/', '#playeroptionsul li[data-option]:not(.dooplay_player_option_trailer)', 'data-option'],
  ['PelisflixHD', 'Matrix', 'https://pelisflixhd.love/pelicula/the-matrix-zgdg/', '#player li[data-server]', 'data-server'],
  ['PelisflixHD', 'Mufasa', 'https://pelisflixhd.love/pelicula/mufasa-el-rey-leon/', '#player li[data-server]', 'data-server'],
  ['SeriesFlix', 'Breaking Bad T1E2', 'https://seriesflixhd.boats/episodio/breaking-bad-zpya-1x2/', '.optns-bx .drpdn .Button.sgty[data-url]', 'data-url'],
  ['Latanime', 'Naruto T1E1', 'https://latanime.org/ver/naruto-latino-episodio-1', 'li#play-video > a.play-video', 'data-player'],
  ['TioPlus', 'Matrix (búsqueda)', 'https://tioplus.app/search/matrix'],
  ['CineHax (MovieMaster)', 'Matrix (visor)', 'https://api.moviemaster.lat/e/movie/603'],
];

function urlOf(value, parent) {
  if (!value || value.length > 8192) return null;
  try {
    const url = new URL(value, parent);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash ? url : null;
  } catch { return null; }
}

function optionUrl(raw, page, attr) {
  if (!raw || raw.length > 8192) return null;
  let value = raw;
  if (attr !== 'data-option') {
    if (!/^[A-Za-z0-9+/_=-]+$/.test(raw)) return null;
    value = Buffer.from(raw, 'base64').toString('utf8').trim();
    if (!/^https?:\/\//i.test(value)) return null;
  }
  const url = urlOf(value, page);
  if (attr === 'data-url' && url?.origin === new URL(page).origin && url.searchParams.has('url')) {
    return urlOf(url.searchParams.get('url'));
  }
  return url;
}

function resultOf(error) {
  if (error?.challenge) return `challenge (HTTP ${error.status})`;
  if (error?.status) return `HTTP ${error.status}`;
  if (error?.timeout) return 'timeout';
  if (error?.requestLimit) return 'límite de peticiones';
  return 'sin respuesta comprobable';
}

async function inspectHls(master, http) {
  try {
    const playlist = parseManifest(await http.text(master, { maxBytes: 512 * 1024, timeoutMs: 3000 }));
    if (!playlist) return 'HLS inválido';
    const variant = playlist.variants[0] ? urlOf(playlist.variants[0].uri, master) : null;
    if (playlist.variants.length && (!variant || !allowedVideoUrl(variant.href) || !/\.m3u8$/i.test(variant.pathname))) return 'variante fuera del alcance';
    const media = variant ? parseManifest(await http.text(variant.href, { maxBytes: 512 * 1024, timeoutMs: 3000 })) : playlist;
    const segment = urlOf(media?.segment, variant?.href || master);
    if (!segment || !allowedVideoUrl(segment.href) || !/\.(?:ts|m4s|mp4)$/i.test(segment.pathname)) return 'HLS válido, sin segmento sondeable';
    const response = await fetch(segment, { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(3000), redirect: 'manual' });
    await response.body?.cancel().catch(() => {});
    return `HLS válido, segmento HTTP ${response.status}`;
  } catch (error) { return `HLS: ${resultOf(error)}`; }
}

async function probe([provider, title, page, selector, attr]) {
  const http = providerHttp(8000, 4);
  try {
    const html = await http.text(page, { headers: { Accept: 'text/html' }, maxBytes: 2 * 1024 * 1024, timeoutMs: 4500 });
    if (/<title>\s*just a moment|cf-browser-verification|<title>\s*attention required/i.test(html)) {
      return { provider, title, state: 'challenge', players: [], media: 'no sondeado' };
    }
    const $ = load(html);
    const options = selector ? $(selector).toArray().slice(0, 12).map((el) => optionUrl($(el).attr(attr), page, attr)).filter(Boolean) : [];
    const players = [...new Set(options.map((url) => `${url.hostname} (${/\.(?:m3u8|mp4)$/i.test(url.pathname) ? 'directo' : 'visor'})`))];
    let media = 'no sondeado';
    const vimeos = options.find((url) => allowedVideoUrl(url.href));
    if (vimeos) {
      try {
        const master = /\.m3u8$/i.test(vimeos.pathname) ? vimeos.href
          : extractFromEmbedHtml(await http.text(vimeos.href, { maxBytes: 1024 * 1024, timeoutMs: 3000, headers: { Referer: page } })).hls.find((url) => allowedVideoUrl(url));
        media = master ? await inspectHls(master, http) : 'visor Vimeos sin HLS';
      } catch (error) { media = `visor: ${resultOf(error)}`; }
    }
    const state = selector ? 'ficha disponible' : /window\.PM_UI\s*=/.test(html) ? 'visor con estado público' : 'entrada disponible';
    return { provider, title, state, players, media };
  } catch (error) { return { provider, title, state: resultOf(error), players: [], media: 'no sondeado' }; }
}

async function main() {
  // Limitar concurrencia y no repetir un rechazo.
  const rows = [];
  for (const control of controls) rows.push(await probe(control));
  for (const { provider, title, state, players, media } of rows) console.log(`${provider} / ${title}: ${state}; ${players.join(', ') || 'sin URL de reproducción visible'}; ${media}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    '### Candidatos de StreamFlix (Node)', '', '| Fuente | Control | Entrada | Opciones | Medio |', '|---|---|---|---|---|',
    ...rows.map(({ provider, title, state, players, media }) => `| ${provider} | ${title} | ${state} | ${players.join(', ') || '—'} | ${media} |`), '',
    'No se consulta ni se despliega el Worker de producción. No se guardan URLs firmadas.', '',
  ].join('\n'));
}

if (require.main === module) main().catch(() => { console.error('No se pudo completar la sonda de candidatos'); process.exitCode = 1; });
