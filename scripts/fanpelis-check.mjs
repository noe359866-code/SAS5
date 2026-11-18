#!/usr/bin/env node
/**
 * Fanpelis (https://fanpelis.to) — sonda de viabilidad.
 *
 * Es la única web hispana encontrada que ofrece **API JSON pública** con las
 * tres cosas que hacen falta: buscar, listar episodios y pedir el reproductor.
 * No hay slug que adivinar, ni buscador que scrapear, ni PoW:
 *
 *   GET /api/rest/search?query=…&post_type=movies|tvshows   → _id, título, año
 *   GET /api/rest/episodes?post_id={serie}                  → _id por temporada
 *   GET /api/rest/player?post_id={obra|episodio}&_any=1      → embeds[] + downloads[]
 *
 * El campo `embeds[]` trae `url` (el iframe del reproductor), `lang` y
 * `quality` ya resueltos: si ese `url` es un host que Stremio puede reproducir
 * con `proxyHeaders`, el proveedor cuesta **tres GET y nada de CPU**.
 *
 * Lo que este script responde, que es lo único que decide:
 *
 *   1. ¿La API sigue abierta y con el mismo contrato?
 *   2. ¿`embeds[].url` apunta a un host jugable, o a un anuncio?
 *   3. ¿Ese host sirve un `.m3u8` descifrable sin navegador? (con --deep)
 *
 *   node scripts/fanpelis-check.mjs
 *   node scripts/fanpelis-check.mjs --query "breaking bad" --tv
 *   node scripts/fanpelis-check.mjs --deep --json
 *
 * Sale con código 1 si la búsqueda, el reproductor o ningún embed sirven.
 */

const BASE = 'https://fanpelis.to';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TIMEOUT_MS = Number(process.env.CHECK_TIMEOUT_MS) || 20_000;

/** Hosts de reproductor que el addon ya sabe tratar (iframe o HLS). */
const PLAYER_HOSTS = /^(?:https:\/\/)?(?:vimeos\.net|lamovie\.link|filemoon|vidhide|streamwish|streamtape|doodstream|dood\.|mixdrop|uqload|voe\.|dropload|unlimplay|netu|waaw)/i;
/** Dominios conocidos de descargas y trailers, no reproductores. */
const NOT_PLAYER = /^https:\/\/(?:mega\.nz|megaup|mediafire|1fichier|pixeldrain|uptobox|youtube|youtu\.be)/i;

function parseArgs(argv) {
  // Se aceptan las dos formas: `--query=matrix` y `--query matrix` (en el
  // workflow la segunda, entre comillas, se lee mejor).
  const options = { query: 'matrix', tv: false, json: false, deep: false, lang: '' };
  const valued = { '--query': 'query', '--lang': 'lang' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    if (eq > 0 && valued[arg.slice(0, eq)]) {
      options[valued[arg.slice(0, eq)]] = arg.slice(eq + 1);
    } else if (valued[arg] && i + 1 < argv.length) {
      options[valued[arg]] = argv[++i];
    } else if (arg === '--tv') options.tv = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--deep') options.deep = true;
  }
  return options;
}

function describe(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch (_) {
    return String(url).slice(0, 80);
  }
}

async function getJson(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        'Accept-Language': 'es-ES,es;q=0.9',
        Referer: `${BASE}/`,
        'X-Requested-With': 'XMLHttpRequest',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch (_) { /* se informa del texto */ }
    return { status: res.status, bytes: text.length, body, text };
  } finally {
    clearTimeout(timer);
  }
}

async function getText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*', 'Accept-Language': 'es-ES,es;q=0.9', Referer: `${BASE}/` },
      redirect: 'follow',
      signal: controller.signal,
    });
    return { status: res.status, text: await res.text(), final: res.url || url };
  } finally {
    clearTimeout(timer);
  }
}

