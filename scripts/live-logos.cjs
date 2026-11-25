/**
 * Logos para la semilla de canales en vivo, desde la base pública
 * iptv-org/database (channels.csv + logos.csv, vía api.github.com en crudo —
 * alcanzable tanto desde el sandbox como desde Actions).
 *
 * El casado es conservador: nombre (o alt_names) normalizado idéntico,
 * desempatando por país/categoría de la semilla y prefiriendo canales
 * abiertos con logo en uso. Si nada casa, el canal sigue con el póster de
 * respaldo del addon. Nunca lanza sobre un canal concreto.
 */

const CHANNELS_CSV = 'https://api.github.com/repos/iptv-org/database/contents/data/channels.csv';
const LOGOS_CSV = 'https://api.github.com/repos/iptv-org/database/contents/data/logos.csv';

const UA = 'catalogos-plus-sonda (github.com/noe359866-code/SAS5)';

async function fetchRaw(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.github.raw', 'User-Agent': UA },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url.split('/').pop()}`);
  return res.text();
}

/** CSV con comillas dobles y escape "" (RFC 4180 básico). */
function parseCsv(text) {
  const rows = [[]];
  let cur = '', inQ = false;
  const src = String(text || '').replace(/\r/g, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { rows[rows.length - 1].push(cur); cur = ''; }
    else if (ch === '\n') { rows[rows.length - 1].push(cur); rows.push([]); cur = ''; }
    else cur += ch;
  }
  if (cur || rows[rows.length - 1].length > 1) rows[rows.length - 1].push(cur);
  return rows.filter((r) => r.length > 1 && r.some((c) => c !== ''));
}

/** Normaliza para casar: sin acentos, sin [Opc.N], sin calidad, '+'→'plus'. */
const norm = (s) => String(s || '')
  .replace(/\s*\[Opc\.?\s*\d+\]\s*/gi, ' ')
  .replace(/\+/g, ' plus ')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/\(([^)]*)\)/g, ' $1 ')
  .replace(/\b(fhd|uhd|hd|sd|4k|tv|canal|channel)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim().replace(/\s+/g, ' ');

const COUNTRY_BY_CATEGORY = { argentina: 'AR', espana: 'ES', mexico: 'MX', chile: 'CL', colombia: 'CO', peru: 'PE' };
const COUNTRY_BY_TAG = { argentina: 'AR', mexico: 'MX', chile: 'CL', colombia: 'CO', peru: 'PE', espana: 'ES', 'estados unidos': 'US', usa: 'US' };
const IPTV_CATEGORY = { deportes: 'sports', cine: 'movies', infantil: 'kids', anime: 'animation', documentales: 'documentary', musica: 'music', noticias: 'news', entretenimiento: 'entertainment' };

function buildIndexes(channelsText, logosText) {
  const channels = parseCsv(channelsText);
  channels.shift();
  const byName = new Map();
  const byId = new Map();
  for (const r of channels) {
    const [id, name, alt, , , country, cats, , , closed] = r;
    if (!id) continue;
    byId.set(id, { id, name, country, cats: cats || '', closed: closed || '' });
    for (const n of [name, ...(alt || '').split(';')]) {
      const k = norm(n);
      if (!k) continue;
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(id);
    }
  }
  const logoByCh = new Map();
  const logos = parseCsv(logosText);
  logos.shift();
  for (const r of logos) {
    const [ch, feed, inUse, , w, , , url] = r;
    if (inUse !== 'TRUE' || !/^https:\/\//.test(url || '')) continue;
    if (!logoByCh.has(ch)) logoByCh.set(ch, []);
    logoByCh.get(ch).push({ feed: feed || '', w: +w || 0, url });
  }
  for (const arr of logoByCh.values()) {
    arr.sort((a, b) => (a.feed ? 1 : 0) - (b.feed ? 1 : 0) || b.w - a.w);
  }
  return { byName, byId, logoByCh };
}

function pickLogo(idx, channel) {
  const tag = (/\(([^)]*)\)/.exec(channel.name) || [])[1] || '';
  let ids = idx.byName.get(norm(channel.name)) || [];
  if (!ids.length) ids = byNameLookupLoose(idx, channel.name);
  if (!ids.length) return '';
  const wantCC = COUNTRY_BY_CATEGORY[channel.category] || COUNTRY_BY_TAG[norm(tag)] || '';
  const wantCat = IPTV_CATEGORY[channel.category] || '';
  const scored = ids.map((id) => {
    const c = idx.byId.get(id);
    let s = 0;
    if (c.closed) s -= 5;
    if (wantCC && c.country === wantCC) s += 2;
    if (wantCat && c.cats.split(';').includes(wantCat)) s += 1;
    if (idx.logoByCh.has(id)) s += 1;
    return { id, s };
  }).sort((a, b) => b.s - a.s || (a.id < b.id ? -1 : 1));
  return idx.logoByCh.get(scored[0].id)?.[0]?.url || '';
}

/** Segunda pasada: sin paréntesis y sin espacios («A3 Series» → «a3series»). */
function byNameLookupLoose(idx, name) {
  const bare = norm(String(name).replace(/\(.*\)/, ''));
  if (bare && idx.byName.has(bare)) return idx.byName.get(bare);
  const compact = bare.replace(/\s+/g, '');
  if (compact && idx.byName.has(compact)) return idx.byName.get(compact);
  return [];
}

/**
 * Rellena `logo` en cada canal de la semilla (in place).
 * `previous` (semilla anterior) conserva logos cuando el casado nuevo falla.
 * `texts` opcional: { channelsText, logosText } ya descargados (p. ej. con
 * curl desde el sandbox, donde el TLS de Node no valida contra api.github.com).
 * Devuelve cuántos canales quedaron con logo.
 */
async function enrichSeedWithLogos(seed, previous = [], texts = null) {
  const { channelsText, logosText } = texts
    || await (async () => {
      const [channelsText, logosText] = await Promise.all([fetchRaw(CHANNELS_CSV), fetchRaw(LOGOS_CSV)]);
      return { channelsText, logosText };
    })();
  const idx = buildIndexes(channelsText, logosText);
  const prevLogo = new Map();
  for (const c of previous || []) {
    if (c.logo) prevLogo.set(`${c.category}:${c.slug}`, c.logo);
  }
  let withLogo = 0;
  for (const ch of seed) {
    // Prioridad: el logo que declara la lista (Cinecity trae todos), luego
    // iptv-org, luego el logo que ya tenía la semilla anterior.
    const logo = ch.logo || pickLogo(idx, ch) || prevLogo.get(`${ch.category}:${ch.slug}`) || '';
    ch.logo = logo;
    if (logo) withLogo++;
  }
  return withLogo;
}

module.exports = { enrichSeedWithLogos };
