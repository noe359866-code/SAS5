#!/usr/bin/env node
/**
 * Sonda de animed23.com y animejara.com (solo diagnóstico).
 *
 * Ambos respondieron 403 con `cf-mitigated` desde la portada en la sonda de
 * sitios. Antes de descartarlos se comprueba si el bloqueo es del host entero
 * o solo de esa ruta/UA:
 *
 *   1. Portada por https y http, con UA de navegador y UA de bot.
 *   2. Rutas típicas de WordPress: `/wp-json/`, `/wp-json/wp/v2/types`,
 *      `/sitemap.xml`, `/?s=`, `/feed/`.
 *   3. `robots.txt`, que suele publicarse aunque el HTML esté tras el reto.
 *
 * No intenta resolver el reto de Cloudflare: si todas las rutas devuelven 403
 * con `cf-mitigated`, el sitio no es recolectable sin ejecutar JS y se descarta.
 */

const TARGETS = [
  { name: 'animed23.com', base: 'https://animed23.com' },
  { name: 'animejara.com', base: 'http://animejara.com' },
];

const UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const UA_BOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const TIMEOUT = 15_000;

const PATHS = ['/', '/wp-json/', '/wp-json/wp/v2/types', '/sitemap.xml', '/feed/', '/?s=naruto', '/robots.txt'];

async function probe(url, ua, extra = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': ua,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-MX,es;q=0.9,en;q=0.6',
        ...extra,
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await res.text();
    const cf = (res.headers.get('cf-mitigated') || '').toLowerCase();
    const server = res.headers.get('server') || '';
    return {
      status: res.status,
      cf: cf || '-',
      server,
      type: (res.headers.get('content-type') || '').split(';')[0],
      bytes: text.length,
      excerpt: text.replace(/\s+/g, ' ').slice(0, 140),
    };
  } catch (err) {
    return { status: 0, cf: '-', server: '-', type: '-', bytes: 0, excerpt: `ERR ${err.message}` };
  } finally { clearTimeout(timer); }
}

async function main() {
  const rows = [];
  for (const target of TARGETS) {
    console.log(`\n### ${target.name}`);
    for (const path of PATHS) {
      const url = `${target.base}${path}`;
      const ua = path === '/' ? UA_BROWSER : UA_BOT;
      const res = await probe(url, ua);
      console.log(`  ${String(res.status).padEnd(3)} cf=${res.cf} ${res.type} ${res.bytes}B ${path}`);
      console.log(`      ${res.excerpt}`);
      rows.push({ site: target.name, path, ua: path === '/' ? 'browser' : 'bot', ...res });
      // Un reto de Cloudflare no se resuelve cambiando de UA: si la portada
      // ya trae cf-mitigated, no se insiste con el resto de rutas.
      if (path === '/' && res.cf && res.status === 403) {
        const retry = await probe(url, UA_BOT);
        console.log(`  reintento bot: ${retry.status} cf=${retry.cf}`);
        rows.push({ site: target.name, path, ua: 'bot-retry', ...retry });
      }
    }
  }

  const fs = await import('node:fs');
  fs.mkdirSync('.probe', { recursive: true });
  // El robots.txt de animed23 sí se sirve: se guarda entero por si anuncia
  // sitemaps en otro origen (una API fuera del reto de Cloudflare).
  for (const target of TARGETS) {
    const res = await probe(`${target.base}/robots.txt`, UA_BOT);
    if (res.status === 200 && res.bytes) {
      const body = await (await fetch(`${target.base}/robots.txt`, { headers: { 'User-Agent': UA_BOT } })).text().catch(() => '');
      fs.writeFileSync(`.probe/robots-${target.name}.txt`, body);
    }
  }
  const md = ['| Sitio | Ruta | UA | HTTP | CF | Server | Tipo | Bytes | Extracto |', '|---|---|---|---|---|---|---|---|---|'];
  for (const row of rows) {
    md.push(`| ${row.site} | \`${row.path}\` | ${row.ua} | ${row.status} | ${row.cf} | ${row.server} | ${row.type} | ${row.bytes} | ${String(row.excerpt || '').replace(/\|/g, '/')} |`);
  }
  md.push('', 'Sonda de bloqueo: solo cabeceras y primeros bytes; no se intenta resolver el reto.');
  fs.writeFileSync('.probe/anime-sites.md', md.join('\n') + '\n');
}

main().catch((err) => { console.error(err); process.exit(1); });
