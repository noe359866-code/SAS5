'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const config = require('../lib/config');
const tmdb = require('../lib/tmdb');
const core = require('../lib/core');
const { watchApi } = require('../lib/watchApi');
const url = (action, params = {}) => new URL('https://example.org/internal/watch/' + action + '?' + new URLSearchParams(params));

test('watch API: catalog discovery, configuration state and missing key', async () => {
  config.reload({});
  try {
    const data = await watchApi(url('catalogs'));
    assert.equal(data.status, 200);
    assert.ok(data.body.catalogs.some(c => c.id.includes('anime')));
    assert.equal(data.body.configured, false);
    assert.equal((await watchApi(url('search', { q: 'test' }))).status, 503);
  } finally { config.reload(process.env); }
});

test('watch API: paginated catalog, search, IMDb episodes and stream ids', async () => {
  config.reload({ TMDB_API_KEY: 'test' });
  const original = { catalogItems: tmdb.catalogItems, tmdbGet: tmdb.tmdbGet, findByImdbId: tmdb.findByImdbId, handleStream: core.handleStream };
  try {
    const calls = [];
    tmdb.catalogItems = async (def, options) => { calls.push(options); return Array.from({ length: 20 }, (_, i) => ({ id: `tmdb:movie:${i}` })); };
    const data = await watchApi(url('catalog', { id: 'cine_anime', page: 2 }));
    assert.equal(data.body.hasMore, true);
    assert.equal(calls.at(-1).page, 2);
    assert.equal(calls.at(-1).web, true);
    assert.equal((await watchApi(url('catalog', { id: 'bad' }))).status, 404);
    tmdb.findByImdbId = async () => ({ tv: { id: 42 } });
    tmdb.tmdbGet = async path => path === '/tv/42' ? { seasons: [{ season_number: 1 }] } : path.includes('/season/') ? { episodes: [{ episode_number: 2, name: 'Segundo' }] } : { results: [{ id: 9, title: 'Test' }], total_pages: 3 };
    const episodes = await watchApi(url('episodes', { type: 'series', id: 'tt123' }));
    assert.equal(episodes.body.episodes[0].number, 2);
    const search = await watchApi(url('search', { q: 'Test' }));
    assert.equal(search.body.metas[0].id, 'tmdb:movie:9');
    assert.equal(search.body.hasMore, true);
    core.handleStream = async (type, id, cfg) => { assert.equal(type, 'series'); assert.equal(id, 'tmdb:tv:42:1:2'); assert.equal(cfg, null); return { streams: [] }; };
    assert.equal((await watchApi(url('streams', { type: 'series', id: 'tmdb:tv:42', season: 1, episode: 2 }))).status, 200);
    assert.equal((await watchApi(url('meta', { id: '../../bad' }))).status, 400);
  } finally { Object.assign(tmdb, { catalogItems: original.catalogItems, tmdbGet: original.tmdbGet, findByImdbId: original.findByImdbId }); core.handleStream = original.handleStream; config.reload(process.env); }
});

