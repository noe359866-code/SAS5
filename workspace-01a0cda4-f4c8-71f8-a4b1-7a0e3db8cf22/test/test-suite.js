/**
 * Suite de Pruebas Automatizadas para el Addon Stremio
 * Ejecuta pruebas unitarias de formateo, validación del manifest y pruebas de integración HTTP.
 */

const assert = require('assert');
const http = require('http');
const addonInterface = require('../addon');
const app = require('../api/index');
const {
  extractInfoHash,
  formatSize,
  detectResolution,
  detectLanguage,
  detectCodec,
  detectSource,
  formatRowToStream
} = require('../lib/formatter');

let passedTests = 0;
let totalTests = 0;

function it(description, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ ${description}`);
    console.error(`     Error: ${err.message}`);
    throw err;
  }
}

async function itAsync(description, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ ${description}`);
    console.error(`     Error: ${err.message}`);
    throw err;
  }
}

console.log('\n========================================================');
console.log('🧪 INICIANDO SUITE DE PRUEBAS DEL ADDON');
console.log('========================================================\n');

// 1. Pruebas del Manifest
console.log('--- [1] Validación de Especificación de Manifest Stremio ---');

it('El manifest contiene todos los campos obligatorios requeridos por Stremio', () => {
  const m = addonInterface.manifest;
  assert.strictEqual(m.id, 'org.comunidad.torrents.espanol');
  assert.strictEqual(m.version, '1.0.0');
  assert.strictEqual(m.name, 'Torrents Español HD');
  assert.ok(m.description.includes('Castellano'));
  assert.ok(m.description.includes('Latino'));
  assert.strictEqual(m.icon, 'https://cdn-icons-png.flaticon.com/512/3172/3172520.png');
  assert.strictEqual(m.background, 'https://dl.strem.io/bg.jpg');
  assert.deepStrictEqual(m.resources, ['stream']);
  assert.deepStrictEqual(m.types, ['movie', 'series', 'anime']);
  assert.deepStrictEqual(m.idPrefixes, ['tt']);
  assert.strictEqual(m.behaviorHints.configurable, false);
  assert.strictEqual(m.behaviorHints.configurationRequired, false);
});

// 2. Pruebas Unitarias de Formateo y Utilidades
console.log('\n--- [2] Pruebas Unitarias del Módulo Formatter ---');

it('extractInfoHash limpia hashes hex de 40 caracteres', () => {
  const hash = '4D5F74F5BABCD7BF62B75ACD8182370CA495DFA5';
  const result = extractInfoHash(hash, null);
  assert.strictEqual(result, '4d5f74f5babcd7bf62b75acd8182370ca495dfa5');
});

it('extractInfoHash extrae infoHash desde enlaces magnet URI', () => {
  const magnet = 'magnet:?xt=urn:btih:4d5f74f5babcd7bf62b75acd8182370ca495dfa5&dn=Test';
  const result = extractInfoHash(null, magnet);
  assert.strictEqual(result, '4d5f74f5babcd7bf62b75acd8182370ca495dfa5');
});

it('formatSize formatea bytes a GB legibles', () => {
  const bytes = 2.5 * 1024 * 1024 * 1024; // 2.5 GB
  const result = formatSize(bytes);
  assert.strictEqual(result, '2.50 GB');
});

it('detectResolution detecta resoluciones 4K, 1080p, 720p correctamente', () => {
  assert.strictEqual(detectResolution({ resolution: '4K' }), '4K');
  assert.strictEqual(detectResolution({ title: 'Pelicula.2024.2160p.HDR' }), '4K');
  assert.strictEqual(detectResolution({ title: 'Pelicula.1080p.BluRay' }), '1080p');
  assert.strictEqual(detectResolution({ title: 'Serie.720p.HDTV' }), '720p');
});

it('detectLanguage clasifica adecuadamente Castellano, Latino, Dual y VOSE', () => {
  const esp = detectLanguage({ language: 'Castellano' });
  assert.strictEqual(esp.tag, '[ESP]');

  const lat = detectLanguage({ language: 'Latino' });
  assert.strictEqual(lat.tag, '[LAT]');

  const dual = detectLanguage({ title: 'Pelicula.1080p.Dual.Castellano.Latino' });
  assert.strictEqual(dual.tag, '[DUAL]');

  const vose = detectLanguage({ title: 'Anime.VOSE.Sub.Espanol', language: 'VOSE' });
  assert.strictEqual(vose.tag, '[SUB]');
});

