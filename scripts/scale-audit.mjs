#!/usr/bin/env node
/**
 * Auditoría de escala contra un despliegue real.
 *
 * La pregunta no es teórica: «¿aguanta mi despliegue 500.000 peticiones/día
 * con el plan gratuito de Cloudflare Workers?». La respuesta depende de CUÁNTAS
 * de esas peticiones ejecutan el Worker, porque el plan free da **100.000
 * invocaciones/día por cuenta** (al pasarse, Cloudflare devuelve Error 1027).
 *
 * Cómo se mide: el Worker marca TODAS sus respuestas con la cabecera
 * `X-Catalogos-Runtime: worker`. Los static assets de `public/` y las
 * respuestas servidas por una Cache Rule del CDN llegan SIN esa cabecera, así
 * que desde fuera se distingue lo que costó invocación de lo que fue gratis.
 *
 * Uso:
 *   node scripts/scale-audit.mjs --url https://tu-dominio
 *   node scripts/scale-audit.mjs --url https://… --requests 500000
 *   node scripts/scale-audit.mjs --url https://… --json
 *
 * Opciones:
 *   --url=URL         despliegue a auditar (o variable PUBLIC_ORIGIN)
 *   --requests=N      peticiones/día a proyectar (por defecto 500.000)
 *   --json            salida en JSON, para CI
 *   --timeout=MS      tiempo máximo por petición (por defecto 15000)
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const {
  classify,
  estimate,
  advise,
  DEFAULT_MIX,
  FREE_DAILY_INVOCATIONS,
} = require('../lib/scaleAudit.js');

export { classify, estimate, advise, DEFAULT_MIX, FREE_DAILY_INVOCATIONS };

const PROBES = [
  { group: 'web', path: '/', label: 'Portada' },
  { group: 'web', path: '/configure', label: 'Configurador' },
  { group: 'web', path: '/manifest.json', label: 'Manifest general' },
  { group: 'web', path: '/internal/branding.json', label: 'Logos de plataformas' },
  { group: 'web', path: '/internal/watch/catalogs', label: 'Catálogos del reproductor' },
  { group: 'catalog', path: '/catalog/movie/cine_tendencias.json', label: 'Catálogo por defecto' },
  { group: 'meta', path: '/meta/movie/tt1160419.json', label: 'Ficha por defecto' },
  { group: 'stream', path: '/stream/movie/tt1160419.json', label: 'Streams públicos' },
];

async function probe(url, timeoutMs) {
  const target = new URL(url.pathname, url.origin);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(target, {
      signal: controller.signal,
      headers: { Accept: 'application/json, text/html;q=0.9, */*;q=0.8' },
      redirect: 'manual',
    });
    const ms = Date.now() - started;
    await response.arrayBuffer().catch(() => null); // drenar el cuerpo
    return { status: response.status, headers: response.headers, ms };
  } catch (err) {
    return { status: 0, headers: new Headers(), ms: Date.now() - started, error: (err && err.message) || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

function parseArgs(argv) {
  const options = { requests: 500_000, timeoutMs: 15_000, json: false };
  // Admite tanto `--url=https://x` como `--url https://x`.
  const value = (index, fallback) => {
    const next = argv[index + 1];
    return next && !next.startsWith('--') ? next : fallback;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const body = arg.startsWith('--') ? arg.slice(2) : '';
    if (arg.startsWith('--url=')) options.url = arg.slice('--url='.length);
    else if (body === 'url') { options.url = value(i, ''); i++; }
    else if (arg.startsWith('--requests=')) options.requests = Number(arg.split('=')[1]) || options.requests;
    else if (body === 'requests') { options.requests = Number(value(i, '')) || options.requests; i++; }
    else if (arg.startsWith('--timeout=')) options.timeoutMs = Number(arg.split('=')[1]) || options.timeoutMs;
    else if (body === 'timeout') { options.timeoutMs = Number(value(i, '')) || options.timeoutMs; i++; }
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
  }
  if (!options.url) {
    const origin = String(process.env.PUBLIC_ORIGIN || '').trim();
    if (origin) options.url = origin;
  }
  return options;
}

export async function audit({ url, requests = 500_000, timeoutMs = 15_000, fetchImpl } = {}) {
  const origin = new URL(String(url).replace(/\/+$/, ''));
  const doProbe = (path) => (fetchImpl ? fetchImpl(path) : probe(new URL(path, origin), timeoutMs));

  // 1) Comprobar que el marcador del Worker funciona (la auditoría depende de él).
  const health = await doProbe('/healthz');
  const markerWorks = Boolean(health.headers.get('x-catalogos-runtime'));

  // 2) Un config personal de ejemplo, como el que instala Stremio.
  let configSegment = null;
  try {
    const userConfig = require('../lib/userConfig.js');
    const { PROVIDER_KEYS } = require('../lib/streams.js');
    const { PLATFORM_KEYS, STUDIO_KEYS } = require('../lib/catalogs.js');
    configSegment = userConfig.encodeConfig({
      lang: 'es',
      region: 'NI',
      streams: PROVIDER_KEYS.slice(),
      platforms: PLATFORM_KEYS.slice(0, 8),
      studios: STUDIO_KEYS.slice(0, 6),
    }, PLATFORM_KEYS, STUDIO_KEYS, PROVIDER_KEYS);
  } catch (_) { /* sin módulos disponibles: se auditan solo las rutas generales */ }

  const probes = [...PROBES];
  if (configSegment) {
    probes.push(
      { group: 'web', path: `/${configSegment}/manifest.json`, label: 'Manifest personal' },
      { group: 'catalog', path: `/${configSegment}/catalog/movie/cine_tendencias.json`, label: 'Catálogo personal' },
      { group: 'meta', path: `/${configSegment}/meta/movie/tt1160419.json`, label: 'Ficha personal' },
      { group: 'stream', path: `/${configSegment}/stream/movie/tt1160419.json`, label: 'Streams (config)' },
    );
  }

  const results = [];
  for (const item of probes) {
    const response = await doProbe(item.path);
    results.push({
      ...item,
      status: response.status,
      ms: response.ms,
      cache: response.headers.get('x-catalogos-cache') || '',
      servedBy: classify(item.path, response, markerWorks),
      error: response.error || null,
    });
  }

  // 3) Lo que más duele manda: si alguna ruta de un grupo ejecuta el Worker,
  //    el grupo se cuenta como Worker (es la estimación conservadora).
  const servedBy = {};
  for (const group of Object.keys(DEFAULT_MIX)) {
    const rows = results.filter((row) => row.group === group && row.status >= 200 && row.status < 400);
    if (!rows.length) continue;
    servedBy[group] = rows.some((row) => row.servedBy.startsWith('worker')) ? 'worker' : rows[0].servedBy;
  }
  if (!servedBy.streamDebrid) {
    // Los streams con Debrid nunca se cachean (enlaces directos de la cuenta):
    // siempre ejecutan el Worker. Es el suelo de invocaciones.
    servedBy.streamDebrid = 'worker';
  }

  const estimation = estimate({ servedBy, total: requests });
  return {
    url: origin.origin,
    host: origin.host,
    markerWorks,
    requests,
    probes: results,
    servedBy,
    estimate: estimation,
    advice: advise({ servedBy, host: origin.host, estimate: estimation }),
  };
}

function printReport(report) {
  const { estimate: est } = report;
  console.log(`\nAuditoría de escala · ${report.url}`);
  console.log(`Proyección: ${est.total.toLocaleString('es')} peticiones/día · presupuesto Workers Free: ${est.budget.toLocaleString('es')} invocaciones/día\n`);
  const pad = (text, size) => String(text).padEnd(size);
  console.log(pad('Ruta', 46) + pad('Estado', 8) + pad('Servido por', 16) + 'ms');
  console.log('-'.repeat(80));
  for (const row of report.probes) {
    const label = row.label.length > 44 ? `${row.label.slice(0, 41)}…` : row.label;
    console.log(pad(label, 46) + pad(row.status || 'ERR', 8) + pad(row.servedBy, 16) + `${row.ms}`);
  }
  console.log('\nInvocaciones estimadas por grupo:');
  for (const row of est.rows) {
    const pct = `${Math.round(row.share * 100)} %`;
    console.log(
      `  ${pad(row.group, 15)} ${pad(pct, 5)} ${pad(row.requests.toLocaleString('es') + ' req/día', 18)} ` +
      `${pad(row.servedBy, 14)} → ${row.invocations.toLocaleString('es')} invocaciones`
    );
  }
  console.log(
    `\nTotal: ${est.invocations.toLocaleString('es')} invocaciones/día ` +
    `(${Math.round(est.usage * 100)} % del plan free) · ` +
    (est.ok
      ? `margen libre: ${est.headroom.toLocaleString('es')}`
      : `EXCEDE el plan por ${Math.abs(est.headroom).toLocaleString('es')}`)
  );
  if (report.advice.length) {
    console.log('\nQué hacer:');
    for (const tip of report.advice) console.log(`  • ${tip}`);
  }
  console.log('');
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('scale-audit.mjs');

if (invokedDirectly) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.url) {
    console.log('Uso: node scripts/scale-audit.mjs --url https://tu-dominio [--requests=500000] [--json]');
    process.exit(options.help ? 0 : 1);
  }
  try {
    const report = await audit(options);
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else printReport(report);
    process.exit(report.estimate.ok ? 0 : 2);
  } catch (err) {
    console.error('[scale-audit] Error:', (err && err.message) || err);
    process.exit(1);
  }
}
