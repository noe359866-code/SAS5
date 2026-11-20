'use strict';

/**
 * Pruebas de Allpelículas (`allpeliculas.la`) y LaMovie (`lamovie.org`).
 *
 * Los JSON de `test/fixtures/sites/allpeliculas-*.json` y `lamovie-*.json` son
 * respuestas reales medidas el 20-11-2026 con `scripts/fixtures-capture.mjs`
 * (búsqueda de *The Pitt* y de *La Odisea*, listado de la temporada 1 y los
 * reproductores). El HTML del visor no se versiona: Vimeos lo sirve empaquetado
 * y la prueba construye ese paquete con el manifiesto simulado, igual que
 * `test/cuevanas3.test.js`.
 *
 * No hay red: `fetch` se sustituye por un mapa de rutas.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const allpeliculas = require('../lib/sites/allpeliculas');
const lamovie = require('../lib/sites/lamovie');
const cache = require('../lib/cache');

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sites', name), 'utf8'));
const SEARCH_SERIE = fixture('allpeliculas-search-serie.json');
const SEARCH_PELICULA = fixture('allpeliculas-search-pelicula.json');
const EPISODES = fixture('allpeliculas-episodes.json');
const PLAYER_EPISODIO = fixture('allpeliculas-player-episodio.json');
const PLAYER_PELICULA = fixture('allpeliculas-player-pelicula.json');
const LAMOVIE_SERIE = fixture('lamovie-search-serie.json');
const LAMOVIE_EPISODES = fixture('lamovie-episodes.json');
const LAMOVIE_PLAYER = fixture('lamovie-player-episodio.json');

const MASTER = 'https://s9.vimeos.net/hls2/02/00005/ccjygcfxujhd_,n,h,.urlset/master.m3u8';
const VIMEOS_EPISODIO = 'https://vimeos.net/embed-0ox61hi704mt.html';

/** Embed empaquetado con Dean Edwards, como lo sirve vimeos.net. */
function packedEmbed(master) {
  return `<html><body><script>eval(function(p,a,c,k,e,d){e=function(c){return c};if(!''.replace(/^/,String)){while(c--){d[c]=k[c]||c}k=[function(e){return d[e]}];e=function(){return'\\w+'};c=1};while(c--){if(k[c]){p=p.replace(new RegExp('\\b'+e(c)+'\\b','g'),k[c])}}return p}('0',1,1,'${master}'.split('|')))</script></body></html>`;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}
const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

function stub(routes, prefixes = ['allpeliculas:', 'lamovie:', 'cuevanas3:']) {
  for (const prefix of prefixes) cache.deletePrefix(prefix);
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url) => {
    const target = String(url);
    calls.push(target);
    for (const [needle, reply] of routes) {
      if (!target.includes(needle)) continue;
      return typeof reply === 'function' ? reply(target) : reply;
    }
    if (target === MASTER) return new Response('#EXTM3U\n');
    return json({ message: 'not found' }, 404);
  };
  return { calls, restore: () => { global.fetch = original; } };
}

const PELICULA = { title: 'La Odisea', year: 2026, mediaType: 'movie' };
const SERIE = { title: 'The Pitt', year: 2025, mediaType: 'series', season: 1, episode: 1 };

// ── Identidad ─────────────────────────────────────────────────────────────

test('allpeliculas: la película se elige por título y año entre tres «Odiseas»', () => {
  const post = allpeliculas.pickPost(SEARCH_PELICULA.data.posts, PELICULA);
  assert.equal(post._id, 52912);
  assert.equal(post.title, 'La Odisea (2026)');
});

test('allpeliculas: un año que no coincide descarta la ficha; sin año pedido se acepta la mejor', () => {
  assert.equal(allpeliculas.pickPost(SEARCH_PELICULA.data.posts, { ...PELICULA, year: 1997 }), null);
  assert.equal(allpeliculas.pickPost(SEARCH_PELICULA.data.posts, { ...PELICULA, year: null })._id, 52912);
});

test('allpeliculas: una serie no se sirve con una ficha de película', () => {
  assert.equal(allpeliculas.pickPost(SEARCH_PELICULA.data.posts, SERIE), null);
  assert.equal(allpeliculas.pickPost(SEARCH_SERIE.data.posts, SERIE)._id, 25427);
});

test('allpeliculas: el episodio se busca por temporada y número, no por posición', () => {
  const episode = allpeliculas.pickEpisode(EPISODES.data.posts, SERIE);
  assert.equal(episode._id, 25434);
  assert.equal(allpeliculas.pickEpisode(EPISODES.data.posts, { ...SERIE, episode: 40 }), null);
});

