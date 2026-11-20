#!/usr/bin/env node
/**
 * Cuarta sonda: los huecos que quedaron de la tercera.
 *
 *   · allcalidad.re — ¿la rama de series (`/api/rest/episodes`) llega al
 *     episodio y al visor, o solo sirve películas?
 *   · allpeliculas.la y lamovie.org — la cadena de **película** (la tercera
 *     solo midió series) y la temporada 2 de una serie, para confirmar que el
 *     listado de episodios no se queda en la primera.
 *
 * No imprime URLs: estados, recuentos y hosts.
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
  try {
    const media = await resolveVimeosEmbed(embedUrl, referer, providerHttp(12_000, 6));
    row(site, 'vimeos', media ? `ok · hls · subtítulos=${media.subtitles?.length || 0}` : 'sin medio');
  } catch (err) { row(site, 'vimeos', `error ${String(err?.message || err).slice(0, 50)}`); }
}

async function allcalidadSeries() {
  const base = 'https://allcalidad.re';
  const search = await getJson(`${base}/api/rest/search?post_type=tvshows&query=the%20pitt&posts_per_page=4`, `${base}/`);
  const posts = search?.data?.posts || search?.posts || [];
  const post = posts[0];
  row('allcalidad.re', 'buscar serie', post ? `«${String(post.title || post.name).slice(0, 30)}» ${post._id} · tipo=${post.type || '?'}` : 'sin resultado');
  if (!post) return;
  for (const ruta of [
    `${base}/api/rest/episodes?post_id=${post._id}`,
    `${base}/api/rest/episodes?serie_id=${post._id}`,
    `${base}/api/rest/episodes?post_id=${post._id}&season=1`,
  ]) {
    const eps = await getJson(ruta, `${base}/`);
    const list = eps?.data?.posts || eps?.data?.episodes || eps?.posts || eps?.episodes || [];
    row('allcalidad.re', `episodios ${ruta.split('?')[1].split('=')[0]}`, Array.isArray(list) ? `episodios=${list.length}${list[0] ? ` · ep1=${list[0]._id} s${list[0].season_number || '?'}e${list[0].episode_number || '?'}` : ''}` : 'sin lista');
    if (Array.isArray(list) && list.length) {
      const first = list.find((e) => Number(e.episode_number) === 1) || list[0];
      const player = await getJson(`${base}/api/rest/player?post_id=${first._id}&_any=1`, `${base}/`);
      const embeds = embedsOf(player);
      row('allcalidad.re', 'player episodio', embeds.length ? `${embeds.length} · ${hostOf(embeds[0].url)}/${embeds[0].lang || '?'}` : 'sin embeds');
      if (embeds[0]) await resolve('allcalidad.re', embeds[0].url, `${base}/`);
      break;
    }
  }
}

async function wpApiMovie(site, base) {
  const search = await getJson(`${base}/wp-api/v1/search?q=la%20odisea&postType=any&postsPerPage=6`, `${base}/`);
  const posts = search?.data?.posts || [];
  row(site, 'buscar película', posts.length ? posts.slice(0, 3).map((p) => `${p.type}:${p._id}`).join(' ') : 'sin resultado');
  const movie = posts.find((p) => p.type === 'movies');
  if (movie) {
    const player = await getJson(`${base}/wp-api/v1/player?postId=${movie._id}&demo=0`, `${base}/`);
    const embeds = embedsOf(player);
    row(site, 'player película', embeds.length ? `${embeds.length} · ${hostOf(embeds[0].url)}/${embeds[0].lang || '?'}` : 'sin embeds');
    if (embeds[0]) await resolve(site, embeds[0].url, `${base}/`);
  }
  // Temporada 2: ¿el listado de episodios responde a otras temporadas?
  const show = posts.length ? await getJson(`${base}/wp-api/v1/search?q=the%20pitt&postType=any&postsPerPage=4`, `${base}/`) : null;
  const tv = (show?.data?.posts || []).find((p) => p.type !== 'movies');
  if (!tv) { row(site, 'serie', 'sin ficha de serie'); return; }
  const eps = await getJson(`${base}/wp-api/v1/single/episodes/list?_id=${tv._id}&season=1&page=1&postsPerPage=200`, `${base}/`);
  const list = eps?.data?.posts || [];
  row(site, 'episodios T1', `episodios=${list.length} · temporadas=${(eps?.data?.seasons || []).map((s) => s.season_number ?? s.number ?? s).slice(0, 4).join(',') || '?'}`);
}

async function main() {
  const fs = await import('node:fs');
  fs.mkdirSync('.probe', { recursive: true });
  const seccion = async (name, fn) => {
    try { await fn(); } catch (err) { row(name, 'error', String(err?.message || err).slice(0, 100)); }
  };
  await seccion('allcalidad.re', allcalidadSeries);
  await seccion('allpeliculas.la', () => wpApiMovie('allpeliculas.la', 'https://allpeliculas.la'));
  await seccion('lamovie.org', () => wpApiMovie('lamovie.org', 'https://lamovie.org'));

  const md = ['| Sitio | Paso | Resultado |', '|---|---|---|'];
  for (const r of rows) md.push(`| ${r.site} | ${r.step} | ${r.note} |`);
  md.push('', 'Cuarta sonda: rama de series en allcalidad y cadena de película en la familia wp-api.');
  fs.writeFileSync('.probe/calidad-chain.md', `${md.join('\n')}\n`);
  console.log(`\n${md.join('\n')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
