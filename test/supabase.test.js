'use strict';

/**
 * Supabase (`public.video_host_links`) + extractores de anfitriones.
 *
 * Todas las pruebas son locales: se sustituye `global.fetch` y se responde con
 * las formas reales del HTML de Mixdrop/Filemoon/Vihidrive y del REST de
 * PostgREST. Nunca se consulta la red ni la base de datos.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../lib/config');
const cache = require('../lib/cache');
const supabase = require('../lib/supabase');
const hosts = require('../lib/hostExtractors');
const { searchSupabase } = require('../lib/siteSupabase');
const streams = require('../lib/streams');

const originalFetch = global.fetch;
after(() => { global.fetch = originalFetch; config.reload(null); });

const SUPABASE_URL = 'https://proyecto-de-prueba.supabase.co';
const ANON = 'anon-key-de-prueba';
const SERVICE = 'service-role-de-prueba';

const ROW_MOVIE = {
  id: 501,
  imdb_id: 'tt0133093',
  tmdb_id: 603,
  media_type: 'movie',
  season: null,
  episode: null,
  host_code: 'mixdrop',
  embed_url: 'https://mixdrop.co/e/abcd1234',
  host_file_id: 'abcd1234',
  extractor_type: 'mixdrop',
  quality: '1080p',
  language: 'Latino',
  server_label: null,
  is_working: true,
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json' },
});
const html = (body) => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });

/**
 * HTML de Mixdrop: el visor empaqueta `MDCore.wurl` con un packer Dean Edwards
 * (el mismo `fromPacker` de lib/mediaParse.js). El payload va sin barra
 * invertida porque el archivo de prueba no es una cadena de JavaScript.
 */
const MIXDROP_PACKED = 'eval(function(p,a,c,k,e,d){e=function(c){return c};if(!\'\'.replace(/^/,String)){'
  + 'while(c--){d[c]=k[c]||c}k=[function(e){return d[e]}];e=function(){return\'\\\\w+\'};c=1};'
  + 'while(c--){if(k[c]){p=p.replace(new RegExp(\'\\\\b\'+e(c)+\'\\\\b\',\'g\'),k[c])}}return p}'
  + '(\'3.2="0://1.5/4.6";\',7,7,\'https|mxcontent|wurl|MDCore|v|net|mp4\'.split(\'|\'),0,{}))';
const MIXDROP_HTML = `<html><body><script>${MIXDROP_PACKED}</script></body></html>`;

/** HTML de Filemoon: el manifiesto va en `sources`. */
const FILEMOON_HTML = `<html><script>
  jwplayer("v").setup({ sources: [{ file: "https://cdn.filemoon.example/hls/master.m3u8", label: "1080p" }] });
</script></html>`;

const VIHIDRIVE_HTML = `<html><script>
  var sources = [{file:"https://edge.vihidrive.example/stream/index.m3u8"}];
</script></html>`;

function useSupabaseEnv({ serviceRole = false } = {}) {
  config.reload({
    SUPABASE_URL,
    SUPABASE_ANON_KEY: ANON,
    ...(serviceRole ? { SUPABASE_SERVICE_ROLE_KEY: SERVICE } : {}),
  });
}

/** Registra las peticiones y devuelve respuestas por ruta. */
function mockFetch(routes) {
  const calls = [];
  global.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    calls.push({ url, init, method: init.method || 'GET', body: init.body });
    for (const [pattern, handler] of routes) {
      if (pattern.test(url.href)) return handler(url, init);
    }
    throw new Error(`petición inesperada: ${url.origin}${url.pathname}`);
  };
  return calls;
}

// ── Cliente PostgREST ────────────────────────────────────────────────────

test('supabase: sin credenciales la fuente no se anuncia ni consulta la red', async (t) => {
  t.after(() => config.reload(null));
  config.reload({});
  const calls = mockFetch([]);
  assert.deepEqual(supabase.status(), { configured: false, writable: false });
  assert.deepEqual(await supabase.findLinks({ imdbId: 'tt0133093', mediaType: 'movie' }), { rows: [], skipped: 'not-configured' });
  assert.deepEqual(streams.activeProviders(null), ['fanpelis', 'spinflix', 'cuevanas3', 'allpeliculas',
    'lamovie', 'animeflv', 'animeav1', 'fuegocine', 'pelisjuanita', 'videoapi']);
  assert.equal(calls.length, 0);
});

