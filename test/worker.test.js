'use strict';

/**
 * Tests del Cloudflare Worker (sin red externa ni claves):
 * importan worker.mjs y llaman a fetch() con un env simulado.
 */

const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let worker;
const env = { WATCH_REGION: 'NI' }; // sin claves → degradación elegante

before(async () => {
  worker = (await import('../worker.mjs')).default;
});

const get = (path, options = {}) =>
  worker.fetch(new Request(`http://worker.local${path}`, options), env, {});

test('manifest: válido, con logo apuntando al Worker', async () => {
  const res = await get('/manifest.json');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const manifest = await res.json();
  assert.equal(manifest.id, 'org.comunidad.catalogos.plus');
  assert.equal(manifest.resources.includes('catalog'), true);
  assert.equal(manifest.catalogs.length >= 30, true);
  assert.equal(manifest.logo, 'http://worker.local/assets/logo.png');
});

test('logo: se sirve como image/png embebido', async () => {
  const res = await get('/assets/logo.png');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  const buf = new Uint8Array(await res.arrayBuffer());
  assert.equal(buf[0], 0x89); // PNG magic
  assert.equal(buf[1], 0x50);
  assert.ok(buf.length > 5000, 'el logo pesa más de 5 KB');
});

test('healthz: reporta runtime cloudflare-workers', async () => {
  const res = await get('/healthz');
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.runtime, 'cloudflare-workers');
  assert.deepEqual(body.streamProviders, ['fanpelis', 'spinflix', 'gnulahd']);
  assert.deepEqual(body.sources, { tmdb: false, tvmaze: true, omdb: false, fanpelis: true, spinflix: true, gnulahd: true });
});

test('catalog: sin TMDB key devuelve metas=[] con 200', async () => {
  const res = await get('/catalog/movie/cine_top.json');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.metas, []);
});

test('meta: id desconocido devuelve ficha mínima válida', async () => {
  const res = await get('/meta/movie/tt0111161.json');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.meta.id, 'tt0111161');
  assert.ok(body.meta.name);
});

test('landing: HTML con botón de instalación', async () => {
  const res = await get('/', { headers: { Accept: 'text/html' } });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Tendencias/);
  assert.match(html, /Explorar por/);
  assert.match(html, /Instalar en Stremio/);
  assert.match(html, /image\.tmdb\.org/);
});

test('preflight OPTIONS: 204 con CORS', async () => {
  const res = await get('/manifest.json', { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('access-control-allow-methods'), /POST/);
});






test('cache endpoint: solo expone métricas agregadas', async () => {
  const res = await get('/internal/cache.json');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const stats = await res.json();
  assert.equal(typeof stats.entries, 'number');
  assert.equal(typeof stats.maxEntries, 'number');
  assert.equal(Object.hasOwn(stats, 'keys'), false);
});

test('Worker usa Cache API compartida para rutas públicas (la memoria del isolate va primero)', async () => {
  const originalCaches = globalThis.caches;
  const entries = new Map();
  let matches = 0;
  let puts = 0;
  globalThis.caches = { default: {
    async match(request) { matches++; return entries.get(request.url)?.clone() || undefined; },
    async put(request, response) { puts++; entries.set(request.url, response.clone()); },
  } };
  const config = require('../lib/config');
  const responseCache = require('../lib/responseCache');
  responseCache.reset();
  config.reload({ ...env, RESPONSE_CACHE_MB: '24' });
  try {
    // 1ª petición: memoria → fallo, Cache API → fallo, handler → se guarda
    // en la Cache API y en la memoria del isolate.
    const first = await worker.fetch(new Request('https://cache.example/manifest.json'), env, {});
    assert.equal(first.status, 200);
    assert.equal(matches, 1);
    assert.equal(puts, 1);

    // 2ª petición: responde la memoria del isolate. Importa porque
    // `cache.match` cuenta como subpetición (límite de 50 en Workers Free) y
    // porque en `*.workers.dev` la Cache API no funciona: sin esta capa, cada
    // repetición volvería a ejecutar el handler completo.
    const second = await worker.fetch(new Request('https://cache.example/manifest.json'), env, {});
    assert.equal(second.status, 200);
    assert.equal(matches, 1, 'la memoria evita consultar la Cache API');
    assert.equal(second.headers.get('x-catalogos-cache'), 'memory');
    assert.equal((await second.json()).id, 'org.comunidad.catalogos.plus');

    // Con la caché de memoria desactivada (RESPONSE_CACHE_MB=0) se vuelve al
    // comportamiento clásico: dos consultas a la Cache API y una escritura.
    config.reload({ ...env, RESPONSE_CACHE_MB: '0' });
    const third = await worker.fetch(new Request('https://cache.example/manifest.json'), env, {});
    assert.equal(third.status, 200);
    assert.equal(matches, 2);
    assert.equal(puts, 1, 'la entrada seguía en la Cache API');
  } finally {
    config.reload(env);
    responseCache.reset();
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});

test('404: ruta inexistente en JSON', async () => {
  const res = await get('/no-existe');
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, 'not_found');
});

test('configure: página con plataformas, estudios, idioma y región', async () => {
  const res = await get('/configure', { headers: { Accept: 'text/html' } });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Plataformas/);
  assert.match(html, /Hulu/);
  assert.match(html, /AMC\+/);
  assert.match(html, /Idioma/);
  assert.match(html, /Región/);
  assert.match(html, /Instalar en Stremio/);
});

