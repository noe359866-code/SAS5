'use strict';

/**
 * Lista M3U de todos los canales del addon.
 *
 * Petición del usuario (25-11-2026): «guarda todos los canales y todo en el
 * repo como si fuera una lista m3u». La lista vive en
 * `listas/ramdonlatam-tv.m3u`, la genera `scripts/m3u-export.mjs` y la
 * Action semanal la regenera junto a las semillas.
 *
 * Contenido:
 *  - Los canales vivos ya fusionados y reclasificados por tema
 *    (lib/liveChannels.js): verificados primero y «⚠️ sin verificar»
 *    después, país como sufijo del nombre («Canal 10 HD (Nicaragua)»).
 *  - Las señales alternativas de un mismo canal como entradas
 *    «Nombre · señal N» (el addon las usa de respaldo; en la lista quedan
 *    visibles para cualquier reproductor).
 *  - Los 20 canales deportivos curados (lib/sportsChannels.js) con su URL
 *    de respaldo, en el grupo «Deportes».
 *
 * Formato: EXTINF estándar con tvg-id, tvg-logo y group-title (el tema);
 * EXTVLCOPT para UA/referer cuando la fuente lo exige.
 */

const live = require('./liveChannels');
const { SPORTS_CHANNELS, CHANNEL_LOGOS } = require('./sportsChannels');

const GENERATED_NOTE = '# Generada por scripts/m3u-export.mjs — no editar a mano';

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
 * Texto M3U completo. `channels` = tarjetas indexadas del addon
 * (de liveChannels); se respeta su orden de llegada.
 */
function buildM3U(channels, { generatedAt } = {}) {
  const lines = ['#EXTM3U', GENERATED_NOTE];
  if (generatedAt) lines.push(`# Fecha: ${generatedAt}`);
  let entries = 0;
  for (const ch of channels) {
    const group = live.CATEGORY_LABELS[ch.category] || ch.category;
    ch.urls.forEach((u, i) => {
      lines.push(...entryLines({
        name: ch.name,
        slug: i === 0 ? ch.slug : `${ch.slug}-senal-${i + 1}`,
        logo: ch.logo,
        group,
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

/**
 * Tarjetas del addon en orden editorial: temas en el orden de
 * LIVE_CATEGORIES, verificadas antes que «sin verificar», alfabético dentro.
 * El país va en el nombre («Canal 10 HD (Nicaragua)»); el ⚠️ marca las
 * señales que la sonda no pudo comprobar.
 */
function playlistChannels() {
  const out = [];
  for (const cat of live.LIVE_CATEGORIES) {
    const metas = live.liveMetas(cat.key, {});
    const channels = metas
      .map((m) => live.liveChannelById(m.id))
      .filter(Boolean);
    channels.sort((a, b) =>
      (a.unverified ? 1 : 0) - (b.unverified ? 1 : 0)
      || a.name.localeCompare(b.name, 'es'));
    for (const ch of channels) {
      const countries = [ch.country, ...(ch.countries || [])].filter(Boolean);
      const where = countries.length ? ` (${countries.join(' · ')})` : '';
      out.push({
        ...ch,
        name: `${ch.name}${where}${ch.unverified ? ' ⚠️' : ''}`,
      });
    }
  }
  // Los curados de deportes: catálogo estable con URL de respaldo propia.
  for (const c of SPORTS_CHANNELS) {
    if (!c.fallback) continue;
    out.push({
      name: c.name,
      slug: `curado-${c.key}`,
      category: 'deportes',
      logo: CHANNEL_LOGOS[c.key] || '',
      urls: [{ url: c.fallback, ua: '', ref: '' }],
    });
  }
  return out;
}

module.exports = { buildM3U, playlistChannels, GENERATED_NOTE };
