'use strict';

/**
 * Etiquetas técnicas de stream («badges», al estilo del pack FR-Badges).
 *
 * Cada release se analiza por su nombre y produce COMO MUCHO un token por
 * grupo (resolución, HDR, códec…), en orden fijo. Los tokens son las palabras
 * canónicas que buscan los manifiestos «Fusion badge URLs» de Nuvio (el pack
 * FR-Badges y similares): en Nuvio esas palabras se dibujan como imágenes y en
 * Stremio se ven como texto limpio en la segunda línea del stream.
 *
 * Los grupos que ya clasifica lib/streamFilters.js (fuente, resolución, 3D,
 * HDR, Dolby Vision, HEVC, AV1) se reutilizan tal cual —incluida su protección
 * contra títulos que se autoetiquetan («Saw 3D», «Cam»)—; el resto se detecta
 * aquí con patrones sobre el nombre aplanado, también a prueba de
 * autoetiquetado.
 *
 * Módulo puro: sin red ni imports pesados, usable en servidor y en tests.
 */

const { classify, flatten } = require('./streamFilters');

/** Grupos de etiquetas, en el orden en que salen en el stream. */
const BADGE_GROUPS = [
  { key: 'resolution', label: 'Resolución', hint: '8K, 4K, 1080p… del nombre del release' },
  { key: 'format3d', label: '3D y HFR', hint: 'SBS/OU y altas tasas de fotogramas' },
  { key: 'hdr', label: 'Rango dinámico', hint: 'Dolby Vision, HDR10+, HLG, 10-bit' },
  { key: 'vcodec', label: 'Códec de vídeo', hint: 'HEVC, AV1, AVC, VP9…' },
  { key: 'acodec', label: 'Códec de audio', hint: 'Atmos, TrueHD, DTS, DD+, FLAC…' },
  { key: 'channels', label: 'Canales de audio', hint: '7.1, 5.1, 2.0, mono' },
  { key: 'source', label: 'Fuente', hint: 'REMUX, BluRay, WEB-DL, HDTV, CAM…' },
  { key: 'container', label: 'Contenedor', hint: 'MKV, MP4, AVI…' },
  { key: 'service', label: 'Servicio', hint: 'Netflix, Prime, Disney+… del nombre' },
  { key: 'audiosubs', label: 'Audio y subtítulos', hint: 'Multi, dual, dub, subs, CC' },
  { key: 'edition', label: 'Ediciones', hint: 'IMAX, Criterion, Director’s Cut…' },
  { key: 'language', label: 'Idioma', hint: 'ESP, LAT, ENG, JPN… del nombre' },
];
const BADGE_KEYS = BADGE_GROUPS.map((g) => g.key);

