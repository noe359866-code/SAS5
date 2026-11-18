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

if (require.main === module) main().catch(() => { console.error('No se pudo completar la sonda del Worker publicado'); process.exitCode = 1; });
module.exports = { audit };
