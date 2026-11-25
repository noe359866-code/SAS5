'use strict';

/**
 * Canales de TV en vivo por TEMA (tipo `tv` de Stremio): entretenimiento,
 * cine, infantil, anime, música, noticias, documentales y religión. Los
 * canales que la semilla trae etiquetados por país se reparten por tema
 * (lib/liveTopics.js) y el país queda como etiqueta de la tarjeta — sin
 * estantes por país (decisión del usuario, 25-11-2026).
 *
 * A diferencia del catálogo curado de deportes (lib/sportsChannels.js), estos
 * canales salen de dos listas públicas elegidas por el usuario:
 *  - Magma TV  (repo JMigue85/IPTV-SV): nombra los canales de
 *    m3u.tvcluboficial.com (sonda 13: no exige UA, CORS abierto).
 *  - Cinecity (repo CINECITY2023/cinecity): +500 canales con logo propio,
 *    grupos temáticos y 17 países (incl. Nicaragua).
 *  m3uts.xyz (tokens que caducan en horas) sigue bloqueado.
 *
 * Además, `lib/data/liveChannelsUnverifiedSeed.json` trae los canales de
 * iptvgo.cc (panel Xtream) SIN VERIFICAR — la sonda 14 midió que sus segmentos
 * dan 403 desde IPs de datacenter, así que no pasan la barra de verificación;
 * entran marcados «⚠️ sin verificar» a petición del usuario.
 *
 * Semilla: `lib/data/liveChannelsSeed.json` contiene los canales que la sonda
 * del 24-11-2026 (`.probe/live-lists.md`) verificó con HLS real. El catálogo
 * siempre se renderiza desde la semilla (estable) y la resolución intenta
 * refrescar la URL desde la lista viva (cacheada 12 h); si el canal ya no
 * está en la lista, se usa la URL de la semilla.
 *
 * Las variantes «[Opc. N]» del mismo canal se colapsan en una sola tarjeta
 * con varias URL (varios streams entre los que elegir).
 *
 * Los ids son `rlch:lv:<categoría>:<slug>` (prefijo `rlch:` ya declarado).
 * Las entradas pueden declarar su propio User-Agent (#EXTVLCOPT): se pasa a
 * Stremio vía behaviorHints.proxyHeaders.
 */

const config = require('./config');
const cache = require('./cache');
const { cleanChannelName } = require('./liveChannelNames');
const { TOPICS, TOPIC_LABELS, thematicCategoryOf, countryLabelOf } = require('./liveTopics');
const seed = require('./data/liveChannelsSeed.json');
const unverifiedSeed = require('./data/liveChannelsUnverifiedSeed.json');

const LIVE_ID_PREFIX = 'rlch:lv:';

/** Listas vivas que alimentan las categorías (se cachean 12 h por isolate). */
const LIVE_LISTS = [
  'https://raw.githubusercontent.com/JMigue85/IPTV-SV/main/Magma%20TV%20-Titan2022_XD.m3u',
  'https://raw.githubusercontent.com/CINECITY2023/cinecity/cinecity.net/principal.m3u',
];

/** Host bloqueado: sus URLs llevan token que caduca en horas (sonda 13). */
const BLOCKED_HOST = /(^|\.)m3uts\.xyz$/;
const isBlockedUrl = (raw) => {
  try { return BLOCKED_HOST.test(new URL(String(raw)).hostname); } catch { return true; }
};

/** Nombre visible limpio: banderas, emoji y toda la decoración del panel
 *  (letras pequeñas, marcas «®», prefijos de operador, MAYÚSCULAS fijas).
 *  Implementación compartida en lib/liveChannelNames.js. */
const cleanName = cleanChannelName;

/** Estantes con catálogo propio, en orden de aparición. «deportes» no es un
 *  estante aparte en el manifest (tv_deportes lo mezcla con los curados),
 *  pero sí existe como categoría interna: la sonda lo alimenta. */
const LIVE_CATEGORIES = [{ key: 'deportes', name: '⚽ Deportes en vivo' }, ...TOPICS];

/** Etiqueta editorial por tema (géneros y descripción de las tarjetas). */
const CATEGORY_LABELS = { deportes: 'Deportes', ...TOPIC_LABELS };

