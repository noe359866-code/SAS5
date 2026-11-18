'use strict';

// Comprueba la ruta real del Worker, sin guardar firmas, URLs o segmentos.
// --playback exige HLS y bytes de medio a partir de la URL que recibe Stremio.
const { appendFileSync } = require('node:fs');
const { allowedHosts, hostAllowed } = require('../lib/hlsProxy');
const { parseManifest } = require('../lib/hlsManifest');
const { spinFlixMedia } = require('../lib/vimeosPlayback');

const BASE = 'https://ramdonlatam.noe359866.workers.dev';
const WEB = 'https://web.stremio.com';
const controls = [
  ['Matrix (ID TMDB)', 'movie', 'tmdb:movie:603'],
  ['Breaking Bad T1E1 (ID TMDB)', 'series', 'tmdb:tv:1396:1:1'],
  ['El Origen (ID IMDb)', 'movie', 'tt1375666'],
];

async function read(fetcher, url, accept) {
  const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { Origin: WEB, Accept: accept } });
  let size = 0;
  let body = '';
  const decoder = new TextDecoder();
  for await (const bytes of response.body || []) {
    size += bytes.byteLength;
    if (size > 512 * 1024) throw new Error('Respuesta demasiado grande');
    body += decoder.decode(bytes, { stream: true });
  }
  const cors = response.headers.get('Access-Control-Allow-Origin');
  return { status: response.status, ok: response.ok, cors: cors === '*' || cors === WEB, body: body + decoder.decode() };
}

function proxyUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  try {
    const stream = new URL(raw);
    const local = stream.origin === BASE && stream.pathname === '/hls';
    const url = local ? new URL(stream.searchParams.get('u')) : stream;
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
      || !hostAllowed(url.hostname, allowedHosts()) || !/\.m3u8$/i.test(url.pathname)) return null;
    if (local) return stream.href;
    const proxy = new URL('/hls', BASE);
    proxy.searchParams.set('u', url.href);
    proxy.searchParams.set('ref', 'https://vimeos.net/');
    return proxy.href;
  } catch { return null; }
}

async function checkHls(fetcher, url) {
  try {
    const response = await read(fetcher, url, 'application/vnd.apple.mpegurl');
    if (response.ok) return parseManifest(response.body) ? 'manifiesto válido vía Worker' : 'no es un HLS válido';
    const cdn = /^El CDN respondió ([345]\d{2})\.$/.exec(response.body.trim())?.[1];
    return `proxy HTTP ${response.status}${cdn ? ` (CDN HTTP ${cdn})` : ''}`;
  } catch { return 'proxy sin respuesta comprobable'; }
}

async function audit(fetcher = fetch) {
  const request = (path) => read(fetcher, BASE + path, 'application/json');
  const manifest = await request('/manifest.json');
  const manifestJson = manifest.ok ? JSON.parse(manifest.body) : {};
  const declaresStream = Array.isArray(manifestJson.resources) && manifestJson.resources.includes('stream');
  const rows = [];
  for (const [title, type, id] of controls) {
    const response = await request(`/stream/${type}/${encodeURIComponent(id)}.json`);
    const list = response.ok ? JSON.parse(response.body).streams : null;
    const streams = Array.isArray(list) ? list : null;
    const candidates = [...new Set((streams || []).map((stream) => proxyUrl(stream?.url)).filter(Boolean))].slice(0, 2);
    const hls = await Promise.all(candidates.map((url) => checkHls(fetcher, url)));
    rows.push({ title, status: response.status, cors: response.cors, count: streams?.length ?? null,
      notWebReady: streams?.filter((stream) => stream?.behaviorHints?.notWebReady === true).length ?? null, hls });
  }
  return { declaresStream, manifestStatus: manifest.status, manifestCors: manifest.cors, rows };
}

async function main() {
  const { declaresStream, manifestStatus, manifestCors, rows } = await audit();
  const status = `Manifest HTTP ${manifestStatus}; declara stream=${declaresStream ? 'sí' : 'no'}; CORS=${manifestCors ? 'sí' : 'no'}`;
  console.log(status);
  const report = rows.map(({ title, status, cors, count, notWebReady, hls }) => {
    const result = `stream HTTP ${status}; CORS=${cors ? 'sí' : 'no'}; candidatos=${count ?? '—'}; notWebReady=${notWebReady ?? '—'}; HLS=${hls.join('; ') || 'sin candidato sondeable'}`;
    console.log(process.env.GITHUB_ACTIONS ? `::notice title=Worker / ${title}::${result}` : `${title}: ${result}`);
    return `| ${title} | ${result} |`;
  });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    '### Worker publicado', '', status, '', '| Control | Resultado |', '|---|---|', ...report, '',
    'La sonda del manifiesto no prueba los segmentos, el audio ni el cliente de Stremio. No despliega cambios.', '',
  ].join('\n'));
  // Un CDN bloqueado o una ficha sin medio son resultados diagnósticos, no
  // una caída del endpoint. Sí se falla si la API no devuelve el esquema.
  if (!declaresStream || !manifestCors || rows.some((row) => row.count === null || !row.cors)) process.exitCode = 1;
}

