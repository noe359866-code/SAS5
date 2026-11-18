'use strict';

// La API se consulta en el addon. El HLS y los primeros bytes se piden al CDN,
// sin seguir redirecciones ni guardar URLs, firmas o segmentos.
const { appendFileSync } = require('node:fs');
const { parseManifest } = require('../lib/hlsManifest');
const { allowedVideoUrl } = require('../lib/vimeos');

const BASE = 'https://ramdonlatam.noe359866.workers.dev';
const WEB = 'https://web.stremio.com';
const HLS = 'application/vnd.apple.mpegurl';
const HLS_EXT = /\.m3u8$/i;
const SEGMENT_EXT = /\.(?:ts|m4s|mp4)$/i;
const controls = [
  ['Matrix (ID TMDB)', 'movie', 'tmdb:movie:603'],
  ['Breaking Bad T1E1 (ID TMDB)', 'series', 'tmdb:tv:1396:1:1'],
  ['El Origen (ID IMDb)', 'movie', 'tt1375666'],
];
const playbackControls = [
  ['Mufasa: El rey león', 'movie', 'tt13186482'],
  ['Breaking Bad T1E2', 'series', 'tt0903747:1:2'],
];

function hasCors(response) {
  const cors = response.headers.get('Access-Control-Allow-Origin');
  return cors === '*' || cors === WEB;
}

async function read(fetcher, url, accept) {
  const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { Origin: WEB, Accept: accept } });
  const result = { status: response.status, ok: response.ok, cors: hasCors(response), body: '' };
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return result;
  }
  let size = 0;
  const decoder = new TextDecoder();
  for await (const bytes of response.body || []) {
    size += bytes.byteLength;
    if (size > 512 * 1024) throw new Error('Respuesta demasiado grande');
    result.body += decoder.decode(bytes, { stream: true });
  }
  result.body += decoder.decode();
  return result;
}

function decodeJson(response) {
  try { return response.ok ? JSON.parse(response.body) : null; } catch { return null; }
}

function directUrl(raw, origin, ext, parent) {
  if (typeof raw !== 'string' || !raw || raw.length > 8192) return null;
  try {
    const url = new URL(raw, parent);
    return url.origin !== origin && allowedVideoUrl(url.href) && ext.test(url.pathname) ? url.href : null;
  } catch { return null; }
}

function usesRelay(stream, origin) {
  // Las respuestas de una versión aún publicada o en caché pueden apuntar al
  // addon o pedir un proxy al cliente de Stremio. Contarlas, sin abrirlas.
  if (stream?.behaviorHints?.proxyHeaders != null) return true;
  if (typeof stream?.url !== 'string' || !stream.url) return false;
  try { return new URL(stream.url, origin).origin === origin; } catch { return false; }
}

async function listStreams(fetcher, origin, type, id) {
  const response = await read(fetcher, `${origin}/stream/${type}/${encodeURIComponent(id)}.json`, 'application/json');
  const streams = decodeJson(response)?.streams;
  const list = Array.isArray(streams) ? streams : null;
  const direct = (list || []).filter((stream) => !usesRelay(stream, origin));
  return { list, direct, relayed: (list?.length || 0) - direct.length, status: response.status, cors: response.cors };
}

const yesNo = (value) => value ? 'sí' : 'no';
const corsState = (value) => `CORS=${yesNo(value)}`;

async function checkHls(fetcher, url) {
  try {
    const response = await read(fetcher, url, HLS);
    if (!response.ok) return `CDN HTTP ${response.status}`;
    return `HLS directo HTTP ${response.status} ${parseManifest(response.body) ? 'válido' : 'inválido'} (${corsState(response.cors)})`;
  } catch { return 'CDN sin respuesta comprobable'; }
}

