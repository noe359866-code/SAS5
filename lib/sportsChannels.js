'use strict';

/**
 * Canales de deportes en vivo (tipo `tv` de Stremio).
 *
 * Catálogo estático: cada canal tiene un `match` (regex sobre los nombres de
 * las listas públicas de iptv-org), un `poster` (logo oficial tomado del
 * tvg-logo de esas mismas listas, sonda 24-11-2026) y, cuando la sonda
 * encontró una URL que sirvió HLS sin cabeceras especiales, un `fallback`
 * con esa última URL verificada. El proveedor `lib/iptvOrg.js` resuelve en
 * vivo y el fallback cubre los huecos temporales de la lista.
 *
 * Los ids son `rlch:<clave>` (prefijo declarado en el manifest).
 */

const CHANNEL_ID_PREFIX = 'rlch:';

const SPORTS_CHANNELS = [
  // ── ESPN ────────────────────────────────────────────────────────────────
  { key: 'espn', name: 'ESPN', lang: 'Español latino',
    match: /^ESPN(?! ?\d| ?Premium| ?Deportes| ?U| ?8| ?\().*Latin America/i,
    fallback: 'http://181.78.211.244/play/a08q/index.m3u8' }, // LA Colombia, válido 24-11-2026
  { key: 'espn2', name: 'ESPN 2', lang: 'Español latino',
    match: /^ESPN 2.*Latin America/i,
    fallback: 'http://38.211.118.56/play/a0fa/index.m3u8' }, // LA Colombia, válido 24-11-2026
  { key: 'espn3', name: 'ESPN 3', lang: 'Español latino',
    match: /^ESPN 3.*Latin America/i },
  { key: 'espn-premium', name: 'ESPN Premium', lang: 'Español latino',
    match: /^ESPN Premium(?! ?HD)/i,
    fallback: 'http://45.134.141.161/ARG/ESPN_Premium_Argentina_HD/tracks-v1a1/mono.m3u8' }, // AR, 206 válido
  { key: 'espn-deportes', name: 'ESPN Deportes', lang: 'Español (EE. UU.)',
    match: /^ESPN Deportes/i },

  // ── FOX Sports ──────────────────────────────────────────────────────────
  { key: 'fox-sports', name: 'Fox Sports', lang: 'Español latino',
    match: /^Fox Sports(?! ?\d| ?News| ?Premium)( HD)?$/i,
    fallback: 'http://45.184.109.10/live/69393EAE6ADBC65A68F942022362A202/1552.m3u8' }, // Fox Sports HD, válido
  { key: 'fox-sports-1', name: 'Fox Sports 1', lang: 'Inglés / Español (SAP)',
    match: /^Fox Sports 1(?![\d\w])/i,
    fallback: 'http://85.237.89.160/usa-s/FOX-SPORTS-1/index.m3u8' }, // US 720p, 206 válido
  { key: 'fox-sports-2', name: 'Fox Sports 2', lang: 'Inglés / Español (SAP)',
    match: /^Fox Sports 2(?![\d\w])/i },
  { key: 'fox-deportes', name: 'Fox Deportes', lang: 'Español (EE. UU.)',
    match: /^Fox Deportes/i,
    fallback: 'https://live-manifest.production-public.tubi.io/live/d906efca-1302-4e29-b0d9-9a1d7a305d69/playlist.m3u' }, // Tubi, válido

  // ── DGO / DIRECTV ───────────────────────────────────────────────────────
  { key: 'dsports', name: 'DSports (DGO)', lang: 'Español latino',
    match: /^DSports(?! ?\d| ?Plus| ?\+| ?2)/i },
  { key: 'dsports2', name: 'DSports 2 (DGO)', lang: 'Español latino',
    match: /^DSports 2/i,
    fallback: 'http://45.134.141.161/ARG/DTV_SP2/tracks-v1a1/mono.m3u8' }, // 206 válido
  { key: 'dsports-plus', name: 'DSports+ (DGO)', lang: 'Español latino',
    match: /^DSports ?(Plus|\+)/i },

  // ── DAZN ────────────────────────────────────────────────────────────────
  // La señal principal de DAZN no tiene URL verificable en las listas
  // públicas (24-11-2026); si la lista la revive, el matcher la toma sola.
  { key: 'dazn', name: 'DAZN', lang: 'Español',
    match: /^DAZN ?1?(?! ?\d| Combat| Darts| Heldinnen| F1| Germany| Portugal)/i },
  { key: 'dazn-combat', name: 'DAZN Combat', lang: 'Español',
    match: /^DAZN Combat/i,
    fallback: 'https://jmp2.uk/plu-64d626ac9b414d000820e2fc.m3u8' }, // Pluto, válido

  // ── Más deportes ────────────────────────────────────────────────────────
  { key: 'tnt-sports', name: 'TNT Sports', lang: 'Español latino',
    match: /^TNT Sports \((Argentina|Chile)\)/i,
    fallback: 'http://45.184.109.10/live/69393EAE6ADBC65A68F942022362A202/86.m3u8' }, // AR, válido
  { key: 'tyc-sports', name: 'TyC Sports', lang: 'Español (Argentina)',
    match: /^TyC Sports(?! USA)/i,
    fallback: 'https://amg26268-amg26268c14-freelivesports-emea-10267.playouts.now.amagi.tv/ts-us-e2-n2/playlist/amg26268-sportsstudio-tycsports-freelivesportsemea/playlist.m3u8' }, // Amagi, válido 24-11-2026
  { key: 'win-sports', name: 'Win Sports', lang: 'Español (Colombia)',
    match: /^Win Sports(?! ?\+| ?Plus)/i,
    fallback: 'http://138.121.15.230/WIN-SPORT/index.m3u8' }, // 206 válido
  { key: 'claro-sports', name: 'Claro Sports', lang: 'Español latino',
    match: /^Claro Sports?/i,
    fallback: 'http://45.171.64.30/play/a00w/index.m3u8' }, // válido
  { key: 'bein-xtra-es', name: 'beIN Sports XTRA en Español', lang: 'Español',
    match: /^beIN SPORTS XTRA en Espanol/i,
    fallback: 'https://dc1644a9jazgj.cloudfront.net/beIN_Sports_Xtra_Espanol.m3u8' }, // 206 válido
  { key: 'pluto-deportes', name: 'Pluto TV Deportes', lang: 'Español latino',
    match: /^Pluto TV Deportes/i,
    fallback: 'https://jmp2.uk/plu-5dcde07af1c85b0009b18651.m3u8' }, // Pluto, válido
];

/** Logos oficiales por canal (tvg-logo de las listas públicas). */
const CHANNEL_LOGOS = {
  'espn': 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/960px-ESPN_wordmark.svg.png',
  'espn2': 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/ESPN2_logo.svg/960px-ESPN2_logo.svg.png',
  'espn3': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/51/ESPN3_Logo.png/960px-ESPN3_Logo.png',
  'espn-premium': 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/ESPN_Premium_logo.svg/960px-ESPN_Premium_logo.svg.png',
  'espn-deportes': 'https://imgx.fubo.tv/station_logos/espn-hd-deportes_c.png',
  'fox-sports': 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/FOX_Sports_logo.svg/960px-FOX_Sports_logo.svg.png',
  'fox-sports-1': 'https://i.imgur.com/O9BapV9.png',
  'fox-sports-2': 'https://imgx.fubo.tv/station_logos/fs2_c.png',
  'fox-deportes': 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/FOX_Deportes_logo.png/960px-FOX_Deportes_logo.png',
  'dsports': 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/DirecTV_Sports_Latin_America_%282018%29.png/960px-DirecTV_Sports_Latin_America_%282018%29.png',
  'dsports2': 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/10/DIRECTV_Sports_2_Latin_America_%282018%29.svg/960px-DIRECTV_Sports_2_Latin_America_%282018%29.svg.png',
  'dsports-plus': 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/DirecTV_Sports_Latin_America_%282018%29.png/960px-DirecTV_Sports_Latin_America_%282018%29.png',
  'dazn': 'https://i.imgur.com/2Z2EmZF.png',
  'dazn-combat': 'https://i.postimg.cc/VsW3Jsrz/logo-DAZN-Combat.png',
  'tnt-sports': 'https://github.com/tv-logo/tv-logos/blob/main/countries/united-kingdom/tnt-sports-1-uk.png?raw=true',
  'tyc-sports': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/54/TyC_Sports_logo.svg/960px-TyC_Sports_logo.svg.png',
  'win-sports': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Win_Sports_logo.svg/960px-Win_Sports_logo.svg.png',
  'claro-sports': 'https://i.imgur.com/n0kd17r.png',
  'bein-xtra-es': 'https://i.imgur.com/V562tpO.png',
  'pluto-deportes': 'https://images.pluto.tv/channels/5dcde07af1c85b0009b18651/colorLogoPNG_1766080575034.png',
};

const byKey = new Map(SPORTS_CHANNELS.map((c) => [c.key, c]));
for (const c of SPORTS_CHANNELS) c.id = `${CHANNEL_ID_PREFIX}${c.key}`;

/** Parsea un id `rlch:<clave>` → definición de canal o null. */
function channelById(id) {
  const raw = String(id || '');
  if (!raw.startsWith(CHANNEL_ID_PREFIX)) return null;
  return byKey.get(raw.slice(CHANNEL_ID_PREFIX.length)) || null;
}

/** Meta de Stremio para un canal (type tv). Logo: el de la lista, si hay. */
function channelMeta(channel, logo) {
  const image = logo || CHANNEL_LOGOS[channel.key] || null;
  return {
    id: `${CHANNEL_ID_PREFIX}${channel.key}`,
    type: 'tv',
    name: channel.name,
    description: `${channel.name} en vivo. Audio: ${channel.lang}. Señal pública verificada por el addon.`,
    genres: ['Deportes'],
    poster: image,
    posterShape: 'square',
    logo: image || undefined,
    background: image || undefined,
  };
}

/** Metas del catálogo «Canales de deportes». */
function channelMetas(logos = {}) {
  return SPORTS_CHANNELS.map((c) => channelMeta(c, logos[c.key]));
}

module.exports = { CHANNEL_ID_PREFIX, SPORTS_CHANNELS, CHANNEL_LOGOS, channelById, channelMeta, channelMetas };
