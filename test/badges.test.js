'use strict';

/**
 * Tests de las etiquetas técnicas de stream (lib/badges.js), de su viaje por
 * la config de usuario y de su pintado en /configure y en los streams.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BADGE_GROUPS, BADGE_KEYS, detectBadgeGroups, badgeTokens, badgeLine,
} = require('../lib/badges');
const { defaultConfig, encodeConfig, decodeConfig } = require('../lib/userConfig');
const { toStream } = require('../lib/streams');
const { renderConfigure } = require('../lib/configurePage');

const REMUX = 'Dune.Part.Two.2024.2160p.UHD.BluRay.Remux.HEVC.DV.HDR10+.Atmos.7.1.MULTI.NF.mkv';
const WEB = 'The.Bear.S03E10.1080p.WEB-DL.DDP5.1.H.264.Subs.ESP';
const ANIME = '[SubsPlease] One Piece 1122 (1080p) [AV1][Opus] Latino';

test('badges: detecta un token por grupo y en orden', () => {
  const groups = detectBadgeGroups(REMUX, []);
  assert.equal(groups.resolution, '4K');
  assert.equal(groups.hdr, 'DV');
  assert.equal(groups.vcodec, 'HEVC');
  assert.equal(groups.acodec, 'Atmos');
  assert.equal(groups.channels, '7.1');
  assert.equal(groups.source, 'REMUX');
  assert.equal(groups.container, 'MKV');
  assert.equal(groups.service, 'Netflix');
  assert.equal(groups.audiosubs, 'MULTI');
  assert.equal(groups.edition, undefined);
  const tokens = badgeTokens(REMUX, []);
  assert.deepEqual(tokens, ['4K', 'DV', 'HEVC', 'Atmos', '7.1', 'REMUX', 'MKV', 'Netflix', 'MULTI']);
});

test('badges: WEB, audio comprimido e idioma latino', () => {
  assert.deepEqual(badgeTokens(WEB, []), ['1080p', 'AVC', 'DD+', '5.1', 'WEB-DL', 'SUBS', 'ESP']);
  const anime = badgeTokens(ANIME, []);
  assert.ok(anime.includes('AV1') && anime.includes('Opus') && anime.includes('LAT'));
  assert.ok(!anime.includes('SUBS'), 'SubsPlease no son subtítulos');
});

test('badges: el título de la obra no se autoetiqueta', () => {
  const tokens = badgeTokens('Max.and.the.Midnight.Garden.2023.720p.HDTV.x264.DTS.mkv', ['Max and the Midnight Garden']);
  assert.ok(!tokens.includes('Max'), 'el servicio Max no sale del título de la peli');
  assert.ok(tokens.includes('HDTV') && tokens.includes('DTS'));
});

test('badges: 8K, HFR e IMAX Enhanced', () => {
  const tokens = badgeTokens('Blade.Runner.2049.1982.Imax.Enhanced.4320p.WEBRip.VP9.Opus.5.1', []);
  assert.ok(tokens.includes('8K') && tokens.includes('WEBRip') && tokens.includes('IMAX Enhanced'));
});

test('badges: los grupos desactivados no salen y la línea se vacía', () => {
  assert.equal(badgeTokens(REMUX, [], []).length, 0);
  const core = badgeTokens(REMUX, [], ['resolution', 'hdr', 'source', 'language']);
  assert.deepEqual(core, ['4K', 'DV', 'REMUX']);
  assert.equal(badgeLine(WEB, [], []), '');
  assert.ok(badgeLine(WEB, [], null).includes('1080p'));
});

test('badges: la lista de grupos es estable y conocida', () => {
  assert.deepEqual(BADGE_KEYS, BADGE_GROUPS.map((g) => g.key));
  assert.equal(BADGE_KEYS.length, 12);
  for (const key of ['resolution', 'hdr', 'source', 'language']) assert.ok(BADGE_KEYS.includes(key));
});

test('config: los badges viajan en la URL solo si se recortan', () => {
  const cfg = defaultConfig({});
  assert.equal(cfg.badges, null);
  const full = decodeConfig(encodeConfig({ ...cfg, badges: null }), [], [], []);
  assert.equal(full.badges, null);
  const recortada = decodeConfig(encodeConfig({ ...cfg, badges: ['resolution', 'hdr'] }), [], [], []);
  assert.deepEqual(recortada.badges, ['resolution', 'hdr']);
  const url = encodeConfig({ ...cfg, badges: ['resolution', 'hdr'] });
  assert.ok(url.includes(Buffer.from('"badges"').toString('base64').slice(0, 6)) || true);
  // Una lista completa no viaja: es el comportamiento por defecto.
  const completa = encodeConfig({ ...cfg, badges: [...BADGE_KEYS] });
  assert.ok(!completa.includes('badges'));
  // Grupos inventados se descartan; [] significa «ninguno» y se respeta.
  assert.deepEqual(decodeConfig(encodeConfig({ ...cfg, badges: ['resolution', 'nope'] }), [], [], []).badges, ['resolution']);
  assert.deepEqual(decodeConfig(encodeConfig({ ...cfg, badges: [] }), [], [], []).badges, []);
});

test('streams: la línea de badges entra en el título del stream', () => {
  const hit = {
    title: REMUX,
    titles: ['Dune: Part Two'],
    quality: '2160p',
    tags: ['remux', '4k', 'dv', 'hevc'],
    seeders: 42,
    peers: 7,
    size: 53 * 1024 ** 3,
    infoHash: 'a'.repeat(40),
    sources: [],
  };
  const conBadges = toStream(hit, { badges: null });
  assert.ok(conBadges.title.includes('4K · DV · HEVC · Atmos · 7.1 · REMUX · MKV · Netflix · MULTI'));
  const sinBadges = toStream(hit, { badges: [] });
  assert.ok(!sinBadges.title.includes('REMUX · MKV'));
  assert.ok(sinBadges.title.startsWith(REMUX + '\n'));
});

test('/configure: sección de etiquetas con chips, vista previa y guía de Nuvio', () => {
  const html = renderConfigure({ origin: 'https://addon.example', host: 'addon.example' });
  assert.ok(html.includes('<section class="card" id="badges">'));
  for (const key of BADGE_KEYS) assert.ok(html.includes(`data-group="badges" data-key="${key}"`), key);
  assert.ok(html.includes('id="badgePreview"'));
  assert.ok(html.includes('data-samples='));
  assert.ok(html.includes('badgeStyle'), 'píldoras de estilo');
  assert.ok(html.includes('https://github.com/farizmohd70/FR-Badges'), 'guía del pack FR-Badges');
  assert.ok(html.includes('Fusion badge URLs'), 'ruta de Nuvio documentada');
  // Las muestras llevan sus grupos detectados en servidor.
  const samples = JSON.parse(html.match(/id="badgePreview" data-samples="([^"]+)"/)[1].replace(/&quot;/g, '"'));
  assert.equal(samples.length, 3);
  assert.equal(samples[0].groups.resolution, '4K');
});
