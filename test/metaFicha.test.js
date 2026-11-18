'use strict';

/**
 * Ficha de una serie, carrera de proveedores (productoras y estudio) y
 * catálogos: plataformas sin cobertura local, caché de listas vacías y
 * entradas de configuración corruptas.
 *
 * Todo con respuestas simuladas: sin TMDB, sin OMDB y sin claves reales.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const config = require('../lib/config');
const cache = require('../lib/cache');

/**
 * Monta un TMDB simulado a nivel de `lib/tmdb.js` (mucho más estable que
 * adivinar la URL exacta con append_to_response) y aísla el estado global.
 */
function withTmdb(t, overrides) {
  const tmdb = require('../lib/tmdb');
  const original = {};
  for (const [key, value] of Object.entries(overrides)) {
    original[key] = tmdb[key];
    tmdb[key] = typeof value === 'function' ? value : async () => value;
  }
  config.reload({ TMDB_API_KEY: 'meta-ficha-test', CACHE_TTL_SECONDS: '21600' });
  t.after(() => {
    Object.assign(tmdb, original);
    config.reload(null);
    // Las fichas y catálogos quedan cacheados por clave: al soltar TMDB el
    // resto de pruebas no debe ver respuestas de este archivo.
    cache.deletePrefix('meta:v1:');
    cache.deletePrefix('cat:v1:');
  });
}

const seriesDetails = (extra = {}) => ({
  name: 'Serie de prueba',
  original_name: 'Test Show',
  first_air_date: '2023-05-04',
  original_language: 'en',
  status: 'Returning Series',
  vote_average: 8.1,
  overview: 'Una sinopsis cualquiera.',
  genres: [{ name: 'Drama' }],
  episode_run_time: [52],
  production_countries: [{ iso_3166_1: 'ES' }, { iso_3166_1: 'US' }],
  production_companies: [{ name: 'Estudio Uno' }, { name: 'Estudio Dos' }, { name: 'Estudio Uno' }],
  created_by: [{ name: 'Creadora de la serie' }],
  aggregate_credits: { cast: [{ name: 'Actor A' }, { name: 'Actor B' }], crew: [] },
  seasons: [],
  next_episode_to_air: { season_number: 3, episode_number: 4, name: 'El regreso', air_date: '2026-12-01' },
  ...extra,
});

test('la ficha de una serie usa la creación (no la dirección) y publica la fecha completa', async (t) => {
  const { buildMeta } = require('../lib/meta');
  withTmdb(t, {
    tmdbGet: (path) => (path === '/tv/7701' ? seriesDetails() : null),
    externalIds: () => null,
  });
  const meta = await buildMeta('series', 'tmdb:tv:7701', null);
  assert.ok(meta, 'la ficha debe existir');
  // `aggregate_credits.crew` de TMDB no trae `job: Director`: antes la serie
  // salía sin autoría y ahora se usa `created_by`.
  assert.deepEqual(meta.director, ['Creadora de la serie']);
  assert.match(meta.description, /🎬 Creación: Creadora de la serie/);
  assert.doesNotMatch(meta.description, /Dirección/);
  assert.equal(meta.released, '2023-05-04T00:00:00.000Z');
  assert.equal(meta.releaseInfo, '2023');
  assert.equal(meta.country, 'España, Estados Unidos', 'el país se publica con nombre legible');
  assert.deepEqual(meta.productionCompanies, ['Estudio Uno', 'Estudio Dos']);
  assert.match(meta.description, /🌐 Idioma original: Inglés/);
  assert.match(meta.description, /📍 España, Estados Unidos/);
  // La duración va en el campo `runtime` (Stremio ya la pinta al lado del
  // año): repetirla en la descripción sería ruido.
  assert.equal(meta.runtime, '52 min');
  assert.doesNotMatch(meta.description, /52 min/);
  assert.match(meta.description, /Título original: Test Show/);
  assert.match(meta.description, /📅 Próximo episodio: T3E4 · 2026-12-01 · «El regreso»/);
});

