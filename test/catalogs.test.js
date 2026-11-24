'use strict';

/** Equilibrio movie/series del manifest: Stremio debe mostrar filas de
 *  series casi tantas como de películas. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildDefs, SERIES_GENRES } = require('../lib/catalogs');

test('manifest equilibrado: series casi tantas como películas', () => {
  const defs = buildDefs(null);
  const movies = defs.filter((d) => d.type === 'movie');
  const series = defs.filter((d) => d.type === 'series');
  assert.ok(series.length >= movies.length - 2, `series=${series.length} películas=${movies.length}`);
});

test('existen los catálogos de series por género y miniseries', () => {
  const ids = buildDefs(null).map((d) => d.id);
  for (const g of SERIES_GENRES) assert.ok(ids.includes(`tv_genero_${g.key}`), g.key);
  assert.ok(ids.includes('tv_miniseries'));
  assert.ok(ids.includes('tv_peacock'), 'plataformas actuales incluidas');
  assert.equal(ids.some(id => id.includes('_estudio_')), false, 'estudios retirados');
});

test('los catálogos de género son de series y llevan genre id', () => {
  const def = buildDefs(null).find((d) => d.id === 'tv_genero_scifi');
  assert.equal(def.type, 'series');
  assert.equal(def.kind, 'genre');
  assert.equal(def.genre, '10765');
});

// ─────────────────────────────────────────────────────────────────────────────
// Plataformas y estudios: catálogo ampliado (calidad de los datos)
// ─────────────────────────────────────────────────────────────────────────────
const { PLATFORMS, STUDIOS, PLATFORM_KEYS, STUDIO_KEYS } = require('../lib/catalogs');
const { STATIC_PROVIDER_LOGOS, STATIC_STUDIO_LOGOS } = require('../lib/staticLogos');
const userConfig = require('../lib/userConfig');
const streams = require('../lib/streams');

test('plataformas: claves únicas, nombres y providers con ids de TMDB', () => {
  assert.equal(new Set(PLATFORM_KEYS).size, PLATFORM_KEYS.length, 'claves de plataforma duplicadas');
  for (const p of PLATFORMS) {
    assert.ok(p.key && /^[a-z0-9]+$/.test(p.key), `key inválida: ${p.key}`);
    assert.ok(p.name && p.name.length > 1, `nombre inválido: ${p.key}`);
    assert.match(String(p.providers), /^\d+(\|\d+)*$/, `providers inválidos en ${p.key}: ${p.providers}`);
  }
});

test('estudios: claves únicas y company id numérico de TMDB', () => {
  assert.equal(new Set(STUDIO_KEYS).size, STUDIO_KEYS.length, 'claves de estudio duplicadas');
  for (const s of STUDIOS) {
    assert.ok(s.key && /^[a-z0-9]+$/.test(s.key), `key inválida: ${s.key}`);
    assert.match(String(s.company), /^\d+$/, `company inválido en ${s.key}: ${s.company}`);
  }
});

test('plataformas nuevas están en el manifest con fila de películas y de series', () => {
  const ids = buildDefs(null).map((d) => d.id);
  for (const key of ['vix', 'clarovideo', 'directvgo', 'movistartv', 'filminlatino', 'globoplay', 'filmin', 'atresplayer', 'skyshowtime', 'movistarplus', 'plex', 'freevee', 'roku', 'discoveryplus']) {
    assert.ok(ids.includes(`cine_${key}`), `falta cine_${key}`);
    assert.ok(ids.includes(`tv_${key}`), `falta tv_${key}`);
  }
});

test('los estudios antiguos no reaparecen ni con configuración explícita', () => {
  const defs = buildDefs({ studios: ['marvel'], platforms: [], base: [] });
  assert.deepEqual(defs, []);
  assert.equal(buildDefs(null).some(d => d.kind === 'studio'), false);
});

test('Prime Video usa el id de LatAm (119), no solo el de EE. UU. (9)', () => {
  const prime = PLATFORMS.find((p) => p.key === 'prime');
  const ids = String(prime.providers).split('|');
  assert.ok(ids.includes('119'), 'falta 119 (Amazon Prime Video LatAm/ES)');
  assert.ok(ids.includes('9'), 'falta 9 (Amazon US)');
});

test('todas las plataformas tienen logo estático (salvo MUBI, que va con inicial)', () => {
  const missing = PLATFORMS.filter((p) => !STATIC_PROVIDER_LOGOS[p.key]).map((p) => p.key);
  assert.deepEqual(missing, ['mubi'], `plataformas sin logo: ${missing.join(', ')}`);
});

test('los logos estáticos de estudio apuntan al CDN de TMDB', () => {
  for (const [company, url] of Object.entries(STATIC_STUDIO_LOGOS)) {
    assert.match(String(company), /^\d+$/, `company id no numérico: ${company}`);
    assert.match(url, /^https:\/\/image\.tmdb\.org\/t\/p\/w500\/.+\.(png|jpg)$/);
  }
});

test('la config con TODO seleccionado cabe en la URL del manifest', () => {
  const segment = userConfig.encodeConfig({
    lang: 'es',
    region: 'MX',
    platforms: PLATFORM_KEYS,
    studios: STUDIO_KEYS,
    base: userConfig.BASE_KEYS,
    streams: streams.PROVIDER_KEYS,
  });
  assert.ok(segment.length <= userConfig.MAX_CONFIG_SEGMENT, `segmento de ${segment.length} chars`);
  const decoded = userConfig.decodeConfig(segment, PLATFORM_KEYS, STUDIO_KEYS, streams.PROVIDER_KEYS);
  assert.ok(decoded, 'la config completa debe decodificar');
  assert.equal(decoded.platforms.length, PLATFORMS.length);
  assert.equal(decoded.studios.length, STUDIOS.length);
});

test('el manifest deja margen bajo los 8 KB de la addonCollection API, incluso con URL larga', () => {
  // El SDK rechaza manifests de más de 8192 caracteres. Reservamos ~190 chars
  // para hosts personalizados/flags futuros; las 79 filas no deben consumirlo.
  const core = require('../lib/core');
  const logos = [
    ['normal', 'https://catalogo.example/assets/logo.png'],
    ['host largo', 'https://addon-preview-long-tenant.hosting.example/assets/logo.png'],
  ];
  for (const [host, logo] of logos) {
    const def = core.buildManifest(logo);
    const personal = core.buildManifest(logo, {
      lang: 'es', region: 'MX', platforms: null, studios: null, base: null, streams: null, isDefault: false,
    });
    for (const [label, manifest] of [['por defecto', def], ['personal', personal]]) {
      const size = JSON.stringify(manifest).length;
      assert.ok(size <= 8000, `manifest ${host}/${label} de ${size} chars (máximo preventivo 8000)`);
      const { addonBuilder } = require('stremio-addon-sdk');
      const builder = new addonBuilder(manifest);
      builder.defineCatalogHandler(async () => ({ metas: [] }));
      builder.defineMetaHandler(async () => ({ meta: { id: 'tt0000001', type: 'movie', name: 'Prueba' } }));
      builder.defineStreamHandler(async () => ({ streams: [] }));
      assert.ok(builder.getInterface().manifest, `SDK rechazó el manifest ${host}/${label}`);
    }
    assert.ok(def.catalogs.length === 80, `solo ${def.catalogs.length} catálogos en el manifest`);
  }
});

test('paginación: catálogos principales anuncian skip y respetan el límite de TMDB', async () => {
  const catalogs = require('../lib/catalogs');
  const tmdb = require('../lib/tmdb');
  const config = require('../lib/config');
  const original = tmdb.catalogItems;
  config.reload({ TMDB_API_KEY: 'pagination-test' });
  try {
    assert.deepEqual(catalogs.manifestCatalogs(null).find(c => c.id === 'tv_anime').extraSupported, ['skip']);
    tmdb.catalogItems = async (def, options) => {
      assert.equal(options.page, 3);
      return Array.from({ length: 20 }, (_, i) => ({ id: String(40 + i) }));
    };
    const items = await catalogs.resolveCatalog('series', 'tv_anime', null, { skip: '45' });
    assert.equal(items[0].id, '45');
    assert.equal(items.length, 15);
    for (const skip of ['-1', 'NaN', '1.5', '10000']) assert.deepEqual(await catalogs.resolveCatalog('series', 'tv_anime', null, { skip }), []);
    assert.deepEqual(await catalogs.resolveCatalog('series', 'tvmaze_hoy', null, { skip: 20 }), []);
  } finally { tmdb.catalogItems = original; config.reload(process.env); }
});

test('todos los catálogos TMDB anuncian paginación, incluido el manifest personal', () => {
  const { manifestCatalogs } = require('../lib/catalogs');
  for (const cfg of [null, { platforms: ['netflix'], studios: ['marvel'], base: ['anime', 'top', 'generos_series', 'tvmaze_hoy'] }]) {
    for (const def of manifestCatalogs(cfg)) {
      if (def.id === 'tvmaze_hoy' || def.id === 'tv_deportes') assert.equal(def.extraSupported, undefined);
      else assert.deepEqual(def.extraSupported, ['skip'], def.id);
      assert.equal(def.id.includes('_estudio_'), false);
    }
  }
});

test('plataformas: páginas consecutivas y final vacío usan la misma región sin mezclar países', async (t) => {
  const catalogs = require('../lib/catalogs');
  const tmdb = require('../lib/tmdb');
  const cache = require('../lib/cache');
  const config = require('../lib/config');
  const original = tmdb.catalogItems;
  config.reload({ TMDB_API_KEY: 'platform-pages', WATCH_REGION: 'NI', WATCH_REGION_FALLBACK: 'MX,US' });
  cache.deletePrefix('cat:v2:'); cache.deletePrefix('platform-region:v2:');
  t.after(() => { tmdb.catalogItems = original; config.reload(null); cache.deletePrefix('cat:v2:'); cache.deletePrefix('platform-region:v2:'); });
  const calls = [];
  tmdb.catalogItems = async (def, { region, page }) => {
    calls.push([region, page]);
    if (region === 'NI') return [{ id: 'local-only' }];
    if (region !== 'MX') assert.fail('no debe consultar una tercera región si MX llena la página');
    if (page > 2) return [];
    return Array.from({ length: 20 }, (_, i) => ({ id: `title-${(page - 1) * 20 + i}` }));
  };
  const a = await catalogs.resolveCatalog('series', 'tv_netflix', null);
  const b = await catalogs.resolveCatalog('series', 'tv_netflix', null, { skip: '20' });
  assert.equal(a.length, 20); assert.equal(b.length, 20);
  assert.equal(new Set([...a, ...b].map(item => item.id)).size, 40);
  assert.deepEqual(await catalogs.resolveCatalog('series', 'tv_netflix', null, { skip: '40' }), []);
  assert.deepEqual(calls, [['NI', 1], ['MX', 1], ['MX', 2], ['MX', 3]]);
});

test('series, películas y anime permiten páginas profundas y paran en el límite de TMDB', async (t) => {
  const catalogs = require('../lib/catalogs');
  const tmdb = require('../lib/tmdb');
  const cache = require('../lib/cache');
  const config = require('../lib/config');
  const original = tmdb.catalogItems;
  config.reload({ TMDB_API_KEY: 'deep-pages' });
  cache.deletePrefix('cat:v2:');
  t.after(() => { tmdb.catalogItems = original; config.reload(null); cache.deletePrefix('cat:v2:'); });
  tmdb.catalogItems = async (def, { page }) => {
    assert.equal(page, 500);
    return Array.from({ length: 20 }, (_, i) => ({ id: `${def.id}:${9980 + i}` }));
  };
  for (const [type, id] of [['movie', 'cine_popular'], ['series', 'tv_anime'], ['series', 'tv_genero_drama'], ['movie', 'cine_proximos']]) {
    const items = await catalogs.resolveCatalog(type, id, null, { skip: '9980' });
    assert.equal(items.length, 20);
    assert.equal(items[19].id, `${id}:9999`);
    assert.deepEqual(await catalogs.resolveCatalog(type, id, null, { skip: '10000' }), []);
  }
});
