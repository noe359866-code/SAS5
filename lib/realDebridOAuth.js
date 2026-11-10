'use strict';

const { randomBytes, timingSafeEqual } = require('node:crypto');
const cache = require('./cache');
const credentials = require('./debridCredentials');
const { fetchJson, providerError } = require('./debridShared');

const OAUTH_BASE = 'https://api.real-debrid.com/oauth/v2';
const REST_BASE = 'https://api.real-debrid.com/rest/1.0';
const CALLBACK_PATH = '/internal/debrid/real-debrid/callback';
const STATE_COOKIE = 'rd_oauth_state';
const REFRESH_GRANT = 'http://oauth.net/grant_type/device/1.0';

function envValue(name, env) {
  const value = env && env[name] != null ? env[name]
    : (typeof process !== 'undefined' && process.env ? process.env[name] : undefined);
  return String(value || '').trim();
}

function oauthConfig(env) {
  const clientId = envValue('REALDEBRID_CLIENT_ID', env);
  const clientSecret = envValue('REALDEBRID_CLIENT_SECRET', env);
  const redirectUri = envValue('REALDEBRID_REDIRECT_URI', env);
  if (!clientId || !clientSecret || !redirectUri) {
    const error = new Error('realdebrid_oauth_not_configured');
    error.code = 'realdebrid_oauth_not_configured';
    throw error;
  }
  let parsed;
  try {
    parsed = new URL(redirectUri);
  } catch (_) {
    const error = new Error('realdebrid_oauth_not_configured');
    error.code = 'realdebrid_oauth_not_configured';
    throw error;
  }
  const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname);
  if ((!localHttp && parsed.protocol !== 'https:') || parsed.username || parsed.password ||
      parsed.pathname !== CALLBACK_PATH || parsed.search || parsed.hash) {
    const error = new Error('realdebrid_oauth_redirect_invalid');
    error.code = 'realdebrid_oauth_redirect_invalid';
    throw error;
  }
  return { clientId, clientSecret, redirectUri: parsed.toString() };
}

function isConfigured(env) {
  try {
    oauthConfig(env);
    return true;
  } catch (_) {
    return false;
  }
}

function makeAuthorization({ origin, env }) {
  const settings = oauthConfig(env);
  let requestOrigin;
  try {
    requestOrigin = new URL(origin).origin;
  } catch (_) {
    const error = new Error('realdebrid_oauth_redirect_invalid');
    error.code = 'realdebrid_oauth_redirect_invalid';
    throw error;
  }
  if (new URL(settings.redirectUri).origin !== requestOrigin) {
    const error = new Error('realdebrid_oauth_redirect_invalid');
    error.code = 'realdebrid_oauth_redirect_invalid';
    throw error;
  }

  const state = randomBytes(32).toString('base64url');
  const url = new URL(`${OAUTH_BASE}/auth`);
  url.searchParams.set('client_id', settings.clientId);
  url.searchParams.set('redirect_uri', settings.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  return { authorizationUrl: url.toString(), state, redirectUri: settings.redirectUri };
}

function stateFromCookie(header) {
  const cookie = String(header || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${STATE_COOKIE}=`));
  return cookie ? cookie.slice(STATE_COOKIE.length + 1) : '';
}

function verifyState(state, cookieHeader) {
  const expected = stateFromCookie(cookieHeader);
  const actual = String(state || '');
  if (!expected || !actual) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function tokenRequest(fields) {
  const body = new URLSearchParams(fields);
  const data = await fetchJson(`${OAUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    timeoutMs: 8000,
  });
  if (!data || typeof data.access_token !== 'string' || !data.access_token ||
      typeof data.refresh_token !== 'string' || !data.refresh_token) {
    throw providerError('oauth_exchange_failed', 502);
  }
  return data;
}

async function validateAccessToken(token) {
  const user = await fetchJson(`${REST_BASE}/user`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 6000,
  });
  if (!user || user.id == null) throw providerError('invalid_credential', 401);
  return user;
}

async function completeAuthorization(code, env) {
  const settings = oauthConfig(env);
  const authCode = String(code || '').trim();
  if (!authCode || authCode.length > 1024 || /\s/.test(authCode)) throw providerError('oauth_exchange_failed', 400);
  const token = await tokenRequest({
    client_id: settings.clientId,
    client_secret: settings.clientSecret,
    code: authCode,
    redirect_uri: settings.redirectUri,
    grant_type: 'authorization_code',
  });
  await validateAccessToken(token.access_token);
  const expiresIn = Math.max(60, Number(token.expires_in) || 3600);
  return credentials.createCredential({
    provider: 'realdebrid',
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + expiresIn * 1000,
  }, env);
}

async function refreshAccessToken(credentialId, current, env) {
  const settings = oauthConfig(env);
  const token = await tokenRequest({
    client_id: settings.clientId,
    client_secret: settings.clientSecret,
    code: current.refreshToken,
    grant_type: REFRESH_GRANT,
  });
  const expiresIn = Math.max(60, Number(token.expires_in) || 3600);
  const updated = {
    provider: 'realdebrid',
    accessToken: token.access_token,
    refreshToken: token.refresh_token || current.refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  await credentials.updateCredential(credentialId, updated, env);
  return updated.accessToken;
}

async function getAccessToken(credentialId, env) {
  const record = await credentials.getCredential(credentialId, env);
  if (!record || record.provider !== 'realdebrid') return null;
  if (record.expiresAt > Date.now() + 60_000) return record.accessToken;
  try {
    return await cache.coalesce(`debrid:refresh:${credentialId}`, async () => {
      const current = await credentials.getCredential(credentialId, env);
      if (!current || current.provider !== 'realdebrid') return null;
      if (current.expiresAt > Date.now() + 60_000) return current.accessToken;
      return refreshAccessToken(credentialId, current, env);
    });
  } catch (_) {
    return null;
  }
}

function stateCookie(state, secure) {
  return `${STATE_COOKIE}=${state}; Max-Age=600; Path=${CALLBACK_PATH}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

function clearStateCookie(secure) {
  return `${STATE_COOKIE}=; Max-Age=0; Path=${CALLBACK_PATH}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

module.exports = {
  CALLBACK_PATH,
  STATE_COOKIE,
  oauthConfig,
  isConfigured,
  makeAuthorization,
  verifyState,
  completeAuthorization,
  getAccessToken,
  stateCookie,
  clearStateCookie,
};
