#!/usr/bin/env node
/**
 * Sonda de fuentes candidatas: mira el HTML CRUDO de una web y dice qué hay
 * dentro de verdad (iframes, embeds, .m3u8/.mp4, `__NEXT_DATA__`), sin
 * interpretarlo.
 *
 *   node scripts/sources-probe.mjs https://flixlatam.com/pelicula/interstellar
 *   node scripts/sources-probe.mjs --gql           # ¿sigue viva la API de Doramasflix?
 *   node scripts/sources-probe.mjs --dump <url>    # qué hay dentro de `servidores`/`links_online`
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
  for (const key of ['servidores', 'links_online', 'stream_urls', 'players']) {
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
