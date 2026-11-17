'use strict';

/**
 * Almacén cifrado y neutral al proveedor para tokens API y credenciales OAuth.
 * Nunca devuelve secretos en una respuesta HTTP ni los guarda en una URL.
 * Los registros históricos `rd:credential:*` (tokens API privados de RD) se
 * dejan deliberadamente fuera del nuevo lector y no se vuelven a utilizar.
 */

const { randomBytes, webcrypto: nodeWebCrypto } = require('node:crypto');
const cache = require('./cache');

const memoryStore = new Map();
const STORAGE_PREFIX = 'debrid:v2:credential:';
const LEGACY_RD_PREFIX = 'rd:credential:';
const CREDENTIAL_CACHE_TTL = 5 * 60;
const MAX_MEMORY_CREDENTIALS = 1000;
const ID_RE = /^[A-Za-z0-9_-]{32}$/;
const PROVIDERS = new Set(['torbox', 'easydebrid', 'premiumize', 'realdebrid']);

function envValue(name, env) {
  const value = env && env[name] != null ? env[name]
    : (typeof process !== 'undefined' && process.env ? process.env[name] : undefined);
  return String(value || '').trim();
}

function subtleCrypto() {
  const crypto = globalThis.crypto || nodeWebCrypto;
  if (!crypto || !crypto.subtle) throw new Error('WebCrypto no disponible');
  return crypto.subtle;
}

function getEncryptionSecret(env) {
  const secret = envValue('DEBRID_ENCRYPTION_KEY', env);
  if (secret.length < 32) {
    const error = new Error('debrid_encryption_not_configured');
    error.code = 'debrid_encryption_not_configured';
    throw error;
  }
  return secret;
}

/**
 * Cache API de Cloudflare (`caches.default`): almacén sin binding ni
 * configuración externa, disponible en cualquier Worker. Es por PoP y
 * Cloudflare puede evictar entradas, así que la KV sigue siendo la vía
 * recomendada para producción; pero sin ella (el binding viene comentado en
 * wrangler.toml) nadie podía conectar debrid: el 503 era para todos.
 */
function edgeCache() {
  try {
    const cachesApi = globalThis.caches;
    const cache = cachesApi && cachesApi.default;
    if (cache && typeof cache.match === 'function' && typeof cache.put === 'function' && typeof cache.delete === 'function') {
      return cache;
    }
  } catch (_) {
    // Algunos runtimes lanzan al leer `caches`; entonces no hay respaldo.
  }
  return null;
}

// Clave sintética de la Cache API: nunca se pide a la red, solo identifica
// el registro dentro de la caché del propio Worker.
const CACHE_CREDENTIAL_URL = 'https://debrid-credentials.invalid/v2/';

function cacheCredentialRequest(credentialId) {
  return new Request(`${CACHE_CREDENTIAL_URL}${credentialId}`, { method: 'GET' });
}

function getStore(env) {
  if (env && typeof env === 'object') {
    const kv = env.DEBRID_KV;
    if (kv && typeof kv.get === 'function' && typeof kv.put === 'function' && typeof kv.delete === 'function') {
      return { kind: 'kv', kv };
    }
    const edge = edgeCache();
    if (edge) return { kind: 'cache', cache: edge };
    const error = new Error('debrid_storage_not_configured');
    error.code = 'debrid_storage_not_configured';
    throw error;
  }

  const production = typeof process !== 'undefined' && process.env &&
    (process.env.NODE_ENV === 'production' || process.env.VERCEL === '1');
  if (production) {
    const error = new Error('debrid_storage_not_configured');
    error.code = 'debrid_storage_not_configured';
    throw error;
  }
  return { kind: 'memory' };
}

async function deriveKey(secret, usage) {
  const subtle = subtleCrypto();
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, usage);
}

function toBase64(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function fromBase64(text) {
  return Buffer.from(text, 'base64url');
}

async function encryptRecord(record, secret, credentialId) {
  const subtle = subtleCrypto();
  const iv = randomBytes(12);
  const key = await deriveKey(secret, ['encrypt']);
  const encrypted = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`${STORAGE_PREFIX}${credentialId}`) },
    key,
    new TextEncoder().encode(JSON.stringify(record))
  );
  return `v3.${toBase64(iv)}.${toBase64(encrypted)}`;
}

