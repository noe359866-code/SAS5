'use strict';

const cache = require('./cache');

const VIDEO_EXT = /\.(?:mkv|mp4|m4v|avi|mov|webm|ts|m2ts|wmv|flv|ogv)$/i;
const SAMPLE = /(?:^|[\s._-])sample(?:[\s._-]|$)/i;

/**
 * Cloudflare Workers no envían `User-Agent` en `fetch()`. TorBox, Real-Debrid
 * y Premiumize están detrás de Cloudflare y su protección anti-bots responde
 * 403 (HTML) cuando el agente está vacío: eso NO es una clave inválida, pero
 * antes se reportaba como tal. Misma política que los indexadores de torrents
 * (lib/streams.js → PROVIDER_HEADERS).
 */
const DEBRID_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; CatalogosPlus/1.6; +https://github.com/noe359866-code/SAS5)',
  Accept: 'application/json',
};

/** Las claves de estos cuatro proveedores no contienen espacios. Al pegarlas
 * desde el panel (o desde un correo) suelen venir con saltos de línea, comillas
 * o el prefijo «Bearer »: se normalizan antes de validar. */
const API_KEY_MIN = 16;
const API_KEY_MAX = 256;

function normalizeApiKey(value) {
  let text = String(value == null ? '' : value);
  text = text.replace(/[\s\u00a0\u200b\u2028\u2029\ufeff]+/g, '');
  text = text.replace(/^['"`]+|['"`]+$/g, '');
  text = text.replace(/^authorization:/i, '').replace(/^bearer:/i, '').replace(/^bearer/i, '');
  return text.slice(0, API_KEY_MAX + 8);
}

/** Validación de forma (no de validez): longitudes imposibles se detectan aquí
 * para no gastar una llamada al proveedor ni confundir al usuario. */
function apiKeyShapeError(token) {
  if (!token) return 'empty';
  if (token.length < API_KEY_MIN) return 'too_short';
  if (token.length > API_KEY_MAX) return 'too_long';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(token)) return 'has_control_chars';
  return null;
}

function providerError(code = 'provider_error', status, detail, providerCode) {
  const error = new Error(code);
  error.code = code;
  if (status) error.status = status;
  // Mensaje del proveedor (TorBox/Premiumize publican textos aptos para el
  // usuario). Nunca URLs, cuerpos crudos ni claves.
  if (detail) error.detail = String(detail).slice(0, 300);
  if (providerCode != null) error.providerCode = providerCode;
  return error;
}

/** El cuerpo JSON del proveedor ya no viaja en el error; se copia aquí lo justo
 * para clasificar sin exponer datos del usuario. */
function providerMessage(data) {
  if (!data || typeof data !== 'object') return '';
  return String(data.detail || data.message || data.error_description || data.error || '');
}

/**
 * Códigos `error_code` publicados por Real-Debrid. Solo cuatro de ellos son
 * responsabilidad del usuario; el resto son del proveedor o del propio addon, y
 * confundirlos es justo lo que hace que «no valida» parezca culpa de la clave.
 */
const REALDEBRID_ERROR_CODES = {
  8: 'invalid_credential', // Bad token
  9: 'provider_permission', // Permission denied
  14: 'provider_account_locked',
  22: 'provider_ip_blocked', // IP Address not allowed
  25: 'provider_unreachable', // Service unavailable
  34: 'provider_rate_limited', // Too many requests
  36: 'provider_fair_usage',
  37: 'provider_endpoint_disabled', // Endpoint desactivado por RD
};

/**
 * Reclasifica un fallo de red/HTTP del proveedor. Distinguir «tu clave está
 * mal» de «el proveedor no respondió / bloqueó la petición / cambió el
 * endpoint» es el punto de todo este módulo: el usuario debe recibir la
 * verdad, no un `invalid_credential` genérico.
 */
function classifyProviderFailure(err) {
  if (!err) return providerError('provider_unreachable');
  const status = Number(err.status) || 0;
  const body = err.body && typeof err.body === 'object' ? err.body : null;
  const code = String((body && (body.error || body.code)) || '').toUpperCase();
  const message = providerMessage(body);
  if (err.code === 'invalid_credential' || err.code === 'provider_blocked'
    || err.code === 'provider_rate_limited' || err.code === 'provider_timeout'
    || err.code === 'provider_unreachable' || err.code === 'provider_endpoint_missing'
    || err.code === 'provider_login_redirect' || err.code === 'provider_invalid_response') return err;
  // Formas de error propias de un proveedor concreto (hoy: Real-Debrid).
  const numericCode = body && body.error_code != null ? Number(body.error_code) : null;
  if (numericCode != null && REALDEBRID_ERROR_CODES[numericCode]) {
    return providerError(REALDEBRID_ERROR_CODES[numericCode], status || 502, message, numericCode);
  }
  if (status === 429) return providerError('provider_rate_limited', 429, message);
  if (status === 404) return providerError('provider_endpoint_missing', 404, message);
  // 401 lo emite la API: es la clave, haya cuerpo o no. 403 sin cuerpo JSON es
  // la página de bloqueo de Cloudflare (la petición no llegó a autenticarse).
  if (status === 401) return providerError('invalid_credential', 401, message);
  if (status === 403) {
    if (body) return providerError('invalid_credential', 401, message);
    return providerError('provider_blocked', 403, message);
  }
  if (body && ['BAD_TOKEN', 'NO_AUTH', 'AUTH_ERROR', 'AUTHENTICATION_FAILED'].includes(code)) {
    return providerError('invalid_credential', 401, message);
  }
  return err;
}

/** Fetch JSON con plazo duro, User-Agent y errores clasificados. Las claves API
 * viajan solo en cabeceras (o en el body que exija el proveedor); los mensajes
 * de error no incluyen URLs ni cuerpos. */
async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = 4500 } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: { ...DEBRID_HEADERS, ...headers },
      body,
      signal: controller.signal,
      // `manual`: así un 301/302 se ve como redirección (endpoint moviéndose)
      // en lugar de como un TypeError opaco, y nunca se reenvía el Bearer a
      // otro origen.
      redirect: 'manual',
    });
    if (response.status >= 300 && response.status < 400) {
      // Una redirección en una API JSON significa que el proveedor no nos trata
      // como cliente de API (EasyDebrid manda al login, otros saltan de dominio).
      // No se sigue: el Bearer viaja en la petición y no debe salir del origen.
      throw providerError('provider_login_redirect', response.status);
    }
    const text = await response.text();
    let data = null;
    const contentType = String(response.headers.get('content-type') || '');
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_) {
        // Un 4xx/5xx con HTML (página de bloqueo de Cloudflare, mantenimiento)
        // es un fallo del borde, no una credencial inválida.
        if (!response.ok) throw providerError('provider_blocked', response.status);
        throw providerError('provider_invalid_response', response.status);
      }
    }
    if (!response.ok) {
      const error = providerError('provider_http_error', response.status);
      if (data && typeof data === 'object' && !Array.isArray(data)) error.body = data;
      else if (contentType.includes('json')) error.body = null;
      throw error;
    }
    return data;
  } catch (err) {
    if (err && err.code) throw classifyProviderFailure(err);
    if (timedOut || (err && (err.name === 'AbortError' || /abort/i.test(String(err.message))))) {
      throw providerError('provider_timeout', 504);
    }
    // fetch() lanza TypeError cuando el host no resuelve o el TCP falla.
    throw providerError('provider_unreachable', 502);
  } finally {
    clearTimeout(timer);
  }
}