const UA_GENERIC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const slugOf = (name) => String(name || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** «Claro Sports 2 HD (México) [Opc.2]» → base sin variante. */
const baseSlugOf = (slug) => String(slug || '').replace(/-?opc-?\d+$/, '');
const baseNameOf = (name) => String(name || '').replace(/\s*\[Opc\.?\s*\d+\]\s*$/i, '').trim();

/**
 * Semilla indexada por categoría → slug base → canal.
 * Las variantes Opc.2/3 del mismo canal se fusionan: una tarjeta, varias URL.
 */
const seedByCategory = new Map();
for (const raw of seed) {
  const clean = cleanChannelName(baseNameOf(raw.name), raw.category);
  // Nombre basura (<2 letras tras limpiar, p. ej. «5», «??»): no es tarjeta.
  if ((clean.match(/[a-záéíóúñ]/gi) || []).length < 2) continue;
  // Reclasificación temática: la categoría-país de la semilla se reparte por
  // tema; el país queda como etiqueta de la tarjeta.
  const category = thematicCategoryOf(clean, raw.category);
  const country = raw.country || countryLabelOf(raw.category);
  if (!seedByCategory.has(category)) seedByCategory.set(category, new Map());
  const bySlug = seedByCategory.get(category);
  const base = baseSlugOf(slugOf(clean));
  const existing = bySlug.get(base);
  const entry = { url: raw.url, ua: raw.ua || '', ref: raw.ref || '' };
  if (existing) {
    if (!existing.urls.some((u) => u.url.split('?')[0] === entry.url.split('?')[0])) {
      existing.urls.push(entry);
    }
    if (!existing.logo && raw.logo) existing.logo = raw.logo;
    if (!existing.country && country) existing.country = country;
  } else {
    bySlug.set(base, {
      name: clean,
      slug: base,
      category,
      country,
      logo: raw.logo || '',
      urls: [entry],
    });
  }
}

// Canales SIN VERIFICAR (iptvgo.cc): mismas tarjetas por categoría. Si el slug
// ya existe como verificado, sus URLs entran como señales extra y manda lo
// verificado; si no, la tarjeta nace marcada «sin verificar».
for (const raw of unverifiedSeed) {
  const clean = cleanChannelName(baseNameOf(raw.name), raw.category);
  if ((clean.match(/[a-záéíóúñ]/gi) || []).length < 2) continue;
  const category = thematicCategoryOf(clean, raw.category);
  const country = raw.country || countryLabelOf(raw.category);
  if (!seedByCategory.has(category)) seedByCategory.set(category, new Map());
  const bySlug = seedByCategory.get(category);
  const base = baseSlugOf(slugOf(clean));
  const existing = bySlug.get(base);
  const entry = { url: raw.url, ua: raw.ua || '', ref: raw.ref || '' };
  if (existing) {
    if (!existing.urls.some((u) => u.url.split('?')[0] === entry.url.split('?')[0])) {
      existing.urls.push(entry);
    }
    if (!existing.country && country) existing.country = country;
  } else {
    bySlug.set(base, {
      name: clean,
      slug: base,
      category,
      country,
      logo: raw.logo || '',
      urls: [entry],
      unverified: true,
    });
  }
}

// Segunda pasada de metadatos: la variante de calidad («Telefe HD», «DSports HD»)
// es el mismo canal que la base («Telefe», «DSports»): se funde en su tarjeta
// como una URL más. Si no hay tarjeta base («La 1 HD»), se queda como está.
// La clave es el slug del nombre YA limpio: el slug crudo de la semilla puede
// arrastrar prefijos («mx-estrella-news-uhd») que escondían la variante.
const QUALITY_SUFFIX = /-(?:fhd|uhd|4k|hd|sdt|sd)$/;
for (const bySlug of seedByCategory.values()) {
  const cleanSlugOf = new Map([...bySlug].map(([slug, ch]) => [slug, slugOf(ch.name)]));
  for (const [slug, ch] of [...bySlug]) {
    const m = QUALITY_SUFFIX.exec(cleanSlugOf.get(slug));
    if (!m) continue;
    const baseClean = cleanSlugOf.get(slug).slice(0, m.index);
    const targetSlug = [...cleanSlugOf].find(([other, clean], ) => other !== slug && clean === baseClean)?.[0];
    const target = targetSlug ? bySlug.get(targetSlug) : null;
    if (!target) continue;
    for (const u of ch.urls) {
      if (!target.urls.some((t) => t.url.split('?')[0] === u.url.split('?')[0])) target.urls.push(u);
    }
    if (!target.logo && ch.logo) target.logo = ch.logo;
    bySlug.delete(slug);
  }
}

// Tercera pasada: el mismo canal llega a veces con dos nombres crudos que
// limpian igual («Carib AXN» y «AXN», «24 HORAS» y «24 Horas (HD)» con slug
// distinto). Se fusionan en una tarjeta; gana la primera (la semilla
// verificada se indexa antes, así que manda lo verificado).
const normName = (value) => String(value || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
for (const bySlug of seedByCategory.values()) {
  const byName = new Map();
  for (const [slug, ch] of [...bySlug]) {
    const key = normName(ch.name);
    const target = key ? byName.get(key) : null;
    if (!target || target === ch) { if (key && !byName.has(key)) byName.set(key, ch); continue; }
    for (const u of ch.urls) {
      if (!target.urls.some((t) => t.url.split('?')[0] === u.url.split('?')[0])) target.urls.push(u);
    }
    if (!target.logo && ch.logo) target.logo = ch.logo;
    if (target.unverified && !ch.unverified) target.unverified = false;
    bySlug.delete(slug);
  }
}

// Cuarta pasada: fusión transversal por nombre. Con los países fuera de los
// estantes, el mismo canal puede quedar duplicado entre temas por deslices
// del clasificador («Televisa Novelas» en infantil y en entretenimiento).
// Se fusiona en una sola tarjeta; gana la verificada o, en empate, la de
// más señales; en último empate, el primer tema en LIVE_CATEGORIES.
const topicOrder = new Map(LIVE_CATEGORIES.map((c, i) => [c.key, i]));
const globalByName = new Map();
for (const bySlug of seedByCategory.values()) {
  for (const [slug, ch] of [...bySlug]) {
    const key = normName(ch.name);
    const target = key ? globalByName.get(key) : null;
    if (!target) { if (key) globalByName.set(key, ch); continue; }
    const targetWins = (target.unverified === ch.unverified)
      ? (target.urls.length !== ch.urls.length
          ? target.urls.length > ch.urls.length
          : (topicOrder.get(target.category) ?? 99) <= (topicOrder.get(ch.category) ?? 99))
      : !target.unverified;
    const winner = targetWins ? target : ch;
    const loser = targetWins ? ch : target;
    for (const u of loser.urls) {
      if (!winner.urls.some((t) => t.url.split('?')[0] === u.url.split('?')[0])) winner.urls.push(u);
    }
    if (!winner.logo && loser.logo) winner.logo = loser.logo;
    if (winner.unverified && !loser.unverified) winner.unverified = false;
    if (!winner.country && loser.country) winner.country = loser.country;
    // Países distintos con el mismo nombre (homónimos regionales): la tarjeta
    // conserva el país del ganador y suma el del perdedor si es distinto
    if (loser.country && winner.country && loser.country !== winner.country
        && !(winner.countries || []).includes(loser.country)) {
      winner.countries = [...(winner.countries || []), loser.country];
    }
    globalByName.set(key, winner);
    seedByCategory.get(loser.category)?.delete(loser.slug);
  }
}

/** Categorías que tienen al menos un canal verificado en la semilla. */
function activeCategories() {
  return LIVE_CATEGORIES.filter((c) => (seedByCategory.get(c.key)?.size || 0) > 0);
}

function fallbackPoster() {
  // Logo del addon: el propio despliegue si hay base, si no el asset público
  // del repo (los canales de las listas comunitarias a menudo no traen logo).
  return config.addonBaseUrl
    ? `${config.addonBaseUrl}/assets/logo.png`
    : 'https://raw.githubusercontent.com/noe359866-code/SAS5/main/assets/logo.png';
}

/** Meta de Stremio para un canal en vivo. */
function liveMeta(ch) {
  const image = ch.logo || fallbackPoster();
  const label = CATEGORY_LABELS[ch.category] || ch.category;
  const where = ch.country ? ` · ${ch.country}` : '';
  return {
    id: `${LIVE_ID_PREFIX}${ch.category}:${ch.slug}`,
    type: 'tv',
    name: ch.name,
    description: ch.unverified
      ? `${ch.name} en vivo · ${label}${where}. ⚠️ Señal sin verificar: la fuente no deja comprobarla desde la sonda; puede fallar según la red.`
      : `${ch.name} en vivo · ${label}${where}. Señal pública verificada por el addon.`,
    genres: ['TV en vivo', label, ...(ch.country ? [ch.country] : []), ...(ch.countries || [])],
    poster: image,
    posterShape: 'square',
    logo: image,
    background: image,
  };
}

/** Metas de una categoría, siempre desde la semilla (catálogo estable). */
function liveMetas(category, { excludeMatch = [] } = {}) {
  const bySlug = seedByCategory.get(category);
  if (!bySlug) return [];
  return [...bySlug.values()]
    .filter((ch) => !excludeMatch.some((re) => re.test(ch.name)))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map(liveMeta);
}

/** Parsea `rlch:lv:<categoría>:<slug>` → canal de la semilla o null. */
function liveChannelById(id) {
  const raw = String(id || '');
  if (!raw.startsWith(LIVE_ID_PREFIX)) return null;
  const rest = raw.slice(LIVE_ID_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep < 1) return null;
  const category = rest.slice(0, sep);
  const slug = rest.slice(sep + 1);
  const direct = seedByCategory.get(category)?.get(slug);
  if (direct) return direct;
  // Compatibilidad: ids de la era por país («rlch:lv:mexico:televisa-novelas»).
  // El canal sigue vivo bajo su tema nuevo; el slug puede no coincidir tras
  // las fusiones, así que se busca por nombre normalizado en todos los temas.
  const wanted = normName(slug.replace(/-/g, ' '));
  for (const bySlug of seedByCategory.values()) {
    for (const ch of bySlug.values()) {
      if (normName(ch.name) === wanted) return ch;
    }
  }
  for (const bySlug of seedByCategory.values()) {
    const hit = bySlug.get(slug);
    if (hit) return hit;
  }
  return null;
}

function parseM3U(text) {
  const entries = [];
  const lines = String(text || '').split('\n');
  let pendingUa = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#EXTVLCOPT:http-user-agent=')) { pendingUa = line.slice(27).trim(); continue; }
    if (!line.startsWith('#EXTINF')) continue;
    const name = (line.split(',').pop() || '').trim();
    const logo = (/tvg-logo="([^"]+)"/.exec(line) || [])[1] || '';
    const group = (/group-title="([^"]+)"/.exec(line) || [])[1] || '';
    let url = '', ua = pendingUa;
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const l = lines[j].trim();
      if (!l) continue;
      if (l.startsWith('#EXTVLCOPT:http-user-agent=')) { ua = l.slice(27).trim(); continue; }
      if (l.startsWith('#')) continue;
      url = l;
      break;
    }
    pendingUa = '';
    if (name && /^https?:\/\//i.test(url)) entries.push({ name: cleanName(name), logo, group, url, ua });
  }
  return entries;
}

