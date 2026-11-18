'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('cheerio');
const { searchPelisPlus, searchCandidates, playerEmbeds, streamwishHls } = require('../lib/pelisplus');
const { runProviders } = require('../lib/streams');

const movie = { title: 'Interestelar', altTitle: 'Interstellar', mediaType: 'movie', year: '2014' };
const search = `<a class="Posters-link" href="/pelicula/interestelar" data-title="Interestelar"></a>`;
const detail = `<h1>Interestelar</h1><p class="text-opacity">Interstellar</p><a href="/year/2014">2014</a>
<ul><li class="playurl" data-name="Latino" data-url="https://streamwish.to/e/fixture"></li></ul>`;
const master = 'https://media.cdn.example.net/path/master.m3u8?token=fixture';

test('PelisPlus: búsqueda, validación de ficha, idioma y extracción HLS sin ejecutar JS', async (t) => {
  const calls = [];
  t.mock.method(global, 'fetch', async (raw, init) => {
    calls.push(String(raw));
    assert.equal(init.redirect, 'manual');
    if (String(raw).includes('/search?')) return new Response(search);
    if (raw === 'https://pelisplushd.la/pelicula/interestelar') return new Response(detail);
    if (raw === 'https://streamwish.to/e/fixture') return new Response(`var links = {"hls4":"${master}"};`);
    throw new Error('petición no esperada');
  });
  const report = {};
  const hits = await runProviders(['pelisplus'], '', movie, movie.title, report, 1000);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].url, master);
  assert.equal(hits[0].verification, 'cdn-unverified');
  assert.equal(hits[0].audioLabel, 'Latino');
  assert.equal(calls.length, 3, 'no se consulta el CDN de dominio desconocido');
});

test('PelisPlus: no acepta título, año, idioma o iframe incorrectos', async (t) => {
  assert.deepEqual(searchCandidates(search, { ...movie, title: 'Matrix', altTitle: '' }), []);
  const $ = load(`<li class="playurl" data-name="Latino" data-url="https://streamwish.to.evil.test/e/id"></li>
   <li class="playurl" data-name="Subtitulado" data-url="https://streamwish.to/e/id"></li>`);
  assert.deepEqual(playerEmbeds($), []);
  const calls = [];
  t.mock.method(global, 'fetch', async (raw) => {
    calls.push(raw);
    return new Response(String(raw).includes('/search?') ? search : detail.replace('/year/2014">2014', '/year/2009">2009'));
  });
  const out = await searchPelisPlus('', movie, movie.title, 1000);
  assert.deepEqual(out, { hits: [], reason: 'no-match' });
  assert.ok(!calls.some((url) => String(url).includes('streamwish')));
});

test('PelisPlus: no sigue URLs internas ni evalúa expresiones en el reproductor', () => {
  const html = `file: 'http://127.0.0.1/a.m3u8', src: 'https://localhost/a.m3u8',
    hls4: 'https://192.168.1.1/live.m3u8', file: 'https://ads.example.net/preroll/a.m3u8';
    file: 'https://cdn.example.net/ok.m3u8'`;
  assert.deepEqual(streamwishHls(html, 'https://streamwish.to/e/id'), ['https://cdn.example.net/ok.m3u8']);
});

test('PelisPlus: las series se omiten hasta validar capítulo exacto', async (t) => {
  t.mock.method(global, 'fetch', () => { throw new Error('petición inesperada'); });
  assert.deepEqual(await searchPelisPlus('', { ...movie, mediaType: 'series', season: 1, episode: 1 }, movie.title, 1000), { skipped: 'series-not-supported' });
});

test('PelisPlus: alias VidHide y Dropload requieren coincidencia exacta', () => {
  const { embedUrl } = require('../lib/pelisplus');
  assert.equal(embedUrl('https://dhtpre.com/e/example'), 'https://dhtpre.com/e/example');
  assert.equal(embedUrl('https://dr0pstream.com/e/example'), 'https://dr0pstream.com/e/example');
  assert.equal(embedUrl('https://dr0pstream.com.evil.test/e/example'), null);
});

test('PelisPlus: extrae MP4 y subtítulos captions, pero no thumbnails ni direcciones internas', () => {
  const { extractPlayer } = require('../lib/pelisplus');
  const text = `file: 'https://cdn.example.net/movie.mp4', tracks: [
    {file:'https://cdn.example.net/subs/es.vtt', label:'Español', kind:'captions'},
    {file:'https://cdn.example.net/subs/en.vtt', label:'English', kind:'captions'},
    {file:'https://cdn.example.net/thumbnails.vtt', label:'preview', kind:'thumbnails'},
    {file:'https://127.0.0.1/private.vtt', label:'Latino', kind:'captions'},
    {file:'https://cdn.example.net/%61ds/file.vtt', label:'Latino', kind:'captions'}]`;
  const out = extractPlayer(text, 'https://dropload.tv/e/id');
  assert.deepEqual(out.urls, ['https://cdn.example.net/movie.mp4']);
  assert.deepEqual(out.subtitles.map((s) => s.lang), ['es', 'en']);
});

test('PelisPlus: desempaqueta fuente HLS sin ejecutar JavaScript', () => {
  const { extractPlayer } = require('../lib/pelisplus');
  const packed = `eval(function(p,a,c,k,e,d){return p}('0:"1"',2,2,'hls4|https://cdn.example.net/master.m3u8'.split('|')))`;
  assert.deepEqual(extractPlayer(packed, 'https://dhtpre.com/e/test').urls, ['https://cdn.example.net/master.m3u8']);
});

test('PelisPlus: MP4 y subtítulos se transmiten como resultado sin verificar', async (t) => {
  const player = detail.replace('https://streamwish.to/e/fixture', 'https://dropload.tv/e/fixture');
  t.mock.method(global, 'fetch', async (raw) => {
    if (String(raw).includes('/search?')) return new Response(search);
    if (raw === 'https://pelisplushd.la/pelicula/interestelar') return new Response(player);
    if (raw === 'https://dropload.tv/e/fixture') return new Response(`file:'https://cdn.example.net/movie.mp4', tracks:[{file:'https://cdn.example.net/es.vtt',label:'Español',kind:'captions'}]`);
    throw new Error('petición no esperada');
  });
  const hits = await runProviders(['pelisplus'], '', movie, movie.title, {}, 1000);
  assert.equal(hits[0].quality, 'MP4');
  assert.equal(hits[0].verification, 'cdn-unverified');
  assert.equal(hits[0].subtitles[0].lang, 'es');
});
