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
function setup({ streams = [{ infoHash: 'a'.repeat(40), name: 'Fuente de prueba', title: '1080p' }], prepare } = {}) {
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
  if (prepare) prepare(w); // the browser this page runs in: user agent, storage, timers
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

// --- Floating card with the recommended extensions ---
const EXTENSIONS_CLOSED = 'catalogos-extensions-closed';
const uaData = value => w => Object.defineProperty(w.navigator, 'userAgentData', { value, configurable: true });
const uaString = value => w => Object.defineProperty(w.navigator, 'userAgent', { value, configurable: true });
const chromeDesktop = uaData({ mobile: false, platform: 'Windows' });
// Opens the page in the given browser and returns the timers it set while starting.
function visit(browser, before) {
  const timers = [];
  const page = setup({ prepare: w => { browser(w); if (before) before(w); w.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; }; } });
  return { ...page, timers };
}

test('web: the extensions card opens by itself on desktop Chromium, without taking the focus, and stays closed once dismissed', async () => {
  const first = visit(chromeDesktop);
  try {
    const { w, $, timers } = first;
    await flush();
    assert.equal($('extensions').hidden, true, 'not before its delay');
    assert.deepEqual(timers.map(t => t.ms), [1500]);
    const focused = w.document.activeElement;
    timers[0].fn();
    assert.equal($('extensions').hidden, false);
    assert.equal(w.document.activeElement, focused, 'appearing by itself does not move the focus');
    assert.deepEqual([...$('extensions').querySelectorAll('a')].map(a => [a.target, a.rel, a.hostname]), Array(3).fill(['_blank', 'noopener noreferrer', 'chromewebstore.google.com']));
    $('extensions-close').click();
    assert.equal($('extensions').hidden, true);
    assert.equal(w.localStorage.getItem(EXTENSIONS_CLOSED), '1');
    assert.equal(w.document.activeElement, focused, 'closing it does not send the focus to the footer');
  } finally { first.dom.window.close(); }
  // The next visit remembers it: nothing is scheduled.
  const next = visit(chromeDesktop, w => w.localStorage.setItem(EXTENSIONS_CLOSED, '1'));
  try {
    await flush();
    assert.deepEqual(next.timers, []);
    assert.equal(next.$('extensions').hidden, true);
  } finally { next.dom.window.close(); }
});

test('web: the extensions card is only pushed where the Chrome Web Store can install', async () => {
  const chrome = 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0';
  const browsers = [
    ['Chromium desktop', uaData({ mobile: false, platform: 'macOS' }), true],
    ['Chromium phone', uaData({ mobile: true, platform: 'Android' }), false],
    ['Chromium tablet', uaData({ mobile: false, platform: 'Android' }), false],
    // Without userAgentData (plain http, other engines) the user agent string decides.
    ['Chrome desktop', uaString(`Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${chrome} Safari/537.36`), true],
    ['Edge desktop', uaString(`Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${chrome} Safari/537.36 Edg/141.0.0.0`), true],
    ['Chrome on Android', uaString(`Mozilla/5.0 (Linux; Android 14; Pixel 8) ${chrome} Mobile Safari/537.36`), false],
    ['Android tablet', uaString(`Mozilla/5.0 (Linux; Android 13; SM-X710) ${chrome} Safari/537.36`), false],
    ['Chrome on iOS', uaString('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1'), false],
    ['Firefox', uaString('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0'), false],
    ['Safari', uaString('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'), false],
    ['Smart TV', uaString(`Mozilla/5.0 (Web0S; Linux/SmartTV) ${chrome} Safari/537.36 WebAppManager`), false],
  ];
  for (const [name, browser, offered] of browsers) {
    const page = visit(browser);
    try {
      await flush();
      assert.equal(page.timers.length, offered ? 1 : 0, name);
      assert.equal(page.$('extensions').hidden, true, name);
      // Whatever the browser, the footer keeps the list one click away.
      page.$('extensions-open').click();
      assert.equal(page.$('extensions').hidden, false, name);
    } finally { page.dom.window.close(); }
  }
});

