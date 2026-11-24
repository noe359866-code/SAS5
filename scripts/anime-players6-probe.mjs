#!/usr/bin/env node
/**
 * Anatomía del visor de `saidochesto.top`, el que sirve AnimeOnline.Ninja el
 * 24-11-2026. La sonda anterior encontró URLs `.mp4` literales en su HTML;
 * aquí se comprueba si el addon las aceptaría (`isDirectMedia`), qué audio
 * declara cada grupo y si el CDN responde, sin imprimir URLs firmadas.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isDirectMedia } = require('../lib/directMedia');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const TIMEOUT = 12_000;

const rows = [];
const row = (step, http, state, detail) => {
  rows.push({ step, http, state, detail });
  console.log(`| ${step} | ${http} | ${state} | ${detail} |`);
};
const hostOf = (raw) => { try { return new URL(raw).hostname; } catch { return '?'; } };
const redact = (raw) => {
  try {
    const u = new URL(raw);
    return `${u.hostname}${u.pathname}${u.search ? '?…' : ''}`;
  } catch { return String(raw || '').slice(0, 100); }
};

async function get(url, { headers = {}, method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { method, body, redirect: 'manual', signal: controller.signal, headers: { ...HEADERS, ...headers } });
    return { status: res.status, body: (await res.text()).slice(0, 900 * 1024), type: (res.headers.get('content-type') || '').split(';')[0],
      location: res.headers.get('location') || '' };
  } catch (err) {
    return { status: 0, body: '', type: '', error: err?.name || String(err).slice(0, 40) };
  } finally { clearTimeout(timer); }
}

const PAGE = 'https://ww4.animeonline.ninja/episodio/one-piece-cap-1/';
const API = 'https://ww4.animeonline.ninja/wp-admin/admin-ajax.php';

async function main() {
  const fs = await import('node:fs');
  fs.mkdirSync('.probe/html', { recursive: true });

  const page = await get(PAGE);
  const players = [...page.body.matchAll(/<(?:li|a|button)\b[^>]*data-post\s*=\s*["'](\d+)["'][^>]*>/gi)];
  row('episodio', page.status, `servidores=${players.length}`, `HTML ${page.body.length} B`);
  for (const [index, tag] of players.slice(0, 4).entries()) {
    const post = tag[1];
    const nume = /\bdata-nume\s*=\s*["'](\d+)["']/i.exec(tag[0])?.[1] || '1';
    const type = /\bdata-type\s*=\s*["']([\w-]+)["']/i.exec(tag[0])?.[1] || 'movie';
    const label = tag[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70);
    const body = new URLSearchParams({ action: 'doo_player_ajax', post, nume, type }).toString();
    const ajax = await get(API, { method: 'POST', body, headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest', Referer: PAGE, Origin: 'https://ww4.animeonline.ninja',
    } });
    let embed = '';
    try { embed = JSON.parse(ajax.body)?.embed_url || ''; } catch { /* no JSON */ }
    row(`servidor ${index + 1}`, ajax.status, embed ? 'embed' : (ajax.error || 'sin-embed'),
      `nume=${nume} tipo=${type} etiqueta="${label}" · ${embed ? redact(embed) : ajax.body.slice(0, 60).replace(/\s+/g, ' ')}`);
    if (!embed) continue;

    const html = await get(embed, { headers: { Referer: PAGE } });
    // Texto legible alrededor de cada enlace: es lo que declara el audio.
    const text = html.body.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const media = [...new Set([...html.body.matchAll(/https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4|m4v)(?:\?[^\s"'<>\\]*)?/gi)].map((m) => m[0]))];
    row(`visor ${index + 1}`, html.status, `medios=${media.length}`, `texto="${text.slice(0, 160)}"`);
    for (const url of media.slice(0, 4)) {
      const accepted = isDirectMedia(url);
      const head = await get(url, { method: 'GET', headers: { Referer: embed, Range: 'bytes=0-512' } });
      row(`medio ${hostOf(url)}`, head.status, `${head.type}${accepted ? ' · aceptado' : ' · rechazado'}`, redact(url));
      if (head.location) row(`· redirect`, '—', hostOf(head.location), redact(head.location));
    }
    fs.writeFileSync(`.probe/html/saidochesto-${index + 1}.html`, html.body);
  }

  const md = ['| Paso | HTTP | Resultado | Detalle |', '|---|---|---|---|'];
  for (const r of rows) md.push(`| ${r.step} | ${r.http} | ${r.state} | ${r.detail} |`);
  md.push('', 'Anatomía del visor de saidochesto.top: sin segmentos completos ni URLs firmadas en claro.');
  fs.writeFileSync('.probe/anime-players6.md', `${md.join('\n')}\n`);
  console.log(`\n${md.join('\n')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
