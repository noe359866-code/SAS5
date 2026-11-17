'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fanpelis = require('../lib/fanpelis');
const config = require('../lib/config');
const cache = require('../lib/cache');
const streams = require('../lib/streams');

const originalFetch = global.fetch;
after(() => { global.fetch = originalFetch; });

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const html = (body) => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });

const MOVIE = { title: 'Matrix', altTitle: 'The Matrix', year: '1999', mediaType: 'movie', tmdbId: 603, imdbId: 'tt0133093', season: null, episode: null };
const SERIES = { title: 'Breaking Bad', altTitle: null, year: '2008', mediaType: 'tv', tmdbId: 1396, imdbId: 'tt0903747', season: 1, episode: 1 };

const MASTER = 'https://s9.vimeos.net/hls2/02/00005/ccjygcfxujhd_,n,h,.urlset/master.m3u8';
const EMBED = 'https://vimeos.net/embed-ccjygcfxujhd.html';

/** Respuestas de la API, tal como las devolvió el servicio real (recortadas). */
const SEARCH_MOVIE = {
  error: false,
  data: { posts: [
    { _id: 18508, title: 'Matrix recargado', original_title: 'The Matrix Reloaded', release_date: '2003-05-15', type: 'movies', slug: 'matrix-recargado-2003' },
    { _id: 18507, title: 'Matrix', original_title: 'The Matrix', release_date: '1999-03-31', type: 'movies', slug: 'matrix-1999' },
    { _id: 15061, title: 'Matrix resurrecciones', original_title: 'The Matrix Resurrections', release_date: '2021-12-16', type: 'movies', slug: 'matrix-resurrecciones-2021' },
  ] },
};
const SEARCH_TV = {
  error: false,
  data: { posts: [{ _id: 20103, title: 'Breaking Bad', original_title: 'Breaking Bad', release_date: '2008-01-20', type: 'tvshows', slug: 'breaking-bad-2008' }] },
};
const EPISODES = {
  error: false,
  data: [
    { _id: 26786, title: 'Breaking Bad: Temporada 1 Episodio 1', slug: 'breaking-bad-temporada-1-episodio-1-2', season_number: 1, episode_number: 1 },
    { _id: 26785, title: 'Breaking Bad: Temporada 1 Episodio 1', slug: 'breaking-bad-temporada-1-episodio-1', season_number: 1, episode_number: 1 },
    { _id: 26787, title: 'Breaking Bad: Temporada 1 Episodio 2', slug: 'breaking-bad-temporada-1-episodio-2', season_number: 1, episode_number: 2 },
  ],
};
const PLAYER = {
  error: false,
  data: {
    embeds: [{ lang: 'Latino', quality: 'Full HD', url: EMBED }],
    downloads: [
      { url: 'https://mega.nz/file/abc', server: 'Mega', lang: 'Latino/Inglés', quality: 'Dual 1080p' },
      { url: 'magnet:?xt=urn:btih:abc', server: 'Torrent', lang: 'Latino/Inglés', quality: 'Dual 1080p' },
    ],
  },
};

/** Embed empaquetado con Dean Edwards: es lo que sirve vimeos.net de verdad. */
function packedEmbed(master) {
  // `eval(function(p,a,c,k,e,d){…}('0',1,1,'<m3u8>'.split('|')))` → '0' se
  // sustituye por el .m3u8: es la forma exacta que desempaqueta unpackPacked.
  return `<html><body><script>eval(function(p,a,c,k,e,d){e=function(c){return c};if(!''.replace(/^/,String)){while(c--){d[c]=k[c]||c}k=[function(e){return d[e]}];e=function(){return'\\\\w+'};c=1};while(c--){if(k[c]){p=p.replace(new RegExp('\\\\b'+e(c)+'\\\\b','g'),k[c])}}return p}('0',1,1,'${master}'.split('|')))</script></body></html>`;
}

function mockApi(handlers) {
  // Cada prueba empieza con la caché vacía: la clave es la URL de la API y,
  // sin esto, la segunda prueba reutilizaría la respuesta de la primera.
  cache.deletePrefix('fanpelis:');
  const calls = [];
  global.fetch = async (url, options) => {
    const u = String(url);
    calls.push(u);
    for (const [needle, reply] of handlers) {
      if (!u.includes(needle)) continue;
      return typeof reply === 'function' ? reply(u, options) : reply;
    }
    return json({}, 404);
  };
  return calls;
}

