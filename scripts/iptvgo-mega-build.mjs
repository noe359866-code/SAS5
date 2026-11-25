#!/usr/bin/env node
/**
 * Mega-semilla de iptvgo.cc para la LISTA M3U por países (petición del
 * usuario, 25-11-2026): «+13 mil canales de LATAM, Brasil, España y USA y
 * eventos y más», ordenados por país en `listas/ramdonlatam-tv.m3u`.
 *
 * Corre en GitHub Actions (desde el sandbox local no hay ruta a iptvgo.cc).
 * Consulta la player_api, filtra las regiones pedidas (LATAM + Brasil +
 * España + EE. UU./Canadá + eventos/PPV + 24/7 + plataformas tipo Netflix,
 * HBO Max, Disney+, Apple TV+, Prime Video, Hulu, Peacock, Paramount+, Tubi,
 * Samsung TV+, Plex, Hallmark, Navidad), excluye adulto y el resto de
 * regiones, limpia nombres, deduplica por «país|nombre» y escribe
 * `lib/data/liveChannelsMegaSeed.json` (con guarda: nunca menos del 80 % de
 * lo que hubiera, y nunca menos de 1.000 en la primera escritura).
 *
 * NO verifica streams (los segmentos del panel dan 403 desde datacenter):
 * todo lo que sale de aquí lleva «⚠️ sin verificar» en la lista.
 * No se imprimen credenciales.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');

const GENERIC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TIMEOUT = 60_000;

// Credencial compartida por el usuario en la URL de ejemplo.
const BASE = 'http://iptvgo.cc';
const qs = 'username=Will1&password=Will1';

const OUT_JSON = 'lib/data/liveChannelsMegaSeed.json';
const OUT_MD = '.probe/iptvgo-mega.md';

/** Adulto: nunca entra a la lista. */
const EXCLUDE_ADULT = /xxx|adult|porn|playboy|hustler|brazzers|onlyfans|red ?light|venus|erotic|babes|private ?tv|\bsex\b|mature|hot ?tv/i;

/** Regiones fuera de la petición (LATAM + Brasil + España + USA/Canadá). */
const EXCLUDE_REGION = /united kingdom|\buk\b|ireland|irish|german|deutsch|france|french|\bfr\b|ital|\bit\b|portugal|arab|turk|india|pakistan|bangla|philip|indones|korea|japan|china|viet|thai|russia|poland|dutch|netherland|belgi|africa|albania|romania|greek|greece|israel|iran|afghan|australia|\bnz\b|swiss|austria|hungary|czech|serbia|croatia|bulgaria|ukraine|sweden|norway|denmark|finland|exyu|balkan|persia|hebrew|malay|singapore|south africa|nigeria|ghana|kenya/i;

/** Lo que sí entra: regiones pedidas + eventos + 24/7 + plataformas + temas generales. */
const INCLUDE = /spain|espa|latin|latam|mexic|argentin|bolivia|chile|chili|colombia|costa.?rica|dominic|ecuador|salvador|guatemal|hondura|nicaragua|panam|paraguay|peru|per[uú]|puerto|caraib|caribbean|uruguay|venezu|brasil|brazil|\busa\b|united states|canad|24\/7|247|ppv|event|netflix|hbomax|hbo max|prime ?video|disney\+|disneyplus|apple ?tv|appletv|hulu|peacock|paramount\+|tubi|samsung ?tv|plex|xmas|christmas|hallmark|movies?|cine|pel[ií]cula|deport|sport|music|m[uú]sica|kids|infantil|anime|news|noticia|documental|docu|novela|series|reality|entertainment|entreten/i;

