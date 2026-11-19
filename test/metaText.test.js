'use strict';

/**
 * Texto de las fichas: idioma, país, duración, dinero y título alternativo.
 * Todo son funciones puras: no tocan red ni estado.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const text = require('../lib/metaText');

test('idioma: nombre en español, acepta variantes con región y no inventa', () => {
  assert.equal(text.languageLabel('es'), 'Español');
  assert.equal(text.languageLabel('EN'), 'Inglés');
  assert.equal(text.languageLabel('pt-BR'), 'Portugués');
  assert.equal(text.languageLabel('zh-Hans'), 'Chino');
  assert.equal(text.languageLabel('xx'), '', 'un código desconocido no se publica');
  assert.equal(text.languageLabel(''), '');
  assert.equal(text.languageLabel(null), '');
});

test('país: nombres en español, sin repetir y con tope de tres', () => {
  assert.equal(text.countryLabel('MX'), 'México');
  assert.equal(text.countryLabel(['MX', 'US']), 'México, Estados Unidos');
  assert.equal(text.countryLabel(['mx', 'MX', 'ZZ']), 'México', 'ignora repetidos y desconocidos');
  assert.equal(text.countryLabel(['US', 'GB', 'CA', 'FR']), 'Estados Unidos, Reino Unido, Canadá');
  assert.equal(text.countryLabel([]), '');
  assert.equal(text.countryLabel(undefined), '');
});

test('duración: horas y minutos, nunca «0 min»', () => {
  assert.equal(text.durationText(136), '2 h 16 min');
  assert.equal(text.durationText(120), '2 h');
  assert.equal(text.durationText(45), '45 min');
  assert.equal(text.durationText(0), '');
  assert.equal(text.durationText(-5), '');
  assert.equal(text.durationText('no es un número'), '');
});

test('dinero: cifras abreviadas con coma decimal', () => {
  assert.equal(text.moneyText(63100000), '63,1 M USD');
  assert.equal(text.moneyText(1400000000), '1,4 mil M USD');
  assert.equal(text.moneyText(750000), '750 mil USD');
  assert.equal(text.moneyText(500), '500 USD');
  assert.equal(text.moneyText(0), '', 'TMDB usa 0 para «no lo sé»');
  assert.equal(text.moneyText(undefined), '');
  assert.equal(text.boxOfficeText({ budget: 63100000, revenue: 1400000000 }),
    '💰 Presupuesto: 63,1 M USD  ·  🎟️ Recaudación: 1,4 mil M USD');
  assert.equal(text.boxOfficeText({ budget: 0, revenue: 0 }), '');
});

test('título alternativo: solo si aporta, sin duplicar por acentos o mayúsculas', () => {
  assert.equal(text.akaText('El origen', 'Inception'), 'Título original: Inception');
  assert.equal(text.akaText('Matrix', 'The Matrix'), 'Título original: The Matrix');
  assert.equal(text.akaText('Amélie', 'Amelie'), '');
  assert.equal(text.akaText('Interestelar', 'Interestelar'), '');
  assert.equal(text.akaText('Interestelar', ''), '');
  assert.equal(text.akaText('', 'Interstellar'), 'Título original: Interstellar');
});
