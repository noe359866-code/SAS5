'use strict';

/**
 * /configure — configurador del addon.
 *
 * Estructura: navegación → cabecera y guía rápida → índice de secciones con
 * resumen en vivo → tarjetas de configuración → barra fija de instalación.
 * Genera el manifest personal /<base64url>/manifest.json.
 *
 * El <script> principal es el primero de la página y arranca con las
 * constantes, `state`, `save()` y `restore()` sin tocar el DOM: los tests lo
 * ejecutan en un contexto aislado hasta `function b64url`.
 */

const { LANG_OPTIONS, REGION_OPTIONS, REGION_GROUPS, BASE_OPTIONS, DEFAULT_LANG } = require('./userConfig');
const { PLATFORMS, STUDIOS, buildDefs } = require('./catalogs');
const { PROVIDERS: STREAM_PROVIDERS } = require('./streams');
const DEBRID_PROVIDER_KEYS = ['torbox', 'easydebrid', 'premiumize', 'realdebrid'];
const {
  FILTER_GROUPS, FILTERS, RECOMMENDED_HIDE, SORT_OPTIONS, DEFAULT_SORT, SIZE_OPTIONS, MAX_SIZE_GB,
} = require('./streamFilters');
const { BADGE_GROUPS, BADGE_KEYS, detectBadgeGroups } = require('./badges');
const { STATIC_PROVIDER_LOGOS, STATIC_STUDIO_LOGOS } = require('./staticLogos');
const { STATIC_TRENDING_MOVIES, STATIC_TRENDING_SERIES } = require('./posterData');
const { RAILS_CSS, RAILS_JS, posterRailHtml, escapeHtml } = require('./rails');
const { THEME_CSS, MONO_STACK } = require('./theme');
const { icon, iconMask } = require('./icons');
const { backgroundHtml, navHtml, supportCardHtml, donateCardHtml, footerHtml } = require('./layout');
const config = require('./config');
const { WEB_I18N_BOOTSTRAP, WEB_I18N_SCRIPT } = require('./webI18n');

// Icono de cada grupo de filtros (lib/streamFilters.js → FILTER_GROUPS).
const FILTER_GROUP_ICONS = { source: 'clapperboard', resolution: 'monitor-play', video: 'sparkles' };

// Pasos del índice lateral: [ancla, título, icono].
const STEPS = [
  ['idioma', 'Idioma y región', 'languages'],
  ['plataformas', 'Plataformas', 'layout-grid'],
  ['estudios', 'Estudios', 'building-2'],
  ['catalogos', 'Catálogos base', 'library'],
  ['streams', 'Proveedores', 'magnet'],
  ['debrid', 'Servicios debrid', 'zap'],
  ['filtros', 'Filtros de streams', 'funnel'],
  ['badges', 'Etiquetas de stream', 'tag'],
];

/**
 * Botón de opción única. `search` es el texto por el que lo encuentra el
 * buscador del selector (idioma y región).
 */
function pill(group, value, labelHtml, pressed, { search = '', title = '' } = {}) {
  const attrs = [
    `data-group="${escapeHtml(group)}"`,
    `data-value="${escapeHtml(value)}"`,
    search ? `data-search="${escapeHtml(search)}"` : '',
    title ? `title="${escapeHtml(title)}"` : '',
    `aria-pressed="${pressed ? 'true' : 'false'}"`,
  ].filter(Boolean).join(' ');
  return `<button type="button" class="pill" ${attrs}>${labelHtml}</button>`;
}

function providerTile(p) {
  const logo = STATIC_PROVIDER_LOGOS[p.key];
  const img = logo
    ? `<img src="${escapeHtml(logo)}" alt="" loading="lazy" onerror="this.remove()" />`
    : '';
  return `
  <label class="provider-tile" data-key="${escapeHtml(p.key)}" title="${escapeHtml(p.name)}">
    <input type="checkbox" checked data-group="platforms" data-key="${escapeHtml(p.key)}" />
    <span class="tile-logo"><span class="letter">${escapeHtml(p.name.charAt(0).toUpperCase())}</span>${img}</span>
    <span class="tile-name">${escapeHtml(p.name)}</span>
    <span class="tile-check" aria-hidden="true"></span>
  </label>`;
}

function studioTile(s) {
  // Logo estático de TMDB (si lo hay) desde el primer render; el monograma
  // queda detrás y el <img> dinámico se rellena si branding tiene uno mejor.
  const logo = STATIC_STUDIO_LOGOS[s.company];
  const img = logo
    ? `<img src="${escapeHtml(logo)}" alt="" loading="lazy" onerror="this.remove()" />`
    : '';
  return `
  <label class="studio-tile" data-key="${escapeHtml(s.key)}" title="${escapeHtml(s.name)}">
    <input type="checkbox" checked data-group="studios" data-key="${escapeHtml(s.key)}" />
    <span class="studio-logo"><span class="monogram">${escapeHtml(s.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase())}</span>${img}<img data-logo-for="${escapeHtml(s.key)}" data-logo-group="studios" alt="" loading="lazy" style="display:none" /></span>
    <span class="tile-name">${escapeHtml(s.name)}</span>
    <span class="tile-check" aria-hidden="true"></span>
  </label>`;
}

function railItems(data, fallback) {
  const results = data && Array.isArray(data.results) ? data.results : null;
  if (!results || results.length === 0) return fallback;
  return results.slice(0, 18).map((m) => ({
    title: m.title || m.name || 'Sin título',
    year: String(m.release_date || m.first_air_date || '').slice(0, 4),
    rating: m.vote_average ? Number(m.vote_average).toFixed(1) : '',
    poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : '',
  }));
}

/** Cabecera de una tarjeta de sección. */
function cardHead(num, title, sub, count = '') {
  return `<header class="card-head">
      <span class="card-num">${num}</span>
      <div class="card-title"><h2>${title}</h2><p>${sub}</p></div>
      ${count ? `<span class="card-count" data-count="${count}"></span>` : ''}
    </header>`;
}

/** Catálogos que aporta una selección (para el contador en vivo). */
function catalogWeight(partial) {
  return buildDefs({ platforms: [], studios: [], base: [], ...partial }).length;
}

