'use strict';

/**
 * Pruebas del adaptador de fuegocine.com.
 *
 * Los HTML de `test/fixtures/sites/fuegocine-*.html` son recortes reales
 * medidos el 19-11-2026 con `scripts/fuegocine-probe.mjs` (buscador, ficha de
 * serie, temporada, página de reproducción y el bloque `EMBEDS` del visor).
 * No hay red: `fetch` se sustituye por un mapa de rutas.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const fuego = require('../lib/sites/fuegocine');
const { isDirectMedia } = require('../lib/directMedia');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'sites', name), 'utf8');
const SEARCH = fixture('fuegocine-search.html');
const SEARCH_SERIE = fixture('fuegocine-search-serie.html');
const SERIE = fixture('fuegocine-serie.html');
const TEMPORADA = fixture('fuegocine-temporada.html');
const WATCH = fixture('fuegocine-watch.html');
const EMBED = fixture('fuegocine-embed.html');
// Episodio real: el sitio escribe `<iframe src=…>` SIN cerrar.
const EPISODE = fixture('fuegocine-episodio.html');
const EPISODE_EMBED = fixture('fuegocine-embed-episodio.html');

const BASE = 'https://fuegocine.com';
const EPISODE_URL = `${BASE}/shows/visionquest/01x01-sin-ataduras/49`;
const DETAIL = `${BASE}/movies/details/spider-man-un-nuevo-d%C3%ADa/140`;
const WATCH_URL = `${BASE}/movies/watch/spider-man-un-nuevo-d%C3%ADa/140`;
const EMBED_URL = 'https://unlimplay.com/f/embed/movie/1368337';
const MOVIE = { title: 'Spider-Man: Un Nuevo Día', altTitle: null, year: 2026, mediaType: 'movie' };
const SERIES = { title: 'VisionQuest', altTitle: null, year: 2026, mediaType: 'series', season: 1, episode: 1 };

// Cada respuesta se construye al vuelo: un `Response` solo se puede leer una vez.
const html = (body, status = 200) => () => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

function stub(routes) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url) => {
    const target = String(url);
    calls.push(target);
    for (const [needle, reply] of routes) {
      if (!target.includes(needle)) continue;
      return reply(target);
    }
    return new Response('', { status: 404 });
  };
  return { calls, restore: () => { global.fetch = original; } };
}

// ── Buscador e identidad ──────────────────────────────────────────────────

test('fuegocine: el buscador separa películas y series y el título llega limpio', () => {
  const candidates = fuego.candidatesOf(SEARCH);
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0], { url: DETAIL, title: 'Spider-Man: Un Nuevo Día', kind: 'movie' });
});

test('fuegocine: se exige coincidencia de título y de tipo', () => {
  const candidates = fuego.candidatesOf(SEARCH);
  assert.equal(fuego.pick(candidates, MOVIE).url, DETAIL);
  assert.equal(fuego.pick(candidates, { ...MOVIE, title: 'Otra película' }), null);
  // La única ficha del recorte es una película: pedir serie no vale.
  assert.equal(fuego.pick(candidates, { ...MOVIE, mediaType: 'series' }), null);
});

test('fuegocine: la ficha de reproducción se deriva de la de detalles', () => {
  assert.equal(fuego.watchUrlOf(DETAIL), WATCH_URL);
  assert.equal(fuego.watchUrlOf(''), '');
});

// ── Series ────────────────────────────────────────────────────────────────

test('fuegocine: temporadas por número y episodio por «SSxEE»', () => {
  const detail = `${BASE}/shows/details/visionquest/24`;
  const seasons = fuego.seasonsOf(SERIE, detail);
  assert.deepEqual([...seasons.keys()], [1]);
  assert.equal(seasons.get(1), `${BASE}/shows/visionquest/seasons/temporada-1/55`);

  const episodes = fuego.episodesOf(TEMPORADA, seasons.get(1));
  assert.equal(episodes.length, 8);
  assert.deepEqual(fuego.pickEpisode(episodes, SERIES), {
    code: '1x1', season: 1, episode: 1, url: `${BASE}/shows/visionquest/01x01-sin-ataduras/49`,
  });
  assert.equal(fuego.pickEpisode(episodes, { ...SERIES, episode: 99 }), null);
});

// ── Visor ─────────────────────────────────────────────────────────────────

test('fuegocine: de la página de reproducción solo sirve el visor de unlimplay', () => {
  const frames = fuego.framesOf(WATCH, WATCH_URL);
  assert.deepEqual(frames, [
    'https://videro.my/e/ueuf2z2cltcp6sw',
    'https://player.abyssplayer.com/KxBGoCWcV',
    EMBED_URL,
  ]);
});

test('fuegocine: los episodios publican los visores sin cerrar la etiqueta', () => {
  // Si se leyera con el DOM, el primer `<iframe>` se tragaría a los demás.
  assert.deepEqual(fuego.framesOf(EPISODE, EPISODE_URL), [
    'https://embedorigin.cc/e/vq7y85csf5k1',
    'https://fcplayer2.blogspot.com/?url=U2FsdGVkX194HdjlQEeV0ioJKS%2F2GpA5pEtScC30JnIxNSKlXdFwPAiaeZD831KYOETx3dectPJQnlFHtSaCfS9fk9tLsumosB2f8sYoYZw%3D&cover=https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Foriginal%2Fhzuvw1ypblYg2uJxVgz1dkeIvKd.jpg',
    'https://unlimplay.com/f/embed/tv/213375/1/1',
  ]);
});

test('fuegocine: en el episodio «español» solo publica un manifiesto mf.php, no un HLS', () => {
  const groups = fuego.embedsOf(EPISODE_EMBED);
  assert.deepEqual(Object.keys(groups), ['latino', 'español', 'subtitulado']);
  assert.equal(fuego.audioOf('español'), 'Castellano');
  // Latino y subtitulado traen `cps.php?x=.m3u8`; castellano, solo `mf.php`,
  // que es un manifiesto y el addon no lo descarga: se descarta.
  assert.match(fuego.hlsFromGroup(groups.latino).url, /^https:\/\/unlimplay\.com\/cps\.php\?/);
  assert.match(fuego.hlsFromGroup(groups.subtitulado).url, /^https:\/\/unlimplay\.com\/cps\.php\?/);
  assert.equal(fuego.hlsFromGroup(groups['español']), null);
});

test('fuegocine: el visor publica los idiomas y un HLS firmado por cada uno', () => {
  const groups = fuego.embedsOf(EMBED);
  assert.deepEqual(Object.keys(groups), ['latino', 'subtitulado']);
  const latino = fuego.hlsFromGroup(groups.latino);
  const subtitulado = fuego.hlsFromGroup(groups.subtitulado);
  assert.match(latino.url, /^https:\/\/unlimplay\.com\/cps\.php\?t=.+&x=\.m3u8$/);
  assert.match(subtitulado.url, /^https:\/\/unlimplay\.com\/cps\.php\?t=.+&x=\.m3u8$/);
  assert.notEqual(latino.url, subtitulado.url);
  assert.equal(latino.expiresAt, 1795116600000);
  // El grupo «subtitulado» no se confunde con latino.
  assert.equal(fuego.audioOf('latino'), 'Latino');
  assert.equal(fuego.audioOf('sub'), 'Subtitulado');
  assert.equal(fuego.audioOf('ingles'), 'Inglés');
  assert.equal(fuego.audioOf('klingon'), '');
});

test('fuegocine: el HLS solo se acepta del cps.php del visor y con la firma viva', () => {
  const ok = 'https://unlimplay.com/cps.php?t=s_abc&e=1795116600&s=deadbeef&x=.m3u8';
  assert.equal(fuego.cpsHls(ok).url, ok);
  // Fuera del visor, otra ruta, otro formato o sin token.
  assert.equal(fuego.cpsHls('https://unlimplay.com.evil.test/cps.php?t=s_abc&e=1795116600&x=.m3u8'), null);
  assert.equal(fuego.cpsHls('https://otro.example/cps.php?t=s_abc&e=1795116600&x=.m3u8'), null);
  assert.equal(fuego.cpsHls('https://unlimplay.com/mf.php?man=xm-1&s=abc'), null);
  assert.equal(fuego.cpsHls('https://unlimplay.com/cps.php?t=s_abc&e=1795116600&x=.mp4'), null);
  assert.equal(fuego.cpsHls('https://unlimplay.com/cps.php?e=1795116600&x=.m3u8'), null);
  // Firma caducada: no se publica.
  assert.equal(fuego.cpsHls('https://unlimplay.com/cps.php?t=s_abc&e=1600000000&s=deadbeef&x=.m3u8'), null);
});

// ── Recorrido completo ────────────────────────────────────────────────────

test('fuegocine película: buscador → watch → visor → HLS latino y subtitulado', async () => {
  const stubbed = stub([
    ['/search_elastic', html(SEARCH)],
    [`/movies/watch/`, html(WATCH)],
    [EMBED_URL, html(EMBED)],
  ]);
  try {
    const out = await fuego.searchFuegoCine('Spider-Man Un Nuevo Día', MOVIE, MOVIE.title, 5000);
    assert.equal(out.hits.length, 2);
    assert.deepEqual(out.hits.map((hit) => hit.audioLabel), ['Latino', 'Subtitulado']);
    assert.ok(out.hits.every((hit) => hit.provider === 'fuegocine' && hit.quality === 'HLS'));
    assert.ok(out.hits.every((hit) => /^https:\/\/unlimplay\.com\/cps\.php/.test(hit.url)));
    assert.ok(out.hits.every((hit) => hit.expiresAt === 1795116600000));
    // `cps.php?…&x=.m3u8` no lleva la extensión en la ruta: el filtro del
    // registro también tiene que reconocerlo como medio directo.
    assert.ok(out.hits.every((hit) => isDirectMedia(hit.url)));
    // No se abre ni videro (Cloudflare) ni abyssplayer (JS).
    assert.ok(!stubbed.calls.some((url) => /videro|abyssplayer/.test(url)));
  } finally { stubbed.restore(); }
});

test('fuegocine: el enlace de UnLimPlay llega al registro y se publica', async () => {
  const stubbed = stub([
    ['/search_elastic', html(SEARCH)],
    ['/movies/watch/', html(WATCH)],
    [EMBED_URL, html(EMBED)],
  ]);
  const streams = require('../lib/streams');
  const original = streams.SEARCHERS.fuegocine;
  try {
    streams.SEARCHERS.fuegocine = fuego.searchFuegoCine;
    const report = {};
    const hits = await streams.runProviders(['fuegocine'], 'Spider-Man Un Nuevo Día', MOVIE, MOVIE.title, report, 5000, { ignorePause: true });
    assert.equal(report.fuegocine.raw, 2, 'UnLimPlay declara dos audios aprovechables');
    assert.equal(report.fuegocine.accepted, 2);
    assert.equal(hits.length, 2);
    assert.ok(hits.every((hit) => /^https:\/\/unlimplay\.com\/cps\.php/.test(hit.url)));
  } finally {
    streams.SEARCHERS.fuegocine = original;
    stubbed.restore();
  }
});

test('fuegocine serie: buscador → ficha → temporada → episodio → visor', async () => {
  const detail = `${BASE}/shows/details/visionquest/24`;
  const stubbed = stub([
    ['/search_elastic', html(SEARCH_SERIE)],
    [detail, html(SERIE)],
    [`${BASE}/shows/visionquest/seasons/temporada-1/55`, html(TEMPORADA)],
    [EPISODE_URL, html(EPISODE)],
    ['https://unlimplay.com/f/embed/tv/213375/1/1', html(EPISODE_EMBED)],
  ]);
  try {
    const out = await fuego.searchFuegoCine('VisionQuest', SERIES, SERIES.title, 6000);
    assert.deepEqual(out.hits.map((hit) => hit.audioLabel), ['Latino', 'Subtitulado']);
    assert.ok(out.hits.every((hit) => /^https:\/\/unlimplay\.com\/cps\.php\?/.test(hit.url)));
    assert.equal(out.hits[0].title, 'VisionQuest S1E1 FuegoCine');
    // El visor del episodio trae tres servidores: solo se abre unlimplay.
    assert.ok(stubbed.calls.includes('https://unlimplay.com/f/embed/tv/213375/1/1'));
    assert.ok(!stubbed.calls.some((url) => /embedorigin|fcplayer2/.test(url)));
  } finally { stubbed.restore(); }
});

test('fuegocine serie: sin temporada ni episodio se degrada con su motivo', async () => {
  const detail = `${BASE}/shows/details/visionquest/24`;
  const base = [
    ['/search_elastic', html(SEARCH_SERIE)],
    [detail, html(SERIE)],
  ];
  let stubbed = stub(base);
  try {
    assert.equal((await fuego.searchFuegoCine('VisionQuest', { ...SERIES, season: 9 }, 'VisionQuest', 6000)).reason, 'no-season');
  } finally { stubbed.restore(); }
  stubbed = stub([...base, [`${BASE}/shows/visionquest/seasons/temporada-1/55`, html(TEMPORADA)]]);
  try {
    assert.equal((await fuego.searchFuegoCine('VisionQuest', { ...SERIES, episode: 99 }, 'VisionQuest', 6000)).reason, 'no-episode');
  } finally { stubbed.restore(); }
});

test('fuegocine: un visor sin EMBEDS o con grupos desconocidos no produce hits', async () => {
  const stubbed = stub([
    ['/search_elastic', html(SEARCH)],
    [`/movies/watch/`, html(WATCH)],
    [EMBED_URL, html('<html><body>sin embeds</body></html>')],
  ]);
  try {
    const out = await fuego.searchFuegoCine('Spider-Man Un Nuevo Día', MOVIE, MOVIE.title, 5000);
    assert.deepEqual(out.hits, []);
    assert.equal(out.reason, 'no-extractable-embed');
    assert.equal(out.notes.opaque, 2, 'videro y abyssplayer se cuentan como opacos');
  } finally { stubbed.restore(); }
});

test('fuegocine: sin coincidencia en el buscador no se abre la reproducción', async () => {
  const stubbed = stub([['/search_elastic', html('<html><body><h3>Películas</h3></body></html>')]]);
  try {
    const out = await fuego.searchFuegoCine('Nada que ver', { ...MOVIE, title: 'Nada que ver' }, 'Nada que ver', 5000);
    assert.deepEqual(out.hits, []);
    assert.equal(out.reason, 'no-match');
    assert.ok(!stubbed.calls.some((url) => url.includes('/movies/watch/')));
  } finally { stubbed.restore(); }
});

test('fuegocine: sin identidad o sin episodio no se hacen peticiones', async () => {
  const stubbed = stub([]);
  try {
    assert.deepEqual(await fuego.searchFuegoCine('x', null, 'x', 5000), { skipped: 'identity-required' });
    assert.deepEqual(await fuego.searchFuegoCine('x', { ...SERIES, episode: 0 }, SERIES.title, 5000), { skipped: 'episode-required' });
    assert.equal(stubbed.calls.length, 0);
  } finally { stubbed.restore(); }
});
