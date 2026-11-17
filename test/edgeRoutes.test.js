'use strict';

/**
 * `public/_redirects`: rutas que el Worker resolvía gastando una invocación.
 *
 * En `*.workers.dev` `/watch` (sin barra) no coincide con ningún archivo, así
 * que ejecutaba el Worker… para devolver un 404. `_redirects` se evalúa antes
 * de los assets y del Worker: 0 invocaciones.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { MAX_REDIRECTS, STATIC_ROUTES, buildRedirects, renderRedirects } = require('../lib/edgeRoutes');

test('/watch se resuelve en el borde, no en el Worker', () => {
  const { rules, dropped } = buildRedirects();
  assert.equal(dropped, 0);
  const watch = rules.find((rule) => rule.from === '/watch');
  assert.deepEqual(watch, { from: '/watch', to: '/watch/', status: 301 });
  // Las barras finales que tampoco existen como archivo.
  assert.ok(rules.some((rule) => rule.from === '/configure/' && rule.to === '/configure'));
  assert.ok(rules.some((rule) => rule.from === '/manifest.json/' && rule.to === '/manifest.json'));
});

test('cada segmento conocido recibe su redirección de barra final en el manifest', () => {
  const { rules } = buildRedirects({ segments: ['AAAbbbccc', 'DDDeeeefff', 'AAAbbbccc'] });
  // Ojo: `/manifest.json/` (ruta fija) también termina igual; se distinguen por
  // el segmento delante.
  const manifests = rules.filter((rule) => /^\/[^/]+\/manifest\.json\/$/.test(rule.from));
  assert.deepEqual(manifests.map((rule) => rule.from).sort(), [
    '/AAAbbbccc/manifest.json/',
    '/DDDeeeefff/manifest.json/',
  ]);
});

test('nunca se pasa del tope de reglas de Cloudflare (2.000 + 100)', () => {
  const segments = Array.from({ length: 3000 }, (_, i) => `seg${String(i).padStart(6, '0')}`);
  const { rules, dropped } = buildRedirects({ segments });
  assert.equal(rules.length, MAX_REDIRECTS);
  assert.ok(dropped > 0);
  // Lo que sobrevive es lo más importante: las rutas fijas nunca se recortan.
  for (const route of STATIC_ROUTES) {
    assert.ok(rules.some((rule) => rule.from === route.from), `falta ${route.from}`);
  }
});

test('renderRedirects conserva las reglas manuales y es idempotente', () => {
  const manual = '# mi regla\n/favicon.ico /assets/logo.png 302';
  const { rules } = buildRedirects();
  const first = renderRedirects(rules, manual);
  assert.ok(first.includes('/favicon.ico /assets/logo.png 302'));
  assert.ok(first.includes('/watch /watch/ 301'));
  assert.equal(renderRedirects(rules, first), first, 'regenerar no debe duplicar el bloque');
  // Y sin contenido previo también funciona.
  assert.ok(renderRedirects(rules, '').includes('/watch /watch/ 301'));
});

test('el bloque generado queda comentado y delimitado para poder sustituirlo', () => {
  const { rules } = buildRedirects();
  const out = renderRedirects(rules, '');
  assert.match(out, /# >>> plan:static/);
  assert.match(out, /# <<< plan:static <<</);
  // Fuera del bloque solo hay comentarios: ninguna regla "suelta".
  const outside = out.split('# >>> plan:static')[0];
  for (const line of outside.split('\n')) {
    assert.ok(!line.trim() || line.trim().startsWith('#'), `regla fuera del bloque: ${line}`);
  }
});
