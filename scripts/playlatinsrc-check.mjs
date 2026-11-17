#!/usr/bin/env node
/**
 * PlayLatinSRC (https://playlatinsrc.co) — sonda de viabilidad.
 *
 * Es la única de las fuentes hispanas probadas que se parece a lo que necesita
 * el addon: **API pública documentada y direccionada por IMDb**.
 *
 *   /custom/movie/{imdb}                  película, arranca directo
 *   /custom/serial/{imdb}/{temporada}/{e}  episodio concreto
 *   /movie/{imdb}   · /serial/{imdb}       reproductor estándar
 *   /download/{imdb}                       enlaces de descarga (pide captcha)
 *
 * Catálogo declarado: 21.615 películas, 289 series, 11.428 episodios, tres
 * idiomas (Latino, Castellano, Subtitulado) en el mismo embed.
 *
 * Lo que este script responde, que es lo único que decide:
 *
 *   1. ¿El embed trae la URL del host de vídeo en el HTML, o solo el nombre?
 *   2. ¿Es un iframe de un host conocido (unlimplay, dropload, doodstream,
 *      mixdrop…) al que Stremio puede apuntar con proxyHeaders?
 *
 * El embed es una cáscara de ~3 KB que se rellena por JavaScript, así que las
 * URLs que aparecen ahí son la única vía sin navegador. Si aparecen, se puede
 * escribir el proveedor; si no, no.
 *
 *   node scripts/playlatinsrc-check.mjs
 *   node scripts/playlatinsrc-check.mjs --movie tt0110357 --serial tt0108778 --season 1 --episode 1
 *   node scripts/playlatinsrc-check.mjs --json
 *
 * Sale con código 1 si ninguna de las páginas devuelve un host jugable.
 */

const BASE = 'https://playlatinsrc.co';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TIMEOUT_MS = Number(process.env.CHECK_TIMEOUT_MS) || 20_000;

/** Hosts que sabemos reproducir (o que al menos son embeds reales). */
const HOSTS = /(?:unlimplay|dropload|dr0pstream|doodstream|dood\.|mixdrop|streamtape|voe\.|filemoon|vidhide|streamwish|uqload)/i;

function parseArgs(argv) {
  const options = { movie: 'tt0110357', serial: 'tt0108778', season: 1, episode: 1, json: false };
  for (const arg of argv) {
    if (arg.startsWith('--movie=')) options.movie = arg.split('=')[1];
    else if (arg.startsWith('--serial=')) options.serial = arg.split('=')[1];
    else if (arg.startsWith('--season=')) options.season = Number(arg.split('=')[1]);
    else if (arg.startsWith('--episode=')) options.episode = Number(arg.split('=')[1]);
    else if (arg === '--json') options.json = true;
  }
  return options;
}

async function get(url, referer) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'es-ES,es;q=0.9',
      Referer: referer || `${BASE}/`,
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: res.status, final: res.url, text: await res.text() };
}

/**
 * URLs de host de vídeo dentro del HTML. Se buscan aunque no estén en un
 * `src=`: en PlayLatin aparecen en atributos de íconos (p. ej. `data-src` de
 * la miniatura del servidor), y eso ya es la URL del embed.
 */
function playerUrls(html) {
  const found = [];
  const push = (raw) => {
    if (!raw) return;
    const url = String(raw).replace(/&amp;/g, '&');
    if (!/^https?:\/\//i.test(url)) return;
    if (!HOSTS.test(url)) return;
    if (!found.includes(url)) found.push(url);
  };
  for (const match of html.matchAll(/https?:\/\/[^\s"'<>\\]+/gi)) push(match[0]);
  return found.filter((url) => {
    // Descartar imágenes y CSS: solo nos interesan páginas de embed.
    return !/\.(?:png|jpe?g|webp|svg|gif|css|js|ico)(?:$|[?#])/i.test(url);
  });
}

/** Formato de cada URL: host + ruta base, sin query (puede llevar token). */
function describe(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch (_) {
    return url.slice(0, 60);
  }
}

async function check(label, path) {
  const url = `${BASE}${path}`;
  const out = { label, path, url };
  try {
    const page = await get(url);
    out.status = page.status;
    out.bytes = page.text.length;
    out.redirectedTo = page.final !== url ? describe(page.final) : null;
    out.servers = playerUrls(page.text);
    out.embeds = out.servers.length;
    out.samples = out.servers.slice(0, 4).map(describe);
    out.captcha = /captcha|no es un robot|verify you are human/i.test(page.text);
    out.ok = page.status === 200 && out.embeds > 0;
    if (!out.ok) {
      out.note = out.captcha
        ? 'pide captcha'
        : /Playback unavailable|No active stream source/i.test(page.text)
          ? 'el título no está en su catálogo o no hay fuente activa'
          : 'sin URL de host en el HTML';
    }
  } catch (err) {
    out.error = `${(err && err.name) || 'Error'}: ${(err && err.message) || err}`;
    out.ok = false;
  }
  return out;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const results = [
    await check('película (custom)', `/custom/movie/${options.movie}`),
    await check('episodio (custom)', `/custom/serial/${options.serial}/${options.season}/${options.episode}`),
    await check('película (estándar)', `/movie/${options.movie}`),
    await check('descarga', `/download/${options.movie}`),
  ];

  if (options.json) {
    console.log(JSON.stringify({ base: BASE, results }, null, 2));
  } else {
    console.log(`PlayLatinSRC · ${BASE}\n`);
    for (const item of results) {
      console.log(`${item.ok ? '✔' : '✘'} ${item.label} · ${item.path}`);
      if (item.error) console.log(`    ${item.error}`);
      if (item.bytes) console.log(`    HTTP ${item.status} · ${item.bytes} B · ${item.embeds} host(s)`);
      if (item.redirectedTo) console.log(`    redirige a ${item.redirectedTo}`);
      for (const sample of item.samples || []) console.log(`      · ${sample}`);
      if (item.note) console.log(`    ${item.note}`);
    }
    const usable = results.filter((item) => item.ok);
    console.log(
      usable.length
        ? `\n${usable.length} página(s) con host jugable en el HTML: el proveedor es viable sin navegador.`
        : '\nNinguna página expone el host en el HTML: haría falta un navegador. No integrar.'
    );
  }

  process.exitCode = results.some((item) => item.ok) ? 0 : 1;
}

main().catch((err) => {
  console.error('La sonda falló:', (err && err.message) || err);
  process.exitCode = 1;
});
