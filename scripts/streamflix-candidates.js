'use strict';

// Solo diagnóstico en Node. Se leen controles fijos y datos públicos de
// visores permitidos. No se ejecutan scripts ni se abren descargas, challenges
// o redirecciones de medios; un visor puede navegar una vez a otro permitido.
const { appendFileSync } = require('node:fs');
const { load } = require('cheerio');
const { allowedVideoUrl, extractFromEmbedHtml, unpackPacked } = require('../lib/vimeos');
const { parseManifest } = require('../lib/hlsManifest');
const { isDirectMedia } = require('../lib/directMedia');
const { normalizeText } = require('../lib/providerTitles');

const providers = {
  CineCalidad: ['#playeroptionsul li[data-option]:not(.dooplay_player_option_trailer)', 'data-option'],
  PelisflixHD: ['#player li[data-server]', 'data-server'],
  SeriesFlix: ['.optns-bx .drpdn .Button.sgty[data-url]', 'data-url'],
  Latanime: ['a.play-video[data-player]', 'data-player'],
  LaCartoons: ['iframe[src], iframe[data-src]', 'src'],
};
const controls = [
  ['CineCalidad', 'El Origen (2010)', 'https://www.cinecalidad.am/ver-pelicula/el-origen/', 'latino'],
  ['CineCalidad', 'Bandidas (2006)', 'https://www.cinecalidad.am/ver-pelicula/bandidas/', 'latino'],
  ['PelisflixHD', 'Interestelar (2014)', 'https://pelisflixhd.love/pelicula/interstellar/'],
  ['PelisflixHD', 'Jurassic World (2015)', 'https://pelisflixhd.love/pelicula/jurassic-world-parque-jurasico-iv-zrps/'],
  ['SeriesFlix', 'Breaking Bad T2E1', 'https://seriesflixhd.boats/episodio/breaking-bad-zpya-2x1/'],
  ['SeriesFlix', 'Better Call Saul T1E1', 'https://seriesflixhd.boats/episodio/better-call-saul-zjab-1x1/'],
  ['Latanime', 'Death Note capítulo 1 (Latino)', 'https://latanime.org/ver/death-note-latino-episodio-1', 'latino'],
  ['Latanime', 'Death Note capítulo 1 (Castellano)', 'https://latanime.org/ver/death-note-castellano-episodio-1', 'castellano'],
  ['LaCartoons', 'Avatar: La leyenda de Aang T1E1', 'https://www.lacartoons.com/serie/capitulo/7830?t=1', 'latino'],
  ['TioPlus', 'El Origen (búsqueda)', 'https://tioplus.app/search/inception'],
  ['CineHax (MovieMaster)', 'El Origen (visor)', 'https://api.moviemaster.lat/e/movie/27205'],
];
const PLAYER_HOSTS = new Set(['nupload.my', 'voe.sx', 'waaw.to', 'www.mp4upload.com', 'mp4upload.com', 'uqload.com', 'uqload.to',
  'luluvdo.com', 'lulustream.com', 'listeamed.net', 'filemoon.sx', 'swhoi.com', 'ok.ru', 'www.ok.ru']);
const MEDIA_DOMAINS = ['mp4upload.com', 'uqload.com', 'uqload.to'];
const MEDIA = /\.(?:m3u8|mp4)$/i;
const HLS = /\.m3u8$/i;
const SEGMENT = /\.(?:ts|m4s|mp4|aac)$/i;
const LIMIT = 12;

function httpsUrl(value, base) {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash ? url : null;
  } catch { return null; }
}

const knownPlayer = (url) => url && (allowedVideoUrl(url.href) || PLAYER_HOSTS.has(url.hostname));
const mediaUrl = (value, base) => {
  const url = httpsUrl(value, base);
  return url && MEDIA.test(url.pathname) && isDirectMedia(url.href) ? url : null;
};

