'use strict';

/**
 * Nombre visible de un canal en vivo.
 *
 * El panel iptvgo.cc decora los nombres con letras pequeñas Unicode
 * («Eʟɪɪɴʀɪs 2026», «Cˡʳ S | …», «Uʜ»), marcas «®», superíndices «¹»,
 * prefijos de sección («KIDS | », «MX | », «CINE: »), emoticonos «:)»
 * y MAYÚSCULAS sostenidas. Esta limpieza se aplica dos veces: al cargar las
 * semillas (lib/liveChannels.js) y al construir la semilla semanal
 * (scripts/iptvgo-seed-build.mjs), así la tarjeta se ve igual aunque la
 * lista cruda empeore. Es idempotente: un nombre ya limpio no cambia.
 *
 * Módulo puro: sin red ni imports pesados, usable en servidor, worker y CI.
 */

// Letras pequeñas/modificadoras Unicode → su letra normal. El panel las usa
// como mayúsculas decorativas («Uʜ» = UHD, «Eʳ» = ER, «Cˡʳ S» = CLR S).
const SMALL = {
  // Small caps (falsas mayúsculas)
  ᴀ: 'A', ʙ: 'B', ᴄ: 'C', ᴅ: 'D', ᴇ: 'E', ꜰ: 'F', ɢ: 'G', ʜ: 'H', ɪ: 'I', ᴊ: 'J',
  ᴋ: 'K', ʟ: 'L', ᴍ: 'M', ɴ: 'N', ᴏ: 'O', ᴘ: 'P', ꞯ: 'Q', ʀ: 'R', ꜱ: 'S', ᴛ: 'T',
  ᴜ: 'U', ᴠ: 'V', ᴡ: 'W', ʏ: 'Y', ᴢ: 'Z',
  // Modificadoras en posición de mayúscula («ᵁᴴᴰ»)
  ᴬ: 'A', ᴮ: 'B', ᴰ: 'D', ᴱ: 'E', ᴳ: 'G', ᴴ: 'H', ᴶ: 'J', ᴷ: 'K', ᴸ: 'L', ᴹ: 'M',
  ᴺ: 'N', ᴼ: 'O', ᴾ: 'P', ᴿ: 'R', ᵀ: 'T', ᵁ: 'U', ⱽ: 'V', ᵂ: 'W',
  // Modificadoras minúsculas
  ᵃ: 'a', ᵇ: 'b', ᶜ: 'c', ᵈ: 'd', ᵉ: 'e', ᶠ: 'f', ᵍ: 'g', ʰ: 'h', ᶦ: 'i', ⁱ: 'i',
  ʲ: 'j', ᵏ: 'k', ˡ: 'l', ᵐ: 'm', ⁿ: 'n', ᵒ: 'o', ᵖ: 'p', ʳ: 'r', ˢ: 's', ᵗ: 't',
  ᵘ: 'u', ᵛ: 'v', ʷ: 'w', ˣ: 'x', ʸ: 'y', ᶻ: 'z', ʱ: 'h', ʴ: 'r', ʵ: 'r', ʶ: 'r',
  ˠ: 'g', ʻ: "'", ʾ: "'", ʿ: "'", ʼ: "'",
};
const SMALL_RE = new RegExp(`[${Object.keys(SMALL).join('')}]`, 'gu');

/** Marcas y superíndices que solo son adorno («®», «¹», «™»). */
const DROP_RE = /[®™©⁰¹²³⁴⁵⁶⁷⁸⁹‍️]/g;

/** Códigos de país usados como prefijo («MX | », «ARG: »). */
const COUNTRY = 'ARG?|MEX|MX|CHI|CL|COL|CO|PER|PE|VEN|VE|ECU|EC|GUA|GTM|GT|HON|HND|HN|SLV|SAL|NIC|NI|COS|CR|PAN|PA|DOM|DO|PUR|PR|BOL|BO|PAR|PY|URU|UY|ESP|SPA|ES|LAT|LAM|CAR|USA';

/** Marcas cortas que sobreviven en mayúsculas dentro del título final. */
const KEEP_UPPER = new Set([
  'HD', 'FHD', 'SD', 'SDT', 'UHD', '4K', '8K', 'TV', 'PPV', 'PPVS', 'HBO', 'ESPN',
  'CNN', 'FOX', 'TNT', 'TBS', 'AMC', 'AXN', 'MTV', 'VH1', 'BBC', 'NBC', 'ABC', 'CBS',
  'CW', 'ATV', 'UCV', 'RPP', 'TCM', 'TLC', 'HLN', 'CNBC', 'DW', 'RT', 'RAI', 'RTP',
  'TVN', 'TVE', 'TYC', 'ATB', 'RTVD', 'CBBA', 'APE', 'ERTV', 'ITV', 'PBC', 'TVA',
  'TVC', 'FM', 'AM', 'JR', 'MX', 'ER', 'ECDF',
]);

/** Palabras que el panel escribe raro y tienen forma propia conocida. */
const WORD_FIXES = [
  [/^\s*ELIINRIS\b/i, 'Eliminatorias'],       // «Eʟɪɪɴʀɪs 2026» = Eliminatorias 2026
  [/\bGOLTV\b/i, 'GolTV'],
  [/\bGOL\b/, 'Gol'],
  [/\bCINE\b/, 'Cine'],
  [/\bEr\b/g, 'ER'],                           // «Eʳ» transliterado queda «Er»
  [/\bDIRECTV\b/i, 'DirecTV'],
  [/\bCEXTRA\b/i, 'Extra'],
  [/\bUH\b/, 'UHD'],                           // «Uʜ» transliterado queda «UH»
];