test('branding: sin TMDB devuelve objetos vacíos sin romper', async () => {
  const res = await get('/internal/branding.json');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.providers && typeof body.providers === 'object');
  assert.ok(body.studios && typeof body.studios === 'object');
});

test('manifest personal: filtra catálogos según config', async () => {
  const cfg = Buffer.from(
    JSON.stringify({ lang: 'es-MX', region: 'MX', platforms: ['netflix'], studios: ['marvel'], base: ['tendencias'] })
  ).toString('base64url');
  const res = await get('/' + cfg + '/manifest.json');
  assert.equal(res.status, 200);
  const manifest = await res.json();
  assert.equal(manifest.name, 'RamdonLatam · MX');
  const ids = manifest.catalogs.map((c) => c.id).sort();
  assert.deepEqual(ids, [
    'cine_estudio_marvel', 'cine_netflix', 'cine_tendencias',
    'tv_estudio_marvel', 'tv_netflix', 'tv_tendencias',
  ]);
  assert.equal(manifest.behaviorHints.configurable, true);
});

test('catalog deshabilitado por config: lista vacía aunque el catálogo exista', async () => {
  const cfg = Buffer.from(
    JSON.stringify({ lang: 'es', region: 'MX', platforms: [], studios: [], base: ['tendencias'] })
  ).toString('base64url');
  const res = await get('/' + cfg + '/catalog/movie/cine_netflix.json');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.metas, []);
});

test('configure con config: /<cfg>/configure abre con la región del usuario cargada', async () => {
  const cfg = Buffer.from(
    JSON.stringify({ lang: 'es', region: 'MX', platforms: ['netflix'], studios: [], base: ['tendencias'], streams: ['flixlatam', 'playlatin'] })
  ).toString('base64url');
  const res = await get('/' + cfg + '/configure', { headers: { Accept: 'text/html' } });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /"region":"MX"/); // INITIAL precargado en la página
  assert.match(html, /"streams":null/); // selección de solo retiradas → fuentes por defecto
  assert.match(html, /Región de plataformas/);
});

test('config inválida: 404 invalid_config', async () => {
  const res = await get('/bm90LWpzb24/manifest.json'); // base64url de "not-json"
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, 'invalid_config');
});