test('supabase: con credenciales la fuente entra en el registro y usa el índice de IMDb', async (t) => {
  t.after(() => config.reload(null));
  useSupabaseEnv();
  assert.deepEqual(supabase.status(), { configured: true, writable: false });
  assert.ok(streams.activeProviders(null).includes('supabase'));

  const calls = mockFetch([
    [/\/rest\/v1\/video_host_links/, () => json([ROW_MOVIE])],
  ]);
  const { rows, skipped } = await supabase.findLinks({ imdbId: 'tt0133093', tmdbId: 603, mediaType: 'movie' });
  assert.equal(skipped, null);
  assert.equal(rows.length, 1);
  assert.equal(calls.length, 1, 'con IMDb no hace falta la segunda consulta por TMDb');

  const [{ url, init }] = calls;
  // La clave viaja en cabeceras, nunca en la URL.
  assert.equal(url.searchParams.get('apikey'), null);
  assert.doesNotMatch(url.href, new RegExp(ANON));
  assert.equal(init.headers.apikey, ANON);
  assert.equal(init.headers.Authorization, `Bearer ${ANON}`);
  // Filtros que aprovechan idx_video_host_links_imdb.
  assert.equal(url.searchParams.get('imdb_id'), 'eq.tt0133093');
  assert.equal(url.searchParams.get('tmdb_id'), null, 'el índice de IMDb no incluye tmdb_id');
  assert.equal(url.searchParams.get('media_type'), 'eq.movie');
  assert.equal(url.searchParams.get('is_working'), 'eq.true');
  assert.equal(url.searchParams.get('season'), 'is.null');
  assert.equal(url.searchParams.get('episode'), 'is.null');
  assert.equal(url.searchParams.get('limit'), String(supabase.MAX_ROWS));
});

test('supabase: sin filas por IMDb se reintenta por TMDb, y una serie exige episodio', async (t) => {
  t.after(() => config.reload(null));
  useSupabaseEnv();
  const calls = mockFetch([
    [/imdb_id=eq/, () => json([])],
    [/tmdb_id=eq/, () => json([{ ...ROW_MOVIE, imdb_id: null }])],
  ]);
  const { rows } = await supabase.findLinks({ imdbId: 'tt0133093', tmdbId: 603, mediaType: 'movie' });
  assert.equal(rows.length, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url.searchParams.get('tmdb_id'), 'eq.603');
  assert.equal(calls[1].url.searchParams.get('imdb_id'), null);

  const series = await supabase.findLinks({ imdbId: 'tt0903747', mediaType: 'series', season: null, episode: null });
  assert.deepEqual(series, { rows: [], skipped: 'episode-required' });

  const noId = await supabase.findLinks({ mediaType: 'movie' });
  assert.deepEqual(noId, { rows: [], skipped: 'identity-required' });
});

test('supabase: un error del proyecto se informa sin filtrar la clave ni el cuerpo', async (t) => {
  t.after(() => config.reload(null));
  useSupabaseEnv();
  mockFetch([[/\/rest\/v1\/video_host_links/, () => json({ message: 'permission denied for table', code: '42501' }, 403)]]);
  await assert.rejects(
    supabase.findLinks({ imdbId: 'tt0133093', mediaType: 'movie' }),
    (error) => {
      assert.equal(error.status, 403);
      assert.doesNotMatch(error.message, /permission denied/);
      assert.doesNotMatch(error.message, new RegExp(ANON));
      return true;
    },
  );
});

