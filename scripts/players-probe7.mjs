#!/usr/bin/env node
/**
 * Sonda v7 (diagnóstico): verificación final antes de escribir el extractor.
 *   1. Byse: JSON completo y descifrado real (AES-256-GCM) con las claves
 *      candidatas del bundle; imprime los campos del JSON descifrado.
 *   2. hgcloud/hglink/streamwish: /dl?op=embed con Referer y cookies de sesión
 *      (¿el bootstrap cambia?), y /main.js como fuente de la API interna.
 *   3. Streamtape: robotlink + get_video desde una ficha real.
 *   4. vpge/videohel: variantes de la ficha para encontrar el `vurl` real.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TIMEOUT = 15_000;

async function req(url, { referer, body, method, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { method: method || (body ? 'POST' : 'GET'), body, redirect: 'follow', signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/json,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9',
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } : {}), ...(referer ? { Referer: referer } : {}), ...headers } });
    const buf = new Uint8Array(await res.arrayBuffer());
    const cookies = res.headers.getSetCookie?.() || [];
    return { status: res.status, size: buf.byteLength, body: new TextDecoder().decode(buf.slice(0, 600 * 1024)), cookies, finalUrl: res.url };
  } catch (err) { return { status: 0, error: String(err?.name || err?.message).slice(0, 60), body: '', size: 0, cookies: [] }; }
  finally { clearTimeout(timer); }
}
const shown = (s, n = 180) => String(s || '').replace(/\s+/g, ' ').slice(0, n);

async function byse() {
  const api = await req('https://byseraguci.com/api/videos/intdacsm8cvn', { referer: 'https://mirandogratis.com/' });
  const info = JSON.parse(api.body);
  const { iv, payload, algorithm } = info.playback || {};
  fs.writeFileSync('.probe/byse-api.json', api.body);
  const data = Buffer.from(payload, 'base64');
  const index = await req('https://byseraguci.com/assets/index-DocunfmE.js');
  const chunks = [...index.body.matchAll(/(?:src|href|import)\s*[:=(]\s*["'`]([^"'`]*\.js)["'`]/g)].map((m) => m[1]).slice(0, 12);
  const apps = [...new Set([...index.body.matchAll(/["'`](\/assets\/[\w.-]+\.js)["'`]/g)].map((m) => m[1]))];
  const candidates = new Set();
  for (const url of ['.probe/html/videoPagesBundle-Bgi0QmPo.js', '.probe/html/index-DocunfmE.js']) {
    if (!fs.existsSync(url)) continue;
    const text = fs.readFileSync(url, 'utf8');
    for (const m of text.matchAll(/["'`]([A-Za-z0-9+/=_-]{40,48})["'`]/g)) candidates.add(m[1]);
    for (const m of text.matchAll(/(?:TextEncoder\(\)\.encode\(|encode\(")([^"')]{4,80})/g)) candidates.add(`raw:${m[1]}`);
  }
  const results = [];
  for (const candidate of candidates) {
    const raw = candidate.startsWith('raw:') ? Buffer.from(candidate.slice(4), 'utf8') : Buffer.from(candidate, 'base64');
    if (raw.length !== 32) continue;
    for (const [ivName, nonce] of [['base64', Buffer.from(iv, 'base64')], ['utf8', Buffer.from(iv, 'utf8')]]) {
      if (nonce.length !== 12) continue;
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', raw, nonce);
        decipher.setAuthTag(data.subarray(-16));
        const plain = Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]).toString('utf8');
        results.push({ key: candidate.slice(0, 5) + '…', ivName, plain: plain.slice(0, 600) });
        console.log(`  ✔ ${candidate.slice(0, 5)}… iv=${ivName} → ${plain.slice(0, 300)}`);
      } catch { /* no es la clave */ }
    }
  }
  if (!results.length) console.log(`  sin éxito: ${candidates.size} candidatos, clave de bundle=${[...candidates].slice(0, 3).join(',')}`);
  console.log(`  api=${api.status} chunks=${chunks.length} apps=${apps.length} iv=${iv} payload=${data.length}b`);
  return { api: api.status, iv, payloadBytes: data.length, candidates: [...candidates].slice(0, 8), results, chunks: chunks.slice(0, 5), apps: apps.slice(0, 8) };
}

