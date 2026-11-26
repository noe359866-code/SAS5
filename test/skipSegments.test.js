'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const cache = require('../lib/cache');
const skipSegments = require('../lib/skipSegments');
const { renderWatch } = require('../lib/watchPage');
const app = require('../api/index');

function clearSkipCache() {
  cache.deletePrefix('skip:');
}

test('parseSkipQuery: normaliza IDs de IMDb, TMDB, AniList, MAL y duración', () => {
  const ep = skipSegments.parseSkipQuery({ type: 'series', id: 'tt0903747:2:5', duration: '2820' });
  assert.equal(ep.type, 'series');
  assert.equal(ep.imdbId, 'tt0903747');
  assert.equal(ep.season, 2);
  assert.equal(ep.episode, 5);
  assert.equal(ep.duration, 2820);

  const tmdbEp = skipSegments.parseSkipQuery({ id: 'tmdb:tv:1396:1:3', duration: 2820000 });
  assert.equal(tmdbEp.type, 'series');
  assert.equal(tmdbEp.tmdbId, 1396);
  assert.equal(tmdbEp.season, 1);
  assert.equal(tmdbEp.episode, 3);
  assert.equal(tmdbEp.duration, 2820);

  const movie = skipSegments.parseSkipQuery({ type: 'movie', id: 'tt0816692' });
  assert.equal(movie.type, 'movie');
  assert.equal(movie.imdbId, 'tt0816692');
  assert.equal(movie.season, null);
  assert.equal(movie.episode, null);

  const anime = skipSegments.parseSkipQuery({ type: 'series', id: 'anilist:16498:12' });
  assert.equal(anime.anilistId, 16498);
  assert.equal(anime.episode, 12);
  assert.equal(anime.anime, true);
});

test('parseTheIntroDbPayload: parsea v4 (intro/recap/credits/preview) y rechaza fallbacks', () => {
  const segs = skipSegments.parseTheIntroDbPayload({
    tvdb_id: 81189,
    type: 'episode',
    intro: [{ start_ms: 61500, end_ms: 91000 }],
    recap: [{ start_ms: null, end_ms: 35000 }],
    credits: [{ start_ms: 2700000, end_ms: null }],
    preview: [{ start_ms: 2760000, end_ms: 2790000 }],
  });

  assert.equal(segs.length, 4);
  assert.deepEqual(segs[0], {
    kind: 'intro',
    startSec: 61.5,
    endSec: 91,
    source: 'theintrodb',
    sourceLabel: 'TheIntroDB',
    label: 'Omitir intro',
  });
  assert.equal(segs[1].kind, 'recap');
  assert.equal(segs[1].startSec, 0);
  assert.equal(segs[1].endSec, 35);
  assert.equal(segs[2].kind, 'credits');
  assert.equal(segs[2].endSec, null);
  assert.equal(segs[3].kind, 'preview');

  // Guard contra respuestas de índice sin segmentos concretos
  assert.deepEqual(skipSegments.parseTheIntroDbPayload({ episodes: [{ season: 1 }] }), []);
  assert.deepEqual(skipSegments.parseTheIntroDbPayload({ versions: [] }), []);
});

test('parseSkipDbPayload: convierte segmentos y mapea outro -> credits', () => {
  const segs = skipSegments.parseSkipDbPayload({
    imdb_id: 'tt0903747',
    season: 1,
    episode: 1,
    segments: {
      intro: { start_ms: 45000, end_ms: 65000, confidence: 0.96 },
      recap: null,
      outro: { start_ms: 3300000, end_ms: 3360000, confidence: 0.92 },
      preview: { start_ms: 3365000, end_ms: 3395000 },
    },
  });

  assert.equal(segs.length, 3);
  assert.equal(segs[0].kind, 'intro');
  assert.equal(segs[0].startSec, 45);
  assert.equal(segs[0].endSec, 65);
  assert.equal(segs[0].source, 'skipdb');
  assert.equal(segs[1].kind, 'credits');
  assert.equal(segs[1].startSec, 3300);
  assert.equal(segs[2].kind, 'preview');
});

