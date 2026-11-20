'use strict';

/**
 * Pruebas de animeav1.com.
 *
 * Los HTML de `test/fixtures/sites/animeav1-{catalogo,ficha,episodio}.html` son
 * respuestas reales medidas el 20-11-2026 con la captura del workflow de sondas
 * (`scripts/fixtures-capture.mjs`): el buscador de «ore dake level up na ken»,
 * la ficha de la primera temporada y su episodio 1, con los dos grupos
 * `embeds:{SUB,DUB}` y el bloque `downloads`.
 *
 * No hay red: `fetch` se sustituye por un mapa de rutas. El manifiesto del
 * visor propio se simula con un `#EXTM3U` mínimo.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const anime = require('../lib/sites/animeav1');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'sites', name), 'utf8');
const CATALOGO = fixture('animeav1-catalogo.html');
const FICHA = fixture('animeav1-ficha.html');
const EPISODIO = fixture('animeav1-episodio.html');

const BASE = 'https://animeav1.com';
const SERIE = { title: 'Ore dake Level Up na Ken', altTitle: 'Solo Leveling', year: 2024, mediaType: 'series', season: 1, episode: 1 };
const OTRA = { title: 'One Piece', year: 1999, mediaType: 'series', season: 1, episode: 1 };

const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

function stub(routes) {
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

// ── Marcado ───────────────────────────────────────────────────────────────

test('animeav1: el buscador real devuelve la ficha de la obra pedida', () => {
  const found = anime.listingMatches(CATALOGO, SERIE);
  assert.deepEqual(found, [`${BASE}/media/ore-dake-level-up-na-ken`]);
  // Otra obra no casa aunque el buscador la devuelva en la misma página.
  assert.deepEqual(anime.listingMatches(CATALOGO, OTRA), []);
});

test('animeav1: la identidad de la ficha se comprueba por el h1', () => {
  assert.equal(anime.detailTitle(FICHA), 'Ore dake Level Up na Ken');
  assert.equal(anime.matchDetail(FICHA, SERIE), true);
  assert.equal(anime.matchDetail(FICHA, OTRA), false);
});

test('animeav1: el título del documento se limpia de «Ver … Online Sub Español»', () => {
  assert.equal(anime.titleFromDoc('Ver Ore dake Level Up na Ken Episodio 1 Sub Español Online en HD - AnimeAV1'), 'Ore dake Level Up na Ken');
  assert.equal(anime.titleFromDoc('Ver Boku no Hero Academia Online Sub Español en HD - AnimeAV1'), 'Boku no Hero Academia');
});

test('animeav1: la ficha lista sus 12 episodios y se elige por número', () => {
  const list = anime.episodesOf(FICHA, `${BASE}/media/ore-dake-level-up-na-ken`);
  assert.equal(list.length, 12);
  assert.equal(list[0].number, 1);
  assert.match(list[0].url, /\/media\/ore-dake-level-up-na-ken\/1$/);
  assert.equal(anime.pickEpisode(list, SERIE).number, 1);
  assert.equal(anime.pickEpisode(list, { ...SERIE, episode: 40 }), null);
});

test('animeav1: los visores salen de embeds SUB/DUB y las descargas no cuentan', () => {
  const servers = anime.serversOf(EPISODIO);
  assert.equal(servers.length, 13);
  // Los dos grupos están: latino y subtitulado, con el mismo reparto de hosts.
  assert.ok(servers.some((s) => s.group === 'DUB' && s.audio === 'Latino'));
  assert.ok(servers.some((s) => s.group === 'SUB' && s.audio === 'Subtitulado'));
  // `downloads` trae Mega, 1Fichier y TransferIt: no son visores.
  assert.ok(!servers.some((s) => /mega\.nz|1fichier|transfer\.it/.test(s.url)));
  // El visor propio aparece en los dos idiomas.
  assert.equal(servers.filter((s) => s.server === 'HLS').length, 2);
});

test('animeav1: el visor propio se convierte en su manifiesto', () => {
  assert.equal(anime.manifestOf('https://player.zilla-networks.com/play/9ede96bdd0a7a106f9d59a5d22679b3f'),
    'https://player.zilla-networks.com/m3u8/9ede96bdd0a7a106f9d59a5d22679b3f');
  assert.equal(anime.manifestOf('https://voe.sx/e/iq4y0uxomypn'), '');
  assert.equal(anime.manifestOf(''), '');
});

// ── Recorrido completo ────────────────────────────────────────────────────

test('animeav1: buscador → ficha → episodio → manifiesto, con latino y subtitulado', async () => {
  const stubbed = stub([
    ['/catalogo?search=', html(CATALOGO)],
    [`${BASE}/media/ore-dake-level-up-na-ken/1`, html(EPISODIO)],
    ['/media/ore-dake-level-up-na-ken', html(FICHA)],
    // Una `Response` de verdad solo se puede leer una vez: se fabrica una nueva
    // por petición, porque el adaptador comprueba los dos visores propios.
    ['player.zilla-networks.com/m3u8/', () => new Response('#EXTM3U\n#EXT-X-VERSION:3\n', { status: 200, headers: { 'content-type': 'application/x-mpegURL' } })],
  ]);
  try {
    const out = await anime.searchAnimeAv1('Ore dake Level Up na Ken', SERIE, SERIE.title, 6000);
    assert.ok(out.hits.length >= 2, `hits=${out.hits.length}`);
    const audios = out.hits.map((hit) => hit.audioLabel);
    assert.ok(audios.includes('Latino'), audios.join(','));
    assert.ok(audios.includes('Subtitulado'), audios.join(','));
    for (const hit of out.hits) {
      assert.equal(hit.provider, 'animeav1');
      assert.equal(hit.quality, 'HLS');
      assert.match(hit.url, /^https:\/\/player\.zilla-networks\.com\/m3u8\/[a-f0-9]+$/);
      assert.match(hit.title, /S1E1/);
    }
    // La ficha se eligió por título: se abrió el episodio 1 exacto.
    assert.ok(stubbed.calls.some((url) => url.endsWith('/media/ore-dake-level-up-na-ken/1')));
  } finally { stubbed.restore(); }
});

test('animeav1: con SUB y DUB propios no se abren los visores de terceros', async () => {
  // El visor propio sirve las dos pistas; abrir después Byse/Voe solo gasta el
  // tiempo del turno (en vivo, Naruto acabó en `probe-timeout`).
  const stubbed = stub([
    ['/catalogo?search=', html(CATALOGO)],
    [`${BASE}/media/ore-dake-level-up-na-ken/1`, html(EPISODIO)],
    ['/media/ore-dake-level-up-na-ken', html(FICHA)],
    ['player.zilla-networks.com/m3u8/', () => new Response('#EXTM3U\n#EXT-X-VERSION:3\n', { status: 200, headers: { 'content-type': 'application/x-mpegURL' } })],
  ]);
  try {
    const out = await anime.searchAnimeAv1('Ore dake Level Up na Ken', SERIE, SERIE.title, 6000);
    assert.deepEqual([...new Set(out.hits.map((hit) => hit.audioLabel))].sort(), ['Latino', 'Subtitulado']);
    assert.ok(out.hits.every((hit) => /zilla-networks/.test(hit.url)), out.hits.map((hit) => hit.url).join(','));
    const embedded = stubbed.calls.filter((url) => /byselapuix|voe\.sx|mp4upload|streamtape|yourupload/i.test(url));
    assert.deepEqual(embedded, []);
  } finally { stubbed.restore(); }
});

test('animeav1: el manifiesto real (~14 KB) cabe en el tope de lectura', async () => {
  // El visor propio sirve una lista maestra de unos 14 KB. Con un tope de 2 KB
  // la lectura fallaba con «Respuesta demasiado grande» y el visor se
  // descartaba en vivo aunque la ruta `/m3u8/<hex>` fuese la correcta.
  const manifest = `#EXTM3U\n${'#EXT-X-STREAM-INF:BANDWIDTH=800000\nhttps://cdn.example/x.m3u8\n'.repeat(240)}`;
  assert.ok(manifest.length > 14 * 1024, `manifiesto de ${manifest.length}B`);
  const stubbed = stub([
    ['/catalogo?search=', html(CATALOGO)],
    [`${BASE}/media/ore-dake-level-up-na-ken/1`, html(EPISODIO)],
    ['/media/ore-dake-level-up-na-ken', html(FICHA)],
    ['player.zilla-networks.com/m3u8/', () => new Response(manifest, {
      status: 200,
      headers: { 'content-type': 'application/x-mpegURL', 'content-length': String(Buffer.byteLength(manifest)) },
    })],
  ]);
  try {
    const out = await anime.searchAnimeAv1('Ore dake Level Up na Ken', SERIE, SERIE.title, 6000);
    assert.ok(out.hits.some((hit) => /zilla-networks/.test(hit.url)), `hits=${JSON.stringify(out.hits.map((h) => h.url))} ${out.reason}`);
  } finally { stubbed.restore(); }
});

test('animeav1: la temporada del slug manda cuando el h1 no la menciona', () => {
  assert.equal(anime.seasonOfSlug('https://animeav1.com/media/ore-dake-level-up-na-ken-season-2'), 2);
  assert.equal(anime.seasonOfSlug('https://animeav1.com/media/ore-dake-level-up-na-ken'), null);
});

test('animeav1: la temporada también se reconoce en la forma «2nd-season»', () => {
  // `/media/black-clover-2nd-season` es la ficha de la temporada 2 medida en
  // vivo; sin reconocerla, la serie quedaba en `no-match`.
  assert.equal(anime.seasonOfSlug(`${BASE}/media/black-clover-2nd-season`), 2);
  assert.equal(anime.seasonOfSlug(`${BASE}/media/black-clover-3rd-season`), 3);
  assert.equal(anime.seasonOfSlug(`${BASE}/media/naruto`), null);
});

test('animeav1: la ficha «2nd-season» del buscador sirve para pedir la temporada 2', async () => {
  // Dos fichas hermanas en el buscador: la de la temporada 1 (se descarta por
  // el slug) y la de la 2, que es la que acaba sirviendo los episodios.
  const listing = `<html><body>
    <article><a href="/media/black-clover"><img alt="Portada de Black Clover"></a><h3>Black Clover</h3></article>
    <article><a href="/media/black-clover-2nd-season"><img alt="Portada de Black Clover"></a><h3>Black Clover</h3></article>
  </body></html>`;
  const pedida = { title: 'Black Clover', year: 2017, mediaType: 'series', season: 2, episode: 1 };
  assert.deepEqual(anime.listingMatches(listing, pedida), [
    `${BASE}/media/black-clover`,
    `${BASE}/media/black-clover-2nd-season`,
  ]);
  const fichaDos = FICHA
    .replace(/ore-dake-level-up-na-ken/g, 'black-clover-2nd-season')
    .replace(/Ore dake Level Up na Ken/g, 'Black Clover');
  const stubbed = stub([
    ['/catalogo?search=', () => html(listing)],
    [`${BASE}/media/black-clover-2nd-season/1`, () => html(EPISODIO)],
    ['/media/black-clover-2nd-season', () => html(fichaDos)],
    ['/media/black-clover', () => html(FICHA)],
    ['player.zilla-networks.com/m3u8/', () => new Response('#EXTM3U\n#EXT-X-VERSION:3\n', { status: 200, headers: { 'content-type': 'application/x-mpegURL' } })],
  ]);
  try {
    const out = await anime.searchAnimeAv1('Black Clover', pedida, pedida.title, 6000);
    assert.ok(out.hits.length >= 1, `hits=${out.hits.length} ${out.reason}`);
    assert.ok(stubbed.calls.some((url) => url === `${BASE}/media/black-clover-2nd-season`), 'se abrió la ficha de la temporada 2');
    assert.ok(stubbed.calls.some((url) => url === `${BASE}/media/black-clover-2nd-season/1`), 'episodio 1 de la temporada 2');
    assert.ok(!stubbed.calls.some((url) => url === `${BASE}/media/black-clover/1`), 'no se abrió el episodio de la temporada 1');
  } finally { stubbed.restore(); }
});

test('animeav1: una ficha de otra temporada no se usa para la pedida', async () => {
  const stubbed = stub([
    ['/catalogo?search=', html(CATALOGO)],
    [`${BASE}/media/ore-dake-level-up-na-ken/1`, html(EPISODIO)],
    ['/media/ore-dake-level-up-na-ken', html(FICHA)],
  ]);
  try {
    const out = await anime.searchAnimeAv1('Ore dake Level Up na Ken', { ...SERIE, season: 2, episode: 1 }, SERIE.title, 6000);
    // La ficha medida es la temporada 1: para la 2 no hay coincidencia.
    assert.deepEqual(out.hits, []);
    assert.equal(out.reason, 'no-match');
  } finally { stubbed.restore(); }
});

test('animeav1: si el manifiesto no responde HLS, no se publica el visor propio', async () => {
  const stubbed = stub([
    ['/catalogo?search=', html(CATALOGO)],
    [`${BASE}/media/ore-dake-level-up-na-ken/1`, html(EPISODIO)],
    ['/media/ore-dake-level-up-na-ken', html(FICHA)],
    ['player.zilla-networks.com/m3u8/', html('<html>no</html>', 404)],
  ]);
  try {
    const out = await anime.searchAnimeAv1('Ore dake Level Up na Ken', SERIE, SERIE.title, 6000);
    // Quedan los visores de terceros: opacos o sin extracción, nunca el propio.
    assert.ok(!out.hits.some((hit) => /zilla-networks/.test(hit.url)));
    assert.deepEqual(out.hits, []);
    assert.equal(out.reason, 'no-extractable-embed');
  } finally { stubbed.restore(); }
});

test('animeav1: sin identidad o sin episodio no se consulta el sitio', async () => {
  const stubbed = stub([]);
  try {
    assert.deepEqual(await anime.searchAnimeAv1('x', null, 'x', 5000), { skipped: 'identity-required' });
    assert.deepEqual(await anime.searchAnimeAv1('x', { ...SERIE, episode: 0 }, SERIE.title, 5000), { skipped: 'episode-required' });
    assert.equal(stubbed.calls.length, 0);
  } finally { stubbed.restore(); }
});

test('animeav1: una consulta que no devuelve fichas acaba en no-match', async () => {
  const stubbed = stub([
    ['/catalogo?search=', html('<html><body><article><h3>Otra cosa</h3><a href="/media/otra-cosa"></a></article></body></html>')],
    ['/media/', html('<html><body><h1>Otra cosa</h1></body></html>')],
  ]);
  try {
    const out = await anime.searchAnimeAv1('Ore dake Level Up na Ken', SERIE, SERIE.title, 6000);
    assert.deepEqual(out.hits, []);
    assert.equal(out.reason, 'no-match');
  } finally { stubbed.restore(); }
});
