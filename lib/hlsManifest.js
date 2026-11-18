'use strict';

function isMediaReference(raw) {
  if (!raw || /^[?#]/.test(raw) || /[\s\x00-\x1f<>"'\\]/.test(raw)) return false;
  try {
    const url = new URL(raw, 'https://playlist.invalid/');
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

/** Comprueba la estructura básica, sin pedir variantes, claves ni segmentos. */
function parseManifest(text, allowReference = () => true) {
  const lines = String(text || '').trim().split(/\r?\n/).map((line) => line.trim());
  if (lines[0] !== '#EXTM3U') return null;
  const variants = [];
  let segment = null;
  let pending;
  let maxHeight = 0;
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const variant = /^#EXT-X-STREAM-INF:(.+)$/.exec(line);
    const media = /^#EXTINF:(\d+(?:\.\d+)?),/.test(line);
    if (variant || media) {
      if (pending || (variant ? segment : variants.length)) return null;
      pending = variant ? { attributes: variant[1] } : {};
      continue;
    }
    if (line.startsWith('#EXT-X-STREAM-INF:') || line.startsWith('#EXTINF:')) return null;
    if (line.startsWith('#')) continue;
    if (!pending || !isMediaReference(line) || !allowReference(line)) return null;
    if (pending.attributes) {
      const rawHeight = /(?:^|,)RESOLUTION=\d+x(\d+)(?:,|$)/i.exec(pending.attributes)?.[1];
      const height = Number(rawHeight);
      const validHeight = Number.isSafeInteger(height) && height > 0 ? height : null;
      variants.push({ uri: line, height: validHeight });
      maxHeight = Math.max(maxHeight, validHeight || 0);
    } else {
      segment ||= line;
    }
    pending = null;
  }
  if (pending || (!variants.length && !segment)) return null;
  return { variants, segment, resolution: maxHeight ? `${maxHeight}p` : null };
}

module.exports = { parseManifest };
