#!/usr/bin/env node
/**
 * Sonda de players (solo diagnóstico): guarda el HTML público de cada visor
 * para escribir extractores exactos, y resume las señales de cada uno
 * (JS empaquetado, base64, campos `file`/`sources`, endpoints declarados).
 *
 * No ejecuta JavaScript, no descarga vídeo ni guarda cookies. Los archivos van
 * a `.probe/html/` para revisión local; no forman parte del addon.
 *
 * Uso: node scripts/players-probe.mjs [host …]
 */

import fs from 'node:fs';
import path from 'node:path';
import { load } from 'cheerio';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TIMEOUT = 12_000;
const MAX = 600 * 1024;

const TARGETS = {
  bysejikuar: { url: 'https://bysejikuar.com/e/01j37fv5s579/sm1nda-1080-cas', referer: 'https://www.tubeonline.net/' },
  byseraguci: { url: 'https://byseraguci.com/e/intdacsm8cvn', referer: 'https://mirandogratis.com/' },
  mixdrop: { url: 'https://mixdrop.top/e/mkkkzkqla6x18g', referer: 'https://mirandogratis.com/' },
  hglink: { url: 'https://hglink.to/e/m10cltm3xblk', referer: 'https://verpeliculasultra.com/' },
  hgcloud: { url: 'https://hgcloud.to/e/aiy9yqjwoul5', referer: 'https://verpeliculasultra.com/' },
  streamwish: { url: 'https://streamwish.to/e/bxv60pjdnzpx', referer: 'https://links.fiuxy2.com/' },
  vpge: { url: 'https://vpge.link/e/SXMyN3Q4K0g1Y2wwZVd0MXh2MDBVQT09', referer: 'https://verpeliculasultra.com/' },
  voe: { url: 'https://voe.sx/e/xgbyls7nylgd', referer: 'https://links.fiuxy2.com/' },
  fiuxyhub: { url: 'https://links.fiuxy2.com/play/NMB2zwFeBWYf1ruC.html', referer: 'https://ver.gnula.one/' },
};

async function get(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'es-MX,es;q=0.9,en;q=0.6',
        ...(referer ? { Referer: referer } : {}),
      },
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, type: (res.headers.get('content-type') || '').split(';')[0],
      mitigated: (res.headers.get('cf-mitigated') || '').toLowerCase(), body: new TextDecoder().decode(buf.slice(0, MAX)), finalUrl: res.url };
  } catch (err) {
    return { status: 0, error: String(err?.name || err?.message).slice(0, 60), body: '', type: '', mitigated: '' };
  } finally { clearTimeout(timer); }
}

function analyze(html) {
  const $ = load(html);
  const scripts = [];
  $('script').each((_, el) => {
    const body = $(el).html() || '';
    if (!body) return;
    scripts.push({ inline: true, bytes: body.length, packed: /eval\(function\(p,a,c,k,e,d\)/.test(body),
      m3u8: /\.m3u8/.test(body), base64: /atob\(|CryptoJS|fromCharCode/.test(body),
      sources: /\b(?:sources?|file|hls|src)\s*[:=]\s*["']/.test(body), snippet: body.slice(0, 120).replace(/\s+/g, ' ') });
  });
  const external = [];
  $('script[src]').each((_, el) => external.push($(el).attr('src')));
  const text = html;
  return {
    bytes: html.length,
    title: $('title').first().text().slice(0, 80),
    packed: /eval\(function\(p,a,c,k,e,d\)/.test(text),
    m3u8Literal: [...new Set([...text.matchAll(/https?:\/\/[^\s"'\\<>]+\.m3u8[^\s"'\\<>]*/g)].map((m) => m[0].slice(0, 90)))].slice(0, 3),
    mp4Literal: [...new Set([...text.matchAll(/https?:\/\/[^\s"'\\<>]+\.mp4[^\s"'\\<>]*/g)].map((m) => m[0].slice(0, 90)))].slice(0, 3),
    iframes: $('iframe[src]').map((_, el) => $(el).attr('src')).get().slice(0, 5),
    forms: $('form[action]').map((_, el) => $(el).attr('action')).get().slice(0, 3),
    metaRefresh: ($('meta[http-equiv="refresh" i]').attr('content') || '').slice(0, 120),
    dataAttrs: $('[data-file],[data-src],[data-url],[data-hash],[data-id]').map((_, el) => ({ tag: el.tagName,
      attrs: Object.fromEntries(['data-file', 'data-src', 'data-url', 'data-hash', 'data-id'].map((a) => [a, $(el).attr(a)]).filter(([, v]) => v)) })).get().slice(0, 4),
    scripts: scripts.sort((a, b) => b.bytes - a.bytes).slice(0, 6),
    external: external.slice(0, 6),
  };
}

async function main() {
  const only = process.argv.slice(2);
  const keys = only.length ? only.filter((k) => TARGETS[k]) : Object.keys(TARGETS);
  fs.mkdirSync('.probe/html', { recursive: true });
  const report = [];
  for (const key of keys) {
    const target = TARGETS[key];
    const res = await get(target.url, target.referer);
    const info = res.body ? analyze(res.body) : {};
    report.push({ key, status: res.status, mitigated: res.mitigated, finalUrl: res.finalUrl, error: res.error, ...info });
    if (res.body) fs.writeFileSync(path.join('.probe/html', `${key}.html`), res.body);
    console.log(`\n## ${key} → ${res.status}${res.mitigated ? ' cf' : ''} ${res.error || ''} bytes=${res.body.length}`);
    if (res.body) {
      console.log(`  title=${info.title}`);
      console.log(`  packed=${info.packed} literals m3u8=${info.m3u8Literal.length} mp4=${info.mp4Literal.length}`);
      console.log(`  iframes=${info.iframes.join(' ')} meta=${info.metaRefresh}`);
      for (const script of info.scripts) console.log(`  script ${script.bytes}b packed=${script.packed} m3u8=${script.m3u8} b64=${script.base64} ${script.snippet.slice(0, 90)}`);
      for (const src of info.external) console.log(`  ext ${src}`);
    }
  }
  fs.writeFileSync('.probe/players-probe.json', JSON.stringify(report, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
