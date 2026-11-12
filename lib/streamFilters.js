'use strict';

/**
 * Filtros de streams: clasifica cada torrent por su NOMBRE (tipo de copia,
 * resolución, imagen/códec) y aplica las preferencias del usuario
 * (categorías ocultas, tamaño máximo y orden).
 *
 * Módulo puro: sin red y sin imports, para poder usarlo tanto en el servidor
 * (lib/streams.js) como para pintar las opciones de /configure.
 *
 * Cada stream lleva exactamente UN tipo de copia y UNA resolución, más
 * cualquier número de etiquetas extra (3D, HDR, Dolby Vision, HEVC, AV1).
 * Un stream se oculta si CUALQUIERA de sus etiquetas está en `hide`.
 */

const FILTER_GROUPS = [
  { key: 'source', label: 'Tipo de copia' },
  { key: 'resolution', label: 'Resolución' },
  { key: 'video', label: 'Imagen y códec' },
];

const FILTERS = [
  { key: 'web', group: 'source', name: 'WEB-DL · WEBRip', hint: 'Bajadas de plataformas de streaming' },
  { key: 'bluray', group: 'source', name: 'BluRay', hint: 'BluRay, BDRip y BRRip ya comprimidos' },
  { key: 'remux', group: 'source', name: 'REMUX', hint: 'Blu-ray sin comprimir: 20–80 GB' },
  { key: 'other', group: 'source', name: 'HDTV · DVD · otras', hint: 'TV, DVD, HDRip y copias sin indicar' },
  { key: 'scr', group: 'source', name: 'Screener', hint: 'Copias de promoción: SCR, DVDScr' },
  { key: 'cam', group: 'source', name: 'CAM · TS', hint: 'Grabadas en el cine: CAM, TeleSync' },

  { key: '4k', group: 'resolution', name: '4K · 2160p', hint: 'Ultra HD' },
  { key: '1080p', group: 'resolution', name: '1080p', hint: 'Full HD' },
  { key: '720p', group: 'resolution', name: '720p', hint: 'HD' },
  { key: 'sd', group: 'resolution', name: 'SD', hint: '480p, 576p y DVD' },
  { key: 'unknown', group: 'resolution', name: 'Sin indicar', hint: 'El nombre no dice la resolución' },

  { key: '3d', group: 'video', name: '3D', hint: 'SBS / Over-Under: imagen doble en pantallas normales' },
  { key: 'hdr', group: 'video', name: 'HDR', hint: 'HDR10, HDR10+, HLG' },
  { key: 'dv', group: 'video', name: 'Dolby Vision', hint: 'Colores raros si tu pantalla no lo admite' },
  { key: 'hevc', group: 'video', name: 'HEVC · x265', hint: 'H.265: algunos equipos antiguos no lo abren' },
  { key: 'av1', group: 'video', name: 'AV1', hint: 'Códec nuevo: pide hardware reciente' },
  { key: 'dub', group: 'video', name: 'Sin doblaje', hint: 'Solo original: «Dublado» o «Dual» en el nombre' },
];
const FILTER_KEYS = FILTERS.map((f) => f.key);

const SORT_OPTIONS = [
  { key: 'seeders', label: 'Más seeders', hint: 'Los que mejor cargan primero' },
  { key: 'quality', label: 'Mejor calidad', hint: 'De 4K a SD; CAM y screeners al final' },
  { key: 'size', label: 'Menor tamaño', hint: 'Los más ligeros primero' },
];
const SORT_KEYS = SORT_OPTIONS.map((o) => o.key);
const DEFAULT_SORT = 'seeders';

/** Opciones de tamaño máximo que ofrece /configure, en GB (0 = sin límite). */
const SIZE_OPTIONS = [0, 2, 5, 10, 20, 50];
const MAX_SIZE_GB = 1000;
const GIGABYTE = 1024 ** 3;

/** Lo que oculta el botón «recomendado» de /configure. */
const RECOMMENDED_HIDE = ['cam', 'scr', '3d'];