test('fanpelis película: búsqueda → player → embed → master .m3u8 por el proxy propio', async () => {
  const calls = mockApi([
    ['/api/rest/search', json(SEARCH_MOVIE)],
    ['/api/rest/player?post_id=18507', json(PLAYER)],
    ['vimeos.net/embed-', html(packedEmbed(MASTER))],
  ]);
  const originalBase = config.addonBaseUrl;
  config.addonBaseUrl = 'https://addon.example';
  try {
    const out = await fanpelis.searchFanpelis('Matrix', MOVIE, 'Matrix', 1000);
    assert.equal(out.hits.length, 1);
    const hit = out.hits[0];
    assert.equal(hit.provider, 'fanpelis');
    assert.equal(hit.relevant, true);
    assert.match(hit.title, /Matrix 1999/);
    assert.match(hit.title, /1080p/);
    assert.match(hit.title, /Latino/);
    assert.equal(hit.audioLabel, 'Latino');
    assert.equal(hit.directUrl, MASTER);
    assert.ok(hit.url.startsWith('https://addon.example/hls?ref='), hit.url);
    assert.ok(decodeURIComponent(hit.url).includes(MASTER));
    // Se eligió la ficha de 1999, no la de 2003 ni la de 2021.
    assert.ok(calls.some((u) => u.includes('post_id=18507')));
    assert.ok(!calls.some((u) => u.includes('post_id=18508')));
  } finally {
    config.addonBaseUrl = originalBase;
  }
});

test('fanpelis serie: /episodes elige el episodio y su player es el del episodio', async () => {
  const calls = mockApi([
    ['/api/rest/search', json(SEARCH_TV)],
    ['/api/rest/episodes?post_id=20103', json(EPISODES)],
    ['/api/rest/player?post_id=26785', json(PLAYER)],
    ['vimeos.net/embed-', html(packedEmbed(MASTER))],
  ]);
  const out = await fanpelis.searchFanpelis('Breaking Bad', SERIES, 'Breaking Bad', 1000);
  assert.equal(out.hits.length, 1);
  assert.match(out.hits[0].title, /Breaking Bad 2008 S01E01/);
  // Entre los dos episodios 1 duplicados gana el slug corto.
  assert.ok(calls.some((u) => u.includes('post_id=26785')));
  assert.ok(!calls.some((u) => u.includes('post_id=26786')));
});

test('fanpelis: el episodio que no existe devuelve cero hits sin romper', async () => {
  mockApi([
    ['/api/rest/search', json(SEARCH_TV)],
    ['/api/rest/episodes', json(EPISODES)],
  ]);
  const out = await fanpelis.searchFanpelis('Breaking Bad', { ...SERIES, season: 5, episode: 16 }, 'Breaking Bad', 1000);
  assert.deepEqual(out.hits, []);
});

test('fanpelis: descargas (mega, magnet) y embeds desconocidos se ignoran', async () => {
  const calls = mockApi([
    ['/api/rest/search', json(SEARCH_MOVIE)],
    ['/api/rest/player', json({ data: { embeds: [
      { lang: 'Latino', quality: 'HD', url: 'https://ads.example/tracker.js' },
      { lang: 'Latino', quality: 'HD', url: 'https://mega.nz/file/abc' },
    ], downloads: [{ url: 'magnet:?xt=urn:btih:abc' }] } })],
  ]);
  const out = await fanpelis.searchFanpelis('Matrix', MOVIE, 'Matrix', 1000);
  assert.deepEqual(out.hits, []);
  assert.ok(!calls.some((u) => u.includes('mega.nz')));
});

test('fanpelis: embed sin playlist no se presenta como vídeo', async () => {
  mockApi([
    ['/api/rest/search', json(SEARCH_MOVIE)],
    ['/api/rest/player', json(PLAYER)],
    ['vimeos.net/embed-', html('<html><body>sin playlist</body></html>')],
  ]);
  const out = await fanpelis.searchFanpelis('Matrix', MOVIE, 'Matrix', 1000);
  assert.equal(out.hits.length, 0);
});

