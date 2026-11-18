'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const json = (data) => Response.json(data);
const request = async (path, env = {}) => {
  const { default: worker } = await import('../worker.mjs');
  return worker.fetch(new Request(`https://episodes.example${path}`), env, {});
};

test('una ficha TMDB personal permite pedir el stream de su episodio a una fuente por IMDb', async (t) => {
  const requests = [];
  const provider = 'https://spinflix.example';
  const providerPath = '/serie/serie-de-prueba/1/1';
  const embed = 'https://vimeos.net/embed-pilot.html';
  const master = 'https://s9.vimeos.net/hls2/fixture/pilot.m3u8';
  t.mock.method(global, 'fetch', async (input) => {
    const url = new URL(input);
    requests.push(url);
    if (url.hostname === 'api.themoviedb.org' && url.pathname === '/3/tv/901001') {
      const append = url.searchParams.get('append_to_response')?.split(',') || [];
      return json({
        name: 'Serie de prueba', first_air_date: '2024-01-02',
        ...(append.includes('external_ids') ? { external_ids: { imdb_id: 'tt9010010' } } : {}),
      });
    }
    if (url.hostname === 'v3-cinemeta.strem.io' && url.pathname === '/meta/series/tt9010010.json') {
      return json({ meta: { videos: [
        { season: 2, episode: 3, name: 'Regreso' },
        { season: 1, number: 1, name: 'Piloto', firstAired: '2024-01-02T00:00:00.000Z' },
        { season: 1, number: 1, name: 'Duplicado' },
        { season: 0, episode: 2, name: 'Especial' },
      ] } });
    }
    if (url.origin === provider) {
      if (url.pathname === '/search') return json({ results: [
        { slug: 'serie-de-prueba', type: 'tvshows', title: 'Serie de prueba', year: '2024' },
      ] });
      if (url.pathname === '/serie/serie-de-prueba') return json({ imdb_id: 'tt9010010' });
      if (url.pathname === providerPath) return json({
        season: 1, episode: 1, embeds: { video: [{ language: 'Latino', link: embed }] },
      });
      if (url.pathname === '/streamurl' && url.searchParams.get('url') === embed) return json({ videos: { hls: [master] } });
    }
    if (url.href === master) {
      return new Response('#EXTM3U\n#EXTINF:1,\npilot.ts\n');
    }
    throw new Error(`Petición inesperada: ${url.hostname}${url.pathname}`);
  });
  const env = { TMDB_API_KEY: 'mock', SPINFLIX_URL: provider };
  // La instalación es anterior al retiro y tenía SpinFlix y PlayLatinSRC.
  const prefix = '/' + Buffer.from(JSON.stringify({ region: 'MX', streams: ['playlatin', 'spinflix'] })).toString('base64url');
  const metaResponse = await request(`${prefix}/meta/series/tmdb:tv:901001.json`, env);
  assert.equal(metaResponse.status, 200);
  const { meta } = await metaResponse.json();
  assert.equal(meta.id, 'tmdb:tv:901001');
  assert.deepEqual(meta.videos.map((video) => video.id), ['tmdb:tv:901001:1:1', 'tmdb:tv:901001:2:3']);
  assert.equal(meta.videos[0].title, 'Piloto');
  assert.equal(meta.videos[0].released, '2024-01-02T00:00:00.000Z');

  const episodeId = encodeURIComponent(meta.videos[0].id);
  const streamResponse = await request(`${prefix}/stream/series/${episodeId}.json`, env);
  assert.equal(streamResponse.status, 200);
  const { streams } = await streamResponse.json();
  assert.deepEqual(streams.map((stream) => stream.url), [master]);
  assert.match(streams[0].title, /S01E01.*Latino.*SpinFlix/);
  assert.deepEqual(requests.filter((url) => url.origin === provider).map((url) => url.pathname), [
    '/search', '/serie/serie-de-prueba', providerPath, '/streamurl',
  ]);
  assert.deepEqual([...new Set(requests.map((url) => url.hostname))].sort(), [
    'api.themoviedb.org', 's9.vimeos.net', 'spinflix.example', 'v3-cinemeta.strem.io',
  ]);
});

test('sin IMDb usa los episodios de TMDB y no cachea una ficha sin episodios por un fallo transitorio', async (t) => {
  let seasonCalls = 0;
  t.mock.method(global, 'fetch', async (input) => {
    const url = new URL(input);
    if (url.pathname === '/3/tv/901002') {
      return json({ name: 'Miniserie', seasons: [
        { season_number: 0, episode_count: 1 }, { season_number: 2, episode_count: 2 },
      ] });
    }
    if (url.pathname === '/3/tv/901002/season/2' && ++seasonCalls > 1) {
      return json({ episodes: [{ season_number: 2, episode_number: 5, name: 'Quinto', air_date: '2025-01-01' }] });
    }
    return new Response(null, { status: 503 });
  });
  const path = '/meta/series/tmdb:901002.json';
  const env = { TMDB_API_KEY: 'mock' };
  const failed = await request(path, env);
  assert.equal(failed.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await failed.json()).meta.videos, []);
  const recovered = await request(path, env);
  assert.deepEqual((await recovered.json()).meta.videos, [{
    id: 'tmdb:901002:2:5', season: 2, episode: 5, title: 'Quinto', released: '2025-01-01T00:00:00.000Z',
  }]);
  assert.equal(seasonCalls, 2);
});

test('una ficha TVMaze incluye episodios numerados con su ID de catálogo', async (t) => {
  t.mock.method(global, 'fetch', async (input) => {
    const url = new URL(input);
    if (url.hostname === 'api.tvmaze.com' && url.pathname === '/shows/901003') {
      return json({ id: 901003, name: 'Serie de TVMaze' });
    }
    if (url.hostname === 'api.tvmaze.com' && url.pathname === '/shows/901003/episodes') {
      return json([{ season: 1, number: null }, { season: 2, number: 4, name: 'Cuarto', summary: '<p>Sinopsis</p>' }]);
    }
    throw new Error(`Petición inesperada: ${url.hostname}${url.pathname}`);
  });
  const response = await request('/meta/series/tvmaze:901003.json');
  const { meta } = await response.json();
  assert.deepEqual(meta.videos, [{ id: 'tvmaze:901003:2:4', season: 2, episode: 4, title: 'Cuarto', overview: 'Sinopsis' }]);
});
