'use strict';

/**
 * Proveedores incorporados el 24-11-2026: HackStore (dialecto `wpa`) y
 * AllCalidad (dialecto `rest`, con el listado de episodios como array directo).
 *
 * Sin red: `fetch` se sustituye por un mapa de rutas. El HTML de Vimeos se
 * empaqueta con Dean Edwards, igual que en `test/allpeliculas.test.js`.
 * Las pruebas son subtests de uno solo para que el `fetch` global no se
 * sustituya a mitad de otra prueba.
 */

const test = require('node:test');
const assert = require('node:assert');

const hackstore = require('../lib/sites/hackstore');
const allcalidad = require('../lib/sites/allcalidad');
const cache = require('../lib/cache');

const MASTER = 'https://s9.vimeos.net/hls2/02/00005/ccjygcfxujhd_,n,h,.urlset/master.m3u8';
const PELICULA = { title: 'La Odisea', altTitle: 'The Odyssey', year: '2026', mediaType: 'movie' };
const SERIE = { title: 'The Pitt', altTitle: null, year: '2025', mediaType: 'series', season: 1, episode: 1 };

function packedEmbed(master) {
  return `<html><body><script>eval(function(p,a,c,k,e,d){e=function(c){return c};if(!''.replace(/^/,String)){while(c--){d[c]=k[c]||c}k=[function(e){return d[e]}];e=function(){return'\\w+'};c=1};while(c--){if(k[c]){p=p.replace(new RegExp('\\b'+e(c)+'\\b','g'),k[c])}}return p}('0',1,1,'${master}'.split('|')))</script></body></html>`;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}
const html = (body) => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });

function stub(routes) {
  cache.deletePrefix('hackstore:');
  cache.deletePrefix('allcalidad:');
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url) => {
    const target = String(url);
    calls.push(target);
    for (const [needle, reply] of routes) {
      if (!target.includes(needle)) continue;
      return typeof reply === 'function' ? reply(target) : reply;
    }
    return json({ message: 'not found' }, 404);
  };
  return { calls, restore: () => { global.fetch = original; } };
}

const SEARCH_HACKSTORE = { data: { posts: [
  { _id: 148266, title: 'La Odisea de los Lunnis (2006)', type: 'movies', release_date: '2006-11-21' },
  { _id: 76899, title: 'La Odisea (2026)', type: 'movies', release_date: '2026-07-15' },
] } };
const SERIES_HACKSTORE = { data: { posts: [{ _id: 62235, title: 'The Pitt (2025)', type: 'tvshows', release_date: '2025-01-09' }] } };
const EPISODES_HACKSTORE = { data: { posts: [
  { _id: 62238, season_number: 1, episode_number: 1 },
  { _id: 62239, season_number: 1, episode_number: 2 },
] } };
const PLAYER_HACKSTORE = { data: { embeds: [
  { url: 'https://vimeos.net/embed-m62pdrnlvwpw.html', lang: 'latino - inglés', season: 1, episode: 1 },
] } };

const SEARCH_ALLCALIDAD = { data: { posts: [
  { _id: 72531, title: 'La Odisea (2026)', type: 'movies', release_date: '2026-07-15' },
] } };
const SERIES_ALLCALIDAD = { data: { posts: [{ _id: 27051, title: 'The Pitt (2025)', type: 'tvshows', release_date: '2025-01-09' }] } };
// El dialecto `rest` devuelve el array dentro de `data`, sin `posts`.
const EPISODES_ALLCALIDAD = { data: [
  { _id: 27053, season_number: 1, episode_number: 1 },
  { _id: 27054, season_number: 1, episode_number: 2 },
] };
const PLAYER_ALLCALIDAD = { data: { embeds: [
  { url: 'https://vimeos.net/embed-0ox61hi704mt.html', lang: 'latino', quality: 'Full HD' },
] } };

// Cada respuesta se crea de nuevo: `fetchText` consume el body del Response.
const COMMON = [['vimeos.net/embed-', () => html(packedEmbed(MASTER))]];

