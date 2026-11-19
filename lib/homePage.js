'use strict';

/**
 * Landing (/) — portada del addon.
 *
 * Estructura: barra de navegación → hero cinematográfico (mensaje sobre un
 * muro de pósters a toda la anchura) → plataformas → tendencias (pestañas +
 * buscador instantáneo, con el puesto de cada título) → funciones en rejilla
 * "bento" → tres pasos → soporte y donaciones → preguntas frecuentes → panel
 * de instalación.
 *
 * Todo el estilo base viene del sistema de diseño compartido
 * (lib/theme.js + lib/rails.js + lib/layout.js); aquí solo vive lo propio de
 * la portada. Los contadores salen de los datos reales (catálogos,
 * proveedores, filtros, idiomas…), así no se quedan obsoletos.
 */

const { PLATFORMS, STUDIOS, buildDefs } = require('./catalogs');
const { STATIC_TRENDING_MOVIES, STATIC_TRENDING_SERIES, STATIC_TRENDING_ANIME } = require('./posterData');
const { RAILS_CSS, RAILS_JS, providerRailHtml, posterRailHtml, escapeHtml } = require('./rails');
const { THEME_CSS, MONO_STACK } = require('./theme');
const { icon } = require('./icons');
const { backgroundHtml, navHtml, supportCardHtml, donateCardHtml, footerHtml } = require('./layout');
const { PROVIDERS } = require('./streams');
const { FILTERS, RECOMMENDED_HIDE } = require('./streamFilters');
const { REGION_OPTIONS } = require('./userConfig');
const { WEB_I18N_BOOTSTRAP, WEB_I18N_SCRIPT } = require('./webI18n');
const { cleanTitle } = require('./sanitize');

function movieItems(data, fallback) {
  const results = data && Array.isArray(data.results) ? data.results : null;
  if (!results || results.length === 0) return fallback;
  return results.slice(0, 18).map((m) => ({
    // La portada lee TMDB en crudo (sin pasar por mapTmdbItem): saneado propio.
    title: cleanTitle(m.title || m.name || '') || 'Sin título',
    year: String(m.release_date || m.first_air_date || '').slice(0, 4),
    rating: m.vote_average ? Number(m.vote_average).toFixed(1) : '',
    poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : '',
  }));
}