test('parseAnimeSkipTimestamps: convierte marcas de inicio en intervalos y protege contra bloques abiertos', () => {
  const ep = {
    id: 'ep-1',
    season: '1',
    number: '1',
    baseDuration: 1440,
    timestamps: [
      { at: 0, typeId: '9edc0037-fa4e-47a7-a29a-d9c43368daa8', type: { name: 'Canon' } },
      { at: 85, typeId: '14550023-2589-46f0-bfb4-152976506b4c', type: { name: 'Intro' } },
      { at: 175, typeId: '9edc0037-fa4e-47a7-a29a-d9c43368daa8', type: { name: 'Canon' } },
      { at: 1320, typeId: '2a730a51-a601-439b-bc1f-7b94a640ffb9', type: { name: 'Credits' } },
      { at: 1410, typeId: 'c7b1eddb-defa-4bc6-a598-f143081cfe4b', type: { name: 'Preview' } },
      { at: 1435, typeId: '9edc0037-fa4e-47a7-a29a-d9c43368daa8', type: { name: 'Canon' } },
    ],
  };

  const segs = skipSegments.parseAnimeSkipTimestamps(ep, 1440);
  assert.equal(segs.length, 3);
  assert.equal(segs[0].kind, 'intro');
  assert.equal(segs[0].startSec, 85);
  assert.equal(segs[0].endSec, 175);
  assert.equal(segs[0].source, 'animeskip');

  assert.equal(segs[1].kind, 'credits');
  assert.equal(segs[1].startSec, 1320);
  assert.equal(segs[1].endSec, 1410);

  assert.equal(segs[2].kind, 'preview');
  assert.equal(segs[2].startSec, 1410);
  assert.equal(segs[2].endSec, 1435);

  // Intro sin cierre (última marca): debe descartarse para no saltar todo el episodio.
  const openIntro = skipSegments.parseAnimeSkipTimestamps({
    baseDuration: 1440,
    timestamps: [{ at: 90, type: { name: 'Intro' } }],
  }, 1440);
  assert.equal(openIntro.length, 0);

  // Créditos al final (en la segunda mitad): se extiende a baseDuration.
  const openCredits = skipSegments.parseAnimeSkipTimestamps({
    baseDuration: 1440,
    timestamps: [{ at: 1350, type: { name: 'New Credits' } }],
  }, 1440);
  assert.equal(openCredits.length, 1);
  assert.equal(openCredits[0].kind, 'credits');
  assert.equal(openCredits[0].endSec, 1440);
});

test('mergeSkipSegments: respeta prioridad anime vs live-action y complementa tipos faltantes', () => {
  const bySource = {
    theintrodb: [{ kind: 'intro', startSec: 60, endSec: 90, source: 'theintrodb', label: 'Omitir intro' }],
    skipdb: [
      { kind: 'intro', startSec: 61, endSec: 91, source: 'skipdb', label: 'Omitir intro' },
      { kind: 'credits', startSec: 2700, endSec: 2760, source: 'skipdb', label: 'Omitir créditos' },
    ],
    animeskip: [{ kind: 'intro', startSec: 85, endSec: 175, source: 'animeskip', label: 'Omitir intro' }],
    aniskip: [{ kind: 'recap', startSec: 0, endSec: 40, source: 'aniskip', label: 'Omitir resumen' }],
  };

  const live = skipSegments.mergeSkipSegments(bySource, false);
  assert.equal(live.find((s) => s.kind === 'intro').source, 'theintrodb');
  assert.equal(live.find((s) => s.kind === 'credits').source, 'skipdb');
  assert.equal(live.find((s) => s.kind === 'recap').source, 'aniskip');

  const anime = skipSegments.mergeSkipSegments(bySource, true);
  assert.equal(anime.find((s) => s.kind === 'intro').source, 'animeskip');
  assert.equal(anime.find((s) => s.kind === 'credits').source, 'skipdb');
  assert.equal(anime.find((s) => s.kind === 'recap').source, 'aniskip');
  // Ordenados por startSec ascendente
  assert.ok(anime[0].startSec <= anime[1].startSec && anime[1].startSec <= anime[2].startSec);
});