// ─────────────────────────────────────────────────────────────────────────────
// Patrones extra (sobre texto aplanado; \b para no caer dentro de palabras)
// ─────────────────────────────────────────────────────────────────────────────
const P_HFR = /\bhfr\b|high frame rate|\b60 ?fps\b|\b50 ?fps\b|\b1080p60\b|\b2160p60\b/g;
const P_HDR10PLUS = /\bhdr ?10 ?\+?\b(?= ?plus)|\bhdr10plus\b|\bhdr ?10 ?plus\b/g;
const P_HDR10 = /\bhdr ?10\b/g;
const P_HLG = /\bhlg\b/g;
const P_BIT = /\b12 ?bit\b|\b10 ?bit\b|\b8 ?bit\b/g;
const P_AVC = /\bx ?264\b|\bavc\b|\bh ?264\b/g;
const P_VP9 = /\bvp ?9\b/g;
const P_VP8 = /\bvp ?8\b/g;
const P_VVC = /\bvvc\b|\bh ?266\b/g;
const P_PRORES = /\bpro ?res\b/g;
const P_MPEG2 = /\bmpeg ?2\b/g;
const P_XVID = /\bxvid\b|\bdivx\b/g;
const P_WMV = /\bwmv\b/g;
const P_VC1 = /\bvc ?1\b/g;
const P_ATMOS = /\batmos\b/g;
const P_TRUEHD = /\btrue ?hd\b/g;
const P_DTSX = /\bdts ?x\b|\bdts ?: ?x\b/g;
const P_DTSHD = /\bdts ?hd\b|\bdts ?(?:ma|hra)\b|master audio/g;
const P_DTSES = /\bdts ?es\b/g;
const P_DTS = /\bdts\b/g;
const P_DDPLUS = /\bdd ?p\d?\b|\bddp\d?\b|\be ?ac ?3\b|\bdolby digital plus\b/g;
const P_DD = /\bdolby digital\b|\bac ?3\b|\baac\b|\bdd\b/g;
const P_FLAC = /\bflac\b/g;
const P_ALAC = /\balac\b/g;
const P_PCM = /\bl?pcm\b/g;
const P_OPUS = /\bopus\b/g;
const P_VORBIS = /\bvorbis\b|\borgg\b/g;
const P_MP3 = /\bmp3\b/g;
const P_WMA = /\bwma\b/g;
const P_CH = /\b(\d{1,2}(?:\.\d){0,2}) ?(?:ch\b|channels?\b)?(?= ?(?:\bch\b|\bchannels?\b|$| ))/g;
const P_MONO = /\bmono\b|\b1 ?\. ?0\b/g;
const P_STEREO = /\bstereo\b|\b2 ?\. ?0\b/g;
const P_UHD_BR = /\buhd ?blu ?ray\b|\buhd ?bd\b|\bbd ?(?:66|100)\b/g;
const P_WEBRIP = /\bweb ?rip\b|\bwebrip\b/g;
const P_HDTV = /\bhdtv\b|\bpdtv\b|\bsdtv\b/g;
const P_DVD = /\bdvd\b/g;
const P_MKV = /\bmkv\b/g;
const P_MP4 = /\bmp4\b|\bm4v\b/g;
const P_M2TS = /\bm2ts\b|\bmpeg ?ts\b/g;
const P_AVI = /\bavi\b/g;
const P_ISO = /\biso\b|\bbdmv\b/g;
const P_MULTI_AUDIO = /\bmulti ?audio\b|\bmulti ?lang(?:uage)?s?\b|\bmulti\b/g;
const P_DUAL = /\bdual ?audio\b|\bdual\b/g;
const P_DUBBED = /\bdubbed\b|\bdub\b|\bdoblad[oa]\b/g;
const P_SUBPACK = /\bsub ?pack\b/g;
const P_SUBS = /\bsubs?\b|\bsubtitulad[oa]\b|\bvo ?se\b/g;
const P_HARDSUB = /\bhard ?sub(?:s|tulado)?\b|\bhc\b/g;
const P_CC = /\bcc\b|\bcaptions?\b/g;
const P_COMMENTARY = /\bcommentary\b|\bcomentarios?\b/g;
const P_IMAX_ENH = /\bimax ?enhanced\b/g;
const P_IMAX = /\bimax\b/g;
const P_CRITERION = /\bcriterion\b/g;
const P_DIRECTOR = /director'?s? ?cut|\bdc\b/g;
const P_EXTENDED = /\bextended\b/g;
const P_THEATRICAL = /\btheatrical\b/g;
const P_FINAL_CUT = /\bfinal ?cut\b/g;
const P_UNRATED = /\bunrated\b/g;
const P_SPECIAL = /\bspecial ?edition\b/g;
const P_OPEN_MATTE = /\bopen ?matte\b/g;
const P_REMASTER = /\bremaster(?:ed|izada)?\b/g;
const P_HYBRID = /\bhybrid\b/g;
const P_PROPER = /\bproper\b|\brepack\b|\brr\b/g;
const P_LAT = /\blatino\b|\blatam\b|\bles ?la\b|\bmx\b|\blat\b/g;
const P_ESP = /\bespa[nn]ol\b|\bcastellano\b|\bcast\b|\besp\b|\bspa\b|\bspanish\b/g;
const P_ENG = /\bingles\b|\benglish\b|\beng\b|\bing\b/g;
const P_JPN = /\bjapones\b|\bjapanese\b|\bjpn\b|\bjap\b/g;
const P_FRA = /\bfrances\b|\bfrench\b|\bfra\b|\bvff\b|\bvfi\b/g;
const P_DEU = /\baleman\b|\bgerman\b|\bdeu\b|\bger\b/g;
const P_ITA = /\bitaliano\b|\bitalian\b|\bita\b/g;
// «brazilian», «dublado» y «nacional» son como firman los sitios brasileños
// (el Índice BR añade «(brazilian, eng)» al final del nombre).
const P_POR = /\bportugues\b|\bportuguese\b|\bbrazilian\b|\bdublado\b|\bnacional\b|\bpor\b|\bptb\b/g;
const P_KOR = /\bcoreano\b|\bkorean\b|\bkor\b/g;
const P_CHI = /\bchino\b|\bchinese\b|\bchi\b|\bzho\b/g;
const P_RUS = /\bruso\b|\brussian\b|\brus\b/g;
const P_HIN = /\bhindi\b|\bhin\b/g;

