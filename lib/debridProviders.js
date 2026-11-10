'use strict';

const torbox = require('./torbox');
const easyDebrid = require('./easyDebrid');
const premiumize = require('./premiumize');
const realDebrid = require('./realDebrid');

const PROVIDERS = [
  { key: 'torbox', name: 'TorBox', auth: 'api-key', cacheOnly: true },
  { key: 'easydebrid', name: 'EasyDebrid', auth: 'api-key', cacheOnly: true },
  { key: 'premiumize', name: 'Premiumize', auth: 'api-key', cacheOnly: 'best-effort' },
  { key: 'realdebrid', name: 'Real-Debrid', auth: 'oauth', cacheOnly: 'personal-library' },
];

const ADAPTERS = { torbox, easydebrid: easyDebrid, premiumize, realdebrid: realDebrid };
const PROVIDER_KEYS = PROVIDERS.map((provider) => provider.key);

async function validateCredential(provider, token) {
  const adapter = ADAPTERS[provider];
  if (!adapter) {
    const error = new Error('provider_invalid');
    error.code = 'provider_invalid';
    throw error;
  }
  if (provider === 'realdebrid') {
    const error = new Error('oauth_required');
    error.code = 'oauth_required';
    throw error;
  }
  return adapter.validateCredential(token);
}

module.exports = { PROVIDERS, PROVIDER_KEYS, ADAPTERS, validateCredential };
