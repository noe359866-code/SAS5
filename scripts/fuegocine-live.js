'use strict';

// Sonda exclusiva de FuegoCine: no registra URLs completas, HTML, cookies ni
// firmas. No ejecuta JavaScript ni intenta resolver desafíos del proveedor.
const { load } = require('cheerio');
const { runProviders } = require('../lib/streams');
const { findFuegoPlayer } = require('../lib/fuegocine');
const { providerHttp } = require('../lib/providerHttp');
const { annotate } = require('./providers-live');

const movies = [
  ['Toy Story 5', '2026'], ['Ratatouille', '2007'], ['Te Van a Matar', '2026'],
  ['Ciudad de Dios', '2002'], ['El Hombre de la Tierra', '2007'], ['La Odisea', '2026'],
].map(([title, year]) => ({ title, year, mediaType: 'movie' }));
const series = [
  { title: 'VisionQuest', year: '2026', season: 1, episode: 1 },
  { title: 'El señor de los anillos: Los anillos de poder', year: '2022', season: 1, episode: 1 },
].map((fixture) => ({ ...fixture, mediaType: 'series' }));
const allowed = new Set([
  'fcplayer2.blogspot.com', 'player.abyssplayer.com', 'unlimplay.com',
  'embedorigin.cc', 'videro.my', 'videro.im',
]);
const tried = new Map();
const limit = 512 * 1024;
const frameSelector = 'iframe[src],iframe[data-src]';

function secureUrl(value, base) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password ? url : null;
  } catch { return null; }
}

const hosts = (items) => [...new Set(items)].slice(0, 6).join(',') || '—';
const shape = (url) => url.hostname + (/\.(m3u8|mp4|webm|php)$/i.exec(url.pathname)?.[0] || '');
const problem = (e) => e.challenge ? 'challenge' : e.status ? `HTTP ${e.status}` : e.timeout || e.name === 'TimeoutError' ? 'timeout' : 'error de red o formato';

function frameKind(raw, page) {
  const url = secureUrl(raw, page);
  if (!url) return 'iframe inválido';
  if (url.hostname !== 'fcplayer2.blogspot.com') return shape(url);
  const value = url.searchParams.get('url')?.trim();
  if (!value) return `${url.hostname} (url ausente/vacía)`;
  const direct = secureUrl(value);
  let hint = direct ? shape(direct) : /\.m3u8|\.mp4/i.test(value) ? 'texto con extensión de vídeo'
    : /<iframe\b/i.test(value) ? 'iframe como parámetro' : value.length < 12 ? 'texto corto sin URL'
      : /^https?%3a/i.test(value) ? 'doble escape URL' : /^[\w+/=-]+$/.test(value) ? 'identificador no URL' : 'texto sin URL';
  if (!direct && /^https?:/i.test(value)) hint = 'URL no HTTPS o inválida';
  return `${url.hostname} (${hint})`;
}

function playerShape($, page) {
  const frames = $(frameSelector).toArray().map((el) => frameKind($(el).attr('data-src') || $(el).attr('src'), page));
  const video = $('video[src],video[data-src],video source[src],video source[data-src]').toArray()
    .map((el) => secureUrl($(el).attr('data-src') || $(el).attr('src'), page)).filter(Boolean).map(shape);
  const scripts = $('script:not([src])').toArray().map((el) => $(el).text()).join('\n').replace(/\\\//g, '/');
  const literals = [];
  for (const [, raw] of scripts.matchAll(/['"]((?:https:\/\/|\/\/|\/)[^'"<>\s\\]{1,2048})['"]/gi)) {
    const url = secureUrl(raw, page);
    if (url && /\.(?:m3u8|mp4|webm)$/i.test(url.pathname)) literals.push(shape(url));
  }
  const signals = ['sources', 'jwplayer', 'videojs', 'hls', 'playerjs', 'mp4', 'm3u8', 'playlist', 'tracks']
    .filter((key) => new RegExp(`\\b${key}\\b`, 'i').test(scripts));
  return `vídeo=${hosts(video)}; iframes=${hosts(frames)}; literales=${hosts(literals)}; señales=${hosts(signals)}; JSON=${$('script[type="application/json"]').length}; srcdoc=${$('iframe[srcdoc]').length}`;
}

async function boundedText(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > limit) throw new Error('respuesta demasiado grande');
      text += decoder.decode(value, { stream: true });
    }
  } finally { await reader.cancel().catch(() => {}); }
}

async function inspect(raw, page) {
  let url = secureUrl(raw, page);
  if (!url || !allowed.has(url.hostname)) return null;
  const hostname = url.hostname;
  const count = tried.get(hostname) || 0;
  if (count >= (hostname === 'unlimplay.com' ? 3 : 2)) return null;
  tried.set(hostname, count + 1);
  const init = { redirect: 'manual', signal: AbortSignal.timeout(4500), headers: { Referer: `${new URL(page).origin}/` } };
  let route = '';
  try {
    let response = await fetch(url.href, init);
    if (response.status === 302 && response.headers.get('cf-mitigated') !== 'challenge') {
      const next = secureUrl(response.headers.get('location'), url.href);
      route = next ? `302→${next.origin === url.origin ? 'mismo origen' : next.hostname}; ` : '302 sin destino válido; ';
      if (hostname === 'unlimplay.com' && next?.origin === url.origin && next.pathname === url.pathname && next.href !== url.href) {
        await response.body?.cancel().catch(() => {});
        url = next;
        response = await fetch(url.href, init);
      }
    }
    if (!response.ok || response.headers.get('cf-mitigated') === 'challenge') {
      await response.body?.cancel().catch(() => {});
      return `${hostname}: ${route}${response.headers.get('cf-mitigated') === 'challenge' ? 'challenge' : `HTTP ${response.status}`}`;
    }
    return `${hostname}: ${route}${playerShape(load(await boundedText(response)), url.href)}`;
  } catch (e) { return `${hostname}: ${route}${problem(e)}`; }
}

async function main() {
  for (const fixture of [...movies, ...series]) {
    const label = `FuegoCine / ${fixture.title}${fixture.season ? ` T${fixture.season}E${fixture.episode}` : ''}`;
    const report = {};
    await runProviders(['fuegocine'], fixture.title, fixture, fixture.title, report, undefined, { ignorePause: true });
    const { accepted = 0, reason, skipped } = report.fuegocine;
    const state = `${reason || skipped || 'candidatos'}; aceptados=${accepted}`;
    try {
      const { player: $, watch, catalog, reason: locationReason, skipped: locationSkip } = await findFuegoPlayer(fixture, fixture.title, providerHttp(8000));
      if (!$) { annotate(label, `${state}; ficha/visor: ${locationReason || locationSkip}`); continue; }
      const frames = $(frameSelector).toArray().slice(0, 8).map((el) => $(el).attr('data-src') || $(el).attr('src'));
      const embeds = await Promise.all(frames.map((raw) => inspect(raw, watch)));
      annotate(label, `${state}; catálogo=${catalog}; ${playerShape($, watch)}\n${embeds.filter(Boolean).join('\n')}`);
    } catch (e) { annotate(label, `${state}; ficha/visor: ${problem(e)}`); }
  }
}

main().catch(() => { process.exitCode = 1; });