test('una película publica presupuesto y recaudación, y no anuncia «próximo episodio»', async (t) => {
  const { buildMeta } = require('../lib/meta');
  withTmdb(t, {
    tmdbGet: () => ({
      title: 'Película de prueba', original_title: 'Test Movie', release_date: '2010-07-16',
      original_language: 'en', runtime: 148, overview: 'Sinopsis.', genres: [{ name: 'Ciencia ficción' }],
      budget: 160000000, revenue: 836000000, production_countries: [{ iso_3166_1: 'US' }],
      production_companies: [{ name: 'Warner Bros.' }], credits: { cast: [{ name: 'Actor' }], crew: [{ job: 'Director', name: 'Directora' }] },
      vote_average: 8.8,
      // TMDB a veces adjunta esto a una película: no debe aparecer en la ficha.
      next_episode_to_air: { season_number: 1, episode_number: 1, air_date: '2027-01-01' },
    }),
    externalIds: () => null,
  });
  const meta = await buildMeta('movie', 'tmdb:movie:8801', null);
  assert.equal(meta.director[0], 'Directora');
  assert.match(meta.description, /🎬 Dirección: Directora/);
  assert.match(meta.description, /💰 Presupuesto: 160 M USD/);
  assert.match(meta.description, /🎟️ Recaudación: 836 M USD/);
  assert.doesNotMatch(meta.description, /Próximo episodio/);
  assert.doesNotMatch(meta.description, /Creación/);
  assert.equal(meta.runtime, '148 min');
  assert.ok(meta.description.length < 1200, 'la descripción no se desborda');
});

test('sin claves configuradas, la ficha mínima lo dice; con claves, no culpa a la configuración', async (t) => {
  const { buildMeta } = require('../lib/meta');
  const tmdb = require('../lib/tmdb');
  const omdb = require('../lib/omdb');
  const originalFind = tmdb.findByImdbId;
  const originalTvmaze = require('../lib/tvmaze').showLookupByImdb;
  const originalOmdb = omdb.getByImdbId;
  tmdb.findByImdbId = async () => ({ movie: null, tv: null });
  require('../lib/tvmaze').showLookupByImdb = async () => null;
  omdb.getByImdbId = async () => null;
  t.after(() => {
    tmdb.findByImdbId = originalFind;
    require('../lib/tvmaze').showLookupByImdb = originalTvmaze;
    omdb.getByImdbId = originalOmdb;
    config.reload(null);
  });

  config.reload({ TMDB_API_KEY: '' });
  cache.deletePrefix('meta:v1:');
  const sinClaves = await buildMeta('movie', 'tt0000001', null);
  assert.match(sinClaves.description, /Revisa las claves/);

  // Con clave, el mismo vacío es del título, no de la instalación.
  config.reload({ TMDB_API_KEY: 'hay-clave' });
  cache.deletePrefix('meta:v1:');
  const conClave = await buildMeta('movie', 'tt0000002', null);
  assert.doesNotMatch(conClave.description, /Revisa las claves/);
  assert.match(conClave.description, /no disponibles para este título/);
});

test('una sinopsis gigante de TMDB no infla la ficha', async (t) => {
  const { buildMeta } = require('../lib/meta');
  withTmdb(t, {
    tmdbGet: () => ({ title: 'Larga', release_date: '2020-01-01', overview: 'Palabra '.repeat(400), genres: [] }),
    externalIds: () => null,
  });
  const meta = await buildMeta('movie', 'tmdb:movie:8802', null);
  assert.ok(meta.description.length < 900, `descripción de ${meta.description.length} caracteres`);
  assert.match(meta.description, /…$/);
});

