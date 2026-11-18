'use strict';

/**
 * `public/_redirects`: rutas que el Worker resolvía gastando una invocación.
 *
 * En `*.workers.dev` una ruta como `/configure/` (con barra) no coincide con
 * ningún archivo, así que ejecutaba el Worker… para devolver un 404.
 * `_redirects` se evalúa antes de los assets y del Worker: 0 invocaciones.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { MAX_REDIRECTS, STATIC_ROUTES, buildRedirects, renderRedirects } = require('../lib/edgeRoutes');

test('las barras finales que no existen como archivo se resuelven en el borde', () => {
  const { rules, dropped } = buildRedirects();
  assert.equal(dropped, 0);
  // /watch ya no existe: eliminado junto con la web de reproductor.
  assert.equal(rules.find((rule) => rule.from === '/watch'), undefined);
  // Las barras finales que tampoco existen como archivo.
  assert.ok(rules.some((rule) => rule.from === '/configure/' && rule.to === '/configure'));
  assert.ok(rules.some((rule) => rule.from === '/manifest.json/' && rule.to === '/manifest.json'));
});

test('ninguna configuración se queda sin regla para la barra final del manifest', () => {
  // Ya no hace falta una regla por segmento: la dinámica las cubre todas.
  const { rules } = buildRedirects({ configs: [] });
  const dynamic = rules.find((rule) => rule.from === '/:path/manifest.json/');
  assert.ok(dynamic, 'sin la regla dinámica haría falta una por usuario');
  assert.equal(dynamic.to, '/:path/manifest.json');
  assert.equal(dynamic.status, 301);
  // Y ninguna regla estática llega a gastar el cupo por usuario.
  assert.equal(rules.filter((rule) => rule.from.includes(':path')).length, 1);
});

test('nunca se pasa del tope de reglas de Cloudflare (2.000 + 100)', () => {
  const configs = Array.from({ length: 3000 }, (_, i) => ({
    segment: `seg${String(i).padStart(6, '0')}`,
    cfg: { region: 'MX' },
  }));
  const { rules, dropped } = buildRedirects({ configs });
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
  assert.ok(first.includes('/configure/ /configure 301'));
  assert.equal(renderRedirects(rules, first), first, 'regenerar no debe duplicar el bloque');
  // Y sin contenido previo también funciona.
  assert.ok(renderRedirects(rules, '').includes('/configure/ /configure 301'));
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

test('el «Configurar» de Stremio se manda al configurador pregenerado de su región', () => {
  const { rules } = buildRedirects({
    configs: [
      { segment: 'AAAbbbccc', cfg: { region: 'MX' } },
      { segment: 'DDDeeeefff', cfg: { region: 'NI' } },
      { segment: 'EEEfffggg', cfg: { region: 'XX' } }, // región inválida: sin regla
    ],
    regions: new Set(['MX', 'NI', 'US', 'ES']),
  });
  const configure = rules.filter((rule) => rule.from.endsWith('/configure'));
  assert.deepEqual(
    configure.map((rule) => `${rule.from} ${rule.to} ${rule.status}`).sort(),
    ['/AAAbbbccc/configure /configure/r/MX 302', '/DDDeeeefff/configure /configure/r/NI 302']
  );
  // 302 (no 301): si el mapa de regiones cambia, el navegador no lo memoriza.
  assert.equal(configure[0].status, 302);
});


test('todas las reglas del borde se quedan dentro del cupo de Cloudflare', () => {
  // 2.000 estáticas + 100 dinámicas. Se comprueba con un caso realista:
  // 200 configuraciones conocidas.
  const { rules, dropped } = buildRedirects({
    configs: Array.from({ length: 200 }, (_, i) => ({ segment: `seg${String(i).padStart(8, '0')}`, cfg: { region: 'MX' } })),
    regions: new Set(['MX']),
  });
  assert.equal(dropped, 0);
  assert.ok(rules.length < 300, `solo ${rules.length} reglas con 200 configuraciones`);
  assert.equal(rules.filter((rule) => rule.from.includes(':path')).length, 1, 'una sola regla dinámica');
});

test('atajos de borde: una config con el idioma y la región por defecto usa los archivos compartidos', () => {
  const { rules, shortcuts } = buildRedirects({
    configs: [
      { segment: 'AAA111', cfg: { lang: 'es', region: 'NI' } },
      { segment: 'BBB222', cfg: { region: 'NI' } },                 // idioma implícito = por defecto
      { segment: 'CCC333', cfg: { lang: 'es', region: 'MX' } },     // otra región: sin atajo
      { segment: 'DDD444', cfg: { lang: 'en', region: 'NI' } },     // otro idioma: sin atajo
      { segment: 'EEE555', cfg: { lang: 'es', region: 'NI', debridId: 'a'.repeat(32) } },
    ],
    defaults: { lang: 'es', region: 'NI' },
  });
  assert.equal(shortcuts, 2);
  const made = rules.map((rule) => `${rule.from} ${rule.to} ${rule.status}`);
  assert.ok(made.includes('/AAA111/catalog/* /catalog/:splat 301'));
  assert.ok(made.includes('/AAA111/meta/* /meta/:splat 301'));
  assert.ok(made.includes('/BBB222/catalog/* /catalog/:splat 301'));
  // Nada de tocar streams, manifest ni configurador de esas configs.
  for (const rule of rules) {
    if (!rule.from.includes('/catalog/') && !rule.from.includes('/meta/')) continue;
    assert.ok(!rule.from.includes('/stream/'), 'los streams nunca se atajan');
    assert.ok(!rule.from.includes('/manifest'), 'el manifest es de cada usuario');
  }
  // Las que cambian idioma o región no llevan atajo; el debrid tampoco.
  for (const segment of ['CCC333', 'DDD444', 'EEE555']) {
    assert.equal(rules.some((rule) => rule.from.startsWith(`/${segment}/catalog/`)), false, segment);
  }
});

test('los atajos no se generan sin defaults ni cuando se desactivan', () => {
  const configs = [{ segment: 'AAA111', cfg: { lang: 'es', region: 'NI' } }];
  assert.equal(buildRedirects({ configs }).shortcuts, 0);
  assert.equal(buildRedirects({ configs, defaults: { lang: 'es', region: 'NI' }, shortcuts: false }).shortcuts, 0);
  // Sin región o idioma de referencia no hay atajos (no se adivina).
  assert.equal(buildRedirects({ configs, defaults: { lang: 'es' } }).shortcuts, 0);
});

test('los atajos respetan el cupo de 100 reglas dinámicas de Cloudflare', () => {
  const configs = Array.from({ length: 200 }, (_, i) => ({
    segment: `seg${String(i).padStart(6, '0')}`,
    cfg: { lang: 'es', region: 'NI' },
  }));
  const { rules } = buildRedirects({ configs, defaults: { lang: 'es', region: 'NI' } });
  // 1 regla dinámica fija (manifest con barra) + 2 por configuración ≤ 100.
  const dynamic = rules.filter((rule) => rule.from.includes('*') || rule.from.includes(':path'));
  assert.ok(dynamic.length <= 100, `demasiadas dinámicas: ${dynamic.length}`);
  // Se atienden las primeras configuraciones y se avisa del resto en el log.
  assert.ok(rules.some((rule) => rule.from === '/seg000000/catalog/*'));
});

test('un segmento raro nunca entra en una regla de _redirects', () => {
  const { rules, shortcuts } = buildRedirects({
    configs: [
      { segment: 'ok_seg-1', cfg: { lang: 'es', region: 'NI' } },
      { segment: '../etc/passwd', cfg: { lang: 'es', region: 'NI' } },
      { segment: 'con espacio', cfg: { lang: 'es', region: 'NI' } },
    ],
    defaults: { lang: 'es', region: 'NI' },
  });
  assert.equal(shortcuts, 1);
  // Solo los atajos llevan el segmento: ninguno con espacios, puntos o `..`.
  for (const rule of rules.filter((item) => item.from.includes('*'))) {
    assert.ok(!/[ .]/.test(rule.from) && !rule.from.includes('..'), `regla insegura: ${rule.from}`);
  }
});