test('supabase: marcar un enlace roto sube fail_count y exige service_role', async (t) => {
  t.after(() => config.reload(null));
  useSupabaseEnv({ serviceRole: true });
  assert.deepEqual(supabase.status(), { configured: true, writable: true });
  const calls = mockFetch([[/\/rest\/v1\/video_host_links/, () => new Response(null, { status: 204 })]]);
  const ok = await supabase.reportBroken({ ...ROW_MOVIE, fail_count: 2 }, 'no-source');
  assert.equal(ok, true);
  const [{ url, init }] = calls;
  assert.equal(init.method, 'PATCH');
  assert.equal(url.searchParams.get('id'), 'eq.501');
  assert.equal(init.headers.apikey, SERVICE, 'service_role tiene prioridad sobre anon');
  const patch = JSON.parse(init.body);
  assert.equal(patch.is_working, false);
  assert.equal(patch.fail_count, 3);
  assert.equal(patch.last_error, 'no-source');
  assert.match(patch.last_checked_at, /^\d{4}-\d{2}-\d{2}T/);
});

// ── Extractores ──────────────────────────────────────────────────────────

test('anfitriones: familia por dominio y por host_code del catálogo', () => {
  assert.equal(hosts.familyOf('https://mixdrop.co/e/abcd1234'), 'mixdrop');
  assert.equal(hosts.familyOf('https://mxdrop.to/e/abcd1234'), 'mixdrop');
  assert.equal(hosts.familyOf('https://filemoon.sx/e/xyz123abc'), 'filemoon');
  assert.equal(hosts.familyOf('https://vihidrive.cc/e/abc123'), 'vihidrive');
  assert.equal(hosts.familyOf('https://vihi.to/e/abc123'), 'vihidrive');
  assert.equal(hosts.familyOf('https://streamtape.com/e/abc123'), 'streamtape');
  assert.equal(hosts.familyOf('https://ejemplo.example/e/abc123'), null);
  assert.equal(hosts.fileIdOf('https://filemoon.sx/e/xyz123abc'), 'xyz123abc');
  assert.equal(hosts.fileIdOf('https://vihidrive.cc/d/abc-123_XYZ'), 'abc-123_XYZ');
});

test('anfitriones: Mixdrop desempaqueta MDCore.wurl y Filemoon/Vihidrive leen sources', async () => {
  mockFetch([
    [/mixdrop\.co/, () => html(MIXDROP_HTML)],
    [/filemoon\.sx/, () => html(FILEMOON_HTML)],
    [/vihidrive\.cc/, () => html(VIHIDRIVE_HTML)],
  ]);

  const mix = await hosts.extractHost('https://mixdrop.co/e/abcd1234', { hostCode: 'mixdrop' });
  assert.equal(mix.ok, true);
  assert.equal(mix.extractor, 'mixdrop');
  assert.deepEqual(mix.sources, [{ url: 'https://mxcontent.net/v.mp4', kind: 'mp4' }]);

  const moon = await hosts.extractHost('https://filemoon.sx/e/xyz123abc', { hostCode: 'filemoon' });
  assert.equal(moon.ok, true);
  assert.equal(moon.sources[0].url, 'https://cdn.filemoon.example/hls/master.m3u8');
  assert.equal(moon.sources[0].kind, 'hls');

  const vihi = await hosts.extractHost('https://vihidrive.cc/e/abc123', { hostCode: 'vihidrive' });
  assert.equal(vihi.ok, true);
  assert.equal(vihi.sources[0].url, 'https://edge.vihidrive.example/stream/index.m3u8');
});

test('anfitriones: un medio directo se publica sin extraer y un embed desconocido se descarta', async () => {
  const calls = mockFetch([]);
  const direct = await hosts.extractHost('https://cdn.ejemplo.example/pelicula.mp4', { hostCode: 'mega' });
  assert.equal(direct.ok, true);
  assert.equal(direct.extractor, 'direct');
  assert.equal(calls.length, 0);

  const unknown = await hosts.extractHost('https://reproductor.example/embed/xyz', { hostCode: 'reproductor' });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, 'unsupported-host');
  assert.equal(calls.length, 0, 'no se gasta una petición en un visor sin extractor');
});

test('anfitriones: la etiqueta de audio sale de la columna language', () => {
  assert.equal(hosts.audioLabelOf({ language: 'Latino' }), 'Latino');
  assert.equal(hosts.audioLabelOf({ language: 'Castellano' }), 'Castellano');
  assert.equal(hosts.audioLabelOf({ language: 'Subtitulado' }), 'Subtitulado');
  assert.equal(hosts.audioLabelOf({ language: 'Japonés subtitulado' }), 'Subtitulado');
  assert.equal(hosts.audioLabelOf({ language: null }), '');
});