// ── Audio declarado ───────────────────────────────────────────────────────

test('allpeliculas: el idioma del embed se declara aunque venga mezclado', () => {
  assert.equal(allpeliculas.audioOf({ lang: 'Latino' }), 'Latino');
  assert.equal(allpeliculas.audioOf({ lang: 'latino - inglés' }), 'Latino');
  assert.equal(allpeliculas.audioOf({ lang: 'Castellano' }), 'Castellano');
  assert.equal(allpeliculas.audioOf({ lang: 'Subtitulado' }), 'Subtitulado');
  assert.equal(allpeliculas.audioOf({}), '');
});

// ── Recorrido completo ────────────────────────────────────────────────────

test('allpeliculas película: búsqueda → player → Vimeos → HLS', async () => {
  const stubbed = stub([
    ['/wp-api/v1/search', json(SEARCH_PELICULA)],
    ['/wp-api/v1/player?postId=52912', json(PLAYER_PELICULA)],
    ['vimeos.net/embed-', html(packedEmbed(MASTER))],
  ]);
  try {
    const out = await allpeliculas.searchAllpeliculas('La Odisea', PELICULA, PELICULA.title, 5000);
    assert.equal(out.hits.length, 1);
    const hit = out.hits[0];
    assert.equal(hit.provider, 'allpeliculas');
    assert.equal(hit.url, MASTER);
    assert.equal(hit.quality, 'HLS');
    assert.equal(hit.audioLabel, 'Latino');
    assert.match(hit.title, /Allpelículas$/);
    assert.ok(stubbed.calls.some((url) => url.includes('/player?postId=52912')));
  } finally { stubbed.restore(); }
});

test('allpeliculas: la ficha con el título pegado («IntensaMente 2») se acepta', () => {
  // Payload real del buscador medido el 20-11-2026 con la consulta
  // «Intensamente 2»; el addon pide «Intensa-Mente 2», el título de TMDB.
  const posts = [{ _id: 99001, title: 'IntensaMente 2 (2024)', type: 'movies', release_date: '2024-06-13' }];
  const pedida = { title: 'Intensa-Mente 2', altTitle: 'Inside Out 2', year: '2024', mediaType: 'movie' };
  assert.equal(allpeliculas.pickPost(posts, pedida)._id, 99001);
  // Y la variante pegada es la que se consulta, no el título con guion.
  const { titleQueries } = require('../lib/providerTitles');
  assert.ok(titleQueries([pedida.title, pedida.altTitle]).includes('IntensaMente 2'));
});

test('allpeliculas: la consulta con el guion quitado llega al buscador', async () => {
  const stubbed = stub([['/wp-api/v1/search', json({ data: { posts: [] } })]]);
  try {
    await allpeliculas.searchAllpeliculas('Intensa-Mente 2',
      { title: 'Intensa-Mente 2', year: '2024', mediaType: 'movie' }, 'Intensa-Mente 2', 5000);
    assert.ok(stubbed.calls.some((url) => /q=IntensaMente\+2|q=IntensaMente%202/.test(url)), stubbed.calls.join('\n'));
  } finally { stubbed.restore(); }
});

test('allpeliculas: una película que cae en la segunda página del buscador también aparece', async () => {
  // «El Origen» llena la primera página con otros títulos que también lo
  // llevan; la película de 2010 está en la siguiente.
  const primera = { data: { posts: [{ _id: 700, title: 'El Origen de los vampiros (2025)', type: 'movies', release_date: '2025-02-01' }] } };
  const segunda = { data: { posts: [{ _id: 701, title: 'Origen (2010)', type: 'movies', release_date: '2010-07-16' }] } };
  const stubbed = stub([
    ['page=2', json(segunda)],
    ['/wp-api/v1/search', json(primera)],
    ['/wp-api/v1/player?postId=701', json(PLAYER_PELICULA)],
    ['vimeos.net/embed-', html(packedEmbed(MASTER))],
  ]);
  try {
    const pedida = { title: 'El Origen', altTitle: 'Inception', year: '2010', mediaType: 'movie' };
    const out = await allpeliculas.searchAllpeliculas('El Origen', pedida, pedida.title, 5000);
    assert.equal(out.hits.length, 1, `hits=${out.hits.length} ${out.reason}`);
    assert.ok(stubbed.calls.some((url) => url.includes('page=2')));
  } finally { stubbed.restore(); }
});

