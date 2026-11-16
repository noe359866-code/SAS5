'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const spinflix = require('../lib/spinflix');
const streams = require('../lib/streams');
const originalFetch = global.fetch;
after(() => { global.fetch = originalFetch; });

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const MASTER = 'https://s1.vimeos.net/hls2/03/00015/abc_,n,h,.urlset/master.m3u8?t=x&e=43200&i=0.0';
const EMBED = 'https://vimeos.net/embed-abc123.html';

/** fetch simulado que enruta por URL, como haría la API de SpinFlix. */
function mockApi(routes) {
  const calls = [];
  global.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    for (const [needle, reply] of routes) {
      if (u.includes(needle)) return typeof reply === 'function' ? reply(u) : reply;
    }
    return json({}, 404);
  };
  return calls;
}

const MOVIE = { title: 'Tombstone', altTitle: null, year: '1993', mediaType: 'movie', tmdbId: 11969, imdbId: 'tt0108358', season: null, episode: null };

test('spinflix película: search → detalle verificado → streamurl → HLS por proxy', async () => {
  const calls = mockApi([
    ['/search?', json({ results: [
      { title: 'Érase una vez en Tombstone', slug: 'erase-2021', type: 'movies', year: '2021', tmdb_id: 797528, url: 'https://x/pelicula/erase-2021' },
      { title: 'Tombstone', slug: 'tombstone-1993', type: 'movies', year: '1993', tmdb_id: 11969, url: 'https://x/pelicula/tombstone-1993' },
    ] })],
    ['/pelicula/tombstone-1993', json({ title: 'Tombstone', original_title: 'Tombstone', year: '1993', tmdb_id: 11969, imdb_id: 'tt0108358', quality: 'Dual 1080p', embeds: { video: [{ server: 'lamovie', language: 'latino - inglés', quality: 'Dual 1080p', link: 'https://vimeos.net/embed-movie1.html' }] } })],
    ['/streamurl?', json({ videos: { hls: [MASTER] }, qualities: [{ quality: 'Auto', url: MASTER }] })],
  ]);
  const out = await spinflix.searchSpinFlix('Tombstone 1993', MOVIE, 'Tombstone', 1000);
  assert.equal(out.hits.length, 1);
  const hit = out.hits[0];
  assert.equal(hit.provider, 'spinflix');
  assert.equal(hit.relevant, true);
  assert.match(hit.title, /1080p/);
  assert.match(hit.title, /Dual Latino/);
  assert.ok(hit.url.startsWith('https://spinoff.link/pelis/proxy.php?url='));
  assert.ok(decodeURIComponent(hit.url).includes(MASTER));
  assert.equal(calls.filter((u) => u.includes('/streamurl')).length, 1);
});

test('spinflix serie: resuelve el episodio concreto', async () => {
  mockApi([
    ['/search?', json({ results: [{ title: 'Breaking Bad', slug: 'breaking-bad-2008', type: 'tvshows', year: '2008', tmdb_id: 559969, url: 'https://x/serie/breaking-bad-2008' }] })],
    ['/serie/breaking-bad-2008/1/1', json({ season: 1, episode: 1, embeds: { video: [{ language: 'latino', quality: 'Full HD', link: 'https://vimeos.net/embed-serie1.html' }] } })],
    ['/serie/breaking-bad-2008', json({ title: 'Breaking Bad', year: '2008', tmdb_id: 1396 })],
    ['/streamurl?', json({ videos: { hls: [MASTER] }, qualities: [] })],
  ]);
  const resolved = { title: 'Breaking Bad', altTitle: null, year: '2008', mediaType: 'series', tmdbId: 1396, imdbId: 'tt0903747', season: 1, episode: 1 };
  const out = await spinflix.searchSpinFlix('Breaking Bad S01E01', resolved, 'Breaking Bad', 1000);
  // El tmdb_id erróneo de /search (559969) no descarta la ficha: manda la verificación del detalle (1396).
  assert.equal(out.hits.length, 1);
  assert.match(out.hits[0].title, /S01E01/);
  assert.match(out.hits[0].title, /Latino/);
});

test('spinflix: ficha que no verifica en detalle se descarta', async () => {
  mockApi([
    ['/search?', json({ results: [{ title: 'Tombstone', slug: 'otra-1993', type: 'movies', year: '1993', url: 'https://x/pelicula/otra-1993' }] })],
    ['/pelicula/otra-1993', json({ title: 'Otra cosa', year: '2001', tmdb_id: 1, imdb_id: 'tt9999999', embeds: { video: [{ link: EMBED }] } })],
  ]);
  const out = await spinflix.searchSpinFlix('Tombstone 1993', MOVIE, 'Tombstone', 1000);
  assert.deepEqual(out.hits, []);
});

