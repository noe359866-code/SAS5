'use strict';

/**
 * Pruebas de los extractores y de los cuatro proveedores nuevos.
 *
 * Los HTML de `test/fixtures/sites` son recortes reales medidos el 19-11-2026
 * con `scripts/sites-probe.mjs` (títulos, pestañas, iframes y scripts tal como
 * los sirve el sitio). No hay red: los `fetch` se sustituyen por un servidor
 * de rutas que responde con esos ficheros y con cuerpos sintéticos.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { extractorFor, sourcesFromHtml, extractEmbed } = require('../lib/extractors');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'sites', name), 'utf8');

/** Sustituye `fetch` por un mapa url→respuesta durante una prueba. */
function stubFetch(routes) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.push({ url: target, method: options.method || 'GET', body: options.body || '' });
    for (const [pattern, handler] of Object.entries(routes)) {
      const matches = pattern.startsWith('re:') ? new RegExp(pattern.slice(3)).test(target) : target.startsWith(pattern);
      if (!matches) continue;
      const result = typeof handler === 'function' ? handler(target, options) : handler;
      if (result === undefined) continue;
      const body = typeof result === 'string' ? result : result.body ?? '';
      return new Response(body, { status: result.status ?? 200, headers: { 'content-type': result.type || 'text/html; charset=utf-8' } });
    }
    return new Response('', { status: 404 });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

// ── Clasificación de visores ─────────────────────────────────────────────

test('extractorFor reconoce los visores soportados y descarta los opacos', () => {
  assert.equal(extractorFor('https://byseraguci.com/e/intdacsm8cvn'), 'byse');
  assert.equal(extractorFor('https://mixdrop.top/e/mkkkzkqla6x18g'), 'mixdrop');
  assert.equal(extractorFor('https://streamtape.com/e/abc'), 'streamtape');
  assert.equal(extractorFor('https://vpge.link/e/SXMy'), 'videohel');
  // Mismo main.js ofuscado de 71 KB: ni una petición.
  for (const host of ['hglink.to', 'hgcloud.to', 'streamwish.to', 'vidhidepro.com', 'voe.sx']) {
    assert.equal(extractorFor(`https://${host}/e/x`), 'opaque', host);
  }
  assert.equal(extractorFor('https://powvideo.org/embed-1.html'), 'opaque');
  assert.equal(extractorFor('https://example.com/e/x'), null);
  assert.equal(extractorFor('no-es-url'), null);
});

// ── Visores ──────────────────────────────────────────────────────────────

test('mixdrop: desempaqueta el embed real y devuelve el MP4 firmado', async () => {
  const stub = stubFetch({ 'https://mixdrop.top/e/': fixture('mixdrop-embed.html') });
  try {
    const result = await extractEmbed('https://mixdrop.top/e/mkkkzkqla6x18g', { timeoutMs: 3000 });
    assert.equal(result.ok, true);
    assert.equal(result.extractor, 'mixdrop');
    assert.equal(result.sources.length, 1);
    assert.match(result.sources[0].url, /^https:\/\/1y04jx1s6\.mxcontent\.net\/v2\/mkkkzkqla6x18g\.mp4\?s=/);
    assert.equal(result.sources[0].kind, 'mp4');
  } finally { stub.restore(); }
});

test('byse: una petición a su API y descifrado AES-256-GCM', async () => {
  const crypto = require('node:crypto');
  const mp = require('../lib/mediaParse');
  const parts = [crypto.randomBytes(24), crypto.randomBytes(8)];
  const iv = crypto.randomBytes(12);
  const plain = JSON.stringify({ sources: [{ file: 'https://cdn.example.com/b/master.m3u8', label: '1080p' }] });
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.concat(parts), iv);
  const payload = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const api = JSON.stringify({ title: 'Prueba', playback: { algorithm: 'AES-256-GCM', iv: iv.toString('base64url'),
    key_parts: parts.map((p) => p.toString('base64url')), payload: payload.toString('base64url') } });
  const stub = stubFetch({ 're:^https://byseraguci\\.com/api/videos/': { body: api, type: 'application/json' } });
  try {
    const result = await extractEmbed('https://byseraguci.com/e/abc123def', { timeoutMs: 3000 });
    assert.equal(result.ok, true);
    assert.deepEqual(result.sources, [{ url: 'https://cdn.example.com/b/master.m3u8', kind: 'hls', label: '1080p' }]);
    assert.equal(stub.calls.length, 1, 'no debe abrir el HTML del embed');
  } finally { stub.restore(); }
  assert.ok(mp, 'el módulo sigue cargando');
});

