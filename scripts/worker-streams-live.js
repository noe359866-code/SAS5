'use strict';

// Lee únicamente el Worker de producción. Las playlists se comprueban vía
// su /hls existente, sin descargar segmentos ni imprimir firmas o URLs CDN.
const { appendFileSync } = require('node:fs');
const { allowedHosts, hostAllowed } = require('../lib/hlsProxy');
const { parseManifest } = require('../lib/hlsManifest');

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
    let url = new URL(raw);
    if (url.origin === BASE && url.pathname === '/hls') url = new URL(url.searchParams.get('u'));
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
      || !hostAllowed(url.hostname, allowedHosts()) || !/\.m3u8$/i.test(url.pathname)) return null;
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

// Verificación de la ruta de reproducción del proveedor que ya usaba el
// addon: comparar el mismo segmento desde el CDN y desde el proxy de SpinFlix.
const SPINFLIX_PROXY = 'https://spinoff.link/pelis/proxy.php';
const playbackControls = [
  ['Mufasa: El rey león', 'movie', 'tt13186482'],
  ['Breaking Bad T1E2', 'series', 'tt0903747:1:2'],
];

function cdnUrl(raw, parent, ext) {
  if (!raw || raw.length > 4096) return null;
  try {
    let url = new URL(raw, parent);
    if (`${url.origin}${url.pathname}` === SPINFLIX_PROXY && url.searchParams.has('url')) url = new URL(url.searchParams.get('url'));
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash
      && hostAllowed(url.hostname, allowedHosts()) && ext.test(url.pathname) ? url : null;
  } catch { return null; }
}

function spinflixProxy(url) {
  const proxy = new URL(SPINFLIX_PROXY);
  proxy.searchParams.set('url', url.href);
  proxy.searchParams.set('ref', `${url.origin}/`);
  return proxy.href;
}

async function segmentStatus(url, referer) {
  try {
    const res = await fetch(url, {
      redirect: 'manual', signal: AbortSignal.timeout(4500),
      headers: { Origin: WEB, Referer: referer, Range: 'bytes=0-4095' },
    });
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {});
      return `HTTP ${res.status}`;
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
    return `HTTP ${res.status} ${ts ? 'MPEG-TS' : mp4 ? 'MP4' : 'sin cabecera de vídeo/sonido'} (CORS ${res.headers.get('access-control-allow-origin') === '*' ? 'sí' : 'no *'})`;
  } catch { return 'sin respuesta comprobable'; }
}

async function compareSpinFlix() {
  const manifestExt = /\.m3u8$/i;
  const playlist = (url) => read(fetch, spinflixProxy(url), 'application/vnd.apple.mpegurl');
  const firstSegment = async (variant) => {
    if (!variant) return 'playlist ausente';
    const response = await playlist(variant);
    if (!response.ok) return `playlist HTTP ${response.status}`;
    const segment = cdnUrl(parseManifest(response.body)?.segment, variant, /\.(?:ts|mp4|m4s)$/i);
    if (!segment) return 'playlist sin segmento';
    const [direct, proxy] = await Promise.all([
      segmentStatus(segment.href, 'https://vimeos.net/'), segmentStatus(spinflixProxy(segment), 'https://spinoff.link/pelis/'),
    ]);
    return `directo=${direct}; SpinFlix=${proxy}`;
  };
  for (const [title, type, id] of playbackControls) {
    const result = await read(fetch, `${BASE}/stream/${type}/${encodeURIComponent(id)}.json`, 'application/json');
    const candidates = (result.ok ? JSON.parse(result.body).streams : []).filter((stream) => /Fanpelis|SpinFlix/.test(stream.title)).slice(0, 2);
    const notes = await Promise.all(candidates.map(async (stream) => {
      const source = stream.title.includes('SpinFlix') ? 'SpinFlix' : 'Fanpelis';
      const url = cdnUrl(stream.url, BASE, manifestExt);
      if (!url) return `${source}: sin HLS de Vimeos`;
      try {
        const response = await playlist(url);
        if (!response.ok) return `${source}: master HTTP ${response.status}`;
        const master = parseManifest(response.body);
        if (!master) return `${source}: master inválido`;
        const variant = cdnUrl(master.variants[0]?.uri, url, manifestExt) || (master.segment && url);
        const audioUri = response.body.split(/\r?\n/).find((line) => line.startsWith('#EXT-X-MEDIA:TYPE=AUDIO,')
          && /,LANGUAGE="es(?:-[a-z]+)?"/i.test(line))?.match(/,URI="([^"]+)"/)?.[1];
        const audio = cdnUrl(audioUri, url, manifestExt);
        const [video, spanish] = await Promise.all([firstSegment(variant), audio ? firstSegment(audio) : null]);
        return `${source}: master HTTP ${response.status}, vídeo ${video}${spanish ? `, audio es ${spanish}` : ''}`;
      } catch { return `${source}: sin respuesta comprobable`; }
    }));
    for (const note of notes.length ? notes : ['sin candidatos']) console.log(`::notice title=Ruta SpinFlix / ${title.replace(':', '%3A')}::${note}`);
  }
}

if (require.main === module) (process.argv.includes('--spinflix') ? compareSpinFlix() : main()).catch(() => {
  console.error('No se pudo completar la comprobación de reproducción');
  process.exitCode = 1;
});
module.exports = { audit };
