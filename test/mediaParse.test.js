'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const mp = require('../lib/mediaParse');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'sites', name), 'utf8');

test('parseHlsManifest: maestro con variantes, audio y orden por calidad', () => {
  const text = [
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Español",LANGUAGE="es",DEFAULT=YES,URI="audio/es.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="aud"',
    '480/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=4200000,RESOLUTION=1920x1080,AUDIO="aud"',
    'https://cdn.example.com/1080/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720',
    '/720/index.m3u8',
  ].join('\n');
  const manifest = mp.parseHlsManifest(text, 'https://host.example.com/hls/master.m3u8');
  assert.equal(manifest.type, 'master');
  assert.deepEqual(manifest.variants.map((v) => v.height), [1080, 720, 480]);
  assert.equal(manifest.best.uri, 'https://cdn.example.com/1080/index.m3u8');
  assert.equal(manifest.variants[0].audio[0].language, 'es');
  // Relativo resuelto contra el manifiesto, no contra el host raíz.
  assert.equal(manifest.variants[1].uri, 'https://host.example.com/720/index.m3u8');
  assert.equal(mp.parseHlsManifest('<html>no</html>'), null);
  assert.equal(mp.parseHlsManifest('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n'), null, 'sin URI no hay variante');
});

test('parseHlsManifest: media playlist devuelve segmentos en orden', () => {
  const manifest = mp.parseHlsManifest([
    '#EXTM3U', '#EXT-X-TARGETDURATION:6', '#EXTINF:6.0,', 'seg-1.ts', '#EXTINF:6.0,', 'seg-2.ts',
  ].join('\n'), 'https://cdn.example.com/v/index.m3u8');
  assert.equal(manifest.type, 'media');
  assert.deepEqual(manifest.segments.map((s) => s.uri),
    ['https://cdn.example.com/v/seg-1.ts', 'https://cdn.example.com/v/seg-2.ts']);
});

test('mediaKind y normalizeMediaUrl no aceptan esquemas ni credenciales', () => {
  assert.equal(mp.mediaKind('https://x/a/master.m3u8'), 'hls');
  assert.equal(mp.mediaKind('https://x/a.m3u8?token=1'), 'hls');
  assert.equal(mp.mediaKind('https://x/v.mp4'), 'mp4');
  assert.equal(mp.mediaKind('https://x/v.webm'), null);
  assert.equal(mp.mediaKind('https://x/', 'application/vnd.apple.mpegurl'), 'hls');
  assert.equal(mp.normalizeMediaUrl('//cdn.x/v.mp4', 'https://site/'), 'https://cdn.x/v.mp4');
  assert.equal(mp.normalizeMediaUrl('javascript:alert(1)', 'https://site/'), null);
  assert.equal(mp.normalizeMediaUrl('https://user:pass@x/v.mp4'), null);
  assert.equal(mp.normalizeMediaUrl('data:video/mp4;base64,AA'), null);
});

test('fromPacker: desempaqueta el MixDrop medido y deja el MP4 firmado', () => {
  const unpacked = mp.fromPacker(fixture('mixdrop-embed.html'));
  assert.ok(unpacked, 'el fixture debe desempaquetarse');
  const wurl = /MDCore\.wurl\s*=\s*"([^"]+)"/.exec(unpacked)?.[1];
  assert.match(wurl, /^\/\/1y04jx1s6\.mxcontent\.net\/v2\/mkkkzkqla6x18g\.mp4\?s=[\w-]+&e=\d+&_t=\d+$/);
  assert.equal(mp.fromPacker('console.log(1)'), null);
  assert.equal(mp.fromPacker(''), null);
});

test('decryptPlayback: une key_parts y descifra AES-256-GCM de verdad', async () => {
  // Se cifra un JSON con la misma estructura que publica Byse y se comprueba
  // que el lector lo recupera: no se guarda ninguna clave del sitio.
  const parts = [crypto.randomBytes(24), crypto.randomBytes(8)]; // 32 bytes exactos
  const key = Buffer.concat(parts);
  const iv = crypto.randomBytes(12);
  const plain = JSON.stringify({ sources: [{ file: 'https://cdn.example.com/movie/master.m3u8', label: '1080p' }] });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const playback = { algorithm: 'AES-256-GCM', iv: iv.toString('base64url'), key_parts: parts.map((p) => p.toString('base64url')),
    payload: encrypted.toString('base64url') };
  const payload = await mp.decryptPlayback(playback);
  assert.deepEqual(payload, JSON.parse(plain));
  // Clave alterada o payload truncado → null, nunca excepción.
  assert.equal(await mp.decryptPlayback({ ...playback, key_parts: [...playback.key_parts, 'AAAA'] }), null);
  assert.equal(await mp.decryptPlayback({ ...playback, payload: 'AAAA' }), null);
  assert.equal(await mp.decryptPlayback({ algorithm: 'AES-128-CBC', iv: playback.iv, key_parts: parts.map((p) => p.toString('base64url')), payload: playback.payload }), null);
});

test('decryptPlayback: las partes de 16 bytes son la clave entre señuelos de 24', async () => {
  // Formato real de Byse (medido el 19-11-2026): 30 `key_parts`, 28 señuelos
  // de 24 bytes y las dos mitades de la clave (16 bytes) en posiciones
  // aleatorias. La clave es la concatenación de las partes de 16 bytes.
  const key = crypto.randomBytes(32);
  const shares = [key.subarray(0, 16), key.subarray(16, 32)];
  const decoys = Array.from({ length: 28 }, () => crypto.randomBytes(24));
  const parts = [...decoys.slice(0, 9), shares[0], ...decoys.slice(9, 20), shares[1], ...decoys.slice(20)];
  assert.equal(parts.length, 30);
  const iv = crypto.randomBytes(12);
  const plain = JSON.stringify({ sources: [{ url: 'https://cdn.example.com/hls/master.m3u8', label: '1080p' }] });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const playback = { algorithm: 'AES-256-GCM', version: 1, iv: iv.toString('base64url'),
    key_parts: parts.map((p) => p.toString('base64url')), payload: encrypted.toString('base64url') };
  const payload = await mp.decryptPlayback(playback);
  assert.deepEqual(payload, JSON.parse(plain));
  // Sin las partes de 16 bytes la clave no suma 32 y no se descifra.
  const noShares = { ...playback, key_parts: decoys.map((p) => p.toString('base64url')) };
  assert.equal(await mp.decryptPlayback(noShares), null);
});

test('playbackSources: acepta variantes de campo y descarta lo que no es medio', () => {
  const sources = mp.playbackSources({
    sources: [
      { file: 'https://cdn.example.com/a/master.m3u8', label: '1080p' },
      { src: '/rel/video.mp4', res: '720p' },
      { url: 'https://cdn.example.com/manifest.mpd' },
      { url: 'not-a-url' },
    ],
  }, 'https://byseraguci.com/e/abc');
  assert.deepEqual(sources.map((s) => s.url), ['https://cdn.example.com/a/master.m3u8', 'https://byseraguci.com/rel/video.mp4']);
  assert.deepEqual(sources.map((s) => s.kind), ['hls', 'mp4']);
});

test('audioFromLabel solo marca doblajes explícitos', () => {
  assert.equal(mp.audioFromLabel('Latino · Voe'), 'Latino');
  assert.equal(mp.audioFromLabel('CASTELLANO'), 'Castellano');
  assert.equal(mp.audioFromLabel('Subtitulada'), 'Subtitulado');
  assert.equal(mp.audioFromLabel('Player'), '');
});
