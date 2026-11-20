'use strict';

const YEAR_SUFFIX = /\s+\(((?:19|20)\d{2})\)\s*$/;
const stripArticle = (title) => title.replace(/^(?:the|el|la|los|las|le|les)\s+/i, '').trim();
const withoutYear = (title) => String(title || '').trim().replace(YEAR_SUFFIX, '');

function normalizeText(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * La misma cadena sin espacios: los sitios escriben el título de las dos
 * maneras («IntensaMente 2» y «Intensa-Mente 2», «Spiderman» y «Spider-Man») y
 * al comparar solo con espacios la ficha se descartaba. Medido el 20-11-2026:
 * el buscador de Cuevana 3, Allpelículas y LaMovie devuelve la película para
 * «Intensamente 2» y **nada** para «Intensa-Mente 2», que es el título de TMDB.
 */
const squash = (value) => normalizeText(value).replace(/ /g, '');

function yearOf(value) {
  const year = /^((?:19|20)\d{2})(?:\b|$)/.exec(String(value || ''))?.[1];
  return year ? Number(year) : null;
}

function catalogYear(item) {
  return yearOf(item.year) ?? yearOf(item.release_date) ?? yearOf(item.first_air_date)
    ?? yearOf(YEAR_SUFFIX.exec(item.title || '')?.[1]);
}

/** Compara títulos completos. Quitar el artículo solo es una coincidencia secundaria. */
function titleScore(names, expected) {
  const actual = names.map(withoutYear).map(normalizeText).filter(Boolean);
  const wanted = expected.map(withoutYear).map(normalizeText).filter(Boolean);
  if (actual.some((name) => wanted.includes(name))) return 2;
  if (actual.some((name) => wanted.some((other) => other && squash(other) === squash(name)))) return 2;
  const aliases = wanted.map(stripArticle).filter(Boolean);
  if (actual.some((name) => aliases.includes(stripArticle(name)))) return 1;
  return actual.some((name) => aliases.some((other) => other && squash(other) === squash(stripArticle(name)))) ? 1 : 0;
}

/** El buscador puede aceptar un título corto; eso no identifica la ficha. */
function titleQueries(titles, shortFirst = false) {
  const full = titles.map(withoutYear).filter(Boolean);
  // Las variantes de un mismo título van juntas: el buscador de los sitios es
  // un `LIKE` sobre el título guardado y, si el guardado une las palabras
  // («IntensaMente 2»), la consulta con guion no devuelve nada. Así la forma
  // pegada del título pedido se prueba antes de gastar peticiones en el título
  // original (que casi nunca coincide con el guardado).
  const variantsOf = (title) => [
    title,
    stripArticle(title),
    title.replace(/[-\u2013\u2014]/g, '').replace(/\s+/g, ' ').trim(),
    title.replace(/[-\u2013\u2014:&,'."()]/g, ' ').replace(/\s+/g, ' ').trim(),
  ];
  const short = full[0]?.split(':', 1)[0].trim();
  const extra = short && !full.includes(short) ? [short, stripArticle(short)] : [];
  const queries = full.flatMap(variantsOf);
  return [...new Set((shortFirst ? [...extra, ...queries] : [...queries, ...extra]).filter(Boolean))];
}

module.exports = { normalizeText, squash, yearOf, catalogYear, titleScore, titleQueries };
