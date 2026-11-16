'use strict';

/**
 * Auditoría de escala: la parte que decide si un despliegue aguanta el plan
 * gratuito de Cloudflare Workers (100.000 invocaciones/día por cuenta).
 *
 * Se prueba sin red: se inyectan respuestas simuladas para comprobar cómo se
 * clasifica cada ruta (static asset / CDN / Worker) y cómo se proyecta el
 * consumo diario.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { classify, estimate, advise, DEFAULT_MIX } = require('../lib/scaleAudit.js');

/** Respuesta simulada: solo necesita `status` y `headers.get`. */
function response({ status = 200, runtime, cache } = {}) {
  const headers = new Map();
  if (runtime) headers.set('x-catalogos-runtime', runtime);
  if (cache) headers.set('x-catalogos-cache', cache);
  return { status, headers: { get: (name) => headers.get(name) || null } };
}

test('clasifica: sin la marca del Worker la ruta es gratis (static asset o CDN)', () => {
  // Un archivo de public/ no ejecuta el Worker: 0 invocaciones.
  assert.equal(classify('/catalog/movie/cine_tendencias.json', response({})), 'static');
  assert.equal(classify('/meta/movie/tt1160419.json', response({})), 'static');
  // La portada y el manifest general se pregeneran en public/ → static.
  assert.equal(classify('/', response({})), 'static');
  assert.equal(classify('/manifest.json', response({})), 'static');
  assert.equal(classify('/configure', response({})), 'static'); // configure/index.html
  // Con config personal solo puede ser gratis por una Cache Rule del CDN.
  assert.equal(classify('/abc123/catalog/movie/cine_tendencias.json', response({})), 'cdn');
  assert.equal(classify('/abc123/manifest.json', response({})), 'cdn');
});

test('clasifica: con la marca del Worker distingue memoria, borde y cálculo en vivo', () => {
  assert.equal(classify('/catalog/movie/cine_tendencias.json', response({ runtime: 'worker', cache: 'miss' })), 'worker');
  assert.equal(classify('/catalog/movie/cine_tendencias.json', response({ runtime: 'worker', cache: 'memory' })), 'worker-memory');
  assert.equal(classify('/catalog/movie/cine_tendencias.json', response({ runtime: 'worker', cache: 'stale' })), 'worker-memory');
  assert.equal(classify('/catalog/movie/cine_tendencias.json', response({ runtime: 'worker', cache: 'edge' })), 'worker-edge');
  // Sin marca fiable (despliegue antiguo) no se inventa: se asume Worker.
  assert.equal(classify('/catalog/movie/cine_tendencias.json', response({}), false), 'worker');
  // Un error no se cuenta como gratis.
  assert.equal(classify('/catalog/movie/cine_tendencias.json', response({ status: 502 })), 'error');
});

test('la proyección solo cuenta invocaciones lo que ejecuta el Worker', () => {
  const total = 500_000;
  // Todo estático salvo los streams: el 62 % de catálogos y el 15 % de fichas
  // no consumen cuota, así que 500K caben en las 100.000 del plan free.
  const best = estimate({
    total,
    servedBy: { catalog: 'static', meta: 'static', web: 'static', stream: 'worker', streamDebrid: 'worker' },
  });
  assert.equal(best.invocations, Math.round(total * (DEFAULT_MIX.stream + DEFAULT_MIX.streamDebrid)));
  assert.equal(best.ok, true);
  assert.equal(best.headroom, 100_000 - best.invocations);

  // Sin pregenerar ni Cache Rule, todo pasa por el Worker: no cabe.
  const worst = estimate({
    total,
    servedBy: { catalog: 'worker', meta: 'worker', web: 'worker', stream: 'worker', streamDebrid: 'worker' },
  });
  assert.equal(worst.invocations, total);
  assert.equal(worst.ok, false);
  assert.equal(worst.headroom, 100_000 - total);

  // La caché en memoria del isolate ahorra trabajo, pero NO invocaciones.
  const memory = estimate({
    total,
    servedBy: { catalog: 'worker-memory', meta: 'worker-memory', web: 'worker', stream: 'worker', streamDebrid: 'worker' },
  });
  assert.equal(memory.ok, false, 'la memoria del isolate no reduce invocaciones');
  assert.equal(memory.rows.find((row) => row.group === 'catalog').invocations, Math.round(total * DEFAULT_MIX.catalog));
});

test('los consejos avisan de workers.dev, de catálogos sin cachear y de la web sin pregenerar', () => {
  const tips = advise({
    host: 'catalogos-plus.mi-subdominio.workers.dev',
    servedBy: { catalog: 'worker', meta: 'worker', web: 'worker', stream: 'worker', streamDebrid: 'worker' },
    estimate: { invocations: 500_000, ok: false },
  });
  const joined = tips.join(' ');
  assert.match(joined, /workers\.dev/, 'avisa de que la Cache API no funciona en workers.dev');
  assert.match(joined, /Cache Rule/, 'recomienda la regla de caché del CDN');
  assert.match(joined, /static asset/, 'recomienda pregenerar las fichas');
  assert.match(joined, /500\.000|100\.000/, 'cuantifica el exceso sobre el plan');

  // Un despliegue bien montado no recibe ningún consejo.
  const clean = advise({
    host: 'catalogos.example.com',
    servedBy: { catalog: 'static', meta: 'static', web: 'static', stream: 'worker', streamDebrid: 'worker' },
    estimate: { invocations: 50_000, ok: true },
  });
  assert.deepEqual(clean, []);
});
