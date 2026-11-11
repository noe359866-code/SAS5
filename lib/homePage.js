'use strict';

/**
 * Landing (/) — portada del addon.
 *
 * Estructura: isla de navegación → hero a dos columnas (mensaje + muro de
 * pósters en movimiento) → plataformas → tendencias (pestañas + buscador
 * instantáneo) → funciones en rejilla "bento" → tres pasos → soporte y
 * donaciones → preguntas frecuentes → panel de instalación.
 *
 * Todo el estilo base viene del sistema de diseño compartido
 * (lib/theme.js + lib/rails.js + lib/layout.js); aquí solo vive lo propio de
 * la portada. Los contadores salen de los datos reales (catálogos,
 * proveedores, filtros, idiomas…), así no se quedan obsoletos.
 */

const { PLATFORMS, STUDIOS, buildDefs } = require('./catalogs');
const { STATIC_TRENDING_MOVIES, STATIC_TRENDING_SERIES, STATIC_TRENDING_ANIME } = require('./posterData');
const { RAILS_CSS, RAILS_JS, providerRailHtml, posterRailHtml, posterThumb, escapeHtml } = require('./rails');
const { THEME_CSS, MONO_STACK } = require('./theme');
const { icon } = require('./icons');
const { backgroundHtml, navHtml, supportCardHtml, donateCardHtml, footerHtml } = require('./layout');
const { PROVIDERS } = require('./streams');
const { FILTERS, RECOMMENDED_HIDE } = require('./streamFilters');
const { LANG_OPTIONS, REGION_OPTIONS } = require('./userConfig');
const { WEB_I18N_BOOTSTRAP, WEB_I18N_SCRIPT } = require('./webI18n');

function movieItems(data, fallback) {
  const results = data && Array.isArray(data.results) ? data.results : null;
  if (!results || results.length === 0) return fallback;
  return results.slice(0, 18).map((m) => ({
    title: m.title || m.name || 'Sin título',
    year: String(m.release_date || m.first_air_date || '').slice(0, 4),
    rating: m.vote_average ? Number(m.vote_average).toFixed(1) : '',
    poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : '',
  }));
}

/**
 * Muro de pósters del hero: tres columnas que se desplazan en vertical.
 * Reutiliza las mismas miniaturas que los rails (una sola descarga por
 * póster). Cada columna lleva su lista dos veces para que el bucle no salte.
 */
function posterWallHtml(lists) {
  const seen = new Set();
  const posters = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  // Intercala películas, series y anime para que las columnas queden mezcladas.
  for (let i = 0; i < longest; i += 1) {
    for (const list of lists) {
      const item = list[i];
      if (!item || !item.poster || seen.has(item.poster)) continue;
      seen.add(item.poster);
      posters.push(posterThumb(item.poster));
    }
  }
  const perColumn = Math.min(6, Math.floor(posters.length / 3));
  if (perColumn < 3) return '';
  const columns = [0, 1, 2].map((col) => {
    const own = posters.filter((_, index) => index % 3 === col).slice(0, perColumn);
    const imgs = [...own, ...own]
      .map((src) => `<img src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.style.visibility='hidden'" />`)
      .join('');
    return `<div class="wall-col"><div class="wall-track">${imgs}</div></div>`;
  }).join('\n      ');
  return `<div class="hero-wall">
      ${columns}
    </div>`;
}

