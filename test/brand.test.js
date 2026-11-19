'use strict';

/**
 * Marca: el logo que sirve el Worker, los derivados del maestro vectorial y el
 * manifest web. Estas pruebas no dibujan nada: comprueban que los archivos
 * existen, que pesan lo razonable y que `lib/logoData.js` es exactamente el
 * PNG de `assets/logo.png`. Si alguien cambia el logo y olvida regenerar el
 * base64, el addon serviría un logo distinto al de la web y aquí se ve.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const at = (...parts) => path.join(ROOT, ...parts);
const read = (...parts) => fs.readFileSync(at(...parts));
const exists = (...parts) => fs.existsSync(at(...parts));

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Ancho y alto de un PNG, leídos del bloque IHDR (sin dependencias). */
function pngSize(buffer) {
  assert.ok(buffer.subarray(0, 8).equals(PNG_SIGNATURE), 'no es un PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test('marca: el maestro vectorial existe y dibuja la baraja de tres fichas', () => {
  const svg = read('assets', 'brand', 'logo.svg').toString('utf8');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /viewBox="0 0 512 512"/);
  // Tres rectángulos de ficha (los tres degradados) y el botón de reproducción.
  assert.equal((svg.match(/<rect x="\d+" y="\d+" width="\d+" height="\d+" rx="54"/g) || []).length, 3);
  assert.match(svg, /fill="#08192a" d="M232 223/);
  // Paleta de la marca, la misma en todos los derivados.
  for (const color of ['#123a5c', '#f5821f', '#e05f0b']) {
    assert.ok(svg.includes(color), `falta el color ${color} en el maestro`);
  }
  assert.equal(svg.includes('<script'), false, 'el logo no lleva scripts');
  assert.equal(svg.includes('http://'), true); // solo el namespace xmlns
  assert.equal(/href=/.test(svg), false, 'el logo no referencia recursos externos');
});

test('marca: logo del addon 512² y derivados en los tamaños correctos', () => {
  const logo = read('assets', 'logo.png');
  assert.deepEqual(pngSize(logo), { width: 512, height: 512 });
  assert.ok(logo.length < 120 * 1024, `el logo pesa ${logo.length} B`);

  const sizes = { 'icon-192.png': 192, 'icon-512.png': 512 };
  for (const [name, side] of Object.entries(sizes)) {
    assert.deepEqual(pngSize(read('assets', name)), { width: side, height: side }, name);
  }
  // La tarjeta social mantiene la proporción 1200×630 de Open Graph.
  const og = pngSize(read('assets', 'og-cover.png'));
  assert.deepEqual(og, { width: 1200, height: 630 });

  const favicon = read('assets', 'favicon.svg').toString('utf8');
  assert.match(favicon, /width="64" height="64"/);
});

test('marca: lib/logoData.js es el mismo PNG que assets/logo.png', () => {
  const { base64 } = require('../lib/logoData');
  const embedded = Buffer.from(base64, 'base64');
  assert.ok(embedded.equals(read('assets', 'logo.png')),
    'lib/logoData.js está desincronizado: ejecuta node scripts/brand-assets.mjs');
});

test('marca: el edge sirve las mismas copias que el servidor', () => {
  for (const name of ['logo.png', 'icon-192.png', 'icon-512.png', 'favicon.svg', 'og-cover.png']) {
    assert.ok(exists('public', 'assets', name), `falta public/assets/${name}`);
    assert.ok(read('public', 'assets', name).equals(read('assets', name)),
      `public/assets/${name} no coincide con assets/${name}`);
  }
});

test('marca: site.webmanifest apunta a los iconos reales y usa el azul noche', () => {
  const raw = read('public', 'site.webmanifest').toString('utf8');
  const manifest = JSON.parse(raw);
  assert.equal(manifest.short_name, 'RamdonLatam');
  assert.equal(manifest.name, 'RamdonLatam · Addon de Stremio');
  assert.equal(manifest.theme_color, '#060f1a');
  assert.equal(manifest.background_color, '#060f1a');
  assert.equal(manifest.lang, 'es');
  assert.equal(manifest.start_url, '/');
  for (const icon of manifest.icons) {
    const file = icon.src.replace(/^\/assets\//, '');
    assert.ok(exists('assets', file), `el icono ${icon.src} no existe`);
    assert.ok(icon.sizes === 'any' || pngSize(read('assets', file)).width === Number(icon.sizes.split('x')[0]));
  }
});

test('marca: la web y el addon comparten el nombre y los activos nuevos', () => {
  const { renderHome } = require('../lib/homePage');
  const html = renderHome({ origin: 'https://addon.example', host: 'addon.example' });
  assert.match(html, /<link rel="apple-touch-icon" href="\/assets\/icon-192.png" \/>/);
  assert.match(html, /<link rel="manifest" href="\/site\.webmanifest" \/>/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/);
  // El favicon ya no es el PNG grande: hay SVG y PNG de 192.
  assert.equal(html.includes('<link rel="icon" href="/assets/logo.png"'), false);
});