test('getSkipSegments: integra TheIntroDB + SkipDB + Anime Skip (vía ARM) + AniSkip en una sola respuesta', async () => {
  clearSkipCache();

  const calls = [];
  const mockFetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {} });
    if (url.startsWith('https://api.theintrodb.org/v4/media')) {
      return {
        intro: [{ start_ms: 82000, end_ms: 172000 }],
        preview: [{ start_ms: 1410000, end_ms: 1435000 }],
      };
    }
    if (url.startsWith('https://api.skipdb.tv/api/segments')) {
      return {
        segments: {
          intro: { start_ms: 83000, end_ms: 173000 },
          outro: { start_ms: 1320000, end_ms: 1405000 },
        },
      };
    }
    if (url.startsWith('https://arm.haglund.dev/api/v2/imdb')) {
      return [{ anilist: 16498, myanimelist: 16498, 'themoviedb-season': 1 }];
    }
    if (url === 'https://api.anime-skip.com/graphql') {
      const body = JSON.parse(opts.body);
      assert.ok(opts.headers['X-Client-ID'], 'Anime Skip requiere X-Client-ID');
      if (body.query.includes('findShowsByExternalId')) {
        return { data: { findShowsByExternalId: [{ id: 'show-aot', name: 'Attack on Titan', deletedAt: null }] } };
      }
      if (body.query.includes('findEpisodesByShowId')) {
        return {
          data: {
            findEpisodesByShowId: [{
              id: 'ep-aot-1',
              season: '1',
              number: '1',
              absoluteNumber: '1',
              baseDuration: 1440,
              deletedAt: null,
              timestamps: [
                { at: 85, typeId: '14550023-2589-46f0-bfb4-152976506b4c', type: { name: 'Intro' } },
                { at: 175, typeId: '9edc0037-fa4e-47a7-a29a-d9c43368daa8', type: { name: 'Canon' } },
              ],
            }],
          },
        };
      }
    }
    if (url.startsWith('https://api.aniskip.com/v2/skip-times/16498/1')) {
      return {
        found: true,
        results: [
          { skipType: 'recap', interval: { startTime: 0, endTime: 45 } },
        ],
      };
    }
    return null;
  };

  const result = await skipSegments.getSkipSegments({
    type: 'series',
    id: 'tt2560140',
    season: 1,
    episode: 1,
    duration: 1440,
    anime: true,
  }, { fetchJson: mockFetch, bypassCache: true });

  assert.equal(result.ok, true);
  assert.equal(result.sources.theintrodb, 2);
  assert.equal(result.sources.skipdb, 2);
  assert.equal(result.sources.animeskip, 1);
  assert.equal(result.sources.aniskip, 1);

  // En anime: intro de Anime Skip, recap de AniSkip, credits de SkipDB, preview de TheIntroDB
  const byKind = Object.fromEntries(result.segments.map((s) => [s.kind, s]));
  assert.equal(byKind.intro.source, 'animeskip');
  assert.equal(byKind.recap.source, 'aniskip');
  assert.equal(byKind.credits.source, 'skipdb');
  assert.equal(byKind.preview.source, 'theintrodb');
  assert.equal(result.segments.length, 4);
  assert.ok(calls.length >= 6);
});

test('Worker y Express: GET /internal/watch/skip responde con segmentos fusionados', async () => {
  clearSkipCache();
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    const u = String(url);
    if (u.startsWith('https://api.theintrodb.org/v4/media')) {
      return new Response(JSON.stringify({
        intro: [{ start_ms: 30000, end_ms: 60000 }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (u.startsWith('https://api.skipdb.tv/api/segments')) {
      return new Response(JSON.stringify({
        segments: {
          outro: { start_ms: 2500000, end_ms: 2560000 },
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    // 1. Cloudflare Worker
    const workerUrl = pathToFileURL(path.join(__dirname, '..', 'worker.mjs')).href;
    const { default: worker } = await import(workerUrl);
    const workerRes = await worker.fetch(
      new Request('https://ramdonlatam.workers.dev/internal/watch/skip?type=series&id=tt0903747&season=1&episode=1&duration=2600'),
      {},
      { waitUntil() {} }
    );
    assert.equal(workerRes.status, 200);
    const workerJson = await workerRes.json();
    assert.equal(workerJson.ok, true);
    assert.equal(workerJson.segments.length, 2);
    assert.equal(workerJson.segments[0].source, 'theintrodb');
    assert.equal(workerJson.segments[1].source, 'skipdb');

    // 2. Express API
    clearSkipCache();
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    try {
      const expRes = await originalFetch(`http://127.0.0.1:${port}/internal/watch/skip?type=series&id=tt0903747&season=1&episode=1&duration=2600`);
      assert.equal(expRes.status, 200);
      const expJson = await expRes.json();
      assert.equal(expJson.ok, true);
      assert.equal(expJson.segments.length, 2);
      assert.equal(expJson.segments[0].kind, 'intro');
      assert.equal(expJson.segments[1].kind, 'credits');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('renderWatch incluye controles de salto (TheIntroDB, SkipDB, Anime Skip) y JS válido', () => {
  const html = renderWatch({ origin: 'https://ramdonlatam.example', host: 'ramdonlatam.example' });
  assert.ok(html.includes('id="skipPrompt"'));
  assert.ok(html.includes('id="btnAutoSkip"'));
  assert.ok(html.includes('id="skipBar"'));
  assert.ok(html.includes('/internal/watch/skip'));
  assert.ok(html.includes('TheIntroDB'));
  assert.ok(html.includes('SkipDB'));
  assert.ok(html.includes('Anime Skip'));

  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 1);
  for (const code of scripts) {
    assert.doesNotThrow(() => new Function(code), 'El JS embebido en /watch debe compilar sin errores');
  }
});