test('manifest personal con config larga (~600 chars) responde 200 (no 404)', async () => {
  const userConfig = require('../lib/userConfig');
  const { PLATFORM_KEYS, STUDIO_KEYS } = require('../lib/catalogs');
  const streams = require('../lib/streams');
  const cfg = userConfig.encodeConfig({
    lang: 'es',
    region: 'MX',
    platforms: PLATFORM_KEYS,
    studios: STUDIO_KEYS,
    base: userConfig.BASE_KEYS,
    streams: streams.PROVIDER_KEYS,
  });
  assert.ok(cfg.length > 512, `el segmento mide ${cfg.length} caracteres`);

  const res = await get('/' + cfg + '/manifest.json');
  assert.equal(res.status, 200);
  const manifest = await res.json();
  assert.equal(manifest.name, 'RamdonLatam · MX');
  assert.equal(manifest.resources.includes('stream'), true);
  assert.ok(manifest.catalogs.length > 40);

  // La misma config debe servir catálogos (sin TMDB: lista vacía, pero 200)
  const cat = await get('/' + cfg + '/catalog/movie/cine_tendencias.json');
  assert.equal(cat.status, 200);
});

test('catálogos paginados: Worker acepta extra skip en la ruta de Stremio', async () => {
  const core = require('../lib/core');
  const original = core.handleCatalog;
  try {
    core.handleCatalog = async (type, id, cfg, extra) => {
      assert.equal(type, 'series');
      assert.equal(id, 'tv_anime');
      assert.equal(extra.skip, '20');
      return { metas: [], cacheMaxAge: 0 };
    };
    const response = await get('/catalog/series/tv_anime/skip=20.json');
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).metas, []);
  } finally { core.handleCatalog = original; }
});



