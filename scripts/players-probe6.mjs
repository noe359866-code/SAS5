#!/usr/bin/env node
/**
 * Sonda v6 (diagnóstico): lo que falta para cerrar el extractor.
 *   1. Byse: buscar la clave AES en su bundle y probar el descifrado real.
 *   2. Streamtape vía Dooplay de tubeonline (robotlink → get_video → HEAD).
 *   3. Estructura de pestañas/idioma en verpeliculasultra y mirandogratis.
 *   4. Estructura de temporadas/episodios en tubeonline.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TIMEOUT = 15_000;

async function req(url, { referer, body, headers = {}, method } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { method: method || (body ? 'POST' : 'GET'), body, redirect: 'follow', signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/json,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9',
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } : {}), ...(referer ? { Referer: referer } : {}), ...headers } });
    const buf = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, size: buf.byteLength, body: new TextDecoder().decode(buf.slice(0, 400 * 1024)), finalUrl: res.url };
  } catch (err) { return { status: 0, error: String(err?.name || err?.message).slice(0, 60), body: '', size: 0 }; }
  finally { clearTimeout(timer); }
}
const uniq = (a) => [...new Set(a)];
const shown = (s, n = 200) => String(s || '').replace(/\s+/g, ' ').slice(0, n);

// ── 1. Byse ──
async function byseDecrypt() {
  const api = await req('https://byseraguci.com/api/videos/intdacsm8cvn', { referer: 'https://mirandogratis.com/' });
  let info;
  try { info = JSON.parse(api.body); } catch { return { error: 'api no json', head: shown(api.body) }; }
  const { algorithm, iv, payload } = info.playback || {};
  const index = await req('https://byseraguci.com/assets/index-DocunfmE.js');
  const refs = uniq([...index.body.matchAll(/(assets\/[\w.-]+\.js)/g)].map((m) => m[1]));
  const bundles = ['https://byseraguci.com/assets/videoPagesBundle-Bgi0QmPo.js', ...refs.filter((r) => /video|page/i.test(r)).map((r) => `https://byseraguci.com${r.startsWith('/') ? '' : '/'}${r}`)];
  const found = [];
  for (const url of uniq(bundles).slice(0, 3)) {
    const bundle = await req(url);
    if (!bundle.body) { console.log(`  bundle ${url} → ${bundle.status}`); continue; }
    fs.writeFileSync(`.probe/html/${url.split('/').pop()}`, bundle.body);
    const keys = uniq([
      ...[...bundle.body.matchAll(/["'`]([A-Za-z0-9+/=_-]{32,64})["'`]/g)].map((m) => m[1]),
      ...[...bundle.body.matchAll(/(?:key|secret|AES|GCM|subtle|decrypt|fromCharCode|Uint8Array)/gi)].map((m) => m[0]),
    ]).slice(0, 24);
    const ctx = ['importKey', 'decrypt', 'AES-GCM', 'fromHex', 'parseKey', 'playback'].map((kw) => {
      const at = bundle.body.indexOf(kw);
      return at >= 0 ? `${kw}@${at}: ${shown(bundle.body.slice(Math.max(0, at - 90), at + 120), 210)}` : '';
    }).filter(Boolean);
    console.log(`  bundle ${url.split('/').pop()} ${bundle.size}b keys=${keys.slice(0, 10).join(',')}`);
    for (const line of ctx) console.log(`    ${line}`);
    found.push({ url: url.split('/').pop(), size: bundle.size, keys: keys.slice(0, 10), ctx });
  }

  // Prueba de descifrado con las claves plausibles (32 bytes en hex/base64/utf8).
  const candidates = uniq(found.flatMap((f) => f.keys)).filter((k) => /^[A-Za-z0-9+/=_-]{32,64}$/.test(k));
  const attempts = [];
  for (const key of candidates) {
    for (const kind of ['hex', 'base64', 'utf8']) {
      let raw;
      if (kind === 'hex' && /^[0-9a-fA-F]{64}$/.test(key)) raw = Buffer.from(key, 'hex');
      else if (kind === 'base64') raw = Buffer.from(key.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
      else raw = Buffer.from(key, 'utf8');
      if (raw.length !== 32) continue;
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', raw, Buffer.from(iv, 'base64'));
        const data = Buffer.from(payload, 'base64');
        const tag = data.subarray(data.length - 16);
        decipher.setAuthTag(tag);
        const plain = Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString('utf8');
        attempts.push({ key: key.slice(0, 4) + '…', kind, ok: true, plain: plain.slice(0, 160) });
        console.log(`  ✔ descifrado con ${kind}: ${plain.slice(0, 160)}`);
        break;
      } catch { /* clave incorrecta */ }
    }
  }
  console.log(`  iv=${iv} payload=${payload.length}b algorithm=${algorithm} intentos=${attempts.length}`);
  return { api: { status: api.status, fields: Object.keys(info) }, bundles: found, attempts };
}

