#!/usr/bin/env node
/**
 * Cadena real de doramas con el código del addon (24-11-2026):
 * ficha → DooPlay AJAX → embed → extractor → manifiesto HLS.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
const { extractEmbed, extractorFor } = require('../lib/extractors');
const { isDirectMedia } = require('../lib/directMedia');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const TIMEOUT = 15_000;

const CONTROLS = [
  { site: 'doramaslat.com', base: 'https://doramaslat.com', detail: '/tvshows/dr-abogado-doramas-latino/', episode: '/episodes/dr-abogado-1x1/' },
  { site: 'seriesbl.net', base: 'https://seriesbl.net', detail: '/series/abo-desire/', episode: '/episode/abo-desire-1x1/' },
];

const rows = [];
const row = (site, step, http, state, detail) => {
  rows.push({ site, step, http, state, detail });
  console.log(`| ${site} | ${step} | ${http} | ${state} | ${detail} |`);
};
const redact = (raw) => {
  try { const u = new URL(String(raw)); return `${u.hostname}${u.pathname.slice(0, 72)}${u.search ? `?(${u.search.length} B)` : ''}`; } catch { return String(raw || '').slice(0, 90); }
};

async function get(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { ...HEADERS, ...(options.headers || {}) }, method: options.method || 'GET', body: options.body });
    return { status: res.status, url: res.url, body: (await res.text()).slice(0, 1_200_000) };
  } catch (err) { return { status: 0, url, body: '', error: err?.name || String(err).slice(0, 40) }; }
  finally { clearTimeout(timer); }
}

function optionsOf(html) {
  const out = [];
  for (const m of html.matchAll(/<li[^>]*dooplay_player_option[^>]*>[\s\S]{0,400}?<\/li>/gi)) {
    const tag = m[0];
    out.push({
      post: /data-post=["']([^"']+)["']/i.exec(tag)?.[1] || '',
      nume: /data-nume=["']([^"']+)["']/i.exec(tag)?.[1] || '',
      type: /data-type=["']([^"']+)["']/i.exec(tag)?.[1] || 'tv',
      label: tag.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 55),
    });
  }
  return out;
}

async function main() {
  fs.mkdirSync('.probe', { recursive: true });
  for (const cfg of CONTROLS) {
    const detail = await get(`${cfg.base}${cfg.detail}`);
    const title = (/<title[^>]*>([^<]+)</i.exec(detail.body) || [])[1]?.replace(/\s*–.*$/, '').trim() || '';
    const year = /\b(19|20)\d{2}\b/.exec(detail.body.replace(/<[^>]+>/g, ' '))?.[0] || '';
    const seasons = [...new Set([...detail.body.matchAll(/\/episodes?\/[a-z0-9-]+?-(\d+)x(\d+)/gi)].map((m) => `${m[1]}x${m[2]}`))];
    row(cfg.site, 'ficha', detail.status, `${detail.body.length} B`, `título="${title}" año=${year || '—'} temporadas/episodios=${seasons.length}`);
    const ep = await get(`${cfg.base}${cfg.episode}`);
    const options = optionsOf(ep.body);
    row(cfg.site, 'episodio', ep.status, `dooplay=${options.length}`, cfg.episode);
    for (const opt of options.slice(0, 3)) {
      const body = new URLSearchParams({ action: 'doo_player_ajax', post: opt.post, nume: opt.nume, type: opt.type }).toString();
      const ajax = await get(`${cfg.base}/wp-admin/admin-ajax.php`, { method: 'POST', body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Referer: ep.url } });
      let embed = '';
      try { embed = JSON.parse(ajax.body)?.embed_url || ''; } catch { /* no JSON */ }
      if (!embed) { row(cfg.site, `opción ${opt.nume}`, ajax.status, 'sin-embed', `etiqueta="${opt.label}"`); continue; }
      const kind = extractorFor(embed);
      row(cfg.site, `opción ${opt.nume}`, ajax.status, kind || 'sin-extractor', `etiqueta="${opt.label}" · ${redact(embed)}`);
      if (!kind || kind === 'opaque') continue;
      const extracted = await extractEmbed(embed, { timeoutMs: 12_000, referer: ep.url }).catch((err) => ({ ok: false, sources: [], reason: String(err?.message || err).slice(0, 40) }));
      if (!extracted.ok) { row(cfg.site, `· visor`, '—', extracted.reason || 'sin-medio', kind); continue; }
      for (const source of extracted.sources.slice(0, 2)) {
        const direct = isDirectMedia(source.url);
        let manifest = 'sin-sondeo';
        if (direct) {
          const res = await get(source.url, { headers: { Accept: 'application/vnd.apple.mpegurl', Referer: embed } });
          manifest = `HTTP ${res.status} ${/^\s*#EXTM3U/.test(res.body) ? 'HLS' : 'otro'}`;
        }
        row(cfg.site, `· medio`, '—', `${kind} ${manifest}`, `${source.kind} · ${direct ? 'directo' : 'no-directo'} · ${redact(source.url)}`);
      }
    }
  }
  const md = ['| Sitio | Paso | HTTP | Resultado | Detalle |', '|---|---|---|---|---|'];
  for (const r of rows) md.push(`| ${r.site} | ${r.step} | ${r.http} | ${r.state} | ${r.detail} |`);
  md.push('', 'Cadena real con extractores del addon; sin segmentos ni URLs firmadas en claro.', '');
  fs.writeFileSync('.probe/dorama-live.md', `${md.join('\n')}\n`);
  console.log(`\n${md.join('\n')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
