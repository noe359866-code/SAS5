'use strict';

/** Regresión: el <script> inline de /configure debe ser JS válido y la
 *  codificación base64url de la config debe hacer roundtrip exacto. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { renderConfigure } = require('../lib/configurePage');
const userConfig = require('../lib/userConfig');
const { PLATFORM_KEYS, STUDIO_KEYS } = require('../lib/catalogs');

test('el <script> inline de /configure es JS válido (node --check)', () => {
  const html = renderConfigure({ origin: 'https://addon.example', host: 'addon.example' });
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'la página debe incluir un <script>');
  const tmp = path.join(os.tmpdir(), `configure-inline-${process.pid}.js`);
  fs.writeFileSync(tmp, match[1]);
  const res = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr || 'el script inline tiene errores de sintaxis');
});

test('config region MX/es-MX sobrevive roundtrip base64url', () => {
  const encoded = userConfig.encodeConfig({
    lang: 'es-MX',
    region: 'MX',
    platforms: ['netflix', 'hulu'],
    studios: ['marvel'],
    base: ['tendencias', 'top'],
  });
  const decoded = userConfig.decodeConfig(encoded, PLATFORM_KEYS, STUDIO_KEYS);
  assert.equal(decoded.region, 'MX');
  assert.equal(decoded.lang, 'es-MX');
  assert.deepEqual(decoded.platforms.sort(), ['hulu', 'netflix']);
  assert.deepEqual(decoded.studios, ['marvel']);
  assert.deepEqual(decoded.base.sort(), ['tendencias', 'top']);
});

test('decodeConfig rechaza basura y segmentos reservados', () => {
  assert.equal(userConfig.decodeConfig('!!!', PLATFORM_KEYS, STUDIO_KEYS), null);
  assert.equal(userConfig.decodeConfig('bm90LWpzb24', PLATFORM_KEYS, STUDIO_KEYS), null); // "not-json"
  assert.equal(userConfig.decodeConfig('catalog', PLATFORM_KEYS, STUDIO_KEYS), null);
});

test('decodeConfig sin campos opcionales cae a defaults (todo activado)', () => {
  const encoded = userConfig.encodeConfig({ lang: 'es', region: 'AR' });
  const decoded = userConfig.decodeConfig(encoded, PLATFORM_KEYS, STUDIO_KEYS);
  assert.equal(decoded.region, 'AR');
  assert.equal(decoded.platforms, null); // null = todas
  assert.equal(decoded.studios, null);
});

test('config completa (todo marcado en /configure) cabe y decodifica', () => {
  const streams = require('../lib/streams');
  // Lo que genera /configure al marcar TODAS las plataformas, estudios,
  // catálogos base y proveedores: el caso real que rompía (596 caracteres
  // frente al límite antiguo de 512 → 404 invalid_config → sin streams).
  const encoded = userConfig.encodeConfig({
    lang: 'es',
    region: 'MX',
    platforms: PLATFORM_KEYS,
    studios: STUDIO_KEYS,
    base: userConfig.BASE_KEYS,
    streams: streams.PROVIDER_KEYS,
  });
  assert.ok(encoded.length > 512, `el segmento mide ${encoded.length} caracteres`);
  assert.ok(encoded.length <= userConfig.MAX_CONFIG_SEGMENT);
  const decoded = userConfig.decodeConfig(encoded, PLATFORM_KEYS, STUDIO_KEYS, streams.PROVIDER_KEYS);
  assert.ok(decoded, 'la config completa debe decodificar');
  assert.deepEqual(decoded.platforms.sort(), [...PLATFORM_KEYS].sort());
  assert.deepEqual(decoded.studios.sort(), [...STUDIO_KEYS].sort());
  assert.deepEqual(decoded.streams.sort(), [...streams.PROVIDER_KEYS].sort());
  assert.equal(decoded.region, 'MX');
});
