#!/usr/bin/env node
/**
 * Sonda v3 (diagnóstico): pasos concretos que necesita el extractor nativo.
 *
 *  1. Streamwish / hglink / hgcloud / vidhide: `GET /dl?op=embed&file_code=X`
 *     (el bootstrap es un JS que suele llevar ahí) y variantes de ruta.
 *  2. MixDrop: comprobar que el `unpack` del packer da el MP4 (no se descarga).
 *  3. Voe: enlaces frescos desde gnula.one para ver si devuelve algo distinto.
 *  4. Byse: probar endpoints JSON habituales del SPA (solo 4 candidatos).
 *  5. Videohel/vpge: extraer la construcción de `vurl` y probar la URL resultante
 *     solo si es un `.m3u8` (cabecera, sin segmentos).
 *
 * Nada de esto se ejecuta en el Worker.
 */

import fs from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TIMEOUT = 12_000;
const MAX = 200 * 1024;

async function req(url, { referer, headers = {}, maxBytes = MAX } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'es-MX,es;q=0.9', ...(referer ? { Referer: referer } : {}), ...headers } });
    const buf = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, type: (res.headers.get('content-type') || '').split(';')[0], finalUrl: res.url,
      body: new TextDecoder().decode(buf.slice(0, maxBytes)), truncated: buf.byteLength > maxBytes };
  } catch (err) { return { status: 0, error: String(err?.name || err?.message).slice(0, 60), body: '' }; }
  finally { clearTimeout(timer); }
}