const playbackControls = [
  ['Mufasa: El rey león', 'movie', 'tt13186482'],
  ['Breaking Bad T1E2', 'series', 'tt0903747:1:2'],
];

function workerMedia(raw, parent, origin, ext) {
  if (!raw || raw.length > 8192) return null;
  try {
    const url = new URL(raw, parent);
    if (url.origin !== origin || url.pathname !== '/hls' || url.username || url.password || url.hash
      || url.searchParams.get('via') !== 'spinflix') return null;
    const target = spinFlixMedia(url.searchParams.get('u'));
    return target && ext.test(target.pathname) ? url.href : null;
  } catch { return null; }
}

async function checkSegment(fetcher, url) {
  try {
    const res = await fetcher(url, {
      redirect: 'manual', signal: AbortSignal.timeout(9000), headers: { Origin: WEB, Range: 'bytes=0-4095' },
    });
    const cors = res.headers.get('access-control-allow-origin');
    if (!res.ok || !res.body || !(cors === '*' || cors === WEB)) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, state: `segmento HTTP ${res.status}${res.ok ? ' sin CORS o sin cuerpo' : ''}` };
    }
    const reader = res.body.getReader();
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
    return { ok: ts || mp4, state: `segmento HTTP ${res.status} (${ts ? 'MPEG-TS' : mp4 ? 'MP4' : 'sin cabecera de medio'})` };
  } catch { return { ok: false, state: 'segmento sin respuesta comprobable' }; }
}

async function checkPlayback(fetcher, url, origin) {
  try {
    const manifestExt = /\.m3u8$/i;
    const first = async (media, source) => {
      const response = await read(fetcher, media, 'application/vnd.apple.mpegurl');
      if (!response.ok || !response.cors) return { ok: false, state: `variante HTTP ${response.status}` };
      return checkFirstSegment(response.body, source);
    };
    const checkFirstSegment = (body, source) => {
      const segment = workerMedia(parseManifest(body)?.segment, source, origin, /\.(?:ts|mp4|m4s)$/i);
      return segment ? checkSegment(fetcher, segment) : { ok: false, state: 'sin segmento por el Worker' };
    };
    const response = await read(fetcher, url, 'application/vnd.apple.mpegurl');
    if (!response.ok || !response.cors) return { ok: false, state: `master HTTP ${response.status}` };
    const master = parseManifest(response.body);
    if (!master) return { ok: false, state: 'master inválido' };
    const variant = workerMedia(master.variants[0]?.uri, url, origin, manifestExt);
    const audioLines = response.body.split(/\r?\n/).filter((line) => line.startsWith('#EXT-X-MEDIA:TYPE=AUDIO,') && /,URI=/.test(line));
    const spanishUri = audioLines.find((line) => /,LANGUAGE="es(?:-[a-z]+)?"/i.test(line))?.match(/,URI="([^"]+)"/)?.[1];
    const audio = workerMedia(spanishUri, url, origin, manifestExt);
    const [video, spanish] = await Promise.all([
      variant ? first(variant, variant) : checkFirstSegment(response.body, url),
      audio ? first(audio, audio) : null,
    ]);
    return { ok: video.ok && (!audioLines.length || Boolean(spanish?.ok)),
      state: `HLS HTTP ${response.status}, vídeo ${video.state}${spanish ? `, audio es ${spanish.state}` : audioLines.length ? ', sin audio español por el Worker' : ''}` };
  } catch { return { ok: false, state: 'ruta sin respuesta comprobable' }; }
}

async function auditPlayback(base, fetcher = fetch) {
  const origin = new URL(base).origin;
  return Promise.all(playbackControls.map(async ([title, type, id]) => {
    const response = await read(fetcher, `${origin}/stream/${type}/${encodeURIComponent(id)}.json`, 'application/json');
    const streams = response.ok && response.cors ? JSON.parse(response.body).streams : null;
    const candidates = (Array.isArray(streams) ? streams : [])
      .filter((s) => /Fanpelis|SpinFlix/.test(s.title) && /\b(?:latino|lat|castellano)\b/i.test(s.title))
      .map((s) => workerMedia(s.url, origin, origin, /\.m3u8$/i)).filter(Boolean).slice(0, 2);
    const results = await Promise.all(candidates.map((url) => checkPlayback(fetcher, url, origin)));
    return { title, status: response.status, ok: results.some((row) => row.ok),
      results: results.length ? results.map((row) => row.state) : ['sin HLS de reproducción por el Worker'] };
  }));
}

async function reportPlayback(base) {
  const rows = await auditPlayback(base);
  for (const { title, status, ok, results } of rows) {
    const note = `stream HTTP ${status}; ${results.join('; ')}; medio comprobado=${ok ? 'sí' : 'no'}`;
    console.log(process.env.GITHUB_ACTIONS ? `::notice title=Reproducción / ${title.replace(':', '%3A')}::${note}` : `${title}: ${note}`);
  }
  if (rows.some((row) => !row.ok)) process.exitCode = 1;
}

if (require.main === module) (process.argv[2] === '--playback' ? reportPlayback(process.argv[3] || BASE) : main()).catch(() => {
  console.error('No se pudo completar la comprobación de reproducción');
  process.exitCode = 1;
});
module.exports = { audit, auditPlayback };
