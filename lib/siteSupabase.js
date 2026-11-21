'use strict';

/**
 * Fuente `supabase`: enlaces propios guardados en `public.video_host_links`.
 *
 * Cubre lo que los sitios rastreados no tienen: un título (o un episodio) que
 * alguien cargó a mano en Mixdrop, Filemoon, Vihidrive… La fila guarda el
 * **embed**; el medio directo se extrae aquí, en el momento de la búsqueda.
 *
 * Flujo por petición:
 *   1. `findLinks(identity)` — una o dos consultas PostgREST por IMDb/TMDb.
 *   2. Por fila, `extractHost(embed_url)` con caché (`lib/cache.js`), así que
 *      un título pedido por varios usuarios extrae una sola vez por ventana.
 *   3. `hit` con forma de proveedor: `{ title, url, quality, resolution,
 *      audioLabel, expiresAt, subtitles, provider: 'supabase' }`.
 *
 * Si el anfitrión confirma que el archivo ya no existe (no un 429 ni un
 * plazo), la fila se marca rota (`is_working = false`) para que la siguiente
 * búsqueda no gaste peticiones en ella. Eso necesita la clave `service_role`;
 * con `anon` el PATCH falla en silencio y no cambia nada.
 */

const config = require('./config');
const cache = require('./cache');
const supabase = require('./supabase');
const { extractHost, qualityFromHtml, audioLabelOf, probeManifest, familyOf, SERVER_NAMES } = require('./hostExtractors');
const { stopProvider } = require('./providerHttp');

// El manifiesto de estos anfitriones va firmado y caduca; se guarda 10 min,
// que es la mitad de lo que suele durar la firma más corta observada.
const EXTRACT_TTL_SECONDS = 600;
const MAX_ROWS_PER_REQUEST = 8;
// Hosts cuyo manifiesto conviene sondear cuando la fila no declara calidad.
const PROBE_FAMILIES = new Set(['filemoon', 'vihidrive', 'mixdrop']);

function canReport() {
  return Boolean(config.supabaseServiceRoleKey);
}

/**
 * Extrae una fila. La clave de caché incluye el embed (que lleva el id del
 * archivo), no el id de la fila: dos filas del mismo archivo comparten
 * extracción.
 */
function extractRow(row, timeoutMs) {
  const embed = String(row.embed_url || '');
  const key = `supabase:extract:${embed}`;
  const cached = cache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  return cache.coalesce(key, async () => {
    const result = await extractHost(embed, { hostCode: row.host_code, timeoutMs });
    if (result.ok) cache.set(key, result, EXTRACT_TTL_SECONDS);
    return result;
  });
}

/**
 * Audio de la fila. La columna `language` es la única prueba del doblaje.
 *
 * Si está vacía no se inventa un idioma: se publica «Latino (sin verificar)»,
 * que el filtro de idiomas del addon acepta (es un addon de español latino y
 * estos enlaces los carga el propio operador) y que en Stremio se lee tal cual,
 * sin prometer un doblaje que nadie comprobó.
 */
function audioOf(row) {
  const label = audioLabelOf(row);
  return label || 'Latino (sin verificar)';
}

/** `SERVER_LABEL`/`HOST_CODE` legibles: «Mixdrop» en vez de «mixdrop». */
function serverLabelOf(row) {
  const label = String(row.server_label || '').trim();
  if (label) return label.slice(0, 32);
  const code = String(row.host_code || '').trim();
  const known = SERVER_NAMES[String(code).toLowerCase()];
  if (known) return known;
  return code ? code.charAt(0).toUpperCase() + code.slice(1) : 'Servidor propio';
}

function titleFor(resolved, row) {
  const base = resolved.title || 'Enlace propio';
  if (resolved.mediaType === 'series' && resolved.season && resolved.episode) {
    return `${base} S${String(resolved.season).padStart(2, '0')}E${String(resolved.episode).padStart(2, '0')} ${serverLabelOf(row)}`;
  }
  return `${base} ${serverLabelOf(row)}`;
}