// ── 2. Streamtape vía Dooplay ──
async function tubePlayers() {
  const page = await req('https://www.tubeonline.net/pelicula/no-nos-rendimos/', { referer: 'https://www.tubeonline.net/' });
  const block = page.body.slice(0, 60000);
  const ids = uniq([...block.matchAll(/id="player-option-(\d+)"[^>]*data-post="(\d+)"[^>]*data-nume="(\d+)"/g)].map((m) => m.slice(1)));
  const names = uniq([...block.matchAll(/id="player-option-(\d+)"[\s\S]{0,400}?<span class="server">([^<]+)<\/span>/g)].map((m) => `${m[1]}=${m[2].trim()}`));
  const langs = uniq([...block.matchAll(/id="player-option-(\d+)"[\s\S]{0,500}?flags\/(\w+)\.png/g)].map((m) => `${m[1]}=${m[2]}`));
  console.log(`tube players: ${ids.length} names=${names.slice(0, 8).join(',')} flags=${langs.slice(0, 8).join(',')}`);
  const out = [];
  for (const [nume, post, number] of ids.slice(0, 6)) {
    const ajax = await req('https://www.tubeonline.net/wp-admin/admin-ajax.php', { referer: 'https://www.tubeonline.net/', body: `action=doo_player_ajax&post=${post}&nume=${number}&type=movie`,
      headers: { 'X-Requested-With': 'XMLHttpRequest', Origin: 'https://www.tubeonline.net' } });
    let embed = '';
    try { embed = JSON.parse(ajax.body).embed_url || ''; } catch { /* no json */ }
    let extra = '';
    if (/streamtape/i.test(embed)) {
      const player = await req(embed, { referer: 'https://www.tubeonline.net/' });
      const robot = /id="robotlink"[^>]*>([^<]*)</.exec(player.body)?.[1] || '';
      const direct = /id="ideoolink"[^>]*>([^<]*)</.exec(player.body)?.[1] || '';
      const built = robot ? `https:/${robot}` : '';
      const head = built ? await req(built, { method: 'HEAD', referer: embed }) : null;
      extra = `robot=${shown(robot, 60)} head=${head?.status ?? '—'}`;
      fs.writeFileSync('.probe/html/streamtape.html', player.body);
    }
    console.log(`  [${nume}] ${Number(number)} ${new URL(embed || 'https://x.invalid').hostname} ${extra} ${embed ? `(${shown(embed.replace(/\?.*/, ''), 70)})` : shown(ajax.body, 80)}`);
    out.push({ nume, num: Number(number), embed: embed.replace(/\?.*/, ''), extra });
  }
  return { ids: ids.length, names, langs, out };
}

// ── 3. Pestañas e idioma en ultra y mirando ──
async function tabs() {
  const out = {};
  const ultra = await req('https://verpeliculasultra.com/accion/5276-hope.html', { referer: 'https://verpeliculasultra.com/' });
  fs.writeFileSync('.probe/html/ultra-detail.html', ultra.body);
  out.ultra = {
    status: ultra.status, size: ultra.size,
    tabs: uniq([...ultra.body.matchAll(/id="(ts\d+)"[^>]*>([^<]{0,30})/g)].map((m) => `${m[1]}=${m[2].trim()}`)).slice(0, 10),
    frames: uniq([...ultra.body.matchAll(/(?:data-src|src)="(https?:\/\/[^"]*(?:hglink|hgcloud|vpge|powvideo|streamtape|mixdrop|byse)[^"]*)"/g)].map((m) => m[1].replace(/\?.*/, ''))).slice(0, 8),
    labels: uniq([...ultra.body.matchAll(/<a href="#ts\d+"[^>]*>([^<]{2,24})</g)].map((m) => m[1].trim())).slice(0, 10),
  };
  const mir = await req('https://mirandogratis.com/el-reino-prohibido.html', { referer: 'https://mirandogratis.com/' });
  fs.writeFileSync('.probe/html/mirando-detail.html', mir.body);
  out.mirando = {
    status: mir.status, size: mir.size,
    options: uniq([...mir.body.matchAll(/id="(op\w+)"[^>]*>([^<]{0,24})/g)].map((m) => `${m[1]}=${m[2].trim()}`)).slice(0, 8),
    frames: uniq([...mir.body.matchAll(/<iframe[^>]+src="([^"]+)"/g)].map((m) => m[1].replace(/\?.*/, ''))).slice(0, 8),
    audio: uniq([...mir.body.matchAll(/Audio[^<]{0,40}/g)].map((m) => m[0].slice(0, 40))).slice(0, 4),
  };
  console.log('ultra', JSON.stringify(out.ultra));
  console.log('mirando', JSON.stringify(out.mirando));
  return out;
}

// ── 4. Serie en tubeonline ──
async function tubeSeries() {
  const page = await req('https://www.tubeonline.net/serie/the-last-of-us/', { referer: 'https://www.tubeonline.net/' });
  fs.writeFileSync('.probe/html/tube-serie2.html', page.body);
  const out = {
    status: page.status, size: page.size,
    seasons: uniq([...page.body.matchAll(/href="([^"]*(?:temporada|season)[^"]*)"/gi)].map((m) => m[1].replace('https://www.tubeonline.net', ''))).slice(0, 8),
    episodes: uniq([...page.body.matchAll(/href="([^"]*\/episodio\/[^"]*)"/g)].map((m) => m[1].replace('https://www.tubeonline.net', ''))).slice(0, 8),
    eps2: uniq([...page.body.matchAll(/href="([^"]*-\d+x\d+[^"]*)"/g)].map((m) => m[1].replace('https://www.tubeonline.net', ''))).slice(0, 8),
  };
  console.log('tubeSerie', JSON.stringify(out).slice(0, 800));
  return out;
}

const tasks = { byse: byseDecrypt, tube: tubePlayers, tabs, series: tubeSeries };
async function main() {
  const only = process.argv.slice(2).filter((a) => tasks[a]);
  const keys = only.length ? only : Object.keys(tasks);
  const out = {};
  for (const key of keys) {
    console.log(`\n## ${key}`);
    try { out[key] = await tasks[key](); } catch (err) { out[key] = { error: String(err).slice(0, 160) }; console.log('  error', err.message); }
  }
  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/players-v6.json', JSON.stringify(out, null, 2));
}
main().catch((err) => { console.error(err); process.exit(1); });