// ── unpack de Dean Edwards (el mismo de lib/vimeos.js) ──
function unpackPacked(source) {
  const m = /eval\(function\(p,a,c,k,e,d\)\{.*?\}\((.+)\)\)/s.exec(source)
    || /eval\(function\(p,a,c,k,e,d\)\{.*?\}\('(.*?)',(\d+),(\d+),'(.*?)'\.split\('\|'\)/s.exec(source);
  if (!m) return null;
  try {
    let payload = m[1];
    let radix = 36;
    let count = 0;
    let keywords = [];
    if (m[4] !== undefined) {
      radix = Number(m[2]) || 36; count = Number(m[3]) || 0; keywords = m[4].split('|');
    } else {
      // Reevaluación mínima del argumento: separa por comas de nivel superior.
      const parts = []; let depth = 0; let quote = null; let cur = '';
      for (const ch of payload) {
        if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
        if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
        if ('([{'.includes(ch)) depth += 1; if (')]}'.includes(ch)) depth -= 1;
        if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
        cur += ch;
      }
      parts.push(cur);
      const str = (s) => s.trim().replace(/^['"]|['"]$/g, '');
      payload = str(parts[0]);
      radix = Number(str(parts[1])) || 36;
      count = Number(str(parts[2])) || 0;
      keywords = str(parts[3]).split('|');
    }
    const encode = (n) => { let out = ''; let v = n; do { const d = v % radix; out = (d < 36 ? d.toString(36) : String.fromCharCode(d + 29)) + out; v = Math.floor(v / radix); } while (v > 0); return out; };
    while (count--) if (keywords[count]) payload = payload.replace(new RegExp(`\\b${encode(count)}\\b`, 'g'), keywords[count]);
    return payload;
  } catch { return null; }
}

const shown = (value, n = 150) => String(value || '').replace(/\s+/g, ' ').slice(0, n);

async function probeFileHosts() {
  console.log('\n## file hosts: /dl?op=embed&file_code=');
  const targets = [
    ['streamwish', 'https://streamwish.to/e/bxv60pjdnzpx', 'bxv60pjdnzpx', 'https://links.fiuxy2.com/'],
    ['hglink', 'https://hglink.to/e/m10cltm3xblk', 'm10cltm3xblk', 'https://verpeliculasultra.com/'],
    ['hgcloud', 'https://hgcloud.to/e/aiy9yqjwoul5', 'aiy9yqjwoul5', 'https://verpeliculasultra.com/'],
  ];
  const report = [];
  for (const [name, embed, code, referer] of targets) {
    const origin = new URL(embed).origin;
    const paths = [
      `${origin}/dl?op=embed&file_code=${code}&auto=1`,
      `${origin}/dl?op=embed&file_code=${code}`,
      `${origin}/e/${code}?op=embed`,
    ];
    for (const url of paths) {
      const res = await req(url.replace(/\?.*/, ''), { referer, maxBytes: 120 * 1024 });
      // Con query: se pide completa, pero se imprime redactada.
      const full = await req(url, { referer, maxBytes: 120 * 1024 });
      const html = full.body || '';
      const packed = /\}\('.*?',\d+,\d+,'/.test(html);
      const unpacked = packed ? unpackPacked(html) : null;
      const media = [...new Set([...(html.matchAll(/https?:\/\/[^\s"'\\<>]+?\.(?:m3u8|mp4)[^\s"'\\<>]*/g))].map((m) => m[0]))];
      const unMedia = unpacked ? [...new Set([...(unpacked.matchAll(/https?:\/\/[^\s"'\\<>]+?\.(?:m3u8|mp4)[^\s"'\\<>]*/g))].map((m) => m[0]))] : [];
      console.log(`- ${name} ${url.replace(/\?.*$/, '?…')} → ${full.status} ${full.type} ${html.length}b packed=${packed} media=${media.length} unpackedMedia=${unMedia.length}`);
      if (media.length) console.log(`    html: ${media[0].slice(0, 120)}`);
      if (unMedia.length) console.log(`    unpack: ${unMedia[0].slice(0, 120)}`);
      report.push({ name, url: url.replace(/\?.*$/, '?…'), status: full.status, type: full.type, bytes: html.length, packed, media: media.slice(0, 2).map((u) => u.slice(0, 120)), unMedia: unMedia.slice(0, 2).map((u) => u.slice(0, 120)), snippet: shown(html, 200) });
      if (/\.m3u8|\.mp4/.test(html)) break;
    }
  }
  return report;
}

async function probeMixdrop() {
  console.log('\n## mixdrop unpack');
  const res = await req('https://mxdrop.click/e/mkkkzkqla6x18g', { referer: 'https://mirandogratis.com/' });
  const unpacked = unpackPacked(res.body);
  const fields = {};
  for (const key of ['wurl', 'furl', 'vfile', 'poster', 'vserver', 'referrer']) {
    const m = new RegExp(`MDCore\\.${key}\\s*=\\s*["']([^"']+)["']`).exec(unpacked || '');
    if (m) fields[key] = m[1].slice(0, 120);
  }
  const m3u8 = [...new Set([...(unpacked || '').matchAll(/["']([^"']+\.m3u8[^"']*)["']/g)].map((m) => m[1]))];
  console.log(`  status=${res.status} unpacked=${Boolean(unpacked)} fields=${JSON.stringify(fields)} m3u8=${m3u8.slice(0, 2)}`);
  return { status: res.status, fields, m3u8 };
}

async function probeVoe() {
  console.log('\n## voe frescos desde gnula.one');
  const hub = await req('https://links.fiuxy2.com/play/NMB2zwFeBWYf1ruC.html', { referer: 'https://ver.gnula.one/' });
  const links = [...new Set([...(hub.body.matchAll(/data-src="([^"#]+)(?:#[^"]*)?"/g))].map((m) => m[1]))];
  const report = [];
  for (const link of links.slice(0, 4)) {
    const res = await req(link, { referer: 'https://links.fiuxy2.com/' });
    const html = res.body;
    const packed = /\}\('.*?',\d+,\d+,'/.test(html);
    const media = [...new Set([...(html.matchAll(/https?:\/\/[^\s"'\\<>]+?\.(?:m3u8|mp4)[^\s"'\\<>]*/g))].map((m) => m[0]))];
    console.log(`- ${new URL(link).hostname}${new URL(link).pathname} → ${res.status} ${html.length}b packed=${packed} media=${media.length}`);
    report.push({ host: new URL(link).hostname, path: new URL(link).pathname, status: res.status, bytes: html.length, packed, media: media.slice(0, 1).map((u) => u.slice(0, 100)), snippet: shown(html, 160) });
    if (html.length < 4000) fs.writeFileSync(`.probe/html/voe-${new URL(link).hostname}.html`, html);
  }
  return report;
}

async function probeByse() {
  console.log('\n## byse endpoints');
  const bases = ['https://byseraguci.com', 'https://bysejikuar.com'];
  const ids = ['intdacsm8cvn', '01j37fv5s579'];
  const paths = ['/api/v1/videos/', '/api/video/', '/api/videos/', '/api/embed/'];
  const report = [];
  for (let i = 0; i < bases.length; i += 1) {
    for (const path of paths) {
      const url = `${bases[i]}${path}${ids[i]}`;
      const res = await req(url, { referer: 'https://mirandogratis.com/' });
      const looksJson = (res.type || '').includes('json');
      console.log(`- ${url.replace(bases[i], new URL(bases[i]).hostname)} → ${res.status} ${res.type} ${res.body.length}b ${shown(res.body, 100)}`);
      report.push({ url: url.replace(/^https:\/\//, ''), status: res.status, type: res.type, bytes: res.body.length, head: shown(res.body, 140) });
    }
  }
  const js = await req('https://byseraguci.com/assets/index-DocunfmE.js');
  const media = [...new Set([...(js.body.matchAll(/["'`]([^"'`]*(?:api|embed|video)[^"'`]*)["'`]/g))].map((m) => m[1]).filter((s) => s.length < 90))].slice(0, 12);
  console.log(`  bundle ${js.status} ${js.body.length}b rutas: ${media.join(' | ')}`);
  return { report, bundle: { status: js.status, media } };
}

async function probeVideohel() {
  console.log('\n## videohel (vpge.link)');
  const res = await req('https://vpge.link/e/SXMyN3Q4K0g1Y2wwZVd0MXh2MDBVQT09', { referer: 'https://verpeliculasultra.com/' });
  const html = res.body;
  const keys = ['vurl', 'var srt', 'sources', 'srcs', 'olplayer.src', 'getlink', 'mdstr', 'stream_url', 'file:'];
  for (const key of keys) {
    const index = html.indexOf(key);
    if (index >= 0) console.log(`  ${key}: ${shown(html.slice(Math.max(0, index - 80), index + 200), 260)}`);
  }
  const m3u8 = [...new Set([...html.matchAll(/["']([^"']+\.m3u8[^"']*)["']/g)].map((m) => m[1]))];
  console.log(`  m3u8 en comillas: ${m3u8.slice(0, 3).join(' | ').slice(0, 300)}`);
  return { status: res.status, m3u8: m3u8.slice(0, 3) };
}

const tasks = { filehosts: probeFileHosts, mixdrop: probeMixdrop, voe: probeVoe, byse: probeByse, videohel: probeVideohel };

async function main() {
  const only = process.argv.slice(2).filter((arg) => tasks[arg]);
  const keys = only.length ? only : Object.keys(tasks);
  fs.mkdirSync('.probe', { recursive: true });
  const out = {};
  for (const key of keys) {
    try { out[key] = await tasks[key](); } catch (err) { out[key] = { error: String(err).slice(0, 120) }; console.log('  error', err.message); }
  }
  fs.writeFileSync('.probe/players-v3.json', JSON.stringify(out, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
