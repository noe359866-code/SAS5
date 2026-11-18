'use strict';

/**
 * Espejos de cuota (`lib/mirrors.js`).
 *
 * El plan gratuito de Cloudflare Workers da 100.000 invocaciones/día **por
 * cuenta**, así que la única forma de duplicar el techo es repartir a los
 * usuarios entre dos despliegues del mismo addon. Esto prueba que el reparto
 * es determinista (cada usuario cae siempre en el mismo servidor), que la
 * lista se normaliza sin romperse con erratas y que el techo se calcula bien.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  FREE_DAILY_INVOCATIONS,
  MAX_MIRRORS,
  assign,
  capacity,
  hash32,
  normalizeOrigin,
  parseMirrors,
  report,
  withSelf,
} = require('../lib/mirrors');

test('normalizeOrigin acepta lo que pega un humano y descarta lo inseguro', () => {
  assert.equal(normalizeOrigin('https://b.workers.dev/'), 'https://b.workers.dev');
  assert.equal(normalizeOrigin('catalogos-plus.otro.workers.dev'), 'https://catalogos-plus.otro.workers.dev');
  assert.equal(normalizeOrigin('  HTTPS://Catalogos.Vercel.App  '), 'https://catalogos.vercel.app');
  // Rutas válidas se conservan (un espejo puede vivir en un subcamino).
  assert.equal(normalizeOrigin('https://ejemplo.com/addon/'), 'https://ejemplo.com/addon');
  // Basura, esquemas raros, credenciales o comodines no entran.
  for (const bad of ['', '   ', 'ftp://x.example', 'javascript:alert(1)', 'https://user:pass@x.example', 'https://']) {
    assert.equal(normalizeOrigin(bad), '', `debería rechazar «${bad}»`);
  }
});

test('parseMirrors separa por comas, espacios o saltos de línea y quita duplicados', () => {
  assert.deepEqual(
    parseMirrors('https://a.workers.dev, https://b.workers.dev\nhttps://c.example;'),
    ['https://a.workers.dev', 'https://b.workers.dev', 'https://c.example']
  );
  // La misma URL con y sin barra final es un solo espejo.
  assert.deepEqual(parseMirrors('https://a.workers.dev/,a.workers.dev'), ['https://a.workers.dev']);
  // Vacío o ausente = sin espejos (comportamiento de siempre).
  assert.deepEqual(parseMirrors(''), []);
  assert.deepEqual(parseMirrors(undefined), []);
  assert.deepEqual(parseMirrors(null), []);
  // Tope de seguridad: nadie mantiene nueve despliegues.
  const many = Array.from({ length: 20 }, (_, i) => `https://m${i}.example`);
  assert.equal(parseMirrors(many).length, MAX_MIRRORS);
});

test('withSelf pone delante el despliegue propio y no lo duplica', () => {
  assert.deepEqual(withSelf('https://a.workers.dev', ''), ['https://a.workers.dev']);
  assert.deepEqual(
    withSelf('https://a.workers.dev', ['https://b.workers.dev', 'https://a.workers.dev/']),
    ['https://a.workers.dev', 'https://b.workers.dev']
  );
  // Sin origen propio válido sigue habiendo lista (útil en pruebas locales).
  assert.deepEqual(withSelf('', ['https://b.workers.dev']), ['https://b.workers.dev']);
});

test('assign es determinista: cada instalación cae siempre en el mismo espejo', () => {
  const shards = ['https://a.workers.dev', 'https://b.workers.dev'];
  const first = assign('AbC123segmento', shards);
  for (let i = 0; i < 50; i += 1) assert.equal(assign('AbC123segmento', shards), first);
  // Semillas distintas sí se reparten (con 400, ambos espejos reciben tráfico).
  const seen = new Set();
  for (let i = 0; i < 400; i += 1) seen.add(assign(`seg-${i}`, shards));
  assert.equal(seen.size, 2, 'el reparto debe usar los dos espejos');
  // Sin espejos configurados no hay destino.
  assert.equal(assign('x', []), '');
  // El hash es el mismo que usa el navegador (FNV-1a de 32 bits).
  assert.equal(hash32(''), 0x811c9dc5);
  assert.equal(hash32('a'), 0xe40c292c);
});

test('capacity y report convierten espejos en invocaciones/día', () => {
  assert.deepEqual(capacity(0), {
    mirrors: 0, own: FREE_DAILY_INVOCATIONS, perMirror: FREE_DAILY_INVOCATIONS, total: 100_000,
  });
  assert.equal(capacity(1).total, 200_000);
  assert.equal(capacity(2).total, 300_000);

  const single = report({ self: 'https://a.workers.dev', mirrors: '' });
  assert.equal(single.shards, 1);
  assert.equal(single.dailyCapacity, 100_000);
  assert.match(single.hint, /MIRROR_ORIGINS/);

  const doubled = report({
    self: 'https://a.workers.dev',
    mirrors: ['https://b.workers.dev', 'https://a.workers.dev'], // el propio no cuenta dos veces
  });
  assert.deepEqual(doubled.mirrors, ['https://b.workers.dev']);
  assert.equal(doubled.shards, 2);
  assert.equal(doubled.dailyCapacity, 200_000);
  assert.match(doubled.hint, /2 despliegues/);
});

test('config.reload lee MIRROR_ORIGINS y STATIC_SHORTCUTS', () => {
  const config = require('../lib/config');
  config.reload({ MIRROR_ORIGINS: 'https://b.workers.dev, https://c.vercel.app' });
  assert.deepEqual(config.mirrorOrigins, ['https://b.workers.dev', 'https://c.vercel.app']);
  assert.equal(config.staticShortcuts, true);

  config.reload({ MIRROR_ORIGINS: '', STATIC_SHORTCUTS: 'off' });
  assert.deepEqual(config.mirrorOrigins, []);
  assert.equal(config.staticShortcuts, false);

  // Se puede desactivar con cualquiera de las formas habituales.
  for (const value of ['0', 'false', 'no', 'disabled']) {
    config.reload({ STATIC_SHORTCUTS: value });
    assert.equal(config.staticShortcuts, false, `«${value}» debería desactivar los atajos`);
  }
  config.reload({});
});

test('los scripts leen MIRROR_ORIGINS de [vars] en wrangler.toml (el entorno manda)', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { applyWranglerVars, parseVars, readWranglerVars } = require('../lib/tomlVars');

  const toml = [
    'name = "catalogos-plus"',
    'main = "worker.mjs"',
    '[vars]',
    'WATCH_REGION = "MX"',
    'MIRROR_ORIGINS = "https://b.workers.dev,https://c.vercel.app"',
    '# STATIC_SHORTCUTS = "off"',
    'TMDB_LANGUAGE = "es"',
    '[assets]',
    'directory = "./public"',
    'MIRROR_ORIGINS = "https://no-debe-leerse.example"',
  ].join('\n');
  const vars = parseVars(toml);
  assert.equal(vars.WATCH_REGION, 'MX');
  assert.equal(vars.MIRROR_ORIGINS, 'https://b.workers.dev,https://c.vercel.app');
  assert.equal(vars.STATIC_SHORTCUTS, undefined, 'las líneas comentadas no cuentan');
  assert.equal(vars.directory, undefined, 'solo se lee el bloque [vars]');

  // Se aplica únicamente lo que falte en el entorno.
  const env = { WATCH_REGION: 'NI' };
  const applied = applyWranglerVars(['WATCH_REGION', 'MIRROR_ORIGINS'], { file: null, env });
  assert.deepEqual(applied, [], 'sin archivo no se aplica nada');
  assert.equal(env.WATCH_REGION, 'NI');

  const tmp = path.join(os.tmpdir(), `wrangler-vars-${process.pid}.toml`);
  fs.writeFileSync(tmp, toml);
  const appliedReal = applyWranglerVars(['WATCH_REGION', 'MIRROR_ORIGINS'], { file: tmp, env });
  assert.equal(env.WATCH_REGION, 'NI', 'el entorno tiene prioridad sobre wrangler.toml');
  assert.equal(env.MIRROR_ORIGINS, 'https://b.workers.dev,https://c.vercel.app');
  assert.deepEqual(appliedReal, ['MIRROR_ORIGINS']);
  assert.deepEqual(readWranglerVars(path.join(os.tmpdir(), 'no-existe.toml')), {});
  fs.unlinkSync(tmp);
});
