#!/usr/bin/env node
/**
 * Sonda de fuentes candidatas: mira el HTML CRUDO de una web y dice qué hay
 * dentro de verdad (iframes, embeds, .m3u8/.mp4, `__NEXT_DATA__`), sin
 * interpretarlo.
 *
 *   node scripts/sources-probe.mjs https://flixlatam.com/pelicula/interstellar
 *   node scripts/sources-probe.mjs --gql           # ¿sigue viva la API de Doramasflix?
 *   node scripts/sources-probe.mjs --dump <url>    # qué hay dentro de `servidores`/`links_online`
 *   node scripts/sources-probe.mjs --chain <url>   # sigue el iframe del reproductor un paso más
 *   node scripts/sources-probe.mjs --media <url>   # ¿ese embed entrega el .m3u8 sin navegador?
 *
 * Existe porque evaluar una web desde un sandbox sin salida a Internet acaba en
 * suposiciones: esto se ejecuta donde sí hay red (un runner de GitHub Actions,
 * o local) y devuelve hechos. No extrae ni reproduce nada: solo lista lo que
 * encuentra, con el host de cada URL y sin los parámetros (pueden llevar token).
 *
 * Sale con código 2 si no se le pasa ninguna URL (y con 1 si alguna falla), para
 * poder usarlo como paso de CI.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS) || 20_000;

/**
 * Pistas de reproductor: si el HTML trae estos hosts o patrones, hay algo
 * jugable o un desvío detectable. Si no aparece ninguno, el player lo inyecta
 * JavaScript y un addon HTTP puro no puede llegar a él.
 */
const PLAYER_HINTS = {
  voe: /voe\.(?:sx|com|st|to|be)|voe-sx|voe\./i,
  streamtape: /streamtape/i,
  filemoon: /filemoon|filelions/i,
  mixdrop: /mixdrop/i,
  waaw: /waaw\./i,
  upstream: /upstream\./i,
  streamhub: /streamhub\./i,
  embedwish: /embedwish/i,
  veev: /veev\./i,
  streamplay: /streamplay/i,
  dooood: /dooood|dood\./i,
  uqload: /uqload/i,
  vidhide: /vidhide|luluvdo|minochinos/i,
  dropload: /dropload|dr0pstream/i,
  doodstream: /doodstream|dood\.(?:re|sh|to|watch|so)/i,
  unlimplay: /unlimplay/i,
  // Muros que NO se pueden pasar desde un Worker.
  captcha: /captcha|hcaptcha|recaptcha|turnstile|no es un robot|verify you are human/i,
  m3u8: /\.m3u8/i,
  goto: /goto\.php/i,
  cryptojs: /CryptoJS|AES\.decrypt|Salted__/,
  // Firma exacta del reproductor de Embed69: si aparece, la página es suya
  // (o un espejo suyo) y sirve el mismo parser y el mismo PoW.
  pow: /POW_CHALLENGE|POW_DIFFICULTY|POW_SALT/,
  dataLink: /dataLink/,
  sortedEmbeds: /sortedEmbeds/,
  videoLanguage: /video_language/,
  ajax: /admin-ajax\.php|wp-json\/[a-z0-9_-]+\/v1/i,
};

function playerHints(html) {
  const found = [];
  for (const [name, pattern] of Object.entries(PLAYER_HINTS)) {
    const count = (html.match(new RegExp(pattern.source, 'gi')) || []).length;
    if (count) found.push(`${name}×${count}`);
  }
  return found;
}

/** URL sin query ni credenciales: los embeds llevan token en la query. */
function safe(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch (_) {
    return String(url).slice(0, 80);
  }
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch (_) {
    return '?';
  }
}

