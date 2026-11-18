'use strict';

/**
 * Lee el bloque `[vars]` de `wrangler.toml`.
 *
 * ¿Por qué? `MIRROR_ORIGINS` y `STATIC_SHORTCUTS` se configuran en
 * `wrangler.toml` para el Worker, pero los scripts que generan los archivos
 * estáticos (`build:web`, `prerender`) corren en Node y solo miran variables
 * de entorno. Sin esto, la página `/configure` pregenerada saldría con un solo
 * origen mientras el Worker ya conoce dos, y el reparto de cuota no llegaría a
 * los usuarios que instalan desde la web estática.
 *
 * Solo se leen las variables que falten en el entorno: lo que se exporte en la
 * shell (o en GitHub Actions) siempre tiene prioridad.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * Extrae las variables de un texto TOML (solo el bloque `[vars]`).
 *
 * Es un lector deliberadamente pequeño: claves planas con valor entre
 * comillas, que es como se escriben las `[vars]` de `wrangler.toml`. Ignora
 * comentarios y cualquier otra sección.
 *
 * @param {string} text contenido del archivo
 * @returns {Record<string, string>}
 */
function parseVars(text) {
  const vars = {};
  let inVars = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) {
      inVars = /^\[vars\]$/i.test(line);
      continue;
    }
    if (!inVars) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/);
    if (!match) continue;
    const value = match[2] !== undefined
      ? match[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      : match[3];
    vars[match[1]] = value;
  }
  return vars;
}

/**
 * Lee `wrangler.toml`. Si no existe, devuelve `{}` en vez de romper el script
 * (Vercel o un checkout parcial no tienen por qué traerlo).
 *
 * @param {string} [file]
 * @returns {Record<string, string>}
 */
function readWranglerVars(file = path.join(__dirname, '..', 'wrangler.toml')) {
  try {
    return parseVars(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return {};
  }
}

/**
 * Copia al entorno las variables pedidas que solo estén en `wrangler.toml`.
 *
 * @param {string[]} names
 * @param {object} [options]
 * @param {string} [options.file] ruta del `wrangler.toml`
 * @param {object} [options.env] entorno destino (por defecto `process.env`)
 * @returns {string[]} variables aplicadas (para poder informarlo)
 */
function applyWranglerVars(names, options = {}) {
  const env = options.env || process.env;
  const vars = readWranglerVars(options.file);
  const applied = [];
  for (const name of names || []) {
    if (env[name] !== undefined && env[name] !== '') continue;
    if (vars[name] === undefined || vars[name] === '') continue;
    env[name] = vars[name];
    applied.push(name);
  }
  return applied;
}

module.exports = { applyWranglerVars, parseVars, readWranglerVars };
