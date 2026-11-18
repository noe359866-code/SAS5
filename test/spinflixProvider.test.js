'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runProviders } = require('../lib/streams');
const { searchSpinFlix } = require('../lib/spinflix');

const BASE = 'https://lamoviebot.tvymas.workers.dev';
const PLAYLIST = '#EXTM3U\n#EXTINF:1,\nvideo.ts\n';

test('SpinFlix verifica la ficha y devuelve solo HLS con doblaje válido', async (t) => {
  const master = 'https://s9.vimeos.net/fixture/master.m3u8';
  const embed = 'https://vimeos.net/embed-fixture';
  const movie = { imdb_id: 'tt900101', title: 'Prueba SpinFlix', year: 2025, slug: 'prueba-spinflix', type: 'movies' };
  const calls = [];
  t.mock.method(global, 'fetch', async (raw, init) => {
    const url = new URL(raw);
    calls.push(url.pathname);
    assert.equal(init.redirect, 'manual');
    if (url.pathname === '/search') return Response.json({ results: [movie] });
    if (url.pathname === '/pelicula/prueba-spinflix') return Response.json({ ...movie, embeds: { video: [
      { link: 'https://vimeos.net/embed-english', language: 'Inglés' },
      { link: 'https://vimeos.net.evil.example/embed', language: 'Latino' },
      { link: embed, language: 'Castellano' },
    ] } });
    if (raw === master) return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=1728x720\nv720.m3u8');
    assert.equal(url.pathname, '/streamurl');
    assert.equal(url.searchParams.get('url'), embed);
    return Response.json({ qualities: [{ url: master }] });
  });
  const resolved = { title: movie.title, year: '2025', mediaType: 'movie', imdbId: movie.imdb_id };
  const hits = await runProviders(['spinflix'], movie.title, resolved, movie.title, {});
  assert.deepEqual(calls, ['/search', '/pelicula/prueba-spinflix', '/streamurl', '/fixture/master.m3u8']);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].provider, 'spinflix');
  assert.equal(hits[0].audioLabel, 'Castellano');
  assert.equal(hits[0].url, master);
  assert.equal(hits[0].resolution, '720p');
});

test('SpinFlix: consulta sin artículo pero valida el título entero y el año de la ficha', async (t) => {
  const item = { title: 'Círculo (1999)', slug: 'circulo-1999', type: 'movies' };
  const master = 'https://s9.vimeos.net/hls2/fixture/circulo.m3u8';
  const queries = [];
  const details = [];
  t.mock.method(global, 'fetch', async (raw) => {
    const url = new URL(raw);
    if (url.href === master) return new Response(PLAYLIST);
    assert.equal(url.origin, BASE);
    if (url.pathname === '/search') {
      queries.push(url.searchParams.get('q'));
      const unrelated = ['Otra obra', 'Falso positivo', 'Círculo recargado'].map((title, i) => ({ title, slug: `vecino-${i}`, year: 1999, type: 'movies' }));
      return Response.json({ results: queries.at(-1) === 'Círculo' ? [...unrelated, item] : unrelated });
    }
    details.push(url.pathname);
    assert.equal(url.pathname, '/pelicula/circulo-1999');
    return Response.json({ ...item, imdb_id: 'N/A', embeds: { video: [{ language: 'Latino', stream_url: master }] } });
  });
  const resolved = { title: 'El Círculo', year: '1999', mediaType: 'movie', imdbId: 'tt99901234' };
  const { hits } = await searchSpinFlix('', resolved, resolved.title);
  assert.deepEqual(queries, ['El Círculo', 'Círculo']);
  assert.deepEqual(details, ['/pelicula/circulo-1999']);
  assert.deepEqual(hits.map(({ url, verification }) => [url, verification]), [[master, 'manifest-ok']]);
});

test('SpinFlix: verifica IMDb y continúa con otra ficha exacta si el episodio no existe', async (t) => {
  const show = { title: 'Serie de control', type: 'tvshows', year: 2008, tmdb_id: 81234 };
  const exact = 'tt900018234';
  const master = 'https://s9.vimeos.net/hls2/fixture/exact-episode.m3u8';
  const episodes = [];
  const details = [];
  t.mock.method(global, 'fetch', async (raw) => {
    const url = new URL(raw);
    if (url.href === master) return new Response(PLAYLIST);
    assert.equal(url.origin, BASE);
    if (url.pathname === '/search') return Response.json({ results: [
      { ...show, slug: 'id-confundido' }, { ...show, slug: 'sin-episodio' },
      { ...show, slug: 'sin-episodio' }, { ...show, slug: 'con-episodio' },
    ] });
    if (url.pathname.match(/^\/serie\/[^/]+$/)) {
      details.push(url.pathname);
      return Response.json({ ...show, imdb_id: url.pathname.endsWith('id-confundido') ? 'tt900018235' : exact });
    }
    episodes.push(url.pathname);
    if (url.pathname === '/serie/sin-episodio/2/3') return new Response(null, { status: 404 });
    assert.equal(url.pathname, '/serie/con-episodio/2/3');
    return Response.json({ season_number: 2, episode_number: 3, embeds: { video: [{ language: 'Castellano', stream_url: master }] } });
  });
  const resolved = { title: show.title, year: '2008', mediaType: 'series', season: 2, episode: 3, imdbId: exact, tmdbId: show.tmdb_id };
  const { hits } = await searchSpinFlix('', resolved, resolved.title);
  assert.deepEqual(details, ['/serie/id-confundido', '/serie/sin-episodio', '/serie/con-episodio']);
  assert.deepEqual(episodes, ['/serie/sin-episodio/2/3', '/serie/con-episodio/2/3']);
  assert.match(hits[0].title, /S02E03.*Castellano/);
  assert.equal(hits[0].url, master);
});

