'use strict';
// Las listas de proveedor son orientativas: sus pistas reales varían por obra.
const TYPES = ['direct'];
// Solo doblajes identificados en español.
const LANGUAGES = ['lat', 'es'];
const DIRECT = ['fanpelis','playlatin','flixlatam','spinflix','cuevana3','animeonlineninja','fuegocine','gnulahd'];
const PROVIDER_LANGUAGES = Object.fromEntries(DIRECT.map((key) => [key, LANGUAGES]));
function providerType(key) { return DIRECT.includes(key) ? 'direct' : null; }
// Solo etiquetas explícitas fuera del título; subtítulos no prueban audio.
function hitLanguages(hit) {
  let text = String(hit.audioLabel || '');
  if (!text && !hit.url) {
    text = String(hit.title || '');
    for (const title of hit.titles || []) if (title) text = text.replace(new RegExp(String(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ');
    if (/\b(?:subs?|subtitulado|vostfr)\b/i.test(text) && !/\b(?:audio|dual|dub|doblado|latino|castellano)\b/i.test(text)) return ['unknown'];
  }
  text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const patterns = {lat:/\b(?:latino|latam|lat)\b/, es:/\b(?:castellano|spanish|espanol|esp|spa)\b/, en:/\b(?:english|ingles|eng)\b/, fr:/\b(?:french|frances|vff|vfq|fra)\b/, de:/\b(?:german|aleman|deu|ger)\b/, it:/\b(?:italian|italiano|ita)\b/, pt:/\b(?:portugues|portuguese|brazilian|dublado|ptb|por)\b/, pl:/\b(?:polish|polski|polaco|pol)\b/, ja:/\b(?:japanese|japones|jpn)\b/, ko:/\b(?:korean|coreano|kor)\b/, zh:/\b(?:chinese|chino|zho|chi)\b/, hi:/\b(?:hindi|hin)\b/, ru:/\b(?:russian|ruso|rus)\b/, tr:/\b(?:turkish|turco|tur)\b/};
  const matches = Object.keys(patterns).filter(k => patterns[k].test(text));
  if (/\bespanol\s+latino\b/.test(text) && !/\bcastellano\b/.test(text)) {
    const index = matches.indexOf('es');
    if (index !== -1) matches.splice(index, 1);
  }
  return matches.length ? matches : ['unknown'];
}
function hitMatches(hit, cfg) {
  const languages = hitLanguages(hit);
  if (languages.includes('en') || /\b(?:subtitulado|subbed|vose)\b/i.test(hit.audioLabel || '')) return false;
  return LANGUAGES.some((lang) => languages.includes(lang)
    && (!Array.isArray(cfg?.streamLanguages) || cfg.streamLanguages.includes(lang)));
}
module.exports = { TYPES, LANGUAGES, PROVIDER_LANGUAGES, providerType, hitLanguages, hitMatches };
