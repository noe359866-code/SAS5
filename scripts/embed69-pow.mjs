#!/usr/bin/env node
/**
 * Precalienta el PoW de Embed69.
 *
 * Embed69 exige resolver una prueba de trabajo (SHA-256 con `difficulty`
 * ceros) para descifrar los enlaces. Con dificultad 5 son ~126.000 hashes y
 * ~9 s de CPU: en un Worker del plan free (10 ms) eso no cabe, y hacerlo en
 * cada petición agotaría la cuota.
 *
 * Este script resuelve el PoW UNA vez y deja el resultado listo para que el
 * Worker no calcule nada:
 *
 *   npm run embed69:pow                    # imprime el resultado (con dificultad real)
 *   npm run embed69:pow -- --imdb tt0903747 --season 1 --episode 1
 *   npm run embed69:pow -- --kv            # lo sube a la KV (EMBED69_POW)
 *
 * Formato de salida (se pega en la variable EMBED69_POW o en la KV con esa clave):
 *   <challenge>|<difficulty>|<salt>|<hex de la clave de 32 bytes>
 *
 * El challenge rota cada pocos minutos, así que esto se ejecuta en un cron
 * (GitHub Actions) o cuando el proveedor deja de responder. Si no hay PoW
 * precalentado, el Worker lo resuelve como máximo una vez por isolate y lo
 * cachea; con `EMBED69_POW=off` el proveedor simplemente no se consulta.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const config = require('../lib/config.js');

const DEFAULT_IMDB = 'tt0816692'; // Interstellar

function parseArgs(argv) {
  const options = { imdb: DEFAULT_IMDB, season: null, episode: null, kv: false, base: null, timeout: 15000 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => argv[++i];
    if (arg === '--imdb') options.imdb = value();
    else if (arg.startsWith('--imdb=')) options.imdb = arg.split('=')[1];
    else if (arg === '--season') options.season = Number(value());
    else if (arg === '--episode') options.episode = Number(value());
    else if (arg === '--base') options.base = value();
    else if (arg === '--kv') options.kv = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
  }
  return options;
}

async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Bytes(input) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Uso: npm run embed69:pow [-- --imdb tt1234567] [-- --season 1 --episode 2] [-- --kv]');
    return;
  }

  const base = String(options.base || config.embed69Url || 'https://embed69.org').replace(/\/+$/, '');
  const path = options.season && options.episode
    ? `/f/${options.imdb}-${options.season}x${options.episode}/`
    : `/f/${options.imdb}/`;
  const url = `${base}${path}`;
  console.log(`Ficha de prueba: ${url}`);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; CatalogosPlus/1.5; +https://github.com/noe359866-code/SAS5)',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'es-ES,es;q=0.9',
    },
    signal: AbortSignal.timeout(options.timeout),
  });
  if (!response.ok) {
    console.error(`La ficha respondió ${response.status}. ¿Cloudflare o cambio de dominio?`);
    process.exitCode = 1;
    return;
  }
  const html = await response.text();
  const challenge = /POW_CHALLENGE\s*=\s*'([^']+)'/.exec(html);
  const difficulty = /POW_DIFFICULTY\s*=\s*(\d+)/.exec(html);
  const salt = /POW_SALT\s*=\s*'([^']+)'/.exec(html);

  if (!challenge || !difficulty || !salt) {
    console.error('No hay PoW en la página.');
    console.error(html.trim().startsWith('<')
      ? 'Llegó HTML, pero sin los marcadores esperados: la página cambió de formato.'
      : `Respuesta: ${html.slice(0, 120)}`);
    process.exitCode = 1;
    return;
  }

  const info = { challenge: challenge[1], difficulty: Number(difficulty[1]), salt: salt[1] };
  console.log(`PoW: dificultad ${info.difficulty} · challenge ${info.challenge.slice(0, 12)}…`);

  const started = Date.now();
  const target = '0'.repeat(info.difficulty);
  let found = -1;
  for (let i = 0; i < 20_000_000; i++) {
    if ((await sha256Hex(`${info.challenge}${i}`)).startsWith(target)) {
      found = i;
      break;
    }
  }
  if (found < 0) {
    console.error('No se encontró solución (demasiadas iteraciones).');
    process.exitCode = 1;
    return;
  }
  const key = await sha256Bytes(`${info.challenge}${found}${info.salt}`);
  const hex = [...key].map((b) => b.toString(16).padStart(2, '0')).join('');
  const ms = Date.now() - started;
  console.log(`Resuelto en ${found + 1} iteraciones · ${ms} ms`);

  const payload = `${info.challenge}|${info.difficulty}|${info.salt}|${hex}`;
  console.log('\nEMBED69_POW=' + payload);
  console.log('\n(Es lo que debe leer el Worker; el challenge caduca en minutos.)');

  if (options.kv) {
    const { execFileSync } = await import('node:child_process');
    try {
      execFileSync('npx', ['wrangler', 'kv', 'key', 'put', 'EMBED69_POW', '--value', payload, '--remote'], {
        stdio: 'inherit',
      });
      console.log('Subido a la KV como EMBED69_POW.');
    } catch (err) {
      console.error('No se pudo escribir en la KV:', (err && err.message) || err);
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error('Falló:', (err && err.message) || err);
  process.exitCode = 1;
});
