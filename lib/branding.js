'use strict';

/**
 * Branding (logos) para la página de configuración.
 *  - Plataformas: TMDB /watch/providers/movie + /tv (provider_id → logo_path)
 *  - Estudios:    TMDB /company/{id} por cada estudio
 * Sin TMDB configurado devuelve objetos vacíos (la UI cae a "solo nombres").
 */

const config = require('./config');
const cache = require('./cache');
const tmdb = require('./tmdb');
const { PLATFORMS, STUDIOS } = require('./catalogs');
const { STATIC_PROVIDER_LOGOS } = require('./staticLogos');

async function branding(lang) {
  const l = lang || config.tmdbLanguage || 'es';
  const cacheKey = `branding:${l}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // Logos estáticos primero: siempre disponibles (CDN público de TMDB)
  const staticProviders = {};
  for (const def of PLATFORMS) {
    staticProviders[def.key] = { name: def.name, logo: STATIC_PROVIDER_LOGOS[def.key] || null };
  }
  const result = { providers: { ...staticProviders }, studios: {}, tmdbConfigured: config.tmdbConfigured };
  if (!config.tmdbConfigured) {
    for (const def of STUDIOS) result.studios[def.key] = { name: def.name, logo: null };
    cache.set(cacheKey, result, 600);
    return result;
  }

  // ── Plataformas ──────────────────────────────────────────────
  try {
    const [movieProviders, tvProviders] = await Promise.all([
      tmdbGetSafe('/watch/providers/movie', l),
      tmdbGetSafe('/watch/providers/tv', l),
    ]);
    const byId = new Map();
    for (const data of [movieProviders, tvProviders]) {
      const items = (data && Array.isArray(data.results) && data.results) || [];
      for (const p of items) {
        if (p.provider_id && p.logo_path && !byId.has(p.provider_id)) byId.set(p.provider_id, p);
      }
    }
    // Índice por nombre normalizado como respaldo para ids desactualizados
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const byName = new Map();
    for (const p of byId.values()) byName.set(norm(p.provider_name), p);
    const NAME_ALIASES = { amcp: ['amcplustvc', 'amcp'], mubi: ['mubi'], pluto: ['plutotv', 'pluto'], tubi: ['tubi', 'tubitv'], peacock: ['peacock', 'peacocktv', 'peacockpremium'], hulu: ['hulu'], appletv: ['appletv', 'appletvplus'], max: ['max', 'hbomax'], paramount: ['paramountplus', 'paramount'], crunchyroll: ['crunchyroll'], prime: ['amazonprimevideo', 'primevideo'], disney: ['disneyplus', 'disney'], netflix: ['netflix'] };
    const findByName = (key, displayName) => {
      for (const alias of NAME_ALIASES[key] || []) {
        const hit = byName.get(alias);
        if (hit) return hit;
      }
      return byName.get(norm(displayName)) || null;
    };

    for (const def of PLATFORMS) {
      const firstId = parseInt(String(def.providers).split('|')[0], 10);
      // 1) por id exacto → 2) por nombre/alias (auto-curación de ids)
      const hit = byId.get(firstId) || findByName(def.key, def.name);
      if (hit) {
        result.providers[def.key] = { name: hit.provider_name || def.name, logo: tmdb.image(hit.logo_path, 'w154') };
      } // si no hay hit, se conserva el logo estático
    }
  } catch (err) {
    console.error('[Branding] providers ->', err.message);
    for (const def of PLATFORMS) result.providers[def.key] = { name: def.name, logo: null };
  }

  // ── Estudios ─────────────────────────────────────────────────
  await Promise.all(
    STUDIOS.map(async (s) => {
      try {
        const data = await tmdb.tmdbGet(`/company/${s.company}`, {}, 7 * 24 * 3600, l);
        result.studios[s.key] = {
          name: (data && data.name) || s.name,
          logo: data && data.logo_path ? tmdb.image(data.logo_path, 'w500') : null,
        };
      } catch (err) {
        console.error('[Branding] estudio', s.key, '->', err.message);
        result.studios[s.key] = { name: s.name, logo: null };
      }
    })
  );

  cache.set(cacheKey, result, 3600);
  return result;
}

async function tmdbGetSafe(path, lang) {
  return tmdb.tmdbGet(path, { language: lang }, 24 * 3600, lang);
}

module.exports = { branding };
