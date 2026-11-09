'use strict';

/**
 * /configure — Página de configuración estilo "streaming" (inspirada en
 * cinejoy.pk): hero cinematográfico con backdrop, explorador de plataformas
 * con logos (CDN público de TMDB, sin clave), estudios con monograma y
 * resumen en vivo. Genera el manifest personal /<base64url>/manifest.json.
 */

const { LANG_OPTIONS, REGION_OPTIONS, BASE_OPTIONS } = require('./userConfig');
const { PLATFORMS, STUDIOS, buildDefs } = require('./catalogs');
const { PROVIDERS: STREAM_PROVIDERS } = require('./streams');
const { STATIC_PROVIDER_LOGOS, STATIC_STUDIO_LOGOS, HERO_BACKDROP, HERO_BACKDROP_SMALL } = require('./staticLogos');
const { STATIC_TRENDING_MOVIES, STATIC_TRENDING_SERIES } = require('./posterData');
const { RAILS_CSS, RAILS_JS, posterRailHtml } = require('./rails');
const { THEME_CSS, MONO_STACK } = require('./theme');
const config = require('./config');

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pill(name, value, label, checked) {
  return `<button type="button" class="pill" data-group="${name}" data-value="${escapeHtml(value)}" aria-pressed="${checked}">${label}</button>`;
}

function providerTile(p) {
  const logo = STATIC_PROVIDER_LOGOS[p.key];
  const img = logo
    ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(p.name)}" loading="lazy" onerror="this.remove()" />`
    : '';
  return `
  <label class="provider-tile" data-key="${escapeHtml(p.key)}" title="${escapeHtml(p.name)}">
    <input type="checkbox" checked data-group="platforms" data-key="${escapeHtml(p.key)}" />
    <span class="tile-logo"><span class="letter">${escapeHtml(p.name.charAt(0).toUpperCase())}</span>${img}</span>
    <span class="tile-name">${escapeHtml(p.name)}</span>
    <span class="tile-check" aria-hidden="true">✓</span>
  </label>`;
}

function studioTile(s) {
  // Logo estático de TMDB (si lo hay) desde el primer render; el monograma
  // queda detrás y el <img> dinámico se rellena si branding tiene uno mejor.
  const logo = STATIC_STUDIO_LOGOS[s.company];
  const img = logo
    ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(s.name)}" loading="lazy" onerror="this.remove()" />`
    : '';
  return `
  <label class="studio-tile" data-key="${escapeHtml(s.key)}" title="${escapeHtml(s.name)}">
    <input type="checkbox" checked data-group="studios" data-key="${escapeHtml(s.key)}" />
    <span class="studio-logo"><span class="monogram">${escapeHtml(s.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase())}</span>${img}<img data-logo-for="${escapeHtml(s.key)}" data-logo-group="studios" alt="${escapeHtml(s.name)}" loading="lazy" style="display:none" /></span>
    <span class="tile-name">${escapeHtml(s.name)}</span>
    <span class="tile-check" aria-hidden="true">✓</span>
  </label>`;
}

