'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('public/watch/index.html', 'utf8');
const script = fs.readFileSync('public/watch/watch.js', 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const movie = { id: 'tmdb:movie:12', type: 'movie', name: 'Película de prueba', releaseInfo: '2025', description: 'Una historia de prueba' };
const series = { id: 'tmdb:tv:42', type: 'series', name: 'Serie de prueba' };
function setup() {
  const dom = new JSDOM(html, { url: 'https://example.test/watch/', runScripts: 'outside-only' });
  const w = dom.window; const requests = [];
  w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
  w.matchMedia = () => ({ matches: true });
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  w.fetch = async raw => {
    const u = new URL(raw, w.location); const action = u.pathname.split('/').pop(); requests.push(u);
    let body = {};
    if (action === 'catalogs') body = { configured: true, catalogs: [{ id: 'cine_tendencias', type: 'movie', name: 'Tendencias' }, { id: 'tv_tendencias', type: 'series', name: 'Tendencias' }, { id: 'tv_anime', type: 'series', name: 'Anime' }, { id: 'cine_top', type: 'movie', name: 'Top' }, { id: 'cine_netflix', type: 'movie', name: 'Netflix' }], platforms: [{ key: 'netflix', name: 'Netflix' }] };
    if (action === 'catalog') body = { metas: u.searchParams.get('type') === 'series' ? [series] : [movie], hasMore: false };
    if (action === 'meta') body = { meta: u.searchParams.get('type') === 'series' ? series : movie };
    if (action === 'extras') body = { cast: [{ name: 'Una actriz', character: 'Protagonista' }], genres: ['Aventura'], recommendations: [movie], trailers: [{ name: 'Tráiler', url: 'https://www.youtube.com/watch?v=abcdefghijk' }] };
    if (action === 'episodes') body = { seasons: [{ season_number: 1, name: 'Temporada 1' }, { season_number: 2, name: 'Temporada 2' }], episodes: [{ season: Number(u.searchParams.get('season') || 1), number: 1, name: 'Inicio', description: 'Primer episodio', runtime: 40 }, { number: 2, name: 'Continuación' }] };
    if (action === 'streams') body = { streams: [{ infoHash: 'a'.repeat(40), name: 'Fuente de prueba', title: '1080p' }] };
    return { ok: true, json: async () => body };
  };
  w.eval(script);
  return { dom, w, requests, $: id => w.document.getElementById(id) };
}

test('web: discover rails, full movie sheet, explicit torrent search and dedicated playback', async () => {
  const { dom, w, requests, $ } = setup();
  try {
    await flush();
    assert.equal($('home-rails').children.length, 4);
    assert.equal($('hero-title').textContent, movie.name);
    assert.equal(requests.filter(u => u.pathname.endsWith('/streams')).length, 0, 'browse never starts torrent searches');
    $('grid').querySelector('button').click(); await flush();
    assert.equal($('browse').hidden, true);
    assert.equal($('detail').hidden, false);
    assert.equal($('detail-title').textContent, movie.name);
    assert.equal($('cast').textContent.includes('Una actriz'), true);
    assert.match(w.location.hash, /title\/movie/);
    $('choose').click(); await flush();
    assert.equal($('sources').querySelectorAll('.source').length, 1);
    $('sources').querySelector('.source').click();
    assert.equal($('playback').open, true);
    assert.equal($('player').getAttribute('src'), '/watch/player.html');
    $('stop').click();
    assert.equal($('playback').open, false);
    assert.equal($('player').hasAttribute('src'), false);
    assert.equal($('detail').hidden, false);
    $('save').click(); assert.match($('save').textContent, /En mi lista/);
    $('close').click(); assert.equal($('browse').hidden, false);
  } finally { dom.window.close(); }
});

test('web: episode cards select the correct season and episode; browser navigation restores browsing', async () => {
  const { dom, w, requests, $ } = setup();
  try {
    await flush();
    w.document.querySelector('[data-tab="series"]').click(); await flush();
    $('grid').querySelector('button').click(); await flush();
    assert.equal($('episode-cards').children.length, 2);
    assert.equal($('choose').disabled, false);
    $('season').value = '2'; $('season').dispatchEvent(new w.Event('change')); await flush();
    $('episode-cards').children[1].click(); await flush();
    const stream = requests.filter(u => u.pathname.endsWith('/streams')).at(-1);
    assert.equal(stream.searchParams.get('season'), '2');
    assert.equal(stream.searchParams.get('episode'), '2');
    assert.equal($('episode-cards').children[1].getAttribute('aria-pressed'), 'true');
    w.history.replaceState(null, '', '/watch/'); w.dispatchEvent(new w.PopStateEvent('popstate'));
    assert.equal($('detail').hidden, true); assert.equal($('browse').hidden, false);
  } finally { dom.window.close(); }
});

test('player: only parent can start one validated magnet; SDK failures and torrent events are reported', () => {
  const dom = new JSDOM(fs.readFileSync('public/watch/player.html', 'utf8'), { url: 'https://example.test/watch/player.html', runScripts: 'outside-only' });
  const w = dom.window;
  const messages = [];
  const parent = { postMessage: message => messages.push(message) };
  Object.defineProperty(w, 'parent', { value: parent });
  let timer;
  w.setTimeout = fn => { timer = fn; return 1; };
  w.clearTimeout = () => {};
  const send = (source, magnet) => w.dispatchEvent(new w.MessageEvent('message', { source, data: { type: 'watch-play', magnet, title: 'Test' } }));
  try {
    w.eval(fs.readFileSync('public/watch/player.js', 'utf8'));
    assert.equal(messages[0].type, 'watch-ready');
    const magnet = 'magnet:?xt=urn:btih:' + 'a'.repeat(40);
    send({}, magnet);
    send(parent, magnet + 'invalid');
    assert.equal(Array.isArray(w.webtor), false, 'reject foreign window and malformed full hash');
    send(parent, magnet);
    assert.equal(w.webtor.length, 1);
    assert.equal(w.webtor[0].height, '100%');
    const sdk = w.document.head.querySelector('script:not([defer])');
    assert.ok(sdk.src.includes('@0.2.19/'));
    timer(); assert.equal(messages.at(-1).type, 'watch-error');
    assert.match(w.document.getElementById('status').textContent, /demasiado/);
    sdk.onload(); assert.equal(messages.at(-1).type, 'watch-loaded');
    w.webtor[0].on({ name: 'torrent error' });
    assert.equal(w.document.getElementById('status').hidden, false);
    assert.equal(messages.at(-1).type, 'watch-error');
    w.webtor[0].on({ name: 'torrent fetched' });
    assert.equal(messages.at(-1).type, 'watch-torrent-ready');
    sdk.onerror(); assert.equal(messages.at(-1).type, 'watch-error');
    send(parent, magnet);
    assert.equal(w.document.head.querySelectorAll('script:not([defer])').length, 1, 'one SDK instance only');
  } finally { w.close(); }
});
