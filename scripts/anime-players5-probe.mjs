#!/usr/bin/env node
/**
 * Tercera sonda de anime (24-11-2026): cadena Dooplay completa en los sitios
 * que sí sirven la sección de servidores a un cliente de servidor.
 *
 *   ficha/episodio → <li data-post data-nume> → admin-ajax.php → embed
 *
 * También mira los datos de reproductor que publican otakustv2, animeflv.one y
 * henaojara en su HTML, sin ejecutar JavaScript. Solo HTML/JSON público; no se
 * descargan segmentos de vídeo.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractorFor } = require('../lib/extractors');
const { resolveVimeosEmbed } = require('../lib/vimeos');
const { providerHttp } = require('../lib/providerHttp');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const TIMEOUT = 12_000;

const rows = [];
const row = (site, step, http, state, detail) => {
  rows.push({ site, step, http, state, detail });
  console.log(`| ${site} | ${step} | ${http} | ${state} | ${detail} |`);
};
const hostOf = (raw) => { try { return new URL(raw).hostname; } catch { return '?'; } };
const redact = (raw) => {
  try {
    const u = new URL(raw);
    return `${u.hostname}${u.pathname}${u.search ? '?…' : ''}`;
  } catch { return String(raw || '').slice(0, 80); }
};

async function get(url, { headers = {}, method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { method, body, redirect: 'follow', signal: controller.signal,
      headers: { ...HEADERS, ...headers } });
    return { status: res.status, body: (await res.text()).slice(0, 900 * 1024), type: (res.headers.get('content-type') || '').split(';')[0] };
  } catch (err) {
    return { status: 0, body: '', type: '', error: err?.name || String(err).slice(0, 40) };
  } finally { clearTimeout(timer); }
}

function links(html, page, pattern) {
  const out = [];
  for (const m of String(html).matchAll(/href=["']([^"']+)["']/gi)) {
    let url;
    try { url = new URL(String(m[1]).replace(/&amp;/g, '&'), page).href; } catch { continue; }
    if (!pattern.test(url) || out.includes(url)) continue;
    out.push(url);
  }
  return out;
}

/** Dooplay: `<li data-post data-nume data-type>` (el tipo puede cambiar). */
function ajaxPlayers(html) {
  const out = [];
  const seen = new Set();
  for (const tag of String(html).matchAll(/<(?:li|a|button)\b[^>]*data-post\s*=\s*["'](\d+)["'][^>]*>/gi)) {
    const post = tag[1];
    const nume = /\bdata-nume\s*=\s*["'](\d+)["']/i.exec(tag[0])?.[1] || '1';
    const type = /\bdata-type\s*=\s*["']([\w-]+)["']/i.exec(tag[0])?.[1] || '';
    const key = `${post}:${nume}:${type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ post, nume, type });
  }
  return out;
}

const classify = (url) => {
  const kind = extractorFor(url);
  if (kind === 'opaque') return 'opaco';
  if (kind) return `extraíble(${kind})`;
  if (/vimeos\./.test(hostOf(url))) return 'vimeos';
  return 'sin-extractor';
};

async function inspectEmbed(site, label, embed, referer) {
  if (!embed || !/^https?:/.test(embed)) return;
  const res = await get(embed, { headers: { Referer: referer } });
  const media = [...new Set([...res.body.matchAll(/https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/gi)].map((m) => m[0]))];
  const frames = [...new Set([...res.body.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]))];
  row(site, `embed ${label}`, res.status,
    media.length ? 'MEDIO-DIRECTO' : frames.length ? 'iframe' : (res.error || 'sin-medio'),
    `${classify(embed)} · host=${hostOf(embed)} · media=${media.length} (${[...new Set(media.map(hostOf))].slice(0, 3).join(',')}) · iframes=${frames.length} (${[...new Set(frames.map(hostOf))].slice(0, 3).join(',')})`);
  if (/vimeos\./.test(hostOf(embed))) {
    const media2 = await resolveVimeosEmbed(embed, referer, providerHttp(15_000, 4)).catch(() => null);
    if (media2) row(site, `vimeos ${label}`, '—', 'HLS', hostOf(media2.master));
  }
}

async function dooplay(site, base, pagePath) {
  const page = `${base}${pagePath}`;
  const res = await get(page, { headers: { Referer: `${base}/` } });
  const players = ajaxPlayers(res.body);
  row(site, 'episodio', res.status, players.length ? 'con-servidores' : 'sin-servidores',
    `servidores=${players.length} · ${players.slice(0, 5).map((p) => `${p.post}/${p.nume}/${p.type || 'movie'}`).join(' ')} · ${redact(page)}`);
  if (!players.length) return;

  const api = new URL('/wp-admin/admin-ajax.php', base).href;
  for (const player of players.slice(0, 4)) {
    const body = new URLSearchParams({ action: 'doo_player_ajax', post: player.post, nume: player.nume, type: player.type || 'movie' }).toString();
    const ajax = await get(api, { method: 'POST', body, headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest', Referer: page, Origin: new URL(base).origin,
    } });
    let embed = '';
    try { embed = JSON.parse(ajax.body)?.embed_url || ''; } catch { /* respuesta no JSON */ }
    row(site, `ajax ${player.nume}`, ajax.status, embed ? 'OK' : (ajax.error || 'sin-embed'),
      embed ? `${classify(embed)} · ${redact(embed)}` : ajax.body.slice(0, 90).replace(/\s+/g, ' '));
    if (embed) await inspectEmbed(site, player.nume, embed, page);
  }
}

async function generic(site, base, searchPath, pattern) {
  const search = await get(`${base}${searchPath}`, { headers: { Referer: `${base}/` } });
  const found = links(search.body, `${base}${searchPath}`, pattern);
  row(site, 'buscador', search.status, found.length ? 'OK' : (search.error || 'sin-fichas'),
    `${found.length} enlaces · ${found.slice(0, 3).map(redact).join(' ')}`);
  if (!found.length) return;
  const detail = await get(found[0], { headers: { Referer: `${base}/` } });
  const players = ajaxPlayers(detail.body);
  const dataAttrs = [...new Set([...detail.body.matchAll(/(?:data-(?:src|video|player|url|file|embed|post|nume)\s*=\s*["'][^"']{1,120}["'])/gi)].map((m) => m[1]))];
  const frames = [...new Set([...detail.body.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]))];
  row(site, 'ficha', detail.status, players.length || frames.length ? 'con-servidores' : 'sin-servidores',
    `ajax=${players.length} · iframe=${frames.length} · ${dataAttrs.slice(0, 8).join(' ').slice(0, 180)}`);
  const episode = links(detail.body, found[0], /\/ver\/|\/episodio\/|\/anime\/[^/]+\/\d+/i)[0];
  if (episode) {
    const ep = await get(episode, { headers: { Referer: found[0] } });
    const epPlayers = ajaxPlayers(ep.body);
    row(site, 'episodio', ep.status, epPlayers.length ? 'con-servidores' : 'sin-servidores',
      `ajax=${epPlayers.length} · ${epPlayers.slice(0, 4).map((p) => `${p.post}/${p.nume}`).join(' ')} · ${redact(episode)}`);
    for (const player of epPlayers.slice(0, 2)) {
      const body = new URLSearchParams({ action: 'doo_player_ajax', post: player.post, nume: player.nume, type: player.type || 'movie' }).toString();
      const ajax = await get(new URL('/wp-admin/admin-ajax.php', base).href, { method: 'POST', body, headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Referer: episode,
      } });
      let embed = '';
      try { embed = JSON.parse(ajax.body)?.embed_url || ''; } catch { /* no JSON */ }
      row(site, `ajax ${player.nume}`, ajax.status, embed ? 'OK' : 'sin-embed', embed ? `${classify(embed)} · ${redact(embed)}` : ajax.body.slice(0, 70).replace(/\s+/g, ' '));
      if (embed) await inspectEmbed(site, player.nume, embed, episode);
    }
  }
}

async function main() {
  const fs = await import('node:fs');
  fs.mkdirSync('.probe', { recursive: true });
  const steps = [
    ['animeonline.ninja', () => dooplay('animeonline.ninja', 'https://ww4.animeonline.ninja', '/episodio/one-piece-cap-1/')],
    ['otakustv2.com', () => generic('otakustv2.com', 'https://otakustv2.com', '/?s=one+piece', /otakustv2\.com\/anime\/[a-z0-9-]+/i)],
    ['animeflv.one', () => generic('animeflv.one', 'https://vww.animeflv.one', '/?s=one+piece', /animeflv\.one\/(?:animes?|ver)\/[a-z0-9-]+/i)],
    ['henaojara.net', () => generic('henaojara.net', 'https://ww1.henaojara.net', '/animes?genero=latino&tipo=anime&orden=desc&pag=1', /henaojara\.net\/anime\/[a-z0-9-]+/i)],
  ];
  for (const [site, fn] of steps) {
    try { await fn(); }
    catch (err) { row(site, 'error', '—', 'error', String(err?.message || err).slice(0, 120)); }
  }
  const md = ['| Sitio | Paso | HTTP | Resultado | Detalle |', '|---|---|---|---|---|'];
  for (const r of rows) md.push(`| ${r.site} | ${r.step} | ${r.http} | ${r.state} | ${r.detail} |`);
  md.push('', 'Tercera sonda de anime: ficha → Dooplay AJAX → embed, sin segmentos de vídeo.');
  fs.writeFileSync('.probe/anime-players5.md', `${md.join('\n')}\n`);
  console.log(`\n${md.join('\n')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