const SERVICES = [
  ['Netflix', /\bnetflix\b|\bnf\b/g],
  ['Prime', /\bprime ?video\b|\bamzn\b|\bamazon\b/g],
  ['Apple TV+', /\bapple ?tv ?\+?\b|\batvp\b/g],
  ['Disney+', /\bdisney ?\+?\b|\bdsnp\b/g],
  ['Max', /\bhbo ?max\b|\bhbo\b|\bmax\b/g],
  ['Hulu', /\bhulu\b/g],
  ['Paramount+', /\bparamount ?\+?\b|\bpmp\b/g],
  ['Peacock', /\bpeacock\b/g],
  ['Crunchyroll', /\bcrunchyroll\b|\bcr\b/g],
  ['YouTube', /\byou ?tube\b/g],
  ['JioHotstar', /\bhot ?star\b/g],
  ['ZEE5', /\bzee ?5\b/g],
  ['SonyLIV', /\bsony ?liv\b/g],
  ['Tubi', /\btubi\b/g],
  ['Pluto', /\bpluto\b/g],
  ['Mubi', /\bmubi\b/g],
];

// Tras flatten() los puntos son espacios («7.1» → «7 1»); el token visible
// conserva el punto. Orden de más canales a menos para que «7.1.4» no caiga
// en «7.1».
const CHANNEL_ORDER = [
  ['9.1.6', /(?<![0-9])9 1 6\b/g], ['9.1', /(?<![0-9])9 1\b/g],
  ['7.1.4', /(?<![0-9])7 1 4\b/g], ['7.1.2', /(?<![0-9])7 1 2\b/g], ['7.1', /(?<![0-9])7 1\b/g],
  ['6.1', /(?<![0-9])6 1\b/g],
  ['5.1.4', /(?<![0-9])5 1 4\b/g], ['5.1.2', /(?<![0-9])5 1 2\b/g], ['5.1', /(?<![0-9])5 1\b/g],
  ['4.1', /(?<![0-9])4 1\b/g], ['3.1', /(?<![0-9])3 1\b/g], ['2.1', /(?<![0-9])2 1\b/g],
];

/** Primer patrón que encuentra en `text` (ya aplanado), o null. */
function first(text, patterns) {
  for (const [token, re] of patterns) {
    re.lastIndex = 0;
    if (re.test(text)) return token;
  }
  return null;
}

