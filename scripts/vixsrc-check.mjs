#!/usr/bin/env node
// Verifica la API y HTML reales y comprueba que el master es una playlist HLS.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { searchVixsrc } = require('../lib/vixsrc');
let failed = false;
for (const item of [{ title: 'The Matrix', mediaType: 'movie', tmdbId: 603 }, { title: 'Breaking Bad', mediaType: 'series', tmdbId: 1396, season: 1, episode: 1 }]) {
  try {
    const result = await searchVixsrc('', item, item.title, 15000);
    if (!result.hits?.length) throw new Error('sin playlist extraíble');
    const hit = result.hits[0];
    const response = await fetch(hit.url, { headers: { Referer: hit.referer, 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok || !(await response.text()).trimStart().startsWith('#EXTM3U')) throw new Error(`playlist inválida (HTTP ${response.status})`);
    console.log(`✔ ${item.title}: API, embed y playlist HLS`);
  } catch (error) { failed = true; console.error(`✘ ${item.title}: ${error.message}`); }
}
if (failed) process.exitCode = 1;