/** Un reintento corto para validación de credenciales: un timeout aislado del
 * proveedor no debe rechazar una clave válida. */
async function withRetry(loader, { attempts = 2, retryable = null } = {}) {
  const retryOn = retryable || ((err) => ['provider_timeout', 'provider_unreachable', 'provider_blocked', 'provider_rate_limited'].includes(err && err.code));
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await loader(attempt);
    } catch (err) {
      lastError = err;
      if (attempt + 1 >= attempts || !retryOn(err)) break;
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  throw lastError;
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

/** TorBox: `success` manda. 403/401 ya los clasifica fetchJson; aquí caen los
 * cuerpos 200 con `success:false` (BAD_TOKEN, AUTH_ERROR, PLAN_RESTRICTED…). */
function assertTorbox(data) {
  if (!data || data.success !== true) {
    const code = String((data && data.error) || '').toUpperCase();
    const detail = providerMessage(data);
    // TorBox responde las cabeceras de seguridad de FastAPI sin envoltorio
    // (`{"detail":"Not authenticated"}`), así que el texto también manda.
    const authish = /not authenticated|unauthori[sz]ed|invalid token|bad token|authentication/i
      .test(`${code} ${detail}`);
    if (code === 'BAD_TOKEN' || code === 'NO_AUTH' || code === 'AUTH_ERROR' || authish) {
      throw providerError('invalid_credential', 401, detail);
    }
    if (code === 'TOO_MANY_REQUESTS') throw providerError('provider_rate_limited', 429, detail);
    if (code === 'ENDPOINT_NOT_FOUND') throw providerError('provider_endpoint_missing', 404, detail);
    if (code === 'PLAN_RESTRICTED_FEATURE') throw providerError('provider_plan_restricted', 403, detail);
    throw providerError('provider_rejected', 502, detail);
  }
  return data.data;
}

/** Premiumize publica `{status:'error', message:'…'}` (no un `code` textual):
 * antes cualquier error se convertía en 502 genérico aunque la clave fuese mala. */
function assertPremiumize(data) {
  if (!data || data.status !== 'success') {
    const message = providerMessage(data);
    const code = String((data && data.code) || '').toLowerCase();
    const credentialish = /credential|api key|apikey|authentication|unauthor|customer id|login/i.test(message)
      || code === 'authentication_failed';
    if (credentialish) throw providerError('invalid_credential', 401, message);
    if (code === 'fair_usage_limit' || /fair usage/i.test(message)) {
      throw providerError('provider_fair_usage', 429, message);
    }
    throw providerError('provider_rejected', 502, message);
  }
  return data;
}

/** EasyDebrid responde el objeto plano (sin envoltorio); cualquier otra forma
 * (error JSON, HTML, 200 vacío) se reporta como lo que es. */
function assertEasyDebrid(data) {
  if (!data || typeof data !== 'object' || data.id == null) {
    const message = providerMessage(data);
    if (data && data.error) throw providerError('provider_rejected', 502, message);
    if (!data) throw providerError('provider_invalid_response', 502);
    throw providerError('provider_invalid_response', 502, message);
  }
  return data;
}

/** One in-flight fetch and one in-memory result per key. Credential ids are
 * embedded in every private cache key by callers. */
async function memo(key, ttlSeconds, loader) {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  return cache.coalesce(key, async () => {
    const again = cache.get(key);
    if (again !== undefined) return again;
    const value = await loader();
    cache.set(key, value, ttlSeconds);
    return value;
  });
}

function mapLimit(items, limit, callback) {
  const output = new Array(items.length);
  let next = 0;
  return Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try {
        output[index] = await callback(items[index], index);
      } catch (_) {
        output[index] = null;
      }
    }
  })).then(() => output);
}

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (!n) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i >= 3 ? 2 : 1)} ${units[i]}`;
}

function filePath(file) {
  if (!file || typeof file !== 'object') return '';
  const direct = file.path || file.absolute_path || file.filename || file.name || file.short_name || '';
  const directory = Array.isArray(file.directory) ? file.directory.join('/') : String(file.directory || file.folder || '');
  const name = String(direct || '');
  if (!directory || name.startsWith(`${directory}/`) || name.startsWith('/')) return name;
  return [directory, name].filter(Boolean).join('/');
}

function fileSize(file) {
  return Number(file && (file.bytes ?? file.filesize ?? file.size)) || 0;
}

function isVideo(file) {
  const path = filePath(file);
  if (!VIDEO_EXT.test(path) || SAMPLE.test(path)) return false;
  if (file && file.selected !== undefined && Number(file.selected) === 0) return false;
  return true;
}

function episodeInFile(path, season, episode) {
  const s = Number(season);
  const e = Number(episode);
  if (!(s >= 0 && e >= 0)) return false;

  const explicit = /(?:^|[^\d])S0*(\d{1,2})[ ._-]*E0*(\d{1,3})(?:\s*[-~]\s*E?0*(\d{1,3}))?/ig;
  for (const match of String(path).matchAll(explicit)) {
    const fileSeason = Number(match[1]);
    const first = Number(match[2]);
    const last = match[3] ? Number(match[3]) : first;
    if (fileSeason === s && first <= e && e <= last) return true;
  }

  const xStyle = new RegExp(`(?:^|[^\\d])0*${s}x0*${e}(?!\\d)`, 'i');
  if (xStyle.test(path)) return true;

  const seasonFolder = String(path).match(/\bseason\s*0*(\d{1,2})\b/i);
  if (seasonFolder && Number(seasonFolder[1]) === s) {
    const episodeFile = String(path).match(/\b(?:episode|ep)\s*0*(\d{1,3})\b/i);
    if (episodeFile && Number(episodeFile[1]) === e) return true;
  }
  return false;
}

function chooseVideoFile(files, resolved) {
  const videos = (Array.isArray(files) ? files : []).filter(isVideo);
  if (!videos.length) return null;
  if (resolved && resolved.mediaType === 'series' && resolved.season != null && resolved.episode != null) {
    const matching = videos.filter((file) => episodeInFile(filePath(file), resolved.season, resolved.episode));
    if (matching.length) return matching.sort((a, b) => fileSize(b) - fileSize(a))[0];
    return videos.length === 1 ? videos[0] : null;
  }
  return videos.sort((a, b) => fileSize(b) - fileSize(a))[0];
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function buildMagnet(hit) {
  const params = new URLSearchParams({ xt: `urn:btih:${hit.infoHash}` });
  if (hit.title) params.set('dn', hit.title);
  for (const source of hit.sources || []) {
    if (!String(source).startsWith('tracker:')) continue;
    const tracker = String(source).slice('tracker:'.length);
    if (/^https?:\/\//i.test(tracker) || /^udp:\/\//i.test(tracker)) params.append('tr', tracker);
  }
  return `magnet:?${params.toString()}`;
}

function toStream(providerName, hit, file, url) {
  if (!isHttpsUrl(url)) return null;
  const name = filePath(file).split(/[\\/]/).filter(Boolean).pop() || hit.title || 'Video';
  const size = fileSize(file);
  return {
    name: `⚡ ${providerName}`,
    title: `${name}\n⚡ Directo${size ? `  ·  💾 ${formatSize(size)}` : ''}`,
    url,
    behaviorHints: {
      filename: name,
      notWebReady: false,
      bingeGroup: `catalogos-plus-${String(hit.infoHash || '').slice(0, 8)}`,
    },
  };
}

/**
 * Diagnóstico seguro para la API y para `/configure`: código interno, estado
 * HTTP del proveedor y su mensaje público. No incluye URL, token ni datos de
 * la cuenta.
 */
const PROVIDER_MESSAGES = {
  invalid_credential: 'El proveedor rechazó la clave API (token inválido, caducado o reseteado).',
  provider_timeout: 'El proveedor tardó demasiado en responder. Reintenta en unos segundos.',
  provider_unreachable: 'No se pudo contactar con el proveedor: sin salida de red o fallo de DNS desde el servidor.',
  provider_blocked: 'El proveedor bloqueó la petición del servidor antes de leer la clave (protección anti-bots o IP). La clave no llegó a comprobarse.',
  provider_rate_limited: 'El proveedor está saturado o superaste su límite de peticiones por minuto. Espera y reintenta.',
  provider_endpoint_missing: 'El endpoint de validación del proveedor cambió (404): hay que actualizar el adaptador.',
  provider_login_redirect: 'El proveedor redirigió su API al inicio de sesión en vez de responder en JSON: no reconoció la clave (o cambió la ruta de la API).',
  provider_account_locked: 'La cuenta del proveedor está bloqueada; entra en su web y desbloquéala antes de reintentar.',
  provider_ip_blocked: 'El proveedor no acepta peticiones desde la IP del Worker (bloqueo por IP o lista blanca).',
  provider_permission: 'El proveedor denegó el permiso para esa operación con esta cuenta.',
  provider_endpoint_disabled: 'El proveedor tiene desactivado ese endpoint de su API.',
  provider_invalid_response: 'El proveedor respondió algo que no es JSON válido (mantenimiento o portal cautivo).',
  provider_rejected: 'El proveedor respondió un error al validar la clave.',
  provider_plan_restricted: 'La cuenta no tiene un plan activo que permita usar esa función de la API.',
  provider_fair_usage: 'Has alcanzado el «fair use» de la cuenta en el proveedor.',
  provider_error: 'El proveedor no pudo validar la clave.',
};

function describeError(err) {
  const code = (err && err.code) || 'provider_error';
  return {
    code,
    providerStatus: Number(err && err.status) || undefined,
    providerMessage: (err && err.detail) ? String(err.detail).slice(0, 300) : undefined,
    providerCode: err && err.providerCode != null ? err.providerCode : undefined,
    message: PROVIDER_MESSAGES[code] || PROVIDER_MESSAGES.provider_error,
  };
}

module.exports = {
  fetchJson,
  withRetry,
  bearer,
  assertTorbox,
  assertPremiumize,
  assertEasyDebrid,
  classifyProviderFailure,
  normalizeApiKey,
  apiKeyShapeError,
  providerMessage,
  providerError,
  describeError,
  DEBRID_HEADERS,
  memo,
  mapLimit,
  formatSize,
  filePath,
  fileSize,
  chooseVideoFile,
  episodeInFile,
  isHttpsUrl,
  buildMagnet,
  toStream,
};
