#!/usr/bin/env node
/**
 * Mega-sonda completa de tvcluboficial.com / m3u.tvcluboficial.com.
 *
 * Corre en GitHub Actions (.github/workflows/tvclub-mega.yml).
 * Mide:
 *   1. Auditoría de hosts y endpoints (tvcluboficial.com, m3u.tvcluboficial.com,
 *      HTTP vs HTTPS, player_api, get.php, xmltv.php, panel_api.php, CORS).
 *   2. Requisitos de acceso (UA Android, UA genérico, sin UA, con Referer).
 *   3. Barrido denso de IDs 1..3500 + muestreo centinela 3550..25000 (paso 50,
 *      con expansión ±60 alrededor de cualquier hallazgo superior).
 *   4. Verificación real de cadena completa (maestra 200 #EXTM3U → primer
 *      segmento HTTP 200/206 con bytes MPEG-TS/fMP4), separando canales vivos
 *      de maestras rotas (maestra 200 pero segmento 404/timeout).
 *   5. Topología del clúster de nodos tsN.tvcluboficial.com, latencias (p50/p95),
 *      enriquecimiento de país, tema y logos desde el índice local de semillas.
 *
 * Escribe:
 *   - .probe/tvclub-mega.md
 *   - lib/data/liveChannelsTvclubSeed.json (con guarda del 80 %)
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');

const GENERIC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36';
const TIMEOUT = 8_000;
const CONCURRENCY = 36;

const BASE = 'http://m3u.tvcluboficial.com';
const PATH_PREFIX = '/free/ReachBot/Kip/';
const DENSE_MAX = 3500;
const SENTINEL_MAX = 25000;
const SENTINEL_STEP = 50;
const EXPAND_RADIUS = 60;

const OUT_JSON = 'lib/data/liveChannelsTvclubSeed.json';
const OUT_MD = '.probe/tvclub-mega.md';

const { cleanChannelName: cleanName } = require('../lib/liveChannelNames');
const { thematicCategoryOf, countryLabelOf } = require('../lib/liveTopics');
const { CHANNEL_LOGOS } = require('../lib/sportsChannels');

const slugOf = (name) => String(name || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

const normKey = (name) => String(name || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\b(hd|fhd|sd|4k|uhd|hevc|h265|latino|lat|es|mx|ar|co|pe|cl|us)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const percentile = (arr, p) => {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
  return Math.round(s[idx]);
};

const SLUG_OVERRIDES = {
  canaldelasestrellas: 'Las Estrellas',
  lasestrellas: 'Las Estrellas',
  axnwhite: 'AXN White',
  eltrece: 'El Trece',
  telehitmusica: 'Telehit Música',
  goldenplus: 'Golden Plus',
  goldenpremier: 'Golden Premier',
  goldenedge: 'Golden Edge',
  cinelatino: 'Cine Latino',
  depelicula: 'De Película',
  discoverykids: 'Discovery Kids',
  discoveryturbo: 'Discovery Turbo',
  discoveryscience: 'Discovery Science',
  discoveryhh: 'Discovery H&H',
  natgeowild: 'Nat Geo Wild',
  cartoonnetwork: 'Cartoon Network',
  disneychannel: 'Disney Channel',
  disneyjunior: 'Disney Junior',
  animalplanet: 'Animal Planet',
  studiouniversal: 'Studio Universal',
  foxsports: 'Fox Sports',
  tycsports: 'TyC Sports',
  winsports: 'Win Sports',
  tigosports: 'Tigo Sports',
  clarosports: 'Claro Sports',
  beinsports: 'beIN Sports',
  tntsports: 'TNT Sports',
  foodnetwork: 'Food Network',
  historychannel: 'History',
};

function humanizeSlug(slug) {
  const raw = String(slug || '').trim();
  if (!raw) return '';
  const low = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (SLUG_OVERRIDES[low]) return SLUG_OVERRIDES[low];
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/([a-záéíóúñ0-9])([A-ZÁÉÍÓÚÑ])/g, '$1 $2')
    .replace(/([A-Za-zÁÉÍÓÚÑáéíóúñ]{2,})(\d)/g, '$1 $2')
    .replace(/\bCanaldelas\s*Estrellas\b/i, 'Las Estrellas')
    .replace(/\bAXNWhite\b/i, 'AXN White')
    .replace(/\s+/g, ' ')
    .trim();
}

const PREFIX_COUNTRIES = [
  [/^(?:MX|MEX)[\s:_-]+/i, 'México'],
  [/^(?:AR|ARG)[\s:_-]+/i, 'Argentina'],
  [/^(?:CO|COL)[\s:_-]+/i, 'Colombia'],
  [/^(?:PE|PER)[\s:_-]+/i, 'Perú'],
  [/^(?:CL|CHL|CHI)[\s:_-]+/i, 'Chile'],
  [/^(?:ES|ESP)[\s:_-]+/i, 'España'],
  [/^(?:HO|HN|HON)[\s:_-]+/i, 'Honduras'],
  [/^(?:EC|ECU)[\s:_-]+/i, 'Ecuador'],
  [/^(?:BO|BOL)[\s:_-]+/i, 'Bolivia'],
  [/^(?:PY|PAR)[\s:_-]+/i, 'Paraguay'],
  [/^(?:UY|URU)[\s:_-]+/i, 'Uruguay'],
  [/^(?:VE|VEN)[\s:_-]+/i, 'Venezuela'],
  [/^(?:CR|CRI)[\s:_-]+/i, 'Costa Rica'],
  [/^(?:GT|GUA)[\s:_-]+/i, 'Guatemala'],
  [/^(?:SV|SLV|ELS)[\s:_-]+/i, 'El Salvador'],
  [/^(?:NI|NIC)[\s:_-]+/i, 'Nicaragua'],
  [/^(?:PA|PAN)[\s:_-]+/i, 'Panamá'],
  [/^(?:DO|DOM|RD)[\s:_-]+/i, 'Rep. Dominicana'],
  [/^(?:PR|PUR)[\s:_-]+/i, 'Puerto Rico'],
  [/^(?:US|USA)[\s:_-]+/i, 'EE. UU.'],
];

const SUFFIX_COUNTRIES = [
  [/\b(?:MX|MEX|MEXICO|M[ÉE]XICO)\b/i, 'México'],
  [/\b(?:ARG|ARGENTINA)\b/i, 'Argentina'],
  [/\b(?:COL|COLOMBIA)\b/i, 'Colombia'],
  [/\b(?:PERU|PER[ÚU])\b/i, 'Perú'],
  [/\b(?:CHILE)\b/i, 'Chile'],
  [/\b(?:ES|ESP|ESPA[ÑN]A)\b/i, 'España'],
  [/\b(?:USA|EEUU)\b/i, 'EE. UU.'],
];

const NETWORK_COUNTRIES = [
  [/\b(?:azteca|las estrellas|canal 5|adn ?40|foro ?tv|milenio|imagen tv|multimedios|bandamax|telehit|distrito comedia|unicable|galavisi[oó]n|televisa|canal once|canal 22)\b/i, 'México'],
  [/\b(?:telefe|el trece|eltrece|tyc sports|todo noticias|\btn\b|c5n|cr[oó]nica|canal 26|tv p[uú]blica|am[eé]rica 24|a24|encuentro|pakapaka)\b/i, 'Argentina'],
  [/\b(?:a3 ?cine|a3 ?series|antena 3|la sexta|lasexta|telecinco|cuatro|la 1|la 2|tve|clan|neox|nova|mega esp|atreseries|movistar|dazn esp|vamos|gol play|rtve|24h tve)\b/i, 'España'],
  [/\b(?:caracol|\brcn\b|win sports|se[ñn]al colombia|city ?tv|teleantioquia|telecaribe|canal 1 col)\b/i, 'Colombia'],
  [/\b(?:chilevisi[oó]n|\bchv\b|\btvn\b|canal 13 chile|mega chile|la red|tnt sports chile)\b/i, 'Chile'],
  [/\b(?:latina|am[eé]rica tv|panamericana|atv|willax|tv per[uú]|movistar deportes|gol per[uú]|liga 1)\b/i, 'Perú'],
  [/\b(?:ecuavisa|teleamazonas|tc televisi[oó]n|rts ecuador|el canal del f[uú]tbol)\b/i, 'Ecuador'],
  [/\b(?:telemundo|univisi[oó]n|unim[aá]s|tudn usa|estrella tv|espn deportes)\b/i, 'EE. UU.'],
  [/\b(?:venevisi[oó]n|globovisi[oó]n|televen|ivc|meridiano)\b/i, 'Venezuela'],
  [/\b(?:teletica|repretel)\b/i, 'Costa Rica'],
  [/\b(?:telemetro|tvn panam[aá]|rpc)\b/i, 'Panamá'],
];

function inferCountry(rawName, slug, knownCountry) {
  if (knownCountry && knownCountry !== 'Latinoamérica') return knownCountry;
  const text = `${rawName || ''}`.trim();
  const slugText = `${slug || ''}`.trim();
  for (const [re, country] of PREFIX_COUNTRIES) {
    if (re.test(text) || re.test(slugText)) return country;
  }
  for (const [re, country] of NETWORK_COUNTRIES) {
    if (re.test(text) || re.test(slugText)) return country;
  }
  for (const [re, country] of SUFFIX_COUNTRIES) {
    if (re.test(text)) return country;
  }
  return knownCountry || 'Latinoamérica';
}

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

function buildLogoIndex() {
  const exact = new Map();
  const loose = new Map();
  const add = (name, logo) => {
    const cleanLogo = String(logo || '').trim();
    if (!/^https?:\/\//i.test(cleanLogo)) return;
    const s = slugOf(name);
    if (s && !exact.has(s)) exact.set(s, cleanLogo);
    const k = normKey(name);
    if (k && k.length >= 3 && !loose.has(k)) loose.set(k, cleanLogo);
  };

  for (const [k, url] of Object.entries(CHANNEL_LOGOS || {})) add(k, url);
  const files = [
    '../lib/data/liveChannelsSeed.json',
    '../lib/data/liveChannelsUnverifiedSeed.json',
    '../lib/data/liveChannelsMegaSeed.json',
    '../lib/data/liveChannelsEntSeed.json',
  ];
  for (const rel of files) {
    let list = [];
    try { list = require(rel); } catch { continue; }
    for (const item of list) {
      if (item && item.name && item.logo) add(item.name, item.logo);
    }
  }
  return { exact, loose };
}

function findLogo(logoIndex, name, rawName, knownLogo) {
  if (/^https?:\/\//i.test(String(knownLogo || ''))) return knownLogo;
  for (const candidate of [name, rawName]) {
    if (!candidate) continue;
    const s = slugOf(candidate);
    if (s && logoIndex.exact.has(s)) return logoIndex.exact.get(s);
    const k = normKey(candidate);
    if (k && logoIndex.loose.has(k)) return logoIndex.loose.get(k);
  }
  return '';
}

async function fetchRaw(url, { headers = {}, range = false, redirect = 'follow', timeoutMs = TIMEOUT } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const h = { ...headers };
    if (range) h.Range = 'bytes=0-2047';
    const res = await fetch(url, { headers: h, redirect, signal: controller.signal });
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      buf,
      ms: Date.now() - t0,
      contentType: res.headers.get('content-type') || '',
      cors: res.headers.get('access-control-allow-origin') || '',
      server: res.headers.get('server') || '',
      location: res.headers.get('location') || '',
    };
  } catch (err) {
    return {
      status: 0,
      buf: Buffer.alloc(0),
      ms: Date.now() - t0,
      error: `${err?.name || 'err'}:${err?.cause?.code || err?.message || ''}`.slice(0, 60),
    };
  } finally { clearTimeout(timer); }
}

/**
 * Sonda un ID completo: maestra → variante/segmento.
 * Devuelve:
 *   - { state: 'dead', id, status }
 *   - { state: 'broken', id, slug, edgeHost, segStatus, segError, targetDuration, masterMs }
 *   - { state: 'alive', id, slug, edgeHost, segStatus, segFormat, targetDuration, masterMs, segMs, variants }
 */