const LISTS_CACHE_KEY = 'livelists:v1';

/** Descarga y cachea las listas vivas. Nunca lanza. */
async function loadLiveEntries(timeoutMs = config.streamProviderTimeoutMs) {
  const cached = cache.get(LISTS_CACHE_KEY);
  if (cached !== undefined) return cached;
  const loaded = await cache.coalesce(LISTS_CACHE_KEY, async () => {
    const results = await Promise.allSettled(
      LIVE_LISTS.map((url) => fetch(url, {
        headers: { 'User-Agent': UA_GENERIC, Accept: '*/*' },
        signal: AbortSignal.timeout(Math.max(timeoutMs, 4000)),
      }).then((res) => (res.ok ? res.text() : '')))
    );
    const entries = [];
    for (const r of results) {
      if (r.status !== 'fulfilled' || !r.value) continue;
      // Fuera los hosts de tokens caducos (m3uts.xyz): no deben volver a
      // colarse en la resolución aunque la lista los siga anunciando.
      entries.push(...parseM3U(r.value).filter((e) => !isBlockedUrl(e.url)));
    }
    return { entries, at: Date.now() };
  });
  cache.set(LISTS_CACHE_KEY, loaded, loaded.entries.length ? 12 * 3600 : 120);
  return loaded;
}