test('SpinFlix: filtra antes del límite y busca un HLS distinto si el del resolver no se verifica', async (t) => {
  const movie = { title: 'Control de resolver', slug: 'control-de-resolver', year: 2025, type: 'movies' };
  const embed = 'https://vimeos.net/embed-fixture-alternativa.html';
  const dead = 'https://s9.vimeos.net/hls2/fixture/denied.m3u8';
  const master = 'https://s9.vimeos.net/hls2/fixture/working.m3u8';
  const expired = 'https://s9.vimeos.net/hls2/fixture/expired.m3u8?s=1600000000&e=60';
  const mp4 = 'https://s9.vimeos.net/hls2/fixture/not-hls.mp4';
  const requests = [];
  t.mock.method(global, 'fetch', async (raw) => {
    const url = new URL(raw);
    requests.push(url.href);
    if (url.pathname === '/search') return Response.json({ results: [movie] });
    if (url.pathname === '/pelicula/control-de-resolver') return Response.json({ ...movie, embeds: { video: [
      { language: 'Latino + ENG', link: 'https://vimeos.net/embed-eng' },
      { language: 'Subtitulado', link: 'https://vimeos.net/embed-sub' },
      { language: 'Latino', link: 'https://vimeos.net.evil.example/embed' },
      { language: 'Latino', link: embed },
      { language: 'Latino', link: embed },
    ] } });
    if (url.pathname === '/streamurl') return Response.json({ qualities: [{ url: mp4 }, { url: expired }, { url: dead }] });
    if (url.href === dead) return new Response(null, { status: 403 });
    if (url.href === embed) return new Response(`<script>const files=['${dead}', '${expired}', '${master}']</script>`);
    if (url.href === master) return new Response(PLAYLIST);
    throw new Error('Petición inesperada');
  });
  const resolved = { title: movie.title, year: '2025', mediaType: 'movie' };
  const { hits } = await searchSpinFlix('', resolved, resolved.title);
  assert.deepEqual(hits.map(({ url, verification }) => [url, verification]), [[master, 'manifest-ok']]);
  assert.deepEqual(requests.slice(3), [dead, embed, master]);
  assert.equal(new URL(requests[2]).searchParams.get('url'), embed);
});

test('SpinFlix: no publica un stream_url inválido y vuelve a leer la ficha si cambia la URL', async (t) => {
  const movie = { title: 'Enlace no comprobado', slug: 'enlace-no-comprobado', year: 2025, type: 'movies' };
  const dead = 'https://s9.vimeos.net/hls2/fixture/invalid.m3u8';
  const fresh = 'https://s9.vimeos.net/hls2/fixture/refreshed.m3u8';
  const calls = [];
  let current = dead;
  t.mock.method(global, 'fetch', async (raw) => {
    const url = new URL(raw);
    calls.push(url.pathname);
    if (url.pathname === '/search') return Response.json({ results: [movie] });
    if (url.pathname === '/pelicula/enlace-no-comprobado') return Response.json({ ...movie, embeds: { video: [{ language: 'Latino', stream_url: current }] } });
    if (url.href === fresh) return new Response(PLAYLIST);
    return new Response('<html>No es un manifiesto</html>');
  });
  const resolved = { title: movie.title, year: '2025', mediaType: 'movie' };
  const out = await searchSpinFlix('', resolved, resolved.title);
  assert.deepEqual(out.hits, []);
  assert.equal(out.reason, 'no-compatible-media');
  assert.deepEqual(calls, ['/search', '/pelicula/enlace-no-comprobado', '/hls2/fixture/invalid.m3u8']);

  current = fresh;
  const afterRefresh = await searchSpinFlix('', resolved, resolved.title);
  assert.deepEqual(afterRefresh.hits.map((hit) => hit.url), [fresh]);
  assert.equal(calls.filter((path) => path === '/pelicula/enlace-no-comprobado').length, 2);
});

test('SpinFlix: un rechazo del resolver detiene la búsqueda en vez de consultar el visor', async (t) => {
  const movie = { title: 'Control de acceso', slug: 'control-de-acceso', type: 'movies' };
  const calls = [];
  t.mock.method(global, 'fetch', async (raw) => {
    const url = new URL(raw);
    calls.push(url.pathname);
    if (url.pathname === '/search') return Response.json({ results: [movie] });
    if (url.pathname === '/pelicula/control-de-acceso') return Response.json({ ...movie, embeds: { video: [{ language: 'Latino', link: 'https://vimeos.net/embed-denied' }] } });
    return new Response(null, { status: 403 });
  });
  const resolved = { title: movie.title, mediaType: 'movie' };
  await assert.rejects(() => searchSpinFlix('', resolved, resolved.title), { status: 403 });
  assert.deepEqual(calls, ['/search', '/pelicula/control-de-acceso', '/streamurl']);
});

test('SpinFlix: un error 500 de una ficha no se informa como sin coincidencias', async (t) => {
  const item = { title: 'Prueba de fallo', slug: 'prueba-de-fallo', type: 'movies', year: 2025 };
  t.mock.method(global, 'fetch', async (raw) => {
    if (new URL(raw).pathname === '/search') return Response.json({ results: [item] });
    return new Response('error', { status: 500 });
  });
  await assert.rejects(searchSpinFlix('', { title: item.title, year: '2025', mediaType: 'movie' }, item.title, 1000), { status: 500 });
});