function renderConfigure({ origin, host, trendingMovies, trendingSeries, initialCfg }) {
  const railMovies = trendingMovies && Array.isArray(trendingMovies.results) && trendingMovies.results.length
    ? trendingMovies.results.slice(0, 18).map((m) => ({ title: m.title || m.name || 'Sin título', year: String(m.release_date || m.first_air_date || '').slice(0, 4), rating: m.vote_average ? Number(m.vote_average).toFixed(1) : '', poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : '' }))
    : STATIC_TRENDING_MOVIES;
  const railSeries = trendingSeries && Array.isArray(trendingSeries.results) && trendingSeries.results.length
    ? trendingSeries.results.slice(0, 18).map((m) => ({ title: m.title || m.name || 'Sin título', year: String(m.release_date || m.first_air_date || '').slice(0, 4), rating: m.vote_average ? Number(m.vote_average).toFixed(1) : '', poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : '' }))
    : STATIC_TRENDING_SERIES;
  const langPills = LANG_OPTIONS.map((o, i) => pill('lang', o.code, escapeHtml(o.label), i === 0)).join('\n');
  const regionPills = REGION_OPTIONS.map((o) =>
    pill('region', o.code, `${o.flag} ${escapeHtml(o.label)}`, o.code === (config.watchRegion || 'NI'))
  ).join('\n');
  const baseChips = BASE_OPTIONS.map((o) =>
    `<label class="chip"><input type="checkbox" checked data-group="base" data-key="${escapeHtml(o.key)}" /><span>${escapeHtml(o.label)}</span></label>`
  ).join('\n');
  const streamChips = STREAM_PROVIDERS.map((p) =>
    `<label class="chip"><input type="checkbox" checked data-group="streams" data-key="${escapeHtml(p.key)}" /><span>🧲 ${escapeHtml(p.name)}</span></label>`
  ).join('\n');
  const providerTiles = PLATFORMS.map(providerTile).join('\n');
  const studioTiles = STUDIOS.map(studioTile).join('\n');
  const catalogCount = buildDefs(null).length;
  const stremioFast = `stremio://${host}/manifest.json`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Catálogos+ · Configura tu addon de Stremio</title>
<meta name="description" content="Películas y series de catálogo para Stremio: tendencias, estrenos, por plataforma y por estudio. Configura idioma, región, plataformas y estudios." />
<link rel="icon" href="/assets/logo.png" type="image/png" />
<style>
${THEME_CSS}
${RAILS_CSS}

  /* ── Hero de /configure ────────────────────────────────────────────────── */
  .hero { padding: clamp(58px, 9vw, 104px) clamp(18px, 4vw, 40px) 34px; }
  .hero-bg { background-image: url('${HERO_BACKDROP}'); }
  @media (max-width: 760px) { .hero-bg { background-image: url('${HERO_BACKDROP_SMALL}'); } }
  .hero-veil {
    background:
      radial-gradient(760px 380px at 18% 8%, rgba(124,92,255,.26), transparent 70%),
      linear-gradient(90deg, rgba(7,8,13,.94) 0%, rgba(7,8,13,.7) 46%, rgba(7,8,13,.15) 76%),
      linear-gradient(180deg, rgba(7,8,13,.5) 0%, var(--bg) 98%);
  }
  .hero-content { max-width: 780px; display: flex; flex-direction: column; align-items: flex-start; gap: 16px; }
  .hero h1 { margin: 0; }
  .hero-ctas { display: flex; gap: 12px; flex-wrap: wrap; }

  main { max-width: 1220px; margin: 0 auto; padding: 6px clamp(16px, 4vw, 32px) 170px; }

  /* ── Idioma y región ───────────────────────────────────────────────────── */
  .duo { display: grid; grid-template-columns: 1fr 1.5fr; gap: 16px; }
  @media (max-width: 880px) { .duo { grid-template-columns: 1fr; } }

  /* ── Rejilla de plataformas ────────────────────────────────────────────── */
  .toggles { display: flex; gap: 8px; margin: 0 0 14px; flex-wrap: wrap; }
  .mini {
    background: var(--surface); border: 1px solid var(--line); color: var(--muted);
    border-radius: var(--r-pill); padding: 7px 14px; font-size: .78rem; font-weight: 550; cursor: pointer;
    transition: color .16s, border-color .16s, background .16s, transform .16s var(--ease);
  }
  .mini:hover { color: #fff; border-color: var(--line-strong); background: var(--surface-2); transform: translateY(-1px); }

  .tile-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
    gap: 12px;
  }
  .provider-tile {
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    padding: 14px 8px 11px; border-radius: var(--r-lg);
    background: var(--surface); border: 1px solid var(--line);
    transition: border-color .18s, background .18s, transform .18s var(--ease), box-shadow .18s;
  }
  .provider-tile:hover { transform: translateY(-3px); border-color: var(--line-strong); background: var(--surface-2); }
  .provider-tile:has(input:checked) {
    border-color: rgba(124,92,255,.55); background: rgba(124,92,255,.09);
    box-shadow: 0 0 0 1px rgba(124,92,255,.2), 0 12px 26px rgba(0,0,0,.34);
  }
  .tile-logo {
    position: relative; width: 74px; height: 74px; border-radius: 20px;
    background: #fff; display: flex; align-items: center; justify-content: center; overflow: hidden;
    box-shadow: var(--shadow-sm), inset 0 0 0 1px rgba(0,0,0,.06);
    transition: transform .2s var(--ease), box-shadow .2s;
  }
  .provider-tile:hover .tile-logo { box-shadow: 0 12px 26px rgba(0,0,0,.5); }
  .tile-logo .letter { font-size: 1.7rem; font-weight: 800; color: #c3c8d4; }
  .tile-logo img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; padding: 13px; background: #fff; }

  /* ── Estudios ──────────────────────────────────────────────────────────── */
  .studio-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(148px, 1fr)); gap: 12px; }
  .studio-tile {
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    padding: 16px 10px 13px; border-radius: var(--r-lg);
    background: linear-gradient(165deg, rgba(255,255,255,.055), rgba(255,255,255,.02));
    border: 1px solid var(--line);
    transition: border-color .18s, transform .18s var(--ease), box-shadow .18s, background .18s;
  }
  .studio-tile:hover { transform: translateY(-3px); border-color: var(--line-strong); box-shadow: var(--shadow-sm); }
  .studio-tile:has(input:checked) {
    border-color: rgba(124,92,255,.5); background: rgba(124,92,255,.08);
    box-shadow: 0 0 0 1px rgba(124,92,255,.18), 0 12px 26px rgba(0,0,0,.32);
  }
  .studio-logo {
    position: relative; width: 78px; height: 78px; border-radius: 20px; overflow: hidden;
    background: #fff; display: flex; align-items: center; justify-content: center;
    box-shadow: var(--shadow-sm), inset 0 0 0 1px rgba(0,0,0,.06);
  }
  .monogram { font-size: 1.5rem; font-weight: 800; letter-spacing: .02em; color: #1a1d29; }
  .studio-logo img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #fff; padding: 10px; }

  /* ── Barra inferior fija ───────────────────────────────────────────────── */
  .footer {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 35;
    padding: 12px clamp(14px, 4vw, 28px) calc(12px + env(safe-area-inset-bottom, 0px));
    background: rgba(8,9,15,.82); border-top: 1px solid var(--line);
    backdrop-filter: blur(20px) saturate(1.6); -webkit-backdrop-filter: blur(20px) saturate(1.6);
    box-shadow: 0 -18px 40px rgba(0,0,0,.5);
  }
  .footer-inner { max-width: 1220px; margin: 0 auto; display: flex; align-items: center; gap: 16px; justify-content: space-between; flex-wrap: wrap; }
  .count { color: var(--muted); font-size: .84rem; }
  .count b { color: #fff; font-weight: 750; font-variant-numeric: tabular-nums; }
  .footer-actions { display: flex; gap: 9px; align-items: center; flex-wrap: wrap; }
  .url-line { max-width: 1220px; margin: 10px auto 0; }
  .url-line code {
    display: block; font-family: ${MONO_STACK}; font-size: .72rem; color: #9fe8ff;
    background: rgba(6,7,12,.8); border: 1px solid var(--line); border-radius: var(--r-sm);
    padding: 8px 11px; word-break: break-all;
  }
  @media (max-width: 820px) { .url-line { display: none; } .count { display: none; } .footer-actions { width: 100%; justify-content: space-between; } }
</style>
</head>
<body>

<div class="page-glow" aria-hidden="true"></div>
<div class="page-grid" aria-hidden="true"></div>

<nav class="nav">
  <a class="brand" href="/"><img src="/assets/logo.png" alt="Catálogos+" /><span>Catálogos<i>+</i></span></a>
  <div class="nav-links"><a href="#plataformas">Plataformas</a><a href="#estudios">Estudios</a><a href="#instalacion">Instalar</a></div>
</nav>

<header class="hero">
  <div class="hero-bg"></div>
  <div class="hero-veil"></div>
  <div class="hero-content">
    <span class="badge"><span class="dot"></span> Addon para Stremio</span>
    <h1>Todo el cine y las series, <em>a tu gusto.</em></h1>
    <p>Tendencias, estrenos en cines, top valoradas, anime y catálogos por plataforma (Netflix, Disney+, Max, Hulu, AMC+…) y por estudio (Marvel, Pixar, Ghibli…). En español, con tu región y tus gustos.</p>
    <div class="hero-ctas">
      <a class="btn btn-primary" id="installBtn" href="${escapeHtml(stremioFast)}">↧ Instalar en Stremio</a>
      <a class="btn btn-ghost" href="#plataformas">Explorar catálogos</a>
    </div>
    <div class="stats">
      <span class="stat"><b>${catalogCount}</b> catálogos</span>
      <span class="stat"><b>${PLATFORMS.length}</b> plataformas</span>
      <span class="stat"><b>${STUDIOS.length}</b> estudios</span>
      <span class="stat"><b>${REGION_OPTIONS.length}</b> regiones</span>
    </div>
  </div>
</header>

<main>
  <!-- 01 · Idioma y región -->
  <div class="section-head" id="idioma"><span class="section-num">01</span><div><h2>Idioma y región</h2><small>Idioma de fichas y sinopsis · región JustWatch para los catálogos de plataformas</small></div></div>
  <div class="duo">
    <div class="panel">
      <h3>🌐 Idioma de los catálogos</h3>
      <div class="pills" id="langGroup">${langPills}</div>
    </div>
    <div class="panel">
      <h3>🌎 Región de plataformas</h3>
      <div class="pills" id="regionGroup">${regionPills}</div>
      <p class="hint">Si tu región no tiene catálogo JustWatch (típico en NI), el addon usa <strong>MX/US como respaldo automático</strong>. Recomendado: MX o US.</p>
    </div>
  </div>

  <!-- 02 · Plataformas -->
  <div class="section-head" id="plataformas"><span class="section-num">02</span><div><h2>Explorar por plataforma</h2><small>Marca las que quieres tener en Stremio · cada una genera fila de películas y de series</small></div></div>
  <div class="toggles"><button class="mini" data-toggle="platforms:all" type="button">Marcar todas</button><button class="mini" data-toggle="platforms:none" type="button">Desmarcar todas</button></div>
  <div class="tile-grid" id="platformGrid">${providerTiles}</div>

  <!-- 03 · Estudios -->
  <div class="section-head" id="estudios"><span class="section-num">03</span><div><h2>Elegir por estudio</h2><small>Películas y series de cada productora · logo oficial de TMDB cuando está disponible</small></div></div>
  <div class="toggles"><button class="mini" data-toggle="studios:all" type="button">Marcar todos</button><button class="mini" data-toggle="studios:none" type="button">Desmarcar todos</button></div>
  <div class="studio-grid" id="studioGrid">${studioTiles}</div>

  <!-- 04 · Catálogos base -->
  <div class="section-head" id="instalacion"><span class="section-num">04</span><div><h2>Catálogos base</h2><small>Las colecciones generales: tendencias, estrenos, anime…</small></div></div>
  <div class="chips" id="baseGroup">${baseChips}</div>

  <!-- 05 · Proveedores de contenido (streams) -->
  <div class="section-head" id="streams"><span class="section-num">05</span><div><h2>Proveedores de contenido</h2><small>Fuentes torrent (magnet) al abrir una película o episodio — sin clave, búsqueda en paralelo y resultados ordenados por seeders</small></div></div>
  <div class="chips" id="streamGroup">${streamChips}</div>
  <p class="hint" style="margin-top:10px">Knaben, Torlock y BlackHoleBay son indexadores públicos. Desmarca los que no quieras consultar; si desmarcas todos, el addon no devolverá streams.</p>

  ${posterRailHtml({ title: 'Tendencias', accent: 'películas esta semana', items: railMovies, href: '#plataformas', cta: 'Elegir catálogos ↑' })}
  ${posterRailHtml({ title: 'Tendencias', accent: 'series esta semana', items: railSeries, href: '#plataformas', cta: 'Elegir catálogos ↑' })}

  <p class="hint" style="margin-top:26px">Al instalar se genera una URL personal con tu selección. Si ya tenías el addon instalado, reinstala desde esta página para aplicar los cambios — Stremio cachea los catálogos.</p>
</main>

<div class="footer">
  <div class="footer-inner">
    <div class="count" id="countLine">Calculando…</div>
    <div class="footer-actions">
      <button class="btn btn-ghost btn-sm" id="resetBtn" type="button">↺ Restablecer</button>
      <button class="btn btn-ghost btn-sm" id="copyBtn" type="button">Copiar URL</button>
      <a class="btn btn-primary" id="installBtnFooter" href="${escapeHtml(stremioFast)}">↧ Instalar en Stremio</a>
    </div>
  </div>
  <div class="url-line"><code id="manifestUrl"></code></div>
</div>

<footer class="page-footer">
  Catálogos+ · Datos cortesía de <a href="https://www.themoviedb.org/" style="color:#c9cddf">TMDB</a>, JustWatch, TVMaze (sin clave), TheTVDB y OMDB. Este producto usa la API de TMDB pero no está respaldado ni certificado por TMDB. Logos de plataformas/estudios son propiedad de sus respectivos dueños. Watchmode para disponibilidad en streaming.
</footer>

<script>
const PLATFORMS = ${JSON.stringify(PLATFORMS.map(p => ({ key: p.key, name: p.name })))};
const STUDIOS = ${JSON.stringify(STUDIOS.map(s => ({ key: s.key, name: s.name })))};
const BASE = ${JSON.stringify(BASE_OPTIONS.map(o => o.key))};
const STREAMS = ${JSON.stringify(STREAM_PROVIDERS.map(p => p.key))};
const INITIAL = ${JSON.stringify(initialCfg ? { lang: initialCfg.lang, region: initialCfg.region, platforms: initialCfg.platforms ?? null, studios: initialCfg.studios ?? null, base: initialCfg.base ?? null, streams: initialCfg.streams ?? null } : null)};
const DEFAULT_REGION = ${JSON.stringify(config.watchRegion || 'NI')};
const STORAGE_KEY = 'catalogos-plus-config-v1';
const HERO_LABELS = { base: 0, platforms: 0, studios: 0 };

const state = {
  lang: 'es',
  region: DEFAULT_REGION,
  platforms: new Set(PLATFORMS.map(p => p.key)),
  studios: new Set(STUDIOS.map(s => s.key)),
  base: new Set(BASE),
  streams: new Set(STREAMS),
};

function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ lang: state.lang, region: state.region, platforms: [...state.platforms], studios: [...state.studios], base: [...state.base], streams: [...state.streams] })); } catch (e) {} }
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
    return;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved) return;
    if (saved.lang) state.lang = saved.lang;
    if (saved.region) state.region = saved.region;
    if (Array.isArray(saved.platforms)) state.platforms = new Set(saved.platforms.filter(k => PLATFORMS.some(p => p.key === k)));
    if (Array.isArray(saved.studios)) state.studios = new Set(saved.studios.filter(k => STUDIOS.some(s => s.key === k)));
    if (Array.isArray(saved.base)) state.base = new Set(saved.base);
    if (Array.isArray(saved.streams)) state.streams = new Set(saved.streams.filter(k => STREAMS.includes(k)));
  } catch (e) {}
}

