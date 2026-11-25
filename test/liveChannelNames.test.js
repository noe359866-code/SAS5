'use strict';

/** Limpieza del nombre visible de canales en vivo (panel iptvgo y listas). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanChannelName } = require('../lib/liveChannelNames');

test('letras pequeñas del panel se transliteran a ASCII', () => {
  assert.equal(cleanChannelName('AGUACATE TV Uʜ'), 'Aguacate TV UHD');
  assert.equal(cleanChannelName('GOLTV Eʳ'), 'GolTV ER');
  assert.equal(cleanChannelName('ECDF ( Eʳ )'), 'ECDF (ER)');
});

test('prefijos de operador y de sección desaparecen', () => {
  assert.equal(cleanChannelName('Cˡʳ S | BBC WORLD NEWS MX®'), 'BBC World News MX');
  assert.equal(cleanChannelName('Cʟʀ | GARAGE TV MX UHD'), 'Garage TV MX UHD');
  assert.equal(cleanChannelName('Msɪ | Bandamax MX®'), 'Bandamax MX');
  assert.equal(cleanChannelName('KIDS | CARTOON NETWORK MX UHD'), 'Cartoon Network MX UHD');
  assert.equal(cleanChannelName('MX | cEXTRA HD'), 'Extra HD');
  assert.equal(cleanChannelName('Carib BET_Gospel'), 'BET Gospel');
  assert.equal(cleanChannelName('Centro | TIGO SPORTS (PANAMA)'), 'Tigo Sports (PANAMA)');
});

test('marcas, superíndices, emoticonos y parrilla se recortan', () => {
  assert.equal(cleanChannelName('GOL PERU FHD ¹'), 'Gol Peru FHD');
  assert.equal(cleanChannelName('BOLIVIA TV :) #3'), 'Bolivia TV #3');
  assert.equal(cleanChannelName('BOLIVISION #2.'), 'Bolivision #2');
  assert.equal(cleanChannelName('14 | CANAL 5 HD'), 'Canal 5 HD');
  assert.equal(cleanChannelName('Carib 5 ??'), '5'); // sin letras: la descarta el índice
});

test('«Eliminatorias 2026» recupera su nombre y los eventos se traducen', () => {
  assert.equal(cleanChannelName('Eʟɪɪɴʀɪs 2026 | ARGENTINA'), 'Eliminatorias 2026 · Argentina');
  assert.equal(cleanChannelName('Eʟɪɪɴʀɪs 2026 | PERU (Only Event)'), 'Eliminatorias 2026 · Peru (solo eventos)');
});

test('las MAYÚSCULAS sostenidas pasan a título sin destripar siglas', () => {
  assert.equal(cleanChannelName('AMERICA TV HD'), 'America TV HD');
  assert.equal(cleanChannelName('BBC WORLD NEWS'), 'BBC World News');
  assert.equal(cleanChannelName('CANAL DE LA MUSICA'), 'Canal de la Musica');
  assert.equal(cleanChannelName('A&E LA'), 'A&E LA');
  assert.equal(cleanChannelName('ESPN'), 'ESPN');
  assert.equal(cleanChannelName('24 HORAS CL'), '24 Horas CL');
  // Nombres mixtos no se tocan; el paréntesis no rompe el test de mayúsculas
  assert.equal(cleanChannelName('BEST CABLE (HatunTV) SDT'), 'Best Cable (HatunTV) SDT');
  assert.equal(cleanChannelName('Bein Sports Xtra ñ'), 'Bein Sports Xtra ñ');
});

test('es idempotente: un nombre ya limpio no cambia', () => {
  for (const clean of ['Cartoon Network MX UHD', '24 Horas', 'GolTV ER', 'Eliminatorias 2026 · Argentina']) {
    assert.equal(cleanChannelName(clean), clean, clean);
  }
});
