'use strict';

/**
 * Extractores de visores (players) que aparecen detrás de los sitios.
 *
 * Cada sitio de películas no sirve el vídeo: publica un `<iframe>` de un visor
 * intermedio. Este módulo abre **un** nivel de visor y devuelve las fuentes
 * directas. Nada de aquí se ejecuta en el navegador ni usa un navegador headless:
 * son peticiones HTTP al HTML público y lecturas del texto.
 *
 * Visores cubiertos y coste real (medido con `scripts/sites-probe.mjs`):
 *
 * | visor       | peticiones | método                                            |
 * |-------------|-----------:|---------------------------------------------------|
 * | byse        | 1          | API JSON + AES-256-GCM (`playback.key_parts`)     |
 * | mixdrop     | 1          | packer Dean Edwards → `MDCore.wurl`               |
 * | videohel    | 1          | `vurl`/`sources` en el HTML + packer               |
 * | streamtape  | 2          | `robotlink` + `/get_video?id=…&dl=1`              |
 * | hglink / hgcloud / streamwish | 0 | **descartado**: su embed es un JS ofuscado que pide redirecciones y un token de Cloudflare; el coste supera el presupuesto por búsqueda |
 * | voe / vidhide / powvideo | 0 | **descartado**: Cloudflare 403 o muro JS de 100 KB por petición |
 *
 * Presupuesto: cada visor recibe su propio `providerHttp` con un tope de
 * peticiones; si se agota devuelve `reason: 'budget'` en vez de lanzar.
 */

const config = require('./config');
const { isDirectMedia } = require('./directMedia');
const { providerHttp, stopProvider } = require('./providerHttp');
const { fromPacker, normalizeMediaUrl, mediaKind, parseHlsManifest, decryptPlayback, playbackSources } = require('./mediaParse');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HTML_HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const MAX_HTML = 1024 * 1024;

const HOSTS = {
  byse: /(?:^|\.)byse[a-z0-9-]*\.(?:com|to|net|xyz|site)$/i,
  mixdrop: /(?:^|\.)(?:mixdrop|mxdrop)[a-z0-9-]*\.(?:co|to|top|click|com|ag|bz)$/i,
  streamtape: /(?:^|\.)streamtape\.(?:com|net|to)$/i,
  videohel: /(?:^|\.)(?:vpge\.link|videohel\.[a-z]+)$/i,
};
// Estos tres comparten el mismo `main.js` ofuscado (71 KB) y no publican un
// medio en el HTML: se reconocen para no gastar peticiones en ellos.
const OPAQUE = /(?:^|\.)(?:hglink|hgcloud|streamwish|vidhide|vidhidepro|filelions|voe|powvideo)\.(?:to|com|sx|link|pro|org|net)$/i;

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

/** Qué extractor corresponde a un embed, o `null` si se descarta. */
function extractorFor(url) {
  const host = hostOf(url);
  if (!host) return null;
  if (HOSTS.byse.test(host)) return 'byse';
  if (HOSTS.mixdrop.test(host)) return 'mixdrop';
  if (HOSTS.streamtape.test(host)) return 'streamtape';
  if (HOSTS.videohel.test(host)) return 'videohel';
  if (OPAQUE.test(host)) return 'opaque';
  return null;
}

