'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const choice = require('../lib/streamChoices');
const streams = require('../lib/streams');
const user = require('../lib/userConfig');
const config = require('../lib/config');

test('audio: solo marca Latino explícito y reconoce el inglés para rechazarlo', () => {
  assert.deepEqual(choice.hitLanguages({ title: 'The French Connection 1080p', titles: ['The French Connection'] }), ['unknown']);
  assert.deepEqual(choice.hitLanguages({ title: 'S.W.A.T. 1080p Latino English', titles: ['S.W.A.T.'] }), ['lat', 'en']);
  assert.deepEqual(choice.hitLanguages({ title: 'Blade Runner 2049 Subtitulado', titles: ['Blade Runner 2049'] }), ['unknown']);
  assert.deepEqual(choice.hitLanguages({ url: 'https://x', audioLabel: 'Castellano' }), ['es']);
  assert.deepEqual(choice.hitLanguages({ url: 'https://x', audioLabel: 'Español latino' }), ['lat']);
  assert.deepEqual(choice.hitLanguages({ url: 'https://example.org/a', provider: 'unregistered-provider' }), ['unknown']);
  assert.deepEqual(choice.hitLanguages({ url: 'https://example.org/a', provider: 'fanpelis' }), ['unknown']);
  assert.deepEqual(choice.hitLanguages({ url: 'https://example.org/a', provider: 'playlatin' }), ['unknown']);
});

test('filtro obligatorio: admite castellano y bloquea Inglés, dual y desconocido incluso sin config', () => {
  const latino = { title: 'Movie 1080p Latino', titles: ['Movie'] };
  const dual = { title: 'Movie 1080p Latino English', titles: ['Movie'] };
  const english = { title: 'Movie 1080p English', titles: ['Movie'] };
  const unknown = { title: 'Movie 1080p', titles: ['Movie'] };
  const directLatino = { provider: 'playlatin', url: 'https://cdn.example/movie.m3u8', audioLabel: 'Latino' };
  const unverifiableDirect = { provider: 'unregistered-provider', url: 'https://cdn.example/movie.m3u8' };
  assert.equal(choice.hitMatches(latino, null), true);
  assert.equal(choice.hitMatches(dual, null), false);
  assert.equal(choice.hitMatches(english, null), false);
  assert.equal(choice.hitMatches({ audioLabel: 'Castellano' }, null), true);
  assert.equal(choice.hitMatches({ audioLabel: 'Subtitulado en español' }, null), false);
  assert.equal(choice.hitMatches(unknown, null), false);
  assert.equal(choice.hitMatches({ ...directLatino, audioLabel: 'Latino + Inglés' }, null), false);
  assert.equal(choice.hitMatches(directLatino, null), true);
  assert.equal(choice.hitMatches(unverifiableDirect, null), false);
  assert.equal(choice.hitMatches(latino, { streamLanguages: [] }), false);
  assert.equal(choice.hitMatches(latino, { streamTypes: ['direct'] }), true);
});

test('configuración: fuentes directas activas y esquema sin selectores de tipo/idioma', () => {
  const cfg = user.normalizeConfig({ lang: 'en', streams: ['fanpelis', 'retired-indexer'], streamLanguages: ['en'] }, [], [], streams.PROVIDER_KEYS);
  assert.equal(cfg.lang, 'es-MX');
  assert.deepEqual(cfg.streams, ['fanpelis']);
  assert.equal('streamTypes' in cfg, false);
  assert.equal('streamLanguages' in cfg, false);
  assert.deepEqual(streams.PROVIDER_KEYS, ['fanpelis', 'flixlatam', 'playlatin', 'spinflix', 'fuegocine', 'animeonlineninja', 'cuevana3', 'cinecalidad', 'tioplus']);
  assert.equal(choice.providerType('fanpelis'), 'direct');
  assert.equal(choice.providerType('retired-indexer'), null);
  assert.equal(user.normalizeConfig({ streams: [] }, [], [], streams.PROVIDER_KEYS).streams.length, 0);
  assert.equal(user.normalizeConfig({ streams: ['retired-indexer'] }, [], [], streams.PROVIDER_KEYS).streams, null);
  const originalProviders = config.streamProviders;
  try {
    config.streamProviders = ['retired-indexer', 'legacy-source'];
    assert.deepEqual(streams.activeProviders(null), streams.PROVIDER_KEYS);
  } finally { config.streamProviders = originalProviders; }
});

test('sin STREAM_PROVIDERS se consultan las nueve fuentes; los overrides se respetan', (t) => {
  t.after(() => config.reload());
  config.reload({});
  assert.deepEqual(streams.activeProviders(null), streams.PROVIDER_KEYS);
  assert.deepEqual(streams.activeProviders({ streams: [] }), []);
  assert.deepEqual(streams.activeProviders({ streams: ['cuevana3'] }), ['cuevana3']);
  config.reload({ STREAM_PROVIDERS: 'all', PLAYLATIN: 'off' });
  assert.deepEqual(streams.activeProviders(null), streams.PROVIDER_KEYS.filter((key) => key !== 'playlatin'));
  config.reload({ STREAM_PROVIDERS: 'fanpelis,spinflix' });
  assert.deepEqual(streams.activeProviders(null), ['fanpelis', 'spinflix']);
  config.reload({ STREAM_PROVIDERS: 'off' });
  assert.deepEqual(streams.activeProviders(null), []);
});