const toHit = (url, ua, title, channelKey, ref = '', extra = {}) => ({
  url,
  title,
  provider: 'livelists',
  audioLabel: 'En vivo',
  channelKey,
  userAgent: ua || '',
  // Servidores que exigen Referer (la sonda lo midió): streams.js lo convierte
  // en behaviorHints.proxyHeaders.request { Origin, Referer }.
  playbackOrigin: ref || '',
  // Presentación de la fila (nombre del canal, nº de señal, aviso): la usa
  // toDirectStream; `title` queda solo para detectar calidad/badges.
  ...extra,
});

/**
 * Resuelve un canal de la semilla → hits de stream.
 * Primero las URL vivas (si el canal sigue en las listas, incluidas sus
 * variantes Opc.N), luego las URL de la semilla. Máximo 6 señales. Nunca lanza.
 */
async function resolveLiveChannel(channel, timeoutMs = config.streamProviderTimeoutMs) {
  const hits = [];
  const seen = new Set();
  // Referer medido por la sonda, por host: las URLs vivas del mismo host lo heredan
  const refByHost = new Map();
  for (const u of channel.urls || []) {
    if (!u.ref) continue;
    try { refByHost.set(new URL(u.url).host, u.ref); } catch { /* URL rara */ }
  }
  const refOf = (url, fallback = '') => {
    try { return refByHost.get(new URL(url).host) || fallback; } catch { return fallback; }
  };
  const push = (url, ua, title, ref = '') => {
    const base = url.split('?')[0];
    if (seen.has(base) || hits.length >= 6) return;
    seen.add(base);
    hits.push(toHit(url, ua, title, `${channel.category}:${channel.slug}`, ref, {
      channelName: channel.name,
      option: hits.length + 1,
      verified: !channel.unverified,
    }));
  };
  if (!channel.unverified) {
    try {
      const { entries } = await loadLiveEntries(timeoutMs);
      for (const e of entries) {
        if (baseSlugOf(slugOf(e.name)) !== channel.slug) continue;
        push(e.url, e.ua, e.name, refOf(e.url));
      }
    } catch (_) { /* la lista no cargó: queda la semilla */ }
  }
  for (const u of channel.urls || []) {
    push(u.url, u.ua, channel.name, u.ref || '');
  }
  return hits;
}