/** Alias de prefijo de categoría → etiqueta de país/región de la lista. */
const PREFIX_COUNTRY = {
  USA: 'EE. UU.', US: 'EE. UU.', 'UNITED STATES': 'EE. UU.',
  CANADA: 'Canadá', CAN: 'Canadá',
  LATINO: 'Latinoamérica', LATIN: 'Latinoamérica', LATAM: 'Latinoamérica', LATINOS: 'Latinoamérica',
  SPAIN: 'España', ESPANA: 'España', 'ESPAÑA': 'España',
  MEXICO: 'México', MEX: 'México',
  ARGENTINA: 'Argentina', ARG: 'Argentina',
  BOLIVIA: 'Bolivia', BOL: 'Bolivia',
  CHILE: 'Chile', CHI: 'Chile',
  COLOMBIA: 'Colombia', COL: 'Colombia',
  'COSTA RICA': 'Costa Rica', CRI: 'Costa Rica',
  DOMINICANA: 'Rep. Dominicana', DOMINICAN: 'Rep. Dominicana', 'REP DOM': 'Rep. Dominicana', RD: 'Rep. Dominicana',
  ECUADOR: 'Ecuador', ECU: 'Ecuador',
  'EL SALVADOR': 'El Salvador', SALVADOR: 'El Salvador', SLV: 'El Salvador',
  GUATEMALA: 'Guatemala', GTM: 'Guatemala', GUA: 'Guatemala',
  HONDURAS: 'Honduras', HND: 'Honduras', HON: 'Honduras',
  NICARAGUA: 'Nicaragua', NIC: 'Nicaragua',
  PANAMA: 'Panamá', PAN: 'Panamá',
  PARAGUAY: 'Paraguay', PRY: 'Paraguay',
  PERU: 'Perú', PER: 'Perú',
  'PUERTO RICO': 'Puerto Rico', PRI: 'Puerto Rico',
  URUGUAY: 'Uruguay', URY: 'Uruguay',
  VENEZUELA: 'Venezuela', VEN: 'Venezuela',
  BRASIL: 'Brasil', BRAZIL: 'Brasil', BRA: 'Brasil',
  CARIBBEAN: 'Caribe', CARIBE: 'Caribe',
};

/** Categoría del panel → etiqueta de grupo (país/región/bloque especial). */
function countryOfCategory(cat) {
  const raw = String(cat || '').trim();
  const upper = raw.toUpperCase();
  // Bloques especiales primero
  if (/^24[\/\- ]?7/.test(upper)) return '24/7';
  if (/PPV|EVENT/.test(upper)) return 'Eventos';
  if (/XMAS|CHRISTMAS|NAVIDAD/.test(upper)) return 'Navidad';
  if (/NETFLIX|HBO ?MAX|PRIME ?VIDEO|DISNEY\+|APPLE ?TV|HULU|PEACOCK|PARAMOUNT\+|TUBI|PLEX|SAMSUNG ?TV|HALLMARK/.test(upper)
      && !/USA|LATIN|MEXIC|SPAIN|ESPA/.test(upper)) return 'Plataformas';
  const prefix = (raw.split(/[|:]/)[0] || raw).trim().toUpperCase().replace(/[.\-_]+/g, ' ').replace(/\s+/g, ' ');
  if (PREFIX_COUNTRY[prefix]) return PREFIX_COUNTRY[prefix];
  // Prefijo con pinta de nombre propio corto: se respeta como grupo
  if (/^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ &']{1,23}$/.test(prefix)) {
    return prefix.toLowerCase().replace(/\b[a-záéíóúñ]/g, (c) => c.toUpperCase());
  }
  return 'Otros';
}

/** Tema por categoría del panel (manda sobre el nombre del canal). */
const PANEL_TOPIC = [
  [/sport|deport|nfl|nba|mlb|nhl|mls|ufc|wwe|boxeo|boxing|futbol|soccer|golf|tennis|racing|nascar|\bf1\b|espn|fox sports|bein|dazn|tyc|dsports|sunday ticket/i, 'deportes'],
  [/news|noticia|informativ/i, 'noticias'],
  [/kids|infantil|cartoon|disney junior|nickelodeon|\bnick\b|baby/i, 'infantil'],
  [/anime|crunchyroll|animax/i, 'anime'],
  [/music|m[uú]sica|radio|\bmtv\b|karaoke/i, 'musica'],
  [/docu|discovery|nat ?geo|history|animal planet|cultura/i, 'documentales'],
  [/relig|church|god tv|enlace|ewtn|catolic|cristian/i, 'religion'],
  [/premiere|movie|cine|pel[ií]cula|cinema|hallmark|\bfilm/i, 'cine'],
  [/netflix|hbo|prime ?video|disney\+|apple ?tv|hulu|peacock|paramount|tubi|plex|samsung|series|original|xmas|christmas|24\/7|247|ppv|event|entertain|entreten|novela|reality|show/i, 'entretenimiento'],
];

const { cleanChannelName: cleanName } = require('../lib/liveChannelNames');
const { thematicCategoryOf } = require('../lib/liveTopics');

