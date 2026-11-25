'use strict';

/**
 * Lista M3U de todos los canales, ORDENADA POR PAÍS.
 *
 * Petición del usuario (25-11-2026): la TV en vivo salió del addon y vive en
 * una lista aparte — `listas/ramdonlatam-tv.m3u` — con los canales agrupados
 * por país («group-title») y engordada con la mega-sonda de iptvgo.cc
 * (+13.000 canales de LATAM, Brasil, España, EE. UU., eventos/PPV, 24/7 y
 * plataformas tipo Netflix/HBO Max/Disney+…). La genera
 * `scripts/m3u-export.mjs` y la Action semanal la regenera junto a las
 * semillas.
 *
 * Fuentes fusionadas:
 *  - lib/data/liveChannelsSeed.json (verificados por sonda),
 *  - lib/data/liveChannelsUnverifiedSeed.json (iptvgo latam),
 *  - lib/data/liveChannelsMegaSeed.json (iptvgo completo por países),
 *  - lib/sportsChannels.js (deportes curados con URL de respaldo).
 *
 * Reglas: group-title = país (o tema si el canal no tiene país: «Deportes»,
 * «Música»…); nombres limpios sin marcas (petición del usuario, 25-11-2026:
 * nada de «⚠️ sin verificar»); las señales alternativas del mismo canal
 * entran como «Nombre · señal N»; EXTVLCOPT cuando la fuente declara
 * UA/referer.
 */

const { cleanChannelName } = require('./liveChannelNames');
const { TOPIC_LABELS, thematicCategoryOf, countryLabelOf } = require('./liveTopics');
const { SPORTS_CHANNELS, CHANNEL_LOGOS } = require('./sportsChannels');

const verifiedSeed = require('./data/liveChannelsSeed.json');
const unverifiedSeed = require('./data/liveChannelsUnverifiedSeed.json');
let megaSeed = [];
try {
  megaSeed = require('./data/liveChannelsMegaSeed.json');
} catch {
  // La mega-sonda aún no ha corrido en CI; la lista sale con las demás fuentes.
}

const GENERATED_NOTE = '# Generada por scripts/m3u-export.mjs — no editar a mano';

/** Orden de temas dentro de cada grupo de país. */
const TOPIC_ORDER = ['deportes', 'noticias', 'entretenimiento', 'cine', 'infantil',
  'anime', 'musica', 'documentales', 'religion'];
const topicOrder = new Map(TOPIC_ORDER.map((t, i) => [t, i]));
const TOPIC_GROUP_LABELS = new Set(Object.values(TOPIC_LABELS)); // «Deportes», «Cine»…

const slugOf = (name) => String(name || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

const normName = (value) => String(value || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const baseNameOf = (name) => String(name || '').replace(/\s*\[Opc\.?\s*\d+\]\s*$/i, '').trim();

const esc = (value) => String(value || '').replace(/"/g, "'").trim();

/** Una entrada EXTINF por URL; las señales extra llevan « · señal N». */
function entryLines({ name, slug, logo, group, url, ua, ref, suffix }) {
  const lines = [
    `#EXTINF:-1 tvg-id="${esc(slug)}" tvg-logo="${esc(logo)}" group-title="${esc(group)}",${esc(name)}${suffix || ''}`,
  ];
  if (ua) lines.push(`#EXTVLCOPT:http-user-agent=${ua}`);
  if (ref) lines.push(`#EXTVLCOPT:http-referrer=${ref}`);
  lines.push(url);
  return lines;
}

/**
 * Texto M3U completo. `channels` llega ya ordenado de playlistChannels()
 * (cada canal trae `group`, `urls`, `logo` y `unverified`).
 */
function buildM3U(channels, { generatedAt } = {}) {
  const lines = ['#EXTM3U', GENERATED_NOTE];
  if (generatedAt) lines.push(`# Fecha: ${generatedAt}`);
  let entries = 0;
  for (const ch of channels) {
    ch.urls.forEach((u, i) => {
      lines.push(...entryLines({
        name: ch.name,
        slug: i === 0 ? ch.slug : `${ch.slug}-senal-${i + 1}`,
        logo: ch.logo,
        group: ch.group,
        url: u.url,
        ua: u.ua,
        ref: u.ref,
        suffix: i === 0 ? '' : ` · señal ${i + 1}`,
      }));
      entries += 1;
    });
  }
  return { m3u: lines.join('\n') + '\n', entries, channels: channels.length };
}

/** Fusiona una entrada cruda en el mapa «grupo|nombre» (varias señales por canal). */
function mergeInto(merged, raw, { unverified, topicFixed, countryFixed } = {}) {
  const clean = cleanChannelName(baseNameOf(raw.name), topicFixed || raw.category);
  // Nombre basura (<2 letras tras limpiar): no es un canal.
  if ((clean.match(/[a-záéíóúñ]/gi) || []).length < 2) return;
  const topic = topicFixed || thematicCategoryOf(clean, raw.category);
  const country = countryFixed !== undefined
    ? countryFixed
    : (raw.country || countryLabelOf(raw.category) || '');
  const group = country || TOPIC_LABELS[topic] || 'Otros';
  const key = `${group}|${normName(clean)}`;
  const entry = { url: raw.url, ua: raw.ua || '', ref: raw.ref || '' };
  if (!entry.url) return;
  const existing = merged.get(key);
  if (existing) {
    if (!existing.urls.some((u) => u.url.split('?')[0] === entry.url.split('?')[0])) {
      existing.urls.push(entry);
    }
    if (!existing.logo && raw.logo) existing.logo = raw.logo;
    if (existing.unverified && !unverified) existing.unverified = false;
    return;
  }
  merged.set(key, {
    name: clean,
    slug: slugOf(clean),
    topic,
    group,
    logo: raw.logo || '',
    urls: [entry],
    unverified,
  });
}

/**
 * Lista completa en orden editorial: primero los grupos de país/región en
 * alfabético (EE. UU., España, Latinoamérica, México, Nicaragua…), luego los
 * grupos temáticos sin país («Deportes», «Música»…, donde caen los canales
 * internacionales verificados y los curados). Dentro de cada grupo: tema en
 * TOPIC_ORDER, verificados primero, alfabético al final.
 */
function playlistChannels() {
  const merged = new Map();
  for (const raw of verifiedSeed) mergeInto(merged, raw, { unverified: false });
  for (const raw of unverifiedSeed) mergeInto(merged, raw, { unverified: true });
  for (const raw of megaSeed) {
    mergeInto(merged, raw, { unverified: true, topicFixed: raw.topic, countryFixed: raw.country });
  }
  // Los curados de deportes (URL de respaldo propia) al grupo «Deportes».
  for (const c of SPORTS_CHANNELS) {
    if (!c.fallback) continue;
    mergeInto(merged, { name: c.name, logo: CHANNEL_LOGOS[c.key] || '', url: c.fallback },
      { unverified: false, topicFixed: 'deportes', countryFixed: '' });
  }
  return [...merged.values()]
    .sort((a, b) =>
      (TOPIC_GROUP_LABELS.has(a.group) ? 1 : 0) - (TOPIC_GROUP_LABELS.has(b.group) ? 1 : 0)
      || a.group.localeCompare(b.group, 'es')
      || (topicOrder.get(a.topic) ?? 99) - (topicOrder.get(b.topic) ?? 99)
      || (a.unverified ? 1 : 0) - (b.unverified ? 1 : 0)
      || a.name.localeCompare(b.name, 'es'))
    .map((ch) => ({ ...ch }));
}

module.exports = { buildM3U, playlistChannels, GENERATED_NOTE };
