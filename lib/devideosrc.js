'use strict';
// Experimental: el servicio comparte el contrato shell/resolve de PlayLatin.
// Se exponen únicamente archivos de vídeo, nunca páginas HTML de host.
const config = require('./config');
const { fetchText, fetchJson } = require('./http');
const { pagePath, parseShell } = require('./playlatin');
const BASE = 'https://devideosrc.co';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; CatalogosPlus/1.5)', Accept: 'text/html,application/json,*/*' };
function directSources(data) {
  return (Array.isArray(data && data.sources) ? data.sources : []).filter(s => {
    try {
      const u = new URL(s.url);
      return u.protocol === 'https:' && !u.username && !u.password && ['hls', 'mp4'].includes(String(s.kind || '').toLowerCase());
    } catch { return false; }
  }).slice(0, 4);
}
async function searchDeVideoSrc(_q, resolved, queryTitle, timeoutMs = config.streamProviderTimeoutMs) {
  if (config.devideosrcEnabled === false) return { skipped: 'desactivado por DEVIDEOSRC=off' };
  if (queryTitle && resolved && queryTitle !== resolved.title) return { skipped: 'ya buscado por IMDb' };
  const path = pagePath(resolved);
  if (!path) return { skipped: 'sin IMDb o episodio válido' };
  const shell = parseShell(await fetchText(BASE + path, { timeoutMs, headers: HEADERS }));
  if (!shell.ok) return { hits: [], query: `devideosrc ${resolved.imdbId}` };
  const data = await fetchJson(BASE + '/api/resolve', {
    method: 'POST', timeoutMs, headers: { ...HEADERS, Accept: 'application/json', 'Content-Type': 'application/json', Referer: BASE + path },
    body: JSON.stringify({ type: shell.type || (resolved.mediaType === 'movie' ? 'movie' : 'series'), id: shell.id, season: shell.season || '', episode: shell.episode || '', mode: shell.mode, token: shell.token }),
  });
  return { query: `devideosrc ${resolved.imdbId}`, hits: data?.ok ? directSources(data).map(s => ({ provider: 'devideosrc', title: `${resolved.title || ''} DeVideoSRC`.trim(), url: s.url, referer: BASE + '/', seeders: 0, peers: 0, size: 0, relevant: true })) : [] };
}
module.exports = { searchDeVideoSrc, directSources };
