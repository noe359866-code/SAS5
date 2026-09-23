/**
 * Prueba con mock de Supabase para validar el mapeo y filtrado de streams
 */

const assert = require('assert');
const { formatRowToStream } = require('../lib/formatter');

console.log('--- Probando mapeo de datos con filas simuladas de Supabase ---');

const mockDatabaseRows = [
  {
    id: 1,
    imdb_id: 'tt0111161',
    season: null,
    episode: null,
    title: 'The.Shawshank.Redemption.1994.2160p.UHD.BluRay.x265.Dual.Castellano.Latino',
    info_hash: '1234567890abcdef1234567890abcdef12345678',
    seeders: 85,
    size_bytes: 8589934592, // 8.00 GB
    resolution: '4K',
    audio: 'Castellano DTS-HD, Latino AC3',
    subtitles: 'Español, Inglés',
    codec: 'x265',
    source: 'BluRay'
  },
  {
    id: 2,
    imdb_id: 'tt0111161',
    season: null,
    episode: null,
    title: 'Cadena.Perpetua.1080p.Castellano',
    info_hash: 'abcdef1234567890abcdef1234567890abcdef12',
    seeders: 42,
    size_bytes: 2684354560, // 2.50 GB
    resolution: '1080p',
    audio: 'Castellano AC3',
    subtitles: 'Español',
    codec: 'x264',
    source: 'WEB-DL'
  }
];

const mappedStreams = mockDatabaseRows.map(row => formatRowToStream(row));

assert.strictEqual(mappedStreams.length, 2);
assert.strictEqual(mappedStreams[0].name, '[DUAL] 4K');
assert.strictEqual(mappedStreams[0].infoHash, '1234567890abcdef1234567890abcdef12345678');
assert.ok(mappedStreams[0].title.includes('8.00 GB'));
assert.ok(mappedStreams[0].title.includes('Seeders: 85'));
assert.ok(mappedStreams[0].title.includes('x265'));

assert.strictEqual(mappedStreams[1].name, '[ESP] 1080p');
assert.strictEqual(mappedStreams[1].infoHash, 'abcdef1234567890abcdef1234567890abcdef12');
assert.ok(mappedStreams[1].title.includes('2.50 GB'));
assert.ok(mappedStreams[1].title.includes('Seeders: 42'));

console.log('✅ Simulación de filas de Supabase validada exitosamente.');
