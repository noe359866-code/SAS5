#!/usr/bin/env node
/**
 * Sonda de m3u.tvcluboficial.com para la LISTA M3U (petición del usuario,
 * 25-11-2026: «añade canales… sonda a tvcluboficial y a iptvgo.cc»).
 *
 * Corre en GitHub Actions (desde el sandbox local no hay ruta al host).
 * Las credenciales Xtream salen de las propias URLs públicas de la semilla
 * verificada (`/free/ReachBot/Kip/<id>.m3u8`). Estrategia:
 *
 *   1. player_api (login → categorías → todos los streams);
 *   2. si falla, get.php?type=m3u_plus parseada con lib/liveChannels.js.
 *
 * El panel es latino: se incluye todo lo que no sea adulto o región ajena
 * (mismo filtro de prefijos que la mega-sonda iptvgo). Sin prefijo de país,
 * el canal cae en el grupo «Latinoamérica». Escribe
 * `lib/data/liveChannelsTvclubSeed.json` con guarda del 80 % y el informe
 * en `.probe/tvclub-mega.md`. No se imprimen credenciales.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');

const GENERIC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TIMEOUT = 60_000;

// Credencial pública embebida en las URLs de la semilla verificada.
const BASE = 'http://m3u.tvcluboficial.com';
const USER = 'ReachBot';
const PASS = 'Kip';

const OUT_JSON = 'lib/data/liveChannelsTvclubSeed.json';
const OUT_MD = '.probe/tvclub-mega.md';

/** Adulto: nunca entra a la lista. */
const EXCLUDE_ADULT = /xxx|adult|porn|playboy|hustler|brazzers|onlyfans|red ?light|venus|erotic|babes|private ?tv|\bsex\b|mature|hot ?tv|\+\s?18/i;

/** Prefijos de región ajenos (panel latino: todo lo demás entra). */
const EXCLUDE_PREFIX = new Set([
  'DE', 'AR', 'PT', 'LIVE', 'REPLAY', 'UK', 'FR', 'IT', 'IN', 'PK', 'TR', 'NL',
  'BE', 'PL', 'RU', 'RO', 'GR', 'IL', 'IR', 'AF', 'AU', 'NZ', 'SE', 'NO', 'DK',
  'FI', 'CZ', 'HU', 'HR', 'RS', 'BG', 'UA', 'AL', 'ZA', 'NG', 'GH', 'KE', 'CN',
  'JP', 'KR', 'TH', 'VN', 'ID', 'MY', 'SG', 'PH', 'BD', 'IQ', 'EG', 'SA', 'AE',
  'QA', 'KW', 'MA', 'DZ', 'TN', 'LY', 'JO', 'LB', 'SY', 'YE', 'OM', 'BH', 'PS',
  'SD', 'EE', 'LV', 'LT', 'IE', 'MT', 'CY', 'IS', 'USA', 'CANADA', 'CAN', 'US',
]);
// Nota: USA/Canadá tampoco entran desde tvclub — ese bloque ya lo cubre la
// mega-sonda de iptvgo con miles de señales; aquí sumamos lo latino.

/** Prefijo de categoría → país (claves sin acentos, normalizadas). */
const PREFIX_COUNTRY = {
  LATINO: 'Latinoamérica', LATIN: 'Latinoamérica', LATAM: 'Latinoamérica', LATINOS: 'Latinoamérica',
  SPAIN: 'España', ESPANA: 'España', ES: 'España',
  MEXICO: 'México', MEX: 'México', MX: 'México',
  ARGENTINA: 'Argentina', ARG: 'Argentina',
  BOLIVIA: 'Bolivia', BOL: 'Bolivia', BO: 'Bolivia',
  CHILE: 'Chile', CHI: 'Chile', CL: 'Chile',
  COLOMBIA: 'Colombia', COL: 'Colombia', CO: 'Colombia',
  'COSTA RICA': 'Costa Rica', CRI: 'Costa Rica', CR: 'Costa Rica',
  DOMINICANA: 'Rep. Dominicana', DOMINICAN: 'Rep. Dominicana', 'REP DOM': 'Rep. Dominicana',
  'REPUBLICA DOMINICANA': 'Rep. Dominicana', RD: 'Rep. Dominicana', DO: 'Rep. Dominicana',
  ECUADOR: 'Ecuador', ECU: 'Ecuador', EC: 'Ecuador',
  'EL SALVADOR': 'El Salvador', SALVADOR: 'El Salvador', SLV: 'El Salvador', SV: 'El Salvador',
  GUATEMALA: 'Guatemala', GTM: 'Guatemala', GUA: 'Guatemala', GT: 'Guatemala',
  HONDURAS: 'Honduras', HND: 'Honduras', HON: 'Honduras', HN: 'Honduras',
  NICARAGUA: 'Nicaragua', NIC: 'Nicaragua', NI: 'Nicaragua',
  PANAMA: 'Panamá', PAN: 'Panamá', PA: 'Panamá',
  PARAGUAY: 'Paraguay', PRY: 'Paraguay', PY: 'Paraguay',
  PERU: 'Perú', PER: 'Perú', PE: 'Perú',
  'PUERTO RICO': 'Puerto Rico', PRI: 'Puerto Rico', PR: 'Puerto Rico',
  URUGUAY: 'Uruguay', URY: 'Uruguay', UY: 'Uruguay',
  VENEZUELA: 'Venezuela', VEN: 'Venezuela', VE: 'Venezuela',
  BRASIL: 'Brasil', BRAZIL: 'Brasil', BRA: 'Brasil', BR: 'Brasil',
  CARIBBEAN: 'Caribe', CARIBE: 'Caribe',
};

