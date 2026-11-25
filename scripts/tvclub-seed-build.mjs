#!/usr/bin/env node
/**
 * Sonda-barrido de m3u.tvcluboficial.com para la LISTA M3U (petición del
 * usuario, 25-11-2026: «añade canales… sonda a tvcluboficial y a iptvgo.cc»).
 *
 * Corre en GitHub Actions (desde el sandbox local no hay ruta al host).
 *
 * El host NO es un panel Xtream (player_api y get.php dan 404 — comprobado
 * el 25-11-2026): solo sirve HLS por id numérico en la ruta pública
 * `/free/ReachBot/Kip/<id>.m3u8`. La sonda 13 midió que los ids vivos son
 * dispersos (33 de 83 muestreados, hasta ~1180) y que no exige User-Agent.
 *
 * Estrategia:
 *   1. intento rápido de player_api (por si el panel abre algún día);
 *   2. barrido 1..MAX_ID: maestra 200 + #EXTM3U + primer segmento con bytes
 *      (la misma barra de calidad que la sonda 13);
 *   3. nombres: los ids ya conocidos (semillas del addon / listas Magma y
 *      Cinecity) traen nombre, país y logo; los nuevos entran como
 *      «tvclub <id>» en el grupo «Latinoamérica» (panel latino) hasta que
 *      una lista los nombre.
 *
 * Escribe `lib/data/liveChannelsTvclubSeed.json` con guarda del 80 % y el
 * informe en `.probe/tvclub-mega.md`. No se imprimen credenciales (la de la
 * ruta es pública: va en todas las URLs del propio servicio).
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');

const GENERIC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TIMEOUT = 8_000;
const CONCURRENCY = 32;

const BASE = 'http://m3u.tvcluboficial.com';
const PATH_PREFIX = '/free/ReachBot/Kip/'; // ruta pública del propio servicio

const OUT_JSON = 'lib/data/liveChannelsTvclubSeed.json';
const OUT_MD = '.probe/tvclub-mega.md';

const { cleanChannelName: cleanName } = require('../lib/liveChannelNames');
const { thematicCategoryOf, countryLabelOf } = require('../lib/liveTopics');

const slugOf = (name) => String(name || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** Ids ya conocidos → nombre/país/tema/logo (de las semillas del addon). */
function knownChannels() {
  const map = new Map();
  const seeds = [
    ['../lib/data/liveChannelsSeed.json', false],
    ['../lib/data/liveChannelsUnverifiedSeed.json', true],
  ];
  for (const [rel, unverified] of seeds) {
    let seed = [];
    try { seed = require(rel); } catch { continue; }
    for (const raw of seed) {
      const m = /tvcluboficial\.com\/[^/]+\/[^/]+\/[^/]+\/(\d+)\.m3u8/.exec(raw.url || '');
      if (!m) continue;
      const id = Number(m[1]);
      if (map.has(id)) continue;
      map.set(id, {
        name: raw.name,
        country: raw.country || countryLabelOf(raw.category) || 'Latinoamérica',
        topic: raw.topic || thematicCategoryOf(raw.name, raw.category),
        logo: raw.logo || '',
        unverified,
      });
    }
  }
  return map;
}

async function fetchBytes(url, { range = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': GENERIC_UA,
        ...(range ? { Range: 'bytes=0-2047' } : {}),
      },
      signal: controller.signal,
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, buf };
  } finally { clearTimeout(timer); }
}

/** Maestra 200 + #EXTM3U + primer tramo (variante→segmento) con bytes. */
async function isAlive(id) {
  const url = `${BASE}${PATH_PREFIX}${id}.m3u8`;
  let master;
  try {
    master = await fetchBytes(url);
  } catch { return false; }
  if (master.status !== 200 || !master.buf.includes('#EXTM3U')) return false;
  // Primer tramo de la cadena: variante (maestra) o segmento (media playlist)
  const lines = master.buf.toString('utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  const first = lines.find((l) => !l.startsWith('#'));
  if (!first) return false;
  const nextUrl = first.startsWith('http') ? first : new URL(first, url).href;
  const isSegment = !/\.m3u8/i.test(first);
  try {
    const part = await fetchBytes(nextUrl, { range: isSegment });
    if (![200, 206].includes(part.status) || part.buf.length < 100) return false;
    if (!isSegment && !part.buf.includes('#EXTM3U')) return false;
  } catch { return false; }
  return true;
}

(async () => {
  const out = [];
  const say = (line) => { out.push(line); console.log(line); };
  const t0 = Date.now();
  try {
    say('# Sonda-barrido m3u.tvcluboficial.com (para la lista M3U)');
    say('');
    say(`Fecha: ${new Date().toISOString()}`);
    say('');

    // 1) ¿Abrió el panel Xtream algún día? (un intento barato)
    const login = await fetchBytes(`${BASE}/player_api.php?username=x&password=x`).catch(() => null);
    say(`player_api: HTTP ${login ? login.status : 'sin ruta'} (404 = host de solo-streams, se barre por ids)`);

    // 2) Barrido de ids
    const known = knownChannels();
    const maxKnown = Math.max(0, ...known.keys());
    const MAX_ID = Math.max(1600, maxKnown + 400);
    say(`ids conocidos con nombre: ${known.size} · máximo conocido: ${maxKnown} · barrido: 1..${MAX_ID}`);
    say('');

    const alive = [];
    let next = 1;
    async function worker() {
      while (next <= MAX_ID) {
        const id = next++;
        if (await isAlive(id)) alive.push(id);
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    alive.sort((a, b) => a - b);
    say(`barrido: ${alive.length} ids vivos de ${MAX_ID} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    say('');

    const picked = [];
    const byGroup = new Map();
    let withName = 0;
    for (const id of alive) {
      const k = known.get(id);
      const name = k ? cleanName(k.name, k.topic) : `tvclub ${id}`;
      if (!name || (name.match(/[a-záéíóúñ]/gi) || []).length < 2) continue;
      const topic = k?.topic || 'entretenimiento';
      const country = k?.country || 'Latinoamérica';
      if (k) withName += 1;
      picked.push({
        name,
        slug: slugOf(name) || `tvclub-${id}`,
        topic,
        country,
        logo: k?.logo || '',
        url: `${BASE}${PATH_PREFIX}${id}.m3u8`,
      });
      byGroup.set(country, (byGroup.get(country) || 0) + 1);
    }

    say(`con nombre conocido: ${withName} · nuevos sin nombre («tvclub <id>»): ${picked.length - withName}`);
    say('');
    say('## Canales por grupo');
    say('');
    for (const [group, n] of [...byGroup].sort((a, b) => b[1] - a[1])) say(`- ${group}: ${n}`);
    say('');
    say(`total: ${picked.length} canales`);

    let current = [];
    try { current = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8')); } catch {}
    const floor = current.length ? Math.floor(current.length * 0.8) : 30;
    if (picked.length >= floor) {
      fs.writeFileSync(OUT_JSON, JSON.stringify(picked, null, 1) + '\n');
      say(`semilla tvclub escrita: ${current.length} -> ${picked.length}`);
    } else {
      say(`semilla tvclub NO escrita: ${picked.length} < ${floor} (guarda)`);
    }
  } catch (err) {
    say(`ERROR: ${err.message}`);
    process.exitCode = 1;
  } finally {
    fs.mkdirSync('.probe', { recursive: true });
    fs.writeFileSync(OUT_MD, out.join('\n') + '\n');
  }
})();