/** URLs absolutas de iframes y de atributos que suelen llevar el embed. */
function embedsIn(html, pageUrl) {
  const out = [];
  const push = (raw) => {
    if (!raw) return;
    let abs;
    try {
      abs = new URL(raw.replace(/&amp;/g, '&'), pageUrl).toString();
    } catch (_) {
      return;
    }
    if (!/^https?:/i.test(abs)) return;
    if (!out.some((seen) => seen === abs)) out.push(abs);
  };
  for (const match of html.matchAll(/<iframe\b[^>]*>/gi)) {
    const src = /\b(?:src|data-src)\s*=\s*["']([^"']+)["']/i.exec(match[0]);
    if (src) push(src[1]);
  }
  for (const match of html.matchAll(/\b(?:data-server-url|data-embed|data-link|data-url|embed_url|link_online)\s*[":=]+\s*["'](https?:[^"']+)["']/gi)) {
    push(match[1]);
  }
  return out;
}

async function probe(url) {
  const started = Date.now();
  const result = { url: safe(url), ok: false };
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'es-ES,es;q=0.9',
        Referer: new URL(url).origin + '/',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const html = await res.text();
    result.status = res.status;
    result.bytes = html.length;
    result.finalUrl = safe(res.url || url);
    result.ok = res.ok;

    const embeds = embedsIn(html, res.url || url);
    result.iframes = embeds.length;
    result.hosts = [...new Set(embeds.map(hostOf))].slice(0, 8);
    result.samples = embeds.slice(0, 4);
    result.m3u8 = (html.match(/\.m3u8/gi) || []).length;
    result.mp4 = (html.match(/\.mp4/gi) || []).length;
    result.nextData = /__NEXT_DATA__/.test(html);
    result.flight = /self\.__next_f\.push/.test(html);
    // Claves típicas de las webs que sirven los enlaces desde su propio JSON.
    for (const key of ['links_online', 'stream_urls', 'players', 'servidores', 'reproductores']) {
      if (html.includes(key)) result[key] = (html.match(new RegExp(key, 'g')) || []).length;
    }
    result.anubis = /within\.website\/x\/cmd\/anubis|Making sure you're not a bot/i.test(html);
    result.hints = playerHints(html);
    result.ms = Date.now() - started;
  } catch (err) {
    result.error = `${(err && err.name) || 'Error'}: ${(err && err.message) || err}`;
    result.ms = Date.now() - started;
  }
  return result;
}

/** ¿La API GraphQL que usa el adaptador de Doramasflix sigue en pie? */
async function probeDoramasGql() {
  const url = 'https://sv1.fluxcedene.net/api/gql';
  const body = {
    operationName: 'searchAll',
    variables: { input: 'amor' },
    query: 'query searchAll($input: String!) { searchDorama(input: $input, limit: 2) { name slug } }',
  };
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'User-Agent': UA,
        Referer: 'https://doramasflix.in/',
        platform: 'doramasflix',
        authorization: 'Bear',
        'x-access-jwt-token': '',
        'x-access-platform': 'RxARncfg1S_MdpSrCvreoLu_SikCGMzE1NzQzODc3NjE2MQ==',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    const missingPlatform = /platform|x-access/i.test(text) && !/searchDorama/.test(text);
    return {
      url,
      status: res.status,
      ms: Date.now() - started,
      bytes: text.length,
      ok: res.ok && /searchDorama/.test(text),
      detail: res.ok ? text.slice(0, 200) : text.replace(/\s+/g, ' ').slice(0, 120),
      note: missingPlatform ? 'parece rechazar la cabecera x-access-platform' : null,
    };
  } catch (err) {
    return { url, ok: false, error: `${(err && err.name) || 'Error'}: ${(err && err.message) || err}`, ms: Date.now() - started };
  }
}

/**
 * Enseña lo que hay DENTRO de las claves que sirven los enlaces (payload RSC o
 * JSON incrustado). Sin esto, «servidores×6» no dice si son nombres de host o
 * URLs jugables. Se redacta cualquier cadena con pinta de token, y las URLs se
 * muestran sin query.
 */
