'use strict';

/**
 * Texto de las fichas de Stremio: idioma, país, duración, dinero y título
 * alternativo.
 *
 * Módulo puro (sin red ni estado) para poder probarlo aparte. Todo lo que
 * entra aquí viene de TMDB, que devuelve códigos ISO (`es`, `MX`) y números
 * sin formato (`136`, `63100000`). La ficha debe leerlos como los lee una
 * persona: «Español», «México», «2 h 16 min», «63,1 M USD».
 *
 * Ante un valor desconocido se devuelve `''` (nada que publicar) en vez de
 * repetir el código crudo: una ficha con «Idioma original: xx» no informa.
 */

/** Nombres en español de los idiomas que aparecen en el cine comercial. */
const LANGUAGES = {
  es: 'Español', en: 'Inglés', pt: 'Portugués', fr: 'Francés', de: 'Alemán',
  it: 'Italiano', ja: 'Japonés', ko: 'Coreano', zh: 'Chino', cn: 'Chino',
  hi: 'Hindi', th: 'Tailandés', tr: 'Turco', ru: 'Ruso', pl: 'Polaco',
  nl: 'Neerlandés', sv: 'Sueco', no: 'Noruego', nb: 'Noruego', da: 'Danés',
  fi: 'Finés', cs: 'Checo', hu: 'Húngaro', ro: 'Rumano', el: 'Griego',
  he: 'Hebreo', ar: 'Árabe', fa: 'Persa', id: 'Indonesio', ms: 'Malayo',
  vi: 'Vietnamita', uk: 'Ucraniano', ca: 'Catalán', eu: 'Euskera', gl: 'Gallego',
  tl: 'Filipino', fil: 'Filipino', ta: 'Tamil', te: 'Telugu', bn: 'Bengalí',
  ur: 'Urdu', sr: 'Serbio', hr: 'Croata', bg: 'Búlgaro', sk: 'Eslovaco',
  sl: 'Esloveno', lt: 'Lituano', lv: 'Letón', et: 'Estonio', is: 'Islandés',
  la: 'Latín', eo: 'Esperanto', yi: 'Yidis', sq: 'Albanés', mk: 'Macedonio',
};

/** Nombres en español de los países de producción más frecuentes. */
const COUNTRIES = {
  US: 'Estados Unidos', MX: 'México', AR: 'Argentina', ES: 'España',
  CO: 'Colombia', CL: 'Chile', PE: 'Perú', VE: 'Venezuela', UY: 'Uruguay',
  EC: 'Ecuador', BO: 'Bolivia', PY: 'Paraguay', CR: 'Costa Rica',
  CU: 'Cuba', DO: 'República Dominicana', GT: 'Guatemala', HN: 'Honduras',
  NI: 'Nicaragua', PA: 'Panamá', PR: 'Puerto Rico', SV: 'El Salvador',
  BR: 'Brasil', CA: 'Canadá', GB: 'Reino Unido', IE: 'Irlanda',
  FR: 'Francia', DE: 'Alemania', IT: 'Italia', PT: 'Portugal',
  NL: 'Países Bajos', BE: 'Bélgica', CH: 'Suiza', AT: 'Austria',
  SE: 'Suecia', NO: 'Noruega', DK: 'Dinamarca', FI: 'Finlandia',
  PL: 'Polonia', RU: 'Rusia', UA: 'Ucrania', TR: 'Turquía',
  JP: 'Japón', KR: 'Corea del Sur', CN: 'China', HK: 'Hong Kong',
  TW: 'Taiwán', IN: 'India', TH: 'Tailandia', ID: 'Indonesia',
  PH: 'Filipinas', AU: 'Australia', NZ: 'Nueva Zelanda', ZA: 'Sudáfrica',
  EG: 'Egipto', IL: 'Israel', IR: 'Irán', AE: 'Emiratos Árabes Unidos',
  'SU': 'Unión Soviética', 'YU': 'Yugoslavia', 'XC': 'Checoslovaquia',
  'DDDE': 'Alemania Oriental',
};

/** `es` → `Español`; `pt-BR` → `Portugués`; desconocido → `''`. */
function languageLabel(code) {
  const base = String(code || '').trim().toLowerCase().split(/[-_]/)[0];
  return LANGUAGES[base] || '';
}

/** `['MX','US']` → «México, Estados Unidos». Ignora códigos desconocidos. */
function countryLabel(codes) {
  const list = Array.isArray(codes) ? codes : [codes];
  const names = [];
  for (const code of list) {
    const name = COUNTRIES[String(code || '').trim().toUpperCase()];
    if (name && !names.includes(name)) names.push(name);
  }
  return names.slice(0, 3).join(', ');
}

/** 136 → «2 h 16 min»; 45 → «45 min»; 0 o inválido → `''`. */
function durationText(minutes) {
  const total = Math.round(Number(minutes));
  if (!Number.isFinite(total) || total <= 0) return '';
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/**
 * Cifra de dinero abreviada y legible: 63100000 → «63,1 M USD».
 * Se escribe con coma decimal porque el addon es de español latino.
 */
function moneyText(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return '';
  const short = (n) => String(Number(n.toFixed(1))).replace('.', ',');
  if (value >= 1e9) return `${short(value / 1e9)} mil M USD`;
  if (value >= 1e6) return `${short(value / 1e6)} M USD`;
  if (value >= 1e3) return `${short(value / 1e3)} mil USD`;
  return `${Math.round(value)} USD`;
}

/**
 * Línea de presupuesto y recaudación. Solo publica las cifras que existen:
 * TMDB devuelve 0 cuando no las conoce.
 */
function boxOfficeText({ budget, revenue } = {}) {
  const parts = [];
  const budgetText = moneyText(budget);
  const revenueText = moneyText(revenue);
  if (budgetText) parts.push(`💰 Presupuesto: ${budgetText}`);
  if (revenueText) parts.push(`🎟️ Recaudación: ${revenueText}`);
  return parts.join('  ·  ');
}

/**
 * Título alternativo («aka»): solo cuando la ficha traduce el título y el
 * original aporta algo. Compara sin acentos ni mayúsculas para no repetir
 * «Matrix» / «The Matrix» dos veces cuando ya coinciden.
 */
function akaText(localized, original) {
  const clean = (value) => String(value || '').trim();
  const a = clean(localized);
  const b = clean(original);
  if (!b || a.toLowerCase() === b.toLowerCase()) return '';
  const fold = (text) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (fold(a) === fold(b)) return '';
  return `Título original: ${b}`;
}

module.exports = { LANGUAGES, COUNTRIES, languageLabel, countryLabel, durationText, moneyText, boxOfficeText, akaText };