function optionUrl(raw, page, attr) {
  if (!raw || raw.length > 8192) return null;
  let value = raw.trim();
  if (['data-server', 'data-url', 'data-player'].includes(attr) && !/^(?:https?:)?\/\//i.test(value)) {
    if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null;
    value = Buffer.from(value, 'base64').toString('utf8').trim();
    if (!/^(?:https?:)?\/\//i.test(value)) return null;
  }
  const url = httpsUrl(value, page);
  // Parámetro público que contiene otro visor; no navegar a destinos no validados.
  if (url && (url.hostname === 'nupload.my' || url.origin === page.origin) && url.searchParams.has('url')) {
    return httpsUrl(url.searchParams.get('url'), url) || url;
  }
  return url;
}

function audioOf(label) {
  const text = normalizeText(label).replace(/reproducir|idioma/g, ' ');
  if (/subtit|\bvose\b|trailer/.test(text)) return '';
  if (/(?:^|[\s\d])(?:latino|lat)\b/.test(text)) return 'latino';
  if (/castellano/.test(text)) return 'castellano';
  return '';
}

const challengePage = (html) => /<title>\s*(?:just a moment|attention required)|cf-browser-verification/i.test(html);

function mediaSources($, base, context) {
  const media = $('video[src], video[data-src], video source[src], video source[data-src]').toArray()
    .flatMap((el) => [$(el).attr('data-src'), $(el).attr('src')]);
  // Solo literales. En una ficha (no el embed), exigir que el script configure
  // un reproductor para no confundir enlaces del catálogo o recomendaciones.
  if (context) {
    $('script:not([src])').each((_i, el) => {
      const text = $(el).html() || '';
      if (text.length > 256 * 1024) return;
      const config = unpackPacked(text) || text;
      if (context === 'ficha' && !/\b(?:jwplayer|videojs)\s*\(|\.(?:setup|src)\s*\(/i.test(config)) return;
      const sources = config.matchAll(/(?:\b(?:file|src|hls\d*|mp4|contentUrl)["']?\s*:|\.src\s*\()\s*["']([^"'\r\n]{1,8192})["']/gi);
      for (const match of sources) media.push(match[1].replace(/\\\//g, '/').replace(/\\u0026/gi, '&'));
    });
    if (context === 'visor' && allowedVideoUrl(base.href)) media.push(...extractFromEmbedHtml($.html()).hls);
  }
  return [...new Map(media.map((raw) => mediaUrl(raw, base)).filter(Boolean).map((url) => [url.href, url])).values()].slice(0, 6);
}

function requestBudget(fetcher, deadline = Date.now() + 12_000) {
  let count = 0;
  const stop = (state, location) => { throw Object.assign(new Error(state), { state, location }); };
  const read = async (url, bytes, range = false) => {
    const remaining = deadline - Date.now();
    if (count >= LIMIT) stop('límite de peticiones');
    if (remaining <= 0) stop('timeout');
    count++;
    const signal = AbortSignal.timeout(Math.min(remaining, 3200));
    let response;
    try {
      response = await fetcher(url.href, { redirect: 'manual', signal, ...(range ? { headers: { Range: `bytes=0-${bytes - 1}` } } : {}) });
    } catch { stop(signal.aborted ? 'timeout' : 'sin respuesta comprobable'); }
    const status = response.status;
    if (response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge') {
      await response.body?.cancel().catch(() => {});
      stop(`challenge (HTTP ${status})`);
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      const location = [301, 302, 303, 307, 308].includes(status) ? httpsUrl(response.headers.get('location'), url) : null;
      stop(`HTTP ${status}${location ? ` → ${location.hostname}` : ''}`, location);
    }
    if (!range && Number(response.headers.get('content-length')) > bytes) {
      await response.body.cancel().catch(() => {});
      stop('respuesta demasiado grande');
    }
    const reader = response.body.getReader();
    const chunks = [];
    let n = 0;
    try {
      while (!range || n < bytes) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!range && n + value.length > bytes) stop('respuesta demasiado grande');
        const kept = value.subarray(0, bytes - n);
        n += kept.length;
        chunks.push(kept);
      }
    } catch (err) { stop(signal.aborted ? 'timeout' : err.state || 'lectura incompleta'); }
    finally { await reader.cancel().catch(() => {}); }
    return { bytes: Buffer.concat(chunks, n), status };
  };
  return {
    text: async (url, cap) => (await read(url, cap)).bytes.toString('utf8'),
    sample: (url) => read(url, 384, true),
    get count() { return count; },
  };
}

const rejected = (state) => ({ ok: false, state });
const stateOf = (err) => err?.state || 'sin respuesta comprobable';

async function sampleMedia(url, player, http) {
  const allowed = (u) => u && (u.origin === player.origin || allowedVideoUrl(u.href)
    || MEDIA_DOMAINS.some((host) => u.hostname === host || u.hostname.endsWith(`.${host}`)));
  if (!allowed(url)) return rejected(`medio en ${url.hostname} (origen no validado)`);
  const sample = async (u, tsOrFragment = false) => {
    const { bytes, status } = await http.sample(u);
    const signature = bytes.toString('ascii', 4, 8);
    const mp4 = bytes.length > 8 && (signature === 'ftyp' || (tsOrFragment && /^(?:moof|styp)$/.test(signature)));
    const ts = tsOrFragment && bytes.length > 376 && [0, 188, 376].every((i) => bytes[i] === 0x47);
    const aac = tsOrFragment && /\.aac$/i.test(u.pathname) && bytes.length > 8 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
    return { ok: mp4 || ts || aac, state: `HTTP ${status} (${mp4 ? 'MP4' : ts ? 'MPEG-TS' : aac ? 'AAC' : 'sin cabecera de medio'})` };
  };
  let stage = HLS.test(url.pathname) ? 'manifiesto CDN' : 'MP4';
  const read = async (u) => {
    const text = await http.text(u, 512 * 1024);
    if (/#EXT-X-(?:SESSION-)?KEY:(?!METHOD=NONE(?:\s|$))/i.test(text)) {
      throw Object.assign(new Error(), { state: 'requiere claves no sondeadas' });
    }
    return { text, parsed: parseManifest(text) };
  };
  const samplePlaylist = async (parent, info) => {
    const segment = httpsUrl(info.parsed?.segment, parent);
    if (!allowed(segment) || !SEGMENT.test(segment.pathname)) return rejected('segmento no sondeable');
    return sample(segment, true);
  };
  try {
    if (!HLS.test(url.pathname)) {
      const result = await sample(url);
      return { ...result, state: `MP4 ${result.state}` };
    }
    const master = await read(url);
    if (!master.parsed) return rejected('manifiesto inválido');
    const variant = master.parsed.variants.length ? httpsUrl(master.parsed.variants[0].uri, url) : url;
    if (!allowed(variant) || !HLS.test(variant.pathname)) return rejected('variante no sondeable');
    stage = 'variante CDN';
    const media = variant === url ? master : await read(variant);
    stage = 'segmento CDN';
    const video = await samplePlaylist(variant, media);
    if (!video.ok) return rejected(`HLS · ${video.state}`);
    const audioRenditions = master.text.split(/\r?\n/)
      .filter((line) => /^#EXT-X-MEDIA:.*\bTYPE=AUDIO\b/i.test(line) && /(?:^|,)URI=/i.test(line));
    if (audioRenditions.length) {
      const SpanishAudio = audioRenditions.find((line) => /(?:^|,)LANGUAGE="es(?:-[a-z0-9]+)*"/i.test(line));
      const audioUrl = httpsUrl(/(?:^|,)URI="([^"]+)"/i.exec(SpanishAudio || '')?.[1], url);
      if (!allowed(audioUrl) || !HLS.test(audioUrl.pathname)) return rejected('HLS · audio español separado no comprobable');
      stage = 'audio CDN';
      const audio = await samplePlaylist(audioUrl, await read(audioUrl));
      if (!audio.ok) return rejected(`HLS · audio separado ${audio.state}`);
      return { ok: true, spanish: true, state: `HLS · segmento ${video.state}, audio es ${audio.state}` };
    }
    return { ok: true, state: `HLS · segmento ${video.state}` };
  } catch (err) { return rejected(`${stage} ${stateOf(err)}`); }
}

function iframeUrls($, base) {
  return $('iframe[src], iframe[data-src]').toArray()
    .map((el) => httpsUrl($(el).attr('data-src'), base) || httpsUrl($(el).attr('src'), base)).filter(Boolean);
}

async function inspectOption(option, page, http) {
  let url = option.url;
  let redirected = false;
  try {
    for (let depth = 0; depth < 2; depth++) {
      if (mediaUrl(url.href)) return sampleMedia(url, depth === 0 ? page : option.url, http);
      if (!knownPlayer(url)) return rejected(`visor en ${url.hostname} (sin sondear)`);
      let html;
      try { html = await http.text(url, 1024 * 1024); } catch (err) {
        const next = err.location;
        // Solo una navegación pública de visor entre orígenes conocidos.
        // No se sigue Location de medios, ni se modifica ninguna cabecera.
        if (redirected || !knownPlayer(next) || next.href === url.href || mediaUrl(next.href)) throw err;
        redirected = true;
        url = next;
        html = await http.text(url, 1024 * 1024);
      }
      if (challengePage(html)) return rejected('challenge del visor');
      const $ = load(html);
      const sources = mediaSources($, url, 'visor');
      if (sources.length) {
        const results = [];
        for (const source of sources.slice(0, 2)) {
          const result = await sampleMedia(source, url, http);
          if (result.ok) return result;
          results.push(result.state);
        }
        return rejected([...new Set(results)].join(' / '));
      }
      const nested = iframeUrls($, url).find((u) => u.href !== url.href && u.href !== option.url.href && knownPlayer(u));
      if (!nested || depth === 1) return rejected('visor sin HLS/MP4 literal');
      url = nested;
    }
  } catch (err) { return rejected(stateOf(err)); }
  return rejected('visor sin HLS/MP4 literal');
}

function sortOptions(options) {
  const sorted = [...options].sort((a, b) => Number(Boolean(b.audio)) - Number(Boolean(a.audio)));
  const urls = new Set();
  const first = new Map();
  const rest = [];
  for (const option of sorted) {
    if (urls.has(option.url.href)) continue;
    urls.add(option.url.href);
    const host = option.url.hostname;
    if (first.has(host)) rest.push(option);
    else first.set(host, option);
  }
  return [...first.values(), ...rest];
}

async function probe([provider, title, pageUrl, audio], fetcher = fetch) {
  const page = new URL(pageUrl);
  const http = requestBudget(fetcher);
  const report = { provider, title, state: 'ficha disponible', options: [], attempts: [], accepted: false };
  try {
    const html = await http.text(page, 2 * 1024 * 1024);
    if (challengePage(html)) { report.state = 'challenge'; return report; }
    const $ = load(html);
    const config = providers[provider];
    if (!config) report.state = /window\.PM_UI\s*=/.test(html) ? 'visor con estado público' : 'entrada disponible';
    const opts = config ? $(config[0]).toArray().slice(0, 16).flatMap((el) => {
      const item = $(el);
      const attr = config[1];
      const url = (attr === 'src' && httpsUrl(item.attr('data-src'), page)) || optionUrl(item.attr(attr), page, attr);
      const label = item.closest('.drpdn').find('button.bstd').text() || item.text();
      return !url || /tr[aá]iler|subtit|\bvose\b/i.test(label) ? [] : [{ url, audio: audio || audioOf(label) }];
    }) : [];
    const options = [...opts, ...mediaSources($, page, config && 'ficha').map((url) => ({ url, audio }))];
    report.options = [...new Set(options.map(({ url }) => `${url.hostname}${mediaUrl(url.href) ? ' (medio)' : ' (visor)'}`))];
    const inspectable = options.filter(({ url }) => knownPlayer(url) || mediaUrl(url.href));
    for (const option of sortOptions(inspectable).slice(0, 6)) {
      if (http.count >= LIMIT) { report.attempts.push('límite de peticiones'); break; }
      const result = await inspectOption(option, page, http);
      const confirmed = result.ok && (Boolean(option.audio) || result.spanish);
      report.attempts.push(`${option.url.hostname} (${option.audio || 'audio sin confirmar'}): ${result.state}${result.ok && !confirmed ? ', falta acreditar audio' : ''}`);
      if (confirmed) { report.accepted = true; break; }
    }
  } catch (err) { report.state = stateOf(err); }
  return report;
}

async function main() {
  const rows = [];
  for (const control of controls) rows.push(await probe(control));
  const summary = `${rows.filter(({ accepted }) => accepted).length}/${rows.length} controles con una muestra directa y audio identificado`;
  const log = (label, line) => console.log(process.env.GITHUB_ACTIONS ? `::notice title=${label}::${line}` : `${label}: ${line}`);
  log('Segunda prueba StreamFlix', summary);
  for (const provider of new Set(rows.map((row) => row.provider))) {
    const details = rows.filter((row) => row.provider === provider).map(({ title, state, options, attempts, accepted }) =>
      `${title}: ${state}; ${options.join(', ') || 'sin opción visible'}; ${attempts.join('; ') || 'sin intento de medio'}; muestra=${accepted ? 'sí' : 'no'}`);
    log(provider, details.join(' | ')); // Una anotación por fuente evita el truncado de Actions.
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    '### Segunda prueba de enlaces directos (Node)', '', summary, '', '| Fuente | Control | Entrada | Opciones | Comprobación |', '|---|---|---|---|---|',
    ...rows.map(({ provider, title, state, options, attempts }) => `| ${provider} | ${title} | ${state} | ${options.join(', ') || '—'} | ${attempts.join('; ') || '—'} |`), '',
    'No se consulta el Worker ni se guardan firmas. Se comprueban primeros bytes, no reproducción completa ni CORS del cliente.', '',
  ].join('\n'));
  if (process.argv.includes('--require-direct') && !rows.some(({ accepted }) => accepted)) process.exitCode = 1;
}

if (require.main === module) main().catch(() => { console.error('No se pudo completar la sonda'); process.exitCode = 1; });
module.exports = { probe };