// ── Fuente de streams ────────────────────────────────────────────────────

const MOVIE = { title: 'Matrix', altTitle: 'The Matrix', year: '1999', mediaType: 'movie', imdbId: 'tt0133093', tmdbId: 603, season: null, episode: null };

test('fuente supabase: publica el medio extraído con la calidad y el idioma de la fila', async (t) => {
  t.after(() => config.reload(null));
  useSupabaseEnv({ serviceRole: true });
  cache.deletePrefix("");
  const calls = mockFetch([
    [/\/rest\/v1\/video_host_links/, () => json([ROW_MOVIE])],
    [/mixdrop\.co/, () => html(MIXDROP_HTML)],
  ]);

  const result = await searchSupabase('Matrix', MOVIE, 'Matrix');
  assert.equal(result.hits.length, 1);
  const [hit] = result.hits;
  assert.equal(hit.provider, 'supabase');
  assert.equal(hit.url, 'https://mxcontent.net/v.mp4');
  assert.equal(hit.quality, 'MP4');
  assert.equal(hit.resolution, '1080p');
  assert.equal(hit.audioLabel, 'Latino');
  assert.equal(hit.title, 'Matrix Mixdrop');

  // Segunda búsqueda: la extracción sale de la caché, no del anfitrión.
  const again = await searchSupabase('Matrix', MOVIE, 'Matrix');
  assert.deepEqual(again.hits.map((entry) => entry.url), ['https://mxcontent.net/v.mp4']);
  assert.equal(calls.filter((call) => call.url.hostname === 'mixdrop.co').length, 1);
});

test('fuente supabase: el resultado llega a Stremio con la forma de un stream directo', async (t) => {
  t.after(() => config.reload(null));
  useSupabaseEnv();
  cache.deletePrefix("");
  mockFetch([
    [/\/rest\/v1\/video_host_links/, () => json([{ ...ROW_MOVIE, host_code: 'filemoon', embed_url: 'https://filemoon.sx/e/xyz123abc', language: null }])],
    [/filemoon\.sx/, () => html(FILEMOON_HTML)],
  ]);
  const resolved = { ...MOVIE };
  const report = {};
  const hits = await streams.runProviders(['supabase'], 'Matrix', resolved, 'Matrix', report);
  assert.equal(hits.length, 1);
  assert.equal(report.supabase.accepted, 1);
  assert.equal(report.supabase.relevant, 1);
  const [stream] = hits;
  const built = streams.toDirectStream(stream, null);
  assert.equal(built.name, 'Matrix');
  assert.equal(built.url, 'https://cdn.filemoon.example/hls/master.m3u8');
  assert.match(built.title, /Filemoon/);
  assert.equal(built.behaviorHints.notWebReady, true);
});

test('fuente supabase: sin filas o sin credenciales no es un error', async (t) => {
  t.after(() => config.reload(null));
  useSupabaseEnv();
  mockFetch([[/\/rest\/v1\/video_host_links/, () => json([])]]);
  assert.deepEqual(await searchSupabase('Matrix', MOVIE, 'Matrix'), { hits: [], reason: 'no-links' });
  assert.deepEqual(await searchSupabase('Matrix', null, ''), { skipped: 'identity-required' });
  assert.deepEqual(
    await searchSupabase('Serie', { title: 'Serie', mediaType: 'series', imdbId: 'tt0903747', season: null, episode: null }, 'Serie'),
    { skipped: 'episode-required' },
  );
  // Una serie con episodio sí consulta: `ss=1&episode=eq.2`.
  const calls = mockFetch([[/\/rest\/v1\/video_host_links/, () => json([])]]);
  await searchSupabase('Serie', { ...MOVIE, title: 'Serie', mediaType: 'series', season: 1, episode: 2 }, 'Serie');
  assert.equal(calls[0].url.searchParams.get('media_type'), 'eq.series');
  assert.equal(calls[0].url.searchParams.get('season'), 'eq.1');
  assert.equal(calls[0].url.searchParams.get('episode'), 'eq.2');

  config.reload({});
  assert.deepEqual(await searchSupabase('Matrix', MOVIE, 'Matrix'), { skipped: 'not-configured' });
});

