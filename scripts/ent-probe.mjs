#!/usr/bin/env node
/**
 * Sonda de los canales ENT Pack / Totalmusic de 40media Group (petición del
 * usuario, 26-11-2026: «busca estos canales y añadelos» — imagen del ENT
 * Pack: ent movies/extreme/comedy/drama/classic/life).
 *
 * Fuentes públicas localizadas:
 *  - lista Novamax150/TV (GitHub): URLs cdn.40mediagroup.com y logos oficiales
 *    (ent-*.png / tmc_*.png);
 *  - listado iptv-org (b2og): el espejo cdn.global.elektamedia.com.
 *
 * El CDN sirve cada canal en DOS hosts con la misma ruta
 * (/live/c7eds/<SLUG>/SA_LIVE_hls_enc/master.m3u8): se verifican ambos y los
 * que respondan entran como señales 1/2 del mismo canal (barra de siempre:
 * maestra 200 + #EXTM3U + primer tramo con bytes).
 *
 * Escribe `lib/data/liveChannelsEntSeed.json` (con guarda del 80 %) y el
 * informe en `.probe/ent-channels.md`. Si NINGÚN canal verifica (posible
 * geo-bloqueo del CDN a IPs de CI), se escribe igual con las URLs de las
 * listas públicas marcadas sin verificar — el canal existe y en redes
 * normales suele cargar.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');

const GENERIC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TIMEOUT = 10_000;

const HOSTS = ['cdn.40mediagroup.com', 'cdn.global.elektamedia.com'];
const urlOf = (host, slug) => `https://${host}/live/c7eds/${slug}/SA_LIVE_hls_enc/master.m3u8`;

/** Los 13 canales del grupo (8 ENT + 5 Totalmusic). */
const CHANNELS = [
  { name: 'ENT Channel', slug: 'ENT_Channel', topic: 'entretenimiento', logo: 'https://www.40mediagroup.com/images/channels/ent-channel.png' },
  { name: 'ENT Family', slug: 'ENT_Family', topic: 'entretenimiento', logo: 'https://www.40mediagroup.com/images/channels/ent-family.png' },
  { name: 'ENT Movies', slug: 'ENT_Movies', topic: 'cine', logo: 'https://www.40mediagroup.com/images/channels/ent-movies.png' },
  { name: 'ENT Drama', slug: 'ENT_Drama', topic: 'cine', logo: 'https://www.40mediagroup.com/images/channels/ent-drama.png' },
  { name: 'ENT Classic', slug: 'ENT_Classics', topic: 'cine', logo: 'https://www.40mediagroup.com/images/channels/ent-classic.png' },
  { name: 'ENT Life', slug: 'ENT_Life', topic: 'cine', logo: 'https://www.40mediagroup.com/images/channels/ent-life.png' },
  { name: 'ENT Extreme', slug: 'ENT_Extreme', topic: 'entretenimiento', logo: 'https://www.40mediagroup.com/images/channels/ent-extreme.png' },
  { name: 'ENT Comedy', slug: 'ENT_Comedy', topic: 'cine', logo: 'https://www.40mediagroup.com/images/channels/ent-comedy.png' },
  { name: 'Totalmusic', slug: 'Totalmusic', topic: 'musica', logo: 'https://static.elektamedia.com/ch/tmc_main.png' },
  { name: 'Totalmusic 80s', slug: 'Totalmusic_80s', topic: 'musica', logo: 'https://static.elektamedia.com/ch/tmc_80s.png' },
  { name: 'Totalmusic 00s', slug: 'Totalmusic_00s', topic: 'musica', logo: 'https://static.elektamedia.com/ch/tmc_00s.png' },
  { name: 'Totalmusic Concerts', slug: 'Totalmusic_Concerts', topic: 'musica', logo: '' },
  { name: 'Totalmusic Dance', slug: 'Totalmusic_Dance', topic: 'musica', logo: '' },
];