async function decryptRecord(value, secret, credentialId) {
  const [version, ivText, encryptedText] = String(value || '').split('.');
  if (!['v2', 'v3'].includes(version) || !ivText || !encryptedText) throw new Error('debrid_credential_corrupt');
  const subtle = subtleCrypto();
  const key = await deriveKey(secret, ['decrypt']);
  const algorithm = { name: 'AES-GCM', iv: fromBase64(ivText) };
  // v3 authenticates the credential ID as AAD so ciphertext cannot be moved
  // between records. Keep reading v2 values created before AAD was introduced.
  if (version === 'v3') {
    algorithm.additionalData = new TextEncoder().encode(`${STORAGE_PREFIX}${credentialId}`);
  }
  const clear = await subtle.decrypt(algorithm, key, fromBase64(encryptedText));
  const record = JSON.parse(new TextDecoder().decode(clear));
  return normalizeRecord(record);
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object' || !PROVIDERS.has(record.provider)) return null;
  if (record.provider === 'realdebrid') {
    if (typeof record.accessToken !== 'string' || !record.accessToken ||
        typeof record.refreshToken !== 'string' || !record.refreshToken) return null;
    return {
      version: 2,
      provider: 'realdebrid',
      accessToken: record.accessToken,
      refreshToken: record.refreshToken,
      expiresAt: Math.max(0, Number(record.expiresAt) || 0),
    };
  }
  if (typeof record.token !== 'string' || !record.token) return null;
  return { version: 2, provider: record.provider, token: record.token };
}

async function readEncrypted(id, store) {
  const key = STORAGE_PREFIX + id;
  // cacheTtl en KV permite al datacenter local de Cloudflare cachear el
  // registro cifrado durante 5 minutos sin volver a gastar lecturas remotas.
  if (store.kind === 'kv') return store.kv.get(key, { type: 'text', cacheTtl: CREDENTIAL_CACHE_TTL });
  if (store.kind === 'cache') {
    const response = await store.cache.match(cacheCredentialRequest(id));
    return response ? response.text() : null;
  }
  const value = memoryStore.get(key);
  if (value !== undefined) {
    memoryStore.delete(key);
    memoryStore.set(key, value);
  }
  return value;
}

async function writeEncrypted(id, value, store) {
  const key = STORAGE_PREFIX + id;
  if (store.kind === 'kv') {
    await store.kv.put(key, value);
    return;
  }
  if (store.kind === 'cache') {
    // La Cache API solo guarda respuestas cacheables: 200 con max-age largo;
    // el borrado es explícito (disconnect), no por caducidad.
    await store.cache.put(cacheCredentialRequest(id), new Response(value, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    }));
    return;
  }
  memoryStore.delete(key);
  while (memoryStore.size >= MAX_MEMORY_CREDENTIALS) memoryStore.delete(memoryStore.keys().next().value);
  memoryStore.set(key, value);
}

async function deleteEncrypted(id, store) {
  const key = STORAGE_PREFIX + id;
  if (store.kind === 'kv') {
    await store.kv.delete(key);
    // Remove legacy private-token records when a user disconnects. They are
    // never read by this implementation.
    await store.kv.delete(LEGACY_RD_PREFIX + id);
    return;
  }
  if (store.kind === 'cache') {
    await store.cache.delete(cacheCredentialRequest(id));
    return;
  }
  memoryStore.delete(key);
  memoryStore.delete(LEGACY_RD_PREFIX + id);
}

/**
 * Guarda una copia en la RAM del isolate. Con la Cache API esto es lo que hace
 * que la credencial sobreviva a la eviction del PoP mientras el isolate siga
 * vivo, y evita depender del datacenter que guardó el registro.
 *
 * Devuelve si el almacén de verdad conserva el registro:
 *  - `kv`: sí, es duradero.
 *  - `cache`: **no se puede prometer**. En un dominio propio la Cache API
 *    funciona; en `*.workers.dev` Cloudflare documenta que las operaciones de
 *    Cache API «no tienen efecto». Además, sin KV cada isolate nuevo empieza
 *    sin la credencial y el usuario ve que su conexión «desaparece» a los 5
 *    minutos (cuando caduca la copia en RAM).
 *  - `memory`: solo RAM, se pierde con el isolate.
 */
function memoryCopyIsDurable(store) {
  return store.kind === 'kv';
}

