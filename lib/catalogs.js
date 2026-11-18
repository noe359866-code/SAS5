'use strict';

/**
 * Definición de TODOS los catálogos del addon.
 *
 *  - Películas/Series · Tendencias / Populares / Top Valoradas  (TMDB)
 *  - Películas y Series por PLATAFORMA  (TMDB discover + with_watch_providers)
 *  - Películas por ESTUDIO / PRODUCTORA  (TMDB discover + with_companies)
 *  - Series · En TV hoy  (TVMaze, sin clave)
 *
 * Los catálogos visibles dependen de la config de usuario (prefijo base64url
 * en la URL del manifest): idioma, región, plataformas y estudios elegidos.
 * Sin prefijo → comportamiento por defecto (todo activado).
 */

const config = require('./config');
const cache = require('./cache');
const tmdb = require('./tmdb');
const tvmaze = require('./tvmaze');

// ─────────────────────────────────────────────────────────────────────────────
// Plataformas (JustWatch provider ids en TMDB; lista completa editable aquí)
// ─────────────────────────────────────────────────────────────────────────────
const PLATFORMS = [
  // ── Globales ────────────────────────────────────────────────────────────
  { key: 'netflix',     name: 'Netflix',        providers: '8' },
  // 119 = "Amazon Prime Video" (LatAm/ES/AR) · 9 = Amazon (US). Con solo el 9
  // los catálogos de Prime salían vacíos fuera de EE. UU.
  { key: 'prime',       name: 'Prime Video',    providers: '119|9' },
  { key: 'disney',      name: 'Disney+',        providers: '337' },
  { key: 'max',         name: 'Max (HBO)',      providers: '1899|384|1825' },
  { key: 'appletv',     name: 'Apple TV+',      providers: '350' },
  { key: 'paramount',   name: 'Paramount+',     providers: '531|2303|1853' },
  { key: 'crunchyroll', name: 'Crunchyroll',    providers: '283|1968' },
  { key: 'hulu',        name: 'Hulu',           providers: '15' },
  { key: 'amcp',        name: 'AMC+',           providers: '526|528' },
  { key: 'mubi',        name: 'MUBI',           providers: '11' },
  { key: 'tubi',        name: 'Tubi',           providers: '73' },
  { key: 'pluto',       name: 'Pluto TV',       providers: '300' },
  { key: 'peacock',     name: 'Peacock',        providers: '386|387' },
  { key: 'starz',       name: 'Starz',          providers: '43' },
  { key: 'mgmplus',     name: 'MGM+',           providers: '34' },
  { key: 'youtubepremium', name: 'YouTube Premium', providers: '188' },
  { key: 'plex',        name: 'Plex',           providers: '538|2077' },
  { key: 'freevee',     name: 'Amazon Freevee', providers: '613' },
  { key: 'roku',        name: 'The Roku Channel', providers: '207' },
  { key: 'discoveryplus', name: 'discovery+',   providers: '510|524|584' },
  // ── Latinoamérica ───────────────────────────────────────────────────────
  { key: 'vix',         name: 'ViX',            providers: '457|1866' },
  { key: 'clarovideo',  name: 'Claro video',    providers: '167|484' },
  { key: 'directvgo',   name: 'DIRECTV GO',     providers: '467' },
  { key: 'movistartv',  name: 'Movistar TV',    providers: '339' },
  { key: 'filminlatino',name: 'Filmin Latino',  providers: '66' },
  { key: 'globoplay',   name: 'Globoplay',      providers: '307' },
  // ── España / Europa ─────────────────────────────────────────────────────
  { key: 'filmin',      name: 'Filmin',         providers: '63|64' },
  { key: 'atresplayer', name: 'Atresplayer',    providers: '62|2162' },
  { key: 'skyshowtime', name: 'SkyShowtime',    providers: '1773' },
  { key: 'movistarplus',name: 'Movistar Plus+', providers: '2241|149' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Estudios / productoras (company ids en TMDB). Solo películas.
// ─────────────────────────────────────────────────────────────────────────────
const STUDIOS = [
  // ── Majors ──────────────────────────────────────────────────────────────
  { key: 'marvel',    name: 'Marvel Studios',       company: '420' },
  { key: 'pixar',     name: 'Pixar',                company: '3' },
  { key: 'waltdisney',name: 'Walt Disney Pictures', company: '2' },
  { key: 'disneyanim',name: 'Disney Animation',     company: '6125' },
  { key: 'lucasfilm', name: 'Lucasfilm',            company: '1' },
  { key: 'warner',    name: 'Warner Bros.',         company: '174' },
  { key: 'newline',   name: 'New Line Cinema',      company: '12' },
  { key: 'universal', name: 'Universal',            company: '33' },
  { key: 'illumination', name: 'Illumination',      company: '6704' },
  { key: 'dreamworks',name: 'DreamWorks Animation', company: '521' },
  { key: 'paramount', name: 'Paramount Pictures',   company: '4' },
  { key: 'sony',      name: 'Sony Pictures',        company: '5' },
  { key: 'fox',       name: '20th Century Studios', company: '127928' },
  { key: 'mgm',       name: 'MGM',                  company: '21' },
  { key: 'lionsgate', name: 'Lionsgate',            company: '1632' },
  // ── Autor / indie ───────────────────────────────────────────────────────
  { key: 'a24',       name: 'A24',                  company: '41077' },
  { key: 'blumhouse', name: 'Blumhouse',            company: '3172' },
  { key: 'ghibli',    name: 'Studio Ghibli',        company: '10342' },
  // ── Animación asiática ──────────────────────────────────────────────────
  { key: 'toei',      name: 'Toei Animation',       company: '5542' },
  { key: 'mappa',     name: 'MAPPA',                company: '21444' },
  { key: 'kyoani',    name: 'Kyoto Animation',      company: '5438' },
];

// Géneros solo de SERIES (TMDB genre ids de TV). Equilibran el manifest:
// los estudios y los estrenos de cine son catálogos solo de películas, así
// que sin esto Stremio muestra muchas más filas de "movie" que de "series".
const SERIES_GENRES = [
  { key: 'accion',   name: 'Acción y Aventura', genre: '10759' },
  { key: 'comedia',  name: 'Comedia',           genre: '35' },
  { key: 'crimen',   name: 'Crimen',            genre: '80' },
  { key: 'drama',    name: 'Drama',             genre: '18' },
  { key: 'misterio', name: 'Misterio',          genre: '9648' },
  { key: 'scifi',    name: 'Sci-Fi y Fantasía', genre: '10765' },
];

const PLATFORM_KEYS = PLATFORMS.map((p) => p.key);
const STUDIO_KEYS = STUDIOS.map((s) => s.key);

/** Catálogos de plataforma: cuántos resultados de reserva traer por página. */
const PLATFORM_PAGE_SIZE = 40;
/** Una página sin resultados se recuerda poco, pero se recuerda. */
const EMPTY_TTL_SECONDS = 300;

// ─────────────────────────────────────────────────────────────────────────────
// Construcción de catálogos según config de usuario
// ─────────────────────────────────────────────────────────────────────────────
function buildDefs(cfg) {
  const defs = [];
  const base = cfg && cfg.base ? new Set(cfg.base) : null;
  const platformKeys = cfg && cfg.platforms ? new Set(cfg.platforms) : null;
  const studioKeys = cfg && cfg.studios ? new Set(cfg.studios) : null;
  const hasBase = (k) => !base || base.has(k);

  // Nombres "estilo Cinemeta": la misma etiqueta para la fila de películas y
  // la de series ("Netflix", "Tendencias"...). Stremio las separa por
  // pestaña de tipo, y así el manifest no gasta ~11 bytes por catálogo en el
  // prefijo "Películas · "/"Series · " (el límite del addonCollection API
  // son 8 KB de manifest).
  for (const mediaType of ['movie', 'series']) {
    const prefix = mediaType === 'movie' ? 'cine' : 'tv';
    if (hasBase('tendencias')) defs.push({ id: `${prefix}_tendencias`, type: mediaType, name: 'Tendencias', kind: 'tendencias', mediaType });
    if (hasBase('populares'))  defs.push({ id: `${prefix}_popular`,    type: mediaType, name: 'Populares',  kind: 'popular',    mediaType });
    if (hasBase('top'))        defs.push({ id: `${prefix}_top`,        type: mediaType, name: 'Top Valoradas', kind: 'top',     mediaType });
  }

  if (hasBase('estrenos'))   defs.push({ id: 'cine_estrenos', type: 'movie',  name: 'En cines',                    kind: 'estrenos',   mediaType: 'movie' });
  if (hasBase('proximos'))   defs.push({ id: 'cine_proximos', type: 'movie',  name: 'Próximos estrenos',          kind: 'proximos',   mediaType: 'movie' });
  if (hasBase('en_emision')) defs.push({ id: 'tv_enemision',  type: 'series', name: 'En emisión',                 kind: 'en_emision', mediaType: 'series' });
  if (hasBase('anime')) {
    defs.push({ id: 'cine_anime', type: 'movie',  name: 'Anime', kind: 'anime', mediaType: 'movie' });
    defs.push({ id: 'tv_anime',   type: 'series', name: 'Anime', kind: 'anime', mediaType: 'series' });
  }

  for (const platform of PLATFORMS) {
    if (platformKeys && !platformKeys.has(platform.key)) continue;
    defs.push({ id: `cine_${platform.key}`, type: 'movie',  name: platform.name, kind: 'platform', mediaType: 'movie',  providers: platform.providers });
    defs.push({ id: `tv_${platform.key}`,   type: 'series', name: platform.name, kind: 'platform', mediaType: 'series', providers: platform.providers });
  }

  // Series por género + miniseries (opción base "generos_series" en /configure)
  if (hasBase('generos_series')) {
    for (const g of SERIES_GENRES) {
      defs.push({ id: `tv_genero_${g.key}`, type: 'series', name: g.name, kind: 'genre', mediaType: 'series', genre: g.genre });
    }
    defs.push({ id: 'tv_miniseries', type: 'series', name: 'Miniseries', kind: 'miniseries', mediaType: 'series' });
  }

  // Cada estudio genera fila de películas Y de series (TMDB discover con
  // with_companies en /movie y /tv). Las productoras sin series en TMDB
  // devuelven vacío y Stremio simplemente no pinta esa fila, pero así el
  // manifest sigue equilibrado entre películas y series.
  for (const studio of STUDIOS) {
    if (studioKeys && !studioKeys.has(studio.key)) continue;
    defs.push({
      id: `cine_estudio_${studio.key}`,
      type: 'movie',
      name: studio.name,
      kind: 'studio',
      mediaType: 'movie',
      company: studio.company,
    });
    defs.push({
      id: `tv_estudio_${studio.key}`,
      type: 'series',
      name: studio.name,
      kind: 'studio',
      mediaType: 'series',
      company: studio.company,
    });
  }

  if (hasBase('tvmaze_hoy')) {
    defs.push({ id: 'tvmaze_hoy', type: 'series', name: 'En TV hoy (TVMaze)', kind: 'tvmaze', source: 'tvmaze' });
  }

  return defs;
}

/** Catálogos por defecto (todo activado) — para el manifest sin config. */
const CATALOG_DEFS = buildDefs(null);
const catalogById = new Map(CATALOG_DEFS.map((def) => [def.id, def]));

/** Catálogos declarados en el manifest, según config (o por defecto). */
function manifestCatalogs(cfg) {
  // Advertise pagination on the eight main catalogs only: all 121 catalogs
  // must still fit the SDK/addonCollection hard limit of 8192 characters.
  return buildDefs(cfg ?? null).map((def) => ({
    id: def.id, type: def.type, name: def.name,
    ...(['tendencias', 'popular', 'top', 'anime'].includes(def.kind) ? { extraSupported: ['skip'] } : {}),
  }));
}

/** Resuelve un catálogo y devuelve metas para Stremio. Nunca lanza. */
async function resolveCatalog(type, id, cfg, extra = {}) {
  const def = catalogById.get(id);
  if (!def || def.type !== type) return [];
  if (cfg) {
    const visible = buildDefs(cfg);
    if (!visible.some((d) => d.id === id && d.type === type)) return [];
  }

  const parsedSkip = Number(extra.skip || 0);
  if (!Number.isSafeInteger(parsedSkip) || parsedSkip < 0 || parsedSkip >= 10000) return [];
  const page = Math.floor(parsedSkip / 20) + 1;
  const offset = parsedSkip % 20;

  const lang = (cfg && cfg.lang) || config.tmdbLanguage || 'es';
  const region = (cfg && cfg.region) || config.watchRegion;
  const usesRegion = def.kind === 'platform' || def.kind === 'estrenos' || def.kind === 'proximos';
  const pageKey = `cat:v1:${type}:${id}:${lang}:${usesRegion ? region : '_'}:p${page}:${config.tmdbConfigured ? 1 : 0}`;

  const cachedPage = cache.get(pageKey);
  if (cachedPage !== undefined) {
    return offset ? cachedPage.slice(offset) : cachedPage;
  }

  try {
    if (def.source === 'tvmaze') {
      return parsedSkip ? [] : await tvmaze.airingToday();
    }
    if (!config.tmdbConfigured) {
      console.warn(`[Catálogo] TMDB no configurado; "${id}" devolverá lista vacía. Revisa TMDB_API_KEY/TMDB_ACCESS_TOKEN.`);
      return [];
    }
    const items = await cache.coalesce(`load:${pageKey}`, async () => {
      const again = cache.get(pageKey);
      if (again !== undefined) return again;
      let resolved = [];
      if (def.kind === 'platform') {
        // La cobertura JustWatch de Nicaragua (y de varios países pequeños) es
        // casi nula: una sola región devolvía 0–3 títulos y la fila se veía
        // rota. Ahora se acumulan las regiones de reserva, sin duplicados,
        // hasta llenar la página. Cada página se arma igual (misma región,
        // mismo índice), así que el `skip` de Stremio sigue avanzando de 20 en
        // 20 sin saltarse títulos ni repetirlos.
        const chain = [...new Set([region, ...(config.watchRegionFallback || [])])].filter(Boolean);
        const merged = [];
        const seen = new Set();
        const wanted = page === 1 ? PLATFORM_PAGE_SIZE : 20;
        for (const r of chain) {
          const candidate = await tmdb.catalogItems(def, { lang, region: r, page });
          // `meta.id` es el id de Stremio (`tmdb:movie:603`) y `item.id` el de
          // TMDB; el resultado puede traer cualquiera de los dos según la ruta.
          for (const item of candidate) {
            const key = item && (item.meta?.id || item.id);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            merged.push(item);
          }
          if (merged.length >= wanted) break;
        }
        // Si ninguna región tiene la plataforma, la lista queda vacía y se
        // cachea como vacía: no se repite la consulta en cada visita.
        resolved = merged;
      } else {
        resolved = await tmdb.catalogItems(def, { lang, region, page });
      }
      // Una página vacía también se guarda (5 minutos). Sin esto, cada visita a
      // una fila que hoy no tiene resultados (país sin catálogo JustWatch,
      // estreno agotado, estudio sin series) volvía a consultar TMDB y gastaba
      // cuota del Worker y de la API sin cambiar el resultado.
      const ttl = resolved.length > 0 ? Math.max(60, config.cacheTtl || 21600) : EMPTY_TTL_SECONDS;
      cache.set(pageKey, resolved, ttl);
      return resolved;
    });
    return offset ? items.slice(offset) : items;
  } catch (err) {
    console.error(`[Catálogo] Error resolviendo "${id}" ->`, err.message);
    return [];
  }
}

module.exports = {
  CATALOG_DEFS,
  catalogById,
  PLATFORMS,
  STUDIOS,
  SERIES_GENRES,
  PLATFORM_KEYS,
  STUDIO_KEYS,
  buildDefs,
  manifestCatalogs,
  resolveCatalog,
};
