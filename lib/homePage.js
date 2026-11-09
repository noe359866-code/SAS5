'use strict';

/**
 * Landing (/) — portada del addon.
 *
 * Diseño: hero centrado con degradado de marca, buscador en pastilla que
 * filtra los posters al instante, control segmentado Películas/Series/Anime,
 * rail de plataformas, features y CTA de instalación. Todo el estilo viene
 * del sistema de diseño compartido (lib/theme.js + lib/rails.js).
 */

const config = require('./config');
const { HERO_BACKDROP, HERO_BACKDROP_SMALL } = require('./staticLogos');
const { PLATFORMS, STUDIOS, buildDefs } = require('./catalogs');
const { STATIC_TRENDING_MOVIES, STATIC_TRENDING_SERIES, STATIC_TRENDING_ANIME } = require('./posterData');
const { RAILS_CSS, RAILS_JS, providerRailHtml, posterRailHtml, escapeHtml } = require('./rails');
const { THEME_CSS, MONO_STACK } = require('./theme');

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

function renderHome({ origin, host, trendingMovies, trendingSeries, trendingAnime, apiStatus }) {
  const movies = movieItems(trendingMovies, STATIC_TRENDING_MOVIES);
  const series = movieItems(trendingSeries, STATIC_TRENDING_SERIES);
  const anime = movieItems(trendingAnime, STATIC_TRENDING_ANIME);
  const stremioFast = `stremio://${host}/manifest.json`;
  const live = Boolean(apiStatus && apiStatus.tmdb);
  // Contadores reales (antes eran números fijos que se quedaban obsoletos).
  const catalogCount = buildDefs(null).length;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Catálogos+ · Addon de Stremio — Películas y series por plataforma y estudio</title>
<meta name="description" content="${catalogCount} catálogos: tendencias, estrenos, top valoradas, por plataforma (Netflix, Disney+, Max, Hulu, AMC+…) y por estudio (Marvel, Pixar, Ghibli…). Gratis, en español y con región MX/US/ES." />
<meta name="theme-color" content="#07080d" />
<link rel="icon" href="/assets/logo.png" type="image/png" />
<style>
${THEME_CSS}
${RAILS_CSS}

  /* ── Portada ───────────────────────────────────────────────────────────── */
  .hero { padding: clamp(64px, 11vw, 120px) clamp(18px, 4vw, 32px) 26px; text-align: center; }
  .hero-bg { background-image: url('${HERO_BACKDROP}'); }
  @media (max-width: 760px) { .hero-bg { background-image: url('${HERO_BACKDROP_SMALL}'); } }
  .hero-inner { max-width: 880px; margin: 0 auto; display: flex; flex-direction: column; align-items: center; gap: 18px; }
  .hero h1 { margin: 2px 0 0; }
  .hero .lead { margin: 0 auto; }
  .search-pill { width: 100%; margin-top: 4px; }
  .hero .tabs { margin-top: 6px; }

  main { max-width: 1220px; margin: 0 auto; padding: 8px clamp(16px, 4vw, 32px) 20px; }

  .features {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(255px, 1fr));
    gap: 14px; margin: 42px 0 10px;
  }

  /* ── Panel de instalación ──────────────────────────────────────────────── */
  .cta-panel {
    position: relative; overflow: hidden; isolation: isolate;
    margin: 44px 0 26px; padding: clamp(32px, 6vw, 56px) clamp(20px, 4vw, 40px);
    border-radius: var(--r-xl); border: 1px solid rgba(124,92,255,.34);
    background:
      radial-gradient(680px 280px at 50% 0%, rgba(124,92,255,.26), transparent 70%),
      linear-gradient(160deg, rgba(20,22,34,.96), rgba(9,10,16,.96));
    text-align: center; box-shadow: var(--shadow-lg);
  }
  .cta-panel::before {
    content: ''; position: absolute; inset: -1px; z-index: -1; border-radius: inherit;
    background: linear-gradient(135deg, rgba(124,92,255,.5), transparent 42%, rgba(34,211,238,.35));
    opacity: .35; filter: blur(26px);
  }
  .cta-panel h2 { font-size: clamp(1.5rem, 3.6vw, 2.1rem); font-weight: 800; letter-spacing: -.03em; color: #fff; }
  .cta-panel h2 em {
    font-style: normal;
    background: var(--grad); -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent; color: transparent;
  }
  .cta-panel p { color: var(--text-soft); margin: 12px auto 20px; max-width: 54ch; font-size: .95rem; }
  .cta-panel code {
    display: block; max-width: 600px; margin: 0 auto 20px;
    font-family: ${MONO_STACK};
    font-size: .76rem; color: #9fe8ff; background: rgba(6,7,12,.72);
    border: 1px solid var(--line-strong); padding: 11px 14px; border-radius: var(--r-md);
    word-break: break-all;
  }
  .cta-panel .cta-actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
  .cta-note { margin-top: 14px; font-size: .84rem; }
  .cta-note a { color: var(--text-soft); text-decoration: none; border-bottom: 1px solid rgba(255,255,255,.2); }
  .cta-note a:hover { color: #fff; border-bottom-color: var(--brand-3); }
  .no-results a { color: var(--brand-3); }
</style>
</head>
<body>

<div class="page-glow" aria-hidden="true"></div>
<div class="page-grid" aria-hidden="true"></div>

<nav class="nav">
  <a class="brand" href="/"><img src="/assets/logo.png" alt="Catálogos+" /><span>Catálogos<i>+</i></span></a>
  <div class="nav-actions">
    <a class="icon-btn" href="#buscar" aria-label="Buscar"><span aria-hidden="true">🔍</span><span class="lbl">Buscar</span></a>
    <a class="icon-btn" href="/configure"><span aria-hidden="true">⚙️</span><span class="lbl">Configurar</span></a>
    <a class="icon-btn gold" href="${escapeHtml(stremioFast)}"><span aria-hidden="true">↧</span><span class="lbl">Instalar</span></a>
  </div>
</nav>

<header class="hero">
  <div class="hero-bg"></div>
  <div class="hero-veil"></div>
  <div class="hero-content hero-inner">
    <span class="badge"><span class="dot"></span> Addon de Stremio</span>
    <h1>¿Qué vemos <em>hoy?</em></h1>
    <p class="lead">${catalogCount} catálogos con lo mejor de TMDB: Tendencias, estrenos en cines, top valoradas, anime, y selecciones por <strong>plataforma</strong> (Netflix, Disney+, Max, Hulu, AMC+…) y por <strong>estudio</strong> (Marvel, Pixar, A24, Ghibli…). En español, gratis, sin cuenta.</p>
    <form class="search-pill" id="buscar" onsubmit="return false">
      <span class="s-icon" aria-hidden="true">🔍</span>
      <input id="homeSearch" type="search" placeholder="Películas, series, anime: elige tu plan…" autocomplete="off" aria-label="Buscar en la portada" />
      <button type="button" id="searchBtn">Buscar</button>
    </form>
    <div class="search-hint">Filtra al instante los posters de esta página · instala el addon para verlo todo en Stremio</div>
    <div class="tabs" role="tablist" aria-label="Tipo de contenido">
      <button class="tab active" type="button" data-tab="movies" role="tab">Películas</button>
      <button class="tab" type="button" data-tab="series" role="tab">Series</button>
      <button class="tab" type="button" data-tab="anime" role="tab">Anime</button>
    </div>
    <div class="stats">
      <span class="stat"><b>${catalogCount}</b> catálogos</span>
      <span class="stat"><b>${PLATFORMS.length}</b> plataformas</span>
      <span class="stat"><b>${STUDIOS.length}</b> estudios</span>
      <span class="stat"><b>3</b> proveedores de streams</span>
      <span class="stat">${live ? '<span class="live-dot"></span>TMDB en vivo' : 'TMDB en vivo al configurar tu clave'}</span>
    </div>
  </div>
</header>

<main>
  <span id="plataformas"></span>
  ${providerRailHtml('/configure#plataformas')}

  <p class="no-results" id="noResults">Sin resultados para tu búsqueda en esta página. <a href="/configure">Instala el addon</a> para buscar en todos los catálogos.</p>

  <div class="tab-panel" data-panel="movies">
    ${posterRailHtml({ title: 'Tendencias', accent: 'películas esta semana', items: movies, href: '/configure', media: 'Película' })}
  </div>
  <div class="tab-panel" data-panel="series" hidden>
    ${posterRailHtml({ title: 'Tendencias', accent: 'series esta semana', items: series, href: '/configure', media: 'Serie' })}
  </div>
  <div class="tab-panel" data-panel="anime" hidden>
    ${posterRailHtml({ title: 'Tendencias', accent: 'anime popular', items: anime, href: '/configure', media: 'Anime' })}
  </div>

  <section class="features">
    <div class="feature"><div class="fi">🎬</div><h3>Catálogos que sí funcionan</h3><p>Tendencias, populares, top valoradas, estrenos, próximos estrenos, anime y series en emisión — más cada plataforma y estudio.</p></div>
    <div class="feature"><div class="fi">🧲</div><h3>Streams al instante</h3><p>Al abrir una película o episodio, streams torrent de Knaben, Torlock y BlackHoleBay ordenados por seeders.</p></div>
    <div class="feature"><div class="fi">⭐</div><h3>Ratings completos</h3><p>IMDb, Rotten Tomatoes y Metacritic en cada ficha (OMDB) además de la puntuación TMDB.</p></div>
    <div class="feature"><div class="fi">📺</div><h3>Dónde verlo ahora</h3><p>Fichas con disponibilidad real: "Disponible en Netflix · Max · Hulu…" vía Watchmode según tu región.</p></div>
    <div class="feature"><div class="fi">🌐</div><h3>Tu idioma, tu región</h3><p>Fichas en es/es-MX/en/pt-BR… y región JustWatch (MX, US, ES, AR + 12 más) con respaldo automático MX→US.</p></div>
    <div class="feature"><div class="fi">💸</div><h3>Gratis y sin cuenta</h3><p>Sin registro, sin suscripciones. Instala con un clic y listo.</p></div>
  </section>

  <div class="cta-panel">
    <h2>¿Listo para <em>instalarlo?</em></h2>
    <p>Pega esta URL en Stremio → Add-ons (o entra al Configurador y monta tu selección personal en 30 segundos):</p>
    <code>${escapeHtml(`${origin}/manifest.json`)}</code>
    <div class="cta-actions">
      <a class="btn btn-primary" href="${escapeHtml(stremioFast)}">↧ Instalar en Stremio</a>
      <a class="btn btn-ghost" href="/configure">⚙️ Elegir plataformas y estudios</a>
    </div>
    <div class="cta-note">Sin clave, sin registro y funcionando en Stremio Web, Desktop, Android, iOS y TV.</div>
  </div>
</main>

<footer class="page-footer">
  Catálogos+ · Datos cortesía de <a href="https://www.themoviedb.org/">TMDB</a>, JustWatch, <a href="https://www.tvmaze.com/">TVMaze</a>, OMDB, TheTVDB y Watchmode. Este producto usa la API de TMDB pero no está respaldado ni certificado por TMDB. Los logos son propiedad de sus respectivos servicios. No aloja ni distribuye contenido; solo organiza catálogos y enlaza fuentes públicas.
</footer>

<script>${RAILS_JS}</script>
<script>
(function () {
  var tabs = document.querySelectorAll('.tab');
  var panels = document.querySelectorAll('.tab-panel');
  var input = document.getElementById('homeSearch');
  var noResults = document.getElementById('noResults');
  var activeTab = 'movies';

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function applyPanels() {
    var q = norm(input.value).trim();
    panels.forEach(function (panel) {
      panel.hidden = q ? false : panel.getAttribute('data-panel') !== activeTab;
    });
  }
  function applySearch() {
    var q = norm(input.value).trim();
    var visible = 0;
    document.querySelectorAll('.poster-card').forEach(function (card) {
      var hit = !q || norm(card.getAttribute('data-title')).indexOf(q) !== -1;
      card.style.display = hit ? '' : 'none';
      if (hit) visible++;
    });
    noResults.style.display = q && visible === 0 ? 'block' : 'none';
    applyPanels();
  }
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      activeTab = tab.getAttribute('data-tab');
      applyPanels();
      var panel = document.querySelector('[data-panel="' + activeTab + '"]');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });
  if (input) {
    input.addEventListener('input', applySearch);
    document.getElementById('searchBtn').addEventListener('click', function () {
      applySearch();
      var first = document.querySelector('.poster-card:not([style*="none"])');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
})();
</script>
</body>
</html>`;
}

module.exports = { renderHome };