test('fanpelis: caída total lanza (para que el proveedor se pause); vacío no', async () => {
  mockApi([['/api/rest/search', json({}, 500)]]);
  await assert.rejects(() => fanpelis.searchFanpelis('Matrix', MOVIE, 'Matrix', 1000));
  mockApi([['/api/rest/search', json({ data: { posts: [] } })]]);
  const empty = await fanpelis.searchFanpelis('Matrix', MOVIE, 'Matrix', 1000);
  assert.deepEqual(empty.hits, []);
});

test('fanpelis: FANPELIS=off lo desactiva sin tocar el resto', async () => {
  const original = config.fanpelisEnabled;
  config.fanpelisEnabled = false;
  try {
    const out = await fanpelis.searchFanpelis('Matrix', MOVIE, 'Matrix', 1000);
    assert.match(out.skipped, /FANPELIS=off/);
  } finally {
    config.fanpelisEnabled = original;
  }
});

test('fanpelis: el maestro de PlayLatin y Fanpelis va en el proxy HLS propio', () => {
  // vimeos.net ya está en la lista blanca del proxy (lo usa SpinFlix): el
  // stream de Fanpelis no necesita configuración extra.
  const proxied = require('../lib/spinflix').proxiedHls(MASTER);
  assert.ok(proxied === MASTER || proxied.includes('/hls?'));
});

test('fanpelis: aparece en /healthz y en los chips de /configure', () => {
  assert.ok(streams.PROVIDERS.some((provider) => provider.key === 'fanpelis'));
  const configure = require('../lib/configurePage');
  const page = configure.renderConfigure({ origin: 'https://addon.example', host: 'addon.example' });
  const body = typeof page === 'string' ? page : page.html;
  assert.match(body, /data-group="streams" data-key="fanpelis"/);
});

test('fanpelis: utilidades de selección e idioma', () => {
  // Un título que empieza igual puntúa, pero menos que la coincidencia exacta.
  const picked = fanpelis.pickCandidates(SEARCH_MOVIE.data.posts, MOVIE);
  assert.equal(picked[0]._id, 18507);
  assert.equal(fanpelis.audioLabelOf('Latino'), 'Latino');
  assert.equal(fanpelis.audioLabelOf('Castellano'), 'Castellano');
  assert.equal(fanpelis.audioLabelOf('Subtitulado'), 'Subtitulado');
  assert.equal(fanpelis.pickEpisode(EPISODES.data, 1, 2)._id, 26787);
  assert.equal(fanpelis.pickEpisode(EPISODES.data, 9, 1), null);
});

test('fanpelis: vimeos rota de dominio y el proxy acepta todos sus TLD', () => {
  // El mismo embed devolvió `s9.vimeos.net` en una pasada y `p3.vimeos.zip`
  // en la siguiente: si el proxy solo permite .net, ese stream no reproduce.
  const hls = require('../lib/hlsProxy');
  const allowed = hls.allowedHosts({});
  for (const host of ['s9.vimeos.net', 'p3.vimeos.zip', 'vimeos.com', 's1.vimeos.xyz']) {
    assert.equal(hls.hostAllowed(host, allowed), true, host);
  }
  // Y sigue sin ser un proxy abierto: un dominio ajeno no pasa.
  assert.equal(hls.hostAllowed('vimeos.net.evil.example', allowed), false);
  assert.equal(hls.hostAllowed('cdn.example', allowed), false);
});

test('fanpelis: la API solo indexa el título traducido, así que se prueba sin artículo', async () => {
  // Comprobado contra el servicio real: «The Matrix» → 0 fichas; «Matrix» → 3.
  cache.deletePrefix('fanpelis:');
  const queries = [];
  global.fetch = async (url) => {
    const u = String(url);
    if (!u.includes('/api/rest/search')) return json({}, 404);
    const q = decodeURIComponent((u.match(/query=([^&]*)/) || [])[1] || '');
    queries.push(q);
    // Solo responde al título sin artículo, como el servicio real.
    if (q === 'Matrix') return json(SEARCH_MOVIE);
    return json({ data: { posts: [] } });
  };
  const out = await fanpelis.searchFanpelis('The Matrix', { ...MOVIE, title: 'The Matrix', altTitle: null }, 'The Matrix', 1000);
  // El player y el embed no están simulados en este caso (responden 404): lo
  // que se prueba es que la consulta sin artículo encuentra la ficha.
  assert.deepEqual(out.hits || [], []);
  assert.ok(queries.includes('The Matrix'));
  assert.ok(queries.includes('Matrix'), `probó: ${queries.join(', ')}`);
});
