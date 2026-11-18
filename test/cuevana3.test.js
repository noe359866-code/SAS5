'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runProviders, SEARCHERS } = require('../lib/streams');
const { playerUrl } = require('../lib/cuevana3');

const base = 'https://cuevanas3.pro';
const film = { title: 'Matrix', year: 1999, mediaType: 'movie' };
const movie = { _id: 42, title: 'Matrix (1999)', original_title: 'The Matrix', slug: 'matrix-1999', type: 'movies', release_date: '1999-03-31' };
const series = { title: 'Breaking Bad', year: 2008, mediaType: 'series', season: 2, episode: 2, tmdbId: 1396 };
const show = { _id: 73, title: 'Breaking Bad (2008)', slug: 'breaking-bad-2008', type: 'tvshows' };
const episode = { _id: 100, slug: 'breaking-bad-temporada-2-episodio-2', type: 'episodes', season_number: 2, episode_number: 2, show_id: '1396' };
const frame = 'https://cuevana3.gs/player.php?t=fixture-token-abcdefghijklmnopqrstuvwxyz&server=vimeos';
const nested = 'https://vimeos.net/embed-example.html';
const media = 'https://p3.vimeos.zip/fixture/master.m3u8';
const api = (data) => Response.json({ error: false, data });
const options = (...embeds) => api({ embeds, downloads: [{ lang: 'Castellano', url: 'https://downloads.example/movie.mp4' }] });
const player = () => options({ url: frame, lang: 'Latino', quality: 'Full HD' });
const playerHtml = `<iframe src="${nested}"></iframe><iframe src="https://vimeos.net.other.example/embed-fake.html"></iframe>
  <div class="trailer"><iframe src="https://vimeos.net/embed-trailer.html"></iframe></div>`;
const sourceHtml = `<script>jwplayer('player').setup({file:'${media}'})</script>`;
const manifest = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720\nlevel.m3u8\n';
const search = (resolved, type) => `${base}/wp-api/v1/search?${new URLSearchParams({ q: resolved.title, page: 1, postType: type, postsPerPage: 18 })}`;
const filmPage = `${base}/peliculas/${movie.slug}/`;
const episodePage = `${base}/episodio/${episode.slug}/`;
const watchApi = (id) => `${base}/wp-api/v1/player?postId=${id}&demo=0`;
const canonical = frame.replace('https://cuevana3.gs', base);
const listing = (page) => `${base}/wp-api/v1/single/episodes/list?_id=73&season=2&page=${page}&postsPerPage=12`;
const detail = `${base}/wp-api/v1/single/episodes?slug=${episode.slug}&postType=episodes`;

function mockRequests(t, expected) {
  t.after(() => assert.equal(expected.length, 0, 'se comprobaron todas las solicitudes previstas'));
  t.mock.method(global, 'fetch', async (raw, init) => {
    const request = expected.shift();
    assert.ok(request, 'no deben consultarse rutas, anuncios ni reproductores no previstos');
    const [url, response, referer] = request;
    assert.equal(raw, url);
    assert.equal(init.redirect, 'manual');
    if (url.startsWith(`${base}/wp-api/`)) assert.equal(init.headers.Accept, 'application/json');
    if (referer) assert.equal(init.headers.Referer, referer);
    return response;
  });
}

function filmRequests() {
  return [[search(film, 'movies'), api({ posts: [
    { ...movie, _id: 6, slug: 'matrix-2025', title: 'Matrix (2025)', release_date: '2025-03-31' },
    { ...movie, _id: 7, slug: 'matrix-revoluciones-1999', title: 'Matrix: Revoluciones (1999)', original_title: 'The Matrix Revolutions' },
    { ...movie, _id: 8, slug: 'matrix-series-1999', type: 'tvshows' }, movie,
  ] })], [watchApi(movie._id), player(), filmPage]];
}

function mediaRequests(page, response = new Response(manifest)) {
  return [[canonical, new Response(playerHtml), page], [nested, new Response(sourceHtml), `${base}/`], [media, response, 'https://vimeos.net/']];
}