/** Tema por nombre de categoría (manda sobre el nombre del canal). */
const CATEGORY_TOPIC = [
  [/sport|deport|futbol|soccer|espn|fox sports|bein|dazn|tyc|dsports|nba|nfl|mlb|nhl|mls|ufc|wwe|box/i, 'deportes'],
  [/news|noticia|informativ/i, 'noticias'],
  [/kids|infantil|cartoon|disney junior|nickelodeon|\bnick\b|baby/i, 'infantil'],
  [/anime|crunchyroll|animax/i, 'anime'],
  [/music|m[uú]sica|radio|\bmtv\b|karaoke/i, 'musica'],
  [/docu|discovery|nat ?geo|history|animal planet|cultura/i, 'documentales'],
  [/relig|church|god tv|enlace|ewtn|catolic|cristian/i, 'religion'],
  [/cine|movie|pel[ií]cula|cinema|hallmark|\bfilm/i, 'cine'],
  [/series|novela|entreten|entertain|reality|show|variedad/i, 'entretenimiento'],
];

const { cleanChannelName: cleanName } = require('../lib/liveChannelNames');
const { thematicCategoryOf } = require('../lib/liveTopics');
const { parseM3U } = require('../lib/liveChannels');

const BANNER = /[☆▁▂▄▅▆▇█▀]|={3,}|\|{3,}|-{4,}/;
const isDecoration = (raw) => BANNER.test(String(raw || ''));

const normPrefix = (value) => String(value || '').trim().toUpperCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[.\-_]+/g, ' ').replace(/\s+/g, ' ');

const slugOf = (name) => String(name || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

async function get(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': GENERIC_UA }, signal: controller.signal });
    return { status: res.status, text: await res.text() };
  } finally { clearTimeout(timer); }
}

(async () => {
  const out = [];
  const say = (line) => { out.push(line); console.log(line); };
  try {
    say('# Sonda m3u.tvcluboficial.com (panel Xtream, para la lista M3U)');
    say('');
    say(`Fecha: ${new Date().toISOString()}`);
    say('');

    // 1) player_api
    let channels = []; // {name, group, logo, url}
    let mode = 'player_api';
    const login = await get(`${BASE}/player_api.php?username=${USER}&password=${PASS}`);
    let status = '—';
    try { status = JSON.parse(login.text)?.user_info?.status || '—'; } catch {}
    say(`login: HTTP ${login.status} · status ${status}`);

    if (String(status).toLowerCase() === 'active') {
      const [cats, streams] = await Promise.all([
        get(`${BASE}/player_api.php?username=${USER}&password=${PASS}&action=get_live_categories`),
        get(`${BASE}/player_api.php?username=${USER}&password=${PASS}&action=get_live_streams`),
      ]);
      const catName = new Map((JSON.parse(cats.text) || []).map((c) => [String(c.category_id), c.category_name]));
      const all = JSON.parse(streams.text) || [];
      say(`panel: ${all.length} canales · ${catName.size} categorías`);
      for (const ch of all) {
        channels.push({
          name: ch.name,
          group: catName.get(String(ch.category_id)) || '',
          logo: ch.stream_icon || '',
          url: `${BASE}/free/${USER}/${PASS}/${ch.stream_id}.m3u8`,
        });
      }
    } else {
      // 2) get.php m3u_plus de respaldo
      mode = 'get.php';
      const pl = await get(`${BASE}/get.php?username=${USER}&password=${PASS}&type=m3u_plus&output=ts`);
      say(`get.php: HTTP ${pl.status} · ${pl.text.length} bytes`);
      if (!/^#EXTM3U/.test(pl.text.trim())) throw new Error('ni player_api ni get.php respondieron con canales');
      for (const e of parseM3U(pl.text)) {
        channels.push({ name: e.name, group: e.group, logo: e.logo, url: e.url });
      }
      say(`playlist: ${channels.length} entradas`);
    }

    const seen = new Set();
    const picked = [];
    const byGroup = new Map();
    let skippedAdult = 0;
    let skippedRegion = 0;
    let skippedJunk = 0;

    for (const ch of channels) {
      const group = String(ch.group || '').trim();
      if (EXCLUDE_ADULT.test(group) || EXCLUDE_ADULT.test(ch.name)) { skippedAdult += 1; continue; }
      const prefix = normPrefix(group.split(/[|:]/)[0] || group);
      if (EXCLUDE_PREFIX.has(prefix)) { skippedRegion += 1; continue; }
      if (isDecoration(ch.name)) { skippedJunk += 1; continue; }

      const country = PREFIX_COUNTRY[prefix] || 'Latinoamérica';
      let topic = '';
      for (const [re, t] of CATEGORY_TOPIC) if (re.test(group)) { topic = t; break; }
      const name = cleanName(ch.name, topic || undefined);
      if (!topic) topic = thematicCategoryOf(name, '');
      if (!name || (name.match(/[a-záéíóúñ]/gi) || []).length < 2) { skippedJunk += 1; continue; }

      const key = `${country}|${slugOf(name)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push({ name, slug: slugOf(name), topic, country, logo: ch.logo || '', url: ch.url });
      byGroup.set(country, (byGroup.get(country) || 0) + 1);
    }

    say(`modo: ${mode} · filtrado: ${skippedAdult} adulto · ${skippedRegion} otras regiones · ${skippedJunk} basura`);
    say('');
    say('## Canales por grupo');
    say('');
    for (const [group, n] of [...byGroup].sort((a, b) => b[1] - a[1])) say(`- ${group}: ${n}`);
    say('');
    say(`total: ${picked.length} canales`);

    let current = [];
    try { current = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8')); } catch {}
    const floor = current.length ? Math.floor(current.length * 0.8) : 50;
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
