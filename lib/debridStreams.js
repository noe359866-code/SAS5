'use strict';

const config = require('./config');
const credentials = require('./debridCredentials');
const realDebridOAuth = require('./realDebridOAuth');
const { ADAPTERS } = require('./debridProviders');
const { mapLimit } = require('./debridShared');

const MAX_PARALLEL_RESOLVES = 2;

/** Adds provider-owned direct links while leaving every public magnet intact.
 * A provider adapter decides what its cache check means and how it resolves a
 * file. Failures always degrade to the original torrent streams. */
async function streamsFor(pool, credentialId, resolved, env) {
  const record = await credentials.getCredential(credentialId, env);
  if (!record) return [];
  const adapter = ADAPTERS[record.provider];
  if (!adapter) return [];

  let token = record.token;
  if (record.provider === 'realdebrid') token = await realDebridOAuth.getAccessToken(credentialId, env);
  if (!token) return [];

  const checks = (Array.isArray(pool) ? pool : []).slice(0, config.debridMaxChecks || 8);
  if (!checks.length) return [];
  try {
    const availability = await adapter.checkCached(token, credentialId, checks);
    if (!(availability instanceof Map)) return [];
    const maxResults = config.debridMaxResults || 3;
    const cachedHits = checks.filter((hit) => availability.get(String(hit.infoHash || '').toLowerCase()))
      .slice(0, maxResults);
    return mapLimit(cachedHits, Math.min(MAX_PARALLEL_RESOLVES, maxResults), (hit) =>
      adapter.resolveCached(
        token,
        credentialId,
        hit,
        availability.get(String(hit.infoHash || '').toLowerCase()),
        resolved
      )
    ).then((results) => results.filter(Boolean));
  } catch (_) {
    // Authentication, timeout, quota, or provider shape changes must not
    // suppress the regular public streams.
    return [];
  }
}

module.exports = { streamsFor };