test('byse: el código va tras /e/ aunque venga el nombre del archivo', async () => {
  // Dooplay devuelve `https://bysejikuar.com/e/<code>/<slug-del-archivo>`:
  // el código no es el último segmento.
  const crypto = require('node:crypto');
  const parts = [crypto.randomBytes(24), crypto.randomBytes(8)];
  const iv = crypto.randomBytes(12);
  const plain = JSON.stringify({ sources: [{ file: 'https://cdn.example.com/b/master.m3u8' }] });
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.concat(parts), iv);
  const payload = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const api = JSON.stringify({ playback: { algorithm: 'AES-256-GCM', iv: iv.toString('base64url'),
    key_parts: parts.map((p) => p.toString('base64url')), payload: payload.toString('base64url') } });
  const stub = stubFetch({ 're:^https://bysejikuar\\.com/api/videos/': { body: api, type: 'application/json' } });
  try {
    const result = await extractEmbed('https://bysejikuar.com/e/01j37fv5s579/sm1nda-1080-cas', { timeoutMs: 3000 });
    assert.equal(result.ok, true);
    assert.equal(result.sources[0].url, 'https://cdn.example.com/b/master.m3u8');
    assert.equal(stub.calls[0].url, 'https://bysejikuar.com/api/videos/01j37fv5s579');
  } finally { stub.restore(); }
});

test('byse: un playback indescifrable no rompe ni publica nada', async () => {
  const api = JSON.stringify({ playback: { algorithm: 'AES-256-GCM', iv: 'AAAAAAAAAAAAAAAA', key_parts: ['AAAA'], payload: 'AAAA' } });
  const stub = stubFetch({ 're:^https://byseraguci\\.com/api/videos/': { body: api, type: 'application/json' } });
  try {
    const result = await extractEmbed('https://byseraguci.com/e/abc123def', { timeoutMs: 3000 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'undecryptable');
  } finally { stub.restore(); }
});

test('videohel descarta el ejemplo comentado del HTML', async () => {
  // Fuente comentada (`/* olplayer.src({...}) */`): debe ignorarse.
  const commented = `<script>/* olplayer.src({ src: 'https://cdn.example.com/old/master.m3u8' }); */</script>`;
  const stub = stubFetch({ 'https://vpge.link/e/': commented });
  try {
    const result = await extractEmbed('https://vpge.link/e/abc', { timeoutMs: 3000 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'commented-out');
  } finally { stub.restore(); }
  const active = `<script>var player = { sources: [{ file: 'https://cdn.example.com/new/master.m3u8', type: 'hls' }] };</script>`;
  const stub2 = stubFetch({ 'https://vpge.link/e/': active });
  try {
    const result = await extractEmbed('https://vpge.link/e/abc', { timeoutMs: 3000 });
    assert.equal(result.ok, true);
    assert.equal(result.sources[0].url, 'https://cdn.example.com/new/master.m3u8');
  } finally { stub2.restore(); }
});

test('sourcesFromHtml ignora blobs, data: y anuncios', () => {
  const html = `<video src="blob:https://site/123"></video>
    <script>var x = { file: "https://ads.doubleclick.net/ads/ad.mp4" };
    var y = { file: "https://cdn.example.com/good/master.m3u8" };</script>`;
  const { sources } = sourcesFromHtml(html, 'https://site/pelicula/');
  assert.deepEqual(sources.map((s) => s.url), ['https://cdn.example.com/good/master.m3u8']);
});

test('extractEmbed: un visor desconocido no gasta peticiones', async () => {
  const stub = stubFetch({});
  try {
    const result = await extractEmbed('https://desconocido.example/e/1', { timeoutMs: 3000 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unsupported-host');
    assert.equal(stub.calls.length, 0);
  } finally { stub.restore(); }
});

// ── Proveedores de sitio ─────────────────────────────────────────────────










// ── Comportamiento de la capa HTTP de los adaptadores ───────────────────

test('providerHttp: sigue un 301 canónico (barra final) una sola vez', async () => {
  const { providerHttp } = require('../lib/providerHttp');
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url) === 'https://ver.gnula.one/movies/inception') {
      return new Response('', { status: 301, headers: { location: 'https://ver.gnula.one/movies/inception/' } });
    }
    return new Response('<h1>ok</h1>', { status: 200 });
  };
  try {
    const http = providerHttp(3000, 3);
    const body = await http.text('https://ver.gnula.one/movies/inception');
    assert.match(body, /ok/);
  } finally { globalThis.fetch = original; }
});

test('providerHttp: un 301 a otra ruta se rechaza en vez de aceptar la portada', async () => {
  const { providerHttp } = require('../lib/providerHttp');
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 301, headers: { location: 'https://ver.gnula.one/' } });
  try {
    const http = providerHttp(3000, 3);
    await assert.rejects(() => http.text('https://ver.gnula.one/movies/no-existe/'), (err) => err.status === 301);
  } finally { globalThis.fetch = original; }
});

test('providerHttp: el POST de Dooplay llega con cuerpo y método', async () => {
  const { providerHttp } = require('../lib/providerHttp');
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    seen.push({ method: options.method, body: options.body, hasRedirect: 'redirect' in options });
    return new Response('{"embed_url":"https://byseraguci.com/e/x"}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const http = providerHttp(3000, 2);
    const data = await http.json('https://sitio.example/wp-admin/admin-ajax.php', {
      method: 'POST', body: 'action=doo_player_ajax&post=1&nume=2&type=movie',
    });
    assert.equal(data.embed_url, 'https://byseraguci.com/e/x');
    assert.equal(seen[0].method, 'POST');
    assert.match(seen[0].body, /nume=2/);
  } finally { globalThis.fetch = original; }
});
