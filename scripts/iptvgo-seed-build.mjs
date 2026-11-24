#!/usr/bin/env node
/**
 * Semilla SIN VERIFICAR de iptvgo.cc (petición del usuario, 24-11-2026).
 *
 * La sonda 14 midió: playlist abierta sin UA y player_api Xtream activa
 * (33.020 canales con nombre y logo), pero los segmentos devuelven 403 desde
 * IPs de datacenter — el vídeo no se puede verificar desde CI. El usuario
 * decide incluirlo igual, marcado «⚠️ sin verificar».
 *
 * Este script NO verifica streams (esa es la idea): consulta la player_api,
 * se queda con las categorías latinas/españolas, limpia nombres, aplica tope
 * por categoría y escribe `.probe/iptvgo-channels.json` (el workflow lo copia
 * a `lib/data/liveChannelsUnverifiedSeed.json` con guarda del 80 %).
 * Además vuelca TODAS las categorías del panel a `.probe/iptvgo-categories.md`
 * para ajustar el filtro en futuras revisiones.
 *
 * No se imprimen credenciales; las URLs del informe se redactan.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');

const GENERIC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TIMEOUT = 30_000;

// Credencial compartida por el usuario en la URL de ejemplo.
const BASE = 'http://iptvgo.cc';
const AUTH = 'Will1/Will1';
const qs = 'username=Will1&password=Will1';

/** Categorías del panel que entran: Latinoamérica, España y afines. */
const CATEGORY_INCLUDE = /spain|espa|latino|latam|latin|mexic|argentin|chile|chili|colombia|peru|per[uú]|venezu|ecuador|guatemal|hondura|salvador|nicaragua|costa.?rica|panam|dominic|puerto|bolivia|paraguay|uruguay|caraib|caribbean|cine|pel[ií]cula|novela|deportes?.*(latin|esp|mx)|dwho/i;

/** Categoría del panel → categoría del addon. */
const OUR_CATEGORY = [
  [/deport|sport|futbol|fútbol|dwho|espn|fox|bein|dsports|tnt|tyc/i, 'deportes'],
  [/infantil|kids|niñ|cartoon|disney|nick/i, 'infantil'],
  [/anime|animaci/i, 'anime'],
  [/m[uú]sica|music|radio/i, 'musica'],
  [/noticia|news|informativ/i, 'noticias'],
  [/documental|cultura|discovery|history|natgeo|nat.?geo|animal/i, 'documentales'],
  [/religi/i, 'religion'],
  [/cine|pel[ií]cula|movie/i, 'cine'],
  [/novela|reality|comedia|entreten|series|show/i, 'entretenimiento'],
  [/espa|spain/i, 'espana'],
  [/mexic/i, 'mexico'],
  [/argentin/i, 'argentina'],
  [/bolivia/i, 'bolivia'],
  [/chile|chili/i, 'chile'],
  [/colombia/i, 'colombia'],
  [/costa.?rica/i, 'costarica'],
  [/dominic/i, 'dominicana'],
  [/ecuador/i, 'ecuador'],
  [/salvador/i, 'elsalvador'],
  [/guatemal/i, 'guatemala'],
  [/hondura/i, 'honduras'],
  [/nicaragua/i, 'nicaragua'],
  [/paraguay/i, 'paraguay'],
  [/peru|per[uú]/i, 'peru'],
  [/puerto|caraib|caribbean/i, 'puertorico'],
  [/venezu/i, 'venezuela'],
];

const CAP_PER_CATEGORY = 80;

const out = [];
const say = (line) => { out.push(line); console.log(line); };

const slugOf = (name) => String(name || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

const cleanName = (name) => String(name || '')
  .replace(/^(?:[🇦-🇿]{2}|[☀-➿]|[🌀-🫿]|\u200D|️|\s)+/u, '') // banderas y emoji
  .replace(/^\|?[A-Z]{2,6}\|\s*/u, '')           // etiqueta de grupo «|LAM| »
  .replace(/[\u1D00-\u1DBF]+/gu, '')               // calidad en superíndice «ᵁᴴᴰ»
  .replace(/\s+/g, ' ')
  .trim();

/** Filas decorativas del panel («===|||-Puerto Rico-|||===»): no son canales. */
const isDecoration = (name) => {
  const letters = (String(name || '').match(/[a-záéíóúñ]/gi) || []).length;
  return letters < 2;
};

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
 try {
  say('# Semilla iptvgo.cc (SIN VERIFICAR, player_api Xtream)');
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

  // Volcado completo de categorías para revisión humana
  const countByCat = new Map();
  for (const c of all) countByCat.set(String(c.category_id), (countByCat.get(String(c.category_id)) || 0) + 1);
  const dump = ['# Categorías del panel iptvgo.cc (player_api)', '', `Fecha: ${new Date().toISOString()}`, '',
    '| Categoría | Canales | ¿Entra al filtro? |', '|---|---|---|'];
  for (const [id, name] of [...catName.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])))) {
    dump.push(`| ${name} | ${countByCat.get(id) || 0} | ${CATEGORY_INCLUDE.test(name) ? 'SÍ' : 'no'} |`);
  }
  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/iptvgo-categories.md', dump.join('\n') + '\n');

  // Filtro + mapeo + limpieza
  const picked = [];
  const seen = new Set();
  for (const ch of all) {
    const cat = catName.get(String(ch.category_id)) || '';
    if (!CATEGORY_INCLUDE.test(cat)) continue;
    let category = '';
    for (const [re, ours] of OUR_CATEGORY) if (re.test(cat) || re.test(ch.name)) { category = ours; break; }
    if (!category) continue;
    const name = cleanName(ch.name);
    if (!name || isDecoration(name)) continue;
    const key = `${category}:${slugOf(name)}`;
    if (seen.has(key)) continue; // un canal por nombre y categoría
    seen.add(key);
    picked.push({
      name,
      slug: slugOf(name),
      category,
      logo: /^https?:\/\//.test(ch.stream_icon || '') ? ch.stream_icon : '',
      url: `${BASE}/live/${AUTH}/${ch.stream_id}.m3u8`,
      ua: '',
      ref: '',
      unverified: true,
    });
  }

  // Tope por categoría, orden alfabético
  const perCat = new Map();
  const seed = [];
  for (const ch of picked.sort((a, b) => a.name.localeCompare(b.name, 'es'))) {
    const n = perCat.get(ch.category) || 0;
    if (n >= CAP_PER_CATEGORY) continue;
    perCat.set(ch.category, n + 1);
    seed.push(ch);
  }

  say('');
  say('## Semilla resultante (sin verificar)');
  say('');
  const byCat = {};
  for (const c of seed) byCat[c.category] = (byCat[c.category] || 0) + 1;
  for (const [cat, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) say(`- ${cat}: ${n}`);
  say(`- total: ${seed.length}`);

  fs.writeFileSync('.probe/iptvgo-channels.json', JSON.stringify(seed, null, 1) + '\n');
  console.log(`\n.probe/iptvgo-channels.json (${seed.length} canales sin verificar)`);
 } catch (err) {
  say(`\nERROR: ${err && err.message}`);
  // Nunca romper el workflow: sin semilla nueva, se conserva la anterior
  fs.mkdirSync('.probe', { recursive: true });
  try { fs.copyFileSync('lib/data/liveChannelsUnverifiedSeed.json', '.probe/iptvgo-channels.json'); } catch { fs.writeFileSync('.probe/iptvgo-channels.json', '[]\n'); }
 } finally {
  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/iptvgo-seed.md', out.join('\n') + '\n');
  console.log('\n.probe/iptvgo-seed.md');
 }
})();
