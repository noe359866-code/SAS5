'use strict';

/**
 * Cliente mínimo de Supabase (REST de PostgREST) para el addon.
 *
 * No se usa `@supabase/supabase-js`: el addon corre igual en Node y en
 * Cloudflare Workers, y aquí solo hacen falta dos cosas —leer
 * `public.video_host_links` por IMDb/TMDb y marcar un enlace como roto—, que
 * son dos peticiones `fetch` con las cabeceras `apikey` y `Authorization`.
 *
 * Credenciales (ver lib/config.js):
 *   SUPABASE_URL               https://<ref>.supabase.co
 *   SUPABASE_ANON_KEY          clave pública; respeta las políticas RLS
 *   SUPABASE_SERVICE_ROLE_KEY  clave secreta; salta RLS. Tiene prioridad y
 *                              **nunca** se envía al navegador ni se registra.
 *
 * La clave no viaja en la URL: `safeUrl` descarta la query al informar errores
 * y el cuerpo de la respuesta nunca se reenvía tal cual.
 */

const config = require('./config');
const { fetchJson, fetchText } = require('./http');

// Tope de filas por consulta: un título con muchas variantes (calidades,
// idiomas, servidores) no necesita más para llenar la lista de Stremio.
const MAX_ROWS = 40;
const TABLE = 'video_host_links';

function configured() {
  return Boolean(config.supabaseConfigured);
}

/** Cabeceras de PostgREST. La clave va en `apikey`, no en la ruta. */
function headers() {
  const key = config.supabaseKey;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
  };
}

function tableUrl(query = '') {
  const base = `${config.supabaseUrl}/rest/v1/${TABLE}`;
  return query ? `${base}?${query}` : base;
}

/** Error con el código de PostgREST (`message`, `code`) sin filtrar la clave. */
function supabaseError(err, action) {
  const status = err?.status;
  const error = new Error(`Supabase: no se pudo ${action} (${status ? `HTTP ${status}` : 'sin respuesta'})`);
  error.status = status;
  error.supabase = true;
  return error;
}

/**
 * Filtro por identidad. Se consulta por **una** clave —IMDb si existe, si no
 * TMDb— porque el índice parcial correspondiente cubre exactamente esa forma;
 * un `or=(imdb_id.eq…,tmdb_id.eq…)` no usa ninguno de los dos. El llamador
 * puede repetir la consulta con la otra clave si la primera no devuelve nada.
 *
 * `media_type` y temporada/episodio son obligatorios: los índices parciales
 * incluyen esas columnas y la restricción `chk_season_episode_by_type` ya
 * garantiza que una película no tenga temporada.
 */
function identityQuery(identity, { by = 'imdb' } = {}) {
  const mediaType = identity.mediaType === 'series' ? 'series' : 'movie';
  const params = new URLSearchParams();
  params.set('select', 'id,imdb_id,tmdb_id,media_type,season,episode,host_code,embed_url,host_file_id,extractor_type,quality,language,server_label,is_working');
  params.set('is_working', 'eq.true');
  params.set('media_type', `eq.${mediaType}`);
  if (identity.imdbId) params.set('imdb_id', `eq.${identity.imdbId}`);
  if (identity.tmdbId) params.set('tmdb_id', `eq.${Number(identity.tmdbId)}`);
  if (mediaType === 'series') {
    params.set('season', `eq.${Number(identity.season)}`);
    params.set('episode', `eq.${Number(identity.episode)}`);
  } else {
    // La restricción deja `season`/`episode` nulos en películas; se pide
    // explícitamente para no depender de que el dataset lo respete.
    params.set('season', 'is.null');
    params.set('episode', 'is.null');
  }
  params.set('order', 'host_code.asc');
  params.set('limit', String(MAX_ROWS));
  if (by === 'imdb' && !identity.imdbId) return null;
  if (by === 'tmdb' && !identity.tmdbId) return null;
  if (by === 'imdb') params.delete('tmdb_id');
  if (by === 'tmdb') params.delete('imdb_id');
  return params.toString();
}

/**
 * Enlaces guardados para una obra/episodio.
 *
 * Devuelve `{ rows, skipped }`. `skipped` explica por qué no se consultó
 * (sin credenciales, sin identidad, episodio incompleto) y no es un error: la
 * fuente simplemente no aporta nada y el resto sigue funcionando.
 */
async function findLinks(identity, { timeoutMs = config.streamProviderTimeoutMs } = {}) {
  if (!configured()) return { rows: [], skipped: 'not-configured' };
  if (!identity || (!identity.imdbId && !identity.tmdbId)) return { rows: [], skipped: 'identity-required' };
  const series = identity.mediaType === 'series';
  if (series && !(Number(identity.season) > 0 && Number(identity.episode) > 0)) {
    return { rows: [], skipped: 'episode-required' };
  }
  // Una consulta por clave disponible; basta con que una devuelva filas.
  // IMDb primero: es la clave que escribe el importador y la que sobrevive a
  // cambios de TMDb.
  const attempts = [identityQuery(identity, { by: 'imdb' }), identityQuery(identity, { by: 'tmdb' })].filter(Boolean);
  for (const query of attempts) {
    const rows = await fetchJson(tableUrl(query), { headers: headers(), timeoutMs }).catch((err) => {
      throw supabaseError(err, 'leer video_host_links');
    });
    if (Array.isArray(rows) && rows.length) return { rows, skipped: null };
  }
  return { rows: [], skipped: null };
}

/**
 * Marca un enlace como roto. Se llama solo cuando el extractor confirma que el
 * anfitrión ya no sirve el archivo (no cuando hay un 429 o un plazo agotado).
 *
 * No es crítico: si falla (RLS con anon, red), el resultado de la búsqueda no
 * cambia. `increment_fail_count` es una función del proyecto si existe; si no,
 * se hace un PATCH que sube `fail_count` con el valor leído.
 */
async function reportBroken(row, reason, { timeoutMs = 4000 } = {}) {
  if (!configured() || !row?.id) return false;
  const id = Number(row.id);
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  const patch = {
    is_working: false,
    fail_count: (Number(row.fail_count) || 0) + 1,
    last_error: String(reason || 'extract-failed').slice(0, 200),
    last_checked_at: new Date().toISOString(),
  };
  try {
    // PostgREST responde 204 sin cuerpo; `fetchJson` fallaría al parsear el
    // vacío, así que se lee como texto (y se descarta).
    await fetchText(tableUrl(`id=eq.${id}`), {
      method: 'PATCH',
      headers: { ...headers(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
      timeoutMs,
      maxBytes: 8 * 1024,
    });
    return true;
  } catch (_) {
    return false;
  }
}

/** Estado para /healthz: solo booleanos, nunca la URL ni la clave. */
function status() {
  return {
    configured: configured(),
    // `service_role` puede escribir el estado de los enlaces; `anon` solo lee.
    writable: Boolean(configured() && config.supabaseServiceRoleKey),
  };
}

module.exports = { configured, findLinks, reportBroken, status, identityQuery, headers, MAX_ROWS };
