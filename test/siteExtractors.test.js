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
const gnula = require('../lib/sites/gnulaone');
const ultra = require('../lib/sites/ultra');
const tube = require('../lib/sites/tubeonline');
const mirando = require('../lib/sites/mirandogratis');

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

test('gnulaone: slug, candidatos y enlaces trembed de la ficha medida', () => {
  assert.equal(gnula.slugify('Spider-Man: Un nuevo día'), 'spider-man-un-nuevo-dia');
  assert.deepEqual(gnula.candidatePages(['Spider-Man: Un nuevo día'], '2026', 'movie'), [
    'https://ver.gnula.one/movies/spider-man-un-nuevo-dia/',
    'https://ver.gnula.one/movies/spider-man-un-nuevo-dia-2026/',
  ]);
  const { load } = require('cheerio');
  const $ = load(fixture('gnula-movie.html'));
  const links = gnula.embedLinks($, 'https://ver.gnula.one/movies/spider-man-un-nuevo-dia/');
  assert.equal(links.length, 4, 'solo los ?trembed, sin repetir');
  assert.equal(links[0].label, 'Latino · Links');
  assert.equal(gnula.audioFromLink(links[0].label), 'Latino');
  assert.equal(gnula.audioFromLink(links[3].label), 'Castellano');
  assert.equal(gnula.matchDetail($, ['Spider-Man: Un nuevo día'], '2026', 'movie'), true);
  assert.equal(gnula.matchDetail($, ['Otra película'], '2026', 'movie'), false);
});

test('gnulaone: sigue trembed → hub y no gasta peticiones en visores opacos', async () => {
  const stub = stubFetch({
    'https://ver.gnula.one/movies/spider-man-un-nuevo-dia/': fixture('gnula-movie.html'),
    're:^https://ver\\.gnula\\.one/\\?trembed=': fixture('gnula-trembed.html'),
    'https://links.fiuxy2.com/play/': `<button data-src="https://streamwish.to/e/opaco1#lang=LAT">Streamwish</button>
      <button data-src="https://mixdrop.top/e/mkkkzkqla6x18g#lang=LAT">MixDrop</button>`,
    'https://mixdrop.top/e/': fixture('mixdrop-embed.html'),
  });
  try {
    const result = await gnula.searchGnulaOne('x', { title: 'Spider-Man: Un nuevo día', year: '2026', mediaType: 'movie' }, undefined, 4000);
    assert.ok(Array.isArray(result.hits), JSON.stringify(result));
    assert.equal(result.hits.length, 1, 'solo el visor extraíble');
    assert.equal(result.hits[0].audioLabel, 'Latino');
    assert.match(result.hits[0].url, /mxcontent\.net\/v2\/mkkkzkqla6x18g\.mp4/);
    assert.ok(!stub.calls.some((call) => call.url.includes('streamwish')), 'no se abre el visor opaco');
  } finally { stub.restore(); }
});

test('gnulaone: una serie sin enlaces de episodio se declara, no se inventa', async () => {
  const stub = stubFetch({});
  const result = await gnula.searchGnulaOne('x', { title: 'The Last of Us', year: '2023', mediaType: 'series', season: 1, episode: 1 }, undefined, 2000);
  stub.restore();
  assert.equal(result.skipped, 'series-needs-js');
});

test('ultra: identidad por ficha (h1 + f-info) y pestañas de idioma', () => {
  const { load } = require('cheerio');
  const $ = load(fixture('ultra-hope.html'));
  assert.equal(ultra.matchMovie($, { title: 'Hope', altTitle: 'Hopeu', year: '2026' }), true);
  assert.equal(ultra.matchMovie($, { title: 'Otra', year: '2026' }), false);
  assert.equal(ultra.matchMovie($, { title: 'Hope', year: '2020' }), false);
  const blocks = ultra.playerBlocks($, 'https://verpeliculasultra.com/accion/5276-hope.html');
  assert.deepEqual(blocks.map((b) => b.language), ['Latino', 'Español', 'Subtitulada', 'Subtitulada']);
  assert.equal(blocks[0].url, 'https://hgcloud.to/e/aiy9yqjwoul5');
  assert.equal(blocks[1].url, 'https://powvideo.org/embed-99ess8o65y66-800x400.html');
});

test('ultra: solo películas; el año ya no es obligatorio (buscador DLE)', async () => {
  assert.equal((await ultra.searchUltra('x', { title: 'Hope', mediaType: 'series', year: '2026' })).skipped, 'series-not-supported');
  // Sin año el buscador DLE sigue funcionando: busca y no encuentra nada.
  const stub = stubFetch({});
  try {
    const result = await ultra.searchUltra('x', { title: 'Hope', mediaType: 'movie' });
    assert.equal(result.reason, 'no-match');
    assert.ok(stub.calls.some((call) => call.method === 'POST' && /do=search/.test(call.body)),
      'el buscador DLE es un POST con do=search');
  } finally { stub.restore(); }
});

