'use strict';

/** Lee solo la estructura de HLS, sin descargar ni ejecutar los recursos. */
function parseManifest(text) {
  const lines = String(text || '').trim().split(/\r?\n/).map((line) => line.trim());
  if (lines[0] !== '#EXTM3U') return null;
  const variants = [];
  let segment = null;
  let pending = '';
  for (const line of lines.slice(1)) {
    if (!line) continue;
    if (line.startsWith('#EXT-X-STREAM-INF:') || line.startsWith('#EXTINF:')) pending = line;
    if (line.startsWith('#')) continue;
    if (pending.startsWith('#EXT-X-STREAM-INF:')) {
      const height = /(?:[:,])RESOLUTION=\d+x(\d+)(?:,|$)/i.exec(pending)?.[1];
      variants.push({ uri: line, height: Number(height) || null });
    } else if (pending.startsWith('#EXTINF:') && !segment) segment = line;
    pending = '';
  }
  if (!variants.length && !segment) return null;
  const height = Math.max(0, ...variants.map((variant) => variant.height || 0));
  return { variants, segment, resolution: height ? `${height}p` : null };
}

module.exports = { parseManifest };
