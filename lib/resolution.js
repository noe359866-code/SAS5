'use strict';

// Solo metadatos de calidad de la fuente: ni el título ni la URL prueban la resolución.
function resolutionToken(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    const match = /\b(\d{3,4})\s*([pi])\b/i.exec(text) || /^(\d{3,4})$/.exec(text);
    if (match && +match[1] >= 144 && +match[1] <= 8640) return `${+match[1]}${(match[2] || 'p').toLowerCase()}`;
    if (/\b8k\b/i.test(text)) return '4320p';
    if (/\b4k\b/i.test(text)) return '2160p';
    if (/\b(?:full\s*hd|fhd)\b/i.test(text)) return '1080p';
  }
  return '';
}
module.exports = { resolutionToken };