function b64url(obj) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
    .split('+').join('-').split('/').join('_').split('=').join('');
}
function personalUrl() {
  const allSelected = state.platforms.size === PLATFORMS.length && state.studios.size === STUDIOS.length && state.base.size === BASE.length && state.streams.size === STREAMS.length && state.lang === 'es' && state.region === DEFAULT_REGION;
  if (allSelected) return window.location.origin + '/manifest.json';
  const slim = { lang: state.lang, region: state.region, platforms: [...state.platforms], studios: [...state.studios], base: [...state.base], streams: [...state.streams] };
  return window.location.origin + '/' + b64url(slim) + '/manifest.json';
}
function render() {
  document.querySelectorAll('.pill').forEach(p => {
    p.setAttribute('aria-pressed', String(state[p.dataset.group] === p.dataset.value));
  });
  document.querySelectorAll('input[data-group="platforms"]').forEach(i => { i.checked = state.platforms.has(i.dataset.key); });
  document.querySelectorAll('input[data-group="studios"]').forEach(i => { i.checked = state.studios.has(i.dataset.key); });
  document.querySelectorAll('input[data-group="base"]').forEach(i => { i.checked = state.base.has(i.dataset.key); });
  document.querySelectorAll('input[data-group="streams"]').forEach(i => { i.checked = state.streams.has(i.dataset.key); });
  const BASE_WEIGHT = { tendencias: 2, populares: 2, top: 2, tvmaze_hoy: 1, estrenos: 1, proximos: 1, en_emision: 1, anime: 2, generos_series: 7 };
  const baseCount = [...state.base].reduce((n, k) => n + (BASE_WEIGHT[k] || 0), 0);
  const total = baseCount + state.platforms.size * 2 + state.studios.size;
  document.getElementById('countLine').innerHTML =
    '<b>' + total + '</b> catálogos · <b>' + state.platforms.size + '</b> plataformas · <b>' + state.studios.size + '</b> estudios · <b>' + state.streams.size + '</b> proveedores · región <b>' + state.region + '</b>';
  const url = personalUrl();
  document.getElementById('manifestUrl').textContent = url;
  const deepLink = 'stremio://' + url.substring(url.indexOf('://') + 3);
  document.getElementById('installBtn').href = deepLink;
  document.getElementById('installBtnFooter').href = deepLink;
  save();
}

document.addEventListener('click', (ev) => {
  const pill = ev.target.closest('.pill');
  if (pill) { state[pill.dataset.group] = pill.dataset.value; render(); return; }
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
  if (!state[group]) return;
  if (input.checked) state[group].add(key); else state[group].delete(key);
  render();
});
document.getElementById('resetBtn').addEventListener('click', () => {
  state.lang = 'es'; state.region = DEFAULT_REGION;
  state.platforms = new Set(PLATFORMS.map(p => p.key));
  state.studios = new Set(STUDIOS.map(s => s.key));
  state.base = new Set(BASE);
  state.streams = new Set(STREAMS);
  render();
});
document.getElementById('copyBtn').addEventListener('click', async () => {
  const url = document.getElementById('manifestUrl').textContent;
  try { await navigator.clipboard.writeText(url); document.getElementById('copyBtn').textContent = '✅ Copiada'; }
  catch (e) { document.getElementById('copyBtn').textContent = 'Copiar URL'; }
  setTimeout(() => { document.getElementById('copyBtn').textContent = 'Copiar URL'; }, 1800);
});

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

restore();
render();
loadStudioLogos();
${RAILS_JS}
</script>
</body>
</html>`;
}

module.exports = { renderConfigure };