function sourcesFromHtml(html, page) {
  const text = fromPacker(html) || String(html || '');
  const found = new Map();
  // Mismo filtro conservador que usa el resto del addon (dominio y ruta).
  const allowed = (url) => isDirectMedia(url);
  for (const match of text.matchAll(/(?:file|src|url|hls\d?|source)\s*[:=]\s*["']([^"']{8,600})["']/gi)) {
    const url = normalizeMediaUrl(match[1].replace(/\\\//g, '/'), page);
    const kind = url && mediaKind(url);
    if (url && kind && allowed(url) && !found.has(url)) found.set(url, kind);
    if (found.size >= 4) break;
  }
  if (!found.size) {
    for (const match of text.matchAll(/https?:\/\/[^\s"'\\<>]+?\.(?:m3u8|mp4)[^\s"'\\<>]*/gi)) {
      const url = normalizeMediaUrl(match[0], page);
      const kind = url && mediaKind(url);
      if (url && kind && allowed(url) && !found.has(url)) found.set(url, kind);
      if (found.size >= 4) break;
    }
  }
  const subtitles = [];
  for (const match of text.matchAll(/\{[^{}]{0,600}?"kind"\s*:\s*"(?:captions|subtitles)"[^{}]{0,600}?\}/gi)) {
    const file = /"file"\s*:\s*"([^"]+)"/i.exec(match[0])?.[1];
    const label = /"label"\s*:\s*"([^"]*)"/i.exec(match[0])?.[1] || 'Subtítulos';
    const url = normalizeMediaUrl(file?.replace(/\\\//g, '/'), page);
    if (url && /\.vtt$/i.test(new URL(url).pathname) && !subtitles.some((s) => s.url === url)) {
      subtitles.push({ url, lang: /span|espa|latino|castellano/i.test(label) ? 'es' : 'und', title: label.slice(0, 60) });
    }
    if (subtitles.length >= 6) break;
  }
  return { sources: [...found].map(([url, kind]) => ({ url, kind })), subtitles };
}

// ── Visores ──────────────────────────────────────────────────────────────

async function byse(embed, http) {
  const code = new URL(embed).pathname.split('/').filter(Boolean).pop();
  if (!code || !/^[a-z0-9]{6,40}$/i.test(code)) return { sources: [], reason: 'no-code' };
  const origin = new URL(embed).origin;
  const data = await http.json(`${origin}/api/videos/${encodeURIComponent(code)}`, { headers: HTML_HEADERS, maxBytes: MAX_HTML });
  if (!data || !data.playback) return { sources: [], reason: 'no-playback' };
  const payload = await decryptPlayback(data.playback);
  if (!payload) return { sources: [], reason: 'undecryptable' };
  const sources = playbackSources(payload, embed);
  return { sources, title: String(data.title || ''), reason: sources.length ? null : 'no-source' };
}

async function mixdrop(embed, http) {
  const html = await http.text(embed, { headers: { ...HTML_HEADERS, Referer: new URL(embed).origin + '/' }, maxBytes: MAX_HTML });
  const unpacked = fromPacker(html) || html;
  const sources = [];
  for (const key of ['wurl', 'furl']) {
    const raw = new RegExp(`MDCore\\.${key}\\s*=\\s*["']([^"']+)["']`).exec(unpacked)?.[1];
    const url = normalizeMediaUrl(raw, embed);
    if (url && mediaKind(url)) sources.push({ url, kind: mediaKind(url) });
  }
  return { sources, reason: sources.length ? null : 'no-source' };
}

async function streamtape(embed, http) {
  const html = await http.text(embed, { headers: { ...HTML_HEADERS, Referer: new URL(embed).origin + '/' }, maxBytes: MAX_HTML });
  const robot = /id="robotlink"[^>]*>([^<]*)</i.exec(html)?.[1] || '';
  const id = /\/e\/([a-z0-9]+)/i.exec(new URL(embed).pathname)?.[1] || '';
  const built = robot ? normalizeMediaUrl(`https:${robot}`, embed) : null;
  if (built && mediaKind(built)) return { sources: [{ url: built, kind: mediaKind(built) }] };
  // Segundo paso documentado: /get_video?id=<robot>&dl=1 devuelve el enlace final.
  const token = /[?&]id=([^&]+)/.exec(robot || '')?.[1] || id;
  if (!token) return { sources: [], reason: 'no-robot' };
  const final = await http.text(`${new URL(embed).origin}/get_video?id=${encodeURIComponent(token)}&dl=1`, {
    headers: { ...HTML_HEADERS, Referer: embed }, maxBytes: 64 * 1024,
  }).catch(() => '');
  const url = normalizeMediaUrl(String(final || '').trim(), embed);
  return { sources: url && mediaKind(url) ? [{ url, kind: mediaKind(url) }] : [], reason: 'no-source' };
}

async function videohel(embed, http) {
  const html = await http.text(embed, { headers: { ...HTML_HEADERS, Referer: new URL(embed).origin + '/' }, maxBytes: MAX_HTML });
  const { sources, subtitles } = sourcesFromHtml(html, embed);
  // El reproductor rellena `vurl` desde su propia API; lo que trae el HTML
  // puede ser un ejemplo comentado. Si la URL no está clara, se descarta.
  if (!sources.length) return { sources: [], reason: 'no-source' };
  const usable = sources.filter((source) => {
    const index = html.indexOf(source.url.split('?')[0]);
    if (index < 0) return false;
    const before = html.slice(Math.max(0, index - 400), index);
    return !before.includes('/*') || before.lastIndexOf('*/') > before.lastIndexOf('/*');
  });
  return { sources: usable, subtitles, reason: usable.length ? null : 'commented-out' };
}

const EXTRACTORS = { byse, mixdrop, streamtape, videohel };

/**
 * Extrae fuentes de un embed. Devuelve `{ ok, sources, reason }` y nunca lanza
 * por un fallo del visor: el proveedor decide qué hacer con el motivo.
 */
async function extractEmbed(embed, { provider = 'embed', timeoutMs = config.streamProviderTimeoutMs, referer } = {}) {
  const name = extractorFor(embed);
  if (!name) return { ok: false, sources: [], reason: 'unsupported-host' };
  if (name === 'opaque') return { ok: false, sources: [], reason: 'opaque-player' };
  const http = providerHttp(timeoutMs, 4);
  try {
    const result = await EXTRACTORS[name](embed, http, referer);
    return { ok: result.sources.length > 0, extractor: name, sources: result.sources,
      subtitles: result.subtitles || [], reason: result.reason || null };
  } catch (err) {
    if (stopProvider(err)) throw err;
    return { ok: false, extractor: name, sources: [], reason: err?.timeout ? 'timeout' : 'fetch-error' };
  }
}

/** Comprueba que un HLS responde y devuelve la variante de mayor calidad. */
async function probeHls(url, { timeoutMs = config.streamProviderTimeoutMs, referer } = {}) {
  const http = providerHttp(timeoutMs, 2);
  const text = await http.text(url, { headers: { ...HTML_HEADERS, ...(referer ? { Referer: referer } : {}) }, maxBytes: 256 * 1024 });
  const manifest = parseHlsManifest(text, url);
  if (!manifest) return { ok: false, reason: 'not-hls' };
  if (manifest.type === 'master') {
    return { ok: true, kind: 'hls', resolution: manifest.best?.height ? `${manifest.best.height}p` : null,
      audio: manifest.best?.audio?.map((a) => a.language) || [], variant: manifest.best?.uri || null };
  }
  return { ok: true, kind: 'hls', resolution: null, audio: [], segments: manifest.segments.length };
}

module.exports = { UA, HTML_HEADERS, extractorFor, extractEmbed, sourcesFromHtml, probeHls, EXTRACTORS, HOSTS, OPAQUE };