test('web: the extensions card opened from the footer takes the focus and gives it back; Escape closes it', async () => {
  const page = visit(() => {});
  try {
    const { w, $, timers } = page;
    await flush();
    assert.deepEqual(timers, [], 'not pushed in this browser');
    $('extensions-open').focus(); $('extensions-open').click();
    assert.equal($('extensions').hidden, false);
    assert.equal(w.document.activeElement, $('extensions'));
    const link = $('extensions').querySelector('a'); link.focus();
    link.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal($('extensions').hidden, false, 'only Escape closes from the keyboard');
    link.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal($('extensions').hidden, true);
    assert.equal(w.document.activeElement, $('extensions-open'));
    assert.equal(w.localStorage.getItem(EXTENSIONS_CLOSED), '1');
    // Dismissed is not gone: the footer opens it again.
    $('extensions-open').click();
    assert.equal($('extensions').hidden, false);
    // The playback dialog and its controls are not part of the card.
    assert.equal($('playback').contains($('extensions')), false);
    assert.equal(w.document.querySelectorAll('.open-webtor').length, 2);
  } finally { page.dom.window.close(); }
});

test('web: the extensions card works without storage', async () => {
  const blocked = w => Object.defineProperty(w, 'localStorage', { get() { throw new w.DOMException('The operation is insecure.', 'SecurityError'); }, configurable: true });
  const page = visit(chromeDesktop, blocked);
  try {
    const { w, $, timers } = page;
    // An exception inside a click handler does not reach the caller: jsdom reports it on the window.
    const errors = []; w.addEventListener('error', event => errors.push(event.message));
    await flush();
    assert.throws(() => w.localStorage, /insecure/);
    assert.equal($('status').textContent.length > 0, true, 'the page itself started');
    assert.deepEqual(timers.map(t => t.ms), [1500], 'nothing remembered: offered');
    timers[0].fn();
    assert.equal($('extensions').hidden, false);
    $('extensions-close').click();
    assert.equal($('extensions').hidden, true, 'closed for this visit');
    $('extensions-open').focus(); $('extensions-open').click(); $('extensions-close').click();
    assert.equal(w.document.activeElement, $('extensions-open'), 'the rest of closing still runs');
    assert.deepEqual(errors, []);
  } finally { page.dom.window.close(); }
});

// Profiles and settings. Everything is kept in the browser: these tests read localStorage as the page leaves it.
const PROFILES = 'catalogos-watch-profiles';
const listKey = id => 'catalogos-watch-list:' + id;
const person = (id, name, extra = {}) => ({ id, name, color: 'blue', symbol: '', prefs: {}, ...extra });
const seed = (profiles, extra = {}) => w => w.localStorage.setItem(PROFILES, JSON.stringify({ version: 1, active: profiles[0].id, ask: true, profiles, ...extra }));
const stored = w => JSON.parse(w.localStorage.getItem(PROFILES));
const press = (w, el) => el.dispatchEvent(new w.Event('change', { bubbles: true }));
const choose = (w, name, value) => { const input = w.document.querySelector(`input[name="${name}"][value="${value}"]`); input.checked = true; press(w, input); };

test('profiles: the list saved before profiles existed moves into a first profile', async () => {
  const old = [{ ...movie, seasons: [1, 2] }, { id: 'javascript:alert(1)', type: 'movie', name: 'No es un título' }];
  const { dom, w, $ } = setup({ prepare: w => w.localStorage.setItem('catalogos-watch-list', JSON.stringify(old)) });
  try {
    await flush();
    const data = stored(w);
    assert.equal(data.profiles.length, 1);
    assert.equal(data.profiles[0].name, 'Principal');
    assert.equal(data.active, data.profiles[0].id);
    assert.equal(w.localStorage.getItem('catalogos-watch-list'), null, 'the old key is not left behind');
    // Only real titles survive, without the fields the cards do not need.
    assert.deepEqual(JSON.parse(w.localStorage.getItem(listKey(data.active))), [{ id: movie.id, type: 'movie', name: movie.name, releaseInfo: '2025', description: movie.description }]);
    assert.equal($('profiles').open, false, 'one profile: nobody is asked who is watching');
    assert.equal($('profile-name').textContent, 'Principal');
    assert.equal(w.document.documentElement.dataset.accent, 'blue');
    w.document.querySelector('[data-tab="saved"]').click();
    assert.equal($('grid').children.length, 1);
  } finally { dom.window.close(); }
});

