#!/usr/bin/env node
/**
 * Genera todos los archivos de marca a partir del maestro vectorial
 * `assets/brand/logo.svg` (el único que se edita a mano).
 *
 *   node scripts/brand-assets.mjs
 *
 * Salidas:
 *   assets/logo.png            512²  · logo del addon (manifest, og:image, nav)
 *   assets/brand/logo-1024.png 1024² · copia grande para prensa/README
 *   assets/icon-192.png        192²  · apple-touch-icon / PWA
 *   assets/icon-512.png        512²  · PWA
 *   assets/favicon.svg               · favicon vectorial (mismo dibujo)
 *   assets/og-cover.png        1200×630 · tarjeta para redes
 *   public/assets/*            copia de los PNG que sirve el edge
 *   lib/logoData.js            base64 de assets/logo.png (Worker embebido)
 *
 * Sin dependencias nuevas en el addon: `sharp` es devDependency y solo se usa
 * aquí y en `npm run build:web`. Si no está instalado, se avisa y se sale sin
 * tocar nada.
 */
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const at = (...p) => path.join(ROOT, ...p);

let sharp;
try {
  sharp = require('sharp');
} catch (_) {
  console.error('[brand-assets] Falta sharp (npm install). No se genera nada.');
  process.exit(1);
}

const MASTER = at('assets', 'brand', 'logo.svg');
const svg = await readFile(MASTER);
const render = (size) => sharp(svg, { density: 512 }).resize(size, size).png({ compressionLevel: 9, palette: false });

// ── Piezas de la tarjeta social ───────────────────────────────────────────
const OG_W = 1200;
const OG_H = 630;
const ogBackdrop = `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2=".75" y2="1">
      <stop offset="0" stop-color="#0d2f4d"/><stop offset=".5" stop-color="#081d31"/><stop offset="1" stop-color="#040e1a"/>
    </linearGradient>
    <radialGradient id="warm" cx=".76" cy=".5" r=".46">
      <stop offset="0" stop-color="#f5821f" stop-opacity=".26"/><stop offset="1" stop-color="#f5821f" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="cool" cx=".08" cy="0" r=".7">
      <stop offset="0" stop-color="#2f7fbf" stop-opacity=".2"/><stop offset="1" stop-color="#2f7fbf" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${OG_W}" height="${OG_H}" fill="url(#bg)"/>
  <rect width="${OG_W}" height="${OG_H}" fill="url(#cool)"/>
  <rect width="${OG_W}" height="${OG_H}" fill="url(#warm)"/>
  <rect x="0" y="${OG_H - 5}" width="${OG_W}" height="5" fill="#f5821f"/>
</svg>`;

// El texto va en SVG: no se descarga ninguna fuente (DejaVu Sans, del sistema).
const ogText = `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}">
  <g font-family="DejaVu Sans">
    <text x="0" y="316" font-size="88" font-weight="bold" letter-spacing="-3.4" fill="#ffffff">Ramdon<tspan fill="#f5821f">Latam</tspan></text>
    <text x="4" y="372" font-size="27" fill="#c8d4e0">Addon de Stremio · Español latino</text>
    <text x="4" y="418" font-size="23" fill="#8ea4b8">Catálogos por plataforma y estudio · Fichas completas · Gratis</text>
  </g>
</svg>`;

const outputs = [
  { file: at('assets', 'logo.png'), size: 512 },
  { file: at('assets', 'brand', 'logo-1024.png'), size: 1024 },
  { file: at('assets', 'icon-192.png'), size: 192 },
  { file: at('assets', 'icon-512.png'), size: 512 },
];
for (const { file, size } of outputs) {
  await render(size).toFile(file);
  console.log(`[brand-assets] ${path.relative(ROOT, file)} · ${size}²`);
}

// Favicon vectorial: el maestro sin el título accesible (no aplica en pestañas).
const faviconSvg = svg
  .toString('utf8')
  .replace(/\s*<title[^>]*>[\s\S]*?<\/title>/, '')
  .replace(/<svg([^>]*?)width="512" height="512"/, '<svg$1width="64" height="64"');
await writeFile(at('assets', 'favicon.svg'), faviconSvg, 'utf8');
console.log('[brand-assets] assets/favicon.svg');

// Tarjeta social 1200×630.
await mkdir(at('assets', 'brand'), { recursive: true });
await sharp(Buffer.from(ogBackdrop))
  .composite([
    { input: await render(232).toBuffer(), left: 872, top: 236 },
    { input: Buffer.from(ogText), left: 104, top: 0 },
  ])
  .png({ compressionLevel: 9 })
  .toFile(at('assets', 'og-cover.png'));
console.log('[brand-assets] assets/og-cover.png · 1200×630');

// Copias que sirve el edge sin ejecutar el Worker.
await mkdir(at('public', 'assets'), { recursive: true });
for (const name of ['logo.png', 'icon-192.png', 'icon-512.png', 'favicon.svg', 'og-cover.png']) {
  await copyFile(at('assets', name), at('public', 'assets', name));
}
console.log('[brand-assets] public/assets/*');

// Base64 del logo para el Worker (se sirve desde memoria, sin assets).
const logo = await readFile(at('assets', 'logo.png'));
const base64 = logo.toString('base64');
await writeFile(
  at('lib', 'logoData.js'),
  `'use strict';\n// Logo del Worker: mismo PNG que assets/logo.png (lo genera scripts/brand-assets.mjs).\nmodule.exports = { base64: '${base64}' };\n`,
  'utf8'
);
console.log(`[brand-assets] lib/logoData.js · ${(base64.length / 1024).toFixed(1)} KB en base64`);