test('tubeonline: episodio exacto por numerando y servidores por data-post', () => {
  const { load } = require('cheerio');
  const $ = load(fixture('tube-serie.html'));
  assert.equal(tube.episodeLink($, 1, 2), 'https://www.tubeonline.net/episodio/the-last-of-us-1x2/');
  assert.equal(tube.episodeLink($, 9, 9), null, 'no se inventa un capítulo que no está');
  const movie = load(`<div id="player-option-1" data-post="123" data-nume="1" data-type="movie">
      <span class="server">Byse</span><img src="https://www.tubeonline.net/wp-content/themes/dooplay/assets/img/flags/mx.png"></div>
    <div id="player-option-2" data-post="123" data-nume="2" data-type="movie">
      <span class="server">Streamtape</span><img src="https://www.tubeonline.net/wp-content/themes/dooplay/assets/img/flags/es.png"></div>`);
  const options = tube.playerOptions(movie);
  assert.deepEqual(options.map((o) => [o.post, o.nume, o.server, o.audio]), [
    ['123', '1', 'Byse', 'Latino'], ['123', '2', 'Streamtape', 'Castellano'],
  ]);
});

test('tubeonline: el embed sale de admin-ajax y se extrae una sola vez', async () => {
  const stub = stubFetch({
    'https://www.tubeonline.net/pelicula/spider-man-un-nuevo-dia/': `<!doctype html><html><body>
      <h1>Spider-Man: Un nuevo día</h1><span class="srelease">2026</span>
      <div id="player-option-1" data-post="999" data-nume="1" data-type="movie"><span class="server">Byse</span></div>
      <div id="player-option-2" data-post="999" data-nume="2" data-type="movie"><span class="server">Vidara</span></div>
      </body></html>`,
    'https://www.tubeonline.net/wp-admin/admin-ajax.php': (url, options) => {
      const body = String(options.body || '');
      if (body.includes('nume=1')) return { body: JSON.stringify({ embed_url: 'https://byseraguci.com/e/abc123def' }), type: 'application/json' };
      return { body: JSON.stringify({ embed_url: 'https://vidara.to/e/zzz' }), type: 'application/json' };
    },
    're:^https://byseraguci\\.com/api/videos/': (url) => {
      // El mismo cifrado real, generado al vuelo para esta prueba.
      const crypto = require('node:crypto');
      const parts = [crypto.randomBytes(24), crypto.randomBytes(8)];
      const iv = crypto.randomBytes(12);
      const plain = JSON.stringify({ sources: [{ file: 'https://cdn.example.com/t/master.m3u8' }] });
      const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.concat(parts), iv);
      const payload = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
      return { body: JSON.stringify({ playback: { algorithm: 'AES-256-GCM', iv: iv.toString('base64url'),
        key_parts: parts.map((p) => p.toString('base64url')), payload: payload.toString('base64url') } }), type: 'application/json' };
    },
  });
  try {
    const result = await tube.searchTubeOnline('x', { title: 'Spider-Man: Un nuevo día', year: '2026', mediaType: 'movie' }, undefined, 4000);
    assert.equal(result.hits.length, 1, JSON.stringify(result));
    assert.equal(result.hits[0].url, 'https://cdn.example.com/t/master.m3u8');
    const ajax = stub.calls.filter((call) => call.url.endsWith('admin-ajax.php'));
    assert.equal(ajax.length, 2, 'un POST por servidor publicado');
    // Byse (extraíble) se prueba antes que Vidara (opaco).
    assert.match(ajax[0].body, /action=doo_player_ajax&post=999&nume=1&type=movie/);
  } finally { stub.restore(); }
});

test('mirandogratis: iframes de opciones sin YouTube y audio declarado', () => {
  const { load } = require('cheerio');
  const $ = load(fixture('mirando-reino.html'));
  const frames = mirando.playerFrames($, 'https://mirandogratis.com/el-reino-prohibido.html');
  assert.deepEqual(frames.map((f) => f.host), ['byseraguci.com', 'mixdrop.top']);
  assert.equal(mirando.declaredAudio($), 'Latino');
  assert.equal(mirando.matchDetail($, { title: 'El reino prohibido', year: '2008' }), true);
  assert.equal(mirando.matchDetail($, { title: 'El reino prohibido', year: '1999' }), false);
});

test('mirandogratis: ficha inexistente (404) no lanza', async () => {
  const stub = stubFetch({});
  try {
    const result = await mirando.searchMirandoGratis('x', { title: 'No existe', year: '2026', mediaType: 'movie' }, undefined, 2000);
    assert.deepEqual(result.hits, []);
    assert.equal(result.reason, 'no-match');
  } finally { stub.restore(); }
});

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
    const data = await http.json('https://www.tubeonline.net/wp-admin/admin-ajax.php', {
      method: 'POST', body: 'action=doo_player_ajax&post=1&nume=2&type=movie',
    });
    assert.equal(data.embed_url, 'https://byseraguci.com/e/x');
    assert.equal(seen[0].method, 'POST');
    assert.match(seen[0].body, /nume=2/);
  } finally { globalThis.fetch = original; }
});