test('profiles: a session with several profiles starts by asking who is watching, and each one has its own list', async () => {
  const people = [person('p1', 'Noé'), person('p2', 'Mamá', { color: 'pink', symbol: 'heart', prefs: { home: 'series', searchType: 'series', posters: 'large', reduceMotion: true } })];
  const { dom, w, $ } = setup({ prepare: w => { seed(people)(w); w.localStorage.setItem(listKey('p1'), JSON.stringify([movie])); } });
  try {
    await flush();
    assert.equal($('profiles').open, true);
    const tiles = [...$('profile-tiles').querySelectorAll('.profile-tile')];
    assert.deepEqual(tiles.map(t => t.querySelector('strong').textContent), ['Noé', 'Mamá', 'Añadir perfil']);
    assert.equal(tiles[1].querySelector('.avatar use').getAttribute('href'), '#i-heart');
    assert.equal(tiles[0].querySelector('.avatar').textContent, 'N');
    tiles[1].click(); await flush();
    assert.equal($('profiles').open, false);
    assert.equal(stored(w).active, 'p2');
    assert.equal(w.sessionStorage.getItem('catalogos-watch-profile-chosen'), '1');
    // The profile brings its accent, its poster size, its motion preference and its start section.
    const root = w.document.documentElement;
    assert.equal(root.dataset.accent, 'pink');
    assert.equal(root.dataset.posters, 'large');
    assert.equal(root.hasAttribute('data-reduce-motion'), true);
    assert.equal(w.document.querySelector('[data-tab="series"]').getAttribute('aria-pressed'), 'true');
    assert.equal($('search-type').value, 'series');
    assert.equal($('grid').querySelector('strong').textContent, series.name);
    w.document.querySelector('[data-tab="saved"]').click();
    assert.equal($('grid').children.length, 0, 'Mamá starts with an empty list');
    // Saving a title writes to the list of the profile that is watching.
    w.document.querySelector('[data-tab="series"]').click(); await flush();
    $('grid').querySelector('button').click(); await flush();
    $('save').click();
    assert.equal(JSON.parse(w.localStorage.getItem(listKey('p2')))[0].id, series.id);
    assert.equal(JSON.parse(w.localStorage.getItem(listKey('p1')))[0].id, movie.id);
    // The header menu switches profile without the picker.
    $('profile-button').click();
    assert.equal($('profile-menu').hidden, false);
    assert.equal($('profile-button').getAttribute('aria-expanded'), 'true');
    const entries = [...$('menu-profiles').children];
    assert.equal(entries[1].getAttribute('aria-current'), 'true');
    entries[0].click(); await flush();
    assert.equal($('profile-menu').hidden, true);
    assert.equal(stored(w).active, 'p1');
    assert.equal(root.dataset.accent, 'blue');
    assert.equal(root.hasAttribute('data-reduce-motion'), false);
    assert.match($('save').textContent, /Mi lista/);
    assert.doesNotMatch($('save').textContent, /✓/, 'the open sheet shows the list of the new profile');
  } finally { dom.window.close(); }
});

test('profiles: the picker is skipped once chosen in the session, or when the browser is told not to ask', async () => {
  const people = [person('p1', 'Noé'), person('p2', 'Mamá')];
  const again = setup({ prepare: w => { seed(people)(w); w.sessionStorage.setItem('catalogos-watch-profile-chosen', '1'); } });
  try { await flush(); assert.equal(again.$('profiles').open, false); } finally { again.dom.window.close(); }
  const quiet = setup({ prepare: seed(people, { ask: false, active: 'p2' }) });
  try { await flush(); assert.equal(quiet.$('profiles').open, false); assert.equal(quiet.$('profile-name').textContent, 'Mamá'); } finally { quiet.dom.window.close(); }
});