test('allpeliculas serie: lista de episodios y player del 1x1', async () => {
  const stubbed = stub([
    ['/wp-api/v1/search', json(SEARCH_SERIE)],
    ['/single/episodes/list', json(EPISODES)],
    ['/wp-api/v1/player?postId=25434', json(PLAYER_EPISODIO)],
    ['vimeos.net/embed-', html(packedEmbed(MASTER))],
  ]);
  try {
    const out = await allpeliculas.searchAllpeliculas('The Pitt', SERIE, SERIE.title, 5000);
    assert.equal(out.hits.length, 1);
    assert.match(out.hits[0].title, /S1E1/);
    assert.equal(out.hits[0].audioLabel, 'Latino');
    assert.ok(stubbed.calls.some((url) => url.includes('season=1')));
    assert.ok(stubbed.calls.some((url) => url.includes('/player?postId=25434')));
  } finally { stubbed.restore(); }
});

test('allpeliculas: una serie sin el episodio pedido no inventa hits', async () => {
  const stubbed = stub([
    ['/wp-api/v1/search', json(SEARCH_SERIE)],
    ['/single/episodes/list', json(EPISODES)],
  ]);
  try {
    const out = await allpeliculas.searchAllpeliculas('The Pitt', { ...SERIE, episode: 40 }, SERIE.title, 5000);
    assert.deepEqual(out.hits, []);
    assert.equal(out.reason, 'no-episode');
  } finally { stubbed.restore(); }
});

test('allpeliculas: sin coincidencia de título no se abre ningún player', async () => {
  const stubbed = stub([['/wp-api/v1/search', json(SEARCH_SERIE)]]);
  try {
    const out = await allpeliculas.searchAllpeliculas('Otra serie', { ...SERIE, title: 'Otra serie', altTitle: '' }, 'Otra serie', 5000);
    assert.deepEqual(out.hits, []);
    assert.equal(out.reason, 'no-match');
    assert.equal(stubbed.calls.filter((url) => url.includes('/player')).length, 0);
  } finally { stubbed.restore(); }
});

test('allpeliculas: sin identidad o sin episodio no se consulta la API', async () => {
  const stubbed = stub([]);
  try {
    assert.deepEqual(await allpeliculas.searchAllpeliculas('x', null, 'x', 5000), { skipped: 'identity-required' });
    assert.deepEqual(await allpeliculas.searchAllpeliculas('x', { ...SERIE, episode: 0 }, 'The Pitt', 5000), { skipped: 'episode-required' });
    assert.equal(stubbed.calls.length, 0);
  } finally { stubbed.restore(); }
});

// ── LaMovie: misma familia, otra base ─────────────────────────────────────

test('lamovie: cadena completa contra su propio dominio', async () => {
  const stubbed = stub([
    ['lamovie.org/wp-api/v1/search', json(LAMOVIE_SERIE)],
    ['/single/episodes/list', json(LAMOVIE_EPISODES)],
    ['/wp-api/v1/player?postId=', json(LAMOVIE_PLAYER)],
    ['vimeos.net/embed-', html(packedEmbed(MASTER))],
  ]);
  try {
    const out = await lamovie.searchLamovie('The Pitt', SERIE, SERIE.title, 5000);
    assert.equal(out.hits.length, 1);
    assert.equal(out.hits[0].provider, 'lamovie');
    assert.equal(out.hits[0].audioLabel, 'Latino');
    assert.match(out.hits[0].title, /LaMovie$/);
    assert.ok(stubbed.calls.every((url) => !url.includes('allpeliculas')));
    assert.ok(stubbed.calls.some((url) => url.includes('lamovie.org/wp-api/v1/search')));
  } finally { stubbed.restore(); }
});

test('lamovie: un visor Vimeos que no publica medio no produce hits', async () => {
  const stubbed = stub([
    ['/wp-api/v1/search', json(LAMOVIE_SERIE)],
    ['/single/episodes/list', json(LAMOVIE_EPISODES)],
    ['/wp-api/v1/player?postId=', json(LAMOVIE_PLAYER)],
    ['vimeos.net/embed-', html('<html><body>sin reproductor</body></html>')],
  ]);
  try {
    const out = await lamovie.searchLamovie('The Pitt', SERIE, SERIE.title, 5000);
    assert.deepEqual(out.hits, []);
    assert.equal(out.reason, 'no-extractable-embed');
  } finally { stubbed.restore(); }
});

test('cada instancia conserva su base y su API', () => {
  assert.equal(allpeliculas.BASE, 'https://allpeliculas.la');
  assert.equal(allpeliculas.API, 'https://allpeliculas.la/wp-api/v1');
  assert.equal(lamovie.BASE, 'https://lamovie.org');
  assert.equal(lamovie.API, 'https://lamovie.org/wp-api/v1');
});
