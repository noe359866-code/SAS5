'use strict';

/**
 * Anfitriones de video que se guardan en `public.video_host_links`
 * (`host_code`): Mixdrop, Filemoon, Vihidrive y los demás visores cuyo embed
 * se puede convertir en un medio directo con una o dos peticiones HTTPS.
 *
 * La fila de la base de datos guarda el **embed** (`embed_url`), no el
 * manifiesto: la URL del `.m3u8`/`.mp4` de estos anfitriones suele ir firmada
 * y caduca en horas, mientras que el embed es estable durante meses. Por eso
 * el `.m3u8` se extrae en cada búsqueda (con la caché de `lib/cache.js` por
 * delante) y el resultado lleva `expiresAt` cuando la firma lo declara.
 *
 * Cobertura (medida contra el HTML público; nunca se ejecuta su JavaScript ni
 * se usa un navegador headless):
 *
 * | host_code   | peticiones | método                                                   |
 * |-------------|-----------:|----------------------------------------------------------|
 * | mixdrop     | 1          | packer Dean Edwards → `MDCore.wurl` / `furl`             |
 * | filemoon    | 1          | `sources:[{file:'…m3u8'}]` en el propio HTML (y packer)  |
 * | vihidrive   | 1–2        | `sources`/`file` en el HTML o `data-sources` en el embed |
 * | streamtape  | 2          | `robotlink` + `/get_video?id=…&dl=1`                     |
 * | byse        | 1          | API JSON + AES-256-GCM (`playback.key_parts`)            |
 *
 * Los dos últimos reutilizan el extractor ya probado de `lib/extractors.js`.
 * Un anfitrión desconocido se publica **sin extraer** solo si `embed_url` ya
 * es un medio directo (`.m3u8`/`.mp4`); si no, se descarta: el addon nunca
 * publica un enlace que Stremio no pueda abrir.
 */

const config = require('./config');
const { providerHttp, stopProvider } = require('./providerHttp');
const { UA, extractorFor, extractEmbed } = require('./extractors');
const { fromPacker, normalizeMediaUrl, mediaKind, parseHlsManifest, audioFromLabel } = require('./mediaParse');
const { isDirectMedia } = require('./directMedia');
const { resolutionToken } = require('./resolution');

const HTML_HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
};
const MAX_HTML = 1024 * 1024;

/** Nombre legible por `host_code` (el que se muestra en Stremio). */
const SERVER_NAMES = {
  mixdrop: 'Mixdrop',
  filemoon: 'Filemoon',
  vihidrive: 'Vihidrive',
  streamtape: 'Streamtape',
  byse: 'Byse',
  okru: 'OK.ru',
  streamwish: 'StreamWish',
  vidhide: 'VidHide',
  voe: 'Voe',
  doodstream: 'DoodStream',
  mega: 'Mega',
};

/** `host_code` de la tabla → familia de extractor. */
const FAMILIES = [
  { family: 'mixdrop', host: /(?:^|\.)(?:mixdrop|mxdrop)[a-z0-9-]*\.(?:co|to|top|click|com|ag|bz|ch|sx|si|cc|me|net)$/i },
  { family: 'filemoon', host: /(?:^|\.)(?:filemoon|filemoon2|fmoon|moonfile)[a-z0-9-]*\.(?:sx|to|com|net|org|in|link|site|cc|me|io|xyz|art)$/i },
  // Vihidrive rota de dominio a menudo (vihidrive.cc, vihi.to, vihidrive.xyz…):
  // manda la etiqueta inicial, no el TLD.
  { family: 'vihidrive', host: /(?:^|\.)(?:vihidrive|vihi|vhidrive)[a-z0-9-]*\./i },
  { family: 'streamtape', host: /(?:^|\.)streamtape\.(?:com|net|to)$/i },
  { family: 'byse', host: /(?:^|\.)byse[a-z0-9-]*\.(?:com|to|net|xyz|site)$/i },
  { family: 'okru', host: /(?:^|\.)ok\.ru$/i },
];

/** Familia de extractor para una URL de embed, o `null` si no se reconoce. */
function familyOf(embed) {
  let host;
  try { host = new URL(String(embed || '')).hostname; } catch { return null; }
  for (const entry of FAMILIES) if (entry.host.test(host)) return entry.family;
  return null;
}

function hostOf(url) {
  try { return new URL(String(url || '')).hostname; } catch { return ''; }
}

/**
 * URL del manifiesto declarada en el HTML, con la forma comprobada:
 *
 *   · `sources: [{file: "https://…/master.m3u8"}]` — Filemoon y Vihidrive;
 *   · `file:"https://…/index.m3u8"` suelto;
 *   · `MDCore.wurl = "//…/v.mp4"` — Mixdrop (a veces empaquetado).
 *
 * Todo pasa por `isDirectMedia`, así que un `data:`/`blob:`/relé no sale.
 */
