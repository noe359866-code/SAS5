'use strict';

/**
 * Pruebas del adaptador de cuevanas3.pro.
 *
 * Los JSON de `test/fixtures/sites/cuevanas3-*.json` y el HTML
 * `cuevanas3-embed.html` son respuestas reales medidas el 19-11-2026 con
 * `scripts/cuevanas3-api-probe.mjs`, con la query firmada de los enlaces
 * recortada. No hay red: `fetch` se sustituye por un mapa de rutas.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const cuevana = require('../lib/sites/cuevanas3');
const cache = require('../lib/cache');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'sites', name), 'utf8');
const SEARCH = JSON.parse(fixture('cuevanas3-search.json'));
const PLAYER = JSON.parse(fixture('cuevanas3-player.json'));
const EPISODES = JSON.parse(fixture('cuevanas3-episodes.json'));
const EMBED_HTML = fixture('cuevanas3-embed.html');

const MASTER = 'https://s9.vimeos.net/hls2/02/00005/ccjygcfxujhd_,n,h,.urlset/master.m3u8';
const VIMEOS = 'https://vimeos.net/embed-2nulhg4mnuz7.html';

/** Embed empaquetado con Dean Edwards, como lo sirve vimeos.net. */
function packedEmbed(master) {
  return `<html><body><script>eval(function(p,a,c,k,e,d){e=function(c){return c};if(!''.replace(/^/,String)){while(c--){d[c]=k[c]||c}k=[function(e){return d[e]}];e=function(){return'\\\\w+'};c=1};while(c--){if(k[c]){p=p.replace(new RegExp('\\\\b'+e(c)+'\\\\b','g'),k[c])}}return p}('0',1,1,'${master}'.split('|')))</script></body></html>`;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}
const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

