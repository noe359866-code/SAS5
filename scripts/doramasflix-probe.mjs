#!/usr/bin/env node
/**
 * API GraphQL de la familia seriesapi.co (doramasflix.in y espejos).
 * Comprueba que desde el servidor se pueden identificar obra, temporada,
 * episodio y idioma, y que los enlaces declarados llegan a un medio directo.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
const { extractEmbed, extractorFor } = require('../lib/extractors');
const { isDirectMedia } = require('../lib/directMedia');

const ENDPOINT = 'https://user-api.seriesapi.co/graphql';
const BASE = 'https://doramasflix.in';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'Content-Type': 'application/json', Origin: BASE, Referer: `${BASE}/`, 'User-Agent': UA, Accept: 'application/json' };
const TIMEOUT = 15_000;

const Q_SEARCH = `query Search($input: String!) { searchFullDoramas(input: $input, page: 1, perPage: 8) { items { _id slug name name_es poster_path } } }`;
const Q_DETAIL = `query Detail($slug: String!) { detailDorama(filter: {slug: $slug}) { _id name name_es slug overview number_of_seasons number_of_episodes seasons { season_number number_of_episodes } } }`;
const Q_EPISODE = `query Episode($slug: String!) { detailEpisode(filter: {slug: $slug}) { _id name slug episode_number season_number } }`;
const Q_LINKS = `query Links($id: ID!) { getEpisodeLinks(id: $id) { links_online { _id server lang link } } }`;

const rows = [];
const row = (step, http, state, detail) => {
  rows.push({ step, http, state, detail });
  console.log(`| ${step} | ${http} | ${state} | ${detail} |`);
};
const redact = (raw) => {
  try { const u = new URL(String(raw)); return `${u.hostname}${u.pathname.slice(0, 72)}${u.search ? `?(${u.search.length} B)` : ''}`; } catch { return String(raw || '').slice(0, 90); }
};

async function gql(query, variables) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(ENDPOINT, { method: 'POST', headers: HEADERS, body: JSON.stringify({ query, variables }), signal: controller.signal });
    const json = await res.json();
    return { status: res.status, data: json?.data || null, error: json?.errors?.[0]?.message || '' };
  } catch (err) { return { status: 0, data: null, error: err?.name || String(err).slice(0, 40) }; }
  finally { clearTimeout(timer); }
}

async function get(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*', ...headers }, signal: controller.signal });
    return { status: res.status, body: (await res.text()).slice(0, 900 * 1024) };
  } catch (err) { return { status: 0, body: '', error: err?.name || String(err).slice(0, 40) }; }
  finally { clearTimeout(timer); }
}

function decodeEmbed(raw) {
  const token = String(raw || '').split('/e/')[1];
  if (!token) return String(raw || '');
  try {
    const json = JSON.parse(Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (json.link) return Buffer.from(json.link, 'base64').toString('utf8');
  } catch { /* se deja tal cual */ }
  return String(raw);
}

async function main() {
  fs.mkdirSync('.probe', { recursive: true });
  const search = await gql(Q_SEARCH, { input: 'The Blue Road' });
  const items = search.data?.searchFullDoramas?.items || [];
  row('buscar', search.status, `${items.length} fichas`, `${search.error} ${items.slice(0, 3).map((item) => `${item.slug} (${item.name_es || item.name})`).join(' · ')}`);
  const item = items.find((entry) => /blue-road/i.test(entry.slug)) || items[0];
  if (!item) return;

  const detail = await gql(Q_DETAIL, { slug: item.slug });
  const d = detail.data?.detailDorama;
  row('ficha', detail.status, d ? 'OK' : (detail.error || 'sin-ficha'), d ? `${d.name_es || d.name} · temporadas=${d.number_of_seasons} · episodios=${d.number_of_episodes} · seasons=${JSON.stringify(d.seasons || []).slice(0, 120)}` : '');
  const html = await get(`${BASE}/doramas-online/${item.slug}`);
  const year = (/datePublished"\s*:\s*"(?:19|20)\d{2}/.exec(html.body) || /\b(20\d{2})\b/.exec(html.body.replace(/<[^>]+>/g, ' ')) || [])[0]?.slice(0, 4) || '';
  row('año HTML', html.status, year || 'sin-año', `${html.body.length} B`);

  const epSlug = `${item.slug}-1x1`;
  const episode = await gql(Q_EPISODE, { slug: epSlug });
  const ep = episode.data?.detailEpisode;
  row('episodio', episode.status, ep ? `T${ep.season_number}E${ep.episode_number}` : (episode.error || 'sin-episodio'), `${epSlug} · id=${ep?._id || '—'}`);
  if (!ep) return;

  const links = await gql(Q_LINKS, { id: ep._id });
  const raw = links.data?.getEpisodeLinks?.links_online || [];
  row('enlaces', links.status, `${raw.length}`, raw.map((link) => `${link.server}/${link.lang || 'sin-idioma'}`).join(' · '));
  for (const link of raw.slice(0, 5)) {
    const decoded = decodeEmbed(link.link);
    const kind = extractorFor(decoded);
    row(`· ${link.server}`, '—', `${kind || 'sin-extractor'} · ${link.lang || 'sin-idioma'}`, redact(decoded));
    if (!kind || kind === 'opaque' || !isDirectMedia(decoded)) continue;
    const extracted = await extractEmbed(decoded, { timeoutMs: 12_000, referer: `${BASE}/` }).catch((err) => ({ ok: false, sources: [], reason: String(err?.message || err).slice(0, 40) }));
    if (!extracted.ok) { row(`  visor`, '—', extracted.reason || 'sin-medio', kind); continue; }
    for (const source of extracted.sources.slice(0, 2)) {
      const res = await get(source.url, { Accept: 'application/vnd.apple.mpegurl' });
      row(`  medio`, res.status, `${/^\s*#EXTM3U/.test(res.body) ? 'HLS' : 'otro'} · ${source.kind}`, redact(source.url));
    }
  }
  const md = ['| Paso | HTTP | Resultado | Detalle |', '|---|---|---|---|'];
  for (const r of rows) md.push(`| ${r.step} | ${r.http} | ${r.state} | ${r.detail} |`);
  md.push('', 'GraphQL de seriesapi.co con el código de extracción del addon; sin URLs firmadas en claro.', '');
  fs.writeFileSync('.probe/doramasflix.md', `${md.join('\n')}\n`);
  console.log(`\n${md.join('\n')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
