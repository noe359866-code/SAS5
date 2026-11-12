'use strict';

const cache = require('./cache');
const config = require('./config');
const shared = require('./debridShared');

const API = 'https://api.torbox.app/v1/api';
const AVAILABILITY_TTL = 30 * 60;
const TORRENT_LIST_TTL = 30;
const LINK_TTL = 2 * 60;
// TorBox documenta en `createtorrent` que `seed` es 1=auto, 2=sembrar,
// 3=no sembrar (no un booleano). 3 es lo que corresponde a la política del
// addon: no convertir la cuenta del usuario en seedbox.
const SEED_DONT = '3';
// Errores de transporte: un reintento corto distingue «TorBox tardó» de «tu
// clave no vale». En el resto no se insiste para no gastar la cuota (300/min).
const TRANSPORT_CODES = new Set(['provider_timeout', 'provider_unreachable', 'provider_blocked', 'provider_invalid_response', 'provider_rate_limited']);

function isTransportError(err) {
  return TRANSPORT_CODES.has(err && err.code);
}

function apiUrl(path) {
  return `${API}${path}`;
}

async function request(token, path, options = {}) {
  const data = await shared.fetchJson(apiUrl(path), {
    ...options,
    headers: { ...shared.bearer(token), ...(options.headers || {}) },
    timeoutMs: options.timeoutMs || config.debridTimeoutMs || 4500,
  });
  return shared.assertTorbox(data);
}

function planState(user) {
  const source = user || {};
  const permission = source.permission && typeof source.permission === 'object' ? source.permission : {};
  const expiresRaw = source.premium_expires_at ?? source.valid_until ?? permission.valid_until ?? source.subscription_expiry ?? null;
  const expiresAt = expiresRaw ? Date.parse(String(expiresRaw)) || Number(expiresRaw) * 1000 || null : null;
  const subscribed = typeof source.is_subscribed === 'boolean' ? source.is_subscribed : undefined;
  return {
    plan: source.plan ?? permission.plan ?? null,
    expiresAt,
    // `false` explícito = cuenta sin plan; si el campo no viene, no se afirma nada.
    subscribed,
  };
}

async function validateCredential(token) {
  // /user/me es el endpoint de identidad, pero es el más expuesto a mantenimiento
  // y al filtrado anti-bots del borde. Si falla por transporte (no por credencial),
  // se pide una segunda opinión a /torrents/mylist: una respuesta `success:true`
  // demuestra que la clave sí es válida.
  const user = await shared.withRetry(
    () => request(token, '/user/me?settings=false', { timeoutMs: config.debridValidateTimeoutMs || 9000 }),
    { attempts: 2, retryable: isTransportError }
  ).catch(async (err) => {
    if (!isTransportError(err)) throw err;
    try {
      const list = await request(token, '/torrents/mylist?limit=1', {
        timeoutMs: config.debridValidateTimeoutMs || 9000,
      });
      if (!Array.isArray(list) && !(list && Array.isArray(list.torrents))) throw err;
      return null;
    } catch (probeError) {
      // El respaldo también falló: se reporta el problema de transporte
      // original, que es el que el usuario tiene que entender.
      if (probeError === err) throw err;
      throw isTransportError(probeError) ? err : probeError;
    }
  });
  if (user && typeof user !== 'object') throw shared.providerError('invalid_credential', 401);
  const account = planState(user);
  if (user && account.subscribed === false) {
    // La clave es válida pero la cuenta no tiene plan: los enlaces directos
    // fallarán igual, así que conviene avisar en /configure.
    return { provider: 'torbox', ...account, warning: 'plan_inactive' };
  }
  return { provider: 'torbox', ...account };
}

function findHashEntry(data, hash) {
  if (!data) return null;
  if (Array.isArray(data)) {
    return data.find((entry) => entry && String(entry.hash || '').toLowerCase() === hash.toLowerCase()) || null;
  }
  if (typeof data !== 'object') return null;
  return data[hash] || data[hash.toUpperCase()] || data[hash.toLowerCase()] || null;
}

async function checkCached(token, credentialId, hits) {
  if (!hits.length) return new Map();
  const hashes = hits.map((hit) => String(hit.infoHash || '').toLowerCase()).filter(Boolean);
  if (!hashes.length) return new Map();
  const cacheKey = `debrid:availability:${credentialId}:torbox:${hashes.slice().sort().join(',')}`;
  return shared.memo(cacheKey, AVAILABILITY_TTL, async () => {
    const url = new URL(apiUrl('/torrents/checkcached'));
    url.searchParams.set('hash', hashes.join(','));
    url.searchParams.set('format', 'object');
    url.searchParams.set('list_files', 'true');
    const body = await shared.fetchJson(url.toString(), {
      headers: shared.bearer(token),
      timeoutMs: config.debridTimeoutMs || 4500,
    }).then(shared.assertTorbox);
    const result = new Map();
    for (const hash of hashes) result.set(hash, findHashEntry(body, hash));
    return result;
  });
}