async function dump(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,*/*', 'Accept-Language': 'es-ES,es;q=0.9' },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const html = await res.text();
  const out = [`HTTP ${res.status} · ${html.length} B · ${safe(res.url || url)}`];
  const redact = (text) => text
    .replace(/("(?:token|hash|sig|signature|key|pass|password|jwt)"\s*:\s*")[^"]{4,}/gi, '$1<redactado>')
    .replace(/\?[^"'\\\s]{16,}/g, '?<redactado>');
  for (const key of ['dataLink', 'sortedEmbeds', 'dropload', 'unlimplay', 'videos', 'cyberlocker', 'result', 'sources', 'streams', 'servers', 'embed_url', 'servidores', 'links_online', 'stream_urls', 'players']) {
    let from = 0;
    let shown = 0;
    while (shown < 2) {
      const at = html.indexOf(key, from);
      if (at < 0) break;
      from = at + key.length;
      const chunk = redact(html.slice(at, at + 900)).replace(/\s+/g, ' ');
      out.push(`\n[${key}] …${chunk}…`);
      shown++;
    }
  }
  const hosts = [...new Set((html.match(/https?:\/\/[a-z0-9.-]+/gi) || []).map(hostOf))]
    .filter((host) => !/image\.tmdb|doramasflix|googletag|gstatic|fonts\./i.test(host));
  out.push(`\nhosts en el payload: ${hosts.slice(0, 20).join(', ') || '(ninguno)'}`);

  // Contexto alrededor de los hosts que sirven vídeo: es lo que decide si la
  // URL de un servidor está en el HTML o si la pide el navegador por AJAX.
  const SERVERS = /vidhide|filemoon|streamwish|uqload|voe\.|streamtape|mixdrop|waaw|upstream|streamhub|embedwish/i;
  for (const host of hosts) {
    if (!SERVERS.test(host)) continue;
    const at = html.search(new RegExp(`https?://${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'));
    if (at < 0) continue;
    const context = redact(html.slice(Math.max(0, at - 160), at + 260)).replace(/\s+/g, ' ');
    out.push(`\n[${host}] …${context}…`);
  }
  return out.join('\n');
}

/**
 * Encadena un paso más: pide la página, saca el iframe que parece el
 * reproductor (no el tráiler) y lo pide también. Es la prueba que separa «la
 * web tiene un endpoint de player» de «el player lo monta el navegador».
 * Solo imprime host+path: los tokens van en la query.
 */
async function chain(url) {
  const first = await probe(url);
  const out = [`[1] ${line(first)}`];
  const pageUrl = url;
  const candidates = (first.samples || [])
    .filter((sample) => !/youtube\.com|youtu\.be|google/i.test(sample))
    .filter((sample) => !/[?#]/.test(sample) || true);
  if (!candidates.length) {
    out.push('    sin iframes que seguir: el reproductor no está en el HTML');
    return out.join('\n');
  }
  for (const candidate of candidates.slice(0, 3)) {
    let res;
    let text = '';
    try {
      res = await fetch(candidate, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/json,*/*',
          'Accept-Language': 'es-ES,es;q=0.9',
          Referer: pageUrl,
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      text = await res.text();
    } catch (err) {
      out.push(`[2] ✘ ${safe(candidate)} · ${(err && err.name) || 'Error'}`);
      continue;
    }
    const embeds = embedsIn(text, res.url || candidate);
    const hints = playerHints(text);
    const hosts = [...new Set(embeds.map(hostOf))].slice(0, 6);
    // ¿Es una lista de servidores en JSON? Se enseñan las claves, no los valores.
    let keys = [];
    try {
      const parsed = JSON.parse(text);
      keys = Object.keys(parsed).slice(0, 12);
    } catch (_) { /* no es JSON */ }
    const bits = [
      `HTTP ${res.status}`,
      `${text.length} B`,
      `final ${safe(res.url || candidate)}`,
      embeds.length ? `embeds ${embeds.length} · hosts ${hosts.join(',')}` : 'embeds 0',
    ];
    if (hints.length) bits.push(`pistas ${hints.join(',')}`);
    if (keys.length) bits.push(`json {${keys.join(',')}}`);
    if (/goto\.php|fotise|financialtrust|ggpick/i.test(text)) bits.push('OJO: publicidad/desvío');
    out.push(`[2] ${res.ok ? '✔' : '✘'} ${safe(candidate)} · ${bits.join(' · ')}`);
    for (const sample of embeds.slice(0, 3)) out.push(`      · ${safe(sample)}`);
  }
  const apiPaths = [...new Set(html.match(/(?:https?:\/\/[^"\s]+)?\/(?:api|v1|v2)\/[a-z0-9_\/-]{2,60}/gi) || [])]
    .slice(0, 12);
  if (apiPaths.length) out.push(`\nrutas de API en el HTML: ${apiPaths.join(', ')}`);
  return out.join('\n');
}

/** Desempaquetador de Dean Edwards (`eval(function(p,a,c,k,e,d)…)`). */
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

/**
 * ¿Un embed concreto entrega el vídeo sin navegador?
 *
 * Es la última pregunta de la cadena de evaluación: puede saberse la URL del
 * embed y aun así no haber nada jugable, porque el reproductor monte el
 * `.m3u8` por JavaScript. Aquí se mira el HTML tal cual y, si viene
 * empaquetado con el `eval(function(p,a,c,k,e,d)…)` de Dean Edwards (lo que
 * hace vimeos.net), se desempaqueta sin ejecutar nada.
 *
 *   node scripts/sources-probe.mjs --media https://vimeos.net/embed-x.html
 */
async function media(url) {
  const out = [];
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*', 'Accept-Language': 'es-ES,es;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return `✘ ${safe(url)} · ${(err && err.name) || 'Error'}: ${(err && err.message) || err}`;
  }
  const html = await res.text();
  const unpacked = unpackPacked(html);
  const text = unpacked || html;
  const hls = [...new Set((text.match(/https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*/g) || []))];
  const vtt = [...new Set((text.match(/https?:\/\/[^\s"'\\]+\.vtt[^\s"'\\]*/g) || []))];
  const mp4 = [...new Set((text.match(/https?:\/\/[^\s"'\\]+\.mp4[^\s"'\\]*/g) || []))];
  const players = ['jwplayer', 'hls\.js|hlsjs', 'videojs', 'plyr', 'clappr', 'dplayer']
    .filter((name) => new RegExp(name, 'i').test(text));
  out.push(`${res.ok ? '✔' : '✘'} ${safe(url)} · HTTP ${res.status} · ${html.length} B · desempacado=${Boolean(unpacked)}`);
  if (players.length) out.push(`    reproductor: ${players.join(', ')}`);
  out.push(`    m3u8×${hls.length} · mp4×${mp4.length} · vtt×${vtt.length}`);
  for (const item of hls.slice(0, 3)) out.push(`      · ${safe(item)}`);
  for (const item of mp4.slice(0, 2)) out.push(`      · ${safe(item)}`);
  const hosts = [...new Set([...hls, ...vtt, ...mp4].map(hostOf))].slice(0, 6);
  out.push(`    hosts de vídeo: ${hosts.join(', ') || '(ninguno)'}`);
  return out.join('\n');
}

function line(item) {
  if (item.error) return `✘ ${item.url} · ${item.error} (${item.ms} ms)`;
  const bits = [
    `HTTP ${item.status}`,
    `${item.bytes} B`,
    `${item.ms} ms`,
    `iframes/embeds ${item.iframes}`,
  ];
  if (item.hosts && item.hosts.length) bits.push(`hosts ${item.hosts.join(',')}`);
  if (item.m3u8) bits.push(`m3u8×${item.m3u8}`);
  if (item.mp4) bits.push(`mp4×${item.mp4}`);
  if (item.nextData) bits.push('__NEXT_DATA__');
  if (item.flight) bits.push('RSC');
  if (item.anubis) bits.push('ANUBIS-PoW');
  for (const key of ['links_online', 'stream_urls', 'players', 'servidores', 'reproductores']) {
    if (item[key]) bits.push(`${key}×${item[key]}`);
  }
  if (item.dotted) bits.push(`dotted(a.b64.c)×${item.dotted}`);
  if (item.hints && item.hints.length) bits.push(`pistas ${item.hints.join(',')}`);
  return `${item.ok ? '✔' : '✘'} ${item.url} · ${bits.join(' · ')}`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--gql')) {
    const gql = await probeDoramasGql();
    console.log(gql.ok
      ? `✔ Doramasflix GQL vivo · HTTP ${gql.status} · ${gql.ms} ms · ${gql.detail}`
      : `✘ Doramasflix GQL · HTTP ${gql.status || '-'} · ${gql.error || gql.detail || ''}${gql.note ? ` · ${gql.note}` : ''}`);
    process.exitCode = gql.ok ? 0 : 1;
    return;
  }
  if (args[0] === '--chain') {
    const target = args.find((arg) => /^https?:\/\//i.test(arg));
    if (!target) {
      console.error('Uso: node scripts/sources-probe.mjs --chain <url>');
      process.exitCode = 2;
      return;
    }
    console.log(await chain(target));
    return;
  }
  if (args[0] === '--media') {
    const target = args.find((arg) => /^https?:\/\//i.test(arg));
    if (!target) {
      console.error('Uso: node scripts/sources-probe.mjs --media <url>');
      process.exitCode = 2;
      return;
    }
    console.log(await media(target));
    return;
  }
  if (args[0] === '--dump') {
    const target = args.find((arg) => /^https?:\/\//i.test(arg));
    if (!target) {
      console.error('Uso: node scripts/sources-probe.mjs --dump <url>');
      process.exitCode = 2;
      return;
    }
    console.log(await dump(target));
    return;
  }
  const urls = args.filter((arg) => /^https?:\/\//i.test(arg));
  if (!urls.length) {
    console.error('Uso: node scripts/sources-probe.mjs <url> [url…] | --gql');
    process.exitCode = 2;
    return;
  }
  let failed = 0;
  for (const url of urls) {
    const result = await probe(url);
    if (!result.ok) failed++;
    console.log(line(result));
    for (const sample of result.samples || []) console.log(`    · ${safe(sample)}`);
  }
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error('La sonda falló:', (err && err.message) || err);
  process.exitCode = 1;
});