/**
 * Detecta los tokens de un release.
 *
 * @param {string} name nombre del archivo/release
 * @param {string|string[]} titles títulos conocidos de la obra (para no
 *   autoetiquetar: «Max» como serie no es el servicio Max)
 * @returns {Record<string, string>} grupo → token (solo grupos presentes)
 */
function detectBadgeGroups(name, titles) {
  const raw = String(name || '').slice(0, 400);
  const text = flatten(raw);
  const known = (Array.isArray(titles) ? titles : [titles]).filter(Boolean).map((t) => flatten(t));
  const beyond = (re) => {
    re.lastIndex = 0;
    const inName = (text.match(re) || []).length;
    if (!inName) return false;
    let inTitle = 0;
    for (const ref of known) {
      re.lastIndex = 0;
      inTitle = Math.max(inTitle, (ref.match(re) || []).length);
    }
    return inName > inTitle;
  };
  const pick = (patterns) => {
    for (const [token, re] of patterns) if (beyond(re)) return token;
    return null;
  };

  const { quality, tags } = classify(raw, known.map((k) => k.trim()));
  const out = {};

  // Resolución: el número explícito manda; «4K/UHD» sin número es 2160p.
  let res = null;
  if (/^4320/.test(quality)) res = '8K';
  else if (/^2160/.test(quality) || tags.includes('4k')) res = '4K';
  else if (/^1440/.test(quality)) res = '1440p';
  else if (/^1080/.test(quality)) res = '1080p';
  else if (/^720/.test(quality)) res = '720p';
  else if (/^(576|480|360|240|144)/.test(quality)) res = quality;
  else if (tags.includes('sd')) res = 'SD';
  if (res) out.resolution = res;

  // 3D / HFR
  if (tags.includes('3d')) out.format3d = '3D';
  else if (beyond(P_HFR)) out.format3d = 'HFR';

  // Rango dinámico: Dolby Vision domina; luego el sabor de HDR más concreto.
  if (tags.includes('dv')) out.hdr = 'DV';
  else if (tags.includes('hdr')) {
    if (beyond(P_HDR10PLUS)) out.hdr = 'HDR10+';
    else if (beyond(P_HDR10)) out.hdr = 'HDR10';
    else if (beyond(P_HLG)) out.hdr = 'HLG';
    else out.hdr = 'HDR';
  } else if (beyond(P_BIT)) out.hdr = first(text, [['12-BIT', /\b12 ?bit\b/g], ['10-BIT', /\b10 ?bit\b/g], ['8-BIT', /\b8 ?bit\b/g]]);

  // Códec de vídeo
  if (tags.includes('av1')) out.vcodec = 'AV1';
  else if (tags.includes('hevc')) out.vcodec = 'HEVC';
  else out.vcodec = pick([
    ['VVC', P_VVC], ['AVC', P_AVC], ['VP9', P_VP9], ['VP8', P_VP8],
    ['ProRes', P_PRORES], ['MPEG-2', P_MPEG2], ['XviD', P_XVID], ['WMV', P_WMV], ['VC-1', P_VC1],
  ]);

  // Códec de audio (orden: de más a menos capacidad)
  out.acodec = pick([
    ['Atmos', P_ATMOS], ['TrueHD', P_TRUEHD], ['DTS-X', P_DTSX], ['DTS-HD', P_DTSHD],
    ['DTS-ES', P_DTSES], ['DTS', P_DTS], ['DD+', P_DDPLUS], ['DD', P_DD],
    ['FLAC', P_FLAC], ['ALAC', P_ALAC], ['PCM', P_PCM], ['Opus', P_OPUS],
    ['Vorbis', P_VORBIS], ['MP3', P_MP3], ['WMA', P_WMA],
  ]);

  // Canales: el número de canales declarado tal cual («7.1», «5.1», «2.0»…)
  let channels = null;
  for (const [token, re] of CHANNEL_ORDER) if (beyond(re)) { channels = token; break; }
  if (!channels && beyond(P_MONO)) channels = '1.0';
  if (!channels && beyond(P_STEREO)) channels = '2.0';
  if (channels) out.channels = channels;

  // Fuente (clasify ya la dejó en tags; aquí se afina el sabor)
  if (tags.includes('remux')) out.source = 'REMUX';
  else if (tags.includes('bluray')) out.source = beyond(P_UHD_BR) ? 'UHD-BR' : 'BluRay';
  else if (tags.includes('web')) out.source = beyond(P_WEBRIP) ? 'WEBRip' : 'WEB-DL';
  else if (tags.includes('cam')) out.source = 'CAM';
  else if (tags.includes('scr')) out.source = 'SCR';
  else if (beyond(P_HDTV)) out.source = 'HDTV';
  else if (beyond(P_DVD)) out.source = 'DVD';

  // Contenedor
  out.container = pick([['MKV', P_MKV], ['MP4', P_MP4], ['M2TS', P_M2TS], ['AVI', P_AVI], ['ISO', P_ISO]]);

  // Servicio de streaming
  for (const [token, re] of SERVICES) if (beyond(re)) { out.service = token; break; }

  // Audio y subtítulos
  out.audiosubs = pick([
    ['MULTI', P_MULTI_AUDIO], ['DUAL', P_DUAL], ['DUBBED', P_DUBBED], ['SUBPACK', P_SUBPACK],
    ['HARDSUB', P_HARDSUB], ['SUBS', P_SUBS], ['CC', P_CC], ['COMMENTARY', P_COMMENTARY],
  ]);

  // Ediciones y cortes
  out.edition = pick([
    ['IMAX Enhanced', P_IMAX_ENH], ['IMAX', P_IMAX], ['Criterion', P_CRITERION],
    ['Director’s Cut', P_DIRECTOR], ['Extended', P_EXTENDED], ['Theatrical', P_THEATRICAL],
    ['Final Cut', P_FINAL_CUT], ['Unrated', P_UNRATED], ['Special', P_SPECIAL],
    ['Open Matte', P_OPEN_MATTE], ['Remastered', P_REMASTER], ['Hybrid', P_HYBRID], ['PROPER', P_PROPER],
  ]);

  // Idioma del release: latino antes que español («Español latino» es LAT)
  out.language = pick([
    ['LAT', P_LAT], ['ESP', P_ESP], ['ENG', P_ENG], ['JPN', P_JPN], ['FRA', P_FRA],
    ['DEU', P_DEU], ['ITA', P_ITA], ['POR', P_POR], ['KOR', P_KOR], ['CHI', P_CHI],
    ['RUS', P_RUS], ['HIN', P_HIN],
  ]);

  for (const key of Object.keys(out)) if (!out[key]) delete out[key];
  return out;
}

/**
 * Tokens en orden de grupo, solo de los grupos activados.
 *
 * @param {string} name nombre del release
 * @param {string|string[]} titles títulos de la obra
 * @param {string[]|null} enabled grupos activos (null o ausente = todos)
 * @returns {string[]} p. ej. ['4K', 'DV', 'HEVC', 'Atmos', '7.1', 'REMUX', 'MKV', 'ESP']
 */
function badgeTokens(name, titles, enabled) {
  const found = detectBadgeGroups(name, titles);
  const on = Array.isArray(enabled) ? new Set(enabled) : null;
  const tokens = [];
  for (const group of BADGE_GROUPS) {
    if (on && !on.has(group.key)) continue;
    if (found[group.key]) tokens.push(found[group.key]);
  }
  return tokens;
}

/** Línea de etiquetas lista para el stream (vacía si no hay ninguna). */
function badgeLine(name, titles, enabled) {
  return badgeTokens(name, titles, enabled).join(' · ');
}

module.exports = {
  BADGE_GROUPS,
  BADGE_KEYS,
  detectBadgeGroups,
  badgeTokens,
  badgeLine,
};
