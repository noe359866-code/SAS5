#!/usr/bin/env node
/**
 * Sonda de cierre: ¿el visor Vimeos de estas APIs se resuelve con el código
 * que ya tiene el addon?
 *
 * La tercera tanda encontró que allpeliculas.la, lamovie.org y allcalidad.re
 * publican su visor por API JSON, con idioma y calidad declarados, y que el
 * visor es `vimeos.net`. Aquí se recorre la cadena completa con ese código
 * (`lib/vimeos.js` + `lib/providerHttp.js`) y se cuenta lo que sale.
 *
 * No imprime URLs: solo estados, tipos y recuentos.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { providerHttp } = require('../lib/providerHttp');
const { resolveVimeosEmbed } = require('../lib/vimeos');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const ACCEPT_JSON = { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'es-MX,es;q=0.9' };

const rows = [];
const row = (site, step, note) => { rows.push({ site, step, note }); console.log(`| ${site} | ${step} | ${note} |`); };
const hostOf = (raw) => { try { return new URL(raw).hostname; } catch { return '?'; } };

const getJson = async (url, referer) => {
  const http = providerHttp(12_000, 6);
  const text = await http.text(url, { headers: { ...ACCEPT_JSON, Referer: referer } });
  try { return JSON.parse(text); } catch { return null; }
};

const embedsOf = (data) => {
  if (!data) return [];
  const bag = data.data ?? data;
  const list = bag.embeds || bag.servers || (Array.isArray(bag) ? bag : []);
  return (Array.isArray(list) ? list : []).filter((e) => e && (e.url || e.file));
};

async function resolve(site, embedUrl, referer) {
  const started = Date.now();
  try {
    const media = await resolveVimeosEmbed(embedUrl, referer, providerHttp(12_000, 6));
    const ms = Date.now() - started;
    row(site, 'vimeos', media
      ? `ok · kind=hls · subtítulos=${media.subtitles?.length || 0} · caduca=${media.expiresAt ? 'sí' : 'no'} · ${ms}ms`
      : `sin medio · ${ms}ms`);
  } catch (err) {
    row(site, 'vimeos', `error ${String(err?.message || err).slice(0, 60)}`);
  }
}

async function wpApiSite(site, base) {
  const search = await getJson(`${base}/wp-api/v1/search?q=the%20pitt&postType=any&postsPerPage=5`, `${base}/`);
  const post = (search?.data?.posts || []).find((p) => p.type !== 'movies');
  row(site, 'buscar', post ? `200 · «${String(post.title).slice(0, 30)}» ${post.type}:${post._id}` : 'sin resultado');
  if (!post) return;
  const eps = await getJson(`${base}/wp-api/v1/single/episodes/list?_id=${post._id}&season=1&page=1&postsPerPage=200`, `${base}/`);
  const ep = (eps?.data?.posts || []).find((e) => Number(e.episode_number) === 1);
  row(site, 'episodio', ep ? `1x1 · ${ep._id}` : 'sin episodios');
  if (!ep) return;
  const player = await getJson(`${base}/wp-api/v1/player?postId=${ep._id}&demo=0`, `${base}/`);
  const embeds = embedsOf(player);
  row(site, 'player', embeds.length
    ? `${embeds.length} embed(s) · ${embeds.slice(0, 3).map((e) => `${hostOf(e.url)}/${e.lang || e.language || '?'}/${e.quality || '?'}`).join(' · ')}`
    : 'sin embeds');
  if (embeds[0]) await resolve(site, embeds[0].url, `${base}/`);
}

async function allcalidad() {
  const base = 'https://allcalidad.re';
  const search = await getJson(`${base}/api/rest/search?post_type=movies&query=la%20odisea&posts_per_page=4`, `${base}/`);
  const post = (search?.data?.posts || search?.posts || [])[0];
  row('allcalidad.re', 'buscar', post ? `«${String(post.title).slice(0, 30)}» ${post._id}` : 'sin resultado');
  if (!post) return;
  const player = await getJson(`${base}/api/rest/player?post_id=${post._id}&_any=1`, `${base}/`);
  const embeds = embedsOf(player);
  row('allcalidad.re', 'player', embeds.length
    ? `${embeds.length} embed(s) · ${embeds.slice(0, 3).map((e) => `${hostOf(e.url)}/${e.lang || '?'}`).join(' · ')}`
    : 'sin embeds');
  if (embeds[0]) await resolve('allcalidad.re', embeds[0].url, `${base}/`);
}

async function hackstore() {
  const base = 'https://hackstore2.com';
  const single = await getJson(`${base}/api/rest/single?post_name=la-odisea&post_type=movies`, `${base}/`);
  const data = single?.data || {};
  row('hackstore2.com', 'ficha', data._id ? `«${String(data.title).slice(0, 30)}» ${data._id}` : 'sin ficha');
  if (!data._id) return;
  const player = await getJson(`${base}/api/rest/player?post_id=${data._id}`, `${base}/`);
  const embeds = embedsOf(player);
  row('hackstore2.com', 'player', embeds.length
    ? `${embeds.length} embed(s) · ${embeds.slice(0, 3).map((e) => `${hostOf(e.url)}/${e.lang || '?'}`).join(' · ')}`
    : 'sin embeds');
  if (embeds[0]) await resolve('hackstore2.com', embeds[0].url, `${base}/`);
}

async function main() {
  const fs = await import('node:fs');
  fs.mkdirSync('.probe', { recursive: true });
  const seccion = async (name, fn) => {
    try { await fn(); } catch (err) { row(name, 'error', String(err?.message || err).slice(0, 100)); }
  };
  await seccion('allpeliculas.la', () => wpApiSite('allpeliculas.la', 'https://allpeliculas.la'));
  await seccion('lamovie.org', () => wpApiSite('lamovie.org', 'https://lamovie.org'));
  await seccion('allcalidad.re', allcalidad);
  await seccion('hackstore2.com', hackstore);

  const md = ['| Sitio | Paso | Resultado |', '|---|---|---|'];
  for (const r of rows) md.push(`| ${r.site} | ${r.step} | ${r.note} |`);
  md.push('', 'Cadena buscar → episodio → player → Vimeos resuelto con el código del addon.');
  fs.writeFileSync('.probe/vimeos-chain.md', `${md.join('\n')}\n`);
  console.log(`\n${md.join('\n')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
