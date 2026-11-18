'use strict';

const YEAR_SUFFIX = /\s+\(((?:19|20)\d{2})\)\s*$/;
const stripArticle = (title) => title.replace(/^(?:the|el|la|los|las|le|les)\s+/i, '').trim();
const withoutYear = (title) => String(title || '').trim().replace(YEAR_SUFFIX, '');

function normalizeText(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

const normalizeTitle = (value) => withoutYear(value).toLowerCase().normalize('NFD')
  .replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

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
  const actual = names.map(normalizeTitle).filter(Boolean);
  const wanted = expected.map(normalizeTitle).filter(Boolean);
  if (actual.some((name) => wanted.includes(name))) return 2;
  const aliases = wanted.map(stripArticle).filter(Boolean);
  return actual.some((name) => aliases.includes(stripArticle(name))) ? 1 : 0;
}

/** El buscador puede aceptar un título corto; eso no identifica la ficha. */
function titleQueries(titles, shortFirst = false) {
  const full = titles.map(withoutYear).filter(Boolean);
  const short = full[0]?.split(':', 1)[0].trim();
  const extra = short && !full.includes(short) ? [short, stripArticle(short)] : [];
  const queries = [...full, ...full.map(stripArticle)];
  return [...new Set((shortFirst ? [...extra, ...queries] : [...queries, ...extra]).filter(Boolean))];
}

module.exports = { normalizeText, yearOf, catalogYear, titleScore, titleQueries };