const BANNER = /[☆▁▂▄▅▆▇█▀]|={3,}|\|{3,}|-{4,}/;
const isDecoration = (raw) => BANNER.test(String(raw || ''));

const slugOf = (name) => String(name || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

async function api(action = '') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(`${BASE}/player_api.php?${qs}${action}`, {
      headers: { 'User-Agent': GENERIC_UA }, signal: controller.signal,
    });
    const text = await res.text();
    return { status: res.status, json: JSON.parse(text) };
  } finally { clearTimeout(timer); }
}

(async () => {
  const out = [];
  const say = (line) => { out.push(line); console.log(line); };
  try {
    say('# Mega-semilla iptvgo.cc por países (SIN VERIFICAR, player_api Xtream)');
    say('');
    say(`Fecha: ${new Date().toISOString()}`);
    say('');

    const login = await api('');
    const status = login.json?.user_info?.status || '—';
    say(`login: HTTP ${login.status} · status ${status}`);
    if (String(status).toLowerCase() !== 'active') throw new Error(`login no activo: ${status}`);

    const [cats, streams] = await Promise.all([api('&action=get_live_categories'), api('&action=get_live_streams')]);
    const catName = new Map((Array.isArray(cats.json) ? cats.json : []).map((c) => [String(c.category_id), c.category_name]));
    const all = Array.isArray(streams.json) ? streams.json : [];
    say(`panel: ${all.length} canales · ${catName.size} categorías`);
    say('');

    const seen = new Set();
    const picked = [];
    const byGroup = new Map();
    let skippedAdult = 0;
    let skippedRegion = 0;
    let skippedJunk = 0;

    for (const ch of all) {
      const cat = catName.get(String(ch.category_id)) || '';
      if (EXCLUDE_ADULT.test(cat) || EXCLUDE_ADULT.test(ch.name) || String(ch.is_adult) === '1') { skippedAdult += 1; continue; }
      if (EXCLUDE_REGION.test(cat)) { skippedRegion += 1; continue; }
      if (!INCLUDE.test(cat)) { skippedRegion += 1; continue; }
      if (isDecoration(ch.name)) { skippedJunk += 1; continue; }

      const country = countryOfCategory(cat);
      let topic = '';
      for (const [re, t] of PANEL_TOPIC) if (re.test(cat)) { topic = t; break; }
      const name = cleanName(ch.name, topic || undefined);
      if (!topic) topic = thematicCategoryOf(name, '');
      if (!name || (name.match(/[a-záéíóúñ]/gi) || []).length < 2) { skippedJunk += 1; continue; }

      const key = `${country}|${slugOf(name)}`;
      if (seen.has(key)) continue; // un canal por país y nombre
      seen.add(key);
      picked.push({
        name,
        slug: slugOf(name),
        topic,
        country,
        logo: ch.stream_icon || '',
        url: `${BASE}/live/${qs.split('&')[0].split('=')[1]}/${qs.split('&')[1].split('=')[1]}/${ch.stream_id}.m3u8`,
      });
      byGroup.set(country, (byGroup.get(country) || 0) + 1);
    }

    say(`filtrado: ${skippedAdult} adulto · ${skippedRegion} otras regiones · ${skippedJunk} decoración/basura`);
    say('');
    say('## Canales por grupo');
    say('');
    for (const [group, n] of [...byGroup].sort((a, b) => b[1] - a[1])) say(`- ${group}: ${n}`);
    say('');
    say(`total: ${picked.length} canales`);

    // Guarda: no empeorar lo que hubiera (posible mal día del panel)
    let current = [];
    try { current = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8')); } catch {}
    const floor = current.length ? Math.floor(current.length * 0.8) : 1000;
    if (picked.length >= floor) {
      fs.writeFileSync(OUT_JSON, JSON.stringify(picked, null, 1) + '\n');
      say(`mega-semilla escrita: ${current.length} -> ${picked.length}`);
    } else {
      say(`mega-semilla NO escrita: ${picked.length} < ${floor} (guarda)`);
    }
  } catch (err) {
    say(`ERROR: ${err.message}`);
    process.exitCode = 1;
  } finally {
    fs.mkdirSync('.probe', { recursive: true });
    fs.writeFileSync(OUT_MD, out.join('\n') + '\n');
  }
})();