function renderHome({ origin, host, trendingMovies, trendingSeries, trendingAnime }) {
  const movies = movieItems(trendingMovies, STATIC_TRENDING_MOVIES);
  const series = movieItems(trendingSeries, STATIC_TRENDING_SERIES);
  const anime = movieItems(trendingAnime, STATIC_TRENDING_ANIME);
  const stremioFast = escapeHtml(`stremio://${host}/manifest.json`);
  const manifestUrl = escapeHtml(`${origin}/manifest.json`);
  const catalogCount = buildDefs(null).length;
  const providerNames = PROVIDERS.map((p) => p.name);

  // Muestra del filtro recomendado: las categorías que oculta van tachadas.
  const filterChips = FILTERS.map((f) => {
    const off = RECOMMENDED_HIDE.includes(f.key);
    return `<span class="mock-chip${off ? ' off' : ''}">${icon(off ? 'eye-off' : 'check', 13)}${escapeHtml(f.name)}</span>`;
  }).join('');
  const regionChips = REGION_OPTIONS.slice(0, 9).map((r) => `<span class="code">${escapeHtml(r.code)}</span>`).join('');

  const install = `<a class="btn btn-primary btn-lg" href="${stremioFast}">${icon('download', 19)} Instalar en Stremio</a>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<script>${WEB_I18N_BOOTSTRAP}</script>
<title>RamdonLatam · Addon de Stremio — Películas y series por plataforma y estudio</title>
<meta name="description" content="${catalogCount} catálogos para Stremio: tendencias, estrenos, top valoradas, por plataforma (Netflix, Disney+, Max, Hulu, AMC+…) y por estudio (Marvel, Pixar, Ghibli…). Streams con filtros (oculta CAM, 3D, 4K…), español latino y ${REGION_OPTIONS.length} regiones. Gratis y sin cuenta." />
<meta name="theme-color" content="#060f1a" />
<meta property="og:type" content="website" />
<meta property="og:title" content="RamdonLatam · Addon de Stremio" />
<meta property="og:description" content="${catalogCount} catálogos por plataforma y estudio, fichas completas y streams filtrados a tu gusto. Gratis y sin cuenta." />
<meta property="og:image" content="${escapeHtml(`${origin}/assets/og-cover.png`)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="${escapeHtml(`${origin}/assets/og-cover.png`)}" />
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" />
<link rel="icon" href="/assets/icon-192.png" type="image/png" sizes="192x192" />
<link rel="apple-touch-icon" href="/assets/icon-192.png" />
<link rel="manifest" href="/site.webmanifest" />
<style>
${THEME_CSS}
${RAILS_CSS}

  /* ── Portada: baraja de fichas ─────────────────────────────────────────────
     El mensaje a la izquierda y, a la derecha, la marca en movimiento: tres
     fichas abanicadas —las mismas de las que nace el logo— con la de delante
     mostrando el icono y el nombre. Detrás, la foto del Pacífico al anochecer
     (Nicaragua) fundida en azul noche para que el naranja de la marca respire.
     Todo el abanico es CSS: ninguna imagen extra, ningún script. */
  .hero {
    position: relative; isolation: isolate; overflow: hidden;
    margin-top: calc(-1 * var(--nav-h));
    padding: calc(var(--nav-h) + clamp(40px, 8vh, 92px)) 0 0;
  }
  .hero-backdrop { position: absolute; inset: 0; z-index: -1; pointer-events: none; }
  .hero-backdrop img { width: 100%; height: 100%; object-fit: cover; object-position: 62% center; }
  .hero-backdrop::after {
    content: ''; position: absolute; inset: 0;
    background:
      linear-gradient(90deg, rgba(6,15,26,.94) 0%, rgba(6,15,26,.82) 30%, rgba(6,15,26,.55) 52%, rgba(6,15,26,.42) 74%, rgba(6,15,26,.5) 100%),
      linear-gradient(180deg, rgba(6,15,26,.72) 0%, rgba(6,15,26,.1) 26%, rgba(6,15,26,.25) 62%, var(--bg) 96%),
      radial-gradient(60vw 380px at 78% 18%, rgba(245,130,31,.22), transparent 66%);
  }
  .hero-grid {
    display: grid; grid-template-columns: minmax(0, 1.12fr) minmax(0, .88fr);
    gap: clamp(22px, 4vw, 56px); align-items: center; min-height: clamp(420px, 56vh, 580px);
  }
  .hero-copy { display: flex; flex-direction: column; align-items: flex-start; gap: 22px; min-width: 0; }
  .announce {
    display: inline-flex; align-items: center; gap: 10px; max-width: 100%; min-height: 38px; padding: 4px 14px 4px 4px;
    border-radius: var(--r-pill); background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.1);
    color: var(--text-soft); font-size: .83rem; font-weight: 550; text-decoration: none;
    backdrop-filter: saturate(180%) blur(20px); -webkit-backdrop-filter: saturate(180%) blur(20px);
    transition: background .2s, color .2s, border-color .2s;
  }
  .announce b {
    flex: 0 0 auto; display: inline-flex; align-items: center; height: 28px; padding: 0 11px; border-radius: var(--r-pill);
    background: var(--grad); color: #10283d; font-size: .68rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase;
    box-shadow: 0 4px 12px rgba(245,130,31,.3);
  }
  .announce .ic { color: #8fa2b4; transition: transform .2s var(--ease), color .2s; }
  .announce:hover { background: rgba(255,255,255,.12); border-color: rgba(255,255,255,.18); color: #fff; }
  .announce:hover .ic { transform: translateX(3px); color: #fff; }
  .hero h1 {
    max-width: 14ch; color: #fff; font-weight: 750; letter-spacing: -.045em; line-height: .95;
    font-size: clamp(3rem, 6.8vw, 5.6rem); text-wrap: balance;
  }
  /* Titular a dos tonos: el remate va en el naranja de la marca. */
  .hero h1 em { display: block; font-style: normal; color: transparent;
    background: linear-gradient(96deg, #ffb457 0%, #f5821f 58%, #ff8f3d 100%);
    -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  }
  .lead { max-width: 50ch; color: #c3d1de; font-size: clamp(1.04rem, 1.4vw, 1.2rem); line-height: 1.5; letter-spacing: -.012em; text-wrap: pretty; }
  .lead strong { color: #fff; font-weight: 600; }
  .hero-cta { display: flex; gap: 12px; flex-wrap: wrap; }
  .hero-points { list-style: none; display: flex; gap: 8px 20px; flex-wrap: wrap; color: #93a5b6; font-size: .85rem; }
  .hero-points li { display: inline-flex; align-items: center; gap: 7px; }
  .hero-points .ic { color: var(--brand); stroke-width: 2.6; }

  /* El abanico: tres fichas giradas sobre el mismo eje, la última al frente. */
  .hero-deck {
    position: relative; justify-self: end; width: 100%; max-width: 400px;
    aspect-ratio: 1 / 1; margin-left: auto;
    filter: drop-shadow(0 34px 60px rgba(2,10,18,.62));
  }
  .deck-card {
    position: absolute; left: 50%; top: 50%; width: 74%; height: 80%;
    margin: -40% 0 0 -37%; border-radius: 30px;
    border: 1px solid rgba(255,255,255,.12);
    transform-origin: 50% 92%;
  }
  .deck-card.back { background: linear-gradient(160deg, #16415f, #0a1c2c); transform: rotate(-15deg) translateY(8px); }
  .deck-card.mid { background: linear-gradient(160deg, #1d4f70, #0c2437); transform: rotate(-8deg) translateY(4px); }
  .deck-card.front {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
    padding: 26px; text-align: center;
    background:
      radial-gradient(120% 90% at 20% 0%, rgba(255,255,255,.34), transparent 58%),
      linear-gradient(168deg, #ffa552 0%, #f5821f 48%, #d95e0b 100%);
    border-color: rgba(255,255,255,.34);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.5);
  }
  .deck-card.front img { width: 96px; height: 96px; border-radius: 24px; box-shadow: 0 12px 28px rgba(60,24,2,.42); }
  .deck-word { color: #10283d; font-size: 1.18rem; font-weight: 800; letter-spacing: -.03em; }
  .deck-word i { font-style: normal; color: rgba(16,40,61,.6); }
  .deck-tag {
    display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 11px; border-radius: 980px;
    background: rgba(16,40,61,.16); color: #10304a;
    font-family: ${MONO_STACK}; font-size: .68rem; font-weight: 700; letter-spacing: -.01em;
  }
  .deck-chip {
    position: absolute; display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 13px;
    border-radius: 980px; background: rgba(10,26,40,.86); border: 1px solid rgba(255,255,255,.14);
    color: var(--text-soft); font-size: .78rem; font-weight: 600; white-space: nowrap;
    backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
    box-shadow: 0 12px 26px rgba(2,10,18,.5);
  }
  .deck-chip .ic { color: var(--brand); }
  .deck-chip.c1 { left: -6%; top: 16%; animation: deckFloat 7s var(--ease) infinite; }
  .deck-chip.c2 { right: -4%; bottom: 14%; animation: deckFloat 9s var(--ease) infinite reverse; }
  @keyframes deckFloat {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-9px); }
  }

  /* Métricas: una fila de cifras separadas por hairlines, sin cajas. */
  .hero-stats {
    display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 0;
    margin-top: clamp(28px, 4vw, 46px); padding-top: 16px; border-top: 1px solid rgba(255,255,255,.14);
  }
  .hero-stats .stat {
    display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 2px;
    padding: 6px 18px; border: 0; border-left: 1px solid rgba(255,255,255,.14); border-radius: 0; background: transparent;
    color: var(--muted); font-size: .8rem; line-height: 1.35;
  }
  .hero-stats .stat:first-child { border-left: 0; padding-left: 0; }
  .hero-stats .stat b { color: #fff; font-size: clamp(1.5rem, 2.6vw, 2rem); line-height: 1.1; font-weight: 650; letter-spacing: -.035em; }
  .hero-stats .stat:nth-child(odd) b { color: #ffb264; }
  .hero-stats .stat span { white-space: nowrap; color: var(--muted); }

  /* ── Tendencias ────────────────────────────────────────────────────────── */
  .trend-tools { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .trend-tools .search-pill { width: 250px; max-width: 100%; padding-right: 14px; }
  /* Los títulos de cada rail solo hacen falta al buscar (se ven los tres). */
  #tendencias:not(.searching) .rail-head { display: none; }
  #tendencias .rail { margin-top: 0; }
  #tendencias.searching .rail { margin-top: 18px; }
  /* Puesto en la lista, como los «Top chart» de Apple TV: el orden es el de
     tendencias. Al buscar se oculta (las tarjetas filtradas no cuentan). */
  #tendencias:not(.searching) .rail-scroll { counter-reset: rank; }
  #tendencias:not(.searching) .poster-card {
    counter-increment: rank; display: grid; grid-template-columns: auto minmax(0, 1fr);
    column-gap: 9px; align-content: start;
  }
  #tendencias:not(.searching) .poster-card .poster { grid-column: 1 / -1; }
  #tendencias:not(.searching) .poster-card::before {
    content: counter(rank); position: relative; z-index: 1; grid-column: 1; grid-row: 2 / span 2; margin-top: 9px;
    color: #ffb264; font-size: 2.15rem; font-weight: 700; line-height: 1; letter-spacing: -.06em;
    font-variant-numeric: tabular-nums;
  }
  #tendencias:not(.searching) .poster-title, #tendencias:not(.searching) .poster-meta { grid-column: 2; }

  /* ── Funciones (bento) ─────────────────────────────────────────────────── */
  .bento { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 16px; }
  .bento .feature { grid-column: span 2; }
  .bento .f-wide { grid-column: span 4; }
  .bento .f-half { grid-column: span 3; }
  .f-new {
    display: inline-flex; align-items: center; height: 22px; padding: 0 9px; margin-left: 8px; border-radius: var(--r-pill);
    background: var(--grad); color: #10283d; font-size: .64rem; font-weight: 800; letter-spacing: .08em;
    text-transform: uppercase; vertical-align: middle; box-shadow: 0 3px 10px rgba(245,130,31,.28);
  }
  .mock-chips, .tag-row { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 16px; }
  .mock-chip {
    display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 11px; border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.32); background: rgba(255,255,255,0.096); color: #f5f5f7;
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
    display: inline-flex; align-items: center; gap: 6px; margin-top: 16px; color: #d2d2d7;
    font-size: .86rem; font-weight: 650; text-decoration: none;
  }
  .f-link .ic { transition: transform .2s var(--ease); }
  .f-link:hover { color: #fff; }
  .f-link:hover .ic { transform: translateX(3px); }

  /* ── Cómo funciona ─────────────────────────────────────────────────────── */
  .steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
  .step .step-n {
    display: block; font-family: ${MONO_STACK}; font-size: 2.3rem; font-weight: 800; line-height: 1; letter-spacing: -.04em;
    color: var(--brand); opacity: .85;
  }

  /* ── Preguntas frecuentes ──────────────────────────────────────────────── */
  .faq-grid { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); gap: clamp(22px, 4vw, 56px); align-items: start; }
  .faq { display: grid; gap: 10px; }
  .faq details {
    border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface);
    transition: border-color .2s, background .2s;
  }
  .faq details[open] { border-color: rgba(255,255,255,0.32); background: rgba(255,255,255,0.048); }
  .faq summary {
    display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 16px 18px;
    cursor: pointer; list-style: none; color: #fff; font-weight: 650; font-size: .97rem;
  }
  .faq summary::-webkit-details-marker { display: none; }
  .faq summary .ic { color: var(--muted); transition: transform .22s var(--ease); }
  .faq details[open] summary .ic { transform: rotate(180deg); color: #d2d2d7; }
  .faq details p { padding: 0 18px 18px; color: var(--text-soft); font-size: .92rem; line-height: 1.65; }
  .faq details p a { color: var(--brand-3); }

  /* ── Panel de instalación ──────────────────────────────────────────────── */
  .cta-panel {
    position: relative; overflow: hidden; isolation: isolate; text-align: center;
    padding: clamp(34px, 6vw, 64px) clamp(18px, 4vw, 40px);
    border-radius: var(--r-xl); border: 1px solid rgba(255,255,255,.14);
    background:
      radial-gradient(720px 320px at 50% 0%, rgba(245,130,31,.2), transparent 70%),
      radial-gradient(520px 260px at 100% 100%, rgba(86,176,255,.14), transparent 70%),
      linear-gradient(160deg, #102a3f, #0a1b2b);
    box-shadow: var(--shadow-lg), inset 0 1px 0 rgba(255,255,255,.1);
  }
  .cta-panel h2 { font-size: clamp(1.7rem, 4.2vw, 2.7rem); font-weight: 850; letter-spacing: -.04em; line-height: 1.06; color: #fff; text-wrap: balance; }
  .cta-panel p { color: var(--text-soft); margin: 14px auto 22px; max-width: 56ch; font-size: .98rem; }
  .manifest-box {
    display: flex; align-items: center; gap: 8px; max-width: 620px; margin: 0 auto 22px; padding: 6px 6px 6px 14px;
    border-radius: var(--r-pill); background: rgba(4,14,24,.6); border: 1px solid var(--line-strong); text-align: left;
  }
  .manifest-box code {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-family: ${MONO_STACK}; font-size: .78rem; color: var(--text-soft);
  }
  .cta-actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
  .cta-note { margin-top: 16px; font-size: .84rem; color: var(--muted); }

  /* Tableta y móvil: el mensaje sobre el fundido del arte (la ficha de un
     título en el iPhone) y el abanico de la marca debajo, más pequeño. */
  @media (max-width: 980px) {
    .hero { padding-top: calc(var(--nav-h) + clamp(40px, 8vh, 84px)); }
    .hero-backdrop::after {
      background:
        linear-gradient(180deg, rgba(6,15,26,.74) 0%, rgba(6,15,26,.42) 30%, rgba(6,15,26,.72) 66%, var(--bg) 96%),
        radial-gradient(70vw 320px at 76% 8%, rgba(245,130,31,.18), transparent 68%);
    }
    .hero-grid { grid-template-columns: 1fr; min-height: 0; gap: clamp(18px, 4vw, 30px); }
    .hero-deck { justify-self: center; max-width: 320px; margin: clamp(4px, 2vw, 14px) auto 0; }
    .bento { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .bento .feature, .bento .f-half { grid-column: span 1; }
    .bento .f-wide { grid-column: span 2; }
    .faq-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 700px) {
    .hero-cta { width: 100%; }
    .hero-cta .btn { flex: 1 1 100%; }
    .hero h1 { max-width: none; font-size: clamp(2.7rem, 12.6vw, 4.15rem); }
    .announce { font-size: .78rem; }
    .hero-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); row-gap: 14px; margin-top: 24px; }
    .hero-stats .stat { padding: 2px 14px; }
    .hero-stats .stat:nth-child(3n+1) { border-left: 0; padding-left: 0; }
    .hero-stats .stat b { font-size: 1.45rem; }
    .trend-tools, .trend-tools .tabs, .trend-tools .search-pill { width: 100%; }
    .trend-tools .tab { flex: 1; justify-content: center; padding: 0 8px; }
    .bento, .steps { grid-template-columns: 1fr; }
    .bento .feature, .bento .f-wide, .bento .f-half { grid-column: auto; }
    .cta-actions .btn { flex: 1 1 100%; }
    .hero-deck { max-width: 250px; }
    .deck-card.front img { width: 68px; height: 68px; border-radius: 18px; }
    .deck-word { font-size: 1rem; }
    .deck-chip { height: 30px; font-size: .72rem; }
    .deck-chip.c1 { left: -2%; top: 10%; }
    .deck-chip.c2 { right: -2%; bottom: 9%; }
  }
  @media (prefers-reduced-motion: reduce) {
    .deck-chip { animation: none; }
  }


  /* ── Piel Apple TV: secciones y panel de instalación ─────────────────────
     Fichas opacas sin borde, píldoras y listas con hairlines. El hero ya
     nace con esta piel (bloque «Hero cinematográfico» de arriba). */
  .bento { gap: 14px; }
  .f-new { background: var(--grad); color: #10283d; border-radius: 980px; letter-spacing: .06em; }
  .mock-chip { background: rgba(255,255,255,.07); border-color: rgba(255,255,255,.1); border-radius: 980px; color: var(--text-soft); }
  .mock-chip .ic { color: var(--brand); }
  .mock-chip.off { background: transparent; border-color: rgba(255,255,255,.14); color: #75879a; }
  .tag { background: rgba(255,255,255,.07); border-color: transparent; border-radius: 980px; color: var(--text-soft); }
  .f-link { color: var(--brand-3); }
  .f-link:hover { color: #fff; }

  .steps { gap: 14px; }
  .step .step-n {
    background: none; -webkit-text-fill-color: currentColor; color: rgba(255,255,255,.34);
    font-family: inherit; font-size: 3.4rem; font-weight: 700; letter-spacing: -.05em; opacity: 1;
  }
  .step:hover .step-n { color: var(--brand); }

  /* Preguntas frecuentes: lista con hairlines, sin cajas y apertura fluida. */
  .faq { gap: 0; }
  .faq details {
    background: none; border: 0; border-bottom: 1px solid rgba(255,255,255,.12); border-radius: 0;
    transition: background .25s var(--ease), border-color .25s var(--ease);
  }
  .faq details:hover { border-bottom-color: rgba(255,255,255,.18); }
  .faq details[open] { background: none; border-color: rgba(255,255,255,.14); }
  .faq summary {
    padding: 20px 0; font-size: 1.02rem; font-weight: 600; letter-spacing: -.015em;
    transition: color .22s var(--ease);
  }
  .faq summary:hover { color: #fff; }
  .faq summary .ic { color: #8fa2b4; transition: transform .32s var(--ease), color .22s var(--ease); }
  .faq details[open] summary .ic { color: #fff; transform: rotate(180deg); }
  .faq details p {
    max-width: 76ch; padding: 0 0 20px; color: #a5b6c6;
    animation: faqSlideIn .34s var(--ease);
  }
  .faq details p a { color: var(--brand-3); }
  @keyframes faqSlideIn {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: none; }
  }

  .tab-panel:not([hidden]) {
    animation: panelFadeIn .36s var(--ease);
  }
  @keyframes panelFadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: none; }
  }

  .step {
    background: linear-gradient(180deg, #10283d 0%, #0c1e30 100%);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 12px 34px rgba(2,10,18,.36);
    transition: transform .4s var(--ease), box-shadow .4s var(--ease), background .3s var(--ease);
  }
  .step:hover {
    transform: translateY(-4px);
    background: linear-gradient(180deg, #16374f 0%, #0f2537 100%);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.11), 0 24px 56px rgba(2,10,18,.58);
  }

  .cta-panel {
    padding: clamp(40px, 7vw, 84px) clamp(18px, 4vw, 40px);
    border-radius: 28px; border-color: transparent;
    background:
      radial-gradient(90% 130% at 50% 0%, #17405f 0%, #0d2438 58%, #0a1b2b 100%);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.1), 0 24px 64px rgba(2,10,18,.55);
  }
  .cta-panel h2 { font-size: clamp(2rem, 5vw, 3.4rem); font-weight: 700; letter-spacing: -.04em; line-height: 1.04; }
  .cta-panel p { margin: 16px auto 26px; color: #a5b6c6; font-size: clamp(1rem, 1.4vw, 1.14rem); line-height: 1.5; }
  .manifest-box {
    background: rgba(3,12,20,.6); border-color: rgba(255,255,255,.12); border-radius: 980px;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.07), 0 8px 24px rgba(2,10,18,.4);
  }
  .manifest-box code { color: var(--text-soft); }
  .manifest-box .btn { border-radius: 980px; }
  .cta-note { color: var(--muted); }
  @media (prefers-reduced-motion: reduce) {
    .faq details p, .tab-panel:not([hidden]) { animation: none; }
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
  <div class="hero-backdrop" aria-hidden="true">
    <img src="/assets/pacific-dusk.jpg" alt="" fetchpriority="high" />
  </div>
  <div class="wrap">
    <div class="hero-grid">
      <div class="hero-copy">
        <a class="announce" href="/configure#filtros"><b>RamdonLatam</b><span>Español latino, región y filtros</span>${icon('arrow-right', 15)}</a>
        <h1>Stremio, <em>a tu manera.</em></h1>
        <p class="lead">Descubre películas y series con <strong>${catalogCount} catálogos</strong> por plataforma y estudio, exclusivamente en español latino. Ajusta región y calidad para encontrar tu próxima historia. <strong>Gratis y sin cuenta.</strong></p>
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

      <!-- La marca, dibujada con CSS: tres fichas abanicadas con la de delante
           al frente. Es la misma forma del logo (assets/brand/logo.svg). -->
      <div class="hero-deck" aria-hidden="true">
        <div class="deck-card back"></div>
        <div class="deck-card mid"></div>
        <div class="deck-card front">
          <img src="/assets/logo.png" alt="" width="96" height="96" />
          <span class="deck-word">Ramdon<i>Latam</i></span>
          <span class="deck-tag">es-MX</span>
        </div>
        <span class="deck-chip c1">${icon('film', 14)} ${catalogCount} catálogos</span>
        <span class="deck-chip c2">${icon('languages', 14)} Español latino</span>
      </div>
    </div>
    <div class="stats hero-stats">
      <span class="stat"><b>${catalogCount}</b><span>catálogos</span></span>
      <span class="stat"><b>${PLATFORMS.length}</b><span>plataformas</span></span>
      <span class="stat"><b>${STUDIOS.length}</b><span>estudios</span></span>
      <span class="stat"><b>es-MX</b><span>español latino</span></span>
      <span class="stat"><b>${FILTERS.length}</b><span>filtros</span></span>
    </div>
  </div>
</header>

<main id="contenido">
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
          <button class="tab active" id="tab-movies" type="button" data-tab="movies" role="tab" aria-selected="true" aria-controls="panel-movies" tabindex="0">${icon('film', 15)} Películas</button>
          <button class="tab" id="tab-series" type="button" data-tab="series" role="tab" aria-selected="false" aria-controls="panel-series" tabindex="-1">${icon('tv', 15)} Series</button>
          <button class="tab" id="tab-anime" type="button" data-tab="anime" role="tab" aria-selected="false" aria-controls="panel-anime" tabindex="-1">${icon('sparkles', 15)} Anime</button>
        </div>
        <form class="search-pill" id="buscar" role="search" onsubmit="return false">
          ${icon('search', 17)}
          <input id="homeSearch" type="search" placeholder="Filtrar esta portada…" autocomplete="off" aria-label="Filtrar los pósters de esta página" />
        </form>
      </div>
    </div>

    <p class="no-results" id="noResults" role="status" aria-live="polite">Nada en esta portada con ese título. <a href="/configure">Instala el addon</a> para buscar en todos los catálogos desde Stremio.</p>

    <div class="tab-panel" id="panel-movies" data-panel="movies" role="tabpanel" aria-labelledby="tab-movies" tabindex="0">
      ${posterRailHtml({ title: 'Películas', accent: 'en tendencia esta semana', items: movies, href: '/configure', media: 'Película' })}
    </div>
    <div class="tab-panel" id="panel-series" data-panel="series" role="tabpanel" aria-labelledby="tab-series" tabindex="0" hidden>
      ${posterRailHtml({ title: 'Series', accent: 'en tendencia esta semana', items: series, href: '/configure', media: 'Serie' })}
    </div>
    <div class="tab-panel" id="panel-anime" data-panel="anime" role="tabpanel" aria-labelledby="tab-anime" tabindex="0" hidden>
      ${posterRailHtml({ title: 'Anime', accent: 'popular', items: anime, href: '/configure', media: 'Anime' })}
    </div>
  </section>

  <section class="wrap section" id="funciones">
    <div class="head-row">
      <div>
        <span class="eyebrow">Funciones</span>
        <h2 class="title">Todo lo que trae <em>RamdonLatam</em></h2>
        <p class="subtitle">Catálogos que se llenan solos, fichas con toda la información y streams que respetan lo que quieres ver.</p>
      </div>
    </div>
    <div class="bento">
      <article class="feature f-wide">
        <div class="fi">${icon('funnel', 21)}</div>
        <h3>Filtros de streams <span class="f-new">Nuevo</span></h3>
        <p>Elige fuentes de reproducción directa con audio latino verificado. Se consultan en paralelo y se eliminan resultados duplicados.</p>
        <div class="mock-chips" aria-hidden="true">${filterChips}</div>
        <a class="f-link" href="/configure#filtros">Elegir mis filtros ${icon('arrow-right', 15)}</a>
      </article>
      <article class="feature">
        <div class="fi">${icon('clapperboard', 21)}</div>
        <h3>${PROVIDERS.length} proveedores de streams</h3>
        <p>Se consultan en paralelo y se quitan los duplicados. Todas las fuentes se filtran para mostrar exclusivamente audio latino verificado, junto con opciones especializadas para anime, películas y series.</p>
        <div class="tag-row">${providerNames.map((name) => `<span class="tag">${escapeHtml(name)}</span>`).join('')}</div>
      </article>
      <article class="feature">
        <div class="fi">${icon('languages', 21)}</div>
        <h3>Español latino</h3>
        <p>Catálogos, fichas y streams exclusivamente en español latino.</p>
        <div class="tag-row" aria-hidden="true"><span class="code">es-MX</span><span class="code">Audio latino</span></div>
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
        <p>El español latino ya viene fijo. Personaliza región, plataformas, estudios y filtros de streams, o instala el addon tal cual.</p>
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
          <p>En Stremio abre Addons, busca RamdonLatam y pulsa «Configurar»: se abre esta web con tu selección cargada. Cambia lo que quieras e instala de nuevo. Para Stremio cada configuración es un addon distinto, así que <strong>desinstala la versión anterior</strong>; si no, verás los catálogos repetidos y sus streams sin filtrar.</p>
        </details>
        <details>
          <summary>¿Por qué un título no muestra streams? ${icon('chevron-down', 18)}</summary>
          <p>Los streams proceden de fuentes externas de reproducción directa. Si no aparece un resultado, puede que las fuentes no tengan disponible ese título o que sus servidores estén temporalmente fuera de servicio.</p>
        </details>
        <details>
          <summary>¿Qué cambian el idioma y la región? ${icon('chevron-down', 18)}</summary>
          <p>Los títulos, sinopsis, pósters y streams se ofrecen exclusivamente en español latino. La región decide qué ofrece cada plataforma en tu país y qué hay en cines (${REGION_OPTIONS.length} países); la interfaz web se adapta al idioma de tu navegador.</p>
        </details>
        <details>
          <summary>¿Es gratis? ¿Aloja contenido? ${icon('chevron-down', 18)}</summary>
          <p>Es gratis y no pide cuenta. RamdonLatam no aloja ni distribuye archivos: organiza catálogos con datos de TMDB y enlaza resultados de buscadores públicos.</p>
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
  function activateTab(tab, moveFocus) {
    tabs.forEach(function (t) {
      var selected = t === tab;
      t.classList.toggle('active', selected);
      t.setAttribute('aria-selected', String(selected));
      t.setAttribute('tabindex', selected ? '0' : '-1');
    });
    activeTab = tab.getAttribute('data-tab');
    // Cambiar de pestaña sale del modo búsqueda.
    input.value = '';
    apply();
    if (moveFocus) tab.focus();
  }
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () { activateTab(tab, false); });
    tab.addEventListener('keydown', function (event) {
      var index = Array.prototype.indexOf.call(tabs, tab);
      var next = -1;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      if (next < 0) return;
      event.preventDefault();
      activateTab(tabs[next], true);
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
