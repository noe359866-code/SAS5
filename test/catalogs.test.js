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
  assert.ok(ids.includes('cine_estudio_a24'), 'estudios actuales incluidos');
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

test('cada estudio genera fila de películas Y de series', () => {
  const defs = buildDefs(null);
  for (const s of STUDIOS) {
    const movie = defs.find((d) => d.id === `cine_estudio_${s.key}`);
    const series = defs.find((d) => d.id === `tv_estudio_${s.key}`);
    assert.ok(movie, `falta cine_estudio_${s.key}`);
    assert.ok(series, `falta tv_estudio_${s.key}`);
    assert.equal(movie.company, s.company);
    assert.equal(movie.type, 'movie');
    assert.equal(series.type, 'series');
    assert.equal(series.mediaType, 'series');
  }
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
  // para hosts personalizados/flags futuros; las 121 filas no deben consumirlo.
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
    assert.ok(def.catalogs.length >= 110, `solo ${def.catalogs.length} catálogos en el manifest`);
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