test('profiles: create, rename and delete from the manage screen', async () => {
  const { dom, w, $ } = setup({ prepare: w => { seed([person('p1', 'Noé')])(w); w.localStorage.setItem(listKey('p1'), JSON.stringify([movie])); } });
  try {
    await flush();
    $('profile-button').click(); $('menu-manage').click();
    assert.equal($('profiles').open, true);
    assert.equal($('profiles').hasAttribute('data-managing'), true);
    $('profile-add').click();
    assert.equal($('profile-form').hidden, false);
    assert.equal($('profile-delete').hidden, true);
    assert.equal(w.document.querySelector('input[name="profile-color"]:checked').value, 'violet', 'a new profile starts with a colour nobody uses');
    const submit = () => $('profile-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
    const type = value => { $('profile-name-input').value = value; $('profile-name-input').dispatchEvent(new w.Event('input')); };
    submit(); assert.match($('profile-error').textContent, /Escribe un nombre/);
    type(' noé '); submit(); assert.match($('profile-error').textContent, /Ya hay un perfil/);
    type('  Los   peques  '); assert.equal($('editor-avatar').textContent, 'L');
    choose(w, 'profile-color', 'orange'); choose(w, 'profile-symbol', 'rocket');
    assert.equal($('editor-avatar').dataset.color, 'orange');
    assert.equal($('editor-avatar').querySelector('use').getAttribute('href'), '#i-rocket');
    submit();
    assert.equal($('profile-form').hidden, true);
    let data = stored(w);
    assert.deepEqual(data.profiles.map(p => [p.name, p.color, p.symbol]), [['Noé', 'blue', ''], ['Los peques', 'orange', 'rocket']]);
    assert.equal(data.active, 'p1', 'creating a profile does not switch to it');
    // Rename the active one: the header follows.
    $('profile-tiles').querySelector('[data-profile="p1"]').click();
    assert.equal($('profile-name-input').value, 'Noé');
    assert.equal($('profile-delete').hidden, false);
    type('Noelia'); submit();
    assert.equal($('profile-name').textContent, 'Noelia');
    // Deleting asks twice, takes the list with it and hands over to another profile.
    $('profile-tiles').querySelector('[data-profile="p1"]').click();
    $('profile-delete').click();
    assert.equal($('profile-delete').hasAttribute('data-armed'), true);
    assert.equal(stored(w).profiles.length, 2, 'the first press only asks');
    $('profile-delete').click(); await flush();
    data = stored(w);
    assert.deepEqual(data.profiles.map(p => p.name), ['Los peques']);
    assert.equal(data.active, data.profiles[0].id);
    assert.equal(w.localStorage.getItem(listKey('p1')), null);
    assert.equal($('profile-name').textContent, 'Los peques');
    assert.equal(w.document.documentElement.dataset.accent, 'orange');
    // The last profile cannot be deleted.
    $('profile-tiles').querySelector('.profile-tile').click();
    assert.equal($('profile-delete').hidden, true);
    assert.equal($('profile-delete').hasAttribute('data-armed'), false);
  } finally { dom.window.close(); }
});

test('profiles: five at most, and stored data is read back as untrusted', async () => {
  const people = ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis'].map((name, i) => person('p' + i, name));
  people[1] = { id: '../x', name: 'Mala' }; people[2] = { ...people[2], color: 'url(x)', symbol: '<b>', prefs: { home: 'nope', posters: 7, autoSources: 'yes' } };
  const { dom, w, $ } = setup({ prepare: seed(people, { active: 'nobody' }) });
  try {
    await flush();
    const names = [...$('profile-tiles').querySelectorAll('strong')].map(n => n.textContent);
    assert.deepEqual(names, ['Uno', 'Tres', 'Cuatro', 'Cinco', 'Seis'], 'the broken entry is dropped and no «Añadir perfil» is offered at five');
    assert.equal($('profile-add'), null);
    assert.equal($('profile-name').textContent, 'Uno', 'an unknown active profile falls back to the first');
    $('profile-tiles').querySelector('[data-profile="p2"]').click(); await flush();
    assert.equal(w.document.documentElement.dataset.accent, 'blue');
    assert.equal(w.document.documentElement.dataset.posters, 'medium');
    assert.equal($('profile-avatar').textContent, 'T');
    assert.deepEqual(stored(w).profiles[1].prefs, { home: 'all', searchType: 'movie', player: 'embed', posters: 'medium', autoSources: false, reduceMotion: false });
  } finally { dom.window.close(); }
});

test('settings: its own page, with every preference saved for the profile and applied at once', async () => {
  const { dom, w, requests, $ } = setup({ prepare: seed([person('p1', 'Noé')]) });
  try {
    await flush();
    $('profile-button').click(); $('menu-settings').click();
    assert.equal(w.location.hash, '#settings');
    assert.equal($('settings').hidden, false);
    assert.equal($('browse').hidden, true);
    assert.equal($('set-profile-title').textContent, 'Noé');
    assert.equal(w.document.querySelector('input[name="pref-home"]:checked').value, 'all');
    assert.equal($('device-ask').disabled, true, 'asking who is watching needs a second profile');
    choose(w, 'pref-home', 'saved'); choose(w, 'pref-searchType', 'series'); choose(w, 'pref-player', 'tab'); choose(w, 'pref-posters', 'small');
    $('pref-auto').checked = true; press(w, $('pref-auto'));
    $('pref-motion').checked = true; press(w, $('pref-motion'));
    assert.deepEqual(stored(w).profiles[0].prefs, { home: 'saved', searchType: 'series', player: 'tab', posters: 'small', autoSources: true, reduceMotion: true });
    assert.match($('settings-status').textContent, /Guardado/);
    assert.equal(w.document.documentElement.dataset.posters, 'small');
    assert.equal(w.document.documentElement.hasAttribute('data-reduce-motion'), true);
    assert.equal($('search-type').value, 'series');
    assert.match(w.document.querySelector('[data-summary="playback"]').textContent, /Webtor/);
    // Leaving goes back to the library; the sheet then looks for sources by itself and plays in a Webtor tab.
    $('settings-close').click(); w.dispatchEvent(new w.PopStateEvent('popstate')); await flush();
    w.history.replaceState(null, '', w.location.pathname); w.dispatchEvent(new w.PopStateEvent('popstate')); await flush();
    assert.equal($('settings').hidden, true);
    assert.equal($('browse').hidden, false);
    $('grid').querySelector('button').click(); await flush();
    assert.equal(requests.filter(u => u.pathname.endsWith('/streams')).length, 1, 'sources are searched on opening the sheet');
    let opened = null; w.HTMLAnchorElement.prototype.click = function () { opened = this; };
    $('sources').querySelector('.source').click();
    assert.equal($('playback').open, false);
    assert.equal($('player').hasAttribute('src'), false, 'no embedded player is loaded');
    assert.match(opened.href, /^https:\/\/webtor\.io\/magnet:\?xt=urn:btih:a{40}/);
    assert.equal(opened.target, '_blank'); assert.equal(opened.rel, 'noopener noreferrer');
    // Restoring keeps the list and the profile, and only resets the preferences.
    $('profile-button').click(); $('menu-settings').click();
    $('prefs-reset').click();
    assert.deepEqual(stored(w).profiles[0].prefs, { home: 'all', searchType: 'movie', player: 'embed', posters: 'medium', autoSources: false, reduceMotion: false });
    assert.equal(w.document.querySelector('input[name="pref-player"]:checked').value, 'embed');
    assert.equal(w.document.documentElement.hasAttribute('data-reduce-motion'), false);
  } finally { dom.window.close(); }
});

test('settings: a direct visit to #settings opens them, and the start section of the profile is honoured', async () => {
  const { dom, w, $ } = setup({ prepare: w => { seed([person('p1', 'Noé', { prefs: { home: 'saved' } })])(w); w.localStorage.setItem(listKey('p1'), JSON.stringify([movie])); w.location.hash = '#settings'; } });
  try {
    await flush();
    assert.equal($('settings').hidden, false);
    assert.equal($('browse').hidden, true);
    assert.equal(w.document.querySelector('input[name="pref-home"]:checked').value, 'saved');
    $('settings-close').click(); await flush();
    assert.equal(w.location.hash, '');
    assert.equal($('settings').hidden, true);
    assert.equal(w.document.querySelector('[data-tab="saved"]').getAttribute('aria-pressed'), 'true');
    assert.equal($('grid').children.length, 1);
  } finally { dom.window.close(); }
});

test('settings: the list is exported, imported and emptied per profile; wiping starts over', async () => {
  const people = [person('p1', 'Noé'), person('p2', 'Mamá')];
  const { dom, w, $ } = setup({ prepare: w => { seed(people)(w); w.sessionStorage.setItem('catalogos-watch-profile-chosen', '1'); w.localStorage.setItem(listKey('p1'), JSON.stringify([movie])); w.localStorage.setItem(listKey('p2'), JSON.stringify([series])); } });
  try {
    await flush();
    $('profile-button').click(); $('menu-settings').click();
    assert.match($('list-count').textContent, /^1 título guardado de 200/);
    assert.equal($('device-ask').checked, true);
    $('device-ask').checked = false; press(w, $('device-ask'));
    assert.equal(stored(w).ask, false);
    // Export: a JSON file made in the browser.
    let exported = null, name = '';
    w.URL.createObjectURL = blob => { exported = blob; return 'blob:test'; }; w.URL.revokeObjectURL = () => {};
    w.HTMLAnchorElement.prototype.click = function () { name = this.download; };
    $('list-export').click();
    assert.equal(name, 'mi-lista-noé.json');
    assert.equal(exported.type, 'application/json');
    assert.match($('settings-status').textContent, /Lista exportada: 1 título/);
    // Import: new titles are added, known ones and anything that is not a title are left out.
    const file = items => { Object.defineProperty($('list-file'), 'files', { configurable: true, value: [new w.File([JSON.stringify(items)], 'lista.json', { type: 'application/json' })] }); press(w, $('list-file')); };
    const wait = async () => { for (let i = 0; i < 5; i++) { await new Promise(resolve => setTimeout(resolve, 10)); await flush(); } };
    file({ items: [movie, series, { id: 'x', type: 'movie' }, { id: 'tt0111161', type: 'movie', name: 'Otra', poster: 'https://image.tmdb.org/t/p/w342/a.jpg', extra: { big: true } }] }); await wait();
    assert.match($('settings-status').textContent, /2 títulos añadidos a Mi lista\. 1 ya estaba\./);
    assert.deepEqual(JSON.parse(w.localStorage.getItem(listKey('p1'))).map(i => i.id), [movie.id, series.id, 'tt0111161']);
    assert.equal(JSON.parse(w.localStorage.getItem(listKey('p1')))[2].extra, undefined);
    file('nada'); await wait();
    assert.match($('settings-status').textContent, /no contiene una lista/);
    // Emptying asks twice and touches this profile only.
    $('list-clear').click();
    assert.equal(JSON.parse(w.localStorage.getItem(listKey('p1'))).length, 3);
    $('list-clear').click();
    assert.deepEqual(JSON.parse(w.localStorage.getItem(listKey('p1'))), []);
    assert.equal(JSON.parse(w.localStorage.getItem(listKey('p2'))).length, 1);
    assert.equal($('list-clear').disabled, true);
    // Wiping removes every profile and list, and the page goes on with a fresh profile.
    $('wipe-all').click(); $('wipe-all').click(); await flush();
    assert.equal(w.localStorage.getItem(listKey('p1')), null);
    assert.equal(w.localStorage.getItem(listKey('p2')), null);
    assert.deepEqual(stored(w).profiles.map(p => p.name), ['Principal']);
    assert.equal($('profile-name').textContent, 'Principal');
    assert.equal($('set-profile-title').textContent, 'Principal');
  } finally { dom.window.close(); }
});

test('profiles: with storage blocked the page still works for the visit', async () => {
  const { dom, w, $ } = setup({ prepare: w => { for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(w, name, { configurable: true, get() { throw new w.DOMException('blocked', 'SecurityError'); } }); } });
  try {
    await flush();
    assert.equal($('profile-name').textContent, 'Principal');
    assert.equal($('hero-title').textContent, movie.name);
    $('grid').querySelector('button').click(); await flush();
    $('save').click(); assert.match($('save').textContent, /En mi lista/);
    $('profile-button').click(); $('menu-settings').click();
    choose(w, 'pref-posters', 'large');
    assert.equal(w.document.documentElement.dataset.posters, 'large');
    assert.match($('settings-status').textContent, /no permite guardar/);
  } finally { dom.window.close(); }
});
