'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const embed69 = require('../lib/embed69');

const originalFetch = global.fetch;
after(() => { global.fetch = originalFetch; });

/** Arma un bloque de cifrado como el del sitio: IV(16) + AES-CBC. */
async function encrypt(plain, aesKey) {
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', aesKey, { name: 'AES-CBC' }, false, ['encrypt']);
  const data = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, new TextEncoder().encode(plain));
  const out = new Uint8Array(16 + data.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(data), 16);
  return Buffer.from(out).toString('base64');
}

/** base64 de `a.<json>.c`, el otro formato que usa la página. */
function dotted(url) {
  const payload = Buffer.from(JSON.stringify({ link: url }), 'utf8').toString('base64');
  return `a.${payload}.c`;
}

/** Clave AES que produce el PoW de este challenge (dificultad baja en tests). */
async function keyFor(challenge, difficulty, salt) {
  const target = '0'.repeat(difficulty);
  for (let i = 0; i < 200000; i++) {
    if ((await embed69.sha256Hex(`${challenge}${i}`)).startsWith(target)) {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${challenge}${i}${salt}`));
      return new Uint8Array(bytes);
    }
  }
  throw new Error('sin solución');
}

const CHALLENGE = 'abc123';
const DIFFICULTY = 2;
const SALT = 'salt-xyz';

function pageHtml(items) {
  return `<html><script>
    const POW_CHALLENGE = '${CHALLENGE}';
    const POW_DIFFICULTY = ${DIFFICULTY};
    const POW_SALT = '${SALT}';
    let dataLink = ${JSON.stringify(items)};
  </script></html>`;
}

test('embed69: parsea el PoW y el dataLink con objetos anidados', () => {
  const html = pageHtml([
    { video_language: 'LAT', sortedEmbeds: [{ servername: 'vidhide', link: 'a.b.c' }, { servername: 'download', link: 'x.y.z' }] },
    { video_language: 'ESP', sortedEmbeds: [{ servername: 'filemoon', link: 'q.r.s' }] },
  ]);
  const parsed = embed69.parsePlayerPage(html);
  assert.deepEqual(parsed.pow, { challenge: CHALLENGE, difficulty: DIFFICULTY, salt: SALT });
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[0].sortedEmbeds.length, 2, 'el JSON anidado no se corta en el primer cierre');
});

test('embed69: resuelve los dos formatos de enlace y descarta "download"', async () => {
  const aesKey = await keyFor(CHALLENGE, DIFFICULTY, SALT);
  const cifrado = await encrypt('https://filemoon.example/e/abc', aesKey);
  const html = pageHtml([
    {
      video_language: 'LAT',
      sortedEmbeds: [
        { servername: 'vidhide', link: dotted('https://vidhide.example/e/xyz') },
        { servername: 'filemoon', link: cifrado },
        { servername: 'Download', link: dotted('https://no.example/x') },
      ],
    },
    { video_language: 'ESP', sortedEmbeds: [{ servername: 'streamwish', link: dotted('https://streamwish.example/e/1') }] },
  ]);
  const servers = await embed69.resolveEmbeds(embed69.parsePlayerPage(html));
  assert.deepEqual(servers.map((s) => s.url), [
    'https://vidhide.example/e/xyz',
    'https://filemoon.example/e/abc',
    'https://streamwish.example/e/1',
  ]);
  assert.deepEqual(servers.map((s) => s.label), ['Latino', 'Latino', 'Castellano']);
});

test('embed69: la URL de la ficha usa IMDb y el formato -SxE en episodios', () => {
  assert.equal(embed69.pageUrl({ imdbId: 'tt0816692', mediaType: 'movie' }), 'https://embed69.org/f/tt0816692/');
  assert.equal(
    embed69.pageUrl({ imdbId: 'tt0903747', mediaType: 'series', season: 1, episode: 2 }),
    'https://embed69.org/f/tt0903747-1x2/'
  );
  // Sin IMDb no hay nada que pedir; sin temporada tampoco hay episodio.
  assert.equal(embed69.pageUrl({ mediaType: 'movie' }), null);
  assert.equal(embed69.pageUrl({ imdbId: 'tt0903747', mediaType: 'series' }), null);
});

test('embed69: el buscador devuelve streams directos y respeta EMBED69_POW=off', async () => {
  const config = require('../lib/config');
  const aesKey = await keyFor(CHALLENGE, DIFFICULTY, SALT);
  const cifrado = await encrypt('https://vidhide.example/e/ep1', aesKey);
  global.fetch = async () => new Response(pageHtml([
    { video_language: 'LAT', sortedEmbeds: [{ servername: 'vidhide', link: cifrado }] },
  ]), { status: 200, headers: { 'content-type': 'text/html' } });

  try {
    const resolved = { title: 'Breaking Bad', imdbId: 'tt0903747', mediaType: 'series', season: 1, episode: 1 };
    const found = await embed69.searchEmbed69('Breaking Bad S01E01', resolved, 'Breaking Bad', 5000);
    assert.equal(found.hits.length, 1);
    assert.equal(found.hits[0].url, 'https://vidhide.example/e/ep1');
    assert.equal(found.hits[0].audioLabel, 'Latino');
    assert.equal(found.hits[0].relevant, true);

    config.embed69Pow = 'off';
    const off = await embed69.searchEmbed69('x', resolved, 'x', 1000);
    config.embed69Pow = 'auto';
    assert.match(off.skipped, /EMBED69_POW=off/);
  } finally {
    config.embed69Pow = 'auto';
  }
});

test('embed69: sin enlaces en la página no inventa nada', async () => {
  global.fetch = async () => new Response('<html>Nada que ver</html>', { status: 200, headers: { 'content-type': 'text/html' } });
  const resolved = { title: 'X', imdbId: 'tt0000001', mediaType: 'movie' };
  const found = await embed69.searchEmbed69('X', resolved, 'X', 2000);
  assert.deepEqual(found.hits, []);
});
