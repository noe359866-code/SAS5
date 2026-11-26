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

  test('el secreto del proxy se configura fuera del archivo versionado', () => {
    assert.match(toml, /wrangler secret put M3U_PROXY_SECRET/);
    const active = toml.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');
    assert.ok(!/^M3U_PROXY_SECRET\s*=/m.test(active), 'el secreto no debe estar en [vars]');
  });

  test('la marca pública del worker coincide con su nombre', () => {
    const worker = fs.readFileSync(path.join(__dirname, '..', 'worker.mjs'), 'utf8');
    assert.match(worker, /net\.ramdonlatam\.catalogos/, 'worker.mjs debe anunciar el addon net.ramdonlatam.catalogos');
  });
});