function mediaFromHtml(html, base) {
  const unpacked = String(fromPacker(html) || '') || String(html || '');
  const found = [];
  const push = (raw) => {
    const url = normalizeMediaUrl(String(raw || '').replace(/\\\//g, '/').trim(), base);
    if (url && isDirectMedia(url) && mediaKind(url) && !found.includes(url)) found.push(url);
  };
  for (const key of ['wurl', 'furl']) {
    const raw = new RegExp(`MDCore\\.${key}\\s*=\\s*["']([^"']+)["']`).exec(unpacked)?.[1];
    if (raw) push(raw);
  }
  for (const match of unpacked.matchAll(/["']?(?:file|src|url|hls\d?|source|sources)["']?\s*[:=]\s*(\[[\s\S]{0,2000}?\]|["'][^"']{8,900}["'])/gi)) {
    const chunk = match[1];
    for (const inner of chunk.matchAll(/["']([^"']{8,900})["']/g)) push(inner[1]);
    if (found.length >= 4) break;
  }
  if (!found.length) {
    for (const match of unpacked.matchAll(/https?:\\?\/\\?\/[^\s"'\\)<]+?\.(?:m3u8|mp4|m4v)[^\s"'\\)<]*/gi)) {
      push(match[0].replace(/\\\//g, '/'));
      if (found.length >= 4) break;
    }
  }
  return found;
}

/** Calidad declarada por el nombre del archivo o por el HTML (`720p`). */
function qualityFromHtml(html, url) {
  for (const value of [url, String(html || '').slice(0, 4000)]) {
    const token = resolutionToken(value);
    if (token) return token;
  }
  return null;
}

// ── Extractores por familia ──────────────────────────────────────────────

async function extractMixdrop(embed, http) {
  const html = await http.text(embed, {
    headers: { ...HTML_HEADERS, Referer: `${new URL(embed).origin}/` }, maxBytes: MAX_HTML,
  });
  // `mediaFromHtml` devuelve URLs; el resto de extractores trabaja con
  // `{ url, kind }` para que el pipeline tenga una sola forma.
  const sources = mediaFromHtml(html, embed).map((url) => ({ url, kind: mediaKind(url) }));
  return { sources, quality: qualityFromHtml(html, sources[0]?.url), reason: sources.length ? null : 'no-source' };
}

/**
 * Filemoon y Vihidrive publican el manifiesto en el HTML de su propio embed.
 * Si ese HTML no lo trae (algunas tandas lo cargan por XHR), se intenta el
 * `iframe`/`data-src` que apunte al mismo visor y, como último recurso, los
 * endpoints JSON habituales del reproductor (`/playlist`, `/sources`).
 */
async function extractInline(embed, http, { endpoints = [] } = {}) {
  const origin = new URL(embed).origin;
  const html = await http.text(embed, { headers: { ...HTML_HEADERS, Referer: `${origin}/` }, maxBytes: MAX_HTML });
  // `mediaFromHtml` devuelve URLs; el contrato de los extractores es
  // `{ url, kind }` (ver extractMixdrop).
  const found = mediaFromHtml(html, embed);
  if (found.length) {
    return { sources: found.map((url) => ({ url, kind: mediaKind(url) })), quality: qualityFromHtml(html, found[0]), reason: null };
  }

  // Segundo salto: un iframe del mismo dueño (a veces el reproductor vive en
  // otro subdominio del anfitrión).
  const frame = /<iframe[^>]+src=["']([^"']+)["']/i.exec(html)?.[1];
  const frameUrl = frame ? normalizeMediaUrl(frame, embed) : null;
  const inline = frameUrl && /\.(?:m3u8|mp4)(?:$|[?#])/i.test(frameUrl) ? [frameUrl] : [];
  if (inline.length) return { sources: inline.map((url) => ({ url, kind: mediaKind(url) })), quality: null, reason: null };

  for (const endpoint of endpoints) {
    const target = new URL(endpoint.replace('{id}', fileIdOf(embed)), origin).href;
    const body = await http.text(target, { headers: { ...HTML_HEADERS, Referer: embed }, maxBytes: 256 * 1024 }).catch(() => '');
    if (!body) continue;
    const parsed = mediaFromHtml(body, target);
    if (parsed.length) return { sources: parsed.map((url) => ({ url, kind: mediaKind(url) })), quality: null, reason: null };
  }
  return { sources: [], reason: 'no-source' };
}

/**
 * Identificador del archivo en el embed:
 * `/e/<id>`, `/d/<id>`, `/v/<id>`, `/embed/<id>` o `/watch/<id>`.
 */
function fileIdOf(embed) {
  try {
    const parts = new URL(embed).pathname.split('/').filter(Boolean);
    const at = parts.findIndex((part) => /^(?:e|d|v|embed|watch|f)$/i.test(part));
    const id = (at >= 0 ? parts[at + 1] : parts[parts.length - 1]) || '';
    return /^[A-Za-z0-9_-]{4,64}$/.test(id) ? id : '';
  } catch { return ''; }
}

const EXTRACTORS = {
  mixdrop: (embed, http) => extractMixdrop(embed, http),
  filemoon: (embed, http) => extractInline(embed, http, { endpoints: ['/playlist/{id}', '/api/source/{id}', '/sources/{id}'] }),
  vihidrive: (embed, http) => extractInline(embed, http, { endpoints: ['/api/source/{id}', '/playlist/{id}', '/sources/{id}'] }),
};

/**
 * Convierte un `embed_url` en medios reproducibles.
 *
 * Devuelve `{ ok, sources, subtitles, extractor, reason }`; **nunca lanza** por
 * un fallo del anfitrión (sí propaga los bloqueos de `stopProvider`, que el
 * pipeline usa para pausar la fuente).
 */
async function extractHost(embed, { hostCode = '', timeoutMs = config.streamProviderTimeoutMs } = {}) {
  let url;
  try { url = new URL(String(embed || '')).href; } catch { return { ok: false, sources: [], reason: 'invalid-url' }; }
  if (!['https:', 'http:'].includes(new URL(url).protocol)) return { ok: false, sources: [], reason: 'invalid-url' };

  // El `embed_url` puede ser ya un medio directo: no hay nada que extraer.
  if (isDirectMedia(url) && mediaKind(url)) {
    return { ok: true, extractor: 'direct', sources: [{ url, kind: mediaKind(url) }], subtitles: [], reason: null };
  }

  const family = familyOf(url) || String(hostCode || '').toLowerCase();
  // Un embed de un visor sin extractor (o un iframe HTML genérico) no se
  // publica: Stremio mostraría un reproductor en blanco.
  if (!EXTRACTORS[family] && extractorFor(url) !== 'mixdrop' && extractorFor(url) !== 'streamtape'
    && extractorFor(url) !== 'byse' && extractorFor(url) !== 'videohel') {
    return { ok: false, sources: [], extractor: family || null, reason: 'unsupported-host' };
  }

  const http = providerHttp(timeoutMs, 3);
  try {
    let result;
    if (EXTRACTORS[family]) result = await EXTRACTORS[family](url, http);
    else {
      // streamtape / byse / videohel: extractor compartido con los sitios.
      const shared = await extractEmbed(url, { provider: 'supabase', timeoutMs });
      result = { sources: shared.sources, subtitles: shared.subtitles, reason: shared.reason };
      if (!shared.ok && shared.reason === 'unsupported-host') return { ok: false, sources: [], reason: 'unsupported-host' };
    }
    const sources = (result.sources || []).filter((source) => source?.url && mediaKind(source.url) && isDirectMedia(source.url));
    return {
      ok: sources.length > 0,
      extractor: family || null,
      sources,
      subtitles: result.subtitles || [],
      quality: result.quality || null,
      reason: sources.length ? null : (result.reason || 'no-source'),
    };
  } catch (error) {
    if (stopProvider(error)) throw error;
    return { ok: false, sources: [], extractor: family || null, reason: error?.timeout ? 'timeout' : 'fetch-error' };
  }
}

/**
 * Comprueba un HLS antes de publicarlo y devuelve su mejor variante.
 * Se usa solo cuando la fila no declara calidad: el addon no sondea medios
 * por defecto, y `quality` en la tabla evita la petición.
 */
async function probeManifest(url, { timeoutMs = config.streamProviderTimeoutMs, referer } = {}) {
  const http = providerHttp(timeoutMs, 2);
  const text = await http.text(url, {
    headers: { ...HTML_HEADERS, ...(referer ? { Referer: referer } : {}) }, maxBytes: 256 * 1024,
  });
  const manifest = parseHlsManifest(text, url);
  if (!manifest) return { ok: false, reason: 'not-hls' };
  if (manifest.type !== 'master') return { ok: true, resolution: null, variants: 1 };
  return {
    ok: true,
    resolution: manifest.best?.height ? `${manifest.best.height}p` : null,
    variant: manifest.best?.uri || null,
    variants: manifest.variants.length,
  };
}

/** Etiqueta de audio de la fila (`language`) para el stream de Stremio. */
function audioLabelOf(row) {
  const fromLabel = audioFromLabel(row?.language);
  if (fromLabel) return fromLabel;
  const raw = String(row?.language || '').trim();
  return raw ? raw.slice(0, 24) : '';
}

module.exports = {
  extractHost, familyOf, fileIdOf, mediaFromHtml, qualityFromHtml, audioLabelOf, probeManifest,
  FAMILIES, EXTRACTORS, SERVER_NAMES, hostOf,
};