test('watch player is pinned and its SDK host can never share the application origin', () => {
  const html = fs.readFileSync('public/watch/index.html', 'utf8');
  const player = fs.readFileSync('public/watch/player.js', 'utf8');
  const client = fs.readFileSync('public/watch/watch.js', 'utf8');
  // The webtor.io frame nested in the player keeps its own origin: without it Webtor's embed
  // cannot start (it reads its storage) nor follow its job log. Everything else stays shut.
  assert.match(html, /sandbox="allow-scripts allow-same-origin allow-forms allow-presentation allow-downloads"/);
  assert.doesNotMatch(html, /allow-(popups|top-navigation|modals|pointer-lock)/);
  // So the page that runs the SDK must be opaque by construction: a data: document built by
  // the application, the only thing ever loaded in the frame, and no same-origin page at all.
  assert.equal(fs.existsSync('public/watch/player.html'), false, 'a same-origin page must not host the SDK');
  assert.doesNotMatch(html, /<iframe[^>]*\ssrc(doc)?=/);
  assert.deepEqual([...new Set(client.match(/loadPlayer\((?!url\))[^;]*;/g))].sort(), ['loadPlayer();', 'loadPlayer(playerUrl());']);
  assert.doesNotMatch(client, /\$\('player'\)\.src\s*=|setAttribute\('src'/);
  assert.match(client, /return 'data:text\/html;charset=utf-8,' \+ encodeURIComponent\(/);
  assert.match(player, /const isolated = \(self\.origin \|\| location\.origin\) === 'null';/);
  assert.match(player, /@webtor\/embed-sdk-js@0\.2\.19/);
  assert.match(player, /referer: ''/);
  assert.match(player, /event.source !== parent/);
});

test('watch player has a dedicated cinema dialog and a 16:9 stage that fits the viewport', () => {
  const html = fs.readFileSync('public/watch/index.html', 'utf8');
  const css = fs.readFileSync('public/watch/watch.css', 'utf8');
  const player = fs.readFileSync('public/watch/player.js', 'utf8');
  const client = fs.readFileSync('public/watch/watch.js', 'utf8');
  assert.ok(html.indexOf('id="detail-title"') < html.indexOf('id="playback"'));
  assert.match(html, /<section id="detail" hidden/);
  assert.match(html, /<dialog id="playback"/);
  assert.match(html, /id="episode-cards"/);
  assert.match(html, /id="home-rails"/);
  assert.equal((html.match(/id="stop"/g) || []).length, 1);
  assert.match(html, /aria-labelledby="playing" tabindex="-1"/);
  assert.match(html, /<div id="stage"><iframe id="player"/);
  assert.match(css, /#player\{[^}]*aspect-ratio:16\/9;height:auto/);
  // A fixed or capped height on the frame breaks the ratio; the column is narrowed from the
  // viewport height instead, so the stage stays 16:9 and the whole player fits on screen.
  assert.doesNotMatch(css, /#player\{[^}]*height:\d+px/);
  assert.doesNotMatch(css, /#player\{[^}]*max-height/);
  assert.match(css, /\.cinema-shell\{[^}]*calc\(\(100dvh - var\(--chrome\)\)\*16\/9/);
  // The stage never shows an unexplained empty box: loading and error are explicit states.
  assert.match(css, /#playback\[data-state=loading\] #stage-loading,#playback\[data-state=error\] #stage-error\{[^}]*visibility:visible/);
  // A layer that is fading out must not swallow the click on Webtor's play button underneath.
  assert.match(css, /\.stage-layer\{[^}]*pointer-events:none/);
  assert.match(client, /#webtor iframe\{[^}]*height:100%/);
  assert.match(player, /height: '100%'/);
  assert.match(client, /\$\('playback'\)\.focus\(\{ preventScroll: true \}\)/);
});

test('watch extras: maps real TMDB cast, recommendations and safe trailer links', async () => {
  config.reload({ TMDB_API_KEY: 'extras-test' });
  const original = tmdb.tmdbGet;
  try {
    tmdb.tmdbGet = async (path, params) => {
      assert.equal(path, '/tv/42');
      assert.equal(params.append_to_response, 'credits,recommendations,videos');
      return { genres: [{ name: 'Drama' }], number_of_seasons: 2, credits: { cast: [{ name: 'Actriz', character: 'Personaje', profile_path: '/test.jpg' }] }, recommendations: { results: [{ id: 9, name: 'Otra serie' }] }, videos: { results: [{ site: 'YouTube', type: 'Trailer', key: 'abcdefghijk', name: 'Oficial' }, { site: 'YouTube', type: 'Trailer', key: '<bad>' }] } };
    };
    const data = await watchApi(url('extras', { id: 'tmdb:tv:42', type: 'series' }));
    assert.equal(data.body.cast[0].name, 'Actriz');
    assert.equal(data.body.recommendations[0].id, 'tmdb:tv:9');
    assert.equal(data.body.trailers.length, 1);
    assert.equal(data.body.trailers[0].url, 'https://www.youtube.com/watch?v=abcdefghijk');
  } finally { tmdb.tmdbGet = original; config.reload(process.env); }
});
