'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseManifest } = require('../lib/hlsManifest');
const { inspectVimeos, unpackPacked, extractFromEmbedHtml } = require('../lib/vimeos');
const { titleScore } = require('../lib/providerTitles');

const master = 'https://s9.vimeos.net/test/master.m3u8';
const variant = '#EXT-X-STREAM-INF:BANDWIDTH=12345,RESOLUTION=1280x720';

test('HLS acepta variantes y segmentos relativos, comentarios y byte ranges', () => {
  assert.deepEqual(parseManifest(`\uFEFF#EXTM3U\r\n${variant}\r\n#comment\r\nvideo.m3u8?sig=sample\r\n`), {
    variants: [{ uri: 'video.m3u8?sig=sample', height: 720 }], resolution: '720p', segment: null,
  });
  assert.equal(parseManifest('#EXTM3U\n#EXTINF:4.2,\n#EXT-X-BYTERANGE:50@0\nmedia.mp4\n').segment, 'media.mp4');
});

test('HLS rechaza contenido que parece una playlist pero que no se puede interpretar', () => {
  for (const body of [
    `${variant}\n<html>no</html>`,
    `${variant}\n${variant}\nvideo.m3u8`,
    `${variant}\nvideo.m3u8\n${variant}`,
    `${variant}\nvideo.m3u8\n#EXTINF:1,\nvideo.ts`,
    `${variant}\njavascript:alert(1)`,
    `${variant}\nvideo.m3u8\nuri-suelta.m3u8`,
    '#EXTINF:unknown,\nseg.ts',
  ]) assert.equal(parseManifest(`#EXTM3U\n${body}`), null, body);
});

test('Vimeos verifica solo el manifiesto y descarta referencias primarias fuera de sus CDN', async () => {
  let uri = '//external.example/video.m3u8';
  let calls = 0;
  const http = { text: async (url) => {
    assert.equal(url, master);
    calls++;
    return `#EXTM3U\n${variant}\n${uri}`;
  } };
  assert.equal(await inspectVimeos(master, http), null);
  uri = '//s10.vimeos.net/video.m3u8';
  assert.equal((await inspectVimeos(master, http)).verification, 'manifest-ok');
  assert.equal(calls, 2);
});

test('Vimeos extrae URLs serializadas y omite HTML disfrazado y miniaturas VTT', () => {
  const embed = String.raw`<script>
    const config = { file: 'https:\/\/s9.vimeos.net/test/MASTER.M3U8?one=1\u0026two=2' };
    const wrapper = 'https://s9.vimeos.net/player.html?file=broken.m3u8';
    const tracks = [
      { kind: 'thumbnails', file: 'https://s9.vimeos.net/preview.vtt' },
      { kind: 'captions', file: 'https:\/\/s9.vimeos.net/spanish.vtt', label: 'Español' }
    ];
  </script>`;
  const { hls, subtitles } = extractFromEmbedHtml(embed);
  assert.deepEqual(hls, ['https://s9.vimeos.net/test/MASTER.M3U8?one=1&two=2']);
  assert.deepEqual(subtitles, [{ url: 'https://s9.vimeos.net/spanish.vtt', lang: 'es', title: 'Español' }]);
});

test('Vimeos: desempaquetado sin sustituciones recursivas ni expansión excesiva', () => {
  const packed = (payload, words) => `eval(function(p,a,c,k,e,d){}('${payload}',10,3,'${words}'.split('|'))) `;
  assert.equal(unpackPacked(packed('2 1 0', 'zero|one|1 $&')), '1 $& one zero');
  assert.equal(unpackPacked(packed('2 '.repeat(2000), `zero|one|${'a'.repeat(1000)}`)), '');
});

test('identidad: Unicode conserva títulos originales completos aunque compartan un número', () => {
  assert.equal(titleScore(['怪獣8号 (2024)'], ['怪獣8号']), 2);
  assert.equal(titleScore(['第8話'], ['怪獣8号']), 0);
  assert.equal(titleScore(['El círculo (2025)'], ['Circulo']), 1);
});