async function audit(fetcher = fetch) {
  const manifest = await read(fetcher, `${BASE}/manifest.json`, 'application/json');
  const resources = decodeJson(manifest)?.resources;
  const declaresStream = Array.isArray(resources) && resources.includes('stream');
  const rows = [];
  for (const [title, type, id] of controls) {
    const { list, direct, relayed, status, cors } = await listStreams(fetcher, BASE, type, id);
    const candidates = [...new Set(direct.map((stream) => directUrl(stream?.url, BASE, HLS_EXT)).filter(Boolean))].slice(0, 2);
    const hls = await Promise.all(candidates.map((url) => checkHls(fetcher, url)));
    rows.push({ title, status, cors, count: list?.length ?? null, relayed,
      notWebReady: list?.filter((stream) => stream?.behaviorHints?.notWebReady === true).length ?? null, hls });
  }
  return { declaresStream, manifestStatus: manifest.status, manifestCors: manifest.cors, rows };
}

function log(title, result) {
  console.log(process.env.GITHUB_ACTIONS ? `::notice title=${title.replace(/:/g, '%3A')}::${result}` : `${title}: ${result}`);
}

async function main() {
  const { declaresStream, manifestStatus, manifestCors, rows } = await audit();
  const status = `Manifest HTTP ${manifestStatus}; declara stream=${yesNo(declaresStream)}; ${corsState(manifestCors)}`;
  console.log(status);
  const report = rows.map(({ title, status, cors, count, relayed, notWebReady, hls }) => {
    const result = `stream HTTP ${status}; ${corsState(cors)}; candidatos=${count ?? '—'}; notWebReady=${notWebReady ?? '—'}; con proxy (omitidos)=${relayed}; HLS=${hls.join('; ') || 'sin candidato directo sondeable'}`;
    log(`Worker / ${title}`, result);
    return `| ${title} | ${result} |`;
  });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    '### Worker publicado', '', status, '', '| Control | Resultado |', '|---|---|', ...report, '',
    'Se consulta el CDN directamente. Un manifiesto válido no prueba segmentos, audio ni reproducción en Stremio.', '',
  ].join('\n'));
  // El resultado del CDN no convierte el HTTP 200 de la API en un fallo.
  if (!declaresStream || !manifestCors || rows.some((row) => row.count === null || !row.cors)) process.exitCode = 1;
}

async function checkSegment(fetcher, url) {
  try {
    const response = await fetcher(url, {
      redirect: 'manual', signal: AbortSignal.timeout(9000), headers: { Origin: WEB, Range: 'bytes=0-4095' },
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      return { ok: false, state: `segmento HTTP ${response.status}${response.ok ? ' sin cuerpo' : ''}` };
    }
    const reader = response.body.getReader();
    const head = Buffer.alloc(384);
    let count = 0;
    try {
      while (count < head.length) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = value.subarray(0, head.length - count);
        head.set(chunk, count);
        count += chunk.length;
      }
    } finally { await reader.cancel().catch(() => {}); }
    const ts = count > 376 && [0, 188, 376].every((offset) => head[offset] === 0x47);
    const mp4 = count > 8 && /^(?:ftyp|styp|moof)$/.test(head.toString('ascii', 4, 8));
    return { ok: ts || mp4, state: `segmento HTTP ${response.status} (${ts ? 'MPEG-TS' : mp4 ? 'MP4' : 'sin cabecera de medio'}; ${corsState(hasCors(response))})` };
  } catch { return { ok: false, state: 'segmento sin respuesta comprobable' }; }
}

