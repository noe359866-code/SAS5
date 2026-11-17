'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const choice = require('../lib/streamChoices');
const streams = require('../lib/streams');
const user = require('../lib/userConfig');
test('detección de audio evita títulos legítimos y conserva varias pistas', () => {
  assert.deepEqual(choice.hitLanguages({ title:'The French Connection 1080p', titles:['The French Connection'] }), ['unknown']);
  assert.deepEqual(choice.hitLanguages({ title:'S.W.A.T. 1080p Latino English', titles:['S.W.A.T.'] }), ['lat','en']);
  assert.deepEqual(choice.hitLanguages({ title:'Blade Runner 2049 Subtitulado', titles:['Blade Runner 2049'] }), ['unknown']);
  assert.deepEqual(choice.hitLanguages({ url:'https://x', audioLabel:'Castellano' }), ['es']);
  assert.deepEqual(choice.hitLanguages({ url:'https://x', audioLabel:'Español latino' }), ['lat']);
  assert.deepEqual(choice.hitLanguages({ url:'https://x', title:'FrenchStream' }), ['unknown']);
});
test('tipo e idioma y vacío explícito filtran fuentes', () => {
  const torrent = {title:'Movie Latino', titles:['Movie']};
  const direct = {url:'https://example.org/a', audioLabel:'Latino'};
  assert.equal(choice.hitMatches(torrent,{streamTypes:['direct']}),false);
  assert.equal(choice.hitMatches(direct,{streamTypes:['direct'],streamLanguages:['lat']}),true);
  assert.equal(choice.hitMatches(direct,{streamLanguages:[]}),false);
  assert.equal(choice.hitMatches({url:'https://example.org/a'},{streamLanguages:['unknown']}),true);
});
test('configuración vieja, selección nueva y separación de proveedores', () => {
  const old = user.normalizeConfig({}, [], [], streams.PROVIDER_KEYS);
  assert.equal(old.streamTypes,null); assert.equal(old.streamLanguages,null);
  const cfg = user.normalizeConfig({streamTypes:['direct'],streamLanguages:['fr','unknown']}, [], [], streams.PROVIDER_KEYS);
  const round = user.decodeConfig(user.encodeConfig(cfg), [], [], streams.PROVIDER_KEYS);
  assert.deepEqual(round.streamTypes,['direct']); assert.deepEqual(round.streamLanguages,['fr','unknown']);
  assert.deepEqual(user.decodeConfig(user.encodeConfig({...cfg,streamTypes:[],streamLanguages:[]}),[],[],streams.PROVIDER_KEYS).streamTypes, []);
  const active = streams.activeProviders(cfg);
  assert.ok(active.includes('frenchstream')); assert.ok(!active.includes('knaben')); assert.ok(!active.includes('fanpelis'));
});