function listOf(responseData) {
  if (Array.isArray(responseData)) return responseData;
  if (responseData && Array.isArray(responseData.torrents)) return responseData.torrents;
  return [];
}

async function torrentList(token, credentialId) {
  return shared.memo(`debrid:list:${credentialId}:torbox`, TORRENT_LIST_TTL, async () =>
    listOf(await request(token, '/torrents/mylist?limit=1000&bypass_cache=true')));
}

function torrentHash(torrent) {
  return String(torrent && (torrent.hash || torrent.info_hash) || '').toLowerCase();
}

function torrentReady(torrent) {
  if (!torrent) return false;
  if (torrent.download_present === false) return false;
  if (torrent.download_finished === true || torrent.cached === true) return true;
  return String(torrent.download_state || '').toLowerCase() === 'cached';
}

async function getTorrentById(token, torrentId) {
  let current = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    current = await request(
      token,
      `/torrents/mylist?id=${encodeURIComponent(torrentId)}&bypass_cache=true`
    );
    current = Array.isArray(current) ? current[0] : current;
    if (current && Array.isArray(current.files) && current.files.length) return current;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return current;
}

async function createCachedTorrent(token, credentialId, hit) {
  const form = new FormData();
  form.set('magnet', shared.buildMagnet(hit));
  // Seeding off (TorBox espera 1|2|3, no un booleano): el addon no debe
  // convertir la cuenta en semilla.
  form.set('seed', SEED_DONT);
  form.set('allow_zip', 'false');
  // Segunda barrera: TorBox rechaza el alta si el hash no está ya en su caché.
  form.set('add_only_if_cached', 'true');
  const data = await request(token, '/torrents/createtorrent', {
    method: 'POST',
    body: form,
  });
  const torrentId = data && (data.torrent_id ?? data.id);
  if (torrentId == null) return null;
  cache.del(`debrid:list:${credentialId}:torbox`);
  return torrentId;
}

/** `checkcached?list_files=true` ya trae los archivos con su `id`: usarlos
 * ahorra el viaje a `mylist` (que TorBox refresca solo cada 600 s y puede ir
 * desfasado respecto del torrent recién añadido). */
function filesFromAvailability(entry) {
  const files = entry && Array.isArray(entry.files) ? entry.files : null;
  if (!files || !files.length) return null;
  return files.every((file) => file && (file.id != null)) ? files : null;
}

async function resolveCached(token, credentialId, hit, availabilityEntry, resolved) {
  const hash = String(hit.infoHash || '').toLowerCase();
  if (!availabilityEntry || !hash) return null;
  const cacheKey = `debrid:link:${credentialId}:torbox:${hash}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;
  return cache.coalesce(cacheKey, async () => {
    const again = cache.get(cacheKey);
    if (again !== undefined) return again;
    try {
      const list = await torrentList(token, credentialId);
      let torrent = list.find((entry) => torrentHash(entry) === hash && torrentReady(entry));
      let torrentId = torrent && (torrent.id ?? torrent.torrent_id);
      let files = filesFromAvailability(availabilityEntry);
      if (torrentId == null) {
        // Defense in depth: even a stale positive cache lookup cannot add a
        // miss because TorBox itself enforces add_only_if_cached=true.
        torrentId = await createCachedTorrent(token, credentialId, hit);
        if (torrentId == null) return null;
      }

      if (!files) {
        let full = torrent && Array.isArray(torrent.files) && torrent.files.length ? torrent : null;
        if (!full) full = await getTorrentById(token, torrentId);
        if (!full || !Array.isArray(full.files)) return null;
        files = full.files;
      }
      const file = shared.chooseVideoFile(files, resolved);
      if (!file || file.id == null) return null;

      const url = new URL(apiUrl('/torrents/requestdl'));
      // TorBox documents `token` as a required query parameter for requestdl.
      // This request is server-side only; never return or log the permalink.
      url.searchParams.set('token', token);
      url.searchParams.set('torrent_id', String(torrentId));
      url.searchParams.set('file_id', String(file.id));
      const download = shared.assertTorbox(await shared.fetchJson(url.toString(), {
        timeoutMs: config.debridTimeoutMs || 4500,
      }));
      const link = typeof download === 'string' ? download : download && (download.download || download.url);
      const stream = shared.toStream('TorBox', hit, file, link);
      if (stream) cache.set(cacheKey, stream, LINK_TTL);
      return stream;
    } catch (_) {
      return null;
    }
  });
}

module.exports = { validateCredential, checkCached, resolveCached };
