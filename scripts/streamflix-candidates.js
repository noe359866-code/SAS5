'use strict';

// Sonda Node de páginas públicas. No ejecuta JavaScript de terceros, no se
// autentica, no sigue redirecciones ni guarda URLs firmadas o contenido.
const { appendFileSync } = require('node:fs');
const { load } = require('cheerio');
const { providerHttp } = require('../lib/providerHttp');
const { allowedVideoUrl, extractFromEmbedHtml, unpackPacked } = require('../lib/vimeos');
const { parseManifest } = require('../lib/hlsManifest');
const { isDirectMedia } = require('../lib/directMedia');
const { checkPlayback, checkSegment } = require('./worker-streams-live');

const controls = [
  ['CineCalidad', 'Matrix', 'https://www.cinecalidad.am/ver-pelicula/matrix/', '#playeroptionsul li[data-option]:not(.dooplay_player_option_trailer)', 'data-option'],
  ['CineCalidad', 'Mufasa', 'https://www.cinecalidad.am/ver-pelicula/mufasa-el-rey-leon/', '#playeroptionsul li[data-option]:not(.dooplay_player_option_trailer)', 'data-option'],
  ['PelisflixHD', 'Matrix', 'https://pelisflixhd.love/pelicula/the-matrix-zgdg/', '#player li[data-server]', 'data-server'],
  ['PelisflixHD', 'Mufasa', 'https://pelisflixhd.love/pelicula/mufasa-el-rey-leon/', '#player li[data-server]', 'data-server'],
  ['SeriesFlix', 'Breaking Bad T1E2', 'https://seriesflixhd.boats/episodio/breaking-bad-zpya-1x2/', '.optns-bx .drpdn .Button.sgty[data-url]', 'data-url'],
  ['Latanime', 'Naruto capítulo 1 (Latino)', 'https://latanime.org/ver/naruto-latino-episodio-1', 'li#play-video > a.play-video', 'data-player', 'latino'],
  ['Latanime', 'Naruto capítulo 1 (Castellano)', 'https://latanime.org/ver/naruto-castellano-episodio-1', 'li#play-video > a.play-video', 'data-player', 'castellano'],
  ['LaCartoons', 'Ben 10 T1E1', 'https://www.lacartoons.com/serie/capitulo/16654?t=1', 'iframe[src]', 'src', 'latino'],
  ['TioPlus', 'Matrix (búsqueda)', 'https://tioplus.app/search/matrix'],
  ['CineHax (MovieMaster)', 'Matrix (visor)', 'https://api.moviemaster.lat/e/movie/603'],
];
const playerHosts = new Set(['nupload.my', 'www.mp4upload.com', 'luluvdo.com']);
const WEB = 'https://web.stremio.com';

function urlOf(value, parent) {
  if (!value || value.length > 8192) return null;
  try {
    const url = new URL(value, parent);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash ? url : null;
  } catch { return null; }
}

