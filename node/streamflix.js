'use strict';

const { Router } = require('express');
const cache = require('../lib/cache');
const rateLimit = require('../lib/rateLimit');
const { resolveTitle } = require('../lib/streams');
const { PROVIDERS, findWebPage } = require('./streamflix-providers');

const PREFIX = '/streamflix';
const IDENTIFIER = /^(tt\d{7,12}|tmdb:(?:(movie|tv|series):)?[1-9]\d{0,9}|tvmaze:[1-9]\d{0,9})(?::[1-9]\d{0,3}:[1-9]\d{0,3})?$/;
const VALID_EPISODE = /:[1-9]\d{0,3}:[1-9]\d{0,3}$/;

function validId(type, id) {
  const match = IDENTIFIER.exec(id);
  if (!match) return false;
  const [, base, tmdbType] = match;
  const episode = VALID_EPISODE.test(id.slice(base.length));
  if (type === 'movie') return !episode && !base.startsWith('tvmaze:') && (!tmdbType || tmdbType === 'movie');
  return type === 'series' && episode && tmdbType !== 'movie';
}

async function loadStreams(type, id, providers) {
  const resolved = await resolveTitle(type, id);
  if (!resolved?.year || (resolved.tmdbType && (resolved.tmdbType === 'tv') !== (type === 'series'))) return [];
  const results = await Promise.allSettled(providers.map(async (provider) => {
    const hit = await findWebPage(provider, resolved);
    return hit && {
      name: `${provider.name} · Web`,
      description: `Abrir en el navegador\n${hit.audio.join(' / ')} (según la ficha)`,
      externalUrl: hit.externalUrl,
    };
  }));
  return results.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : []);
}

/** Se monta solo en Express. Ni el manifest principal ni el Worker lo anuncian. */
function mountStreamflix(app, configured = process.env.STREAMFLIX_NODE_PROVIDERS) {
  const selected = new Set(String(configured || '').toLowerCase().split(',').map((key) => key.trim()));
  const providers = selected.has('off') ? [] : PROVIDERS.filter(({ key }) => selected.has(key));
  if (!providers.length) return;

  const types = [...new Set(providers.map(({ type }) => type))];
  const router = Router();
  router.get('/manifest.json', (req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      id: 'org.comunidad.catalogos.plus.streamflix.web',
      name: 'RamdonLatam · Fuentes web',
      version: '1.0.0',
      description: 'Fuentes opcionales que se abren en el navegador. No ofrecen reproducción dentro de Stremio.',
      resources: ['stream'],
      types,
      idPrefixes: ['tt', 'tmdb:', ...(types.includes('series') ? ['tvmaze:'] : [])],
      catalogs: [],
    });
  });

  router.get('/stream/:type/:id.json', async (req, res) => {
    const { type, id } = req.params;
    const empty = () => res.set('Cache-Control', 'no-store').json({ streams: [] });
    if (!types.includes(type) || !validId(type, id)) return empty();
    const enabled = providers.filter((source) => source.type === type);
    const key = `streamflix-web:v1:${enabled.map((source) => source.key).join(',')}:${type}:${id}`;
    let streams = cache.get(key);
    if (streams === undefined) {
      if (!rateLimit.allow(`streamflix-web:${req.ip}`, { limit: 30, windowMs: 60_000 })) return empty();
      try {
        streams = await cache.coalesce(key, async () => {
          const hits = await loadStreams(type, id, enabled);
          cache.set(key, hits, hits.length ? 300 : 30);
          return hits;
        });
      } catch { return empty(); }
    }
    if (!streams.length) return empty();
    return res.set('Cache-Control', 'public, max-age=60, must-revalidate').json({ streams });
  });
  app.use(PREFIX, router);
}

module.exports = { mountStreamflix };
