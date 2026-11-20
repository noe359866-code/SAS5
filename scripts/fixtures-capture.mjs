#!/usr/bin/env node
/**
 * Captura las respuestas reales de Allpelículas y LaMovie para las pruebas.
 *
 * Escribe en `.probe/fixtures/` (el workflow de sondas versiona `.probe/*.json`)
 * y no toca `test/fixtures/`: así la revisión de un fixture pasa por un commit
 * consciente y no por una sonda automática.
 *
 * Uso: `node scripts/fixtures-capture.mjs`
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'es-MX,es;q=0.9' };
const TIMEOUT = 12_000;

async function fetchText(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { ...HEADERS, Referer: referer } });
    return { status: res.status, body: (await res.text()).slice(0, 512 * 1024) };
  } catch (err) {
    return { status: 0, body: '', error: String(err?.name || err?.message || err).slice(0, 40) };
  } finally { clearTimeout(timer); }
}

const SITES = [
  ['allpeliculas', 'https://allpeliculas.la'],
  ['lamovie', 'https://lamovie.org'],
];

async function main() {
  const fs = await import('node:fs');
  const dir = '.probe/fixtures';
  fs.mkdirSync(dir, { recursive: true });
  const report = [];

  for (const [key, base] of SITES) {
    const steps = [
      ['search-serie', `${base}/wp-api/v1/search?q=the%20pitt&postType=any&postsPerPage=5`],
      ['search-pelicula', `${base}/wp-api/v1/search?q=la%20odisea&postType=any&postsPerPage=5`],
    ];
    for (const [label, url] of steps) {
      const res = await fetchText(url, `${base}/`);
      if (res.status === 200) fs.writeFileSync(`${dir}/${key}-${label}.json`, res.body);
      report.push(`${key} ${label}: ${res.status} ${res.body.length}B`);
    }

    // Episodios y reproductor del primer episodio de la serie encontrada.
    let posts = [];
    try { posts = JSON.parse(fs.readFileSync(`${dir}/${key}-search-serie.json`, 'utf8'))?.data?.posts || []; } catch { /* sin búsqueda */ }
    const show = posts.find((post) => post && post.type !== 'movies');
    if (show) {
      const eps = await fetchText(`${base}/wp-api/v1/single/episodes/list?_id=${show._id}&season=1&page=1&postsPerPage=50`, `${base}/`);
      if (eps.status === 200) fs.writeFileSync(`${dir}/${key}-episodes.json`, eps.body);
      report.push(`${key} episodios: ${eps.status} ${eps.body.length}B`);
      let first = null;
      try { first = (JSON.parse(eps.body)?.data?.posts || []).find((ep) => Number(ep.episode_number) === 1); } catch { /* sin episodios */ }
      if (first) {
        const player = await fetchText(`${base}/wp-api/v1/player?postId=${first._id}&demo=0`, `${base}/`);
        if (player.status === 200) fs.writeFileSync(`${dir}/${key}-player-episodio.json`, player.body);
        report.push(`${key} player episodio: ${player.status} ${player.body.length}B`);
      }
    }

    // Reproductor de la película encontrada.
    let movies = [];
    try { movies = JSON.parse(fs.readFileSync(`${dir}/${key}-search-pelicula.json`, 'utf8'))?.data?.posts || []; } catch { /* sin búsqueda */ }
    const movie = movies.find((post) => post && post.type === 'movies');
    if (movie) {
      const player = await fetchText(`${base}/wp-api/v1/player?postId=${movie._id}&demo=0`, `${base}/`);
      if (player.status === 200) fs.writeFileSync(`${dir}/${key}-player-pelicula.json`, player.body);
      report.push(`${key} player película: ${player.status} ${player.body.length}B`);
    }
  }

  // AnimeAV1: buscador, ficha y episodio (HTML real, con los embeds SUB/DUB).
  const animeBase = 'https://animeav1.com';
  const catalog = await fetchText(`${animeBase}/catalogo?search=${encodeURIComponent('ore dake level up na ken')}`, `${animeBase}/`);
  if (catalog.status === 200) fs.writeFileSync(`${dir}/animeav1-catalogo.html`, catalog.body);
  report.push(`animeav1 catálogo: ${catalog.status} ${catalog.body.length}B`);
  const media = (catalog.body.match(/href="([^"]*\/media\/[^"/]+)"/) || [])[1] || '';
  if (media) {
    const mediaUrl = new URL(media, animeBase).href;
    const detail = await fetchText(mediaUrl, `${animeBase}/`);
    if (detail.status === 200) fs.writeFileSync(`${dir}/animeav1-ficha.html`, detail.body);
    report.push(`animeav1 ficha: ${detail.status} ${detail.body.length}B`);
    const episode = await fetchText(`${mediaUrl.replace(/\/+$/, '')}/1`, mediaUrl);
    if (episode.status === 200) fs.writeFileSync(`${dir}/animeav1-episodio.html`, episode.body);
    report.push(`animeav1 episodio: ${episode.status} ${episode.body.length}B`);
  }

  fs.writeFileSync('.probe/fixtures.md', ['| Paso | Respuesta |', '|---|---|', ...report.map((line) => `| ${line.split(': ')[0]} | ${line.split(': ')[1]} |`), ''].join('\n'));
  console.log(report.join('\n'));
}

main().catch((err) => { console.error(err); process.exit(1); });
