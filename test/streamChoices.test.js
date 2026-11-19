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
  assert.deepEqual(choice.hitLanguages({ url: 'https://example.org/a', provider: 'spinflix' }), ['unknown']);
});

test('filtro obligatorio: admite latino, castellano y subtitulado; bloquea inglés, dual y desconocido', () => {
  const latino = { title: 'Movie 1080p Latino', titles: ['Movie'] };
  const dual = { title: 'Movie 1080p Latino English', titles: ['Movie'] };
  const english = { title: 'Movie 1080p English', titles: ['Movie'] };
  const unknown = { title: 'Movie 1080p', titles: ['Movie'] };
  const directLatino = { provider: 'spinflix', url: 'https://cdn.example/movie.m3u8', audioLabel: 'Latino' };
  const unverifiableDirect = { provider: 'unregistered-provider', url: 'https://cdn.example/movie.m3u8' };
  assert.equal(choice.hitMatches(latino, null), true);
  assert.equal(choice.hitMatches(dual, null), false);
  assert.equal(choice.hitMatches(english, null), false);
  assert.equal(choice.hitMatches({ audioLabel: 'Castellano' }, null), true);
  assert.equal(choice.hitMatches({ audioLabel: 'Subtitulado en español' }, null), true);
  assert.equal(choice.hitMatches({ audioLabel: 'Subtitulado' }, null), true);
  assert.equal(choice.hitMatches(unknown, null), false);
  assert.equal(choice.hitMatches({ ...directLatino, audioLabel: 'Latino + Inglés' }, null), false);
  assert.equal(choice.hitMatches(directLatino, null), true);
  assert.equal(choice.hitMatches(unverifiableDirect, null), false);
  assert.equal(choice.hitMatches(latino, { streamLanguages: [] }), false);
  assert.equal(choice.hitMatches({ audioLabel: 'Subtitulado' }, { streamLanguages: ['sub'] }), true);
  assert.equal(choice.hitMatches(latino, { streamLanguages: ['sub'] }), false);
  assert.equal(choice.hitMatches(latino, { streamTypes: ['direct'] }), true);
});

test('configuración: solo las fuentes directas y sin selectores de tipo/idioma', () => {
  const cfg = user.normalizeConfig({ lang: 'en', streams: ['fanpelis', 'retired-indexer'], streamLanguages: ['en'] }, [], [], streams.PROVIDER_KEYS);
  assert.equal(cfg.lang, 'es-MX');
  assert.deepEqual(cfg.streams, ['fanpelis']);
  assert.equal('streamTypes' in cfg, false);
  assert.equal('streamLanguages' in cfg, false);
  assert.deepEqual(streams.PROVIDER_KEYS, ['fanpelis', 'spinflix', 'gnulahd', 'videoapp', 'pelisplus',
    'tubeonline', 'mirandogratis', 'gnulaone', 'ultra', 'cuevanas3', 'animeflv', 'fuegocine', 'pelisjuanita']);
  assert.deepEqual(Object.keys(streams.SEARCHERS).sort(), [...streams.PROVIDER_KEYS].sort());
  assert.deepEqual(Object.keys(choice.PROVIDER_LANGUAGES), streams.PROVIDER_KEYS);
  for (const key of streams.PROVIDER_KEYS) assert.equal(choice.providerType(key), 'direct');
  assert.equal(choice.providerType('retired-indexer'), null);
});

test('GnulaHD experimental sigue activa por defecto; se respetan las listas explícitas y off', (t) => {
  t.after(() => config.reload());
  config.reload({});
  assert.deepEqual(streams.activeProviders(null), ['fanpelis', 'spinflix', 'gnulahd', 'videoapp', 'pelisplus',
    'tubeonline', 'mirandogratis', 'gnulaone', 'ultra', 'cuevanas3', 'animeflv', 'fuegocine', 'pelisjuanita']);
  assert.deepEqual(streams.activeProviders({ streams: [] }), []);
  assert.deepEqual(streams.activeProviders({ streams: ['gnulahd'] }), ['gnulahd']);
  config.reload({ STREAM_PROVIDERS: 'all', FANPELIS: 'off' });
  assert.deepEqual(streams.activeProviders(null), ['spinflix', 'gnulahd', 'videoapp', 'pelisplus',
    'tubeonline', 'mirandogratis', 'gnulaone', 'ultra', 'cuevanas3', 'animeflv', 'fuegocine', 'pelisjuanita']);
  assert.deepEqual(streams.activeProviders({ streams: ['fanpelis'] }), []);
  config.reload({ STREAM_PROVIDERS: 'fanpelis,spinflix' });
  assert.deepEqual(streams.activeProviders(null), ['fanpelis', 'spinflix']);
  config.reload({ STREAM_PROVIDERS: 'off' });
  assert.deepEqual(streams.activeProviders(null), []);
  assert.deepEqual(streams.activeProviders({ streams: ['gnulahd'] }), []);
});

test('los enlaces antiguos conservan su selección válida y nunca reactivan una fuente retirada', (t) => {
  t.after(() => config.reload());
  // `fuegocine` salió de esta lista el 19-11-2026: se volvió a añadir con un
  // adaptador nuevo (API del buscador + visor que declara el audio).
  const retired = ['flixlatam', 'playlatin', 'animeonlineninja', 'cuevana3', 'cinecalidad', 'tioplus'];
  for (const key of retired) assert.equal(choice.providerType(key), null);
  const readSegment = (segment) => user.decodeConfig(segment, [], [], streams.PROVIDER_KEYS);
  // Simula una URL instalada antes del retiro, sin pasar por el encoder actual.
  const decode = (keys) => readSegment(Buffer.from(JSON.stringify({ region: 'MX', streams: keys })).toString('base64url'));
  const cfg = decode([...retired, 'spinflix', 'fanpelis', 'spinflix']);
  assert.equal(cfg.region, 'MX');
  assert.deepEqual(cfg.streams, ['spinflix', 'fanpelis']);
  assert.deepEqual(readSegment(user.encodeConfig(cfg)).streams, ['fanpelis', 'spinflix']);

  config.reload({});
  assert.deepEqual(streams.activeProviders(cfg), ['fanpelis', 'spinflix']);
  config.reload({ STREAM_PROVIDERS: [...retired, 'spinflix'].join(',') });
  assert.deepEqual(streams.activeProviders(null), ['spinflix']);
  assert.deepEqual(streams.activeProviders(decode(['fanpelis', ...retired])), []);

  // Una lista antigua de solo retiradas tiene el mismo fallback que antes.
  assert.equal(decode(retired).streams, null);
  assert.deepEqual(streams.activeProviders(decode(retired)), ['spinflix']);
  config.reload({ STREAM_PROVIDERS: retired.join(',') });
  assert.deepEqual(streams.activeProviders(decode(retired)), ['fanpelis', 'spinflix', 'gnulahd', 'videoapp', 'pelisplus',
    'tubeonline', 'mirandogratis', 'gnulaone', 'ultra', 'cuevanas3', 'animeflv', 'fuegocine', 'pelisjuanita']);
  assert.deepEqual(decode([]).streams, []);
  assert.deepEqual(streams.activeProviders(decode([])), []);
  config.reload({ STREAM_PROVIDERS: 'off' });
  assert.deepEqual(streams.activeProviders(decode(retired)), []);
});
