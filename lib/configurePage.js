'use strict';

/**
 * /configure — Página de configuración estilo "streaming" (inspirada en
 * cinejoy.pk): hero cinematográfico con backdrop, explorador de plataformas
 * con logos (CDN público de TMDB, sin clave), estudios con monograma y
 * resumen en vivo. Genera el manifest personal /<base64url>/manifest.json.
 */

const { LANG_OPTIONS, REGION_OPTIONS, BASE_OPTIONS } = require('./userConfig');
const { PLATFORMS, STUDIOS } = require('./catalogs');
const { STATIC_PROVIDER_LOGOS, HERO_BACKDROP, HERO_BACKDROP_SMALL } = require('./staticLogos');
const { STATIC_TRENDING_MOVIES, STATIC_TRENDING_SERIES } = require('./posterData');
const { RAILS_CSS, posterRailHtml } = require('./rails');
const config = require('./config');

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pill(name, value, label, checked) {
  return `<button type="button" class="pill" data-group="${name}" data-value="${escapeHtml(value)}" aria-pressed="${checked}">${label}</button>`;
}

function providerTile(p) {
  const logo = STATIC_PROVIDER_LOGOS[p.key];
  const img = logo ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(p.name)}" loading="lazy" onerror="this.remove()" />` : '';
  return `
  <label class="provider-tile" data-key="${escapeHtml(p.key)}" title="${escapeHtml(p.name)}">
    <input type="checkbox" checked data-group="platforms" data-key="${escapeHtml(p.key)}" />
    <span class="tile-logo"><span class="letter">${escapeHtml(p.name.charAt(0).toUpperCase())}</span>${img}</span>
    <span class="tile-name">${escapeHtml(p.name)}</span>
    <span class="tile-check">✓</span>
  </label>`;
}

function studioTile(s) {
  return `
  <label class="studio-tile" data-key="${escapeHtml(s.key)}" title="${escapeHtml(s.name)}">
    <input type="checkbox" checked data-group="studios" data-key="${escapeHtml(s.key)}" />
    <span class="studio-logo"><span class="monogram">${escapeHtml(s.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase())}</span><img data-logo-for="${escapeHtml(s.key)}" data-logo-group="studios" alt="${escapeHtml(s.name)}" loading="lazy" style="display:none" /></span>
    <span class="tile-name">${escapeHtml(s.name)}</span>
    <span class="tile-check">✓</span>
  </label>`;
}