function optionUrl(raw, page, attr) {
  if (!raw || raw.length > 8192) return null;
  let value = raw.trim();
  if (attr.startsWith('data-') && attr !== 'data-option') {
    if (!/^[A-Za-z0-9+/_=-]+$/.test(value)) return null;
    value = Buffer.from(value, 'base64').toString('utf8').trim();
    if (!/^https?:\/\//i.test(value)) return null;
  }
  const url = urlOf(value, page);
  if (url && (url.origin === new URL(page).origin || url.hostname === 'nupload.my') && url.searchParams.has('url')) {
    return urlOf(url.searchParams.get('url')) || url;
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

function isChallenge(html) {
  return /<title>\s*just a moment|cf-browser-verification|<title>\s*attention required/i.test(html);
}

function optionAudio(label) {
  if (/subtit|\bvose\b|\btr[aá]iler\b/i.test(label)) return '';
  if (/\blatino\b|audio\s*latino/i.test(label) || /\dLATINO/i.test(label)) return 'latino';
  if (/castellano/i.test(label)) return 'castellano';
  return '';
}

async function sampleOtherMedia(raw, player, http) {
  // Solo medios en los orígenes conocidos. Anotar los demás, no abrirlos.
  const url = urlOf(raw, player);
  if (!url || !isDirectMedia(url.href) || !/\.(?:m3u8|mp4)$/i.test(url.pathname)) return 'sin HLS/MP4 público en el visor';
  if (allowedVideoUrl(url.href) && /\.m3u8$/i.test(url.pathname)) return (await checkPlayback(fetch, url.href, new URL('https://addon.invalid').origin)).state;
  if (url.origin !== player.origin || !playerHosts.has(url.hostname)) return `medio en ${url.hostname}, sin sondear (origen no validado)`;
  if (/\.mp4$/i.test(url.pathname)) return (await checkSegment(fetch, url.href)).state;
  const text = await http.text(url.href, { maxBytes: 512 * 1024, timeoutMs: 2500, headers: { Origin: WEB } });
  return parseManifest(text) ? 'HLS válido; falta comprobar segmentos' : 'manifiesto inválido';
}

async function sampleOption(url, http) {
  try {
    if (isDirectMedia(url.href)) return await sampleOtherMedia(url.href, url, http);
    const html = await http.text(url.href, { maxBytes: 1024 * 1024, timeoutMs: 3000 });
    if (isChallenge(html)) return 'challenge del visor';
    if (allowedVideoUrl(url.href)) {
      const master = extractFromEmbedHtml(html).hls.find((raw) => allowedVideoUrl(raw));
      return master ? await sampleOtherMedia(master, url, http) : 'visor Vimeos sin HLS público';
    }
    const $ = load(html);
    const source = $('video[src], video source[src]').first().attr('src')
      || /\bsources?\s*:\s*\[\s*\{\s*["']?file["']?\s*:\s*["']([^"']+)["']/i.exec(unpackPacked(html) || html)?.[1];
    return source ? await sampleOtherMedia(source, url, http)
      : 'sin HLS/MP4 público en el visor';
  } catch (error) { return resultOf(error); }
}

async function probe([provider, title, page, selector, attr, audioInPage]) {
  const http = providerHttp(11_000, 5);
  try {
    const html = await http.text(page, { headers: { Accept: 'text/html' }, maxBytes: 2 * 1024 * 1024, timeoutMs: 4500 });
    if (isChallenge(html)) return { provider, title, state: 'challenge', players: [], media: 'no sondeado' };
    const $ = load(html);
    const groupAudio = audioInPage || (provider === 'CineCalidad' && /ver\s+online\s+audio\s+latino/i.test($('body').text().replace(/\s+/g, ' ')) ? 'latino' : '');
    const options = selector ? $(selector).toArray().slice(0, 12).flatMap((el) => {
      const item = $(el);
      const url = optionUrl(item.attr(attr), page, attr);
      const label = item.closest('.drpdn').find('button.bstd').text() || item.text();
      if (!url || /tr[aá]iler/i.test(label)) return [];
      return [{ url, audio: groupAudio || optionAudio(label) }];
    }) : [];
    const players = [...new Set(options.map(({ url }) => `${url.hostname} (${/\.(?:m3u8|mp4)$/i.test(url.pathname) ? 'directo' : 'visor'})`))];
    const hosts = [...new Set(options.map(({ url }) => url.hostname))];
    const allowed = options.filter(({ url }) => allowedVideoUrl(url.href) || playerHosts.has(url.hostname));
    const media = [];
    for (const host of hosts.filter((name) => allowed.some(({ url }) => url.hostname === name)).slice(0, 2)) {
      const sameHost = allowed.filter(({ url }) => url.hostname === host);
      const { url, audio } = sameHost.find((option) => option.audio) || sameHost[0];
      media.push(`${host} (${audio || 'audio sin confirmar'}): ${await sampleOption(url, http)}`);
    }
    const state = selector ? 'ficha disponible' : /window\.PM_UI\s*=/.test(html) ? 'visor con estado público' : 'entrada disponible';
    return { provider, title, state, players, media: media.join('; ') || 'no sondeado' };
  } catch (error) { return { provider, title, state: resultOf(error), players: [], media: 'no sondeado' }; }
}

async function main() {
  const rows = [];
  for (const control of controls) rows.push(await probe(control));
  for (const { provider, title, state, players, media } of rows) {
    const line = `${state}; ${players.join(', ') || 'sin URL de reproducción visible'}; ${media}`;
    const label = `${provider} / ${title}`;
    console.log(process.env.GITHUB_ACTIONS ? `::notice title=${label}::${line}` : `${label}: ${line}`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    '### Candidatos de StreamFlix (Node)', '', '| Fuente | Control | Entrada | Opciones | Medio |', '|---|---|---|---|---|',
    ...rows.map(({ provider, title, state, players, media }) => `| ${provider} | ${title} | ${state} | ${players.join(', ') || '—'} | ${media} |`), '',
    'Sin peticiones al Worker de producción. No se guardan firmas ni se comprueba reproducción completa.', '',
  ].join('\n'));
}

if (require.main === module) main().catch(() => { console.error('No se pudo completar la sonda de candidatos'); process.exitCode = 1; });
