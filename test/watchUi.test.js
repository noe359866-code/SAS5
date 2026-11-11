'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('public/watch/index.html', 'utf8');
const script = fs.readFileSync('public/watch/watch.js', 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const plain = value => JSON.parse(JSON.stringify(value)); // values made inside jsdom belong to another realm
// The player frame is only ever given a data: document; return it parsed, at its own (opaque) origin.
function playerDocument(frame, options = {}) {
  const src = frame.getAttribute('src');
  assert.match(src, /^data:text\/html;charset=utf-8,/);
  const dom = new JSDOM(decodeURIComponent(src.slice(src.indexOf(',') + 1)), { url: src, runScripts: 'outside-only', ...options });
  return options.url ? dom.window : dom.window.document;
}
const movie = { id: 'tmdb:movie:12', type: 'movie', name: 'Película de prueba', releaseInfo: '2025', description: 'Una historia de prueba' };
const series = { id: 'tmdb:tv:42', type: 'series', name: 'Serie de prueba' };
function setup({ streams = [{ infoHash: 'a'.repeat(40), name: 'Fuente de prueba', title: '1080p' }] } = {}) {
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
    if (action === 'streams') body = { streams };
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
    assert.equal($('playback').dataset.state, 'loading');
    assert.match(playerDocument($('player')).querySelector('script[defer]').src, /^https:\/\/example\.test\/watch\/player\.js$/);
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

// Opens the player for the movie and returns helpers to speak as the frame and to fire the watchdog.
async function openPlayer({ background, streams } = {}) {
  const page = setup({ streams }); const { w, $ } = page;
  await flush();
  if (background) movie.background = background;
  try { $('grid').querySelector('button').click(); await flush(); } finally { delete movie.background; }
  $('choose').click(); await flush();
  const timers = []; w.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; }; w.clearTimeout = () => {};
  $('sources').querySelector('.source').click();
  const sent = []; $('player').contentWindow.postMessage = message => sent.push(message);
  const frame = (type, extra, source = $('player').contentWindow) => w.dispatchEvent(new w.MessageEvent('message', { source, data: { type, ...extra } }));
  return { ...page, timers, sent, frame };
}

test('web: the player shows loading, ready and failure states and always offers a way out', async () => {
  const { dom, w, $, timers, sent, frame } = await openPlayer({ background: 'https://image.tmdb.org/t/p/original/fondo.jpg' });
  try {
    const magnet = 'magnet:?xt=urn:btih:' + 'a'.repeat(40) + '&dn=Pel%C3%ADcula%20de%20prueba';
    assert.equal($('playback').dataset.state, 'loading');
    assert.match($('player-status').textContent, /Conectando/);
    assert.equal(timers.at(-1).ms, 30000);
    assert.match($('playback').style.getPropertyValue('--art'), /fondo\.jpg/);
    assert.equal($('playing-source').textContent, 'Fuente de prueba');
    // The same magnet opens on Webtor's own site, whatever happens to the embed.
    for (const link of w.document.querySelectorAll('.open-webtor')) assert.equal(link.getAttribute('href'), 'https://webtor.io/' + magnet);
    assert.equal(w.document.querySelectorAll('.open-webtor').length, 2);
    frame('watch-ready', {}, {});
    assert.equal(sent.length, 0, 'another window gets no answer');
    frame('watch-ready');
    assert.deepEqual(plain(sent), [{ type: 'watch-play', magnet, title: movie.name, poster: 'https://image.tmdb.org/t/p/original/fondo.jpg' }]);
    // Loading the SDK is not being ready: only Webtor's own "inited" is.
    frame('watch-loaded');
    assert.equal($('playback').dataset.state, 'loading');
    assert.equal(timers.at(-1).ms, 20000);
    frame('watch-frame');
    assert.equal(timers.at(-1).ms, 6000);
    frame('watch-inited');
    assert.equal($('playback').dataset.state, 'ready');
    assert.match($('player-status').textContent, /listo/);
    frame('watch-frame');
    assert.equal(timers.at(-1).ms, 6000, 'the frame loading Webtor\'s player later does not re-arm the watchdog');
    assert.equal($('playback').dataset.state, 'ready');
    frame('watch-playing');
    assert.match($('player-status').textContent, /Reproduciendo/);
    // Reported failures use our own texts; the frame only selects one of them.
    frame('watch-error', { reason: 'sdk' });
    assert.equal($('playback').dataset.state, 'error');
    assert.match($('stage-error-title').textContent, /No se pudo cargar Webtor/);
    frame('watch-error', { reason: '<img src=x onerror=alert(1)>' });
    assert.match($('stage-error-title').textContent, /no respondió/);
    frame('watch-error', { reason: 'constructor' });
    assert.match($('stage-error-title').textContent, /no respondió/);
    // Retry reloads the isolated document for the same source.
    $('player').removeAttribute('src');
    $('retry-player').click();
    assert.equal($('playback').dataset.state, 'loading');
    assert.match($('player').getAttribute('src'), /^data:text\/html/);
    assert.equal(timers.at(-1).ms, 30000);
    // An embed that never answers (switched off, blocked) ends in the same explained state...
    timers.at(-1).fn();
    assert.equal($('playback').dataset.state, 'error');
    assert.match($('stage-error-title').textContent, /no respondió/);
    assert.match($('stage-error-text').textContent, /pestaña de Webtor/);
    // ...and a late answer still brings the player back.
    frame('watch-inited');
    assert.equal($('playback').dataset.state, 'ready');
    $('stop').click();
    assert.equal($('playback').open, false);
    assert.equal($('player').hasAttribute('src'), false);
    frame('watch-error', { reason: 'sdk' });
    assert.equal($('playback').dataset.state, 'ready', 'a closed player ignores the frame');
  } finally { dom.window.close(); }
});

test('web: the magnet keeps a literal btih, its trackers and can be copied', async () => {
  const stream = { infoHash: 'ABCDEF0123'.repeat(4), name: '🧲 1080p', title: 'Pelicula.2025.1080p.WEB-DL\n💾 6.2 GB  👤 1280', sources: ['tracker:udp://tracker.example:1337/announce', 'dht:' + 'a'.repeat(40), 'tracker:https://t.example/announce?k=1&x=2'] };
  const { dom, w, $, sent, frame } = await openPlayer({ streams: [stream] });
  try {
    const expected = 'magnet:?xt=urn:btih:' + 'abcdef0123'.repeat(4) + '&dn=Pel%C3%ADcula%20de%20prueba&tr=udp%3A%2F%2Ftracker.example%3A1337%2Fannounce&tr=https%3A%2F%2Ft.example%2Fannounce%3Fk%3D1%26x%3D2';
    assert.equal(w.document.querySelector('.open-webtor').getAttribute('href'), 'https://webtor.io/' + expected);
    const parsed = new URL(expected);
    assert.equal(parsed.searchParams.get('xt'), 'urn:btih:' + 'abcdef0123'.repeat(4));
    assert.deepEqual(parsed.searchParams.getAll('tr'), ['udp://tracker.example:1337/announce', 'https://t.example/announce?k=1&x=2']);
    assert.equal($('playing-source').textContent, '🧲 1080p · 💾 6.2 GB  👤 1280');
    assert.equal($('playing-source').title, 'Pelicula.2025.1080p.WEB-DL');
    assert.equal($('playback').style.getPropertyValue('--art'), 'none', 'no artwork: the stage keeps its plain background');
    frame('watch-ready');
    assert.equal(sent[0].magnet, expected);
    assert.equal(sent[0].poster, '');
    const copied = []; Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async value => { copied.push(value); } }, configurable: true });
    $('copy-magnet').click(); await flush();
    assert.deepEqual(copied, [expected]);
    assert.match($('copy-magnet').textContent, /copiado/);
  } finally { dom.window.close(); }
});