test('proveedores nuevos: cadena completa con el código del addon', async (t) => {
  await t.test('hackstore: película identificada por año, player propio y HLS de Vimeos', async () => {
    const stubbed = stub([
      ['hackstore.mx/wp-api/v1/search', json(SEARCH_HACKSTORE)],
      ['/player?postId=76899', json(PLAYER_HACKSTORE)],
      ...COMMON,
    ]);
    try {
      const out = await hackstore.searchHackstore('La Odisea', PELICULA, PELICULA.title, 5000);
      assert.equal(out.hits.length, 1, out.reason);
      assert.equal(out.hits[0].provider, 'hackstore');
      assert.equal(out.hits[0].url, MASTER);
      assert.equal(out.hits[0].audioLabel, 'Latino');
      assert.equal(out.hits[0].playbackOrigin, 'https://vimeos.net');
      assert.match(out.hits[0].title, /HackStore$/);
      assert.ok(stubbed.calls.some((url) => url.includes('hackstore.mx/wp-api/v1/search')));
      assert.ok(stubbed.calls.some((url) => url.includes('/player?postId=76899')));
    } finally { stubbed.restore(); }
  });

  await t.test('hackstore: serie con episodio y embed declarado para ese episodio', async () => {
    const stubbed = stub([
      ['hackstore.mx/wp-api/v1/search', json(SERIES_HACKSTORE)],
      ['/single/episodes/list', json(EPISODES_HACKSTORE)],
      ['/player?postId=62238', json(PLAYER_HACKSTORE)],
      ...COMMON,
    ]);
    try {
      const out = await hackstore.searchHackstore('The Pitt', SERIE, SERIE.title, 5000);
      assert.equal(out.hits.length, 1, out.reason);
      assert.match(out.hits[0].title, /S1E1/);
      assert.ok(stubbed.calls.some((url) => url.includes('/player?postId=62238')));
    } finally { stubbed.restore(); }
  });

  await t.test('allcalidad: la búsqueda pide el tipo de obra y el player usa post_id', async () => {
    const stubbed = stub([
      ['allcalidad.re/api/rest/search', json(SEARCH_ALLCALIDAD)],
      ['/api/rest/player?post_id=72531', json(PLAYER_ALLCALIDAD)],
      ...COMMON,
    ]);
    try {
      const out = await allcalidad.searchAllcalidad('La Odisea', PELICULA, PELICULA.title, 5000);
      assert.equal(out.hits.length, 1, out.reason);
      assert.equal(out.hits[0].provider, 'allcalidad');
      assert.equal(out.hits[0].audioLabel, 'Latino');
      assert.match(out.hits[0].title, /AllCalidad$/);
      assert.ok(stubbed.calls.some((url) => /post_type=movies/.test(url)), stubbed.calls.join('\n'));
      assert.ok(stubbed.calls.some((url) => url.includes('/player?post_id=72531')));
    } finally { stubbed.restore(); }
  });

  await t.test('allcalidad: los episodios llegan como array directo y se localiza el 1x1', async () => {
    const stubbed = stub([
      ['allcalidad.re/api/rest/search', json(SERIES_ALLCALIDAD)],
      ['/api/rest/episodes', json(EPISODES_ALLCALIDAD)],
      ['/api/rest/player?post_id=27053', json(PLAYER_ALLCALIDAD)],
      ...COMMON,
    ]);
    try {
      const out = await allcalidad.searchAllcalidad('The Pitt', SERIE, SERIE.title, 5000);
      assert.equal(out.hits.length, 1, out.reason);
      assert.match(out.hits[0].title, /S1E1/);
      assert.ok(stubbed.calls.some((url) => url.includes('/episodes?post_id=27051')));
      assert.ok(stubbed.calls.some((url) => url.includes('/player?post_id=27053')));
    } finally { stubbed.restore(); }
  });

  await t.test('las bases son propias y no se abre el CDN', async () => {
    assert.equal(hackstore.BASE, 'https://hackstore.mx');
    assert.equal(hackstore.API, 'https://hackstore.mx/wp-api/v1');
    assert.equal(allcalidad.BASE, 'https://allcalidad.re');
    assert.equal(allcalidad.API, 'https://allcalidad.re/api/rest');

    const stubbed = stub([
      ['hackstore.mx/wp-api/v1/search', json(SEARCH_HACKSTORE)],
      ['/player?postId=76899', json(PLAYER_HACKSTORE)],
      ...COMMON,
    ]);
    try {
      await hackstore.searchHackstore('La Odisea', PELICULA, PELICULA.title, 5000);
      assert.ok(!stubbed.calls.some((url) => url.includes('vimeos.net/hls2')), 'solo el embed, nunca el manifiesto');
    } finally { stubbed.restore(); }
  });
});
