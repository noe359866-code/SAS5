#!/usr/bin/env node
/**
 * Sonda de la API de cuevanas3.pro (solo diagnóstico).
 *
 * El sitio es una SPA React: el HTML no trae fichas ni players, todo viene de
 * una API propia publicada en `window.siteConfig`:
 *
 *   fastApi: https://cuevanas3.pro/wp-api/v1   -> /search y /single/{tipo}
 *   apiUrl:  https://cuevanas3.pro/wp-json/wpf/v1
 *
 * Esta sonda comprueba, con peticiones reales:
 *   1. Forma de la respuesta de /search (posts + paginación, campos de cada hit).
 *   2. Forma de /single/{postType} y, sobre todo, de dónde salen los players.
 *   3. Qué hosts aparecen y si alguno es un visor ya soportado.
 *
 * Nunca imprime URLs firmadas completas: recorta la query con `redact`.
 */

const BASE = 'https://cuevanas3.pro';
const FAST = `${BASE}/wp-api/v1`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TIMEOUT = 15_000;
const MAX_BYTES = 2 * 1024 * 1024;

const redact = (raw) => {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}${u.search ? '?…' : ''}`;
  } catch { return String(raw || '').slice(0, 120); }
};

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'es-MX,es;q=0.9,en;q=0.6',
        Referer: `${BASE}/`,
        Origin: BASE,
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await res.text();
    const body = text.slice(0, MAX_BYTES);
    let json = null;
    try { json = JSON.parse(body); } catch { /* no es JSON */ }
    return { status: res.status, type: (res.headers.get('content-type') || '').split(';')[0], bytes: body.length, json, head: body.slice(0, 200) };
  } catch (err) {
    return { status: 0, error: err.message, json: null };
  } finally { clearTimeout(timer); }
}

const hostOf = (raw) => { try { return new URL(raw).hostname; } catch { return null; } };

// Recorre un objeto JSON y devuelve las claves de primer nivel que parecen
// contener players + todas las URLs absolutas encontradas (recortadas).
function inspect(value) {
  const urls = new Set();
  const keys = [];
  const walk = (node, depth) => {
    if (depth > 4 || node == null) return;
    if (typeof node === 'string') {
      if (/^https?:\/\//.test(node)) urls.add(redact(node));
      return;
    }
    if (Array.isArray(node)) { node.slice(0, 4).forEach((item) => walk(item, depth + 1)); return; }
    if (typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        if (depth === 0) keys.push(key);
        walk(child, depth + 1);
      }
    }
  };
  walk(value, 0);
  return { keys, urls: [...urls] };
}

const QUERIES = [
  { q: 'spider-man', postType: 'any' },
  { q: 'el reino prohibido', postType: 'any' },
  { q: 'naruto', postType: 'any' },
];

async function main() {
  const rows = [];
  const seen = new Map(); // postType -> slug de la primera ficha

  for (const { q, postType } of QUERIES) {
    const url = `${FAST}/search?q=${encodeURIComponent(q)}&page=1&postType=${postType}&postsPerPage=18`;
    const res = await getJson(url);
    const data = res.json?.data;
    const posts = Array.isArray(data?.posts) ? data.posts : [];
    console.log(`\n### /search q="${q}" -> ${res.status} ${res.type} ${res.bytes}B, ${posts.length} posts`);
    if (posts.length) {
      const sample = posts[0];
      console.log(`  campos del hit: ${Object.keys(sample).join(', ')}`);
      console.log(`  muestra: ${JSON.stringify({ ...sample, poster: sample.poster ? '<img>' : undefined, backdrop: sample.backdrop ? '<img>' : undefined }).slice(0, 600)}`);
      for (const post of posts.slice(0, 6)) {
        console.log(`  - [${post.type || '?'}] ${post.title || post.name} (${post.year || post.release_date || '?'}) slug=${post.slug}`);
        if (!seen.has(post.type) && post.slug) seen.set(post.type, post.slug);
      }
      if (data?.pagination) console.log(`  paginación: ${JSON.stringify(data.pagination).slice(0, 300)}`);
    } else if (!res.json) {
      console.log(`  cabeza: ${res.head}`);
    }
    rows.push({ step: `search:${q}`, status: res.status, type: res.type, bytes: res.bytes, posts: posts.length, hosts: '-' });
  }

  for (const [postType, slug] of seen) {
    const url = `${FAST}/single/${encodeURIComponent(postType)}?slug=${encodeURIComponent(slug)}&postType=${encodeURIComponent(postType)}`;
    const res = await getJson(url);
    const data = res.json?.data;
    console.log(`\n### /single/${postType} slug=${slug} -> ${res.status} ${res.type} ${res.bytes}B`);
    if (!data) { console.log(`  sin data (${res.head?.slice(0, 160) || res.error})`); rows.push({ step: `single:${postType}`, status: res.status, type: res.type, bytes: res.bytes, posts: 0, hosts: '-' }); continue; }
    const { keys, urls } = inspect(data);
    console.log(`  claves: ${keys.join(', ')}`);
    console.log(`  título: ${data.title || data.name} | type=${data.type} | _id=${data._id}`);
    const hosts = [...new Set(urls.map(hostOf).filter(Boolean))];
    console.log(`  hosts: ${hosts.join(', ') || '—'}`);
    for (const u of urls.slice(0, 25)) console.log(`    url: ${u}`);
    // Campos que suenan a players
    for (const key of ['players', 'servers', 'embeds', 'sources', 'videos', 'episodes', 'seasons']) {
      if (data[key] !== undefined) {
        const v = data[key];
        const brief = Array.isArray(v) ? `array(${v.length})` : typeof v === 'object' && v ? `object(${Object.keys(v).join(',')})` : String(v).slice(0, 80);
        console.log(`  campo ${key}: ${brief}`);
        if (Array.isArray(v) && v.length) console.log(`    primer elemento: ${JSON.stringify(v[0]).slice(0, 500)}`);
      }
    }
    rows.push({ step: `single:${postType}`, status: res.status, type: res.type, bytes: res.bytes, posts: 1, hosts: hosts.join(', ') || '-' });
  }

  const fs = await import('node:fs');
  fs.mkdirSync('.probe', { recursive: true });
  const md = ['| Paso | HTTP | Tipo | Bytes | Posts | Hosts |', '|---|---|---|---|---|---|'];
  for (const row of rows) md.push(`| ${row.step} | ${row.status} | ${row.type} | ${row.bytes} | ${row.posts} | ${row.hosts} |`);
  md.push('', 'Sonda de API (solo JSON público; URLs con query recortada).');
  fs.writeFileSync('.probe/cuevanas3-api.md', md.join('\n') + '\n');
}

main().catch((err) => { console.error(err); process.exit(1); });