test('spinflix: embeds vacíos devuelven cero hits sin romper', async () => {
  mockApi([
    ['/search?', json({ results: [{ title: 'Tombstone', slug: 'sin-embeds-1993', type: 'movies', year: '1993', url: 'https://x/pelicula/sin-embeds-1993' }] })],
    ['/pelicula/sin-embeds-1993', json({ title: 'Tombstone', year: '1993', tmdb_id: 11969, imdb_id: 'tt0108358', embeds: { video: [] } })],
  ]);
  const out = await spinflix.searchSpinFlix('Tombstone 1993', { ...MOVIE, tmdbId: 424242 }, 'Tombstone', 1000);
  assert.deepEqual(out.hits, []);
});

test('spinflix: si /streamurl cae, desempaqueta el embed de vimeos (m3u8 + subtítulos)', async () => {
  // Empaquetado Dean Edwards mínimo: payload con índices -> palabras clave.
  const packed = `eval(function(p,a,c,k,e,d){return p}('0 1',36,2,'https://s1.vimeos.net/x/master.m3u8|{"file":"https://s1.vimeos.net/subs/es.vtt","label":"Spanish"}'.split('|'),0,{}))`;
  mockApi([
    ['/search?', json({ results: [{ title: 'Tombstone', slug: 'fallback-1993', type: 'movies', year: '1993', url: 'https://x/pelicula/fallback-1993' }] })],
    ['/pelicula/fallback-1993', json({ title: 'Tombstone', year: '1993', tmdb_id: 11969, imdb_id: 'tt0108358', quality: 'HD 720p', embeds: { video: [{ language: 'subtitulado', quality: 'HD 720p', link: EMBED }] } })],
    ['/streamurl?', json({ error: 'caído' }, 500)],
    ['vimeos.net/embed-', new Response(packed, { status: 200, headers: { 'content-type': 'text/html' } })],
  ]);
  const out = await spinflix.searchSpinFlix('Tombstone 1993', { ...MOVIE, imdbId: null }, 'Tombstone', 1000);
  assert.equal(out.hits.length, 1);
  assert.match(out.hits[0].title, /720p/);
  assert.equal(out.hits[0].subtitles.length, 1);
  assert.equal(out.hits[0].subtitles[0].lang, 'es');
});

test('spinflix -> stream de Stremio: URL directa HLS con proxyHeaders y notWebReady', () => {
  const s = streams.toStream({
    title: 'Tombstone 1993 1080p WEB-DL Dual Latino SpinFlix', titles: ['Tombstone'],
    quality: '1080p', tags: ['web', '1080p', 'dub'], url: 'https://spinoff.link/pelis/proxy.php?url=x',
    audioLabel: 'Lat + Inglés',
    subtitles: [{ url: 'https://x/es.vtt', lang: 'es' }],
  }, null);
  assert.match(s.title, /🎧 Lat \+ Inglés/);
  assert.equal(s.url, 'https://spinoff.link/pelis/proxy.php?url=x');
  assert.equal(s.infoHash, undefined);
  assert.equal(s.behaviorHints.notWebReady, true);
  assert.equal(s.behaviorHints.proxyHeaders.request.Referer, 'https://vimeos.net/');
  assert.equal(s.subtitles.length, 1);
});

test('spinflix: utilidades de resolución e idioma', () => {
  assert.equal(spinflix.resolutionToken('Dual 1080p'), '1080p');
  assert.equal(spinflix.resolutionToken('Full HD'), '1080p');
  assert.equal(spinflix.resolutionToken('HD'), '720p');
  assert.equal(spinflix.languageToken('latino - inglés'), 'Dual Latino');
  assert.equal(spinflix.languageToken('castellano'), 'Castellano');
  assert.equal(spinflix.languageToken('subtitulado'), 'Subtitulado');
});

test('spinflix: la etiqueta de audio se lee Lat / ES / Inglés según la ficha', () => {
  assert.equal(spinflix.audioLabel('latino'), 'Lat');
  assert.equal(spinflix.audioLabel('castellano'), 'ES');
  assert.equal(spinflix.audioLabel('español'), 'ES');
  assert.equal(spinflix.audioLabel('inglés'), 'Inglés');
  assert.equal(spinflix.audioLabel('latino - inglés'), 'Lat + Inglés');
  assert.equal(spinflix.audioLabel('castellano - inglés'), 'ES + Inglés');
  assert.equal(spinflix.audioLabel('subtitulado'), 'Subtitulado');
  assert.equal(spinflix.audioLabel(''), '');
});
