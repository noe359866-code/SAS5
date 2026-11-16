'use strict';

/**
 * El aprovisionador de la KV debrid: reescribe wrangler.toml sin romper el
 * despliegue. Sin KV el Worker cae en la Cache API (conectar funciona, pero no
 * es duradero), así que este script es la vía recomendada y debe ser seguro.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPT = path.resolve(__dirname, '../scripts/debrid-kv.mjs');
const COMMENTED_BLOCK = [
  '# Credenciales debrid (opcional): crea una KV para las credenciales cifradas.',
  '# [[kv_namespaces]]',
  '# binding = "DEBRID_KV"',
  '# id = "<ID de la KV creada>"',
  '',
].join('\n');

let writeBinding;

test('el aprovisionador expone writeBinding sin ejecutar Wrangler al importarlo', async () => {
  const mod = await import(`file://${SCRIPT}`);
  writeBinding = mod.writeBinding;
  assert.equal(typeof writeBinding, 'function');
  // Importarlo no debe haber tocado la configuración del repo.
  assert.match(fs.readFileSync(path.resolve(__dirname, '../wrangler.toml'), 'utf8'), /# \[\[kv_namespaces\]\]/);
});

test('activa el binding comentado dejando el id del namespace creado', () => {
  const toml = `[vars]\nADDON_NAME = "Catálogos+"\n\n${COMMENTED_BLOCK}`;
  const next = writeBinding(toml, 'namespace-id-de-ejemplo');
  assert.match(next, /\[\[kv_namespaces\]\]\nbinding = "DEBRID_KV"\nid = "namespace-id-de-ejemplo"/);
  assert.equal(/^# \[\[kv_namespaces\]\]/m.test(next), false, 'el bloque deja de estar comentado');
  assert.match(next, /\[vars\]/, 'no toca el resto de la configuración');
});

test('es idempotente: si la KV ya está enlazada no reescribe nada', () => {
  const once = writeBinding(`[vars]\n\n${COMMENTED_BLOCK}`, 'namespace-id-de-ejemplo');
  assert.equal(writeBinding(once, 'otro-id-que-no-debe-aplicarse'), null);
});

test('añade el bloque cuando wrangler.toml no tiene ninguna KV', () => {
  const toml = 'name = "catalogos-plus"\nmain = "worker.mjs"\n';
  const next = writeBinding(toml, 'namespace-id-de-ejemplo');
  assert.match(next, /\]\nbinding = "DEBRID_KV"\nid = "namespace-id-de-ejemplo"/);
  assert.match(next, /main = "worker.mjs"/);
});

test('respeta otros bindings KV ajenos al debrid', () => {
  const toml = `${'name = "catalogos-plus"\n'}[[kv_namespaces]]\nbinding = "OTRA_KV"\nid = "otra"\n`;
  const next = writeBinding(toml, 'namespace-id-de-ejemplo');
  assert.match(next, /binding = "DEBRID_KV"\nid = "namespace-id-de-ejemplo"/);
  assert.match(next, /binding = "OTRA_KV"\nid = "otra"/, 'el binding previo sigue en el fichero');
});