async function probeId(id) {
  const url = `${BASE}${PATH_PREFIX}${id}.m3u8`;
  const master = await fetchRaw(url, { headers: { 'User-Agent': GENERIC_UA } });
  if (master.status !== 200 || !master.buf.includes('#EXTM3U')) {
    return { state: 'dead', id, status: master.status };
  }

  const text = master.buf.toString('utf8');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const tdMatch = text.match(/#EXT-X-TARGETDURATION:(\d+)/i);
  const targetDuration = tdMatch ? Number(tdMatch[1]) : null;
  const variants = lines.filter((l) => l.startsWith('#EXT-X-STREAM-INF')).length;
  const first = lines.find((l) => !l.startsWith('#'));

  const extractMeta = (bodyStr) => {
    const slugMatch = /get_ts\/[^/]+\/[^/]+\/([^/]+)\//.exec(bodyStr);
    const hostMatch = /https?:\/\/([a-z0-9.-]+\.tvcluboficial\.com)/i.exec(bodyStr);
    return {
      slug: slugMatch ? slugMatch[1] : '',
      edgeHost: hostMatch ? hostMatch[1].toLowerCase() : 'm3u.tvcluboficial.com',
    };
  };

  if (!first) {
    return {
      state: 'broken',
      id,
      slug: '',
      edgeHost: 'm3u.tvcluboficial.com',
      segStatus: 0,
      segError: 'playlist_sin_entradas',
      targetDuration,
      masterMs: master.ms,
    };
  }

  const isSegment = !/\.m3u8(?:$|\?)/i.test(first);
  const nextUrl = first.startsWith('http') ? first : new URL(first, url).href;
  let { slug, edgeHost } = extractMeta(first);

  let segRes;
  if (isSegment) {
    segRes = await fetchRaw(nextUrl, { headers: { 'User-Agent': GENERIC_UA }, range: true });
  } else {
    const media = await fetchRaw(nextUrl, { headers: { 'User-Agent': GENERIC_UA } });
    if (media.status !== 200 || !media.buf.includes('#EXTM3U')) {
      return {
        state: 'broken',
        id,
        slug,
        edgeHost,
        segStatus: media.status,
        segError: media.error || 'variante_no_m3u8',
        targetDuration,
        masterMs: master.ms,
      };
    }
    const mediaText = media.buf.toString('utf8');
    const mMeta = extractMeta(mediaText);
    if (!slug) slug = mMeta.slug;
    if (mMeta.edgeHost) edgeHost = mMeta.edgeHost;
    const segLine = mediaText.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
    if (!segLine) {
      return {
        state: 'broken',
        id,
        slug,
        edgeHost,
        segStatus: 0,
        segError: 'variante_sin_segmentos',
        targetDuration,
        masterMs: master.ms,
      };
    }
    const segUrl = segLine.startsWith('http') ? segLine : new URL(segLine, nextUrl).href;
    segRes = await fetchRaw(segUrl, { headers: { 'User-Agent': GENERIC_UA }, range: true });
  }

  const ok = (segRes.status === 200 || segRes.status === 206) && segRes.buf.length >= 100;
  if (!ok) {
    return {
      state: 'broken',
      id,
      slug,
      edgeHost,
      segStatus: segRes.status,
      segError: segRes.error || `bytes=${segRes.buf.length}`,
      targetDuration,
      masterMs: master.ms,
    };
  }

  const looksTs = segRes.buf[0] === 0x47;
  const looksFmp4 = segRes.buf.slice(0, 12).includes('ftyp');
  const segFormat = looksTs ? 'MPEG-TS' : (looksFmp4 ? 'fMP4' : 'otro');

  return {
    state: 'alive',
    id,
    slug,
    edgeHost,
    segStatus: segRes.status,
    segFormat,
    targetDuration,
    masterMs: master.ms,
    segMs: segRes.ms,
    variants,
  };
}

async function runPool(ids, workerFn) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < ids.length) {
      const id = ids[i++];
      results.push(await workerFn(id));
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length || 1) }, worker));
  return results;
}

