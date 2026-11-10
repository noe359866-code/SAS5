'use strict';

/**
 * Tests de scripts/prerender-catalogs.mjs (sin red ni claves): se inyecta un
 * `resolve` falso y se comprueba qué archivos se escriben.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm, readdir } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const load = () => import('../scripts/prerender-catalogs.mjs');

async function withTmpDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'prerender-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('escribe solo los catálogos con resultados y respeta el formato del Worker', async () => {
  const { prerender } = await load();
  await withTmpDir(async (outDir) => {
    const result = await prerender({
      outDir,
      log: () => {},
      ids: ['cine_tendencias', 'tv_tendencias'],
      resolve: async (type, id) => (id === 'cine_tendencias'
        ? { metas: [{ id: 'tt1', type: 'movie', name: 'Uno' }], cacheMaxAge: 21600 }
        : { metas: [], cacheMaxAge: 60 }),
    });

    assert.deepEqual(result.written, ['cine_tendencias']);
    assert.deepEqual(result.empty, ['tv_tendencias']);
    assert.deepEqual(result.failed, []);

    const body = JSON.parse(await readFile(path.join(outDir, 'catalog', 'movie', 'cine_tendencias.json'), 'utf8'));
    assert.equal(body.metas.length, 1);
    assert.equal(body.metas[0].id, 'tt1');
    assert.equal(body.cacheMaxAge, 21600);

    // Un catálogo vacío NO deja archivo: así el Worker lo sigue resolviendo en caliente.
    assert.deepEqual(await readdir(path.join(outDir, 'catalog')), ['movie']);
  });
});

test('--dry-run no escribe nada pero informa de lo que haría', async () => {
  const { prerender } = await load();
  await withTmpDir(async (outDir) => {
    const result = await prerender({
      outDir,
      dryRun: true,
      log: () => {},
      ids: ['cine_top'],
      resolve: async () => ({ metas: [{ id: 'tt2', type: 'movie', name: 'Dos' }], cacheMaxAge: 60 }),
    });
    assert.deepEqual(result.written, ['cine_top']);
    assert.deepEqual(await readdir(outDir), []); // ni siquiera se crea catalog/
  });
});

test('un error al resolver un catálogo no aborta el resto', async () => {
  const { prerender } = await load();
  await withTmpDir(async (outDir) => {
    const result = await prerender({
      outDir,
      log: () => {},
      ids: ['cine_top', 'cine_popular'],
      concurrency: 1,
      resolve: async (type, id) => {
        if (id === 'cine_top') throw new Error('boom');
        return { metas: [{ id: 'tt3', type: 'movie', name: 'Tres' }], cacheMaxAge: 60 };
      },
    });
    assert.deepEqual(result.failed, ['cine_top']);
    assert.deepEqual(result.written, ['cine_popular']);
  });
});