test('/hls: el proxy sirve playlists y segmentos, y rechaza lo que no es media', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), referer: options && options.headers && options.headers.Referer });
    if (/master\.m3u8/.test(String(url))) {
      return new Response('#EXTM3U\n#EXTINF:10,\nhttps://s10.vimeos.net/a/seg-1.ts?t=x\n', {
        status: 200,
        headers: { 'content-type': 'application/vnd.apple.mpegurl' },
      });
    }
    if (/seg-1\.ts/.test(String(url))) {
      return new Response('TS', { status: 200, headers: { 'content-type': 'video/mp2t' } });
    }
    return new Response('no', { status: 403 });
  };
  try {
    const master = `https://addon.example/hls?ref=${encodeURIComponent('https://vimeos.net/')}&u=${encodeURIComponent('https://s10.vimeos.net/a/master.m3u8?t=x')}`;
    let res = await worker.fetch(new Request(master), env, {});
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /\/hls\?ref=/);
    assert.equal(seen[0].referer, 'https://vimeos.net/');

    // El segmento reescrito del cuerpo también funciona.
    const rewritten = body.split('\n').find((line) => line.startsWith('/hls?'));
    res = await worker.fetch(new Request(`https://addon.example${rewritten}`), env, {});
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'TS');

    // Fuera de la lista blanca: 403 y sin tocar la red desde ahí.
    const before = seen.length;
    res = await worker.fetch(new Request(`https://addon.example/hls?u=${encodeURIComponent('https://evil.example/x.m3u8')}`), env, {});
    assert.equal(res.status, 403);
    assert.equal(seen.length, before);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Worker: el enlace de Fanpelis en /stream sirve HLS, vídeo y audio por SpinFlix', async (t) => {
  const { encodeConfig } = require('../lib/userConfig');
  const base = 'https://worker.example';
  const master = 'https://s9.vimeos.net/hls2/fixture/master.m3u8?t=test';
  const variant = new URL('video.m3u8?t=test', master).href;
  const audio = new URL('es.m3u8?t=test', master).href;
  const embed = 'https://vimeos.net/embed-transport-test.html';
  const played = [];
  t.mock.method(require('../lib/tvmaze'), 'showLookupByImdb', async () => null);
  t.mock.method(require('../lib/cinemeta'), 'lookup', async () => ({ name: 'Serie del fixture', releaseInfo: '2009' }));
  t.mock.method(global, 'fetch', async (value, init) => {
    const url = new URL(value);
    assert.equal(init.redirect, 'manual');
    if (url.hostname === 'fanpelis.to') {
      if (url.pathname.endsWith('/search')) return Response.json({ data: { posts: [{ _id: 100, title: 'Serie del fixture', type: 'tvshows' }] } });
      if (url.pathname.endsWith('/episodes')) return Response.json({ data: [
        { _id: 101, season_number: 1, episode_number: 1 }, { _id: 102, season_number: 1, episode_number: 2 },
      ] });
      assert.equal(url.pathname, '/api/rest/player');
      assert.equal(url.searchParams.get('post_id'), '102');
      return Response.json({ data: { embeds: [{ lang: 'Latino', url: embed }] } });
    }
    if (url.href === embed) return new Response(`<script>file = '${master}'</script>`);
    assert.equal(url.origin + url.pathname, 'https://spinoff.link/pelis/proxy.php');
    const media = url.searchParams.get('url');
    assert.equal(url.searchParams.get('ref'), 'https://s9.vimeos.net/');
    played.push(media);
    if (media === master) {
      const alreadyProxied = `https://spinoff.link/pelis/proxy.php?url=${encodeURIComponent(audio)}&type=key`;
      return new Response(`#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="es",LANGUAGE="es",URI="${alreadyProxied}"\n#EXT-X-STREAM-INF:RESOLUTION=1280x720,AUDIO="es"\n${variant}\n`);
    }
    if (media === variant || media === audio) return new Response(`#EXTM3U\n#EXTINF:1,\n${media === audio ? 'es' : 'video'}.ts?t=test\n`);
    assert.ok(media.endsWith('.ts?t=test'));
    assert.equal(init.headers.Range, 'bytes=0-563');
    const packets = new Uint8Array(564);
    for (let i = 0; i < packets.length; i += 188) packets[i] = 0x47;
    return new Response(packets, { status: 206, headers: { 'Content-Type': 'video/mp2t', 'Content-Range': 'bytes 0-563/16000' } });
  });
  const send = (raw, init) => worker.fetch(new Request(new URL(raw, base), init), env, {});
  const path = '/stream/series/tt9006134%3A1%3A2.json';
  const selection = encodeConfig({ streams: ['fanpelis'] });
  const body = await (await send(`/${selection}${path}`)).json();
  assert.equal(body.streams.length, 1);
  const [stream] = body.streams;
  assert.match(stream.title, /S01E02.*Latino.*Fanpelis/);
  assert.equal(stream.behaviorHints.notWebReady, true);
  assert.equal(stream.behaviorHints.proxyHeaders, undefined);
  assert.equal(new URL(stream.url).origin, base);
  assert.equal(new URL(stream.url).searchParams.get('via'), 'spinflix');
  const playlist = await (await send(stream.url)).text();
  assert.ok(!playlist.includes('proxy.php'), 'no anidar el proxy de SpinFlix del manifiesto');
  const videoPath = playlist.split('\n').find((value) => value.startsWith('/hls?'));
  const audioPath = playlist.match(/URI="([^"]+)"/)[1];
  for (const mediaPath of [videoPath, audioPath]) {
    const variant = await (await send(mediaPath)).text();
    const first = variant.split('\n').find((value) => value.startsWith('/hls?'));
    const segment = await send(first, { headers: { Range: 'bytes=0-563' } });
    assert.equal(segment.status, 206);
    assert.equal(segment.headers.get('Content-Range'), 'bytes 0-563/16000');
    assert.equal(segment.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(new Uint8Array(await segment.arrayBuffer())[0], 0x47);
  }
  assert.equal(played.length, 6);
  const disabled = await (await send(`/${encodeConfig({ streams: [] })}${path}`)).json();
  assert.deepEqual(disabled.streams, []);
  assert.equal(played.length, 6);
});
