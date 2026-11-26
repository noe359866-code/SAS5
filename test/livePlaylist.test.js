'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const live = require('../lib/liveChannels');
const { SPORTS_CHANNELS } = require('../lib/sportsChannels');
const { buildM3U, playlistChannels } = require('../lib/livePlaylist');

describe('lista M3U del repo por países (listas/ramdonlatam-tv.m3u)', () => {
  test('buildM3U emite una entrada EXTINF por URL, con EXTVLCOPT si hay UA', () => {
    const { m3u, entries } = buildM3U([
      { name: 'Canal A', slug: 'canal-a', group: 'Nicaragua', logo: 'https://x/y.png',
        urls: [{ url: 'https://a/1.m3u8', ua: '', ref: '' }, { url: 'https://a/2.m3u8', ua: 'MiUA', ref: 'https://ref/' }] },
      { name: 'Canal B', slug: 'canal-b', group: 'Deportes', logo: '',
        urls: [{ url: 'https://b/1.m3u8', ua: '', ref: '' }] },
    ]);
    assert.equal(entries, 3);
    assert.ok(m3u.startsWith('#EXTM3U\n'));
    assert.match(m3u, /group-title="Nicaragua",Canal A\nhttps:\/\/a\/1\.m3u8/);
    assert.match(m3u, /tvg-id="canal-a-senal-2"[^\n]*,Canal A · señal 2\n#EXTVLCOPT:http-user-agent=MiUA\n#EXTVLCOPT:http-referrer=https:\/\/ref\/\nhttps:\/\/a\/2\.m3u8/);
    assert.match(m3u, /group-title="Deportes",Canal B/);
    const blocks = m3u.split('\n').filter((l) => l.startsWith('#EXTINF'));
    assert.equal(blocks.length, 3);
  });

  test('playlistChannels cubre las semillas y los curados, sin perder señales', () => {
    const channels = playlistChannels();
    const urlsLista = channels.reduce((n, c) => n + c.urls.length, 0);
    const urlsSemillas = liveSeedUrls() + SPORTS_CHANNELS.filter((c) => c.fallback).length;
    // La fusión deduplica URLs repetidas entre semillas y descarta nombres
    // basura: margen del 20 % sobre el bruto, nunca una pérdida masiva.
    assert.ok(urlsLista >= Math.floor(urlsSemillas * 0.8),
      `se perdieron demasiadas señales: ${urlsLista} < 80% de ${urlsSemillas}`);
    assert.ok(channels.length >= Math.floor(urlsSemillas * 0.5),
      `pocos canales: ${channels.length} de ${urlsSemillas} señales brutas`);
    // Toda entrada trae grupo, nombre y al menos una URL http(s)
    for (const ch of channels) {
      assert.ok(ch.group, JSON.stringify(ch));
      assert.ok(ch.name && ch.slug, JSON.stringify(ch));
      for (const u of ch.urls) assert.match(u.url, /^https?:\/\//, ch.name);
    }
  });

  test('los canales se agrupan por PAÍS y los nombres van limpios (sin ⚠️)', () => {
    const channels = playlistChannels();
    // Canal 20 WTV: nombre único de la semilla sin verificar de Nicaragua
    const nic = channels.find((c) => c.slug === 'canal-20-wtv-hd');
    assert.ok(nic, 'falta Canal 20 WTV');
    assert.equal(nic.group, 'Nicaragua');
    assert.doesNotMatch(nic.name, /\(Nicaragua\)/, 'el país va en el grupo, no en el nombre');
    // Ningún nombre lleva marcas (petición del usuario, 25-11-2026)
    for (const c of channels) assert.doesNotMatch(c.name, /⚠️|sin verificar/i, c.name);
    // Los grupos de país van primero; los temáticos («Deportes», «Cine»…) al final
    const topicIdx = channels.findIndex((c) => ['Deportes', 'Cine', 'Música'].includes(c.group));
    const countryIdx = channels.findIndex((c) => c.group === 'Nicaragua');
    assert.ok(countryIdx >= 0 && topicIdx >= 0, 'faltan grupos esperados');
    assert.ok(countryIdx < topicIdx, 'los países deben ir antes que los grupos temáticos');
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

function liveSeedUrls() {
  const verified = require('../lib/data/liveChannelsSeed.json');
  const unverified = require('../lib/data/liveChannelsUnverifiedSeed.json');
  let mega = [];
  try { mega = require('../lib/data/liveChannelsMegaSeed.json'); } catch {}
  let tvclub = [];
  try { tvclub = require('../lib/data/liveChannelsTvclubSeed.json'); } catch {}
  let ent = [];
  try { ent = require('../lib/data/liveChannelsEntSeed.json'); } catch {}
  return verified.length + unverified.length + mega.length + tvclub.length + ent.length;
}
