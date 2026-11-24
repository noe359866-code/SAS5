#!/usr/bin/env node
/** Contexto crudo (sin tokens) del HTML de un episodio de OtakusTV. */
const url = 'https://otakustv2.com/ver/one-piece-1180';
const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
const html = await res.text();
const decoded = html.replace(/&quot;/g, '"').replace(/\\\//g, '/').replace(/&amp;/g, '&');
const rows = [];
for (const m of decoded.matchAll(/byse/gi)) {
  rows.push(decoded.slice(Math.max(0, m.index - 420), m.index + 420).replace(/\s+/g, ' '));
  if (rows.length >= 3) break;
}
const attrs = [];
for (const m of decoded.matchAll(/\bdata-[a-z-]+\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) {
  try {
    const u = new URL(m[1]);
    attrs.push(`${m[0].split('=')[0]}=${u.hostname}${u.pathname}`);
  } catch { /* descartar */ }
}
console.log('HTTP', res.status, 'bytes', html.length);
console.log('ATTRS', [...new Set(attrs)].slice(0, 12).join(' | '));
for (const row of rows) console.log('CONTEXT', row.slice(0, 800));