async function createCredential(recordInput, env) {
  const record = normalizeRecord(recordInput);
  if (!record) {
    const error = new Error('credential_invalid');
    error.code = 'credential_invalid';
    throw error;
  }
  const store = getStore(env);
  const secret = getEncryptionSecret(env);
  const credentialId = randomBytes(24).toString('base64url');
  const encrypted = await encryptRecord(record, secret, credentialId);
  await writeEncrypted(credentialId, encrypted, store);
  if (store.kind === 'kv' || store.kind === 'cache') {
    cache.set(`debrid:credential:${credentialId}`, record, CREDENTIAL_CACHE_TTL);
  }
  if (!memoryCopyIsDurable(store)) {
    // Aviso explícito: la conexión puede perderse. Ver docs/pruebas-en-vivo.
    console.warn(
      `[Debrid] credencial ${record.provider} guardada con almacén "${store.kind}": ` +
      'sin DEBRID_KV no es duradera y puede desaparecer a los 5 minutos ' +
      '(cada isolate nuevo necesita leerla otra vez).'
    );
  }
  return { credentialId, provider: record.provider, durable: memoryCopyIsDurable(store) };
}

async function updateCredential(credentialId, recordInput, env) {
  if (typeof credentialId !== 'string' || !ID_RE.test(credentialId)) return false;
  const record = normalizeRecord(recordInput);
  if (!record) return false;
  const store = getStore(env);
  const secret = getEncryptionSecret(env);
  const current = await getCredential(credentialId, env);
  if (!current || current.provider !== record.provider) return false;
  const encrypted = await encryptRecord(record, secret, credentialId);
  await writeEncrypted(credentialId, encrypted, store);
  if (store.kind === 'kv' || store.kind === 'cache') {
    cache.set(`debrid:credential:${credentialId}`, record, CREDENTIAL_CACHE_TTL);
  }
  return true;
}

async function getCredential(credentialId, env) {
  if (typeof credentialId !== 'string' || !ID_RE.test(credentialId)) return null;
  let store;
  let secret;
  try {
    store = getStore(env);
    secret = getEncryptionSecret(env);
  } catch (_) {
    return null;
  }
  const cacheKey = `debrid:credential:${credentialId}`;
  const cached = cache.get(cacheKey);
  if (cached) return { ...cached };
  try {
    const record = await cache.coalesce(cacheKey, async () => {
      const again = cache.get(cacheKey);
      if (again) return again;
      const encrypted = await readEncrypted(credentialId, store);
      if (!encrypted) return null;
      const value = await decryptRecord(encrypted, secret, credentialId);
      if (value) cache.set(cacheKey, value, CREDENTIAL_CACHE_TTL);
      return value;
    });
    return record ? { ...record } : null;
  } catch (err) {
    // Antes esto era un `return null` mudo: el usuario veía «no hay servicio
    // conectado» sin ninguna pista de que el almacén no era duradero.
    console.error('[Debrid] No se pudo leer una credencial guardada:', err && err.message);
    return null;
  }
}

async function disconnect(credentialId, env) {
  if (typeof credentialId !== 'string' || !ID_RE.test(credentialId)) return false;
  const store = getStore(env);
  await deleteEncrypted(credentialId, store);
  cache.deletePrefix(`debrid:credential:${credentialId}`);
  cache.deletePrefix(`debrid:availability:${credentialId}:`);
  cache.deletePrefix(`debrid:link:${credentialId}:`);
  cache.deletePrefix(`debrid:list:${credentialId}:`);
  cache.deletePrefix(`debrid:refresh:${credentialId}`);
  return true;
}

function isConfigured(env) {
  try {
    getStore(env);
    getEncryptionSecret(env);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Backend que se está usando: 'kv' (duradera, recomendada), 'cache'
 * (Cache API del Worker: sin configuración, pero por datacenter y con
 * posible expulsión) o 'memory' (solo desarrollo). null si no hay ninguno.
 */
function storageKind(env) {
  try {
    return getStore(env).kind;
  } catch (_) {
    return null;
  }
}

module.exports = {
  createCredential,
  updateCredential,
  getCredential,
  disconnect,
  isConfigured,
  storageKind,
  // These are exported for deterministic offline tests only.
  normalizeRecord,
  ID_RE,
};
