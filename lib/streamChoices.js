'use strict';
// Las listas de proveedor son orientativas: sus pistas reales varían por obra.
const TYPES = ['direct'];
// El addon solo publica audio latino. Los códigos antiguos o externos se
// descartan al normalizar la configuración y nunca amplían este conjunto.
const LANGUAGES = ['lat'];
const DIRECT = ['fanpelis','playlatin'];
const PROVIDER_LANGUAGES = { fanpelis:['lat'], playlatin:['lat'] };
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
  // Invariante del producto: nada sin marca explícita de audio latino, y
  // tampoco audio dual que incluya inglés. No se puede desactivar en /configure.
  if (!languages.includes('lat') || languages.includes('en')) return false;
  return !Array.isArray(cfg?.streamLanguages) || cfg.streamLanguages.includes('lat');
}
module.exports = { TYPES, LANGUAGES, PROVIDER_LANGUAGES, providerType, hitLanguages, hitMatches };