// The document the application loads in the player frame, with player.js run inside it.
let playerFrame;
async function playerPage(url) {
  if (!playerFrame) { const page = await openPlayer(); playerFrame = page.$('player').cloneNode(); page.dom.window.close(); }
  const w = playerDocument(playerFrame, { url: url || playerFrame.getAttribute('src') });
  const messages = [];
  const parent = { postMessage: message => messages.push(message) };
  Object.defineProperty(w, 'parent', { value: parent });
  const timers = [];
  w.setTimeout = fn => { timers.push(fn); return timers.length; };
  w.clearTimeout = () => {};
  const send = (source, magnet, extra) => w.dispatchEvent(new w.MessageEvent('message', { source, data: { type: 'watch-play', magnet, title: 'Test', ...extra } }));
  return { w, messages, parent, timers, send, run: () => w.eval(fs.readFileSync('public/watch/player.js', 'utf8')) };
}
const magnet = 'magnet:?xt=urn:btih:' + 'a'.repeat(40);

test('player: only parent can start one validated magnet; SDK failures and torrent events are reported', async () => {
  const { w, messages, parent, timers, send, run } = await playerPage();
  try {
    assert.equal(w.origin, 'null', 'the document the application loads has an opaque origin');
    assert.ok(w.document.querySelector('#webtor') && w.document.querySelector('#status'));
    run();
    assert.equal(messages[0].type, 'watch-ready');
    send({}, magnet);
    send(parent, magnet + 'invalid');
    assert.equal(Array.isArray(w.webtor), false, 'reject foreign window and malformed full hash');
    send(parent, magnet, { poster: 'https://image.tmdb.org/t/p/original/fondo.jpg' });
    assert.equal(w.webtor.length, 1);
    assert.equal(w.webtor[0].height, '100%');
    assert.equal(w.webtor[0].referer, '');
    assert.equal(w.webtor[0].poster, 'https://image.tmdb.org/t/p/original/fondo.jpg');
    const sdk = w.document.head.querySelector('script:not([defer])');
    assert.ok(sdk.src.includes('@0.2.19/'));
    assert.equal(timers.length, 1, 'only the SDK load is timed here');
    timers.at(-1)(); assert.deepEqual(plain(messages.at(-1)), { type: 'watch-error', reason: 'timeout' });
    assert.match(w.document.getElementById('status').textContent, /demasiado/);
    // What the SDK does once loaded: add Webtor's frame to the container.
    const frame = w.document.createElement('iframe'); w.document.getElementById('webtor').append(frame);
    sdk.onload(); assert.equal(messages.at(-1).type, 'watch-loaded');
    assert.equal(w.document.getElementById('status').hidden, true);
    frame.dispatchEvent(new w.Event('load')); assert.equal(messages.at(-1).type, 'watch-frame');
    // Webtor's own signals: the embed is usable at "inited"; the click on its play button.
    w.webtor[0].on({ name: 'inited' }); assert.equal(messages.at(-1).type, 'watch-inited');
    w.dispatchEvent(new w.MessageEvent('message', { source: {}, data: { name: 'play_clicked' } }));
    assert.equal(messages.at(-1).type, 'watch-inited', 'only Webtor\'s frame can report the click');
    w.dispatchEvent(new w.MessageEvent('message', { source: frame.contentWindow, data: { id: 'x', name: 'play_clicked' } }));
    assert.equal(messages.at(-1).type, 'watch-playing');
    w.webtor[0].on({ name: 'torrent error' });
    assert.equal(w.document.getElementById('status').hidden, false);
    assert.deepEqual(plain(messages.at(-1)), { type: 'watch-error', reason: 'torrent' });
    w.webtor[0].on({ name: 'torrent fetched' });
    assert.equal(messages.at(-1).type, 'watch-torrent-ready');
    sdk.onerror(); assert.deepEqual(plain(messages.at(-1)), { type: 'watch-error', reason: 'sdk' });
    send(parent, magnet);
    assert.equal(w.document.head.querySelectorAll('script:not([defer])').length, 1, 'one SDK instance only');
  } finally { w.close(); }
});