/**
 * Hits de las listas vivas + semilla cuyo nombre casa con `match`
 * (para enriquecer las tarjetas curadas de deportes con señales del proveedor).
 */
async function resolveByMatch(match, channelKey, timeoutMs = config.streamProviderTimeoutMs) {
  const hits = [];
  const seen = new Set();
  const refByHost = new Map();
  for (const bySlug of seedByCategory.values()) {
    for (const ch of bySlug.values()) {
      for (const u of ch.urls) {
        if (!u.ref) continue;
        try { refByHost.set(new URL(u.url).host, u.ref); } catch { /* URL rara */ }
      }
    }
  }
  const refOf = (url, fallback = '') => {
    try { return refByHost.get(new URL(url).host) || fallback; } catch { return fallback; }
  };
  const push = (url, ua, title, ref = '', extra = {}) => {
    const base = url.split('?')[0];
    if (seen.has(base) || hits.length >= 4) return;
    seen.add(base);
    hits.push(toHit(url, ua, title, channelKey, ref, { option: hits.length + 1, ...extra }));
  };
  try {
    const { entries } = await loadLiveEntries(timeoutMs);
    for (const e of entries) {
      if (match.test(e.name)) push(e.url, e.ua, e.name, refOf(e.url), { channelName: cleanChannelName(e.name), verified: true });
    }
  } catch (_) { /* sin lista viva */ }
  for (const bySlug of seedByCategory.values()) {
    for (const ch of bySlug.values()) {
      if (!match.test(ch.name)) continue;
      for (const u of ch.urls) push(u.url, u.ua, ch.name, u.ref || '', { channelName: ch.name, verified: !ch.unverified });
    }
  }
  return hits;
}

module.exports = {
  LIVE_ID_PREFIX,
  LIVE_CATEGORIES,
  CATEGORY_LABELS,
  thematicCategoryOf,
  countryLabelOf,
  activeCategories,
  liveMeta,
  liveMetas,
  liveChannelById,
  resolveLiveChannel,
  resolveByMatch,
  loadLiveEntries,
  isBlockedUrl,
  cleanName,
  parseM3U,
  slugOf,
  baseSlugOf,
};