const OUT_JSON = 'lib/data/liveChannelsEntSeed.json';
const OUT_MD = '.probe/ent-channels.md';

const slugOf = (name) => String(name || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

async function fetchBytes(url, { range = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': GENERIC_UA, ...(range ? { Range: 'bytes=0-2047' } : {}) },
      signal: controller.signal,
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, buf };
  } finally { clearTimeout(timer); }
}

/** Maestra 200 + #EXTM3U + primer tramo (variante o segmento) con bytes. */
async function verify(url) {
  let master;
  try { master = await fetchBytes(url); } catch { return false; }
  if (master.status !== 200 || !master.buf.includes('#EXTM3U')) return false;
  const first = master.buf.toString('utf8').split('\n').map((l) => l.trim()).filter(Boolean)
    .find((l) => !l.startsWith('#'));
  if (!first) return false;
  const isSegment = !/\.m3u8/i.test(first);
  const nextUrl = first.startsWith('http') ? first : new URL(first, url).href;
  try {
    const part = await fetchBytes(nextUrl, { range: isSegment });
    if (![200, 206].includes(part.status) || part.buf.length < 100) return false;
    if (!isSegment && !part.buf.includes('#EXTM3U')) return false;
  } catch { return false; }
  return true;
}

(async () => {
  const out = [];
  const say = (line) => { out.push(line); console.log(line); };
  try {
    say('# Sonda ENT Pack / Totalmusic (40media Group)');
    say('');
    say(`Fecha: ${new Date().toISOString()}`);
    say('');
    say('| Canal | cdn.40mediagroup.com | cdn.global.elektamedia.com |');
    say('|---|---|---|');

    const rows = [];
    let verifiedChannels = 0;
    for (const ch of CHANNELS) {
      const liveUrls = [];
      const marks = [];
      for (const host of HOSTS) {
        const url = urlOf(host, ch.slug);
        let ok = false;
        try { ok = await verify(url); } catch { ok = false; }
        marks.push(ok ? '✅ viva' : '✖');
        if (ok) liveUrls.push(url);
      }
      say(`| ${ch.name} | ${marks[0]} | ${marks[1]} |`);
      if (liveUrls.length) verifiedChannels += 1;
      for (const url of liveUrls) {
        rows.push({
          name: ch.name,
          slug: slugOf(ch.name),
          topic: ch.topic,
          country: 'Latinoamérica',
          logo: ch.logo,
          url,
          unverified: false,
        });
      }
    }
    say('');
    say(`verificados: ${verifiedChannels}/${CHANNELS.length} canales (${rows.length} señales)`);

    // Si nada verifica (posible geo-bloqueo a CI), entran las URLs publicadas
    // en las listas públicas, marcadas sin verificar.
    if (verifiedChannels === 0) {
      say('AVISO: ningún canal verificó desde CI; se escriben las URLs publicadas (sin verificar).');
      for (const ch of CHANNELS) {
        rows.push({
          name: ch.name,
          slug: slugOf(ch.name),
          topic: ch.topic,
          country: 'Latinoamérica',
          logo: ch.logo,
          url: urlOf(HOSTS[0], ch.slug),
          unverified: true,
        });
      }
    }

    let current = [];
    try { current = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8')); } catch {}
    const floor = current.length ? Math.floor(current.length * 0.8) : 1;
    if (rows.length >= floor) {
      fs.writeFileSync(OUT_JSON, JSON.stringify(rows, null, 1) + '\n');
      say(`semilla ENT escrita: ${current.length} -> ${rows.length} filas`);
    } else {
      say(`semilla ENT NO escrita: ${rows.length} < ${floor} (guarda)`);
    }
  } catch (err) {
    say(`ERROR: ${err.message}`);
    process.exitCode = 1;
  } finally {
    fs.mkdirSync('.probe', { recursive: true });
    fs.writeFileSync(OUT_MD, out.join('\n') + '\n');
  }
})();
