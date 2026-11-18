'use strict';

// Prueba el addon Express con las webs reales; no abre los externalUrl, no
// toca el Worker ni requiere credenciales de TMDB.
const assert = require('node:assert/strict');
const { once } = require('node:events');

process.env.STREAMFLIX_NODE_PROVIDERS = 'pelisflixhd,seriesflix';
const app = require('../api/index');

const controls = [
  ['PelisflixHD / Matrix (1999)', 'movie', 'tt0133093', 'https://pelisflixhd.love/pelicula/the-matrix-zgdg/'],
  ['SeriesFlix / Breaking Bad T1E2', 'series', 'tt0903747:1:2', 'https://seriesflixhd.boats/episodio/breaking-bad-zpya-1x2/'],
];

function log(title, result) {
  console.log(process.env.GITHUB_ACTIONS ? `::notice title=${title}::${result}` : `${title}: ${result}`);
}

async function main() {
  // Servidor efímero de prueba, sin vista previa pública.
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const json = async (path) => {
      const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(25_000) });
      assert.equal(response.headers.get('access-control-allow-origin'), '*');
      assert.equal(response.status, 200);
      return response.json();
    };
    const manifest = await json('/streamflix/manifest.json');
    assert.deepEqual(manifest.resources, ['stream']);
    for (const [title, type, id, expected] of controls) {
      try {
        const { streams } = await json(`/streamflix/stream/${type}/${encodeURIComponent(id)}.json`);
        const match = streams.some((stream) => stream.externalUrl === expected && !stream.url && !stream.behaviorHints?.proxyHeaders);
        log(title, match ? 'ficha exacta como enlace de navegador, no reproducción' : `sin ficha exacta (${streams.length} resultados)`);
        if (!match) process.exitCode = 1;
      } catch {
        log(title, 'no se pudo consultar el addon Node');
        process.exitCode = 1;
      }
    }
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

main().catch(() => { console.error('No se pudo comprobar el addon Node'); process.exitCode = 1; });
