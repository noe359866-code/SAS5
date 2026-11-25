'use strict';

/**
 * Clasificación temática de canales en vivo.
 *
 * Decisión del usuario (25-11-2026): los estantes del addon se organizan por
 * TIPO (deportes, cine, noticias…) y no por país — nada de «🇵🇪 Perú en
 * vivo» ni «🇳🇮 Nicaragua en vivo» como estantes aparte. Los canales que la
 * semilla trae etiquetados por país (mexico, peru, puertorico…) se reparten
 * por tema mirando el nombre del canal; lo que no encaja en ningún tema va a
 * «Entretenimiento». El país NO se pierde: queda como etiqueta (género
 * secundario) en la tarjeta del canal.
 *
 * Módulo puro: lo usan lib/liveChannels.js (al cargar las semillas) y
 * scripts/iptvgo-seed-build.mjs (al construir la semilla semanal).
 */

/** Estantes temáticos del addon, en orden de aparición. */
const TOPICS = [
  { key: 'entretenimiento', name: '📺 Entretenimiento en vivo', label: 'Entretenimiento' },
  { key: 'cine', name: '🎬 Cine en vivo', label: 'Cine' },
  { key: 'infantil', name: '🧸 Infantil en vivo', label: 'Infantil' },
  { key: 'anime', name: '🎌 Anime en vivo', label: 'Anime' },
  { key: 'musica', name: '🎵 Música en vivo', label: 'Música' },
  { key: 'noticias', name: '📰 Noticias en vivo', label: 'Noticias' },
  { key: 'documentales', name: '🌍 Documentales en vivo', label: 'Documentales' },
  { key: 'religion', name: '🙏 Religión en vivo', label: 'Religión' },
];
// «deportes» es categoría válida aunque no sea estante propio (tv_deportes lo
// mezcla con los curados): la sonda lo alimenta y el clasificador lo respeta.
const TOPIC_KEYS = new Set(['deportes', ...TOPICS.map((t) => t.key)]);
const TOPIC_LABELS = { deportes: 'Deportes', ...Object.fromEntries(TOPICS.map((t) => [t.key, t.label])) };

/**
 * Reglas por palabra clave sobre el nombre del canal (ya limpio). El orden
 * manda: «TNT Sports» cae en deportes antes de que «TNT» pueda caer en cine.
 */
/** Pistas de deporte que ganan incluso a una categoría temática heredada
 *  («TNT Sports» archivado bajo «cine» en el panel). */
const SPORTS_OVERRIDE = /deport|sport|f[úu]tbol|futbol|espn|bein|dsports|tyc|liga ?1|la ?liga|eliminatoria|nba|nfl|mlb|nhl|mls|ufc|wwe|boxeo|f1\b|formula|racing|golf|pga|tenis|champions|premier league|claro sports|tigo sports|tnt sports|win sports|gol ?tv|aym/i;

const TOPIC_RULES = [
  ['deportes', SPORTS_OVERRIDE],
  ['noticias', /noticia|news\b|24 ?horas|informativ|milenio|exc[eé]lsior|foro ?tv|cnn|bbc|dw\b|euronews|telediario|n\+\s*foro/i],
  ['infantil', /infantil|kids|niñ|cartoon|nick\b|nickelodeon|disney (channel|junior|xd)|baby ?tv|boomerang|tooncast|duck ?tv|lego|cartoon network|\bcn\b/i],
  ['anime', /anime|animax|crunchyroll|bitme|\betc ?tv/i],
  ['musica', /m[úu]sica|music|\bmtv\b|bandamax|\bhtv\b|radio|\bfm\b|concierto|karaoke|telehit|exa ?tv|\bviva\b.*m[úu]sica/i],
  ['documentales', /documental|discovery|nat ?geo|natgeo|history|historia|animal planet|cultura|ciencia|investiga|home ?& ?health|food network|cocina|cooking|travel|tastemade|love nature|h&h\b/i],
  ['religion', /religi|enlace\b|ewtn|cat[óo]lico|cristian|betel|mar[ií]a visi[óo]n|voz de poder/i],
  ['cine', /cine|movie|pel[íi]cula|cinema|cinemax|golden|hbo|\bspace\b|tnt\b|\bamc\b|\bfx\b|star channel|sony (channel|movies)|studio universal|hallmark|lifetime|\bfilm\b|a&e|\baxn\b|paramount channel|de ?pel[ií]cula/i],
];

/**
 * Tema de un canal. `category` es la etiqueta que traiga la semilla/lista
 * (puede ser ya un tema o un país); `name` es el nombre visible.
 * Si la categoría ya es un tema válido, se respeta. Si es un país (o está
 * vacía), se decide por el nombre; sin coincidencia → «entretenimiento».
 */
function thematicCategoryOf(name, category) {
  const cat = String(category || '').toLowerCase();
  // Deporte manda: la semilla archiva «TNT Sports» bajo cine por la TNT,
  // pero el usuario lo busca en Deportes.
  if (SPORTS_OVERRIDE.test(String(name || ''))) return 'deportes';
  if (TOPIC_KEYS.has(cat)) return cat;
  const probe = `${name || ''}`;
  for (const [topic, re] of TOPIC_RULES) {
    if (re.test(probe)) return topic;
  }
  return 'entretenimiento';
}

/** Etiqueta de país por categoría vieja de la semilla (para el género). */
const COUNTRY_LABELS = {
  espana: 'España', mexico: 'México', argentina: 'Argentina', bolivia: 'Bolivia',
  chile: 'Chile', colombia: 'Colombia', costarica: 'Costa Rica',
  dominicana: 'Rep. Dominicana', ecuador: 'Ecuador', elsalvador: 'El Salvador',
  guatemala: 'Guatemala', honduras: 'Honduras', nicaragua: 'Nicaragua',
  paraguay: 'Paraguay', peru: 'Perú', puertorico: 'Puerto Rico',
  venezuela: 'Venezuela', panama: 'Panamá', uruguay: 'Uruguay', usa: 'EE. UU.',
};

/** Etiqueta de país de una categoría vieja, o '' si no era de país. */
function countryLabelOf(category) {
  return COUNTRY_LABELS[String(category || '').toLowerCase()] || '';
}

module.exports = { TOPICS, TOPIC_KEYS, TOPIC_LABELS, TOPIC_RULES, thematicCategoryOf, COUNTRY_LABELS, countryLabelOf };
