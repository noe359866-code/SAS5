'use strict';

/**
 * Saneado del texto que llega de TMDB.
 *
 * TMDB es una base de datos colaborativa y, de vez en cuando, alguien edita un
 * `overview` o incluso el `title`/`name` de una ficha para meter publicidad
 * («¿Buscas películas y series gratis? ¡Busca Vercineo.net en Google!»,
 * «VerGratisEnVERCINEO.NET», «ver gratis in vercineo.net»). El addon lo estaba
 * publicando tal cual: aparecía como descripción en catálogos y fichas, y como
 * **nombre de la serie** en algunos casos («Anatomía de Grey ¡Busca Vercineo.net
 * en Google!»).
 *
 * Módulo puro (sin red ni estado) para poder testearlo aparte:
 *  - `cleanTitle()`    → para `name`/`title`; si al limpiar no queda nada se
 *                        devuelve el original: un título raro es menos dañino
 *                        que una tarjeta sin nombre en Stremio.
 *  - `cleanOverview()` → para descripciones; sí puede devolver cadena vacía.
 *
 * Estrategia, de más específica a más general:
 *  1. Frases de gancho conocidas («¿Buscas … en Google?», «Ver gratis en …»).
 *  2. Marcas pegadas en mayúsculas («VerGratisEnVERCINEO.NET»).
 *  3. URLs.
 *  4. Frases que aún contengan un dominio suelto se descartan enteras.
 *
 * Es deliberadamente conservador: solo toca texto que parece publicidad. Si una
 * sinopsis menciona una web real como parte de la trama, se pierde la mención
 * (o la frase), no la ficha.
 */

const TLD = 'net|com|org|tv|me|es|to|io|cc|xyz|info|site|online|link|top|best|club|live|watch|stream|film|movies?|series?';

// Frases de gancho completas. Van antes que los dominios sueltos para no dejar
// la interrogación o el «en Google!» colgando.
const BAIT_PHRASES = [
  // «¿Buscas películas y series gratis?» / «¿Buscas series gratis?»
  /¿?\s*buscas?\s+(?:pel[ií]culas?|series?)(?:\s+y\s+(?:pel[ií]culas?|series?))?\s+gratis\s*\?*/gi,
  // «¡Busca Vercineo.net en Google!»
  /¡?\s*busca\s+[\w.-]+\s+en\s+google\s*!?/gi,
  /¡?\s*busca\s+en\s+google\s+[\w.-]+\s*!?/gi,
  // «Ver gratis en vercineo.net», «Ver películas gratis en X.net»
  /\bver\s+(?:pel[ií]culas?\s+(?:y\s+series?\s+)?)?gratis\s+(?:en|in)\s+[\w.-]+/gi,
  // «gratis en X.net», «free in X.com»
  /\b(?:gratis|free)\s+(?:en|in)\s+[\w-]+\.(?:${TLD})\b/gi,
];

// Marca publicitaria pegada en mayúsculas: «VerGratisEnVERCINEO.NET».
// Exige dos o más mayúsculas internas para no tocar nombres legítimos como
// «McDonald» o «iPhone», y se lleva la extensión del dominio si la lleva.
const CAMEL_BAIT = new RegExp(
  `\\b(?:ver|verlo|verla)?(?:gratis|grat[íi]s)(?:en|ya)\\s*[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9]{2,}(?:\\.(?:${TLD}))?\\b`,
  'gi'
);

// Dominio suelto: pide al menos tres caracteres antes del punto y una extensión
// conocida, para no comerse «Matrix 2.0» ni una abreviatura cualquiera.
const BARE_DOMAIN = new RegExp(
  `(?:https?:\\/\\/)?(?:www\\.)?[a-z0-9][a-z0-9-]{2,}\\.(?:${TLD})\\b(?:\\/[^\\s]*)?`,
  'gi'
);

const URL_PREFIX = /https?:\/\/\S+/gi;

/** Reduce espacios repetidos y limpia puntuación huérfana de los extremos. */
function tidy(text) {
  return String(text || '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')            // «Hola , mundo»
    .replace(/^[\s,;:.!?¡¿\-–—|/]+/, '')        // «, La serie narra…»
    .replace(/(^|\s)[¡¿]+(?=\s|$)/g, '$1')      // «¿ » sin cerrar
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripKnownBait(text) {
  let out = String(text || '');
  for (const re of BAIT_PHRASES) out = out.replace(re, ' ');
  out = out.replace(CAMEL_BAIT, ' ');
  out = out.replace(URL_PREFIX, ' ');
  return out;
}

function hasDomain(text) {
  BARE_DOMAIN.lastIndex = 0;
  return BARE_DOMAIN.test(String(text || ''));
}

/**
 * Divide en frases devolviendo los fragmentos **con sus separadores intactos**,
 * para poder descartar una frase sin alterar el espaciado de las demás.
 *
 * Un terminador solo cierra frase si le sigue un espacio o el final. Así
 * «Matrix 2.0» o «S.W.A.T.» no se parten, y al reconstruir el texto se
 * conservan todos los caracteres de los fragmentos que sobreviven.
 */
function splitKeep(text) {
  const source = String(text || '');
  const out = [];
  let start = 0;
  for (let i = 0; i < source.length; i += 1) {
    if (!'.!?…'.includes(source[i])) continue;
    let j = i;
    while (j < source.length && '.!?…'.includes(source[j])) j += 1;
    if (j < source.length && !/\s/.test(source[j])) { i = j - 1; continue; }
    let k = j;
    while (k < source.length && /\s/.test(source[k])) k += 1;
    out.push(source.slice(start, k));
    start = k;
    i = k - 1;
  }
  if (start < source.length) out.push(source.slice(start));
  return out;
}

/**
 * Limpia una línea: quita la publicidad reconocible y descarta por completo las
 * frases que aún contengan un dominio suelto (publicidad no catalogada).
 */
function cleanLine(line) {
  const stripped = stripKnownBait(line);
  if (!hasDomain(stripped)) return stripped;
  return splitKeep(stripped)
    .filter((sentence) => !hasDomain(sentence))
    .join('');
}

function cleanBlock(text) {
  return String(text || '')
    .split(/\n/)
    .map((line) => cleanLine(line))
    .join('\n');
}

/**
 * Quita la publicidad de una descripción. Devuelve `''` si todo era publicidad.
 */
function cleanOverview(text) {
  if (text === null || text === undefined) return text;
  if (!String(text).trim()) return text;
  return tidy(cleanBlock(text));
}

/**
 * Limpia un título. Devuelve `''` si el nombre **era** el anuncio de principio a
 * fin: quien llama debe caer a su propio título por defecto («Sin título»), no
 * republicar el anuncio.
 */
function cleanTitle(text) {
  if (text === null || text === undefined) return text;
  const original = String(text);
  if (!original.trim()) return original;
  return tidy(cleanBlock(original))
    .replace(/^[-–—:;,.·|/]+/, '')
    .replace(/^(?:y|and)\s+/i, '')
    .trim();
}

/** ¿El texto contiene publicidad reconocible? (logs y diagnóstico) */
function hasSpam(text) {
  if (!text) return false;
  const probe = String(text);
  for (const re of BAIT_PHRASES) {
    re.lastIndex = 0;
    if (re.test(probe)) return true;
  }
  CAMEL_BAIT.lastIndex = 0;
  if (CAMEL_BAIT.test(probe)) return true;
  return hasDomain(probe);
}

module.exports = { cleanTitle, cleanOverview, hasSpam };
