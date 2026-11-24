#!/usr/bin/env node
/** Estructura de ficha y episodio de OtakusTV para el adaptador (24-11-2026). */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BASE = 'https://otakustv2.com';
const out = [];

async function get(path) {
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'es-MX,es;q=0.9' }, signal: AbortSignal.timeout(15_000) });
    return { status: res.status, body: await res.text() };
  } catch (err) { return { status: 0, body: '', error: String(err?.message || err) }; }
}

function snippets(body, pattern, limit, size = 500) {
  const clean = body.replace(/\s+/g, ' ');
  const found = [];
  for (const m of clean.matchAll(pattern)) {
    if (found.length >= limit) break;
    found.push(clean.slice(Math.max(0, m.index - 120), m.index + size));
  }
  return found;
}

async function main() {
  for (const path of ['/anime/one-piece', '/ver/one-piece-1180', '/animes?genero=espanol-latino&tipo=serie&orden=desc&pag=1']) {
    const res = await get(path);
    out.push(`=== ${path} HTTP ${res.status} (${res.body.length} B) ${res.error || ''}`);
    out.push(`TITLE ${(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(res.body) || [])[1]?.trim() || ''}`);
    for (const tag of ['h1', 'h2', 'h3']) {
      for (const text of snippets(res.body, new RegExp(`<${tag}[^>]*>`, 'gi'), 2)) out.push(`${tag.toUpperCase()} ${text.slice(0, 600)}`);
    }
    for (const [name, pattern] of [
      ['ESTRENO', /Estreno/gi], ['EPISODIOS', /episodios/gi], ['DATA-DWN', /data-dwn=/gi],
      ['OPT', /class="opt"/gi], ['AUDIO', /Audio:/gi], ['YEAR', /20\d{2}/g],
    ]) {
      for (const text of snippets(res.body, pattern, 2)) out.push(`${name} ${text.slice(0, 620)}`);
    }
    const links = [...new Set([...res.body.matchAll(/href=["']([^"']*(?:\/ver\/|\/anime\/)[^"']*)["']/gi)].map((m) => m[1]))];
    out.push(`LINKS ${links.length} ${links.slice(0, 6).join(' ')}`);
  }
  const fs = await import('node:fs');
  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/otakustv-structure.md', `${out.join('\n')}\n`);
  console.log(out.join('\n'));
}

main().catch((err) => { console.error(err); process.exit(1); });