// ─────────────────────────────────────────────────────────────────────────────
// Normalización
// ─────────────────────────────────────────────────────────────────────────────
const MAX_NAME_LENGTH = 400;
const VIDEO_EXTENSION = /\.(?:mkv|mp4|avi|m4v|mov|wmv|webm|mpe?g|m2ts)$/i;
// «.ts» final en minúscula es la extensión MPEG-TS, no un TeleSync.
const TS_EXTENSION = /\.ts$/;
const BRACKETS = /[[\](){}<>【】「」『』（）［］]+/g;

/**
 * Minúsculas, sin diacríticos y con una sola separación entre palabras.
 * Los corchetes y paréntesis quedan como « | » para que un patrón de dos
 * palabras no cruce de una etiqueta a otra («[HD][TC]» no es «HD-TC»).
 */
function flatten(text) {
  const flat = String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(BRACKETS, ' | ')
    .replace(/[^a-z0-9|]+/g, ' ')
    .trim();
  return ` ${flat} `;
}

function countMatches(pattern, text) {
  const found = text.match(pattern);
  return found ? found.length : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Patrones (sobre el texto ya aplanado; todos con flag g para poder contar)
// ─────────────────────────────────────────────────────────────────────────────
// Formas compuestas e inequívocas de una grabación de cine.
const CAM_STRONG = new RegExp(
  [
    '\\bh[dq] ?cam(?: ?rip)?\\b|\\bcam ?rip\\b|\\bcamh[dq]\\b', // HDCAM, HQ-CAM, CAMRip
    '\\b(?:h[dq] ?)?s print\\b', // S-Print
    '\\btelesync\\b|\\bhd ?ts(?: ?rip)?\\b|\\bts ?rip\\b', // TELESYNC, HDTS, HD-TS, TSRip
    '\\btelecine\\b|\\bhd ?tc(?: ?rip)?\\b|\\btc ?rip\\b', // TELECINE, HDTC, HD-TC
  ].join('|'),
  'g'
);
// «CAM» a secas también puede ser una palabra del título de un episodio:
// solo cuenta si el nombre no declara otra fuente (BluRay, WEB, HDTV…).
const CAM_WORD = /\bcam\b/g;
// TS / TC sueltos: igual que «CAM», y además solo en MAYÚSCULAS (se miran
// sobre el nombre original).
const BARE_TS_TC = /(?<![A-Za-z0-9])T[SC](?![A-Za-z0-9])/g;
const FANSUB_NAME = /^\s*[[【]/; // «[Grupo] …»: ahí [TC] y [SC] son subtítulos en chino

const SCREENER = /\b(?:dvd|bd|br|web|hd)? ?scr(?:eener)?\b|\bp(?:re)? ?dvd(?: ?rip)?\b/g;
const REMUX = /\b[a-z0-9]*remux\b|\bbdmv\b|\bbd(?:25|50|66|100)\b/g;
const BLURAY = /\bblu ?ray(?: ?rip)?\b|\bb[dr] ?rip\b|\bbd\b|\bbdmux\b/g;
const WEB = /\bweb(?: ?(?:dl|rip|cap|hd|mux))?\b|\bwebdlrip\b|\bhdweb\b|\bdl ?mux\b/g;
// Emisiones de TV y DVD. Con una de estas, «TS» es transport stream.
const BROADCAST = /\b(?:hd|pd|sd)tv(?: ?rip)?\b|\btv ?rip\b|\bdsr\b|\bsat ?rip\b|\bdvb\b|\bdvd(?: ?rip|r|5|9)?\b|\b1080i\b|\bmpeg ?(?:2|ts)\b/g;

// «SBS» y «HOU» sueltos no cuentan: SBS es una cadena coreana y «Hou» una
// palabra corriente en títulos chinos.
const THREE_D = /\b(?:bd)?3d\b|\bh ?sbs\b|\bhalf ?sbs\b|\bh ou\b|\bhalf ?ou\b/g;
const HDR = /\bhdr(?:10)?(?:plus|p)?\b|\bhlg\b/g;
const DOLBY_VISION = /\bdv\b|\bdovi\b|\bdolby ?vision\b/g;
const HEVC = /\bhevc\b|\bx265\b|\bh ?265\b/g;
const AV1 = /\bav1\b/g;
// Doblaje al español o al portugués («Dublado», «Dual Áudio», «Nacional»):
// quien ve en VOSE los quiere fuera, y es lo que más abunda en los sitios
// brasileños.
const DUBBED = /\bdublado\b|\bdublada\b|\bdual ?(?:audio|áudio)\b|\bdual\b|\bnacional\b|\bdoblad[oa]\b/g;

const EXPLICIT_RESOLUTION = /\b(\d{3,4})([pi])(?:\d{2,3})?\b/g;
const PIXEL_SIZE = /\b(\d{3,4})x(\d{3,4})[pi]?\b/g;
const ULTRA_HD = /\b(?:4k|uhd)\b/g;
const STANDARD_DEFINITION = /\bdvd(?: ?rip| ?scr|r|5|9)?\b|\bxvid\b|\bdivx\b|\b[sp]dtv\b|\bdsr\b|\bsd\b|\bvhs(?: ?rip)?\b/g;
const MIN_LINES = 144;
const MAX_LINES = 4320;

function resolutionClass(lines) {
  if (lines >= 2000) return '4k';
  if (lines >= 1000) return '1080p';
  if (lines >= 700) return '720p';
  return 'sd';
}

/** «1920x800» → 1080p: en vídeo recortado manda el ancho. */
function linesFromPixels(width, height) {
  if (width >= 3800) return 2160;
  if (width >= 2500) return 1440;
  if (width >= 1900) return 1080;
  if (width >= 1200) return 720;
  return height;
}

/** Primera resolución escrita en el nombre: «1080p», «1080i» o «1920x1080». */
function firstResolution(text) {
  let best = null;
  for (const m of text.matchAll(EXPLICIT_RESOLUTION)) {
    const lines = Number(m[1]);
    if (lines < MIN_LINES || lines > MAX_LINES) continue;
    best = { index: m.index, lines, label: `${lines}${m[2]}` };
    break;
  }
  for (const m of text.matchAll(PIXEL_SIZE)) {
    if (best && best.index < m.index) break;
    const width = Number(m[1]);
    const height = Number(m[2]);
    if (width < 600 || height < 300 || width <= height) continue;
    const lines = linesFromPixels(width, height);
    best = { index: m.index, lines, label: `${lines}p` };
    break;
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// Clasificador
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Clasifica un nombre de release.
 *
 * `titles` son los títulos conocidos de la obra. Una marca solo cuenta si
 * aparece en el nombre MÁS veces que en el propio título: así «Saw 3D»,
 * «Cam» o «Charlotte's Web» no se etiquetan a sí mismas.
 *
 * @returns {{ quality: string, tags: string[] }} `quality` es la etiqueta
 *   visible («1080p», «2160p»… o '' si el nombre no la dice) y `tags` las
 *   claves de FILTERS que le corresponden.
 */
function classify(name, titles) {
  const raw = String(name || '')
    .slice(0, MAX_NAME_LENGTH)
    .trim()
    .replace(TS_EXTENSION, '')
    .replace(VIDEO_EXTENSION, '');
  const text = flatten(raw);
  const known = (Array.isArray(titles) ? titles : [titles]).filter(Boolean).map(String);
  const knownFlat = known.map(flatten);

  const beyondTitle = (pattern, subject, references) => {
    const inName = countMatches(pattern, subject);
    if (!inName) return false;
    let inTitle = 0;
    for (const reference of references) inTitle = Math.max(inTitle, countMatches(pattern, reference));
    return inName > inTitle;
  };
  const has = (pattern) => beyondTitle(pattern, text, knownFlat);

  // Tipo de copia (uno solo, por prioridad).
  const declaredSource = has(REMUX) || has(BLURAY) || has(WEB) || has(BROADCAST);
  const looseCam = !declaredSource && (
    has(CAM_WORD) || (!FANSUB_NAME.test(raw) && beyondTitle(BARE_TS_TC, raw, known))
  );
  let source = 'other';
  if (has(CAM_STRONG)) source = 'cam';
  else if (has(SCREENER)) source = looseCam ? 'cam' : 'scr'; // «TS-Screener» es un TeleSync
  else if (looseCam) source = 'cam';
  else if (has(REMUX)) source = 'remux';
  else if (has(BLURAY)) source = 'bluray';
  else if (has(WEB)) source = 'web';

  // Resolución: un número explícito manda sobre «4K»/«UHD» (que puede ser la
  // fuente de un 1080p).
  let quality = '';
  let resolution = 'unknown';
  const explicit = firstResolution(text);
  if (explicit) {
    quality = explicit.label;
    resolution = resolutionClass(explicit.lines);
  } else if (has(ULTRA_HD)) {
    quality = '2160p';
    resolution = '4k';
  } else if (has(STANDARD_DEFINITION)) {
    resolution = 'sd'; // DVDRip, XviD… sin número: se sabe que es SD, pero no cuál
  }

  const tags = [source, resolution];
  if (has(THREE_D)) tags.push('3d');
  if (has(HDR)) tags.push('hdr');
  if (has(DOLBY_VISION)) tags.push('dv');
  if (has(HEVC)) tags.push('hevc');
  if (has(AV1)) tags.push('av1');
  if (has(DUBBED)) tags.push('dub');
  return { quality, tags };
}

// ─────────────────────────────────────────────────────────────────────────────
// Preferencias del usuario
// ─────────────────────────────────────────────────────────────────────────────
const RESOLUTION_RANK = { '4k': 4, '1080p': 3, '720p': 2, sd: 1, unknown: 0 };

/** Mayor = mejor. CAM y screener siempre al final; a igual resolución, 2D antes que 3D. */
function qualityRank(hit) {
  const tags = hit.tags || [];
  if (tags.includes('cam') || tags.includes('scr')) return -1;
  let rank = 0;
  for (const tag of tags) {
    if (RESOLUTION_RANK[tag] !== undefined) rank = RESOLUTION_RANK[tag];
  }
  return rank * 2 + (tags.includes('3d') ? 0 : 1);
}

/** Menor = antes. Sin tamaño conocido, al final. */
function sizeRank(hit) {
  return hit.size > 0 ? hit.size : Number.MAX_VALUE;
}

/** Tamaño máximo en GB: entero entre 0 (sin límite) y MAX_SIZE_GB. */
function normalizeMaxSize(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, MAX_SIZE_GB);
}

/**
 * Aplica las preferencias a una lista de hits `{ tags, size, … }` que ya
 * viene ordenada por seeders. No modifica la lista recibida.
 *
 * - `hide`: se descarta el hit que tenga alguna de esas etiquetas.
 * - `maxSize` (GB): se descartan los que pesan más. Si el tamaño no se
 *   conoce (0) el hit se conserva.
 * - `sort`: 'seeders' deja el orden recibido; 'quality' y 'size' reordenan
 *   y desempatan por el orden recibido (seeders).
 */
function applyPrefs(hits, prefs) {
  const list = Array.isArray(hits) ? hits : [];
  if (!prefs) return list;
  const hidden = new Set(Array.isArray(prefs.hide) ? prefs.hide : []);
  const maxBytes = normalizeMaxSize(prefs.maxSize) * GIGABYTE;

  let out = list;
  if (hidden.size || maxBytes) {
    out = list.filter((hit) => {
      if (maxBytes && hit.size > maxBytes) return false;
      return !(hit.tags || []).some((tag) => hidden.has(tag));
    });
  }
  if (prefs.sort === 'quality') {
    out = [...out].sort((a, b) => qualityRank(b) - qualityRank(a));
  } else if (prefs.sort === 'size') {
    out = [...out].sort((a, b) => sizeRank(a) - sizeRank(b));
  }
  return out;
}

module.exports = {
  FILTER_GROUPS,
  flatten,
  FILTERS,
  FILTER_KEYS,
  SORT_OPTIONS,
  SORT_KEYS,
  DEFAULT_SORT,
  SIZE_OPTIONS,
  MAX_SIZE_GB,
  RECOMMENDED_HIDE,
  classify,
  applyPrefs,
  normalizeMaxSize,
};
