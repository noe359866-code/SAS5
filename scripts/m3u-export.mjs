#!/usr/bin/env node
'use strict';

/**
 * Exporta TODOS los canales del addon a una lista M3U en el repo:
 *   listas/ramdonlatam-tv.m3u
 *
 * Fuentes: lib/data/liveChannelsSeed.json (verificados),
 * lib/data/liveChannelsUnverifiedSeed.json (iptvgo, ⚠️ sin verificar) y
 * lib/sportsChannels.js (deportes curados), ya fusionadas y reclasificadas
 * por tema vía lib/liveChannels.js + lib/liveTopics.js.
 *
 * La Action semanal (sports-candidates.yml) la regenera tras actualizar las
 * semillas, así la lista nunca envejece. Uso local:
 *
 *   node scripts/m3u-export.mjs
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
const path = require('node:path');
const { buildM3U, playlistChannels } = require('../lib/livePlaylist');

const OUT = path.join(process.cwd(), 'listas', 'ramdonlatam-tv.m3u');

const channels = playlistChannels();
const { m3u, entries } = buildM3U(channels, {
  generatedAt: new Date().toISOString(),
});

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, m3u);

const unverified = channels.filter((c) => c.unverified).length;
console.log(`lista M3U escrita en ${path.relative(process.cwd(), OUT)}`);
console.log(`canales: ${channels.length} (${unverified} sin verificar) · entradas EXTINF: ${entries}`);
