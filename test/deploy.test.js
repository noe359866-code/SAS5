'use strict';

/**
 * Orden estricto del despliegue en Cloudflare Workers: un solo trabajador
 * (`ramdonlatam`) en el plan gratuito. Si wrangler.toml se desvía de estas
 * reglas (otro nombre, bindings de pago, techos por encima del plan free),
 * este test falla antes de que el error llegue al panel de Cloudflare.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const toml = fs.readFileSync(path.join(__dirname, '..', 'wrangler.toml'), 'utf8');

describe('despliegue Cloudflare Workers (plan gratuito)', () => {
  test('un solo trabajador: wrangler declara exactamente ramdonlatam', () => {
    const names = [...toml.matchAll(/^name\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
    assert.deepEqual(names, ['ramdonlatam'],
      'wrangler.toml debe declarar un único worker llamado ramdonlatam (otro nombre crea un segundo worker)');
  });

  test('sin bindings de pago o cuota (KV, DO, Queues, D1, R2, Vectorize, AI, Workflows, Hyperdrive)', () => {
    // Solo cuentan las líneas activas: los comentarios pueden nombrarlos.
    const active = toml.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    for (const banned of ['kv_namespaces', 'durable_objects', 'queues', 'd1_databases',
      'r2_buckets', 'vectorize_indexes', 'hyperdrive', '[ai]', '[workflows]']) {
      assert.ok(!active.includes(banned), `binding prohibido en el plan gratuito: ${banned}`);
    }
  });

  test('runtime fijado: compatibility_date y nodejs_compat', () => {
    assert.match(toml, /^compatibility_date\s*=\s*"20\d\d-/m);
    assert.match(toml, /compatibility_flags\s*=\s*\[[^\]]*"nodejs_compat"/);
    assert.match(toml, /^main\s*=\s*"worker\.mjs"/m);
  });

  test('los assets estáticos (gratis e ilimitados) ganan antes que el Worker', () => {
    assert.match(toml, /\[assets\][\s\S]*?directory\s*=\s*"\.\/public"/);
    assert.match(toml, /\[assets\][\s\S]*?run_worker_first\s*=\s*false/);
  });

  test('los presupuestos de streams respetan el techo del plan free', () => {
    const budget = Number((/STREAM_REQUEST_BUDGET_MS\s*=\s*"(\d+)"/.exec(toml) || [])[1]);
    const timeout = Number((/STREAM_PROVIDER_TIMEOUT_MS\s*=\s*"(\d+)"/.exec(toml) || [])[1]);
    const fallback = Number((/STREAM_FALLBACK_TIMEOUT_MS\s*=\s*"(\d+)"/.exec(toml) || [])[1]);
    const conc = Number((/STREAM_MAX_CONCURRENT\s*=\s*"(\d+)"/.exec(toml) || [])[1]);
    assert.ok(budget > 0 && budget <= 10000, `presupuesto fuera de techo: ${budget} ms`);
    assert.ok(timeout > 0 && timeout <= 10000, `timeout fuera de techo: ${timeout} ms`);
    assert.ok(fallback > 0 && fallback < budget, `fallback ${fallback} ms debe ser menor que el presupuesto`);
    assert.ok(conc >= 1 && conc <= 8, `concurrencia fuera de rango: ${conc}`);
  });

  test('la marca pública del worker coincide con su nombre', () => {
    const worker = fs.readFileSync(path.join(__dirname, '..', 'worker.mjs'), 'utf8');
    assert.match(worker, /net\.ramdonlatam\.catalogos/, 'worker.mjs debe anunciar el addon net.ramdonlatam.catalogos');
  });
});