function renderConfigure({ origin, host, trendingMovies, trendingSeries, initialCfg }) {
  const railMovies = railItems(trendingMovies, STATIC_TRENDING_MOVIES);
  const railSeries = railItems(trendingSeries, STATIC_TRENDING_SERIES);

  // Valores con los que nace la página: los del despliegue. Si el idioma del
  // despliegue no está en la lista se marca el primero ("es").
  const defaultLang = LANG_OPTIONS.some((o) => o.code === config.tmdbLanguage) ? config.tmdbLanguage : DEFAULT_LANG;
  const defaultRegion = config.watchRegion || 'NI';
  const langOf = LANG_OPTIONS.find((o) => o.code === defaultLang);
  const regionOf = REGION_OPTIONS.find((o) => o.code === defaultRegion);

  // Los idiomas que no usan alfabeto latino llevan al lado su nombre en español.
  const isLatin = (text) => /^[\u0000-\u024f]+$/.test(text);
  const langPills = LANG_OPTIONS.map((o) => pill(
    'lang',
    o.code,
    `<span class="code">${escapeHtml(o.code)}</span><bdi>${escapeHtml(o.label)}</bdi>${isLatin(o.label) ? '' : `<small>${escapeHtml(o.name)}</small>`}`,
    o.code === defaultLang,
    { search: `${o.label} ${o.name} ${o.code}`, title: o.name }
  )).join('\n');

  const regionGroups = REGION_GROUPS.map((group) => {
    const pills = REGION_OPTIONS.filter((o) => o.group === group).map((o) => pill(
      'region',
      o.code,
      `<span class="code">${escapeHtml(o.code)}</span>${escapeHtml(o.label)}`,
      o.code === defaultRegion,
      { search: `${o.label} ${o.code}` }
    )).join('\n');
    return `<div class="picker-group"><h4>${escapeHtml(group)}</h4><div class="pills">${pills}</div></div>`;
  }).join('\n');

  const baseChips = BASE_OPTIONS.map((o) =>
    `<label class="chip"><input type="checkbox" checked data-group="base" data-key="${escapeHtml(o.key)}" /><span>${escapeHtml(o.label)}</span></label>`
  ).join('\n');
  const streamChips = STREAM_PROVIDERS.map((p) =>
    `<label class="chip"><input type="checkbox" checked data-group="streams" data-key="${escapeHtml(p.key)}" /><span>${escapeHtml(p.name)}</span></label>`
  ).join('\n');

  // Filtros: la casilla marcada significa "se muestra".
  const filterGroups = FILTER_GROUPS.map((group) => {
    const chips = FILTERS.filter((f) => f.group === group.key).map((f) => `<label class="chip fchip">
          <input type="checkbox" checked data-group="hide" data-key="${escapeHtml(f.key)}" />
          <span class="fchip-text"><b>${escapeHtml(f.name)}</b><small>${escapeHtml(f.hint)}</small></span>
        </label>`).join('\n');
    return `<div class="filter-group">
        <h3>${icon(FILTER_GROUP_ICONS[group.key] || 'funnel', 14)} ${escapeHtml(group.label)}</h3>
        <div class="filter-grid">${chips}</div>
      </div>`;
  }).join('\n');
  const sortPills = SORT_OPTIONS.map((o) => pill('sort', o.key, escapeHtml(o.label), o.key === DEFAULT_SORT, { title: o.hint })).join('\n');
  const sizePills = SIZE_OPTIONS.map((gb) => pill('maxSize', String(gb), gb === 0 ? 'Sin límite' : `${gb} GB`, gb === 0)).join('\n');
  const recommendedNames = FILTERS.filter((f) => RECOMMENDED_HIDE.includes(f.key)).map((f) => f.name).join(', ');

  // Etiquetas técnicas (badges): casillas por grupo y muestras para la vista
  // previa. Las muestras se detectan en servidor y el navegador las redibuja
  // al cambiar grupos o estilo, sin recalcular nada.
  const badgeChips = BADGE_GROUPS.map((g) => `<label class="chip fchip bchip">
          <input type="checkbox" checked data-group="badges" data-key="${escapeHtml(g.key)}" />
          <span class="fchip-text"><b>${escapeHtml(g.label)}</b><small>${escapeHtml(g.hint)}</small></span>
        </label>`).join('\n');
  const BADGE_SAMPLES = [
    'Dune Part Two 2024 2160p UHD BluRay Remux HEVC DV HDR10+ Atmos 7.1 NF MKV',
    'The Bear S03E10 1080p WEB-DL DD+ 5.1 H.264 Subs ESP',
    'Kimetsu no Yaiba S04E08 1080p WEB-DL AV1 Opus 2.0 Latino CR',
  ];
  const badgeSamples = BADGE_SAMPLES.map((name) => ({ name, groups: detectBadgeGroups(name, []) }));
  const badgeStylePills = [
    pill('badgeStyle', 'glass', 'Glass', true),
    pill('badgeStyle', 'split', 'Split', false),
    pill('badgeStyle', 'icondark', 'Icon Dark', false),
  ].join('\n');

  // Regiones de respaldo del despliegue (WATCH_REGION_FALLBACK), por su nombre.
  const fallbackNames = (config.watchRegionFallback || []).map((code) => {
    const hit = REGION_OPTIONS.find((o) => o.code === code);
    return hit ? hit.label : code;
  });
  const fallbackHint = fallbackNames.length
    ? ` Si una plataforma no tiene catálogo en tu país, el addon usa <strong>${escapeHtml(fallbackNames.join(' y luego '))} como respaldo</strong> para que la fila no quede vacía.`
    : '';

  const providerTiles = PLATFORMS.map(providerTile).join('\n');
  const studioTiles = STUDIOS.map(studioTile).join('\n');
  const stremioFast = escapeHtml(`stremio://${host}/manifest.json`);

  const sideLinks = STEPS.map(([id, title, iconName], index) =>
    `<a href="#${id}"${index === 0 ? ' aria-current="true"' : ''}><span class="n">${icon(iconName, 15)}</span><span class="t"><b>${escapeHtml(title)}</b><small data-sum="${id}"></small></span></a>`
  ).join('\n      ');

  // Datos que necesita el script del navegador.
  const initial = initialCfg
    ? {
      lang: initialCfg.lang,
      region: initialCfg.region,
      platforms: initialCfg.platforms ?? null,
      studios: initialCfg.studios ?? null,
      base: initialCfg.base ?? null,
      streams: initialCfg.streams ?? null,
      debridId: initialCfg.debridId || null,
      debridProvider: initialCfg.debridProvider || null,
      hide: Array.isArray(initialCfg.hide) ? initialCfg.hide : [],
      sort: initialCfg.sort || DEFAULT_SORT,
      maxSize: initialCfg.maxSize || 0,
    }
    : null;
  const weights = {
    base: Object.fromEntries(BASE_OPTIONS.map((o) => [o.key, catalogWeight({ base: [o.key] })])),
    platform: PLATFORMS.length ? catalogWeight({ platforms: [PLATFORMS[0].key] }) : 0,
    studio: STUDIOS.length ? catalogWeight({ studios: [STUDIOS[0].key] }) : 0,
  };
  // "<" escapado: un valor con "</script>" no puede cerrar el bloque.
  const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<script>${WEB_I18N_BOOTSTRAP}</script>
<title>Catálogos+ · Configura tu addon de Stremio</title>
<meta name="description" content="Configura Catálogos+ para Stremio: idioma, región, plataformas, estudios, proveedores y filtros de streams (oculta CAM, 3D, 4K…). Instálalo con un clic." />
<meta name="theme-color" content="#000000" />
<link rel="icon" href="/assets/logo.png" type="image/png" />
<style>
${THEME_CSS}
${RAILS_CSS}

  /* ── Cabecera ──────────────────────────────────────────────────────────── */
  .cfg-hero { padding: clamp(30px, 5vw, 60px) 0 clamp(22px, 3vw, 36px); }
  .cfg-hero .wrap { display: flex; flex-direction: column; align-items: flex-start; gap: 18px; }
  .cfg-hero h1 {
    color: #fff; font-weight: 850; letter-spacing: -.048em; line-height: 1;
    font-size: clamp(2.3rem, 5.6vw, 4rem); text-wrap: balance;
  }
  .cfg-hero h1 em {
    font-style: normal; padding-right: .06em;
    background: var(--grad-text); -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent; color: transparent;
  }
  .cfg-hero p { max-width: 64ch; color: var(--text-soft); font-size: clamp(.98rem, 1.4vw, 1.08rem); line-height: 1.62; }
  .hero-ctas { display: flex; gap: 12px; flex-wrap: wrap; }

  /* ── Índice lateral + contenido ────────────────────────────────────────── */
  .layout { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 26px; align-items: start; }
  .side {
    position: sticky; top: 88px; display: grid; gap: 3px; padding: 8px;
    border-radius: var(--r-lg); background: var(--glass); border: 1px solid var(--line);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.05);
  }
  .side a {
    display: flex; align-items: center; gap: 11px; padding: 8px 9px; border-radius: 13px;
    color: var(--text-soft); text-decoration: none; transition: background .18s, color .18s;
  }
  .side a:hover { background: var(--surface-2); color: #fff; }
  .side .n {
    flex: 0 0 auto; width: 34px; height: 34px; border-radius: 11px; color: var(--muted);
    display: flex; align-items: center; justify-content: center;
    background: var(--surface-2); border: 1px solid var(--line); transition: background .18s, color .18s, border-color .18s;
  }
  .side .t { min-width: 0; display: grid; }
  .side b { font-size: .87rem; font-weight: 620; }
  .side small { color: var(--muted); font-size: .73rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-height: 1.2em; }
  .side a[aria-current="true"] { background: rgba(255,255,255,0.077); color: #fff; }
  .side a[aria-current="true"] .n { background: var(--grad); border-color: transparent; color: #000; }
  .side a[aria-current="true"] small { color: #d2d2d7; }

  /* ── Tarjetas de sección ───────────────────────────────────────────────── */
  .card {
    padding: clamp(18px, 2.6vw, 28px); border-radius: var(--r-xl);
    background: linear-gradient(180deg, rgba(255,255,255,.046), rgba(255,255,255,.014));
    border: 1px solid var(--line); box-shadow: inset 0 1px 0 rgba(255,255,255,.05);
  }
  .card + .card { margin-top: 18px; }
  .card-head { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 20px; }
  .card-num {
    flex: 0 0 auto; width: 42px; height: 42px; border-radius: 13px; color: #d2d2d7;
    display: flex; align-items: center; justify-content: center;
    font-family: ${MONO_STACK}; font-size: .8rem; font-weight: 700;
    background: var(--grad-soft); border: 1px solid rgba(0,0,0,0.34); box-shadow: inset 0 1px 0 rgba(255,255,255,.14);
  }
  .card-title { flex: 1; min-width: 0; }
  .card-title h2 {
    display: flex; align-items: center; gap: 9px; flex-wrap: wrap;
    color: #fff; font-size: clamp(1.12rem, 2vw, 1.34rem); font-weight: 780; letter-spacing: -.025em; line-height: 1.2;
  }
  .card-title p { margin-top: 5px; color: var(--muted); font-size: .87rem; line-height: 1.52; max-width: 70ch; }
  .card-count {
    flex: 0 0 auto; align-self: center; display: inline-flex; align-items: center; height: 28px; padding: 0 11px;
    border-radius: var(--r-pill); background: var(--surface-2); border: 1px solid var(--line);
    color: var(--text-soft); font-size: .76rem; font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  .new-tag {
    display: inline-flex; align-items: center; height: 22px; padding: 0 9px; border-radius: var(--r-pill);
    background: var(--grad); color: #000; font-size: .64rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
  }
  .card .hint { margin-top: 14px; }
  .note {
    display: flex; gap: 11px; align-items: flex-start; margin-top: 16px; padding: 13px 15px; border-radius: var(--r-md);
    background: rgba(255,255,255,0.064); border: 1px solid rgba(255,255,255,0.224); color: var(--text-soft); font-size: .86rem; line-height: 1.58;
  }
  .note .ic { margin-top: 2px; color: #d2d2d7; }
  .note strong { color: #fff; font-weight: 650; }
  .note.warn { background: rgba(251,191,36,.08); border-color: rgba(251,191,36,.36); }
  .note.warn .ic { color: var(--warn); }
  .debrid-controls { margin-top: 8px; }
  .debrid-controls > label { display: block; margin-bottom: 8px; color: var(--text-soft); font-size: .82rem; font-weight: 650; }
  .debrid-row { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  .debrid-row input, .debrid-row select {
    flex: 1 1 280px; min-width: 0; height: 40px; padding: 0 12px; outline: 0;
    border-radius: 11px; background: rgba(255,255,255,.06); border: 1px solid var(--line); color: var(--text); font-size: .88rem;
  }
  .debrid-row select { flex-basis: 100%; cursor: pointer; }
  .debrid-row select option { color: #fff; background: #1c1c1e; }
  .debrid-row input:focus, .debrid-row select:focus { border-color: rgba(0,0,0,0.6); box-shadow: 0 0 0 4px rgba(0,0,0,0.14); }
  .debrid-row button:disabled { opacity: .55; cursor: wait; }

  /* ── Idioma y región ───────────────────────────────────────────────────── */
  .duo { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 16px; }
  .picker { min-width: 0; padding: 16px; border-radius: var(--r-lg); background: rgba(255,255,255,.03); border: 1px solid var(--line); }
  .picker-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 10px; margin-bottom: 12px; }
  .picker-head h3 { display: flex; align-items: center; gap: 8px; color: #fff; font-size: .95rem; font-weight: 700; white-space: nowrap; }
  .picker-head h3 .ic { color: #d2d2d7; }
  .picker-current {
    margin-left: auto; min-width: 0; max-width: 100%; display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 10px 0 4px;
    border-radius: 10px; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.32);
    color: #fff; font-size: .8rem; font-weight: 650;
  }
  .picker-current .code { background: var(--grad); color: #000; }
  .picker-current span:last-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .picker-search {
    display: flex; align-items: center; gap: 9px; height: 40px; padding: 0 12px; margin-bottom: 12px;
    border-radius: 12px; background: rgba(255,255,255,.06); border: 1px solid var(--line); color: var(--muted);
    transition: border-color .2s, box-shadow .2s;
  }
  .picker-search:focus-within { border-color: rgba(0,0,0,0.6); box-shadow: 0 0 0 4px rgba(0,0,0,0.14); }
  .picker-search input { flex: 1; min-width: 0; height: 100%; background: transparent; border: 0; outline: 0; color: var(--text); font-size: .88rem; }
  .picker-search input::placeholder { color: var(--muted); }
  .picker-search input::-webkit-search-cancel-button { -webkit-appearance: none; }
  .picker-box {
    position: relative; max-height: 250px; overflow-y: auto; padding: 2px 6px 2px 2px;
    scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.22) transparent;
  }
  .picker-box::-webkit-scrollbar { width: 8px; }
  .picker-box::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); border-radius: 8px; }
  .picker-group + .picker-group { margin-top: 14px; }
  .picker-group h4 { margin: 0 2px 8px; color: var(--muted); font-size: .68rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
  .picker-box .pill small { color: var(--muted); font-size: .76rem; font-weight: 500; }
  .picker-box .pill[aria-pressed="true"] small { color: #d2d2d7; }
  .picker-empty { padding: 12px 2px; color: var(--muted); font-size: .85rem; }

  /* ── Plataformas y estudios ────────────────────────────────────────────── */
  .toggles { display: flex; gap: 8px; margin: 0 0 16px; flex-wrap: wrap; }
  .mini {
    display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 13px; cursor: pointer;
    background: var(--surface); border: 1px solid var(--line); color: var(--text-soft);
    border-radius: 11px; font-size: .8rem; font-weight: 600;
    transition: color .16s, border-color .16s, background .16s;
  }
  .mini:hover { color: #fff; border-color: var(--line-strong); background: var(--surface-2); }
  .mini[hidden] { display: none; }
  /* Preset de filtros activo. */
  .mini[aria-pressed="true"] { border-color: rgba(255,255,255,0.32); background: rgba(255,255,255,0.16); color: #fff; }

  .tile-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(106px, 1fr)); gap: 12px; }
  .provider-tile {
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    padding: 14px 8px 11px; border-radius: var(--r-lg);
    background: var(--surface); border: 1px solid var(--line);
    transition: border-color .18s, background .18s, transform .18s var(--ease), box-shadow .18s;
  }
  .provider-tile:hover { transform: translateY(-3px); border-color: var(--line-strong); background: var(--surface-2); }
  .provider-tile:has(input:checked) {
    border-color: rgba(255,255,255,0.32); background: rgba(255,255,255,0.08);
    box-shadow: 0 0 0 1px rgba(0,0,0,0.2), 0 12px 26px rgba(0,0,0,.34);
  }
  .provider-tile:not(:has(input:checked)) .tile-logo, .studio-tile:not(:has(input:checked)) .studio-logo { opacity: .5; filter: grayscale(.9); }
  .tile-logo {
    position: relative; width: 68px; height: 68px; border-radius: 19px;
    background: #fff; display: flex; align-items: center; justify-content: center; overflow: hidden;
    box-shadow: var(--shadow-sm), inset 0 0 0 1px rgba(0,0,0,.06);
    transition: transform .2s var(--ease), box-shadow .2s, opacity .2s, filter .2s;
  }
  .tile-logo .letter { font-size: 1.6rem; font-weight: 800; color: #c3c8d4; }
  .tile-logo img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; padding: 12px; background: #fff; }

  .studio-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 12px; }
  .studio-tile {
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    padding: 16px 10px 13px; border-radius: var(--r-lg);
    background: var(--surface); border: 1px solid var(--line);
    transition: border-color .18s, transform .18s var(--ease), box-shadow .18s, background .18s;
  }
  .studio-tile:hover { transform: translateY(-3px); border-color: var(--line-strong); background: var(--surface-2); }
  .studio-tile:has(input:checked) {
    border-color: rgba(255,255,255,0.32); background: rgba(255,255,255,0.072);
    box-shadow: 0 0 0 1px rgba(0,0,0,0.18), 0 12px 26px rgba(0,0,0,.32);
  }
  .studio-logo {
    position: relative; width: 72px; height: 72px; border-radius: 19px; overflow: hidden;
    background: #fff; display: flex; align-items: center; justify-content: center;
    box-shadow: var(--shadow-sm), inset 0 0 0 1px rgba(0,0,0,.06);
    transition: opacity .2s, filter .2s;
  }
  .monogram { font-size: 1.45rem; font-weight: 800; letter-spacing: .02em; color: #1a1d29; }
  .studio-logo img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #fff; padding: 10px; }

  /* ── Filtros de streams ────────────────────────────────────────────────── */
  .filter-group + .filter-group { margin-top: 20px; }
  .filter-group h3, .opt-block h3 {
    display: flex; align-items: center; gap: 8px; margin-bottom: 10px;
    color: var(--text-soft); font-size: .72rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
  }
  .filter-group h3 .ic, .opt-block h3 .ic { color: #d2d2d7; }
  .filter-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(218px, 1fr)); gap: 10px; }
  .fchip { display: flex; min-height: 60px; padding: 9px 12px; gap: 11px; border-radius: 14px; }
  .fchip input { width: 20px; height: 20px; border-radius: 7px; }
  .fchip-text { flex: 1; min-width: 0; }
  .fchip-text b { display: block; color: #fff; font-size: .88rem; font-weight: 650; line-height: 1.25; }
  .fchip-text small { display: block; margin-top: 2px; color: var(--muted); font-size: .73rem; line-height: 1.35; }
  /* Desmarcado = oculto: borde discontinuo, nombre tachado y un ojo tachado
     en la casilla (como background-image: un <input> no admite hijos). */
  .fchip:has(input:not(:checked)) { border-style: dashed; border-color: var(--line-strong); background: transparent; }
  .fchip:has(input:not(:checked)) .fchip-text b { color: var(--muted); text-decoration: line-through; text-decoration-color: rgba(251,113,133,.85); }
  .fchip input:not(:checked) {
    border-color: rgba(251,113,133,.5);
    background: rgba(251,113,133,.12) ${iconMask('eye-off', { color: '#fb7185' })} center / 13px 13px no-repeat;
  }
  .opt-duo { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; margin-top: 22px; }
  .opt-block { min-width: 0; padding: 16px; border-radius: var(--r-lg); background: rgba(255,255,255,.03); border: 1px solid var(--line); }
  .opt-block .hint { margin-top: 10px; }
  .summary {
    display: flex; gap: 11px; align-items: flex-start; margin-top: 18px; padding: 13px 15px; border-radius: var(--r-md);
    background: rgba(255,255,255,0.072); border: 1px solid rgba(255,255,255,0.256); color: var(--text-soft); font-size: .87rem; line-height: 1.58;
  }
  .summary .ic { margin-top: 2px; color: #d2d2d7; }
  .bdg-prev { display: grid; gap: 9px; }
  .bdg-sample { border: 1px solid rgba(255,255,255,.09); border-radius: 14px; padding: 10px 12px; background: rgba(255,255,255,.03); display: grid; gap: 7px; }
  .bdg-sample b { font-size: .76rem; font-weight: 600; color: #d2d2d7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bdg-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-height: 24px; }
  .bdg-row:empty::after { content: '—'; color: var(--muted); }
  .bdg { --h: 210; display: inline-flex; align-items: stretch; font-size: .68rem; font-weight: 700; letter-spacing: .04em; line-height: 1; }
  .bdg .t { padding: 6px 9px; }
  .bdg .i { display: none; }
  .bdg[data-style="glass"] { border-radius: 980px; overflow: hidden; background: hsl(var(--h) 42% 16% / .92); border: 1px solid hsl(var(--h) 55% 42% / .45); color: hsl(var(--h) 85% 80%); }
  .bdg[data-style="glass"] .t { padding: 6px 11px; }
  .bdg[data-style="split"] { border-radius: 9px; overflow: hidden; }
  .bdg[data-style="split"] .i { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; background: hsl(var(--h) 72% 46%); color: #0b0b0d; font-weight: 800; }
  .bdg[data-style="split"] .t { background: rgba(255,255,255,.09); color: #f5f5f7; }
  .bdg[data-style="icondark"] { border-radius: 9px; overflow: hidden; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.1); color: #f5f5f7; }
  .bdg[data-style="icondark"] .i { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; margin: 3px; border-radius: 6px; background: linear-gradient(135deg, hsl(var(--h) 82% 58%), hsl(calc(var(--h) + 42) 78% 46%)); color: #0b0b0d; font-weight: 800; }
  .bdg[data-g="resolution"] { --h: 38; } .bdg[data-g="format3d"] { --h: 200; }
  .bdg[data-g="hdr"] { --h: 268; } .bdg[data-g="vcodec"] { --h: 205; }
  .bdg[data-g="acodec"] { --h: 22; } .bdg[data-g="channels"] { --h: 150; }
  .bdg[data-g="source"] { --h: 215; } .bdg[data-g="container"] { --h: 165; }
  .bdg[data-g="service"] { --h: 335; } .bdg[data-g="audiosubs"] { --h: 280; }
  .bdg[data-g="edition"] { --h: 12; } .bdg[data-g="language"] { --h: 190; }

  .after { margin-top: clamp(40px, 6vw, 72px); }

  /* ── Barra flotante de instalación ─────────────────────────────────────── */
  .dock {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 40; pointer-events: none;
    padding: 0 var(--pad) calc(14px + env(safe-area-inset-bottom, 0px));
  }
  .dock-inner {
    pointer-events: auto; max-width: var(--wrap); margin: 0 auto;
    display: flex; align-items: center; gap: 14px; padding: 10px 10px 10px 18px; border-radius: 22px;
    background: rgba(18,18,20,.82); border: 1px solid var(--line-strong);
    backdrop-filter: blur(22px) saturate(1.6); -webkit-backdrop-filter: blur(22px) saturate(1.6);
    box-shadow: 0 24px 60px rgba(0,0,0,.62), 0 0 0 1px rgba(0,0,0,0.14), inset 0 1px 0 rgba(255,255,255,.08);
  }
  .dock-info { flex: 1; min-width: 0; }
  .count { color: var(--muted); font-size: .83rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .count b { color: #fff; font-weight: 750; font-variant-numeric: tabular-nums; }
  .dock-info code {
    display: block; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    font-family: ${MONO_STACK}; font-size: .7rem; color: #d2d2d7;
  }
  .dock-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; }
  .dock-actions .btn-ghost { height: 46px; border-radius: 14px; }
  /* Hueco para que la barra no tape el final de la página. */
  .page-footer { padding-bottom: 96px; }

  @media (max-width: 980px) {
    .layout { grid-template-columns: minmax(0, 1fr); gap: 16px; }
    .side {
      position: static; display: flex; gap: 8px; overflow-x: auto; padding: 2px var(--pad) 6px;
      margin: 0 calc(var(--pad) * -1); background: none; border: 0; box-shadow: none; border-radius: 0; scrollbar-width: none;
    }
    .side::-webkit-scrollbar { display: none; }
    .side a {
      flex: 0 0 auto; gap: 8px; padding: 5px 13px 5px 5px; border-radius: 13px;
      background: var(--surface); border: 1px solid var(--line);
    }
    .side a[aria-current="true"] { border-color: rgba(255,255,255,0.32); }
    .side .n { width: 28px; height: 28px; border-radius: 9px; }
    .side small { display: none; }
    .side b { white-space: nowrap; }
  }
  @media (max-width: 760px) {
    .duo, .opt-duo { grid-template-columns: minmax(0, 1fr); }
    .card-head { flex-wrap: wrap; row-gap: 10px; }
    .card-title { flex: 1 1 calc(100% - 60px); }
    .card-count { margin-left: 56px; }
    .hero-ctas .btn { flex: 1 1 100%; }
    .dock { padding-left: 10px; padding-right: 10px; padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px)); }
    .dock-inner { padding: 8px; border-radius: 19px; gap: 8px; }
    .dock-info { display: none; }
    .dock-actions { flex: 1; }
    .dock-actions .btn-ghost { width: 46px; padding: 0; }
    .dock-actions .btn-ghost .lbl { display: none; }
    .dock-actions .btn-primary { flex: 1; }
    .tile-grid, .studio-grid { grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 10px; }
    .studio-tile { padding: 14px 6px 11px; }
    .studio-logo { width: 68px; height: 68px; }
    .filter-grid { grid-template-columns: minmax(0, 1fr); }
  }

  /* ── Refinamiento visual del configurador ─────────────────────────────── */
  .cfg-hero { padding: clamp(26px, 4.2vw, 52px) 0 clamp(20px, 3vw, 30px); }
  .cfg-hero .wrap { gap: 15px; }
  .cfg-hero h1 { font-size: clamp(2.45rem, 5.2vw, 3.8rem); letter-spacing: -.055em; }
  .cfg-hero p { max-width: 60ch; font-size: clamp(.98rem, 1.3vw, 1.04rem); }
  .layout { grid-template-columns: 232px minmax(0, 1fr); gap: 22px; }
  .side {
    top: 84px; padding: 7px; border-radius: 18px;
    background: rgba(255,255,255,.04); border-color: rgba(255,255,255,0.098);
    box-shadow: 0 12px 28px rgba(0,0,0,.18);
  }
  .side a { border-radius: 11px; }
  .side a[aria-current="true"] { background: rgba(255,255,255,0.072); }
  .side a[aria-current="true"] .n { background: var(--grad); }
  .card {
    padding: clamp(18px, 2.4vw, 26px); border-radius: 22px;
    background: linear-gradient(150deg,rgba(255,255,255,.05),rgba(255,255,255,.02));
    border-color: rgba(255,255,255,0.083); box-shadow: inset 0 1px 0 rgba(255,255,255,.035);
  }
  .card + .card { margin-top: 14px; }
  .card-head { margin-bottom: 18px; }
  .card-num { background: rgba(0,0,0,0.12); border-color: rgba(0,0,0,0.22); box-shadow: none; }
  .card-count { background: rgba(255,255,255,.04); }
  .picker, .opt-block { background: rgba(7,11,18,.4); border-color: rgba(255,255,255,0.083); }
  .provider-tile, .studio-tile { background: rgba(255,255,255,.025); border-color: rgba(255,255,255,0.079); }
  .provider-tile:has(input:checked), .studio-tile:has(input:checked) {
    background: rgba(0,0,0,0.085); border-color: rgba(0,0,0,0.36); box-shadow: inset 0 0 0 1px rgba(0,0,0,0.06);
  }
  .provider-tile:hover, .studio-tile:hover { background: rgba(255,255,255,.055); border-color: rgba(255,255,255,0.18); }
  .fchip { border-radius: 12px; }
  .dock-inner {
    border-radius: 18px; background: rgba(18,18,20,.82); border-color: rgba(255,255,255,0.15);
    box-shadow: 0 18px 48px rgba(0,0,0,.34), inset 0 1px 0 rgba(255,255,255,.045);
  }
  .dock-info code { color: #d2d2d7; }
  @media (max-width: 980px) {
    .layout { grid-template-columns: minmax(0, 1fr); gap: 14px; }
    .side { background: none; box-shadow: none; }
  }
  @media (max-width: 760px) {
    .card { border-radius: 18px; }
    .dock-inner { border-radius: 16px; }
  }

  /* ── Piel Apple TV: índice, tarjetas, selectores y barra de instalación ──
     Fichas opacas sin borde (los paneles interiores se distinguen por tono,
     no por líneas), selección en blanco y la barra inferior como píldora
     flotante de vidrio. */
  .cfg-hero { padding: clamp(34px, 5vw, 64px) 0 clamp(24px, 3vw, 36px); }
  .cfg-hero h1 { font-size: clamp(2.6rem, 5.8vw, 4.4rem); font-weight: 750; letter-spacing: -.045em; }
  /* Titular a dos tonos (ver .title em en lib/theme.js). */
  .cfg-hero h1 em { background: none; -webkit-text-fill-color: currentColor; color: var(--muted); }
  .cfg-hero p { color: #a1a1a6; font-size: clamp(1.02rem, 1.4vw, 1.17rem); line-height: 1.5; letter-spacing: -.012em; }

  .side {
    top: calc(var(--nav-h) + 16px); padding: 8px; border-radius: 20px;
    background: var(--card); border-color: transparent; box-shadow: inset 0 1px 0 rgba(255,255,255,.045);
  }
  .side a { border-radius: 10px; color: #d2d2d7; }
  .side a:hover { background: rgba(255,255,255,.08); color: #fff; }
  .side .n { background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.08); border-radius: 9px; color: #a1a1a6; }
  .side b { font-weight: 600; }
  .side small { color: var(--muted); }
  .side a[aria-current="true"] { background: rgba(255,255,255,.1); }
  .side a[aria-current="true"] .n { background: #f5f5f7; border-color: transparent; color: #000; }
  .side a[aria-current="true"] small { color: #d2d2d7; }

  .card {
    border-radius: 24px; background: var(--card);
    border-color: transparent; box-shadow: inset 0 1px 0 rgba(255,255,255,.045);
  }
  .card-num { background: rgba(255,255,255,.09); border-color: transparent; border-radius: 12px; color: #f5f5f7; box-shadow: none; }
  .card-title h2 { font-weight: 700; letter-spacing: -.028em; }
  .card-title p { color: #a1a1a6; }
  .card-count { background: rgba(255,255,255,.07); border-color: transparent; border-radius: 980px; color: #d2d2d7; }
  .new-tag { background: #f5f5f7; color: #000; border-radius: 980px; letter-spacing: .06em; }

  .note { background: rgba(255,255,255,.055); border-color: transparent; border-radius: 16px; }
  .note .ic { color: var(--brand-2); }
  .note.warn { background: rgba(255,214,10,.08); border-color: rgba(255,214,10,.3); }
  .note.warn .ic { color: var(--warn); }

  .picker, .opt-block { background: rgba(255,255,255,.045); border-color: transparent; border-radius: 18px; }
  .picker-head h3 .ic { color: #f5f5f7; }
  .picker-current { background: rgba(255,255,255,.1); border-color: transparent; border-radius: 980px; }
  .picker-current .code { background: #f5f5f7; color: #000; }
  .picker-search { background: rgba(255,255,255,.06); border-color: transparent; border-radius: 980px; }
  .picker-search:focus-within { border-color: transparent; box-shadow: 0 0 0 3px rgba(41,151,255,.45); }
  .picker-group h4 { color: #6e6e73; letter-spacing: .1em; }
  .picker-box .pill small { color: var(--muted); }
  .picker-box .pill[aria-pressed="true"] small { color: rgba(0,0,0,.55); }
  .picker-box::-webkit-scrollbar-thumb { background: rgba(255,255,255,.16); }

  .mini { background: rgba(255,255,255,.06); border-color: transparent; border-radius: 980px; color: #d2d2d7; }
  .mini:hover { background: rgba(255,255,255,.12); border-color: transparent; color: #fff; }
  .mini[aria-pressed="true"] { background: #f5f5f7; border-color: transparent; color: #000; }

  /* Tiles: la selección se lee por el tono de la ficha, el logo a todo color
     y una marca pequeña dentro de la esquina; lo no elegido queda apagado. */
  .provider-tile, .studio-tile {
    background: rgba(255,255,255,.035); border-color: transparent; border-radius: 18px;
    transition: background .25s var(--ease), transform .35s var(--ease);
  }
  .provider-tile:hover, .studio-tile:hover { background: rgba(255,255,255,.09); border-color: transparent; transform: scale(1.04); }
  .provider-tile:has(input:checked), .studio-tile:has(input:checked) {
    background: rgba(255,255,255,.1); border-color: transparent; box-shadow: none;
  }
  .provider-tile:has(input:checked):hover, .studio-tile:has(input:checked):hover { background: rgba(255,255,255,.15); }
  .tile-logo, .studio-logo { border-radius: 22.5%; box-shadow: 0 4px 14px rgba(0,0,0,.5); }
  .tile-check { top: 7px; right: 7px; width: 19px; height: 19px; box-shadow: 0 0 0 2.5px #2b2b2c; }
  .tile-check::after { width: 11px; height: 11px; }

  .filter-group h3, .opt-block h3 { color: #a1a1a6; letter-spacing: .1em; }
  .filter-group h3 .ic, .opt-block h3 .ic { color: #f5f5f7; }
  .fchip { border-radius: 16px; }
  .fchip:has(input:not(:checked)) { border-color: rgba(255,255,255,.16); }
  .fchip:has(input:not(:checked)) .fchip-text b { text-decoration-color: rgba(255,69,58,.8); }
  .summary { background: rgba(255,255,255,.055); border-color: transparent; border-radius: 16px; }
  .summary .ic { color: var(--brand-2); }

  .debrid-row input, .debrid-row select { background: rgba(255,255,255,.06); border-color: transparent; border-radius: 10px; }
  .debrid-row select option { background: #1c1c1e; color: #f5f5f7; }
  .debrid-row input:focus, .debrid-row select:focus { border-color: transparent; box-shadow: 0 0 0 3px rgba(41,151,255,.45); }

  .dock-inner {
    border-radius: 980px; padding: 10px 12px 10px 24px;
    background: rgba(36,36,38,.72); border-color: rgba(255,255,255,.1);
    backdrop-filter: blur(28px) saturate(180%); -webkit-backdrop-filter: blur(28px) saturate(180%);
    box-shadow: 0 24px 60px rgba(0,0,0,.65), inset 0 1px 0 rgba(255,255,255,.1);
  }
  .count b { color: #f5f5f7; }
  .dock-info code { color: #a1a1a6; }
  .dock-actions .btn-ghost { border-radius: 980px; }

  @media (max-width: 980px) {
    .side { background: none; border: 0; box-shadow: none; }
    .side a { background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.09); border-radius: 980px; }
    .side a[aria-current="true"] { background: #f5f5f7; border-color: transparent; color: #000; }
    .side a[aria-current="true"] .n { background: rgba(0,0,0,.12); color: #000; }
  }
  @media (max-width: 760px) {
    .card { border-radius: 20px; }
    .dock-inner { border-radius: 980px; padding: 8px 8px 8px 18px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .provider-tile:hover, .studio-tile:hover { transform: none; }
  }

  /* Guía de inicio: orientación breve sin exigir que se configure todo. */
  .quick-guide {
    margin: 0 0 20px; padding: 18px; border-radius: 20px;
    background: linear-gradient(125deg,rgba(255,255,255,.075),rgba(255,255,255,.025));
    box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
  }
  .quick-guide-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
  .quick-guide-head h2 { color: #fff; font-size: 1rem; font-weight: 750; letter-spacing: -.02em; }
  .quick-guide-head > span { color: var(--muted); font-size: .78rem; }
  .quick-steps { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 9px; }
  .quick-step {
    min-width: 0; min-height: 68px; display: flex; align-items: center; gap: 10px; padding: 11px;
    border-radius: 14px; background: rgba(0,0,0,.28); color: var(--text); text-decoration: none;
    transition: background .18s, transform .18s;
  }
  .quick-step:hover { background: rgba(255,255,255,.1); transform: translateY(-1px); }
  .quick-step:focus-visible { outline-offset: 2px; }
  .quick-step .quick-number { flex: 0 0 30px; width: 30px; height: 30px; display: grid; place-items: center; border-radius: 10px; background: #f5f5f7; color: #000; font-size: .8rem; font-weight: 800; }
  .quick-step-copy { min-width: 0; display: grid; gap: 2px; }
  .quick-step-copy b { color: #fff; font-size: .82rem; line-height: 1.25; }
  .quick-step-copy small { color: var(--muted); font-size: .72rem; line-height: 1.35; }
  .quick-tip { display: flex; align-items: flex-start; gap: 8px; margin-top: 12px; color: var(--text-soft); font-size: .78rem; line-height: 1.45; }
  .quick-tip .ic { flex: 0 0 auto; margin-top: 1px; color: var(--brand-2); }

  @media (max-width: 760px) {
    .cfg-hero { padding: 26px 0 18px; }
    .cfg-hero .wrap { gap: 12px; }
    .cfg-hero h1 { font-size: clamp(2.25rem, 11vw, 3.2rem); line-height: 1.03; }
    .cfg-hero p { font-size: .96rem; line-height: 1.52; }
    .quick-guide { margin-bottom: 12px; padding: 14px; border-radius: 17px; }
    .quick-guide-head { align-items: flex-start; flex-direction: column; gap: 2px; }
    .quick-steps { grid-template-columns: minmax(0,1fr); gap: 7px; }
    .quick-step { min-height: 56px; padding: 9px 11px; }
    .quick-step .quick-number { flex-basis: 32px; width: 32px; height: 32px; }
    .quick-step-copy b { font-size: .84rem; }
    .quick-step-copy small { font-size: .75rem; }
    .side {
      position: sticky; top: 74px; z-index: 45; gap: 7px; padding: 7px 12px;
      margin: 0 calc(var(--pad) * -1); background: rgba(10,10,11,.9); border: 0;
      border-bottom: 1px solid rgba(255,255,255,.08); border-radius: 0;
      backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
      scroll-snap-type: x proximity;
    }
    .side a { min-height: 42px; scroll-snap-align: start; }
    .side .n { width: 30px; height: 30px; }
    .card { padding: 17px 15px; }
    .picker { padding: 13px; }
    .picker-box { max-height: 220px; }
    .tile-grid { grid-template-columns: repeat(auto-fill,minmax(100px,1fr)); gap: 8px; }
    .provider-tile, .studio-tile { min-height: 44px; }
    .filter-grid { gap: 8px; }
    .fchip { min-height: 54px; padding: 10px; }
    .mini { min-height: 40px; height: auto; padding: 8px 12px; }
    .dock { padding-left: 8px; padding-right: 8px; }
    .dock-actions { gap: 6px; }
    .dock-actions .btn-ghost { min-width: 44px; min-height: 44px; }
    .dock-actions .btn-primary { min-height: 46px; padding-left: 14px; padding-right: 14px; }
    .page-footer { padding-bottom: calc(104px + env(safe-area-inset-bottom,0px)); }
  }
  @media (max-width: 380px) {
    .hero-ctas { width: 100%; }
    .hero-ctas .btn { min-height: 46px; }
    .card-title p { font-size: .82rem; }
    .dock-actions .btn-primary { font-size: .82rem; }
  }
</style>
<noscript><style>html[data-i18n-pending] body{visibility:visible!important}</style></noscript>
</head>
<body>

${backgroundHtml()}

${navHtml({
    links: [['/', 'Inicio'], ['#plataformas', 'Plataformas'], ['#estudios', 'Estudios'], ['#filtros', 'Filtros']],
    actions: `<a class="btn btn-primary btn-sm" data-install href="${stremioFast}">${icon('download', 16)}<span class="lbl">Instalar</span></a>`,
  })}

<header class="cfg-hero">
  <div class="wrap">
    <span class="badge"><span class="dot"></span> Configurador</span>
    <h1>Tu Stremio, <em>a tu gusto.</em></h1>
    <p>Elige idioma y región, las plataformas y estudios que quieres ver y qué streams prefieres. Todo es opcional: lo que no toques se queda como viene. Al terminar, pulsa «Instalar en Stremio».</p>
    <div class="hero-ctas">
      <a class="btn btn-primary btn-lg" id="installBtn" data-install href="${stremioFast}">${icon('download', 19)} Instalar en Stremio</a>
      <a class="btn btn-ghost btn-lg" href="#filtros">${icon('funnel', 18)} Filtros de streams</a>
    </div>
  </div>
</header>

<main class="wrap" id="contenido">
  <section class="quick-guide" aria-labelledby="quickGuideTitle">
    <div class="quick-guide-head">
      <h2 id="quickGuideTitle">Empieza aquí</h2>
      <span>3 pasos · sin complicaciones</span>
    </div>
    <nav class="quick-steps" aria-label="Guía rápida de configuración">
      <a class="quick-step" href="#idioma"><span class="quick-number" aria-hidden="true">1</span><span class="quick-step-copy"><b>Idioma y región</b><small>Elige el idioma de los títulos y tu país.</small></span></a>
      <a class="quick-step" href="#plataformas"><span class="quick-number" aria-hidden="true">2</span><span class="quick-step-copy"><b>Elige qué aparece</b><small>Marca tus plataformas; puedes dejar lo demás como está.</small></span></a>
      <a class="quick-step" href="#filtros"><span class="quick-number" aria-hidden="true">3</span><span class="quick-step-copy"><b>Afina tus streams</b><small>Prueba «Recomendado» y luego instala desde abajo.</small></span></a>
    </nav>
    <p class="quick-tip">${icon('sparkles', 15)}<span>Sugerencia: empieza por «Recomendado» para ocultar CAM, screener y 3D. Debrid es opcional.</span></p>
  </section>
  <div class="layout">
    <nav class="side" aria-label="Secciones del configurador">
      ${sideLinks}
    </nav>

    <div class="sections">
      <!-- 01 · Idioma y región -->
      <section class="card" id="idioma">
        ${cardHead('01', 'Idioma y región', 'El idioma cambia títulos, sinopsis y pósters. La región decide qué ofrece cada plataforma en tu país y qué hay en cines.')}
        <div class="duo">
          <div class="picker">
            <div class="picker-head">
              <h3>${icon('languages', 17)} Idioma</h3>
              <span class="picker-current"><span class="code" id="langCode">${escapeHtml(defaultLang)}</span><span id="langName">${escapeHtml(langOf ? langOf.label : defaultLang)}</span></span>
            </div>
            <label class="picker-search">${icon('search', 16)}<input type="search" data-filter-for="langGroup" placeholder="Buscar idioma…" autocomplete="off" aria-label="Buscar idioma" /></label>
            <div class="picker-box" id="langGroup">
              <div class="picker-group"><div class="pills">${langPills}</div></div>
              <p class="picker-empty" hidden>Ningún idioma coincide.</p>
            </div>
          </div>
          <div class="picker">
            <div class="picker-head">
              <h3>${icon('map-pin', 17)} Región de plataformas</h3>
              <span class="picker-current"><span class="code" id="regionCode">${escapeHtml(defaultRegion)}</span><span id="regionName">${escapeHtml(regionOf ? regionOf.label : defaultRegion)}</span></span>
            </div>
            <label class="picker-search">${icon('search', 16)}<input type="search" data-filter-for="regionGroup" placeholder="Buscar país…" autocomplete="off" aria-label="Buscar país" /></label>
            <div class="picker-box" id="regionGroup">
              ${regionGroups}
              <p class="picker-empty" hidden>Ningún país coincide.</p>
            </div>
          </div>
        </div>
        <p class="hint"><span>El idioma de los catálogos controla títulos, sinopsis y pósters; esta web se adapta automáticamente al idioma de tu navegador.</span>${fallbackHint}</p>
      </section>

      <!-- 02 · Plataformas -->
      <section class="card" id="plataformas">
        ${cardHead('02', 'Plataformas', 'Marca las que quieres tener en Stremio. Cada una crea una fila de películas y otra de series.', 'platforms')}
        <div class="toggles"><button class="mini" data-toggle="platforms:all" type="button">${icon('check', 14)} Marcar todas</button><button class="mini" data-toggle="platforms:none" type="button">${icon('x', 14)} Desmarcar todas</button></div>
        <div class="tile-grid" id="platformGrid">${providerTiles}</div>
      </section>

      <!-- 03 · Estudios -->
      <section class="card" id="estudios">
        ${cardHead('03', 'Estudios', 'Películas y series de cada productora.', 'studios')}
        <div class="toggles"><button class="mini" data-toggle="studios:all" type="button">${icon('check', 14)} Marcar todos</button><button class="mini" data-toggle="studios:none" type="button">${icon('x', 14)} Desmarcar todos</button></div>
        <div class="studio-grid" id="studioGrid">${studioTiles}</div>
      </section>

      <!-- 04 · Catálogos base -->
      <section class="card" id="catalogos">
        ${cardHead('04', 'Catálogos base', 'Las colecciones generales: tendencias, estrenos, anime…', 'base')}
        <div class="chips" id="baseGroup">${baseChips}</div>
      </section>

      <!-- 05 · Proveedores de streams -->
      <section class="card" id="streams">
        ${cardHead('05', 'Proveedores de streams', 'Buscadores públicos de torrents que se consultan a la vez al abrir una película o un episodio. Sin claves ni cuentas.', 'streams')}
        <div class="chips" id="streamGroup">${streamChips}</div>
        <p class="hint">Torrentio ES/Latino busca en MejorTorrent, Wolfmax4K y Cinecalidad; Índice BR aporta lanzamientos en portugués de Brasil. Knaben, Torlock y The RarBg son fuentes generales; Nyaa se usa para anime y producciones asiáticas, YTS para películas y EZTV para series. Torrentio usa una instancia pública de terceros y puedes desactivarlo si prefieres no depender de ella.</p>
        <div class="note warn" id="streamWarn" hidden>${icon('info', 17)}<span>Sin ningún proveedor marcado, el addon no devolverá streams: solo catálogos y fichas.</span></div>
      </section>

      <!-- 06 · Servicios debrid -->
      <section class="card" id="debrid">
        ${cardHead('06', 'Servicios debrid <span class="new-tag">Opcional</span>', 'Conecta TorBox, EasyDebrid, Premiumize o Real-Debrid. Los magnets públicos siguen disponibles como alternativa.')}
        <div class="debrid-controls">
          <label for="debridProvider">Proveedor</label>
          <div class="debrid-row">
            <select id="debridProvider" aria-label="Proveedor debrid">
              <option value="torbox">TorBox</option>
              <option value="easydebrid">EasyDebrid</option>
              <option value="premiumize">Premiumize</option>
              <option value="realdebrid">Real-Debrid · OAuth</option>
            </select>
          </div>
        </div>
        <div class="debrid-controls">
          <label id="debridTokenLabel" for="debridToken">Clave API del proveedor</label>
          <div class="debrid-row">
            <input id="debridToken" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="1024" placeholder="Pega aquí tu clave API" aria-describedby="debridHelp" />
            <button class="mini" id="connectDebrid" type="button">Validar y conectar</button>
            <button class="mini" id="authorizeRealDebrid" type="button" hidden>Autorizar con Real-Debrid</button>
            <button class="mini" id="disconnectDebrid" type="button" hidden>Desconectar</button>
          </div>
          <p class="hint" id="debridStatus" role="status" aria-live="polite">No conectado. Opcional: los torrents públicos seguirán funcionando.</p>
        </div>
        <p class="hint" id="debridHelp">Dónde está cada clave: <b>TorBox</b> → torbox.app/settings, apartado «API Key» (no el token de sesión). <b>Premiumize</b> → premiumize.me/account, «API key» (el Customer ID no basta). <b>EasyDebrid</b> → panel, sección API. Las claves se validan en el servidor y se guardan cifradas; nunca van al navegador ni a la URL. Real-Debrid usa OAuth y no pide pegar su token privado. El manifest solo contiene un identificador opaco: no compartas tu URL personal.</p>
        <div class="note">${icon('shield-check', 17)}<span>TorBox comprueba la caché y crea el elemento solo con <code>add_only_if_cached=true</code> y <code>seed=3</code> («no sembrar» en la API de TorBox); el hit puede quedar en tu cuenta. EasyDebrid consulta sus archivos cacheados. Premiumize usa una comprobación best-effort y generar enlaces directos puede consumir fair-use. Real-Debrid solo resuelve torrents descargados que ya están en tu biblioteca personal: no consulta la caché global ni añade torrents.</span></div>
      </section>

      <!-- 07 · Filtros de streams -->
      <section class="card" id="filtros">
        ${cardHead('07', 'Filtros de streams <span class="new-tag">Nuevo</span>', 'Marcado = se muestra. Lo que desmarques deja de aparecer en la lista de streams de Stremio.', 'hide')}
        <div class="toggles">
          <button class="mini" data-preset="recommended" type="button" aria-pressed="false" title="Oculta: ${escapeHtml(recommendedNames)}">${icon('sparkles', 14)} Recomendado: sin CAM, screener ni 3D</button>
          <button class="mini" data-preset="all" type="button" aria-pressed="true">${icon('eye', 14)} Mostrar todo</button>
        </div>
        ${filterGroups}
        <div class="note warn" id="filterWarn" hidden>${icon('info', 17)}<span id="filterWarnText"></span></div>
        <p class="hint">Un stream se oculta si entra en <strong>cualquiera</strong> de las categorías desmarcadas: con «3D» desmarcado desaparece un 3D aunque sea 1080p. La categoría sale del nombre del archivo, así que una copia mal etiquetada puede colarse.</p>

        <div class="opt-duo">
          <div class="opt-block">
            <h3>${icon('arrow-up-down', 14)} Orden</h3>
            <div class="pills" id="sortGroup">${sortPills}</div>
            <p class="hint" id="sortHint"></p>
          </div>
          <div class="opt-block">
            <h3>${icon('hard-drive', 14)} Tamaño máximo</h3>
            <div class="pills" id="sizeGroup">${sizePills}</div>
            <p class="hint">Cuenta el torrent entero: un pack con la temporada completa pesa mucho más que un episodio suelto.</p>
          </div>
        </div>

        <div class="summary">${icon('funnel', 17)}<span id="filterSummary"></span></div>
      </section>

      <section class="card" id="badges">
        ${cardHead('08', 'Etiquetas de stream <span class="new-tag">Nuevo</span>', 'Qué datos técnicos se escriben en cada stream (4K · DV · HEVC · Atmos · 7.1 · WEB-DL…). En Stremio se ven como texto; en Nuvio pueden dibujarse como insignias con imágenes.', 'badges')}
        <div class="toggles">
          <button class="mini" data-badges-preset="all" type="button" aria-pressed="true">${icon('eye', 14)} Todas</button>
          <button class="mini" data-badges-preset="core" type="button" aria-pressed="false" title="Resolución, rango dinámico, fuente e idioma">${icon('sparkles', 14)} Esenciales</button>
        </div>
        <div class="filter-grid">${badgeChips}</div>

        <div class="opt-duo">
          <div class="opt-block">
            <h3>${icon('star', 14)} Estilo de la vista previa</h3>
            <div class="pills" id="badgeStyleGroup">${badgeStylePills}</div>
            <p class="hint">Así se verían las etiquetas del stream con cada estilo.</p>
          </div>
          <div class="opt-block">
            <h3>${icon('tv', 14)} Vista previa</h3>
            <div class="bdg-prev" id="badgePreview" data-samples="${escapeHtml(JSON.stringify(badgeSamples))}"></div>
          </div>
        </div>

        <div class="summary">${icon('tag', 17)}<span id="badgeSummary"></span></div>
        <div class="note">${icon('info', 17)}<span>En Stremio estas etiquetas se leen como texto. Las insignias con imágenes solo las dibuja Nuvio (Perfil → Layout → Streams → «Fusion badge URLs»), pegando el manifiesto de un pack como <a href="https://github.com/farizmohd70/FR-Badges" target="_blank" rel="noopener">FR-Badges</a>.</span></div>
      </section>

      <div class="note">${icon('info', 17)}<span>Al instalar se crea una URL personal con tu selección. <strong>Si ya tenías Catálogos+ instalado, desinstala la versión anterior</strong> en Stremio (Addons): para Stremio cada configuración es un addon distinto, y la antigua seguiría mostrando sus catálogos y sus streams sin filtrar.</span></div>
    </div>
  </div>

  <div class="after">
    ${supportCardHtml()}
    ${donateCardHtml()}
  </div>

  <div class="after">
    ${posterRailHtml({ title: 'Tendencias', accent: 'películas esta semana', items: railMovies, href: '#plataformas', cta: 'Elegir catálogos' })}
    ${posterRailHtml({ title: 'Tendencias', accent: 'series esta semana', items: railSeries, href: '#plataformas', cta: 'Elegir catálogos' })}
  </div>
</main>

<div class="dock" role="region" aria-label="Instalación">
  <div class="dock-inner">
    <div class="dock-info">
      <div class="count" id="countLine">Calculando…</div>
      <code id="manifestUrl"></code>
    </div>
    <div class="dock-actions">
      <button class="btn btn-ghost btn-sm" id="resetBtn" type="button" title="Volver a los valores de serie" aria-label="Restablecer">${icon('rotate-ccw', 16)}<span class="lbl">Restablecer</span></button>
      <button class="btn btn-ghost btn-sm" id="copyBtn" type="button" title="Copiar la URL del manifest" aria-label="Copiar la URL del manifest">${icon('copy', 16)}<span class="lbl" id="copyLabel">Copiar URL</span></button>
      <a class="btn btn-primary" id="installBtnFooter" data-install href="${stremioFast}">${icon('download', 18)} Instalar en Stremio</a>
    </div>
  </div>
</div>

${footerHtml()}

<script>
const PLATFORMS = ${json(PLATFORMS.map((p) => ({ key: p.key, name: p.name })))};
const STUDIOS = ${json(STUDIOS.map((s) => ({ key: s.key, name: s.name })))};
const BASE = ${json(BASE_OPTIONS.map((o) => o.key))};
const STREAMS = ${json(STREAM_PROVIDERS.map((p) => p.key))};
const DEBRID_PROVIDERS = ${json(DEBRID_PROVIDER_KEYS)};
const LANGS = ${json(LANG_OPTIONS.map((o) => ({ code: o.code, label: o.label })))};
const REGIONS = ${json(REGION_OPTIONS.map((o) => ({ code: o.code, label: o.label })))};
const FILTERS = ${json(FILTERS.map((f) => ({ key: f.key, group: f.group, name: f.name })))};
const FILTER_GROUPS = ${json(FILTER_GROUPS)};
const RECOMMENDED_HIDE = ${json(RECOMMENDED_HIDE)};
const BADGE_GROUPS_META = ${json(BADGE_GROUPS.map((g) => ({ key: g.key, label: g.label })))};
const BADGE_KEYS = ${json(BADGE_KEYS)};
const BADGE_CORE = ${json(['resolution', 'hdr', 'source', 'language'])};
const SORTS = ${json(SORT_OPTIONS)};
const DEFAULT_SORT = ${json(DEFAULT_SORT)};
const MAX_SIZE_GB = ${json(MAX_SIZE_GB)};
const WEIGHTS = ${json(weights)};
const INITIAL = ${json(initial)};
const DEFAULT_LANG = ${json(defaultLang)};
const DEFAULT_REGION = ${json(defaultRegion)};
const STORAGE_KEY = 'catalogos-plus-config-v1';
// Proveedores que existían cuando el borrador guardado aún no anotaba cuáles conocía.
const LEGACY_STREAMS = ['knaben', 'torlock', 'blackholebay'];

const state = {
  lang: DEFAULT_LANG,
  region: DEFAULT_REGION,
  platforms: new Set(PLATFORMS.map(p => p.key)),
  studios: new Set(STUDIOS.map(s => s.key)),
  base: new Set(BASE),
  streams: new Set(STREAMS),
  // Filtros de streams: categorías ocultas, orden y tamaño máximo en GB.
  // maxSize va como texto ('0' = sin límite) porque se compara con data-value.
  hide: new Set(),
  badgesOff: new Set(),
  badgeStyle: 'glass',
  sort: DEFAULT_SORT,
  maxSize: '0',
  debridId: null,
  debridProvider: null,
  debridSelection: 'torbox',
  // Aviso del proveedor cuando la clave vale pero la cuenta no tiene plan.
  debridWarning: null,
};

// Misma regla que normalizeMaxSize en el servidor: entero entre 0 y MAX_SIZE_GB.
function sizeValue(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? String(Math.min(n, MAX_SIZE_GB)) : '0';
}
function loadStreamPrefs(src) {
  if (Array.isArray(src.hide)) state.hide = new Set(src.hide.filter(k => FILTERS.some(f => f.key === k)));
  if (Array.isArray(src.badges)) state.badgesOff = new Set(BADGE_KEYS.filter(k => !src.badges.includes(k)));
  if (SORTS.some(s => s.key === src.sort)) state.sort = src.sort;
  if (src.maxSize !== undefined && src.maxSize !== null) state.maxSize = sizeValue(src.maxSize);
}
function validDebridId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32}$/.test(value);
}
function validDebridProvider(value) {
  return DEBRID_PROVIDERS.includes(value);
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      lang: state.lang, region: state.region,
      platforms: [...state.platforms], studios: [...state.studios], base: [...state.base],
      streams: [...state.streams], knownStreams: STREAMS,
      hide: [...state.hide], sort: state.sort, maxSize: Number(state.maxSize),
      debridId: state.debridId,
      debridProvider: state.debridProvider,
      debridSelection: state.debridSelection,
    }));
  } catch (e) {}
}
function restore() {
  // Si llegamos desde Stremio (/<tu-config>/configure), manda tu config
  // instalada: la región y la selección deben verse tal cual las tienes.
  if (INITIAL) {
    if (INITIAL.lang) state.lang = INITIAL.lang;
    if (INITIAL.region) state.region = INITIAL.region;
    if (Array.isArray(INITIAL.platforms)) state.platforms = new Set(INITIAL.platforms.filter(k => PLATFORMS.some(p => p.key === k)));
    if (Array.isArray(INITIAL.studios)) state.studios = new Set(INITIAL.studios.filter(k => STUDIOS.some(s => s.key === k)));
    if (Array.isArray(INITIAL.base)) state.base = new Set(INITIAL.base.filter(k => BASE.includes(k)));
    if (Array.isArray(INITIAL.streams)) state.streams = new Set(INITIAL.streams.filter(k => STREAMS.includes(k)));
    if (Array.isArray(INITIAL.badges)) state.badgesOff = new Set(BADGE_KEYS.filter(k => !INITIAL.badges.includes(k)));
    state.debridId = validDebridId(INITIAL.debridId) ? INITIAL.debridId : null;
    state.debridProvider = state.debridId && validDebridProvider(INITIAL.debridProvider) ? INITIAL.debridProvider : null;
    state.debridSelection = validDebridProvider(INITIAL.debridSelection)
      ? INITIAL.debridSelection
      : state.debridProvider || 'torbox';
    loadStreamPrefs(INITIAL);
    return;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved) return;
    if (LANGS.some(l => l.code === saved.lang)) state.lang = saved.lang;
    if (REGIONS.some(r => r.code === saved.region)) state.region = saved.region;
    if (Array.isArray(saved.platforms)) state.platforms = new Set(saved.platforms.filter(k => PLATFORMS.some(p => p.key === k)));
    if (Array.isArray(saved.studios)) state.studios = new Set(saved.studios.filter(k => STUDIOS.some(s => s.key === k)));
    if (Array.isArray(saved.base)) state.base = new Set(saved.base.filter(k => BASE.includes(k)));
    if (Array.isArray(saved.streams)) {
      // Un proveedor añadido después de guardar el borrador (p. ej. EZTV)
      // nace marcado, como para quien entra por primera vez; solo se respeta
      // lo que se desmarcó entre los que ya existían entonces.
      const known = Array.isArray(saved.knownStreams) ? saved.knownStreams : LEGACY_STREAMS;
      state.streams = new Set(STREAMS.filter(k => saved.streams.includes(k) || !known.includes(k)));
    }
    if (Array.isArray(saved.badges)) state.badgesOff = new Set(BADGE_KEYS.filter(k => !saved.badges.includes(k)));
    state.debridId = validDebridId(saved.debridId) ? saved.debridId : null;
    state.debridProvider = state.debridId && validDebridProvider(saved.debridProvider) ? saved.debridProvider : null;
    state.debridSelection = validDebridProvider(saved.debridSelection)
      ? saved.debridSelection
      : state.debridProvider || 'torbox';
    loadStreamPrefs(saved);
  } catch (e) {}
}

function b64url(obj) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
    .split('+').join('-').split('/').join('_').split('=').join('');
}
function isDefault() {
  return state.platforms.size === PLATFORMS.length && state.studios.size === STUDIOS.length
    && state.base.size === BASE.length && state.streams.size === STREAMS.length
    && state.lang === DEFAULT_LANG && state.region === DEFAULT_REGION
    && state.hide.size === 0 && state.badgesOff.size === 0 && state.sort === DEFAULT_SORT && state.maxSize === '0'
    && !state.debridId;
}
function personalUrl() {
  if (isDefault()) return window.location.origin + '/manifest.json';
  const slim = { lang: state.lang, region: state.region, platforms: [...state.platforms], studios: [...state.studios], base: [...state.base], streams: [...state.streams] };
  if (state.debridId) {
    slim.debridId = state.debridId;
    if (validDebridProvider(state.debridProvider)) slim.debridProvider = state.debridProvider;
  }
  // Los filtros solo viajan en la URL si cambian algo (igual que encodeConfig).
  if (state.hide.size) slim.hide = FILTERS.map(f => f.key).filter(k => state.hide.has(k));
  if (state.badgesOff.size) slim.badges = BADGE_KEYS.filter(k => !state.badgesOff.has(k));
  if (state.sort !== DEFAULT_SORT) slim.sort = state.sort;
  if (state.maxSize !== '0') slim.maxSize = Number(state.maxSize);
  return window.location.origin + '/' + b64url(slim) + '/manifest.json';
}

function setChecks(group, isOn) {
  document.querySelectorAll('input[data-group="' + group + '"]').forEach(i => { i.checked = isOn(i.dataset.key); });
}
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
function debridProviderName(provider) {
  return ({ torbox: 'TorBox', easydebrid: 'EasyDebrid', premiumize: 'Premiumize', realdebrid: 'Real-Debrid' })[provider] || '';
}
function esc(text) {
  return String(text).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
}
function drawBadgePreview() {
  const box = document.getElementById('badgePreview');
  if (!box) return;
  let samples = [];
  try { samples = JSON.parse(box.dataset.samples || '[]'); } catch (_) { samples = []; }
  const style = state.badgeStyle === 'split' || state.badgeStyle === 'icondark' ? state.badgeStyle : 'glass';
  box.innerHTML = samples.map((s) => {
    const chips = Object.keys(s.groups || {})
      .filter((g) => !state.badgesOff.has(g))
      .map((g) => {
        const token = String(s.groups[g]);
        return '<span class="bdg" data-style="' + style + '" data-g="' + g + '"><span class="i">'
          + esc(token.charAt(0).toUpperCase()) + '</span><span class="t">' + esc(token) + '</span></span>';
      }).join('');
    return '<div class="bdg-sample"><b>' + esc(s.name) + '</b><div class="bdg-row">' + chips + '</div></div>';
  }).join('');
}
function render() {
  document.querySelectorAll('.pill[data-group]').forEach(p => {
    p.setAttribute('aria-pressed', String(state[p.dataset.group] === p.dataset.value));
  });
  setChecks('platforms', k => state.platforms.has(k));
  setChecks('studios', k => state.studios.has(k));
  setChecks('base', k => state.base.has(k));
  setChecks('streams', k => state.streams.has(k));
  // En los filtros la casilla marcada significa "se muestra".
  setChecks('hide', k => !state.hide.has(k));
  setChecks('badges', k => !state.badgesOff.has(k));

  const lang = LANGS.find(l => l.code === state.lang);
  const region = REGIONS.find(r => r.code === state.region);
  setText('langCode', state.lang);
  setText('langName', lang ? lang.label : state.lang);
  setText('regionCode', state.region);
  setText('regionName', region ? region.label : state.region);

  // Filtros: resumen en palabras y aviso si no puede quedar ningún stream.
  const hidden = FILTERS.filter(f => state.hide.has(f.key));
  const sort = SORTS.find(s => s.key === state.sort) || SORTS[0];
  const maxSize = Number(state.maxSize);
  setText('sortHint', sort.hint + '.');
  setText('filterSummary',
    (hidden.length ? 'Se ocultan: ' + hidden.map(f => f.name).join(', ') + '.' : 'No se oculta nada: verás todos los streams.')
    + ' Orden: ' + sort.label.toLowerCase() + '.'
    + (maxSize ? ' Tamaño máximo: ' + maxSize + ' GB.' : ''));
  // Todo stream tiene un tipo de copia y una resolución: con uno de esos
  // grupos desmarcado entero no queda nada que mostrar.
  const emptied = FILTER_GROUPS.filter(g => g.key !== 'video' && FILTERS.filter(f => f.group === g.key).every(f => state.hide.has(f.key)));
  document.getElementById('filterWarn').hidden = emptied.length === 0;
  setText('filterWarnText', emptied.length
    ? 'Has desmarcado todo en «' + emptied.map(g => g.label).join('» y «') + '»: no quedará ningún stream que mostrar. Deja al menos una opción marcada.'
    : '');
  const offGroups = BADGE_GROUPS_META.filter(g => state.badgesOff.has(g.key));
  setText('badgeSummary', offGroups.length
    ? 'Sin etiquetas de: ' + offGroups.map(g => g.label).join(', ') + '.'
    : 'Todas las etiquetas detectadas se escribirán en el stream.');
  drawBadgePreview();
  document.getElementById('streamWarn').hidden = state.streams.size > 0;
  const debridSelect = document.getElementById('debridProvider');
  const selectedProvider = validDebridProvider(state.debridSelection) ? state.debridSelection : 'torbox';
  debridSelect.value = selectedProvider;
  const rdSelected = selectedProvider === 'realdebrid';
  document.getElementById('debridTokenLabel').hidden = rdSelected;
  document.getElementById('debridToken').hidden = rdSelected;
  document.getElementById('connectDebrid').hidden = rdSelected;
  document.getElementById('authorizeRealDebrid').hidden = !rdSelected;
  document.getElementById('connectDebrid').textContent = 'Validar y conectar ' + debridProviderName(selectedProvider);
  document.getElementById('disconnectDebrid').hidden = !state.debridId;
  const connectionMessage = !state.debridId
    ? 'No conectado. Opcional: los torrents públicos seguirán funcionando.'
    : !validDebridProvider(state.debridProvider)
      ? 'Configuración debrid antigua detectada. Vuelve a conectar un proveedor para renovar la credencial de forma segura.'
      : state.debridProvider === 'realdebrid'
        ? 'Conectado a Real-Debrid mediante OAuth. Solo se muestran torrents completados de tu biblioteca personal; no se consulta la caché global ni se añaden torrents.'
        : state.debridProvider === 'torbox'
          ? 'Conectado a TorBox. Solo se añaden resultados tras un hit de caché y con add_only_if_cached=true (seed=3: sin sembrar); el elemento puede quedar en tu cuenta.'
          : state.debridProvider === 'premiumize'
            ? 'Conectado a Premiumize. La consulta de caché es best-effort; la generación del enlace directo puede consumir fair-use.'
            : 'Conectado a EasyDebrid. Se genera un enlace solo después de confirmar el estado cacheado.';
  setText('debridStatus', connectionMessage
    + (state.debridWarning === 'plan_inactive' && state.debridId
      ? ' ⚠️ La cuenta no muestra una suscripción activa en ' + debridProviderName(state.debridProvider) + ': el proveedor puede no devolver enlaces directos.'
      : ''));
  document.getElementById('disconnectDebrid').textContent = state.debridId
    ? 'Desconectar ' + (debridProviderName(state.debridProvider) || 'proveedor anterior')
    : 'Desconectar';
  // Preset activo: "Recomendado" solo si lo oculto es exactamente su lista.
  const isRecommended = state.hide.size === RECOMMENDED_HIDE.length && RECOMMENDED_HIDE.every(k => state.hide.has(k));
  document.querySelectorAll('[data-preset]').forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.preset === 'recommended' ? isRecommended : state.hide.size === 0));
  });

  // Contadores de cada tarjeta y resumen del índice lateral.
  const counts = {
    platforms: [state.platforms.size, PLATFORMS.length],
    studios: [state.studios.size, STUDIOS.length],
    base: [state.base.size, BASE.length],
    streams: [state.streams.size, STREAMS.length],
    hide: [FILTERS.length - state.hide.size, FILTERS.length],
  };
  document.querySelectorAll('[data-count]').forEach(el => {
    const c = counts[el.dataset.count];
    if (c) el.textContent = c[0] + ' de ' + c[1];
  });
  const filterBits = [state.hide.size ? state.hide.size + (state.hide.size === 1 ? ' oculto' : ' ocultos') : 'Todo visible'];
  if (state.sort !== DEFAULT_SORT) filterBits.push(sort.label.toLowerCase());
  if (maxSize) filterBits.push('máx. ' + maxSize + ' GB');
  const sums = {
    idioma: (lang ? lang.label : state.lang) + ' · ' + state.region,
    plataformas: counts.platforms.join(' de '),
    estudios: counts.studios.join(' de '),
    catalogos: counts.base.join(' de '),
    streams: counts.streams.join(' de '),
    debrid: state.debridId ? (debridProviderName(state.debridProvider) || 'Reconectar') : 'Opcional · sin conectar',
    filtros: filterBits.join(' · '),
  };
  document.querySelectorAll('[data-sum]').forEach(el => { el.textContent = sums[el.dataset.sum] || ''; });

  const baseCount = [...state.base].reduce((n, k) => n + (WEIGHTS.base[k] || 0), 0);
  const total = baseCount + state.platforms.size * WEIGHTS.platform + state.studios.size * WEIGHTS.studio;
  // Números y códigos de idioma y región. Los códigos se escapan porque la
  // región por defecto es la variable WATCH_REGION del despliegue, tal cual.
  document.getElementById('countLine').innerHTML =
    '<b>' + total + '</b> <span>catálogos</span> · <b>' + state.streams.size + '</b> <span>proveedores</span> · <span>idioma</span> <b>' + esc(state.lang) + '</b> · <span>región</span> <b>' + esc(state.region) + '</b>'
    + (state.debridId ? ' · <b>' + esc(debridProviderName(state.debridProvider) || 'Debrid') + '</b>' : '')
    + (state.hide.size ? ' · <b>' + state.hide.size + '</b> <span>' + (state.hide.size === 1 ? 'filtro' : 'filtros') + '</span>' : '')
    + (state.badgesOff.size ? ' · <b>' + (BADGE_KEYS.length - state.badgesOff.size) + '</b> <span>etiquetas</span>' : '');
  const url = personalUrl();
  document.getElementById('manifestUrl').textContent = url;
  const deepLink = 'stremio://' + url.substring(url.indexOf('://') + 3);
  document.querySelectorAll('[data-install]').forEach(a => { a.href = deepLink; });
  save();
}

document.addEventListener('click', (ev) => {
  const pill = ev.target.closest('.pill[data-group]');
  if (pill) { state[pill.dataset.group] = pill.dataset.value; render(); return; }
  const bpreset = ev.target.closest('[data-badges-preset]');
  if (bpreset) {
    state.badgesOff = new Set(bpreset.dataset.badgesPreset === 'core'
      ? BADGE_KEYS.filter(k => !BADGE_CORE.includes(k))
      : []);
    render();
    return;
  }
  const preset = ev.target.closest('[data-preset]');
  if (preset) {
    state.hide = new Set(preset.dataset.preset === 'recommended' ? RECOMMENDED_HIDE : []);
    render();
    return;
  }
  const toggle = ev.target.closest('[data-toggle]');
  if (toggle) {
    const parts = toggle.dataset.toggle.split(':');
    const group = parts[0], mode = parts[1];
    const all = group === 'platforms' ? PLATFORMS.map(p => p.key) : STUDIOS.map(s => s.key);
    state[group] = mode === 'all' ? new Set(all) : new Set();
    render();
  }
});
document.addEventListener('change', (ev) => {
  const input = ev.target;
  if (!input.dataset || !input.dataset.group) return;
  const group = input.dataset.group, key = input.dataset.key;
  if (!(state[group] instanceof Set)) return;
  // "hide" guarda lo desmarcado; el resto de grupos, lo marcado.
  const add = (group === 'hide' || group === 'badges') ? !input.checked : input.checked;
  if (add) state[group].add(key); else state[group].delete(key);
  render();
});
document.getElementById('resetBtn').addEventListener('click', () => {
  state.lang = DEFAULT_LANG; state.region = DEFAULT_REGION;
  state.platforms = new Set(PLATFORMS.map(p => p.key));
  state.studios = new Set(STUDIOS.map(s => s.key));
  state.base = new Set(BASE);
  state.streams = new Set(STREAMS);
  state.hide = new Set(); state.sort = DEFAULT_SORT; state.maxSize = '0';
  render();
});

document.getElementById('debridProvider').addEventListener('change', (ev) => {
  state.debridSelection = validDebridProvider(ev.target.value) ? ev.target.value : 'torbox';
  render();
});

document.getElementById('connectDebrid').addEventListener('click', async () => {
  const button = document.getElementById('connectDebrid');
  const tokenInput = document.getElementById('debridToken');
  const provider = state.debridSelection;
  const token = tokenInput.value.trim();
  if (!token) { setText('debridStatus', 'Pega primero la clave API de ' + debridProviderName(provider) + '.'); tokenInput.focus(); return; }
  const previousId = state.debridId;
  button.disabled = true;
  setText('debridStatus', 'Validando la clave API de ' + debridProviderName(provider) + '…');
  try {
    const response = await fetch('/internal/debrid/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, token }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.credentialId) {
      // El servidor ya traduce cada fallo (clave inválida, proveedor caído,
      // bloqueo anti-bots, formato de la clave). Si además hay mensaje del
      // proveedor, se muestra: es texto público y apto para el usuario.
      const base = data.message || 'No se pudo conectar ' + debridProviderName(provider) + '.';
      throw new Error(base + (data.providerMessage ? ' (' + data.providerMessage + ')' : ''));
    }
    state.debridId = data.credentialId;
    state.debridProvider = data.provider || provider;
    state.debridSelection = state.debridProvider;
    // Se guarda en el estado (no solo en el texto): render() reescribe
    // debridStatus justo después, y avisos puestos a mano se perdían.
    state.debridWarning = data.warning === 'plan_inactive' ? 'plan_inactive' : null;
    tokenInput.value = '';
    render();
    if (previousId && previousId !== state.debridId) {
      fetch('/internal/debrid/connect', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId: previousId }),
      }).catch(() => {});
    }
  } catch (error) {
    tokenInput.value = '';
    const fallbackMessage = 'No se pudo conectar ' + debridProviderName(provider) + '.';
    // Los TypeError de red suelen traer un mensaje interno en inglés del
    // navegador; muestra el mensaje del servidor o un fallback localizable.
    const message = error && error.name === 'Error' && error.message ? error.message : fallbackMessage;
    setText('debridStatus', message);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('authorizeRealDebrid').addEventListener('click', () => {
  setText('debridStatus', 'Abriendo la autorización oficial de Real-Debrid…');
  window.location.assign('/internal/debrid/real-debrid/authorize');
});

document.getElementById('disconnectDebrid').addEventListener('click', async () => {
  const button = document.getElementById('disconnectDebrid');
  const credentialId = state.debridId;
  if (!credentialId) return;
  button.disabled = true;
  setText('debridStatus', 'Desconectando…');
  try {
    const response = await fetch('/internal/debrid/connect', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentialId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'No se pudo desconectar.');
    state.debridId = null;
    state.debridProvider = null;
    state.debridWarning = null;
    render();
  } catch (error) {
    const fallbackMessage = 'No se pudo desconectar.';
    const message = error && error.name === 'Error' && error.message ? error.message : fallbackMessage;
    setText('debridStatus', message);
  } finally {
    button.disabled = false;
  }
});

// Copiar la URL del manifest (con respaldo si no hay API de portapapeles).
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    area.remove();
    if (ok) resolve(); else reject(new Error('copy'));
  });
}
document.getElementById('copyBtn').addEventListener('click', () => {
  const label = document.getElementById('copyLabel');
  const btn = document.getElementById('copyBtn');
  const done = (text) => {
    label.textContent = text;
    btn.title = text;
    setTimeout(() => { label.textContent = 'Copiar URL'; btn.title = 'Copiar la URL del manifest'; }, 1800);
  };
  copyText(document.getElementById('manifestUrl').textContent).then(() => done('Copiada'), () => done('No se pudo copiar'));
});

// Buscador de los selectores de idioma y región.
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
}
document.querySelectorAll('[data-filter-for]').forEach(input => {
  const box = document.getElementById(input.dataset.filterFor);
  const empty = box.querySelector('.picker-empty');
  input.addEventListener('input', () => {
    const q = norm(input.value).trim();
    let shown = 0;
    box.querySelectorAll('.pill').forEach(p => {
      const hit = !q || norm(p.dataset.search).indexOf(q) !== -1;
      p.hidden = !hit;
      if (hit) shown++;
    });
    box.querySelectorAll('.picker-group').forEach(g => { g.hidden = !g.querySelector('.pill:not([hidden])'); });
    empty.hidden = shown > 0;
    box.scrollTop = 0;
  });
});
// Deja a la vista la opción elegida dentro de su caja con scroll.
function showSelected(boxId) {
  const box = document.getElementById(boxId);
  const pill = box.querySelector('.pill[aria-pressed="true"]');
  if (pill) box.scrollTop = Math.max(0, pill.offsetTop - 44);
}

// Índice lateral: resalta la sección que se está viendo.
const sideLinks = Array.from(document.querySelectorAll('.side a'));
const spied = sideLinks.map(a => document.getElementById(a.getAttribute('href').slice(1)));
let spyQueued = false;
function spy() {
  spyQueued = false;
  let current = 0;
  spied.forEach((section, i) => { if (section && section.getBoundingClientRect().top <= 150) current = i; });
  sideLinks.forEach((a, i) => { a.setAttribute('aria-current', String(i === current)); });
}
window.addEventListener('scroll', () => {
  if (spyQueued) return;
  spyQueued = true;
  requestAnimationFrame(spy);
}, { passive: true });

// Logos oficiales de estudios vía TMDB (opcional; fallback: monograma)
async function loadStudioLogos() {
  try {
    const res = await fetch('/internal/branding.json?lang=' + encodeURIComponent(state.lang));
    if (!res.ok) return;
    const data = await res.json();
    const studios = data.studios || {};
    document.querySelectorAll('img[data-logo-group="studios"]').forEach(img => {
      const hit = studios[img.dataset.logoFor];
      if (hit && hit.logo) {
        img.addEventListener('error', () => { img.style.display = 'none'; });
        img.src = hit.logo;
        img.style.display = 'block';
      }
    });
  } catch (e) { /* monogramas */ }
}

function applyOAuthReturn() {
  let url;
  try { url = new URL(window.location.href); } catch (e) { return ''; }
  const newId = url.searchParams.get('debrid_credential');
  if (validDebridId(newId)) {
    const previousId = state.debridId;
    state.debridId = newId;
    state.debridProvider = 'realdebrid';
    state.debridSelection = 'realdebrid';
    window.history.replaceState({}, '', url.pathname);
    if (previousId && previousId !== newId) {
      fetch('/internal/debrid/connect', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId: previousId }),
      }).catch(() => {});
    }
    return 'connected';
  }
  const error = url.searchParams.get('debrid_error');
  if (error) {
    window.history.replaceState({}, '', url.pathname);
    return error;
  }
  return '';
}

restore();
const oauthReturn = applyOAuthReturn();
render();
if (oauthReturn === 'connected') setText('debridStatus', 'Real-Debrid quedó conectado mediante OAuth. La integración solo usará los torrents descargados de tu biblioteca personal.');
if (oauthReturn && oauthReturn !== 'connected') {
  const oauthMessage = oauthReturn === 'oauth_denied'
    ? 'Cancelaste la autorización de Real-Debrid.'
    : oauthReturn === 'oauth_not_configured'
      ? 'Este despliegue no ha configurado las credenciales OAuth de Real-Debrid.'
      : oauthReturn === 'storage_not_configured'
        ? 'Este despliegue no tiene almacenamiento de credenciales cifrado configurado.'
        : 'No se pudo completar OAuth con Real-Debrid. Inténtalo de nuevo.';
  setText('debridStatus', oauthMessage);
}
showSelected('langGroup');
showSelected('regionGroup');
spy();
loadStudioLogos();
${RAILS_JS}
</script>
<script>${WEB_I18N_SCRIPT}</script>
</body>
</html>`;
}

module.exports = { renderConfigure };