/** Palabras cortas que en un título en español van en minúscula. */
const SMALL_WORDS = new Set(['DE', 'LA', 'LAS', 'LOS', 'EL', 'DEL', 'EN', 'Y', 'CON', 'A']);

/** Un token del título: siglas y calidades no se destripan. */
function titleToken(token, index, total) {
  if (token.startsWith('(')) return token;    // el matiz entre paréntesis manda
  const core = token.replace(/[^0-9A-Za-zÁÉÍÓÚÑÜ]/g, '');
  const letters = core.replace(/[^A-Za-zÁÉÍÓÚÑÜ]/g, '');
  if (!letters) return token;
  // «de/la/el» solo en medio del nombre («A&E LA» conserva su «LA» final)
  if (index > 0 && index < total - 1 && SMALL_WORDS.has(core.toUpperCase()) && !/\d/.test(core)) return token.toLowerCase();
  if (/\d/.test(core) || letters.length <= 3 || KEEP_UPPER.has(core.toUpperCase())) return token;
  return token.replace(/[A-ZÁÉÍÓÚÑÜ]+/g, (run) => run[0] + run.slice(1).toLowerCase());
}

/** «AMERICA TV HD» → «America TV HD», segmento a segmento (« · »). */
function titleCaseAllCaps(name) {
  return name.split(' · ').map((segment) => {
    // El test de mayúsculas ignora el matiz entre paréntesis («(HatunTV)»).
    const probe = segment.replace(/\([^)]*\)/g, '');
    if (!/[A-ZÁÉÍÓÚÑ]/.test(probe) || /[a-záéíóúñ]/.test(probe)) return segment;
    const letters = (probe.match(/[A-ZÁÉÍÓÚÑ]/g) || []).length;
    // Una palabra corta y «a pelo» («ESPN», «MEGA», «3ABN») se queda como
    // está; en cuanto lleva matiz («PERU (solo eventos)») sí se normaliza.
    if (letters < 5 && /^[A-ZÁÉÍÓÚÑ0-9.]+$/.test(segment.trim())) return segment;
    const words = segment.split(' ');
    return words.map((token, i) => titleToken(token, i, words.length)).join(' ');
  }).join(' · ');
}

/** Quita los «)» sin «(» que el panel deja al cortar nombres («Amazonas) HD»). */
function balanceParens(name) {
  let opens = (name.match(/\(/g) || []).length;
  return name.replace(/\)/g, (m) => (opens-- > 0 ? ')' : ''));
}

/**
 * Limpia el nombre crudo de la lista/panel. Idempotente.
 */
function cleanChannelName(raw) {
  let name = String(raw || '').replace(SMALL_RE, (ch) => SMALL[ch] || ch);
  name = name
    .replace(DROP_RE, '')
    .replace(/^(?:[🇦-🇿]{2}|[☀-➿]|[🌀-🫿]|\s)+/u, '')  // banderas y emoji iniciales
    .replace(/[▀-▟]+/gu, '')                              // bloques decorativos «▂ ▄ ▅»
    .replace(/\s*(?:\|\s*){2,}/g, ' | ')                  // «||» → «|»
    .replace(/^\|?[A-Z]{2,6}\|\s*/u, '')                 // etiqueta de grupo «|LAM| »
    .replace(/^\d{1,3}\s*\|\s*/, '')                     // número de parrilla «14 | »
    // prefijos de sección y de país, con «|», «·» o «:» («KIDS | », «MX | », «ARG: »)
    .replace(/^(?:KIDS?|INFANTIL|CINE|PELICULAS?|SERIES|DEPORTES?|MUSICA|NOTICIAS|DOCUMENTALES|CENTRO|ANIME|NOVELAS?)\s*[|·:]\s*/i, '')
    .replace(new RegExp(`^(?:${COUNTRY})\\s*[|·:]\\s*`, 'i'), '')
    .replace(/^(?:CINE|PELICULAS?|SERIES|DEPORTES?)\s*:\s*/i, '') // «MX CINE: …» ya sin país
    // operador en pequeñitas ya transliterado: «CLR S | …», «CLARO | …», «MSI | …»
    .replace(/^(?:CLR|CLARO|MSI|MOVISTAR)(?:\s*S(?:PORTS)?)?\s*[|·:\-–—]\s*/i, '')
    .replace(/\(\s*only\s*events?\s*\)/i, '(solo eventos)')
    .replace(/\s*[:;8=]-?[)D(Pp]{1,2}(?=\s|$)/g, '')     // emoticonos «:) #3»
    .replace(/\s*#(\d+)\.?\s*$/, ' #$1')                 // «BOLIVISION #2.» → «#2»
    .replace(/[?¿!¡]+\s*$/, '')                          // «Carib 5 ??»
    .replace(/^CARIB\s+/i, '')                           // sello «Carib <canal>»
    .replace(/_/g, ' ')                                  // «Disney_Channel»
    .replace(/\s*\|\s*/g, ' · ')                         // separador restante
    // micro-prefijo de operador/sección que quedó como segmento («S · CNN…», «RD · …»)
    .replace(/^[A-Za-zÁÉÍÓÚÑñ]{1,3}(?:\s+[A-Za-z]{1,3})? · (?=\S)/, '')
    .replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')
    .replace(/\s+/g, ' ')
    .replace(/^[\s·|.,;:—–-]+|[\s*+·|.,;:—–-]+$/g, '')
    .trim();
  name = balanceParens(name);
  name = titleCaseAllCaps(name);
  for (const [re, fixed] of WORD_FIXES) name = name.replace(re, fixed);
  return name.replace(/\s+/g, ' ').trim();
}

module.exports = { cleanChannelName, titleCaseAllCaps };
