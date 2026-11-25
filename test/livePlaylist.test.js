'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const live = require('../lib/liveChannels');
const { SPORTS_CHANNELS } = require('../lib/sportsChannels');
const { buildM3U, playlistChannels } = require('../lib/livePlaylist');

describe('lista M3U del repo (listas/ramdonlatam-tv.m3u)', () => {
  test('buildM3U emite una entrada EXTINF por URL, con EXTVLCOPT si hay UA', () => {
    const { m3u, entries } = buildM3U([
      { name: 'Canal A', slug: 'canal-a', category: 'cine', logo: 'https://x/y.png',
        urls: [{ url: 'https://a/1.m3u8', ua: '', ref: '' }, { url: 'https://a/2.m3u8', ua: 'MiUA', ref: 'https://ref/' }] },
      { name: 'Canal B', slug: 'canal-b', category: 'noticias', logo: '',
        urls: [{ url: 'https://b/1.m3u8', ua: '', ref: '' }] },
    ]);
    assert.equal(entries, 3);
    assert.ok(m3u.startsWith('#EXTM3U\n'));
    assert.match(m3u, /group-title="Cine",Canal A\nhttps:\/\/a\/1\.m3u8/);
    assert.match(m3u, /tvg-id="canal-a-senal-2"[^\n]*,Canal A · señal 2\n#EXTVLCOPT:http-user-agent=MiUA\n#EXTVLCOPT:http-referrer=https:\/\/ref\/\nhttps:\/\/a\/2\.m3u8/);
    assert.match(m3u, /group-title="Noticias",Canal B/);
    // Cada EXTINF va seguido (salvo EXTVLCOPT) de una URL http(s)
    const blocks = m3u.split('\n').filter((l) => l.startsWith('#EXTINF'));
    assert.equal(blocks.length, 3);
  });

  test('playlistChannels cubre todos los canales indexados y los curados', () => {
    const channels = playlistChannels();
    let indexados = 0;
    for (const cat of live.activeCategories()) indexados += live.liveMetas(cat.key, {}).length;
    const curados = SPORTS_CHANNELS.filter((c) => c.fallback).length;
    assert.equal(channels.length, indexados + curados);
    // Solo categorías con etiqueta editorial conocida
    for (const ch of channels) assert.ok(live.CATEGORY_LABELS[ch.category], ch.category);
  });

  test('el país va en el nombre y el ⚠️ solo en las no verificadas', () => {
    const channels = playlistChannels();
    const nic = channels.find((c) => c.slug === 'canal-20-wtv-hd');
    assert.ok(nic, 'falta Canal 20 WTV (Nicaragua)');
    assert.match(nic.name, /\(Nicaragua\)/);
    assert.match(nic.name, /⚠️/); // viene de la semilla sin verificar
    const verificados = channels.filter((c) => !c.unverified);
    assert.ok(verificados.length > 100, 'pocos verificados');
    for (const c of verificados) assert.doesNotMatch(c.name, /⚠️/, c.name);
  });

  test('la lista del repo está al día con las semillas', () => {
    // Si cambian las semillas, hay que regenerar: node scripts/m3u-export.mjs
    // (la Action semanal lo hace sola tras actualizar las semillas).
    const onDisk = fs.readFileSync('listas/ramdonlatam-tv.m3u', 'utf8')
      .split('\n').filter((l) => !l.startsWith('# Fecha:')).join('\n');
    const fresh = buildM3U(playlistChannels()).m3u
      .split('\n').filter((l) => !l.startsWith('# Fecha:')).join('\n');
    assert.equal(onDisk, fresh, 'lista desactualizada: corre node scripts/m3u-export.mjs');
  });
});