/** Desempaquetador de Dean Edwards, el `eval(function(p,a,c,k,e,d)…)` de vimeos. */
function unpackPacked(html) {
  const m = String(html || '').match(
    /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('((?:\\'|[^'])*)',(\d+),(\d+),'((?:\\'|[^'])*)'\.split\('\|'\)/
  );
  if (!m) return '';
  let payload = m[1].replace(/\\'/g, "'");
  const radix = Number(m[2]);
  let count = Number(m[3]);
  const keywords = m[4].split('|');
  const encode = (n) => {
    let out = '';
    let v = n;
    do {
      const d = v % radix;
      out = (d < 36 ? d.toString(36) : String.fromCharCode(d + 29)) + out;
      v = Math.floor(v / radix);
    } while (v > 0);
    return out;
  };
  while (count--) {
    if (keywords[count]) payload = payload.replace(new RegExp(`\\b${encode(count)}\\b`, 'g'), keywords[count]);
  }
  return payload;
}

/** ¿El embed entrega un .m3u8 (y subtítulos) sin ejecutar su JavaScript? */
function mediaFromEmbed(html) {
  const text = unpackPacked(html) || String(html || '');
  const hls = [...new Set([...text.matchAll(/https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*/g)].map((x) => x[0]))];
  const vtt = [...new Set([...text.matchAll(/https?:\/\/[^\s"'\\]+\.vtt[^\s"'\\]*/g)].map((x) => x[0]))];
  return { hls, vtt, unpacked: Boolean(unpackPacked(html)) };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const kind = options.tv ? 'tvshows' : 'movies';
  const report = { base: BASE, query: options.query, kind, steps: {} };

  // 1. Búsqueda
  const search = await getJson(`/api/rest/search?query=${encodeURIComponent(options.query)}&post_type=${kind}&posts_per_page=3`);
  const posts = search.body?.data?.posts || search.body?.data?.data?.posts || [];
  report.steps.search = {
    status: search.status,
    bytes: search.bytes,
    posts: posts.length,
    error: search.body?.error,
    samples: posts.slice(0, 3).map((post) => `${post.title} / ${post.original_title || '?'} (${post.release_date || 's/f'}) · ${post._id}`),
  };
  if (!posts.length) {
    report.ok = false;
    report.verdict = 'la búsqueda no devuelve resultados: no integrar';
    return print(report, options);
  }

  // 2. Episodio (si es serie)
  let targetId = posts[0]._id;
  report.steps.episodes = { tried: false };
  if (options.tv) {
    const episodes = await getJson(`/api/rest/episodes?post_id=${posts[0]._id}`);
    const list = episodes.body?.data || [];
    const first = list
      .filter((item) => Number(item.season_number) === 1 && Number(item.episode_number) === 1)
      .sort((a, b) => String(a.slug).length - String(b.slug).length)[0] || list[0];
    report.steps.episodes = {
      tried: true,
      status: episodes.status,
      bytes: episodes.bytes,
      total: list.length,
      picked: first ? `${first.title} · ${first._id}` : null,
    };
    if (first) targetId = first._id;
  }

  // 3. Reproductor
  const player = await getJson(`/api/rest/player?post_id=${targetId}&_any=1`);
  const embeds = player.body?.data?.embeds || [];
  const downloads = player.body?.data?.downloads || [];
  const playable = embeds.filter((item) => item?.url && PLAYER_HOSTS.test(item.url));
  const junk = embeds.filter((item) => item?.url && (!PLAYER_HOSTS.test(item.url) || NOT_PLAYER.test(item.url)));
  report.steps.player = {
    status: player.status,
    bytes: player.bytes,
    embeds: embeds.length,
    playable: playable.length,
    downloads: downloads.length,
    languages: [...new Set(embeds.map((item) => item.lang).filter(Boolean))],
    samples: embeds.slice(0, 4).map((item) => `${item.lang || 's/i'} · ${item.quality || '?'} · ${describe(item.url)}`),
    junk: junk.slice(0, 3).map((item) => describe(item.url)),
  };

  // 4. ¿El embed se puede convertir en HLS sin navegador? (--deep)
  if (options.deep && playable.length) {
    // El embed es lo que decide: si de aquí sale un .m3u8, el proveedor es un
    // stream directo (proxy HLS propio, como SpinFlix); si no, es un iframe y
    // se sirve con proxyHeaders.
    report.steps.embeds = [];
    for (const sample of playable.slice(0, 2)) {
      try {
        const page = await getText(sample.url);
        const media = mediaFromEmbed(page.text);
        report.steps.embeds.push({
          url: describe(sample.url),
          status: page.status,
          bytes: page.text.length,
          unpacked: media.unpacked,
          hls: media.hls.slice(0, 2).map(describe),
          vtt: media.vtt.length,
          hosts: [...new Set([...media.hls, ...media.vtt].map((item) => describe(item).split('/')[0]))],
        });
      } catch (err) {
        report.steps.embeds.push({ url: describe(sample.url), error: `${err?.name || 'Error'}: ${err?.message || err}` });
      }
    }
  }

  report.ok = playable.length > 0;
  report.verdict = report.ok
    ? `${playable.length} embed(s) de host jugable por la API: el proveedor es viable sin navegador.`
    : 'la API responde pero no expone ningún host jugable: no integrar.';
  return print(report, options);
}

function print(report, options) {
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
    return;
  }
  const mark = (value) => (value ? '✔' : '✘');
  const s = report.steps;
  console.log(`Fanpelis · ${report.base} · «${report.query}» (${report.kind})\n`);
  console.log(`${mark(s.search?.posts)} búsqueda · HTTP ${s.search?.status} · ${s.search?.posts ?? 0} ficha(s)`);
  for (const sample of s.search?.samples || []) console.log(`      · ${sample}`);
  if (s.episodes?.tried) {
    console.log(`${mark(s.episodes.total)} episodios · HTTP ${s.episodes.status} · ${s.episodes.total} en la lista`);
    if (s.episodes.picked) console.log(`      · ${s.episodes.picked}`);
  }
  console.log(`${mark(s.player?.playable)} reproductor · HTTP ${s.player?.status} · ${s.player?.embeds ?? 0} embed(s), ${s.player?.playable ?? 0} jugable(s)`);
  if (s.player?.languages?.length) console.log(`      idiomas: ${s.player.languages.join(', ')}`);
  for (const sample of s.player?.samples || []) console.log(`      · ${sample}`);
  for (const item of s.player?.junk || []) console.log(`      ✘ descartado: ${item}`);
  for (const embed of s.embeds || []) {
    console.log(`${mark(embed.hls?.length)} embed ${embed.url} · HTTP ${embed.status} · ${embed.bytes} B · desempacado=${embed.unpacked}`);
    for (const url of embed.hls || []) console.log(`      · ${url}`);
    if (embed.vtt) console.log(`      · ${embed.vtt} pista(s) .vtt`);
    if (embed.error) console.log(`      ${embed.error}`);
  }
  if ((s.embeds || []).length && !(s.embeds || []).some((embed) => embed.hls?.length)) {
    console.log('      (sin .m3u8 en el HTML: el embed sería un iframe, no un stream directo)');
  }
  console.log(`\n${report.verdict}`);
  process.exitCode = report.ok ? 0 : 1;
}

main().catch((err) => {
  console.error('La sonda falló:', (err && err.message) || err);
  process.exitCode = 1;
});
