#!/usr/bin/env node
/**
 * Aprovisiona la KV de credenciales debrid (DEBRID_KV) y la deja enlazada en
 * wrangler.toml.
 *
 * Por qué existe: en un Worker sin KV, conectar debrid en /configure fallaba
 * con 503 «debrid_not_configured» para todo el mundo. El código ya cae en la
 * Cache API del Worker (lib/debridCredentials.js) para que el botón funcione
 * sin configurar nada, pero esa caché vive en cada datacenter de Cloudflare y
 * puede expulsarse: la KV es el almacén duradero recomendado.
 *
 * Este script la crea una sola vez (es idempotente) con la sesión de Wrangler
 * que ya uses (`npx wrangler login`, CLOUDFLARE_API_TOKEN, …) y escribe el
 * binding en wrangler.toml. Nunca aborta un despliegue: si no hay sesión o
 * faltan permisos, avisa y sale con 0 —el Worker sigue funcionando con la
 * Cache API—. Con `--strict` sí falla (útil para comprobar la configuración).
 *
 * Uso: node scripts/debrid-kv.mjs [--strict] [--dry-run]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOML = path.join(ROOT, 'wrangler.toml');
const BINDING = 'DEBRID_KV';

const argv = process.argv.slice(2);
const strict = argv.includes('--strict');
const dryRun = argv.includes('--dry-run');

// Quita los códigos de color que Wrangler imprime incluso con NO_COLOR.
const stripAnsi = (text) => String(text).replace(/\u001b\[[0-9;]*m/g, '');

function warn(message) {
  process.stderr.write(`[debrid-kv] ${stripAnsi(message)}\n`);
}

function fail(message) {
  if (strict) {
    warn(message);
    process.exit(1);
  }
  warn(`${message}\n[debrid-kv] Se sigue con la Cache API del Worker: conectar funciona, pero no es duradero. Crea la KV a mano con «npx wrangler kv namespace create DEBRID_KV».`);
  process.exit(0);
}

/** Ejecuta Wrangler y devuelve su salida, o { __error } si falla. */
function wrangler(args) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  try {
    return execFileSync(npx, ['wrangler', ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false' },
    });
  } catch (error) {
    const detail = [error.stdout, error.stderr].filter(Boolean).join(' ').trim();
    return { __error: stripAnsi(detail) || error.message };
  }
}

/** Primer JSON que aparezca en la salida de Wrangler (o null). */
function parseJson(stdout) {
  if (typeof stdout !== 'string') return null;
  const start = stdout.search(/[[{]/);
  if (start === -1) return null;
  try {
    return JSON.parse(stdout.slice(start));
  } catch (_) {
    return null;
  }
}

function readToml() {
  try {
    return fs.readFileSync(TOML, 'utf8');
  } catch (_) {
    return null;
  }
}

/**
 * Localiza el bloque [[kv_namespaces]] (comentado o no). Devuelve índices de
 * línea { start, end } —con start -1 si el fichero no tiene ninguno— y si el
 * bloque declara nuestro binding.
 */
function findBlock(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*(?:#\s*)?\[\[kv_namespaces\]\]/.test(lines[i])) continue;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*(?:#\s*)?\[/.test(lines[j])) { end = j; break; }
    }
    return {
      start: i,
      end,
      hasBinding: /binding\s*=\s*"DEBRID_KV"/.test(lines.slice(i, end).join('\n')),
      commented: /^\s*#/.test(lines[i]),
    };
  }
  return { start: -1, end: lines.length, hasBinding: false, commented: false };
}

/** Devuelve el TOML con el binding ya puesto, o null si ya estaba enlazado. */
export function writeBinding(toml, namespaceId) {
  const lines = toml.split('\n');
  const block = findBlock(lines);
  const blockLines = ['[[kv_namespaces]]', `binding = "${BINDING}"`, `id = "${namespaceId}"`];
  if (block.start === -1) {
    return [...lines, '', ...blockLines, ''].join('\n');
  }
  const alreadyBound = block.hasBinding
    && !block.commented
    && lines.slice(block.start, block.end).some((line) => /^\s*id\s*=\s*"[^"]+"/.test(line));
  if (alreadyBound) return null;
  // Si el bloque era de otro binding, se conserva detrás del nuestro.
  const keepTail = block.hasBinding ? [] : lines.slice(block.start, block.end);
  return [...lines.slice(0, block.start), ...blockLines, ...keepTail, ...lines.slice(block.end)].join('\n');
}

function main() {
  const toml = readToml();
  if (toml === null) fail(`No se encuentra ${path.relative(ROOT, TOML)}.`);

  // 0. Si wrangler.toml ya enlaza la KV, no hace falta ni sesión de
  //    Cloudflare: el despliegue nunca debe depender de este script.
  if (writeBinding(toml, 'sondeo') === null) {
    process.stdout.write(`[debrid-kv] ${path.relative(ROOT, TOML)} ya enlaza ${BINDING}. Nada que hacer.\n`);
    return;
  }

  // 1. ¿Ya existe el namespace en la cuenta?
  const listed = wrangler(['kv', 'namespace', 'list']);
  if (typeof listed !== 'string') {
    const detail = (listed && listed.__error ? listed.__error : 'sin salida').split('\n')[0];
    fail(`No se pudo listar los namespaces KV (${detail}). Inicia sesión con «npx wrangler login» o define CLOUDFLARE_API_TOKEN.`);
    return;
  }
  const namespaces = parseJson(listed);
  if (!Array.isArray(namespaces)) {
    fail('Wrangler no devolvió la lista de namespaces KV en un formato reconocible.');
    return;
  }
  let namespaceId = (namespaces.find((item) => item && item.title === BINDING) || {}).id;

  // 2. Si no existe, crearlo.
  if (!namespaceId) {
    if (dryRun) {
      process.stdout.write(`[debrid-kv] --dry-run: se crearía el namespace ${BINDING} y se enlazaría en ${path.relative(ROOT, TOML)}.\n`);
      return;
    }
    const created = wrangler(['kv', 'namespace', 'create', BINDING]);
    if (typeof created !== 'string') {
      const detail = (created && created.__error ? created.__error : 'sin salida').split('\n')[0];
      fail(`No se pudo crear el namespace KV ${BINDING} (${detail}).`);
      return;
    }
    namespaceId = (parseJson(created) || {}).id;
    if (!namespaceId) {
      fail(`Wrangler creó el namespace pero no se pudo leer su id: ${created.trim().slice(0, 200)}`);
      return;
    }
  }

  // 3. Enlazarlo en wrangler.toml.
  const next = writeBinding(toml, namespaceId);
  if (next === null) {
    process.stdout.write(`[debrid-kv] ${path.relative(ROOT, TOML)} ya enlaza ${BINDING} (${namespaceId}).\n`);
    return;
  }
  if (dryRun) {
    process.stdout.write(`[debrid-kv] --dry-run: se enlazaría el namespace ${namespaceId} en ${path.relative(ROOT, TOML)}.\n`);
    return;
  }
  fs.writeFileSync(TOML, next);
  process.stdout.write(`[debrid-kv] KV ${BINDING} (${namespaceId}) enlazada en ${path.relative(ROOT, TOML)}. Falta el secreto: npx wrangler secret put DEBRID_ENCRYPTION_KEY\n`);
}

// Solo se ejecuta al lanzarlo directamente: así los tests pueden importar
// writeBinding sin tocar la red ni wrangler.toml.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