async function fileHost() {
  const out = [];
  for (const [name, embed, referer] of [
    ['hgcloud', 'https://hgcloud.to/e/aiy9yqjwoul5', 'https://verpeliculasultra.com/'],
    ['hglink', 'https://hglink.to/e/m10cltm3xblk', 'https://verpeliculasultra.com/'],
    ['streamwish', 'https://streamwish.to/e/bxv60pjdnzpx', 'https://links.fiuxy2.com/'],
  ]) {
    const code = new URL(embed).pathname.split('/').pop();
    const origin = new URL(embed).origin;
    const first = await req(embed, { referer });
    const cookie = (first.cookies || []).map((c) => c.split(';')[0]).join('; ');
    const variants = [
      [`${origin}/dl?op=embed&file_code=${code}&auto=1`, 'dl+auto'],
      [`${origin}/dl?op=embed&file_code=${code}`, 'dl'],
      [`${origin}/e/${code}?op=embed`, 'e?op=embed'],
      [`${origin}/dl/${code}`, 'dl/slug'],
    ];
    for (const [url, label] of variants) {
      const res = await req(url, { referer, headers: cookie ? { Cookie: cookie } : {} });
      const packed = /\}\('.*?',\d+,\d+,'/.test(res.body);
      const media = [...new Set([...(res.body.matchAll(/https?:\/\/[^\s"'\\<>]+?\.(?:m3u8|mp4)[^\s"'\\<>]*/g))].map((m) => m[0]))];
      console.log(`  ${name} ${label} → ${res.status} ${res.size}b packed=${packed} media=${media.length} ${shown(res.body, 90)}`);
      out.push({ name, label, status: res.status, size: res.size, packed, media: media.slice(0, 1).map((u) => u.slice(0, 110)), cookie: Boolean(cookie) });
    }
  }
  return out;
}

async function streamtape() {
  const page = await req('https://www.tubeonline.net/pelicula/no-nos-rendimos/', { referer: 'https://www.tubeonline.net/' });
  const opts = [...page.body.matchAll(/id="player-option-(\d+)"[\s\S]{0,600}?data-post="(\d+)"[\s\S]{0,600}?data-nume="(\d+)"/g)].map((m) => m.slice(1));
  const names = [...page.body.matchAll(/id="player-option-(\d+)"[\s\S]{0,600}?<span class="server">([^<]+)<\/span>/g)].map((m) => `${m[1]}:${m[2].trim()}`);
  console.log(`  opciones=${opts.length} nombres=${names.slice(0, 8).join(',')}`);
  const out = [];
  for (const [option, post, nume] of opts.slice(0, 8)) {
    const ajax = await req('https://www.tubeonline.net/wp-admin/admin-ajax.php', { body: `action=doo_player_ajax&post=${post}&nume=${nume}&type=movie`,
      referer: 'https://www.tubeonline.net/', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    let embed = '';
    try { embed = JSON.parse(ajax.body).embed_url || ''; } catch { /* no json */ }
    let extra = '';
    if (/streamtape/i.test(embed)) {
      const player = await req(embed, { referer: 'https://www.tubeonline.net/' });
      const robot = /id="robotlink"[^>]*>([^<]*)</.exec(player.body)?.[1] || '';
      const built = robot ? `https:/${robot}` : '';
      const head = built ? await req(built, { method: 'HEAD', referer: embed }) : null;
      extra = `robot=${shown(robot, 50)} head=${head?.status ?? '—'}`;
    }
    if (embed) console.log(`  [${option}] ${new URL(embed).hostname} ${extra}`);
    out.push({ option, host: embed ? new URL(embed).hostname : '', embed: embed.replace(/\?.*/, ''), extra });
  }
  return { opts: opts.length, names, out };
}

async function videohel() {
  const base = 'https://vpge.link/e/SXMyN3Q4K0g1Y2wwZVd0MXh2MDBVQT09';
  const page = await req(base, { referer: 'https://verpeliculasultra.com/' });
  const text = page.body;
  const keys = ['vurl', 'var src', 'source', 'olplayer.src', 'stream', 'file:', 'hls', 'mp4'];
  const found = [];
  for (const key of keys) {
    let at = text.indexOf(key);
    let guard = 0;
    while (at >= 0 && guard < 2) {
      found.push(`${key}@${at}: ${shown(text.slice(Math.max(0, at - 100), at + 220), 300)}`);
      at = text.indexOf(key, at + 1); guard += 1;
    }
  }
  for (const line of found.slice(0, 12)) console.log(`  ${line}`);
  const jsonish = [...new Set([...text.matchAll(/(?:file|src|url)\s*:\s*["']([^"']{10,200})["']/g)].map((m) => m[1]))];
  console.log(`  campos file/src/url: ${jsonish.slice(0, 6).join(' | ').slice(0, 400)}`);
  return { status: page.status, found, jsonish: jsonish.slice(0, 6) };
}

const tasks = { byse, filehost: fileHost, streamtape, videohel };
async function main() {
  const only = process.argv.slice(2).filter((a) => tasks[a]);
  const keys = only.length ? only : Object.keys(tasks);
  const out = {};
  for (const key of keys) {
    console.log(`\n## ${key}`);
    try { out[key] = await tasks[key](); } catch (err) { out[key] = { error: String(err).slice(0, 160) }; console.log('  error', err.message); }
  }
  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/players-v7.json', JSON.stringify(out, null, 2));
}
main().catch((err) => { console.error(err); process.exit(1); });