function renderConfigure({ origin, host, trendingMovies, trendingSeries }) {
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
  const providerTiles = PLATFORMS.map(providerTile).join('\n');
  const studioTiles = STUDIOS.map(studioTile).join('\n');
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
  :root {
    --bg:#0d0f17; --panel:#151824; --panel-2:#1b1f2e; --line:#262b3f; --line-2:#333a55;
    --text:#f5f6fa; --muted:#9aa0b8; --gold:#f5c518; --gold-2:#ffd94a; --gold-dim:#8a7322;
    --red:#e50914; --green:#22c55e;
  }
  * { box-sizing:border-box; margin:0; padding:0; }
  html { scroll-behavior:smooth; }
  body { font-family:'Segoe UI',system-ui,-apple-system,sans-serif; background:var(--bg); color:var(--text); }
  img { user-select:none; }
  button { font-family:inherit; }

  /* ── Nav ─────────────────────────────────────────── */
  .nav { position:fixed; top:0; left:0; right:0; z-index:30; display:flex; align-items:center; justify-content:space-between; padding:14px 28px; background:linear-gradient(180deg, rgba(13,15,23,.92), rgba(13,15,23,0)); }
  .nav-brand { display:flex; align-items:center; gap:12px; text-decoration:none; }
  .nav-brand img { width:40px; height:40px; border-radius:10px; }
  .nav-brand b { font-size:1.15rem; letter-spacing:.02em; color:#fff; }
  .nav-brand b i { color:var(--gold); font-style:normal; }
  .nav-links { display:flex; gap:22px; }
  .nav-links a { color:#cfd3e6; text-decoration:none; font-size:.9rem; }
  .nav-links a:hover { color:#fff; }
  @media (max-width:640px){ .nav-links { display:none; } .nav { padding:12px 16px; } }

  /* ── Hero ─────────────────────────────────────────── */
  .hero { position:relative; min-height:78vh; display:flex; align-items:flex-end; overflow:hidden; }
  .hero-bg { position:absolute; inset:0; background-image:url('${HERO_BACKDROP}'); background-size:cover; background-position:center 18%; transform:scale(1.02); }
  @media (max-width:760px){ .hero-bg { background-image:url('${HERO_BACKDROP_SMALL}'); } }
  .hero::after { content:''; position:absolute; inset:0; background:linear-gradient(90deg, rgba(13,15,23,.96) 0%, rgba(13,15,23,.72) 38%, rgba(13,15,23,.05) 70%), linear-gradient(0deg, var(--bg) 2%, rgba(13,15,23,.25) 45%, rgba(13,15,23,.55) 100%); }
  .hero-content { position:relative; z-index:2; padding:0 28px 56px; max-width:720px; }
  .badge { display:inline-flex; align-items:center; gap:8px; background:rgba(0,0,0,.55); border:1px solid rgba(245,197,24,.5); color:var(--gold); font-size:.72rem; letter-spacing:.16em; text-transform:uppercase; padding:6px 12px; border-radius:6px; backdrop-filter:blur(4px); }
  .hero h1 { font-family:Georgia,'Times New Roman',serif; font-weight:700; font-size:clamp(2.4rem,6vw,4rem); line-height:1.02; margin:18px 0 14px; color:#fff; text-shadow:0 4px 30px rgba(0,0,0,.6); }
  .hero h1 em { font-style:italic; color:var(--gold); }
  .hero p { color:#d8dbea; font-size:1.02rem; max-width:54ch; line-height:1.5; }
  .hero-ctas { display:flex; gap:12px; margin:24px 0 18px; flex-wrap:wrap; }
  .btn { display:inline-flex; align-items:center; gap:10px; border:0; cursor:pointer; border-radius:8px; font-weight:800; font-size:.95rem; padding:13px 22px; text-decoration:none; letter-spacing:.02em; }
  .btn-gold { background:var(--gold); color:#141414; }
  .btn-gold:hover { background:var(--gold-2); }
  .btn-ghost { background:rgba(255,255,255,.14); color:#fff; backdrop-filter:blur(4px); }
  .btn-ghost:hover { background:rgba(255,255,255,.22); }
  .stats { display:flex; gap:10px; flex-wrap:wrap; }
  .stat { display:flex; align-items:baseline; gap:6px; background:rgba(0,0,0,.45); border:1px solid rgba(255,255,255,.12); padding:6px 12px; border-radius:8px; font-size:.8rem; color:#c9cddf; }
  .stat b { color:var(--gold); font-size:1rem; }

  /* ── Secciones ─────────────────────────────────────── */
  main { max-width:1180px; margin:0 auto; padding:34px 24px 150px; }
  .section-head { display:flex; align-items:baseline; gap:14px; margin:34px 0 14px; }
  .section-num { font-family:Georgia,serif; color:var(--gold); font-size:.95rem; border:1px solid var(--gold-dim); border-radius:6px; padding:3px 8px; }
  .section-head h2 { font-size:1.28rem; letter-spacing:.01em; }
  .section-head small { color:var(--muted); display:block; font-size:.82rem; margin-top:2px; }

  /* Idioma y región */
  .duo { display:grid; grid-template-columns:1fr 1.6fr; gap:18px; }
  @media (max-width:860px){ .duo { grid-template-columns:1fr; } }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:16px 18px; }
  .panel h3 { font-size:.74rem; text-transform:uppercase; letter-spacing:.14em; color:var(--muted); margin-bottom:10px; }
  .pills { display:flex; gap:8px; flex-wrap:wrap; }
  .pill { background:var(--panel-2); border:1px solid var(--line); color:#dfe2ef; padding:7px 13px; border-radius:999px; cursor:pointer; font-size:.84rem; transition:all .15s; }
  .pill:hover { border-color:var(--line-2); }
  .pill[aria-pressed="true"] { background:var(--gold); border-color:var(--gold); color:#141414; font-weight:700; box-shadow:0 3px 14px rgba(245,197,24,.35); }
  .hint { color:var(--muted); font-size:.76rem; margin-top:8px; line-height:1.45; }

  /* Explorador de plataformas (carrusel horizontal) */
  .provider-scroll { display:flex; gap:12px; overflow-x:auto; padding:6px 2px 16px; scroll-snap-type:x mandatory; }
  .provider-scroll::-webkit-scrollbar { height:8px; }
  .provider-scroll::-webkit-scrollbar-thumb { background:var(--line-2); border-radius:99px; }
  .provider-tile { position:relative; scroll-snap-align:start; flex:0 0 118px; display:flex; flex-direction:column; align-items:center; gap:10px; background:transparent; border:0; cursor:pointer; padding:4px 2px; border-radius:12px; }
  .provider-tile input { position:absolute; opacity:0; pointer-events:none; }
  .tile-logo { position:relative; width:104px; height:104px; border-radius:18px; background:#fff; display:flex; align-items:center; justify-content:center; overflow:hidden; box-shadow:0 6px 18px rgba(0,0,0,.5); transition:transform .15s, box-shadow .15s; }
  .tile-logo .letter { font-size:2rem; font-weight:900; color:#c8c8c8; }
  .tile-logo img { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; background:#fff; padding:12px; box-sizing:border-box; }
  .provider-tile:hover .tile-logo { transform:translateY(-3px); }
  .tile-name { font-size:.74rem; color:#cfd3e6; text-align:center; line-height:1.25; min-height:2.4em; }
  .tile-check { position:absolute; top:-6px; right:2px; width:24px; height:24px; border-radius:999px; background:var(--gold); color:#141414; font-weight:900; font-size:.8rem; display:none; align-items:center; justify-content:center; box-shadow:0 2px 6px rgba(0,0,0,.5); }
  .provider-tile input:checked ~ .tile-check { display:flex; }
  .provider-tile:has(input:checked) .tile-logo { box-shadow:0 0 0 3px var(--gold), 0 8px 22px rgba(245,197,24,.28); }
  .provider-tile:has(input:checked) .tile-name { color:#fff; }
  .toggles { display:flex; gap:8px; margin:2px 0 10px; }
  .mini { background:var(--panel-2); border:1px solid var(--line); color:var(--muted); border-radius:8px; padding:5px 12px; font-size:.74rem; cursor:pointer; }
  .mini:hover { color:#fff; border-color:var(--line-2); }

  /* Estudios */
  .studio-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:12px; }
  .studio-tile { position:relative; display:flex; flex-direction:column; align-items:center; gap:10px; background:linear-gradient(160deg, var(--panel-2), var(--panel)); border:1px solid var(--line); border-radius:14px; padding:18px 10px 14px; cursor:pointer; transition:all .15s; }
  .studio-tile input { position:absolute; opacity:0; pointer-events:none; }
  .studio-logo { width:84px; height:84px; border-radius:16px; background:#20263a; border:1px solid var(--line-2); display:flex; align-items:center; justify-content:center; overflow:hidden; position:relative; }
  .monogram { font-family:Georgia,serif; font-size:1.7rem; font-weight:700; color:var(--gold); letter-spacing:.04em; }
  .studio-logo img { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; background:#fff; padding:8px; }
  .studio-tile:hover { border-color:var(--line-2); transform:translateY(-2px); }
  .studio-tile:has(input:checked) { border-color:var(--gold); box-shadow:0 0 0 1px var(--gold), 0 6px 18px rgba(245,197,24,.18); }
  .studio-tile input:checked ~ .tile-check { display:flex; }

  /* Catálogos base (chips) */
  .chips { display:flex; gap:10px; flex-wrap:wrap; }
  .chip { display:flex; align-items:center; gap:8px; background:var(--panel-2); border:1px solid var(--line); padding:10px 15px; border-radius:10px; cursor:pointer; font-size:.88rem; }
  .chip input { accent-color:var(--gold); width:16px; height:16px; }

  /* ── Barra sticky de instalación ───────────────────── */
  .footer { position:fixed; left:0; right:0; bottom:0; z-index:25; background:rgba(13,15,23,.94); backdrop-filter:blur(12px); border-top:1px solid var(--line); padding:12px 22px; }
  .footer-inner { max-width:1180px; margin:0 auto; display:flex; align-items:center; gap:16px; justify-content:space-between; flex-wrap:wrap; }
  .count { color:var(--muted); font-size:.82rem; } .count b { color:var(--gold); font-size:1rem; }
  .footer-actions { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  .url-line { max-width:1180px; margin:8px auto 0; }
  .url-line code { display:block; font-size:.72rem; color:#9be3ff; background:#0a0c12; border:1px solid var(--line); border-radius:8px; padding:7px 10px; word-break:break-all; }
  @media (max-width:760px){ .url-line { display:none; } }

  /* ── Footer página ─────────────────────────────────── */
  .page-footer { border-top:1px solid var(--line); padding:22px 28px; color:var(--muted); font-size:.74rem; line-height:1.6; max-width:1180px; margin:0 auto; }
${RAILS_CSS}
</style>
</head>
<body>

<nav class="nav">
  <a class="nav-brand" href="/"><img src="/assets/logo.png" alt="Catálogos+" /><b>Catá<i>logos+</i></b></a>
  <div class="nav-links"><a href="#plataformas">Plataformas</a><a href="#estudios">Estudios</a><a href="#instalacion">Instalar</a></div>
</nav>

<header class="hero">
  <div class="hero-bg"></div>
  <div class="hero-content">
    <span class="badge">★ Addon para Stremio</span>
    <h1>Todo el cine y las series, <em>a tu gusto.</em></h1>
    <p>Tendencias, estrenos en cines, top valoradas, anime y catálogos por plataforma (Netflix, Disney+, Max, Hulu, AMC+…) y por estudio (Marvel, Pixar, Ghibli…). En español, con tu región y tus gustos.</p>
    <div class="hero-ctas">
      <a class="btn btn-gold" id="installBtn" href="${escapeHtml(stremioFast)}">🚀 Instalar en Stremio</a>
      <a class="btn btn-ghost" href="#plataformas">Explorar catálogos</a>
    </div>
    <div class="stats">
      <span class="stat"><b>53</b> catálogos</span>
      <span class="stat"><b>16</b> plataformas</span>
      <span class="stat"><b>9</b> estudios</span>
      <span class="stat"><b>16</b> regiones</span>
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
  <div class="section-head" id="plataformas"><span class="section-num">02</span><div><h2>Explorar por plataforma</h2><small>Marca las que quieres tener en Stremio — películas y series en cada una</small></div></div>
  <div class="toggles"><button class="mini" data-toggle="platforms:all" type="button">Marcar todas</button><button class="mini" data-toggle="platforms:none" type="button">Desmarcar todas</button></div>
  <div class="provider-scroll" id="platformGrid">${providerTiles}</div>

  <!-- 03 · Estudios -->
  <div class="section-head" id="estudios"><span class="section-num">03</span><div><h2>Elegir por estudio</h2><small>Películas de cada productora — logo oficial si está disponible en TMDB</small></div></div>
  <div class="toggles"><button class="mini" data-toggle="studios:all" type="button">Marcar todos</button><button class="mini" data-toggle="studios:none" type="button">Desmarcar todos</button></div>
  <div class="studio-grid" id="studioGrid">${studioTiles}</div>

  <!-- 04 · Catálogos base -->
  <div class="section-head" id="instalacion"><span class="section-num">04</span><div><h2>Catálogos base</h2><small>Las colecciones generales: tendencias, estrenos, anime…</small></div></div>
  <div class="chips" id="baseGroup">${baseChips}</div>

  ${posterRailHtml({ title: 'Tendencias', accent: 'películas esta semana', items: railMovies, href: '#plataformas', cta: 'Elegir catálogos ↑' })}
  ${posterRailHtml({ title: 'Tendencias', accent: 'series esta semana', items: railSeries, href: '#plataformas', cta: 'Elegir catálogos ↑' })}

  <p class="hint" style="margin-top:26px">Al instalar se genera una URL personal con tu selección. Si ya tenías el addon instalado, reinstala desde esta página para aplicar los cambios — Stremio cachea los catálogos.</p>
</main>

<div class="footer">
  <div class="footer-inner">
    <div class="count" id="countLine">Calculando…</div>
    <div class="footer-actions">
      <button class="btn btn-ghost" id="resetBtn" type="button" style="padding:12px 16px; font-size:.82rem">↺ Restablecer</button>
      <button class="btn btn-ghost" id="copyBtn" type="button" style="padding:12px 16px; font-size:.82rem">📋 Copiar URL</button>
      <a class="btn btn-gold" id="installBtnFooter" href="${escapeHtml(stremioFast)}">🚀 Instalar en Stremio</a>
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
const DEFAULT_REGION = ${JSON.stringify(config.watchRegion || 'NI')};
const STORAGE_KEY = 'catalogos-plus-config-v1';
const HERO_LABELS = { base: 0, platforms: 0, studios: 0 };

const state = {
  lang: 'es',
  region: DEFAULT_REGION,
  platforms: new Set(PLATFORMS.map(p => p.key)),
  studios: new Set(STUDIOS.map(s => s.key)),
  base: new Set(BASE),
};

function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ lang: state.lang, region: state.region, platforms: [...state.platforms], studios: [...state.studios], base: [...state.base] })); } catch (e) {} }
function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved) return;
    if (saved.lang) state.lang = saved.lang;
    if (saved.region) state.region = saved.region;
    if (Array.isArray(saved.platforms)) state.platforms = new Set(saved.platforms.filter(k => PLATFORMS.some(p => p.key === k)));
    if (Array.isArray(saved.studios)) state.studios = new Set(saved.studios.filter(k => STUDIOS.some(s => s.key === k)));
    if (Array.isArray(saved.base)) state.base = new Set(saved.base);
  } catch (e) {}
}

function b64url(obj) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
    .split('+').join('-').split('/').join('_').split('=').join('');
}
function personalUrl() {
  const allSelected = state.platforms.size === PLATFORMS.length && state.studios.size === STUDIOS.length && state.base.size === BASE.length && state.lang === 'es' && state.region === DEFAULT_REGION;
  if (allSelected) return window.location.origin + '/manifest.json';
  const slim = { lang: state.lang, region: state.region, platforms: [...state.platforms], studios: [...state.studios], base: [...state.base] };
  return window.location.origin + '/' + b64url(slim) + '/manifest.json';
}
function render() {
  document.querySelectorAll('.pill').forEach(p => {
    p.setAttribute('aria-pressed', String(state[p.dataset.group] === p.dataset.value));
  });
  document.querySelectorAll('input[data-group="platforms"]').forEach(i => { i.checked = state.platforms.has(i.dataset.key); });
  document.querySelectorAll('input[data-group="studios"]').forEach(i => { i.checked = state.studios.has(i.dataset.key); });
  document.querySelectorAll('input[data-group="base"]').forEach(i => { i.checked = state.base.has(i.dataset.key); });
  const BASE_WEIGHT = { tendencias: 2, populares: 2, top: 2, tvmaze_hoy: 1, estrenos: 1, proximos: 1, en_emision: 1, anime: 2 };
  const baseCount = [...state.base].reduce((n, k) => n + (BASE_WEIGHT[k] || 0), 0);
  const total = baseCount + state.platforms.size * 2 + state.studios.size;
  document.getElementById('countLine').innerHTML =
    '<b>' + total + '</b> catálogos · <b>' + state.platforms.size + '</b> plataformas · <b>' + state.studios.size + '</b> estudios · región <b>' + state.region + '</b>';
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
  render();
});
document.getElementById('copyBtn').addEventListener('click', async () => {
  const url = document.getElementById('manifestUrl').textContent;
  try { await navigator.clipboard.writeText(url); document.getElementById('copyBtn').textContent = '✅ Copiada'; }
  catch (e) { document.getElementById('copyBtn').textContent = '📋 Copiar URL'; }
  setTimeout(() => { document.getElementById('copyBtn').textContent = '📋 Copiar URL'; }, 1800);
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
</script>
</body>
</html>`;
}

module.exports = { renderConfigure };