test('Cuevana 3: el adaptador registrado identifica la película y valida el HLS, no devuelve el iframe', async (t) => {
  mockRequests(t, [...filmRequests(), ...mediaRequests(filmPage)]);
  const report = {};
  const hits = await runProviders(['cuevana3'], film.title, film, film.title, report);
  assert.equal(report.cuevana3.accepted, 1);
  assert.deepEqual(hits.map(({ provider, title, directUrl, audioLabel, verification, resolution }) => ({ provider, title, directUrl, audioLabel, verification, resolution })),
    [{ provider: 'cuevana3', title: 'Matrix', directUrl: media, audioLabel: 'Latino', verification: 'manifest-ok', resolution: '720p' }]);
  assert.notEqual(hits[0].url, frame);
});

test('Cuevana 3: verifica temporada, episodio y serie, con paginación acotada del listado', async (t) => {
  const otherSeason = { ...episode, _id: 77, season_number: 1, slug: 'breaking-bad-temporada-1-episodio-2' };
  const first = { ...episode, _id: 99, episode_number: 1, slug: 'breaking-bad-temporada-2-episodio-1' };
  mockRequests(t, [
    [search(series, 'tvshows'), api({ posts: [show] })],
    [listing(1), api({ posts: [first, otherSeason], pagination: { last_page: 2, next_page_url: 'https://other.example/' } })],
    [listing(2), api({ posts: [episode, { ...episode, _id: 200, show_id: '9999' }] })],
    [detail, api({ episode, serie: show })],
    [watchApi(episode._id), player(), episodePage], ...mediaRequests(episodePage),
  ]);
  assert.deepEqual(await SEARCHERS.cuevana3('', { ...series, episode: null }), { skipped: 'episode-required' });
  const hits = await SEARCHERS.cuevana3('', series);
  assert.equal(hits[0].directUrl, media);
});

test('Cuevana 3 no cae al reproductor de la serie ni acepta un episodio de otro título', async (t) => {
  mockRequests(t, [
    [search(series, 'tvshows'), api({ posts: [show] })],
    [listing(1), api({ posts: [episode] })],
    [detail, api({ episode, serie: { ...show, _id: 200, slug: 'otra-serie' } })],
  ]);
  assert.deepEqual(await SEARCHERS.cuevana3('', series), { hits: [], reason: 'no-episode' });
});

test('Cuevana 3 rechaza coincidencias ambiguas y fechas incompatibles', async (t) => {
  mockRequests(t, [[search(film, 'movies'), api({ posts: [movie, { ...movie, _id: 43, slug: 'otra-matrix-1999' }] })],
    [search(film, 'movies'), api({ posts: [{ ...movie, release_date: '2003-01-01' }] })]]);
  for (let i = 0; i < 2; i++) assert.deepEqual(await SEARCHERS.cuevana3('', film), { hits: [], reason: 'no-match' });
});

test('Cuevana 3 ignora descargas, vídeos sin doblaje y destinos o parámetros no aprobados', async (t) => {
  mockRequests(t, [[search(film, 'movies'), api({ posts: [movie] })], [watchApi(movie._id), options(
    { url: frame, lang: 'Inglés' }, { url: frame, lang: 'Latino - Subtitulado' }, { url: frame, lang: 'Latino + Inglés' },
    { url: `${frame}&u=https://other.example`, lang: 'Castellano' },
    { url: frame.replace('cuevana3.gs', 'cuevana3.gs.other.example'), lang: 'Latino' },
    { url: frame.replace('server=vimeos', 'server=other'), lang: 'Latino' },
    { url: 'https://other.example/trailer.mp4', lang: 'Latino' },
  )]]);
  assert.deepEqual(await SEARCHERS.cuevana3('', film), { hits: [], reason: 'embeds-only' });
  assert.equal(playerUrl(frame), canonical);
  assert.equal(playerUrl(frame.replace('cuevana3.gs', 'user@cuevana3.gs')), null);
});

for (const [expected, status, body] of [
  ['cdn-http-403', 403, 'Forbidden'],
  ['manifest-unavailable', 200, '<html>Este no es un manifiesto</html>'],
]) {
  test(`Cuevana 3 no anuncia el stream si el CDN devuelve ${expected}`, async (t) => {
    mockRequests(t, [...filmRequests(), ...mediaRequests(filmPage, new Response(body, { status }))]);
    assert.deepEqual(await SEARCHERS.cuevana3('', film), { hits: [], reason: expected });
  });
}