test('fuente supabase: un archivo borrado se marca roto una sola vez y no rompe la búsqueda', async (t) => {
  t.after(() => config.reload(null));
  useSupabaseEnv({ serviceRole: true });
  cache.deletePrefix("");
  const calls = mockFetch([
    [/\/rest\/v1\/video_host_links/, (_url, init) => (init.method === 'PATCH' ? new Response('', { status: 204 }) : json([ROW_MOVIE]))],
    [/mixdrop\.co/, () => new Response('File not found', { status: 200 })],
  ]);
  const result = await searchSupabase('Matrix', MOVIE, 'Matrix');
  assert.deepEqual(result, { hits: [], reason: 'no-extractable-embed' });
  const patches = calls.filter((call) => call.method === 'PATCH');
  assert.equal(patches.length, 1);
  assert.equal(JSON.parse(patches[0].body).is_working, false);
});

test('fuente supabase: con anon no se intenta escribir el estado del enlace', async (t) => {
  t.after(() => config.reload(null));
  useSupabaseEnv();
  cache.deletePrefix("");
  const calls = mockFetch([
    [/\/rest\/v1\/video_host_links/, () => json([ROW_MOVIE])],
    [/mixdrop\.co/, () => html('<html>no hay reproductor</html>')],
  ]);
  await searchSupabase('Matrix', MOVIE, 'Matrix');
  assert.equal(calls.filter((call) => call.method === 'PATCH').length, 0);
});

test('fuente supabase: una caída del proyecto se informa como el resto de fuentes', async (t) => {
  t.after(() => config.reload(null));
  useSupabaseEnv();
  const calls = mockFetch([[/\/rest\/v1\/video_host_links/, () => json({ message: 'upstream' }, 503)]]);
  const report = {};
  const hits = await streams.runProviders(['supabase'], 'Matrix', MOVIE, 'Matrix', report);
  assert.deepEqual(hits, []);
  assert.equal(report.supabase.ok, false);
  assert.equal(report.supabase.reason, 'upstream-error');
  assert.equal(report.supabase.status, 503);
  // Un 5xx es transitorio: tras tres fallos seguidos la fuente se pausa
  // (STREAM_PROVIDER_COOLDOWN_SECONDS) y deja de consultarse.
  config.reload({ SUPABASE_URL, SUPABASE_ANON_KEY: ANON, STREAM_PROVIDER_COOLDOWN_SECONDS: '300' });
  for (let i = 0; i < 2; i += 1) await streams.runProviders(['supabase'], 'Matrix', MOVIE, 'Matrix', {});
  const paused = {};
  await streams.runProviders(['supabase'], 'Matrix', MOVIE, 'Matrix', paused);
  assert.equal(paused.supabase.paused, true);
  assert.equal(calls.length, 3, 'durante la pausa no se vuelve a consultar el proyecto');
});

test('healthz: videoHostLinks solo publica booleanos', async (t) => {
  t.after(() => config.reload(null));
  useSupabaseEnv({ serviceRole: true });
  const status = supabase.status();
  assert.deepEqual(status, { configured: true, writable: true });
  assert.doesNotMatch(JSON.stringify(status), /supabase\.co|anon-key|service-role/);
});

test('fuente supabase: el grupo de maratón distingue anfitrión y formato', async (t) => {
  t.after(() => config.reload(null));
  useSupabaseEnv();
  cache.deletePrefix('');
  mockFetch([
    [/\/rest\/v1\/video_host_links/, () => json([ROW_MOVIE])],
    [/mixdrop\.co/, () => html(MIXDROP_HTML)],
  ]);
  const report = {};
  // `ignorePause`: la prueba de la caída deja la fuente pausada para el resto
  // del archivo (el estado de salud vive en el módulo, como en producción).
  const [hit] = await streams.runProviders(['supabase'], 'Matrix', MOVIE, 'Matrix', report, undefined, { ignorePause: true });
  const stream = streams.toDirectStream(hit, null);
  assert.equal(stream.behaviorHints.bingeGroup, 'catalogos-plus-supabase-mixdrop');
  assert.match(stream.title, /^Mixdrop · 🎧 Latino/);
});