function renderHome({ origin, host, trendingMovies, trendingSeries, trendingAnime }) {
  const movies = movieItems(trendingMovies, STATIC_TRENDING_MOVIES);
  const series = movieItems(trendingSeries, STATIC_TRENDING_SERIES);
  const anime = movieItems(trendingAnime, STATIC_TRENDING_ANIME);
  const stremioFast = escapeHtml(`stremio://${host}/manifest.json`);
  const manifestUrl = escapeHtml(`${origin}/manifest.json`);
  const catalogCount = buildDefs(null).length;
  const providerNames = PROVIDERS.map((p) => p.name);
  const wall = posterWallHtml([movies, series, anime]);

  // Muestra del filtro recomendado: las categorías que oculta van tachadas.
  const filterChips = FILTERS.map((f) => {
    const off = RECOMMENDED_HIDE.includes(f.key);
    return `<span class="mock-chip${off ? ' off' : ''}">${icon(off ? 'eye-off' : 'check', 13)}${escapeHtml(f.name)}</span>`;
  }).join('');
  const langChips = LANG_OPTIONS.slice(0, 9).map((l) => `<span class="code">${escapeHtml(l.code)}</span>`).join('');
  const regionChips = REGION_OPTIONS.slice(0, 9).map((r) => `<span class="code">${escapeHtml(r.code)}</span>`).join('');

  const install = `<a class="btn btn-primary btn-lg" href="${stremioFast}">${icon('download', 19)} Instalar en Stremio</a>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<script>${WEB_I18N_BOOTSTRAP}</script>
<title>Catálogos+ · Addon de Stremio — Películas y series por plataforma y estudio</title>
<meta name="description" content="${catalogCount} catálogos para Stremio: tendencias, estrenos, top valoradas, por plataforma (Netflix, Disney+, Max, Hulu, AMC+…) y por estudio (Marvel, Pixar, Ghibli…). Streams con filtros (oculta CAM, 3D, 4K…), ${LANG_OPTIONS.length} idiomas y ${REGION_OPTIONS.length} regiones. Gratis y sin cuenta." />
<meta name="theme-color" content="#080b12" />
<meta property="og:type" content="website" />
<meta property="og:title" content="Catálogos+ · Addon de Stremio" />
<meta property="og:description" content="${catalogCount} catálogos por plataforma y estudio, fichas completas y streams filtrados a tu gusto. Gratis y sin cuenta." />
<meta property="og:image" content="${escapeHtml(`${origin}/assets/logo.png`)}" />
<link rel="icon" href="/assets/logo.png" type="image/png" />
<style>
${THEME_CSS}
${RAILS_CSS}

  /* ── Hero ──────────────────────────────────────────────────────────────── */
  .hero { padding: clamp(30px, 5.2vw, 68px) 0 4px; }
  .hero-grid {
    display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(0, .92fr);
    gap: clamp(22px, 4vw, 56px); align-items: center;
  }
  .hero-copy { display: flex; flex-direction: column; align-items: flex-start; gap: 19px; min-width: 0; }
  .announce {
    display: inline-flex; align-items: center; gap: 10px; max-width: 100%; min-height: 36px; padding: 4px 13px 4px 5px;
    border-radius: var(--r-pill); background: rgba(255,255,255,.05); border: 1px solid var(--line-strong);
    color: var(--text-soft); font-size: .83rem; font-weight: 550; text-decoration: none;
    transition: border-color .2s, background .2s, color .2s;
  }
  .announce b {
    flex: 0 0 auto; display: inline-flex; align-items: center; height: 26px; padding: 0 10px; border-radius: var(--r-pill);
    background: var(--grad); color: #06070d; font-size: .68rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
  }
  .announce .ic { color: var(--muted); transition: transform .2s var(--ease), color .2s; }
  .announce:hover { border-color: rgba(140,122,255,.65); background: rgba(124,92,255,.14); color: #fff; }
  .announce:hover .ic { transform: translateX(3px); color: #fff; }
  .hero h1 {
    max-width: 11ch; color: #fff; font-weight: 820; letter-spacing: -.055em; line-height: .98;
    font-size: clamp(3rem, 6.6vw, 5.35rem); text-wrap: balance;
  }
  .hero h1 em {
    font-style: normal; padding-right: .06em;
    background: var(--grad-text); -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent; color: transparent;
  }
  .lead { max-width: 54ch; color: var(--text-soft); font-size: clamp(1rem, 1.4vw, 1.1rem); line-height: 1.68; text-wrap: pretty; }
  .lead strong { color: #fff; font-weight: 650; }
  .hero-cta { display: flex; gap: 12px; flex-wrap: wrap; }
  .hero-points { list-style: none; display: flex; gap: 8px 20px; flex-wrap: wrap; color: var(--muted); font-size: .85rem; }
  .hero-points li { display: inline-flex; align-items: center; gap: 7px; }
  .hero-points .ic { color: var(--ok); stroke-width: 2.6; }

  /* Muro de pósters */
  .hero-visual { position: relative; height: clamp(400px, 43vw, 560px); min-width: 0; }
  .hero-visual::before {
    content: ''; position: absolute; inset: 10% 2%; z-index: -1; border-radius: 50%;
    background: radial-gradient(closest-side, rgba(124,92,255,.42), rgba(34,211,238,.12) 60%, transparent);
    filter: blur(46px);
  }
  .hero-wall {
    position: absolute; inset: 0; overflow: hidden;
    display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px;
    transform: perspective(1500px) rotateY(-10deg) rotateX(4deg) rotateZ(1deg) scale(1.02);
    transform-origin: 62% 50%;
    mask-image: linear-gradient(180deg, transparent 0, #000 22%, #000 80%, transparent 100%),
                linear-gradient(90deg, transparent 0, #000 16%, #000 100%);
    -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 22%, #000 80%, transparent 100%),
                        linear-gradient(90deg, transparent 0, #000 16%, #000 100%);
    -webkit-mask-composite: source-in; mask-composite: intersect;
  }
  .wall-col { min-width: 0; }
  /* padding-bottom = gap: así media pista es exactamente una vuelta. */
  .wall-track { display: flex; flex-direction: column; gap: 14px; padding-bottom: 14px; animation: wall-up 80s linear infinite; will-change: transform; }
  .wall-col:nth-child(2) .wall-track { animation-name: wall-down; animation-duration: 96s; }
  .wall-col:nth-child(3) .wall-track { animation-duration: 110s; }
  .wall-track img {
    display: block; width: 100%; aspect-ratio: 2 / 3; object-fit: cover; border-radius: 16px;
    background: var(--bg-soft); border: 1px solid rgba(255,255,255,.08); box-shadow: 0 14px 30px rgba(0,0,0,.5);
  }
  @keyframes wall-up { from { transform: translateY(0); } to { transform: translateY(-50%); } }
  @keyframes wall-down { from { transform: translateY(-50%); } to { transform: translateY(0); } }

  /* Tarjeta flotante: muestra de los filtros */
  .hero-float {
    position: absolute; left: -4%; bottom: 9%; z-index: 2; width: 232px; padding: 14px;
    border-radius: 18px; background: rgba(13,14,24,.74); border: 1px solid var(--line-strong);
    backdrop-filter: blur(18px) saturate(1.5); -webkit-backdrop-filter: blur(18px) saturate(1.5);
    box-shadow: var(--shadow-lg), inset 0 1px 0 rgba(255,255,255,.08);
  }
  .hf-head { display: flex; align-items: center; gap: 8px; color: #fff; font-size: .8rem; font-weight: 700; margin-bottom: 10px; }
  .hf-head .ic { color: #b9abff; }
  .hero-float ul { list-style: none; display: grid; gap: 6px; }
  .hero-float li {
    display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 10px; border-radius: 10px;
    background: rgba(255,255,255,.05); border: 1px solid var(--line); font-size: .78rem; color: var(--text-soft);
  }
  .hero-float li b { color: #fff; font-weight: 650; }
  .hero-float li .ic { color: var(--ok); stroke-width: 2.6; }
  .hero-float li.off { color: var(--muted); background: transparent; border-style: dashed; }
  .hero-float li.off b { color: var(--muted); text-decoration: line-through; text-decoration-color: rgba(251,113,133,.8); }
  .hero-float li.off .ic { color: var(--danger); stroke-width: 2; }
  .hero-float li i { margin-left: auto; font-style: normal; font-size: .68rem; letter-spacing: .04em; text-transform: uppercase; }

  .hero-stats {
    display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 0;
    margin-top: clamp(24px, 3.4vw, 38px); padding-top: 13px; border-top: 1px solid var(--line);
  }
  .hero-stats .stat {
    display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 1px;
    padding: 8px 16px; border: 0; border-left: 1px solid var(--line); border-radius: 0; background: transparent;
    color: var(--muted); font-size: .76rem; line-height: 1.35;
  }
  .hero-stats .stat:first-child { border-left: 0; padding-left: 0; }
  .hero-stats .stat b { color: #f4f6fa; font-size: 1.25rem; line-height: 1.15; font-weight: 760; }
  .hero-stats .stat span { white-space: nowrap; }
  .hero-stats .stat:last-child { border-left: 1px solid var(--line); }

  /* ── Tendencias ────────────────────────────────────────────────────────── */
  .trend-tools { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .trend-tools .search-pill { width: 250px; max-width: 100%; padding-right: 14px; }
  /* Los títulos de cada rail solo hacen falta al buscar (se ven los tres). */
  #tendencias:not(.searching) .rail-head { display: none; }
  #tendencias .rail { margin-top: 0; }
  #tendencias.searching .rail { margin-top: 18px; }

  /* ── Funciones (bento) ─────────────────────────────────────────────────── */
  .bento { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 16px; }
  .bento .feature { grid-column: span 2; }
  .bento .f-wide { grid-column: span 4; }
  .bento .f-half { grid-column: span 3; }
  .f-new {
    display: inline-flex; align-items: center; height: 22px; padding: 0 9px; margin-left: 8px; border-radius: var(--r-pill);
    background: var(--grad); color: #06070d; font-size: .64rem; font-weight: 800; letter-spacing: .08em;
    text-transform: uppercase; vertical-align: middle;
  }
  .mock-chips, .tag-row { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 16px; }
  .mock-chip {
    display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 11px; border-radius: 10px;
    border: 1px solid rgba(124,92,255,.45); background: rgba(124,92,255,.12); color: #e6e0ff;
    font-size: .77rem; font-weight: 600; white-space: nowrap;
  }
  .mock-chip .ic { color: var(--ok); stroke-width: 2.6; }
  .mock-chip.off {
    border: 1px dashed var(--line-strong); background: transparent; color: var(--muted);
    text-decoration: line-through; text-decoration-color: rgba(251,113,133,.8);
  }
  .mock-chip.off .ic { color: var(--danger); stroke-width: 2; }
  .tag {
    display: inline-flex; align-items: center; height: 28px; padding: 0 10px; border-radius: 9px;
    background: var(--surface-2); border: 1px solid var(--line); color: var(--text-soft); font-size: .76rem; font-weight: 600;
  }
  .f-link {
    display: inline-flex; align-items: center; gap: 6px; margin-top: 16px; color: #c9beff;
    font-size: .86rem; font-weight: 650; text-decoration: none;
  }
  .f-link .ic { transition: transform .2s var(--ease); }
  .f-link:hover { color: #fff; }
  .f-link:hover .ic { transform: translateX(3px); }

  /* ── Cómo funciona ─────────────────────────────────────────────────────── */
  .steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
  .step .step-n {
    display: block; font-family: ${MONO_STACK}; font-size: 2.3rem; font-weight: 800; line-height: 1; letter-spacing: -.04em;
    background: var(--grad-text); -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent; color: transparent; opacity: .9;
  }

  /* ── Preguntas frecuentes ──────────────────────────────────────────────── */
  .faq-grid { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); gap: clamp(22px, 4vw, 56px); align-items: start; }
  .faq { display: grid; gap: 10px; }
  .faq details {
    border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface);
    transition: border-color .2s, background .2s;
  }
  .faq details[open] { border-color: rgba(124,92,255,.42); background: rgba(124,92,255,.06); }
  .faq summary {
    display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 16px 18px;
    cursor: pointer; list-style: none; color: #fff; font-weight: 650; font-size: .97rem;
  }
  .faq summary::-webkit-details-marker { display: none; }
  .faq summary .ic { color: var(--muted); transition: transform .22s var(--ease); }
  .faq details[open] summary .ic { transform: rotate(180deg); color: #c9beff; }
  .faq details p { padding: 0 18px 18px; color: var(--text-soft); font-size: .92rem; line-height: 1.65; }
  .faq details p a { color: var(--brand-3); }

  /* ── Panel de instalación ──────────────────────────────────────────────── */
  .cta-panel {
    position: relative; overflow: hidden; isolation: isolate; text-align: center;
    padding: clamp(34px, 6vw, 64px) clamp(18px, 4vw, 40px);
    border-radius: var(--r-xl); border: 1px solid rgba(124,92,255,.38);
    background:
      radial-gradient(720px 300px at 50% 0%, rgba(124,92,255,.32), transparent 70%),
      radial-gradient(520px 260px at 100% 100%, rgba(34,211,238,.12), transparent 70%),
      linear-gradient(160deg, rgba(18,19,32,.96), rgba(8,8,14,.96));
    box-shadow: var(--shadow-lg), inset 0 1px 0 rgba(255,255,255,.08);
  }
  .cta-panel h2 { font-size: clamp(1.7rem, 4.2vw, 2.7rem); font-weight: 850; letter-spacing: -.04em; line-height: 1.06; color: #fff; text-wrap: balance; }
  .cta-panel p { color: var(--text-soft); margin: 14px auto 22px; max-width: 56ch; font-size: .98rem; }
  .manifest-box {
    display: flex; align-items: center; gap: 8px; max-width: 620px; margin: 0 auto 22px; padding: 6px 6px 6px 14px;
    border-radius: var(--r-md); background: rgba(5,5,8,.72); border: 1px solid var(--line-strong); text-align: left;
  }
  .manifest-box code {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-family: ${MONO_STACK}; font-size: .78rem; color: #9fe8ff;
  }
  .cta-actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
  .cta-note { margin-top: 16px; font-size: .84rem; color: var(--muted); }

  @media (max-width: 980px) {
    .hero-grid { grid-template-columns: 1fr; }
    .hero-visual { height: 340px; }
    .hero-wall { transform: perspective(1200px) rotateX(8deg) rotateZ(-1.5deg) scale(1.04); transform-origin: 50% 50%; }
    .hero-stats { grid-template-columns: repeat(5, minmax(0, 1fr)); }
    .hero-float { left: 4%; bottom: 8%; }
    .bento { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .bento .feature, .bento .f-half { grid-column: span 1; }
    .bento .f-wide { grid-column: span 2; }
    .faq-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 700px) {
    .hero-cta { width: 100%; }
    .hero-cta .btn { flex: 1 1 100%; }
    .hero-visual { height: 280px; }
    .hero h1 { max-width: 10ch; font-size: clamp(2.8rem, 13vw, 4.15rem); }
    .hero-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 20px; }
    .hero-stats .stat { min-height: 58px; padding: 8px 12px; border-left: 1px solid var(--line); }
    .hero-stats .stat:first-child, .hero-stats .stat:nth-child(odd) { border-left: 0; padding-left: 0; }
    .hero-stats .stat b { font-size: 1.1rem; }
    .hero-wall { gap: 10px; }
    .wall-track { gap: 10px; padding-bottom: 10px; }
    .wall-track img { border-radius: 12px; }
    .hero-float { width: 204px; padding: 11px; left: 2%; bottom: 6%; }
    .trend-tools, .trend-tools .tabs, .trend-tools .search-pill { width: 100%; }
    .trend-tools .tab { flex: 1; justify-content: center; padding: 0 8px; }
    .bento, .steps { grid-template-columns: 1fr; }
    .bento .feature, .bento .f-wide, .bento .f-half { grid-column: auto; }
    .cta-actions .btn { flex: 1 1 100%; }
  }
  @media (prefers-reduced-motion: reduce) {
    .wall-track { animation: none !important; }
  }
</style>
<noscript><style>html[data-i18n-pending] body{visibility:visible!important}</style></noscript>
</head>
<body>

${backgroundHtml()}

${navHtml({
    links: [['#tendencias', 'Tendencias'], ['#funciones', 'Funciones'], ['#como', 'Cómo funciona'], ['#faq', 'Preguntas']],
    actions: `<a class="btn btn-ghost btn-sm" href="/configure" aria-label="Configurar">${icon('sliders-horizontal', 16)}<span class="lbl">Configurar</span></a><a class="btn btn-primary btn-sm" href="${stremioFast}">${icon('download', 16)}<span class="lbl">Instalar</span></a>`,
  })}

<header class="hero">
  <div class="wrap">
    <div class="hero-grid">
      <div class="hero-copy">
        <a class="announce" href="/configure#filtros"><b>Tu Stremio</b><span>Idioma, región y filtros a tu gusto</span>${icon('arrow-right', 15)}</a>
        <h1>Stremio, <em>a tu manera.</em></h1>
        <p class="lead">Descubre películas y series con <strong>${catalogCount} catálogos</strong> por plataforma y estudio. Ajusta idioma, región y calidad para encontrar tu próxima historia. <strong>Gratis y sin cuenta.</strong></p>
        <div class="hero-cta">
          ${install}
          <a class="btn btn-ghost btn-lg" href="/configure">${icon('sliders-horizontal', 19)} Personalizar</a>
        </div>
        <ul class="hero-points">
          <li>${icon('check', 15)} Gratis</li>
          <li>${icon('check', 15)} Sin registro</li>
          <li>${icon('check', 15)} Hecho para Stremio</li>
        </ul>
      </div>
      <div class="hero-visual" aria-hidden="true">
        ${wall}
        <div class="hero-float">
          <div class="hf-head">${icon('funnel', 15)} Tus streams, a tu gusto</div>
          <ul>
            <li>${icon('check', 14)}<b>1080p</b> WEB-DL</li>
            <li>${icon('check', 14)}<b>4K</b> HDR</li>
            <li class="off">${icon('eye-off', 14)}<b>CAM · TS</b><i>oculto</i></li>
            <li class="off">${icon('eye-off', 14)}<b>3D</b><i>oculto</i></li>
          </ul>
        </div>
      </div>
    </div>
    <div class="stats hero-stats">
      <span class="stat"><b>${catalogCount}</b><span>catálogos</span></span>
      <span class="stat"><b>${PLATFORMS.length}</b><span>plataformas</span></span>
      <span class="stat"><b>${STUDIOS.length}</b><span>estudios</span></span>
      <span class="stat"><b>${LANG_OPTIONS.length}</b><span>idiomas</span></span>
      <span class="stat"><b>${FILTERS.length}</b><span>filtros</span></span>
    </div>
  </div>
</header>

<main>
  <div class="wrap" id="plataformas">
    ${providerRailHtml('/configure#plataformas')}
  </div>

  <section class="wrap section" id="tendencias">
    <div class="head-row">
      <div>
        <span class="eyebrow">Ahora mismo</span>
        <h2 class="title">Tendencias de la <em>semana</em></h2>
      </div>
      <div class="trend-tools">
        <div class="tabs" role="tablist" aria-label="Tipo de contenido">
          <button class="tab active" type="button" data-tab="movies" role="tab" aria-selected="true">${icon('film', 15)} Películas</button>
          <button class="tab" type="button" data-tab="series" role="tab" aria-selected="false">${icon('tv', 15)} Series</button>
          <button class="tab" type="button" data-tab="anime" role="tab" aria-selected="false">${icon('sparkles', 15)} Anime</button>
        </div>
        <form class="search-pill" id="buscar" role="search" onsubmit="return false">
          ${icon('search', 17)}
          <input id="homeSearch" type="search" placeholder="Filtrar esta portada…" autocomplete="off" aria-label="Filtrar los pósters de esta página" />
        </form>
      </div>
    </div>

    <p class="no-results" id="noResults">Nada en esta portada con ese título. <a href="/configure">Instala el addon</a> para buscar en todos los catálogos desde Stremio.</p>

    <div class="tab-panel" data-panel="movies">
      ${posterRailHtml({ title: 'Películas', accent: 'en tendencia esta semana', items: movies, href: '/configure', media: 'Película' })}
    </div>
    <div class="tab-panel" data-panel="series" hidden>
      ${posterRailHtml({ title: 'Series', accent: 'en tendencia esta semana', items: series, href: '/configure', media: 'Serie' })}
    </div>
    <div class="tab-panel" data-panel="anime" hidden>
      ${posterRailHtml({ title: 'Anime', accent: 'popular', items: anime, href: '/configure', media: 'Anime' })}
    </div>
  </section>

  <section class="wrap section" id="funciones">
    <div class="head-row">
      <div>
        <span class="eyebrow">Funciones</span>
        <h2 class="title">Todo lo que trae <em>Catálogos+</em></h2>
        <p class="subtitle">Catálogos que se llenan solos, fichas con toda la información y streams que respetan lo que quieres ver.</p>
      </div>
    </div>
    <div class="bento">
      <article class="feature f-wide">
        <div class="fi">${icon('funnel', 21)}</div>
        <h3>Filtros de streams <span class="f-new">Nuevo</span></h3>
        <p>Desmarca lo que no quieres y deja de aparecer en Stremio: copias <strong>CAM</strong> y screeners, <strong>3D</strong>, <strong>4K</strong>, REMUX enormes, Dolby Vision, HEVC, AV1… Además eliges el orden (seeders, calidad o tamaño) y un tamaño máximo.</p>
        <div class="mock-chips" aria-hidden="true">${filterChips}</div>
        <a class="f-link" href="/configure#filtros">Elegir mis filtros ${icon('arrow-right', 15)}</a>
      </article>
      <article class="feature">
        <div class="fi">${icon('magnet', 21)}</div>
        <h3>${PROVIDERS.length} proveedores de streams</h3>
        <p>Al abrir una película o un episodio se consultan en paralelo y se quitan los duplicados. Nyaa cubre el anime y YTS las películas.</p>
        <div class="tag-row">${providerNames.map((name) => `<span class="tag">${escapeHtml(name)}</span>`).join('')}</div>
      </article>
      <article class="feature">
        <div class="fi">${icon('languages', 21)}</div>
        <h3>${LANG_OPTIONS.length} idiomas</h3>
        <p>Títulos, sinopsis y pósters en el idioma que elijas, del español latino al japonés.</p>
        <div class="tag-row" aria-hidden="true">${langChips}<span class="code">+${LANG_OPTIONS.length - 9}</span></div>
      </article>
      <article class="feature">
        <div class="fi">${icon('map-pin', 21)}</div>
        <h3>${REGION_OPTIONS.length} regiones</h3>
        <p>Cada plataforma muestra lo que ofrece en tu país, y la cartelera de cines es la tuya.</p>
        <div class="tag-row" aria-hidden="true">${regionChips}<span class="code">+${REGION_OPTIONS.length - 9}</span></div>
      </article>
      <article class="feature">
        <div class="fi">${icon('layout-grid', 21)}</div>
        <h3>${PLATFORMS.length} plataformas y ${STUDIOS.length} estudios</h3>
        <p>Netflix, Disney+, Max, Hulu, AMC+… y Marvel, Pixar, A24 o Ghibli, cada uno con su catálogo de películas y de series.</p>
      </article>
      <article class="feature f-half">
        <div class="fi">${icon('star', 21)}</div>
        <h3>Fichas con todas las notas</h3>
        <p>IMDb, Rotten Tomatoes y Metacritic junto a la puntuación de TMDB, con reparto, dirección y géneros.</p>
      </article>
      <article class="feature f-half">
        <div class="fi">${icon('monitor-play', 21)}</div>
        <h3>Dónde verlo ahora</h3>
        <p>Cada ficha indica en qué plataformas está disponible en tu región: «Disponible en Netflix · Max · Hulu…».</p>
      </article>
    </div>
  </section>

  <section class="wrap section" id="como">
    <div class="head-row">
      <div>
        <span class="eyebrow">Cómo funciona</span>
        <h2 class="title">Listo en <em>tres pasos</em></h2>
      </div>
      <a class="btn btn-ghost" href="/configure">${icon('sliders-horizontal', 17)} Abrir el configurador</a>
    </div>
    <div class="steps">
      <article class="feature step">
        <span class="step-n">01</span>
        <h3>Elige</h3>
        <p>Idioma, región, plataformas, estudios y qué streams quieres ver. O sáltate este paso: lo de serie ya funciona.</p>
      </article>
      <article class="feature step">
        <span class="step-n">02</span>
        <h3>Instala</h3>
        <p>Un clic en «Instalar en Stremio» abre la app con tu selección. También puedes copiar la URL y pegarla en Addons.</p>
      </article>
      <article class="feature step">
        <span class="step-n">03</span>
        <h3>Disfruta</h3>
        <p>Los catálogos aparecen en Inicio y en Descubrir, y los streams al abrir cualquier película o episodio.</p>
      </article>
    </div>
  </section>

  <section class="wrap section">
    ${supportCardHtml()}
    ${donateCardHtml()}
  </section>

  <section class="wrap section" id="faq">
    <div class="faq-grid">
      <div>
        <span class="eyebrow">Preguntas</span>
        <h2 class="title">Lo que más <em>se pregunta</em></h2>
        <p class="subtitle">¿No está tu duda? Pregunta en el canal de soporte y te respondemos.</p>
      </div>
      <div class="faq">
        <details>
          <summary>¿Cómo oculto las copias CAM, el 3D o el 4K? ${icon('chevron-down', 18)}</summary>
          <p>En el <a href="/configure#filtros">configurador</a>, sección «Filtros de streams»: desmarca lo que no quieras ver —tipo de copia (CAM, screener, REMUX…), resolución (4K, 1080p, 720p, SD) e imagen (3D, HDR, Dolby Vision, HEVC, AV1)— y pulsa «Instalar en Stremio». Lo que desmarques no vuelve a salir en la lista de streams.</p>
        </details>
        <details>
          <summary>Ya lo tengo instalado, ¿cómo cambio mi configuración? ${icon('chevron-down', 18)}</summary>
          <p>En Stremio abre Addons, busca Catálogos+ y pulsa «Configurar»: se abre esta web con tu selección cargada. Cambia lo que quieras e instala de nuevo. Para Stremio cada configuración es un addon distinto, así que <strong>desinstala la versión anterior</strong>; si no, verás los catálogos repetidos y sus streams sin filtrar.</p>
        </details>
        <details>
          <summary>¿Por qué un título no muestra streams? ${icon('chevron-down', 18)}</summary>
          <p>Los streams salen de buscadores públicos de torrents: si ninguno tiene ese título, no hay resultados. Si usas filtros, puede que todas las copias que existen estén en una categoría que ocultaste (un estreno reciente que solo circula en CAM, por ejemplo); vuelve a marcarla en el configurador.</p>
        </details>
        <details>
          <summary>¿Qué cambian el idioma y la región? ${icon('chevron-down', 18)}</summary>
          <p>El idioma decide en qué lengua llegan títulos, sinopsis y pósters (${LANG_OPTIONS.length} disponibles). La región decide qué ofrece cada plataforma en tu país y qué hay en cines (${REGION_OPTIONS.length} países). Los nombres de los catálogos se mantienen en español; esta web se adapta automáticamente al idioma de tu navegador.</p>
        </details>
        <details>
          <summary>¿Es gratis? ¿Aloja contenido? ${icon('chevron-down', 18)}</summary>
          <p>Es gratis y no pide cuenta. Catálogos+ no aloja ni distribuye archivos: organiza catálogos con datos de TMDB y enlaza resultados de buscadores públicos.</p>
        </details>
      </div>
    </div>
  </section>

  <section class="wrap section" id="instalar">
    <div class="cta-panel reveal">
      <h2>¿Listo para <span class="grad-text">instalarlo?</span></h2>
      <p>Un clic y aparece en Stremio. O copia la URL y pégala en el buscador de la sección Addons.</p>
      <div class="manifest-box">
        <code id="manifestUrl">${manifestUrl}</code>
        <button class="btn btn-ghost btn-sm" type="button" id="copyManifest" data-copy="${manifestUrl}">${icon('copy', 15)}<span>Copiar</span></button>
      </div>
      <div class="cta-actions">
        ${install}
        <a class="btn btn-ghost btn-lg" href="/configure">${icon('sliders-horizontal', 19)} Personalizar primero</a>
      </div>
      <div class="cta-note">Funciona en Stremio Web, Desktop, Android, iOS y TV.</div>
    </div>
  </section>
</main>

${footerHtml()}

<script>${RAILS_JS}</script>
<script>
(function () {
  var section = document.getElementById('tendencias');
  var tabs = document.querySelectorAll('.tab');
  var panels = document.querySelectorAll('.tab-panel');
  var input = document.getElementById('homeSearch');
  var noResults = document.getElementById('noResults');
  var activeTab = 'movies';

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
  }
  // Sin búsqueda: solo la pestaña activa. Con búsqueda: los tres tipos a la
  // vez, cada uno con las tarjetas que coinciden.
  function apply() {
    var q = norm(input.value).trim();
    var total = 0;
    section.classList.toggle('searching', Boolean(q));
    panels.forEach(function (panel) {
      var hits = 0;
      panel.querySelectorAll('.poster-card').forEach(function (card) {
        var hit = !q || norm(card.getAttribute('data-title')).indexOf(q) !== -1;
        card.style.display = hit ? '' : 'none';
        if (hit) {
          hits++;
          // Una tarjeta que aún no había entrado en pantalla sigue oculta por
          // la animación de entrada: al filtrar debe verse ya.
          if (q) card.classList.add('revealed');
        }
      });
      total += hits;
      panel.hidden = q ? hits === 0 : panel.getAttribute('data-panel') !== activeTab;
      var rail = panel.querySelector('.rail-scroll');
      if (rail && q) rail.scrollLeft = 0;
    });
    noResults.style.display = q && total === 0 ? 'block' : 'none';
  }
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (t) {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      activeTab = tab.getAttribute('data-tab');
      // Cambiar de pestaña sale del modo búsqueda.
      input.value = '';
      apply();
    });
  });
  input.addEventListener('input', apply);

  // Copiar la URL del manifest.
  var copyBtn = document.getElementById('copyManifest');
  var copyLabel = copyBtn.querySelector('span');
  function copied(ok) {
    copyLabel.textContent = ok ? 'Copiada' : 'Copia a mano';
    setTimeout(function () { copyLabel.textContent = 'Copiar'; }, 1800);
  }
  copyBtn.addEventListener('click', function () {
    var text = copyBtn.getAttribute('data-copy');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { copied(true); }, function () { copied(false); });
      return;
    }
    // Navegadores sin API de portapapeles (o página servida sin HTTPS).
    var range = document.createRange();
    range.selectNodeContents(document.getElementById('manifestUrl'));
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    copied(ok);
  });
})();
</script>
<script>${WEB_I18N_SCRIPT}</script>
</body>
</html>`;
}

module.exports = { renderHome };