it('formatRowToStream construye el objeto Stream multilínea según especificación', () => {
  const row = {
    imdb_id: 'tt0111161',
    title: 'Cadena.Perpetua.1994.1080p.Castellano',
    info_hash: '4d5f74f5babcd7bf62b75acd8182370ca495dfa5',
    seeders: 55,
    size_bytes: 3221225472, // 3 GB
    audio: 'Castellano DTS 5.1',
    subtitles: 'Español',
    codec: 'x265',
    source: 'BluRay'
  };

  const stream = formatRowToStream(row);
  assert.strictEqual(stream.name, '[ESP] 1080p');
  assert.ok(stream.title.includes('🎬 Cadena.Perpetua.1994.1080p.Castellano'));
  assert.ok(stream.title.includes('🔊 Audio: Castellano DTS 5.1 | 📝 Subs: Español'));
  assert.ok(stream.title.includes('💾 Tamaño: 3.00 GB | 👥 Seeders: 55'));
  assert.ok(stream.title.includes('⚙️ Formato: BluRay x265'));
  assert.strictEqual(stream.infoHash, '4d5f74f5babcd7bf62b75acd8182370ca495dfa5');
  assert.ok(Array.isArray(stream.sources));
  assert.strictEqual(stream.behaviorHints.bingeGroup, 'torrents-esp-1080p');
});

// 3. Pruebas de Integración de Endpoints HTTP (CORS, SDK Router, Vercel compatibility)
console.log('\n--- [3] Pruebas de Integración HTTP y Compatibilidad Vercel ---');

const TEST_PORT = 7891;
const server = app.listen(TEST_PORT, async () => {
  try {
    const baseUrl = `http://127.0.0.1:${TEST_PORT}`;

    await itAsync('GET /manifest.json devuelve 200, JSON válido y cabecera CORS "*"', async () => {
      const res = await fetch(`${baseUrl}/manifest.json`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
      assert.ok(res.headers.get('content-type').includes('application/json'));
      const data = await res.json();
      assert.strictEqual(data.id, 'org.comunidad.torrents.espanol');
      assert.strictEqual(data.name, 'Torrents Español HD');
    });

    await itAsync('GET /api/manifest.json responde correctamente para enrutamiento interno Vercel', async () => {
      const res = await fetch(`${baseUrl}/api/manifest.json`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.id, 'org.comunidad.torrents.espanol');
    });

    await itAsync('OPTIONS /manifest.json responde 204 a preflight de CORS', async () => {
      const res = await fetch(`${baseUrl}/manifest.json`, { method: 'OPTIONS' });
      assert.strictEqual(res.status, 204);
      assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
      assert.strictEqual(res.headers.get('access-control-allow-headers'), '*');
    });

    await itAsync('GET /stream/movie/tt0111161.json responde 200 con estructura { streams: [...] }', async () => {
      const res = await fetch(`${baseUrl}/stream/movie/tt0111161.json`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
      const data = await res.json();
      assert.ok(Array.isArray(data.streams));
    });

    await itAsync('GET /stream/series/tt0944947:1:5.json parsea serie con temporada y episodio', async () => {
      const res = await fetch(`${baseUrl}/stream/series/tt0944947:1:5.json`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.streams));
    });

    await itAsync('GET / entrega la Landing Page interactiva en HTML con deep link stremio://', async () => {
      const res = await fetch(`${baseUrl}/`, {
        headers: { 'Accept': 'text/html' }
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers.get('content-type').includes('text/html'));
      const text = await res.text();
      assert.ok(text.includes('Torrents Español HD'));
      assert.ok(text.includes('stremio://'));
      assert.ok(text.includes('manifest.json'));
    });

    await itAsync('Rutas inexistentes devuelven 404 en formato JSON limpio', async () => {
      const res = await fetch(`${baseUrl}/ruta-inexistente`);
      assert.strictEqual(res.status, 404);
      const data = await res.json();
      assert.ok(data.err);
    });

    server.close();

    console.log('\n========================================================');
    console.log(`🎉 TODAS LAS PRUEBAS COMPLETADAS: ${passedTests}/${totalTests} EXITOSAS`);
    console.log('========================================================\n');
  } catch (err) {
    server.close();
    console.error('\n❌ Error durante la ejecución de las pruebas:', err);
    process.exit(1);
  }
});