test('player: the poster reaches Webtor only as a plain https image address', async () => {
  for (const [poster, expected] of [
    ['https://image.tmdb.org/t/p/original/a_b-c.jpg', 'https://image.tmdb.org/t/p/original/a_b-c.jpg'],
    ['http://image.tmdb.org/a.jpg', null], ['https://x.test/a.jpg);background:url(//evil', null], ['https://x.test/a b.jpg', null],
    ['javascript:alert(1)', null], ['', null], [undefined, null], [{ toString: () => 'https://x.test/a.jpg' }, null], ['https://x.test/' + 'a'.repeat(600), null],
  ]) {
    const { w, parent, send, run } = await playerPage();
    try { run(); send(parent, magnet, { poster }); assert.equal(w.webtor[0].poster, expected, String(poster).slice(0, 40)); } finally { w.close(); }
  }
});

test('player: refuses to load third-party code in a document that shares the application origin', async () => {
  // The same document, served as a page of the application (or framed by another site).
  const { w, messages, parent, timers, send, run } = await playerPage('https://example.test/watch/player.html');
  try {
    assert.equal(w.origin, 'https://example.test');
    run();
    assert.deepEqual(plain(messages), [{ type: 'watch-error', reason: 'isolation' }], 'never announces itself as ready');
    assert.equal(w.document.getElementById('status').hidden, false);
    send(parent, magnet);
    assert.equal(Array.isArray(w.webtor), false);
    assert.equal(w.document.head.querySelector('script:not([defer])'), null, 'the SDK is not requested');
    assert.equal(timers.length, 0);
    assert.equal(messages.length, 1);
  } finally { w.close(); }
});