async function checkPlayback(fetcher, url, origin) {
  const firstSegment = (manifest, parent) => {
    const segment = directUrl(manifest?.segment, origin, SEGMENT_EXT, parent);
    return segment ? checkSegment(fetcher, segment) : { ok: false, state: 'sin segmento directo sondeable' };
  };
  const firstFromPlaylist = async (uri) => {
    const playlist = directUrl(uri, origin, HLS_EXT, url);
    if (!playlist) return { ok: false, state: 'variante no sondeable' };
    try {
      const response = await read(fetcher, playlist, HLS);
      if (!response.ok) return { ok: false, state: `variante CDN HTTP ${response.status}` };
      const state = `variante HTTP ${response.status} (${corsState(response.cors)})`;
      const segment = await firstSegment(parseManifest(response.body), playlist);
      return { ok: segment.ok, state: `${state}, ${segment.state}` };
    } catch { return { ok: false, state: 'variante sin respuesta comprobable' }; }
  };
  try {
    const response = await read(fetcher, url, HLS);
    if (!response.ok) return { ok: false, state: `manifiesto CDN HTTP ${response.status}` };
    const master = parseManifest(response.body);
    const state = `HLS directo HTTP ${response.status} (${corsState(response.cors)})`;
    if (!master) return { ok: false, state: `${state} inválido` };
    const audioLines = response.body.split(/\r?\n/).map((line) => line.trim())
      .filter((line) => line.startsWith('#EXT-X-MEDIA:') && /[:,]TYPE=AUDIO,/.test(line) && /,URI=/.test(line));
    const spanishUri = audioLines.find((line) => /,LANGUAGE="es(?:-[a-z0-9]+)*"/i.test(line))?.match(/,URI="([^"]+)"/)?.[1];
    const [video, spanish] = await Promise.all([
      master.variants.length ? firstFromPlaylist(master.variants[0].uri) : firstSegment(master, url),
      spanishUri ? firstFromPlaylist(spanishUri) : null,
    ]);
    return { ok: video.ok && (!audioLines.length || Boolean(spanish?.ok)),
      state: `${state}, vídeo ${video.state}${spanish ? `, audio es ${spanish.state}` : audioLines.length ? ', sin pista es separada sondeable' : ', sin pista separada que comprobar'}` };
  } catch { return { ok: false, state: 'manifiesto CDN sin respuesta comprobable' }; }
}

async function auditPlayback(base, fetcher = fetch) {
  const origin = new URL(base).origin;
  return Promise.all(playbackControls.map(async ([title, type, id]) => {
    const { list, direct, relayed, status, cors } = await listStreams(fetcher, origin, type, id);
    const candidates = direct.flatMap((stream) => {
      const label = typeof stream?.title === 'string' ? stream.title : '';
      const provider = /\b(Fanpelis|SpinFlix)\b/.exec(label)?.[1];
      if (!provider || !/\b(?:latino|lat|castellano)\b/i.test(label)) return [];
      const url = directUrl(stream.url, origin, HLS_EXT);
      return url ? [{ provider, url }] : [];
    });
    // Solo un medio de cada fuente por título, desde el enlace real de /stream.
    const selected = ['Fanpelis', 'SpinFlix'].map((key) => candidates.find(({ provider }) => provider === key)).filter(Boolean);
    const results = await Promise.all(selected.map(async ({ provider, url }) => ({ provider, ...await checkPlayback(fetcher, url, origin) })));
    return { title, status, cors, count: list?.length ?? null, relayed, ok: results.some((row) => row.ok),
      results: results.length ? results.map((row) => `${row.provider}: ${row.state}`) : ['sin HLS directo sondeable de Fanpelis o SpinFlix'] };
  }));
}

async function reportPlayback(base, args) {
  const rows = await auditPlayback(base);
  const report = rows.map(({ title, status, cors, count, relayed, ok, results }) => {
    const note = `stream HTTP ${status}; ${corsState(cors)}; candidatos=${count ?? '—'}; con proxy (omitidos)=${relayed}; ${results.join('; ')}; primeros bytes comprobados=${yesNo(ok)}`;
    log(`CDN directo / ${title}`, note);
    return `| ${title} | ${note} |`;
  });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    '### Manifiestos y primeros segmentos desde el CDN', '', '| Control | Resultado |', '|---|---|', ...report, '',
    'Se comprueban cabeceras de medio en el primer segmento, no todas las variantes, claves, audio integrado ni reproducción en Stremio.', '',
  ].join('\n'));
  if (rows.some((row) => row.count === null || !row.cors || (args.includes('--expect-direct') && row.relayed)
    || (args.includes('--require-media') && !row.ok))) process.exitCode = 1;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const base = args.find((arg) => !arg.startsWith('--')) || BASE;
  (args.includes('--playback') ? reportPlayback(base, args) : main()).catch(() => {
    console.error('No se pudo completar la comprobación de la API y el CDN');
    process.exitCode = 1;
  });
}
module.exports = { audit, auditPlayback };
