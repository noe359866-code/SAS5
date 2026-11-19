'use strict';

/**
 * Pruebas del adaptador de pelisjuanita.org.
 *
 * Los fixtures son recortes reales medidos el 19-11-2026 con
 * `scripts/pelisjuanita-probe{,2,3}.mjs`: la respuesta de
 * `/api/rest/v1/search`, la lista de temporadas y episodios de una serie, la
 * página de `videoapp.mov` y el embed de Vimeos. Las firmas (`cf`, `t/s/e` del
 * manifiesto y de los `.vtt`) están recortadas o fijadas a una fecha futura, así
 * que las pruebas no dependen del reloj ni publican tokens.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const pelis = require('../lib/sites/pelisjuanita');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'sites', name), 'utf8');
const jsonFixture = (name) => JSON.parse(fixture(name));

const SEARCH_MOVIE = jsonFixture('pelisjuanita-search-movie.json');
const SEARCH_SERIE = jsonFixture('pelisjuanita-search-serie.json');
const SEASONS = jsonFixture('pelisjuanita-seasons.json');
const EPISODES = jsonFixture('pelisjuanita-episodes.json');
const PLAYER = fixture('pelisjuanita-player.html');
const PLAYER_EP = fixture('pelisjuanita-player-episodio.html');
const EMBED = fixture('pelisjuanita-embed.html');
const EMBED_EP = fixture('pelisjuanita-embed-episodio.html');

const BASE = 'https://pelisjuanita.org';
const PLAYER_BASE = 'https://videoapp.mov';
const MOVIE = { title: 'Spider-Man: Un nuevo día', altTitle: null, year: 2026, mediaType: 'movie' };
const SERIE = { title: 'Breaking Bad', altTitle: null, year: 2008, mediaType: 'series', season: 1, episode: 1 };
const EMBED_URL = 'https://vimeos.net/embed-2nulhg4mnuz7.html?cf=…';
const EMBED_EP_URL = 'https://vimeos.net/embed-ccjygcfxujhd.html?cf=…';

const res = (body, status = 200) => () => new Response(body, {
  status,
  headers: { 'content-type': /^[{[]/.test(body.trim()) ? 'application/json' : 'text/html; charset=utf-8' },
});

function stub(routes) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url) => {
    const target = String(url);
    calls.push(target);
    for (const [needle, reply] of routes) {
      if (target.includes(needle)) return reply(target);
    }
    // El manifiesto no se pide nunca: si se pidiera, el 404 lo delataría.
    return new Response('', { status: 404 });
  };
  return { calls, restore: () => { global.fetch = original; } };
}

// ── API: búsqueda e identidad ─────────────────────────────────────────────

test('pelisjuanita: la búsqueda se normaliza a candidatos con tipo, año e ids', () => {
  const candidates = pelis.candidatesOf(SEARCH_MOVIE);
  assert.ok(candidates.length >= 3);
  const spider = candidates.find((item) => item.title === 'Spider-Man: Un nuevo día');
  assert.deepEqual(spider, {
    url: '/pelicula/spider-man-un-nuevo-dia-2026',
    title: 'Spider-Man: Un nuevo día',
    year: 2026,
    kind: 'movie',
    tmdbId: 969681,
    itemId: 55079,
    slug: 'spider-man-un-nuevo-dia-2026',
  });
  // El buscador mezcla películas, series y animes: el tipo se separa aquí.
  assert.ok(candidates.some((item) => item.kind === 'series'));
});

test('pelisjuanita: se exige título y tipo, y el año desempata los remakes', () => {
  const candidates = pelis.candidatesOf(SEARCH_MOVIE);
  assert.equal(pelis.pick(candidates, MOVIE).tmdbId, 969681);
  assert.equal(pelis.pick(candidates, { ...MOVIE, title: 'Otra cosa' }), null);
  assert.equal(pelis.pick(candidates, { ...MOVIE, mediaType: 'series' }), null);
  // Mismo título, otro año: no se publica la ficha equivocada.
  assert.equal(pelis.pick(candidates, { ...MOVIE, year: 1999 }), null);

  const series = pelis.candidatesOf(SEARCH_SERIE);
  assert.equal(pelis.pick(series, SERIE).slug, 'breaking-bad-2008');
  // El spin-off también es de Breaking Bad, pero su título no es el pedido.
  assert.equal(pelis.pick(series, { ...SERIE, mediaType: 'movie' }), null);
});

test('pelisjuanita: si la primera página no basta, se pide la segunda', async () => {
  // Página 1: la respuesta real de un buscador de series (sin la película),
  // con `has_next` como lo devuelve el API cuando hay más resultados.
  const firstPage = { ...SEARCH_SERIE, pagination: { ...SEARCH_SERIE.pagination, has_next: true, total_pages: 2 } };
  const pages = [];
  const original = global.fetch;
  global.fetch = async (url) => {
    const target = String(url);
    if (target.includes('/api/rest/v1/search')) {
      const page = /[?&]page=2\b/.test(target) ? 2 : 1;
      pages.push(page);
      return new Response(JSON.stringify(page === 1 ? firstPage : SEARCH_MOVIE), { headers: { 'content-type': 'application/json' } });
    }
    if (target.includes('videoapp.mov')) return new Response(PLAYER, { headers: { 'content-type': 'text/html' } });
    return new Response(EMBED, { headers: { 'content-type': 'text/html' } });
  };
  try {
    const out = await pelis.searchPelisJuanita(null, MOVIE, MOVIE.title, 5000);
    assert.equal(out.hits.length, 1);
    assert.deepEqual(pages, [1, 2]);
  } finally { global.fetch = original; }
});

test('pelisjuanita: sin más páginas no se repite la búsqueda', async () => {
  const stubbed = stub([
    ['/api/rest/v1/search', res(JSON.stringify({ items: [], pagination: { has_next: false }, q: 'x' }))],
  ]);
  try {
    await pelis.searchPelisJuanita(null, { ...MOVIE, title: 'Nada que ver' }, 'Nada que ver', 5000);
    assert.equal(stubbed.calls.filter((url) => url.includes('/api/rest/v1/search')).length, 1);
  } finally { stubbed.restore(); }
});

test('pelisjuanita: el reproductor de una película es el de su TMDB', () => {
  assert.equal(pelis.playerUrlOf({ tmdbId: 969681 }), `${PLAYER_BASE}/e/movie/969681`);
  assert.equal(pelis.playerUrlOf({ tmdbId: null }), null);
});

// ── Episodios ─────────────────────────────────────────────────────────────

test('pelisjuanita: la temporada pedida debe existir en el listado', () => {
  assert.equal(pelis.seasonOf(SEASONS, SERIE).season, 1);
  assert.equal(pelis.seasonOf(SEASONS, { ...SERIE, season: 9 }), null);
});

test('pelisjuanita: el episodio sale con su player_url y solo si es reproducible', () => {
  const episode = pelis.episodeOf(EPISODES.episodes, SERIE);
  assert.equal(episode.url, `${PLAYER_BASE}/e/tv/1396/1/1`);
  assert.equal(pelis.episodeOf(EPISODES.episodes, { ...SERIE, episode: 99 }), null);
  // `playable: false` no se sustituye por otro capítulo.
  const blocked = EPISODES.episodes.map((item) => (item.episode === 1 ? { ...item, playable: false } : item));
  assert.equal(pelis.episodeOf(blocked, SERIE), null);
  // Un player_url fuera de videoapp no se acepta.
  const foreign = [{ season: 1, episode: 1, playable: true, player_url: 'https://otro.example/e/tv/1/1' }];
  assert.equal(pelis.episodeOf(foreign, SERIE), null);
});

// ── Visor ─────────────────────────────────────────────────────────────────

test('pelisjuanita: el reproductor se pide con el Referer del sitio que lo incrusta', async () => {
  const seen = [];
  const original = global.fetch;
  global.fetch = async (url, options = {}) => {
    seen.push({ url: String(url), referer: options.headers?.Referer || options.headers?.referer || '' });
    if (String(url).includes('/api/rest/v1/search')) return new Response(JSON.stringify(SEARCH_MOVIE), { headers: { 'content-type': 'application/json' } });
    if (String(url).includes('videoapp.mov')) return new Response(PLAYER, { headers: { 'content-type': 'text/html' } });
    return new Response(EMBED, { headers: { 'content-type': 'text/html' } });
  };
  try {
    const out = await pelis.searchPelisJuanita(null, MOVIE, MOVIE.title, 5000);
    assert.equal(out.hits.length, 1);
    const playerCall = seen.find((call) => call.url.includes('videoapp.mov'));
    assert.equal(playerCall.referer, `${BASE}/`);
    // El embed se pide como lo haría el reproductor.
    const embedCall = seen.find((call) => call.url.includes('vimeos.net'));
    assert.equal(embedCall.referer, `${PLAYER_BASE}/`);
  } finally { global.fetch = original; }
});

test('pelisjuanita: de la página del reproductor solo vale el iframe de Vimeos', () => {
  assert.equal(pelis.frameOf(PLAYER), EMBED_URL);
  assert.equal(pelis.frameOf(PLAYER_EP), EMBED_EP_URL);
  assert.equal(pelis.frameOf('<html><body>Contenido no disponible.</body></html>'), null);
  assert.equal(pelis.frameOf('<iframe id="frame" src="https://ajeno.example/e/x"></iframe>'), null);
});

test('pelisjuanita: el visor declara la versión y se mapea al audio del addon', () => {
  assert.equal(pelis.subDubOf(EMBED), 'sub');
  assert.equal(pelis.audioOf('sub'), 'Subtitulado');
  assert.equal(pelis.audioOf('lat'), 'Latino');
  assert.equal(pelis.audioOf('dub'), 'Latino');
  assert.equal(pelis.audioOf('cas'), 'Castellano');
  assert.equal(pelis.audioOf('eng'), '');
  assert.equal(pelis.audioOf(''), '');
});

test('pelisjuanita: el HLS se toma del embed sin descargar el manifiesto', () => {
  const media = pelis.mediaOfEmbed(EMBED);
  assert.match(media.master, /^https:\/\/s1\.vimeos\.net\/.+\/master\.m3u8\?t=/);
  assert.equal(media.expiresAt, 4102531200000);
  // Los subtítulos vienen como `default_subs` con `lang`, no con `file/label`.
  assert.deepEqual(media.subtitles.map((entry) => entry.lang), ['es', 'en']);
  const episode = pelis.mediaOfEmbed(EMBED_EP);
  assert.match(episode.master, /^https:\/\/s9\.vimeos\.net\//);
  assert.deepEqual(episode.subtitles.map((entry) => entry.lang), ['es']);
});

// ── Recorrido completo ────────────────────────────────────────────────────

test('pelisjuanita película: búsqueda → reproductor → Vimeos → HLS subtitulado', async () => {
  const stubbed = stub([
    ['/api/rest/v1/search', res(JSON.stringify(SEARCH_MOVIE))],
    [`${PLAYER_BASE}/e/movie/969681`, res(PLAYER)],
    [EMBED_URL, res(EMBED)],
  ]);
  try {
    const out = await pelis.searchPelisJuanita(null, MOVIE, MOVIE.title, 5000);
    assert.equal(out.hits.length, 1);
    const hit = out.hits[0];
    assert.equal(hit.provider, 'pelisjuanita');
    assert.equal(hit.quality, 'HLS');
    assert.equal(hit.audioLabel, 'Subtitulado');
    assert.match(hit.url, /master\.m3u8/);
    assert.equal(hit.expiresAt, 4102531200000);
    assert.equal(hit.subtitles.length, 2);
    // Nunca se pide el manifiesto.
    assert.ok(!stubbed.calls.some((url) => url.includes('.m3u8')));
    // Tres peticiones: búsqueda, player y embed. Ni una más.
    assert.equal(stubbed.calls.length, 3);
  } finally { stubbed.restore(); }
});

test('pelisjuanita serie: búsqueda → temporadas → episodio → reproductor → Vimeos', async () => {
  const stubbed = stub([
    ['/api/rest/v1/search', res(JSON.stringify(SEARCH_SERIE))],
    ['/api/rest/v1/episode-seasons', res(JSON.stringify(SEASONS))],
    ['/api/rest/v1/episodes', res(JSON.stringify(EPISODES))],
    [`${PLAYER_BASE}/e/tv/1396/1/1`, res(PLAYER_EP)],
    [EMBED_EP_URL, res(EMBED_EP)],
  ]);
  try {
    const out = await pelis.searchPelisJuanita(null, SERIE, SERIE.title, 6000);
    assert.equal(out.hits.length, 1);
    assert.equal(out.hits[0].title, 'Breaking Bad S01E01 PelisJuanita');
    assert.equal(out.hits[0].audioLabel, 'Subtitulado');
    assert.ok(stubbed.calls.includes(`${BASE}/api/rest/v1/episode-seasons?item_id=25228`));
    assert.ok(stubbed.calls.some((url) => url.includes('season=1')));
  } finally { stubbed.restore(); }
});

test('pelisjuanita: sin temporada, sin episodio o sin visor se degrada con su motivo', async () => {
  const search = res(JSON.stringify(SEARCH_SERIE));
  let stubbed = stub([
    ['/api/rest/v1/search', search],
    ['/api/rest/v1/episode-seasons', res(JSON.stringify({ seasons: [{ season: 2 }] }))],
  ]);
  try {
    assert.equal((await pelis.searchPelisJuanita(null, SERIE, SERIE.title, 5000)).reason, 'no-season');
  } finally { stubbed.restore(); }

  stubbed = stub([
    ['/api/rest/v1/search', search],
    ['/api/rest/v1/episode-seasons', res(JSON.stringify(SEASONS))],
    ['/api/rest/v1/episodes', res(JSON.stringify({ episodes: [] }))],
  ]);
  try {
    assert.equal((await pelis.searchPelisJuanita(null, SERIE, SERIE.title, 5000)).reason, 'no-episode');
  } finally { stubbed.restore(); }

  stubbed = stub([
    ['/api/rest/v1/search', search],
    ['/api/rest/v1/episode-seasons', res(JSON.stringify(SEASONS))],
    ['/api/rest/v1/episodes', res(JSON.stringify(EPISODES))],
    [`${PLAYER_BASE}/e/tv/1396/1/1`, res('<html><body>Contenido no disponible.</body></html>')],
  ]);
  try {
    assert.equal((await pelis.searchPelisJuanita(null, SERIE, SERIE.title, 5000)).reason, 'no-players');
  } finally { stubbed.restore(); }
});

test('pelisjuanita: sin versión declarada por el visor no se anuncia audio', async () => {
  const sinVersion = EMBED.replace('"subDub":"sub"', '"subDub":""');
  const stubbed = stub([
    ['/api/rest/v1/search', res(JSON.stringify(SEARCH_MOVIE))],
    [`${PLAYER_BASE}/e/movie/969681`, res(PLAYER)],
    [EMBED_URL, res(sinVersion)],
  ]);
  try {
    const out = await pelis.searchPelisJuanita(null, MOVIE, MOVIE.title, 5000);
    assert.deepEqual(out.hits, []);
    assert.equal(out.reason, 'audio-unverified');
  } finally { stubbed.restore(); }
});

test('pelisjuanita: un embed sin HLS no se publica aunque declare idioma', async () => {
  const sinHls = EMBED.replace(/https:\/\/s1\.vimeos\.net\/[^"]+?\.m3u8[^"]*/g, '');
  const stubbed = stub([
    ['/api/rest/v1/search', res(JSON.stringify(SEARCH_MOVIE))],
    [`${PLAYER_BASE}/e/movie/969681`, res(PLAYER)],
    [EMBED_URL, res(sinHls)],
  ]);
  try {
    const out = await pelis.searchPelisJuanita(null, MOVIE, MOVIE.title, 5000);
    assert.deepEqual(out.hits, []);
    assert.equal(out.reason, 'no-extractable-embed');
  } finally { stubbed.restore(); }
});

test('pelisjuanita: sin coincidencia en el buscador no se abre el reproductor', async () => {
  const stubbed = stub([['/api/rest/v1/search', res(JSON.stringify({ items: [], pagination: {}, q: 'x' }))]]);
  try {
    const out = await pelis.searchPelisJuanita(null, { ...MOVIE, title: 'Nada que ver' }, 'Nada que ver', 5000);
    assert.deepEqual(out.hits, []);
    assert.equal(out.reason, 'no-match');
    assert.ok(!stubbed.calls.some((url) => url.includes('videoapp')));
  } finally { stubbed.restore(); }
});

test('pelisjuanita: sin identidad o sin episodio no se hacen peticiones', async () => {
  const stubbed = stub([]);
  try {
    assert.deepEqual(await pelis.searchPelisJuanita(null, null, 'x', 5000), { skipped: 'identity-required' });
    assert.deepEqual(await pelis.searchPelisJuanita(null, { ...SERIE, episode: 0 }, SERIE.title, 5000), { skipped: 'episode-required' });
    assert.equal(stubbed.calls.length, 0);
  } finally { stubbed.restore(); }
});