/**
 * `searchSupabase(query, resolved, queryTitle, timeoutMs)` — misma firma que
 * el resto de `SEARCHERS`.
 *
 * El segundo intento por título alternativo se salta: los enlaces están
 * indexados por identidad (IMDb/TMDb), no por título, así que la consulta no
 * cambiaría.
 */
async function searchSupabase(_query, resolved, queryTitle, timeoutMs = config.streamProviderTimeoutMs) {
  if (!resolved) return { skipped: 'identity-required' };
  if (queryTitle && queryTitle !== resolved.title) return { skipped: 'alternative-already-checked' };
  if (!supabase.configured()) return { skipped: 'not-configured' };
  if (resolved.mediaType === 'series'
    && !(Number(resolved.season) > 0 && Number(resolved.episode) > 0)) return { skipped: 'episode-required' };

  let rows;
  try {
    ({ rows } = await supabase.findLinks(resolved, { timeoutMs }));
  } catch (error) {
    // Sin credenciales o con la tabla caída la fuente no aporta nada; el resto
    // de proveedores sigue. Un bloqueo (429/5xx) sí pausa la fuente.
    if (stopProvider(error) || [401, 403, 404, 429, 500, 503].includes(error?.status)) throw error;
    return { hits: [], reason: 'database-error' };
  }
  if (!rows.length) return { hits: [], reason: 'no-links' };

  // Primero las filas que declaran calidad (no gastan sondeo) y, dentro de
  // ellas, la mejor: el orden de Stremio es el orden de las fuentes, y dentro
  // de esta fuente manda la calidad declarada.
  const ordered = rows.slice()
    .sort((a, b) => score(b) - score(a))
    .slice(0, MAX_ROWS_PER_REQUEST);

  const settled = await Promise.allSettled(ordered.map(async (row) => {
    const extraction = await extractRow(row, timeoutMs);
    if (!extraction.ok) {
      // Archivo borrado en el anfitrión: se marca roto para no reintentarlo
      // en cada petición durante los próximos días.
      if (canReport() && ['no-source', 'unsupported-host', 'invalid-url'].includes(extraction.reason)) {
        await supabase.reportBroken(row, extraction.reason);
      }
      return null;
    }
    const source = extraction.sources[0];
    const family = familyOf(row.embed_url) || extraction.extractor || null;
    // Se publica el manifiesto tal cual; la calidad se toma de la fila, del
    // nombre del archivo o —solo si no hay otra pista— de sondear el HLS.
    let resolution = row.quality ? (qualityFromHtml('', String(row.quality)) || String(row.quality).slice(0, 12)) : null;
    if (!resolution && PROBE_FAMILIES.has(family)) {
      const probe = await probeManifest(source.url, { timeoutMs, referer: row.embed_url }).catch(() => null);
      if (probe?.ok) resolution = probe.resolution;
    }
    return {
      provider: 'supabase',
      providerLabel: serverLabelOf(row),
      title: titleFor(resolved, row),
      url: source.url,
      quality: source.kind === 'hls' ? 'HLS' : 'MP4',
      resolution: resolution || null,
      audioLabel: audioOf(row),
      ...(extraction.subtitles?.length ? { subtitles: extraction.subtitles } : {}),
    };
  }));

  const hits = [];
  let failures = 0;
  for (const result of settled) {
    if (result.status === 'rejected') {
      if (stopProvider(result.reason)) throw result.reason;
      failures += 1;
      continue;
    }
    if (result.value) hits.push(result.value);
  }
  if (!hits.length) return { hits: [], reason: failures ? 'extract-failed' : 'no-extractable-embed' };
  return { hits };
}

/** Puntúa una fila: calidad declarada > varias pistas > orden estable por host. */
function score(row) {
  let value = 0;
  if (row.quality) value += 100;
  const resolution = Number(/(\d{3,4})/.exec(String(row.quality || ''))?.[1]);
  if (Number.isFinite(resolution)) value += Math.min(resolution, 2160) / 100;
  if (row.language) value += 10;
  if (String(row.extractor_type || '').toLowerCase() === 'direct') value += 5;
  return value;
}

module.exports = { searchSupabase, audioOf, EXTRACT_TTL_SECONDS, MAX_ROWS_PER_REQUEST };
