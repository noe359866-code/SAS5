#!/usr/bin/env node
/**
 * Sonda en vivo del addon desplegado en Cloudflare Workers:
 *   https://ramdonlatam.noe359866.workers.dev
 *
 * Comprueba la cadena completa que ejecuta Stremio:
 *   1. /healthz
 *   2. /manifest.json
 *   3. /catalog/<type>/<id>.json
 *   4. /meta/<type>/<id>.json
 *   5. /stream/<type>/<id>.json
 *   6. GET al primer stream devuelto (si existe)
 */

import fs from 'node:fs';

const BASE = (process.env.ADDON_URL || 'https://ramdonlatam.noe359866.workers.dev').replace(/\/+$/, '');
const TIMEOUT = 15_000;
const OUT_MD = '.probe/addon-live.md';

const out = [];
const say = (line = '') => { out.push(line); console.log(line); };

async function get(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || TIMEOUT);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Stremio/4.4)',
        ...(opts.headers || {}),
      },
      signal: controller.signal,
    });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      ms: Date.now() - t0,
      contentType: res.headers.get('content-type') || '',
      cors: res.headers.get('access-control-allow-origin') || '',
      runtime: res.headers.get('x-catalogos-runtime') || '',
      cacheControl: res.headers.get('cache-control') || '',
      text,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - t0,
      error: `${err?.name || 'err'}: ${err?.message || ''}`,
      text: '',
    };
  } finally {
    clearTimeout(timer);
  }
}

function tryJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function redactUrl(u) {
  try {
    const parsed = new URL(u);
    if (parsed.pathname.startsWith('/__channel/')) {
      return `${parsed.origin}/__channel/<token:${parsed.pathname.length - 11}c>`;
    }
    return `${parsed.origin}${parsed.pathname.slice(0, 48)}${parsed.search ? '?…' : ''}`;
  } catch {
    return String(u || '').slice(0, 80);
  }
}

(async () => {
  say('# Sonda en vivo del addon desplegado');
  say('');
  say(`- URL base: \`${BASE}\``);
  say(`- Fecha: ${new Date().toISOString()}`);
  say('');

  // 1. /healthz
  const h = await get(`${BASE}/healthz`);
  const hj = tryJson(h.text);
  say('## 1. `/healthz`');
  say(`- HTTP: **${h.status}** (${h.ms} ms) · runtime: \`${h.runtime || '—'}\` · CORS: \`${h.cors || '—'}\``);
  if (hj) {
    say('```json');
    say(JSON.stringify(hj, null, 2));
    say('```');
  } else {
    say(`- Cuerpo: \`${h.text.slice(0, 300)}\``);
  }
  say('');

  // 2. /manifest.json
  const m = await get(`${BASE}/manifest.json`);
  const mj = tryJson(m.text);
  say('## 2. `/manifest.json`');
  say(`- HTTP: **${m.status}** (${m.ms} ms) · Content-Type: \`${m.contentType}\` · CORS: \`${m.cors || '—'}\``);
  if (!mj) {
    say(`- ERROR: no es JSON válido: \`${m.text.slice(0, 400)}\``);
    return;
  }
  say(`- id: \`${mj.id}\` · version: \`${mj.version}\` · name: \`${mj.name}\``);
  say(`- types: \`${JSON.stringify(mj.types)}\` · resources: \`${JSON.stringify(mj.resources)}\` · idPrefixes: \`${JSON.stringify(mj.idPrefixes)}\``);
  say(`- catalogs: **${Array.isArray(mj.catalogs) ? mj.catalogs.length : 0}**`);
  if (Array.isArray(mj.catalogs) && mj.catalogs.length) {
    say(`- primeros 5 catálogos: ${mj.catalogs.slice(0, 5).map((c) => `\`${c.type}/${c.id}\` (${c.name})`).join(', ')}`);
  }
  say('');

  // 3. /catalog -> /meta -> /stream
  const catalogs = Array.isArray(mj.catalogs) ? mj.catalogs : [];
  const chosenCatalogs = [];
  const nic = catalogs.find((c) => /nicaragua/i.test(c.id || c.name || ''));
  if (nic) chosenCatalogs.push(nic);
  for (const c of catalogs) {
    if (chosenCatalogs.length >= 2) break;
    if (!chosenCatalogs.includes(c)) chosenCatalogs.push(c);
  }

  for (const cat of chosenCatalogs) {
    const catUrl = `${BASE}/catalog/${encodeURIComponent(cat.type)}/${encodeURIComponent(cat.id)}.json`;
    const cr = await get(catUrl);
    const cj = tryJson(cr.text);
    const metas = Array.isArray(cj?.metas) ? cj.metas : [];
    say(`## 3. Catálogo \`${cat.type}/${cat.id}\` (${cat.name})`);
    say(`- HTTP: **${cr.status}** (${cr.ms} ms) · metas: **${metas.length}**`);
    if (!metas.length) {
      say(`- Respuesta cruda: \`${cr.text.slice(0, 300)}\``);
      say('');
      continue;
    }

    const samples = metas.slice(0, 2);
    for (const item of samples) {
      const encId = encodeURIComponent(item.id);
      const metaUrl = `${BASE}/meta/${encodeURIComponent(item.type)}/${encId}.json`;
      const streamUrl = `${BASE}/stream/${encodeURIComponent(item.type)}/${encId}.json`;
      const [mr, sr] = await Promise.all([get(metaUrl), get(streamUrl)]);
      const mjItem = tryJson(mr.text);
      const sjItem = tryJson(sr.text);
      const streams = Array.isArray(sjItem?.streams) ? sjItem.streams : [];

      say(`### Canal: ${item.name} (\`${item.id}\`)`);
      say(`- \`/meta\`: HTTP **${mr.status}** (${mr.ms} ms) · name=\`${mjItem?.meta?.name || '—'}\` · id=\`${mjItem?.meta?.id || '—'}\``);
      say(`- \`/stream\`: HTTP **${sr.status}** (${sr.ms} ms) · streams=**${streams.length}** · flags=${JSON.stringify({
        proxySecretRequired: sjItem?.proxySecretRequired ?? null,
        cacheMaxAge: sjItem?.cacheMaxAge ?? null,
        error: sjItem?.error ?? null,
      })}`);

      if (!streams.length) {
        say('```json');
        say(sr.text.slice(0, 500));
        say('```');
      } else {
        const s0 = streams[0];
        say(`- Primer stream: name=\`${s0.name || '—'}\` · title=\`${s0.title || '—'}\` · url=\`${redactUrl(s0.url)}\``);
        if (s0.url && /^https?:\/\//i.test(s0.url)) {
          const play = await get(s0.url, { headers: { Range: 'bytes=0-2048' }, timeoutMs: 10_000 });
          say(`- Prueba de reproducción directa del primer stream: HTTP **${play.status}** (${play.ms} ms) · Content-Type=\`${play.contentType || '—'}\` · #EXTM3U=${/#EXTM3U/.test(play.text) ? 'sí' : 'no'} · bytes=${play.text.length}`);
        }
      }
      say('');
    }
  }
})().catch((err) => {
  say(`ERROR FATAL: ${err.message}`);
  process.exitCode = 1;
}).finally(() => {
  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync(OUT_MD, out.join('\n') + '\n');
});
