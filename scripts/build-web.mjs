#!/usr/bin/env node
/**
 * Pregenera la web (portada y /configure) como HTML estático.
 *
 * ¿Por qué? En el plan gratuito de Cloudflare Workers la cuota es de
 * 100.000 peticiones/día por cuenta y cada petición que ejecuta el Worker la
 * consume. Las peticiones a *static assets* ([assets] en wrangler.toml) son
 * gratuitas e ilimitadas: si `/` y `/configure` existen como archivos en
 * public/, las visitas humanas (la mayoría del tráfico) dejan de gastar cuota
 * y el Worker queda solo para la API del addon (manifest, streams, catálogos
 * no pregenerados), que además se puede cachear en el edge con Cache Rules.
 *
 * Uso:
 *   PUBLIC_ORIGIN=https://tu-dominio.example node scripts/build-web.mjs
 *
 * PUBLIC_ORIGIN es la URL pública definitiva del Worker (subdominio
 * workers.dev o dominio propio): se hornea en los enlaces absolutos
 * (manifest, botones de instalar, og:url). Sin esa variable el script no
 * escribe nada y el Worker sigue sirviendo la web en caliente (SSR), como
 * siempre.
 *
 * Las tendencias del muro de pósters se hornean en el HTML: se renuevan en
 * cada despliegue (`npm run deploy` encadena este script). Sin clave de TMDB
 * no se escribe nada, para no sustituir una web buena por una vacía.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const libPath = (name) => path.join(ROOT, 'lib', name);

const origin = String(process.env.PUBLIC_ORIGIN || process.env.ADDON_BASE_URL || '').trim().replace(/\/+$/, '');
if (!origin) {
  console.log('[build-web] Sin PUBLIC_ORIGIN ni ADDON_BASE_URL: no se pregenera la web (el Worker la servirá en caliente).');
  process.exit(0);
}
let host;
try {
  host = new URL(origin).host;
} catch (_) {
  console.error(`[build-web] PUBLIC_ORIGIN no es una URL válida: ${origin}`);
  process.exit(1);
}

const config = require(libPath('config.js'));
const core = require(libPath('core.js'));
const tmdbClient = require(libPath('tmdb.js'));
const { branding } = require(libPath('branding.js'));
const { renderHome } = require(libPath('homePage.js'));
const { renderConfigure } = require(libPath('configurePage.js'));

let trending = { movies: null, series: null, anime: null };
if (config.tmdbConfigured) {
  try {
    [trending.movies, trending.series, trending.anime] = await Promise.all([
      tmdbClient.trending('movie', config.tmdbLanguage),
      tmdbClient.trending('tv', config.tmdbLanguage),
      tmdbClient.animeTrending(config.tmdbLanguage),
    ]);
  } catch (err) {
    console.error('[build-web] Tendencias ->', err && err.message);
  }
}

const moviesList = trending.movies && Array.isArray(trending.movies.results)
  ? trending.movies.results
  : (Array.isArray(trending.movies) ? trending.movies : []);
if (!moviesList.length) {
  console.log('[build-web] Sin tendencias de TMDB: se pregenera manifest/branding estático y la web seguirá en SSR.');
  const outDir = path.join(ROOT, 'public');
  await mkdir(path.join(outDir, 'internal'), { recursive: true });
  const manifestJson = JSON.stringify(core.buildManifest(`${origin}/assets/logo.png`));
  const brandingJson = JSON.stringify(await branding(config.tmdbLanguage));
  await writeFile(path.join(outDir, 'manifest.json'), manifestJson, 'utf8');
  await writeFile(path.join(outDir, 'internal', 'branding.json'), brandingJson, 'utf8');
  console.log(`[build-web] manifest.json (${(Buffer.byteLength(manifestJson) / 1024).toFixed(1)} KB) e internal/branding.json generados.`);
  process.exit(0);
}

const home = renderHome({
  origin,
  host,
  trendingMovies: trending.movies,
  trendingSeries: trending.series,
  trendingAnime: trending.anime,
  apiStatus: { tmdb: config.tmdbConfigured },
});
const configure = renderConfigure({
  origin,
  host,
  trendingMovies: trending.movies,
  trendingSeries: trending.series,
});
const manifestJson = JSON.stringify(core.buildManifest(`${origin}/assets/logo.png`));
const brandingJson = JSON.stringify(await branding(config.tmdbLanguage));

const outDir = path.join(ROOT, 'public');
await mkdir(path.join(outDir, 'configure'), { recursive: true });
await mkdir(path.join(outDir, 'internal'), { recursive: true });
await writeFile(path.join(outDir, 'index.html'), home, 'utf8');
await writeFile(path.join(outDir, 'configure', 'index.html'), configure, 'utf8');
await writeFile(path.join(outDir, 'manifest.json'), manifestJson, 'utf8');
await writeFile(path.join(outDir, 'internal', 'branding.json'), brandingJson, 'utf8');
console.log(
  `[build-web] Web y assets estáticos pregenerados para ${origin}: ` +
  `index.html ${(Buffer.byteLength(home) / 1024).toFixed(0)} KB · ` +
  `configure/index.html ${(Buffer.byteLength(configure) / 1024).toFixed(0)} KB · ` +
  `manifest.json ${(Buffer.byteLength(manifestJson) / 1024).toFixed(1)} KB`
);