function stub(routes) {
  cache.deletePrefix('cuevanas3:');
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

const MOVIE = { title: 'Spider-Man: Un nuevo día', altTitle: 'Spider-Man: Brand New Day', year: 2026, mediaType: 'movie' };
const SERIES = { title: 'Spider-Man de Marvel', year: 2017, mediaType: 'series', season: 1, episode: 2 };

// ── Identidad ─────────────────────────────────────────────────────────────

test('cuevanas3: la ficha se elige por título y año, no por la primera coincidencia', () => {
  const post = cuevana.pickPost(SEARCH.data.posts, MOVIE);
  assert.equal(post._id, 57851);
  assert.equal(post.type, 'movies');
});

test('cuevanas3: un año distinto descarta la ficha aunque el título coincida', () => {
  assert.equal(cuevana.pickPost(SEARCH.data.posts, { ...MOVIE, year: 2019 }), null);
  // La misma obra aparece como `animes` y como `tvshows`: para una serie se
  // prefiere la ficha de serie, no la de anime.
  const serie = cuevana.pickPost(SEARCH.data.posts, SERIES);
  assert.equal(serie._id, 51128);
  assert.equal(serie.type, 'tvshows');
  // Y una película nunca se resuelve con la ficha de una serie.
  const soloSeries = SEARCH.data.posts.filter((post) => post.type !== 'movies');
  assert.equal(cuevana.pickPost(soloSeries, MOVIE), null);
});

test('cuevanas3: los animes cuentan como series', () => {
  const posts = [{ _id: 7, title: 'Naruto (2002)', type: 'animes', release_date: '2002-10-03' }];
  assert.equal(cuevana.pickPost(posts, { ...SERIES, title: 'Naruto', year: 2002 })._id, 7);
  assert.equal(cuevana.pickPost(posts, MOVIE), null);
});

test('cuevanas3: el episodio se elige por temporada y número, no por posición', () => {
  const episode = cuevana.pickEpisode(EPISODES.data.posts, SERIES);
  assert.equal(episode._id, 59166);
  assert.equal(cuevana.pickEpisode(EPISODES.data.posts, { ...SERIES, episode: 99 }), null);
});

test('cuevanas3: «Latino - Inglés» declara el doblaje latino y no el inglés', () => {
  assert.equal(cuevana.audioOf({ language: 'Latino - Inglés' }), 'Latino');
  assert.equal(cuevana.audioOf({ language: 'Castellano' }), 'Castellano');
  assert.equal(cuevana.audioOf({ language: 'Subtitulado' }), 'Subtitulado');
  assert.equal(cuevana.audioOf({ language: 'Japonés' }), 'Japonés');
  assert.equal(cuevana.audioOf({}), '');
});

// ── Salto intermedio → visor ──────────────────────────────────────────────

test('cuevanas3: el player.php real se resuelve al iframe de Vimeos', () => {
  const frames = cuevana.frameUrls(EMBED_HTML, 'https://cuevana3.gs/player.php?h=1');
  assert.deepEqual(frames, [VIMEOS]);
});

test('cuevanas3: un enlace que ya es un visor conocido no gasta una petición', async () => {
  const stubbed = stub([]);
  try {
    assert.deepEqual(await cuevana.framesOf(null, VIMEOS, 'https://cuevanas3.pro/'), [VIMEOS]);
    assert.equal(stubbed.calls.length, 0);
  } finally { stubbed.restore(); }
});

// ── Recorrido completo ────────────────────────────────────────────────────

test('cuevanas3 película: búsqueda → player → player.php → Vimeos → HLS', async () => {
  const stubbed = stub([
    ['/wp-api/v1/search', json(SEARCH)],
    ['/wp-api/v1/player?postId=57851', json(PLAYER)],
    ['cuevana3.gs/player.php', html(EMBED_HTML)],
    ['vimeos.net/embed-', html(packedEmbed(MASTER))],
  ]);
  try {
    const out = await cuevana.searchCuevanas3('Spider-Man Un nuevo día', MOVIE, MOVIE.title, 5000);
    assert.equal(out.hits.length, 1);
    const hit = out.hits[0];
    assert.equal(hit.provider, 'cuevanas3');
    assert.equal(hit.url, MASTER);
    assert.equal(hit.quality, 'HLS');
    assert.equal(hit.audioLabel, 'Latino');
    assert.match(hit.title, /Cuevana3$/);
    // Se pidió el player con el _id de la ficha correcta, no con el del buscador.
    assert.ok(stubbed.calls.some((url) => url.includes('/player?postId=57851')));
    assert.equal(stubbed.calls.filter((url) => url.includes('/search')).length, 1);
  } finally { stubbed.restore(); }
});

test('cuevanas3 serie: lista de episodios y player del episodio pedido', async () => {
  const stubbed = stub([
    ['/wp-api/v1/search', json({ data: { posts: [{ _id: 51128, title: 'Spider-Man de Marvel (2017)', type: 'tvshows', release_date: '2017-08-19' }] } })],
    ['/single/episodes/list', json(EPISODES)],
    ['/wp-api/v1/player?postId=59166', json(PLAYER)],
    ['cuevana3.gs/player.php', html(EMBED_HTML)],
    ['vimeos.net/embed-', html(packedEmbed(MASTER))],
  ]);
  try {
    const out = await cuevana.searchCuevanas3('Spider-Man de Marvel', SERIES, SERIES.title, 5000);
    assert.equal(out.hits.length, 1);
    assert.match(out.hits[0].title, /S1E2/);
    assert.ok(stubbed.calls.some((url) => url.includes('season=1')));
    assert.ok(stubbed.calls.some((url) => url.includes('/player?postId=59166')));
  } finally { stubbed.restore(); }
});

test('cuevanas3: una serie sin el episodio pedido no inventa hits', async () => {
  const stubbed = stub([
    ['/wp-api/v1/search', json({ data: { posts: [{ _id: 51128, title: 'Spider-Man de Marvel (2017)', type: 'tvshows', release_date: '2017-08-19' }] } })],
    ['/single/episodes/list', json(EPISODES)],
  ]);
  try {
    const out = await cuevana.searchCuevanas3('Spider-Man de Marvel', { ...SERIES, episode: 40 }, SERIES.title, 5000);
    assert.deepEqual(out.hits, []);
    assert.equal(out.reason, 'no-episode');
  } finally { stubbed.restore(); }
});

test('cuevanas3: sin coincidencia de título no se abre ningún player', async () => {
  const stubbed = stub([['/wp-api/v1/search', json(SEARCH)]]);
  try {
    const out = await cuevana.searchCuevanas3('Otra película', { ...MOVIE, title: 'Otra película', altTitle: '' }, 'Otra película', 5000);
    assert.deepEqual(out.hits, []);
    assert.equal(out.reason, 'no-match');
    assert.equal(stubbed.calls.filter((url) => url.includes('/player')).length, 0);
  } finally { stubbed.restore(); }
});

test('cuevanas3: un embed sin visor extraíble se cuenta como opaco y no produce hits', async () => {
  const stubbed = stub([
    ['/wp-api/v1/search', json(SEARCH)],
    ['/wp-api/v1/player?postId=57851', json(PLAYER)],
    ['cuevana3.gs/player.php', html('<html><body><iframe src="https://streamwish.to/e/abc"></iframe></body></html>')],
  ]);
  try {
    const out = await cuevana.searchCuevanas3('Spider-Man Un nuevo día', MOVIE, MOVIE.title, 5000);
    assert.deepEqual(out.hits, []);
    assert.equal(out.reason, 'no-extractable-embed');
    assert.equal(out.notes.opaque, 1);
  } finally { stubbed.restore(); }
});

test('cuevanas3: un 404 del player no lanza, degrada a no-players', async () => {
  const stubbed = stub([
    ['/wp-api/v1/search', json(SEARCH)],
    ['/wp-api/v1/player', json({ error: true, message: 'Invalid ID' })],
  ]);
  try {
    const out = await cuevana.searchCuevanas3('Spider-Man Un nuevo día', MOVIE, MOVIE.title, 5000);
    assert.deepEqual(out.hits, []);
    assert.equal(out.reason, 'no-players');
  } finally { stubbed.restore(); }
});

test('cuevanas3: sin identidad resuelta no se hacen peticiones', async () => {
  const stubbed = stub([]);
  try {
    assert.deepEqual(await cuevana.searchCuevanas3('x', null, 'x', 5000), { skipped: 'identity-required' });
    assert.equal(stubbed.calls.length, 0);
  } finally { stubbed.restore(); }
});
