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

// ── Fichas (metas) pregeneradas ───────────────────────────────────────────
// Cada `/meta/<tipo>/<id>.json` que existe en public/ es una petición que
// Cloudflare sirve como static asset: 0 invocaciones de las 100.000/día del
// plan gratuito. Se generan solo las de los títulos que están en catálogos.

test('las fichas de los títulos de los catálogos se pregeneran deduplicadas y con su tipo', async () => {
  const { prerender, prerenderMetas, catalogIds } = await load();
  await withTmpDir(async (outDir) => {
    // Dos catálogos que comparten un título: la ficha se escribe una sola vez.
    await prerender({
      outDir,
      log: () => {},
      ids: ['cine_tendencias', 'tv_tendencias'],
      resolve: async (type, id) => ({
        metas: [
          { id: 'tt9001', type: 'movie', name: 'Compartida' },
          { id: 'tt9002', type: type === 'movie' ? 'movie' : 'series', name: 'Otra' },
        ],
        cacheMaxAge: 21600,
      }),
    });

    const ids = await catalogIds(path.join(outDir, 'catalog'));
    assert.deepEqual(ids.sort((a, b) => `${a.type}${a.id}`.localeCompare(`${b.type}${b.id}`)), [
      { type: 'movie', id: 'tt9001' },
      { type: 'movie', id: 'tt9002' },
      { type: 'series', id: 'tt9001' },
      { type: 'series', id: 'tt9002' },
    ]);

    const result = await prerenderMetas({
      outDir,
      log: () => {},
      resolve: async (type, id) => ({ meta: { id, type, name: `Ficha ${id}` }, cacheMaxAge: 3600 }),
    });
    assert.equal(result.written.length, 4);
    assert.deepEqual(result.empty, []);
    assert.deepEqual(result.failed, []);

    const body = JSON.parse(await readFile(path.join(outDir, 'meta', 'series', 'tt9002.json'), 'utf8'));
    assert.equal(body.meta.id, 'tt9002');
    assert.equal(body.cacheMaxAge, 3600);
  });
});

test('las fichas respetan el tope y no escriben nada si el resolvedor falla', async () => {
  const { prerenderMetas } = await load();
  await withTmpDir(async (outDir) => {
    const ids = Array.from({ length: 10 }, (_, i) => ({ type: 'movie', id: `tt${1000 + i}` }));
    const capped = await prerenderMetas({
      outDir,
      log: () => {},
      ids,
      maxMetas: 3, // tope para no acercarse a los 20.000 archivos de Cloudflare Free
      resolve: async (type, id) => ({ meta: { id, type, name: 'x' }, cacheMaxAge: 60 }),
    });
    assert.equal(capped.written.length, 3);

    const broken = await prerenderMetas({
      outDir,
      log: () => {},
      ids: [{ type: 'movie', id: 'tt2000' }],
      resolve: async () => { throw new Error('TMDB caído'); },
    });
    assert.deepEqual(broken.written, []);
    assert.deepEqual(broken.failed, ['movie/tt2000']);

    // Una ficha vacía no deja archivo: el Worker la sigue resolviendo en vivo.
    const empty = await prerenderMetas({
      outDir,
      log: () => {},
      ids: [{ type: 'movie', id: 'tt2001' }],
      resolve: async () => ({ meta: null }),
    });
    assert.deepEqual(empty.empty, ['movie/tt2001']);
    assert.deepEqual(empty.written, []);
  });
});

test('countFiles cuenta el árbol para no superar el tope de archivos del plan free', async () => {
  const { countFiles } = await load();
  await withTmpDir(async (outDir) => {
    const { mkdir, writeFile } = require('node:fs/promises');
    await mkdir(path.join(outDir, 'catalog', 'movie'), { recursive: true });
    await writeFile(path.join(outDir, 'catalog', 'movie', 'a.json'), '{}');
    await writeFile(path.join(outDir, 'catalog', 'movie', 'b.json'), '{}');
    await writeFile(path.join(outDir, 'index.html'), '<html></html>');
    assert.equal(await countFiles(outDir), 3);
  });
});