(async () => {
  const out = [];
  const say = (line = '') => { out.push(line); console.log(line); };
  const t0 = Date.now();

  try {
    say('# Mega-sonda completa: tvcluboficial.com');
    say('');
    say(`Fecha: ${new Date().toISOString()}`);
    say('');

    // 1. Auditoría de hosts y endpoints
    say('## 1. Hosts y endpoints');
    say('');
    say('| URL | HTTP | Content-Type | CORS | Server | Latencia | Nota |');
    say('|---|---|---|---|---|---|---|');
    const endpoints = [
      ['http://tvcluboficial.com/', 'raíz HTTP'],
      ['https://tvcluboficial.com/', 'raíz HTTPS'],
      ['http://m3u.tvcluboficial.com/', 'm3u HTTP'],
      ['https://m3u.tvcluboficial.com/', 'm3u HTTPS'],
      [`${BASE}/player_api.php?username=x&password=x`, 'Xtream player_api'],
      [`${BASE}/get.php?username=x&password=x&type=m3u_plus`, 'Xtream get.php'],
      [`${BASE}/xmltv.php?username=x&password=x`, 'EPG xmltv.php'],
      [`${BASE}/panel_api.php?username=x&password=x`, 'Xtream panel_api'],
      [`${BASE}/playlist.m3u`, 'playlist pública'],
    ];
    for (const [epUrl, label] of endpoints) {
      const r = await fetchRaw(epUrl, { headers: { 'User-Agent': GENERIC_UA }, redirect: 'manual', timeoutMs: 6000 });
      const note = r.error ? r.error : (r.location ? `→ ${r.location.slice(0, 60)}` : label);
      say(`| ${epUrl.replace(/\?.*$/, '')} | ${r.status} | ${(r.contentType || '—').slice(0, 32)} | ${r.cors || '—'} | ${(r.server || '—').slice(0, 24)} | ${r.ms} ms | ${note} |`);
    }
    say('');

    // 2. Barrido denso 1..DENSE_MAX + centinelas DENSE_MAX..SENTINEL_MAX
    const known = knownChannels();
    const logoIndex = buildLogoIndex();
    const prevMaxKnown = Math.max(0, ...known.keys());

    const denseIds = Array.from({ length: DENSE_MAX }, (_, idx) => idx + 1);
    const denseRes = await runPool(denseIds, probeId);

    const sentinelIds = [];
    for (let id = DENSE_MAX + SENTINEL_STEP; id <= SENTINEL_MAX; id += SENTINEL_STEP) {
      sentinelIds.push(id);
    }
    const sentinelRes = await runPool(sentinelIds, probeId);
    const sentinelHits = sentinelRes.filter((r) => r.state !== 'dead');

    // Si algún centinela > 3500 responde, expandimos ±EXPAND_RADIUS a su alrededor.
    const extraSet = new Set();
    const scannedSet = new Set([...denseIds, ...sentinelIds]);
    for (const hit of sentinelHits) {
      for (let d = -EXPAND_RADIUS; d <= EXPAND_RADIUS; d += 1) {
        const cand = hit.id + d;
        if (cand > DENSE_MAX && cand <= SENTINEL_MAX && !scannedSet.has(cand)) {
          extraSet.add(cand);
          scannedSet.add(cand);
        }
      }
    }
    const extraRes = extraSet.size ? await runPool([...extraSet].sort((a, b) => a - b), probeId) : [];

    const allRes = [...denseRes, ...sentinelRes, ...extraRes];
    const alive = allRes.filter((r) => r.state === 'alive').sort((a, b) => a.id - b.id);
    const broken = allRes.filter((r) => r.state === 'broken').sort((a, b) => a.id - b.id);
    const deadCount = allRes.length - alive.length - broken.length;

    // 3. Prueba de cabeceras / User-Agent sobre el primer canal vivo
    if (alive.length) {
      const sampleId = alive[0].id;
      const sampleUrl = `${BASE}${PATH_PREFIX}${sampleId}.m3u8`;
      say(`## 2. Requisitos de acceso (canal muestra id ${sampleId})`);
      say('');
      say('| Perfil | HTTP | Content-Type | CORS | #EXTM3U | Latencia |');
      say('|---|---|---|---|---|---|');
      const profiles = [
        ['UA Android', { 'User-Agent': ANDROID_UA }],
        ['UA navegador genérico', { 'User-Agent': GENERIC_UA }],
        ['Sin User-Agent', {}],
        ['Con Referer al host', { 'User-Agent': GENERIC_UA, Referer: `${BASE}/` }],
      ];
      for (const [label, headers] of profiles) {
        const r = await fetchRaw(sampleUrl, { headers, timeoutMs: 6000 });
        say(`| ${label} | ${r.status} | ${(r.contentType || '—').slice(0, 32)} | ${r.cors || '—'} | ${r.buf.includes('#EXTM3U') ? 'sí' : 'no'} | ${r.ms} ms |`);
      }
      say('');
    }

    // 4. Resumen del mega-barrido
    const maxAliveId = alive.length ? alive[alive.length - 1].id : 0;
    const minAliveId = alive.length ? alive[0].id : 0;
    const masterLatencies = alive.map((r) => r.masterMs);
    const segLatencies = alive.map((r) => r.segMs);
    const formatCounts = new Map();
    for (const a of alive) formatCounts.set(a.segFormat, (formatCounts.get(a.segFormat) || 0) + 1);

    say('## 3. Resumen del barrido');
    say('');
    say(`- **IDs sondeados**: ${allRes.length} (denso \`1..${DENSE_MAX}\` + ${sentinelIds.length} centinelas \`${DENSE_MAX + SENTINEL_STEP}..${SENTINEL_MAX}\`${extraRes.length ? ` + ${extraRes.length} expandidos` : ''})`);
    say(`- **IDs vivos (cadena HLS completa OK)**: **${alive.length}** (rango \`${minAliveId}..${maxAliveId}\`)`);
    say(`- **Maestras rotas (200 #EXTM3U pero segmento fallido)**: ${broken.length}`);
    say(`- **IDs inactivos (404/vacíos)**: ${deadCount}`);
    say(`- **Hallazgos en centinelas > ${DENSE_MAX}**: ${sentinelHits.length}`);
    say(`- **Latencia maestra**: p50 = ${percentile(masterLatencies, 50)} ms · p95 = ${percentile(masterLatencies, 95)} ms`);
    say(`- **Latencia primer segmento**: p50 = ${percentile(segLatencies, 50)} ms · p95 = ${percentile(segLatencies, 95)} ms`);
    say(`- **Formato de segmentos**: ${[...formatCounts].map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'}`);
    say(`- **Duración total de la mega-sonda**: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    say('');

    // 5. Topología del clúster tsN.tvcluboficial.com
    const edgeStats = new Map();
    const bumpEdge = (host, field) => {
      if (!edgeStats.has(host)) edgeStats.set(host, { alive: 0, broken: 0, latencies: [] });
      edgeStats.get(host)[field] += 1;
    };
    for (const a of alive) {
      bumpEdge(a.edgeHost, 'alive');
      edgeStats.get(a.edgeHost).latencies.push(a.segMs);
    }
    for (const b of broken) bumpEdge(b.edgeHost, 'broken');

    say('## 4. Clúster de servidores de segmentos (`tsN.tvcluboficial.com`)');
    say('');
    say('| Servidor | Vivos | Segmento roto | Latencia seg. p50 |');
    say('|---|---:|---:|---:|');
    for (const [host, st] of [...edgeStats].sort((a, b) => (b[1].alive + b[1].broken) - (a[1].alive + a[1].broken))) {
      say(`| ${host} | ${st.alive} | ${st.broken} | ${st.latencies.length ? `${percentile(st.latencies, 50)} ms` : '—'} |`);
    }
    say('');

    // 6. Construcción de semilla enriquecida (país + tema + logos)
    const picked = [];
    const byCountry = new Map();
    const byTopic = new Map();
    const duplicates = [];
    let withKnownName = 0;
    let withSlugName = 0;
    let withLogo = 0;
    const usedKeys = new Map();

    for (const item of alive) {
      const k = known.get(item.id);
      const rawName = k ? k.name : (humanizeSlug(item.slug) || `tvclub ${item.id}`);
      const topic = k?.topic || thematicCategoryOf(rawName, '');
      const name = cleanName(rawName, topic);
      if (!name || (name.match(/[a-záéíóúñ]/gi) || []).length < 2) continue;

      const country = inferCountry(rawName, item.slug, k?.country);
      const key = `${country}|${slugOf(name)}`;
      if (usedKeys.has(key)) {
        duplicates.push({ id: item.id, primaryId: usedKeys.get(key), name, slug: item.slug });
        continue;
      }
      usedKeys.set(key, item.id);

      const logo = findLogo(logoIndex, name, rawName, k?.logo);
      if (k) withKnownName += 1;
      else if (item.slug) withSlugName += 1;
      if (logo) withLogo += 1;

      picked.push({
        name,
        slug: slugOf(name) || `tvclub-${item.id}`,
        topic,
        country,
        logo,
        url: `${BASE}${PATH_PREFIX}${item.id}.m3u8`,
      });
      byCountry.set(country, (byCountry.get(country) || 0) + 1);
      byTopic.set(topic, (byTopic.get(topic) || 0) + 1);
    }

    say('## 5. Catálogo resultante y cobertura');
    say('');
    say(`- **Canales únicos válidos**: **${picked.length}** (duplicados colapsados: ${duplicates.length})`);
    say(`- **Origen del nombre**: ${withKnownName} conocidos · ${withSlugName} por slug interno · ${picked.length - withKnownName - withSlugName} genéricos`);
    say(`- **Cobertura de logos**: **${withLogo}/${picked.length}** (${picked.length ? Math.round((withLogo / picked.length) * 100) : 0} %)`);
    say(`- **IDs vivos por encima del máximo previo (${prevMaxKnown})**: ${alive.filter((a) => a.id > prevMaxKnown).length}`);
    say('');

    say('### Por país');
    say('');
    for (const [country, n] of [...byCountry].sort((a, b) => b[1] - a[1])) {
      say(`- ${country}: ${n}`);
    }
    say('');

    say('### Por tema');
    say('');
    for (const [topic, n] of [...byTopic].sort((a, b) => b[1] - a[1])) {
      say(`- ${topic}: ${n}`);
    }
    say('');

    const abovePrev = alive.filter((a) => a.id > 1181);
    if (abovePrev.length) {
      say('### Nuevos IDs descubiertos por encima de 1181');
      say('');
      for (const a of abovePrev.slice(0, 40)) {
        say(`- id ${a.id}: \`${a.slug || 'sin-slug'}\` (${a.edgeHost}, ${a.segFormat}, ${a.segMs} ms)`);
      }
      say('');
    }

    if (broken.length) {
      say(`### Muestra de maestras rotas (${broken.length} en total)`);
      say('');
      for (const b of broken.slice(0, 20)) {
        say(`- id ${b.id} (\`${b.slug || 'sin-slug'}\` · ${b.edgeHost}): segmento HTTP ${b.segStatus} ${b.segError}`);
      }
      say('');
    }

    if (duplicates.length) {
      say(`### Muestra de señales duplicadas colapsadas (${duplicates.length} en total)`);
      say('');
      for (const d of duplicates.slice(0, 20)) {
        say(`- ${d.name}: id ${d.id} duplicado de id ${d.primaryId}`);
      }
      say('');
    }

    // Guarda del 80 % antes de sobrescribir la semilla
    let current = [];
    try { current = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8')); } catch {}
    const floor = current.length ? Math.floor(current.length * 0.8) : 30;
    if (picked.length >= floor) {
      fs.writeFileSync(OUT_JSON, JSON.stringify(picked, null, 1) + '\n');
      say(`semilla tvclub escrita: ${current.length} -> ${picked.length}`);
    } else {
      say(`semilla tvclub NO escrita: ${picked.length} < ${floor} (guarda del 80 %)`);
    }
  } catch (err) {
    say(`ERROR: ${err.message}`);
    process.exitCode = 1;
  } finally {
    fs.mkdirSync('.probe', { recursive: true });
    fs.writeFileSync(OUT_MD, out.join('\n') + '\n');
  }
})();