test('plataforma sin cobertura local: se completa con las regiones de reserva sin duplicar', async (t) => {
  const catalogs = require('../lib/catalogs');
  const tmdb = require('../lib/tmdb');
  const original = tmdb.catalogItems;
  const regions = [];
  config.reload({ TMDB_API_KEY: 'platform-fallback', WATCH_REGION: 'NI', WATCH_REGION_FALLBACK: 'MX,US' });
  cache.deletePrefix('cat:v1:cine_netflix');
  // Nicaragua apenas tiene catálogo JustWatch: pocos títulos, uno repetido en
  // México. Antes la fila se quedaba con esos dos y parecía rota.
  const byRegion = {
    NI: [{ id: 1 }, { id: 2 }],
    MX: [{ id: 2 }, { id: 3 }],
    US: [{ id: 3 }, { id: 4 }],
  };
  tmdb.catalogItems = async (def, { region }) => {
    regions.push(region);
    return byRegion[region] || [];
  };
  t.after(() => { tmdb.catalogItems = original; config.reload(null); cache.deletePrefix('cat:v1:'); });

  const items = await catalogs.resolveCatalog('movie', 'cine_netflix', null, {});
  assert.deepEqual(items.map((item) => item.id), [1, 2, 3, 4]);
  assert.deepEqual(regions, ['NI', 'MX', 'US']);

  // La lista resuelta se guarda: la segunda visita no vuelve a preguntar.
  await catalogs.resolveCatalog('movie', 'cine_netflix', null, {});
  assert.deepEqual(regions, ['NI', 'MX', 'US']);

  // Si la región del usuario ya llena la página, no se molesta a las demás.
  regions.length = 0;
  cache.deletePrefix('cat:v1:cine_disney');
  tmdb.catalogItems = async (def, { region }) => {
    regions.push(region);
    return Array.from({ length: 40 }, (_, i) => ({ id: 100 + i }));
  };
  const full = await catalogs.resolveCatalog('movie', 'cine_disney', null, {});
  assert.equal(full.length, 40);
  assert.deepEqual(regions, ['NI']);
});

test('una página vacía se cachea unos minutos en vez de repetir la consulta', async (t) => {
  const catalogs = require('../lib/catalogs');
  const tmdb = require('../lib/tmdb');
  const original = tmdb.catalogItems;
  let calls = 0;
  config.reload({ TMDB_API_KEY: 'empty-page' });
  cache.deletePrefix('cat:v1:cine_estudio_mappa');
  tmdb.catalogItems = async () => { calls += 1; return []; };
  t.after(() => { tmdb.catalogItems = original; config.reload(null); cache.deletePrefix('cat:v1:'); });

  assert.deepEqual(await catalogs.resolveCatalog('movie', 'cine_estudio_mappa', null, {}), []);
  assert.deepEqual(await catalogs.resolveCatalog('movie', 'cine_estudio_mappa', null, {}), []);
  assert.equal(calls, 1, 'la segunda petición sale de la caché, no de TMDB');
});

test('una lista de categorías ocultas corrupta no oculta nada por accidente', () => {
  const { hiddenTags, applyPrefs } = require('../lib/streamFilters');
  assert.deepEqual([...hiddenTags({ hide: ['cam', 'cam', 'no-existe', 3, null, { a: 1 }, ['scr']] })], ['cam']);
  assert.deepEqual([...hiddenTags(null)], []);
  assert.deepEqual([...hiddenTags({ hide: 'cam' })], [], 'una cadena suelta no es una lista');
  const hits = [{ tags: ['cam'] }, { tags: ['web'] }, { tags: null }, null];
  // Un `null` dentro de la lista de streams rompía `applyPrefs` con un
  // TypeError; ahora se descarta sin afectar al resto.
  assert.deepEqual(applyPrefs(hits, { hide: ['cam'] }).map((hit) => hit && hit.tags), [['web'], null, null]);
  assert.equal(applyPrefs(hits, { hide: [] }).length, 4);
  assert.deepEqual(applyPrefs(null, { hide: ['cam'] }), []);
});

test('TVMaze publica la fecha completa de estreno solo cuando la conoce', () => {
  const { mapShowToMeta } = require('../lib/tvmaze');
  assert.equal(mapShowToMeta({ id: 1, name: 'Serie', premiered: '2020-03-01' }).released, '2020-03-01T00:00:00.000Z');
  assert.equal('released' in mapShowToMeta({ id: 2, name: 'Serie', premiered: '2020' }), false);
  assert.equal('released' in mapShowToMeta({ id: 3, name: 'Serie' }), false);
});
