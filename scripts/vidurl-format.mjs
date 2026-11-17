#!/usr/bin/env node
/**
 * ¿En qué formato sirve los enlaces el espejo `/vidurl/<imdb>/` de la red de
 * PelisPedia/FlixLatam?
 *
 * Un plugin de Kino documenta que esa ruta sirve «la misma página que
 * embed69.org»: servidores por idioma, enlaces cifrados con AES-256-CBC y la
 * clave derivada de un PoW. Si eso es cierto, no hay proveedor nuevo que
 * escribir: basta con tratar /vidurl como espejo de respaldo del parser de
 * Embed69 que ya está en lib/embed69.js.
 *
 * Este script solo mira y cuenta, no descifra nada:
 *
 *   · ¿Está el PoW (POW_CHALLENGE / POW_DIFFICULTY / POW_SALT)?
 *   · ¿Cuántos enlaces vienen en el formato sin clave `a.<base64>.c`?
 *   · Un fragmento de `dataLink` para ver el formato real.
 *
 *   node scripts/vidurl-format.mjs
 *   node scripts/vidurl-format.mjs --url https://pelispedia.mov/vidurl/tt0903747-1x1/
 */

const DEFAULT_URL = 'https://pelispedia.mov/vidurl/tt0816692/';
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS) || 20_000;

const index = process.argv.indexOf('--url');
const target = index >= 0 ? process.argv[index + 1] : DEFAULT_URL;
if (!/^https?:\/\//i.test(target || '')) {
  console.error('Uso: node scripts/vidurl-format.mjs [--url <url del espejo>]');
  process.exitCode = 2;
} else {
  try {
    const res = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CatalogosPlus/sonda)',
        Referer: new URL(target).origin + '/',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const html = await res.text();
    const count = (re) => (html.match(re) || []).length;
    const at = html.indexOf('dataLink');
    const snippet = at < 0 ? '(sin dataLink)' : html.slice(at, at + 400).replace(/\s+/g, ' ');
    console.log(
      `HTTP ${res.status} · ${html.length} B · ` +
      `pow=${count(/POW_CHALLENGE|POW_DIFFICULTY|POW_SALT/g)} · ` +
      `dotted=${count(/a\.[A-Za-z0-9+/=_-]{20,}\.c/g)} · ` +
      `dataLink=${at >= 0} · sortedEmbeds=${count(/sortedEmbeds/g)}`
    );
    console.log(`snip=${snippet}`);
  } catch (err) {
    console.error(`Error: ${(err && err.message) || err}`);
    process.exitCode = 1;
  }
}
