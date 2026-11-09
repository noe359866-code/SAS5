'use strict';

/**
 * Landing (/) — clon del estilo de cinejoy.pk:
 * tema marrón cálido oscuro, marca en pastilla, titular centrado,
 * buscador en pastilla, pestañas Películas/Series/Anime que filtran
 * los rieles, "Explorar por plataforma" y posters con meta
 * "Película • año • ★ nota". Conserva la instalación en Stremio,
 * el giro automático de posters y la auto-rotación de rieles.
 */

const config = require('./config');
const { HERO_BACKDROP, HERO_BACKDROP_SMALL } = require('./staticLogos');
const { STATIC_TRENDING_MOVIES, STATIC_TRENDING_SERIES, STATIC_TRENDING_ANIME } = require('./posterData');
const { RAILS_CSS, RAILS_JS, providerRailHtml, posterRailHtml, escapeHtml } = require('./rails');

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

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Catálogos+ · Addon de Stremio — Películas y series por plataforma y estudio</title>
<meta name="description" content="60 catálogos: tendencias, estrenos, top valoradas, por plataforma (Netflix, Disney+, Max, Hulu, AMC+…) y por estudio (Marvel, Pixar, Ghibli…). Gratis, en español y con región MX/US/ES." />
<link rel="icon" href="/assets/logo.png" type="image/png" />
<style>
  :root { --bg:#16110d; --bg-2:#1e1712; --panel:#241b14; --panel-2:#2c2117; --line:#3a2c1e; --line-2:#54402a; --text:#faf6f1; --muted:#b8a894; --gold:#f5c518; --gold-2:#ffd94a; --accent:#ff6a4d; --accent-2:#ff8a5c; }
  * { box-sizing:border-box; margin:0; padding:0; }
  html { scroll-behavior:smooth; }
  body { font-family:'Segoe UI',system-ui,-apple-system,sans-serif; background:radial-gradient(1200px 600px at 50% -8%, #3d2c1c 0%, var(--bg) 55%); background-color:var(--bg); color:var(--text); min-height:100vh; }
  img { user-select:none; }
${RAILS_CSS}
  .rail-head h2 span { color:var(--accent-2); }
  .rail-head a { color:var(--accent-2); }
  .poster-card .poster { box-shadow:0 10px 26px rgba(0,0,0,.65); }
  .poster-card:hover .poster { box-shadow:0 22px 44px rgba(0,0,0,.75), 0 0 0 1px rgba(255,138,92,.4), 0 0 34px rgba(255,106,77,.22); }
  .poster-title { color:#efe7dc; }
  .poster-meta { color:#a08b74; }
  .poster-meta b { color:var(--gold); }

  /* ── Barra superior (pastillas, estilo Cinejoy) ─────── */
  .nav { position:fixed; top:0; left:0; right:0; z-index:30; display:flex; align-items:center; justify-content:space-between; padding:14px 22px; transition:background .35s ease, box-shadow .35s ease; }
  .nav.scrolled { background:rgba(22,17,13,.82); backdrop-filter:blur(14px) saturate(1.4); box-shadow:0 10px 34px rgba(0,0,0,.55); border-bottom:1px solid rgba(255,255,255,.06); }
  .brand-pill { display:inline-flex; align-items:center; gap:9px; text-decoration:none; background:linear-gradient(120deg, #ffb03a, #ff6a4d); color:#241207; font-weight:900; letter-spacing:.01em; padding:7px 16px 7px 8px; border-radius:999px; box-shadow:0 8px 22px rgba(255,106,77,.35); transition:transform .2s ease; }
  .brand-pill:hover { transform:translateY(-1px) scale(1.02); }
  .brand-pill img { width:26px; height:26px; border-radius:999px; background:#fff; }
  .nav-actions { display:flex; gap:9px; align-items:center; }
  .icon-pill { display:inline-flex; align-items:center; justify-content:center; gap:7px; min-width:40px; height:40px; padding:0 13px; border-radius:999px; background:rgba(255,255,255,.09); border:1px solid rgba(255,255,255,.13); color:#fff; text-decoration:none; font-size:.85rem; font-weight:700; backdrop-filter:blur(6px); transition:all .18s ease; cursor:pointer; }
  .icon-pill:hover { background:rgba(255,255,255,.17); transform:translateY(-1px); }
  .icon-pill.gold { background:var(--gold); border-color:var(--gold); color:#241a02; box-shadow:0 6px 20px rgba(245,197,24,.35); }
  .icon-pill.gold:hover { background:var(--gold-2); }
  @media (max-width:640px){ .icon-pill .lbl { display:none; } .icon-pill { padding:0 10px; } }

  /* ── Hero centrado ──────────────────────────────────── */
  .hero { position:relative; overflow:hidden; text-align:center; padding:128px 22px 30px; }
  .hero-bg { position:absolute; inset:0; background-image:url('${HERO_BACKDROP}'); background-size:cover; background-position:center 16%; opacity:.5; }
  @media (max-width:760px){ .hero-bg { background-image:url('${HERO_BACKDROP_SMALL}'); } }
  .hero::after { content:''; position:absolute; inset:0; background:radial-gradient(720px 340px at 50% 30%, rgba(255,138,92,.14), transparent 70%), linear-gradient(180deg, rgba(22,17,13,.66) 0%, rgba(22,17,13,.35) 45%, var(--bg) 96%); }
  .hero-content { position:relative; z-index:2; max-width:820px; margin:0 auto; }
  .badge { display:inline-flex; align-items:center; gap:8px; background:rgba(0,0,0,.5); border:1px solid rgba(255,176,58,.5); color:#ffb03a; font-size:.7rem; letter-spacing:.16em; text-transform:uppercase; padding:6px 13px; border-radius:999px; backdrop-filter:blur(4px); animation:float-badge 5s ease-in-out infinite; }
  @keyframes float-badge { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-4px); } }
  .hero h1 { font-weight:800; letter-spacing:-.02em; font-size:clamp(2.4rem,6.2vw,4rem); line-height:1.04; margin:20px 0 12px; color:#fff; text-shadow:0 6px 34px rgba(0,0,0,.65); }
  .hero h1 em { font-style:normal; background:linear-gradient(92deg, #ffb03a, #ff6a4d, #ffd94a, #ffb03a); background-size:220% 100%; -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; color:transparent; animation:shine-text 5s linear infinite; }
  @keyframes shine-text { to { background-position:220% 0; } }
  .hero p { color:#e8dccb; font-size:1rem; max-width:58ch; margin:0 auto; line-height:1.55; }

  /* Buscador en pastilla */
  .search-pill { display:flex; align-items:center; gap:10px; max-width:620px; margin:26px auto 6px; background:rgba(30,22,16,.88); border:1px solid rgba(255,255,255,.16); border-radius:999px; padding:7px 8px 7px 20px; box-shadow:0 16px 40px rgba(0,0,0,.5); backdrop-filter:blur(8px); transition:border-color .2s, box-shadow .2s; }
  .search-pill:focus-within { border-color:rgba(255,138,92,.7); box-shadow:0 16px 44px rgba(0,0,0,.55), 0 0 0 4px rgba(255,106,77,.16); }
  .search-pill .s-icon { font-size:1rem; opacity:.75; }
  .search-pill input { flex:1; min-width:0; background:transparent; border:0; outline:0; color:#fff; font-size:.95rem; font-family:inherit; }
  .search-pill input::placeholder { color:#a08b74; }
  .search-pill button { border:0; cursor:pointer; background:linear-gradient(120deg, #ffb03a, #ff6a4d); color:#241207; font-weight:900; font-size:.86rem; padding:11px 20px; border-radius:999px; transition:transform .15s ease, filter .15s; }
  .search-pill button:hover { transform:scale(1.04); filter:brightness(1.06); }
  .search-hint { font-size:.74rem; color:#a08b74; margin-top:8px; }
  .no-results { display:none; text-align:center; color:var(--muted); font-size:.9rem; padding:26px 10px 6px; }

  /* Pestañas Películas / Series / Anime */
  .tabs { display:flex; justify-content:center; gap:6px; margin:30px auto 4px; position:relative; z-index:2; }
  .tab { border:1px solid transparent; background:transparent; color:#cfc2ae; font-family:inherit; font-size:.98rem; font-weight:700; padding:9px 20px; border-radius:999px; cursor:pointer; transition:all .18s ease; }
  .tab:hover { color:#fff; background:rgba(255,255,255,.07); }
  .tab.active { color:#fff; background:linear-gradient(120deg, rgba(255,106,77,.28), rgba(255,176,58,.22)); border-color:rgba(255,138,92,.55); box-shadow:0 8px 22px rgba(255,106,77,.22); }
  .tab-panel[hidden] { display:none; }

  .stats { display:flex; gap:9px; flex-wrap:wrap; justify-content:center; margin-top:20px; }
  .stat { display:flex; align-items:baseline; gap:6px; background:rgba(0,0,0,.42); border:1px solid rgba(255,255,255,.11); padding:6px 13px; border-radius:999px; font-size:.76rem; color:#d9cbb6; }
  .stat b { color:#ffb03a; font-size:.95rem; }
  .live-dot { display:inline-block; width:7px; height:7px; border-radius:99px; background:#22c55e; margin-right:5px; }

  main { max-width:1180px; margin:0 auto; padding:6px 26px 40px; }

  .features { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:14px; margin:38px 0; }
  .feature { background:linear-gradient(160deg, var(--panel-2), var(--panel)); border:1px solid var(--line); border-radius:16px; padding:18px; transition:transform .25s ease, border-color .25s ease, box-shadow .25s ease; }
  .feature:hover { transform:translateY(-5px); border-color:rgba(255,138,92,.5); box-shadow:0 16px 34px rgba(0,0,0,.5), 0 0 24px rgba(255,106,77,.1); }
  .feature .fi { font-size:1.5rem; display:inline-block; transition:transform .3s cubic-bezier(.2,.7,.3,1.5); }
  .feature:hover .fi { transform:scale(1.18) rotate(-6deg); }
  .feature h3 { font-size:.94rem; margin:8px 0 4px; color:#fff; }
  .feature p { font-size:.8rem; color:var(--muted); line-height:1.5; }

  .cta-panel { position:relative; overflow:hidden; border-radius:20px; border:1px solid rgba(255,176,58,.4); background:linear-gradient(120deg, #3a2413 0%, #221812 60%); text-align:center; padding:46px 24px; margin:16px 0 30px; }
  .cta-panel::before { content:''; position:absolute; inset:-60%; background:conic-gradient(from 0deg, transparent 70%, rgba(255,138,92,.16), transparent 82%); animation:cta-spin 7s linear infinite; pointer-events:none; }
  @keyframes cta-spin { to { transform:rotate(360deg); } }
  .cta-panel > * { position:relative; z-index:1; }
  .cta-panel h2 { font-size:1.85rem; font-weight:800; color:#fff; } .cta-panel h2 em { font-style:normal; color:#ffb03a; }
  .cta-panel p { color:#e0d2bd; margin:10px auto 18px; max-width:52ch; font-size:.92rem; }
  .cta-panel code { display:block; max-width:560px; margin:0 auto 16px; font-size:.74rem; color:#9be3ff; background:#120d09; border:1px solid var(--line); padding:9px 12px; border-radius:10px; word-break:break-all; }
  .btn { display:inline-flex; align-items:center; gap:8px; border:0; cursor:pointer; border-radius:999px; font-weight:900; font-size:.95rem; padding:13px 24px; text-decoration:none; transition:transform .18s ease, box-shadow .18s ease, background .18s ease; }
  .btn-gold { background:linear-gradient(120deg, #ffb03a, #ff6a4d); color:#241207; box-shadow:0 8px 24px rgba(255,106,77,.35); }
  .btn-gold:hover { transform:translateY(-2px); filter:brightness(1.05); }

  .page-footer { border-top:1px solid var(--line); padding:22px 28px; color:var(--muted); font-size:.73rem; line-height:1.65; max-width:1180px; margin:0 auto; }
  .page-footer a { color:#e6d9c6; }
</style>
</head>
<body>

<nav class="nav">
  <a class="brand-pill" href="/"><img src="/assets/logo.png" alt="Catálogos+" />Catálogos+</a>
  <div class="nav-actions">
    <a class="icon-pill" href="#buscar" aria-label="Buscar">🔍<span class="lbl">Buscar</span></a>
    <a class="icon-pill" href="/configure">⚙️<span class="lbl">Configurar</span></a>
    <a class="icon-pill gold" href="${escapeHtml(stremioFast)}">🚀<span class="lbl">Instalar</span></a>
  </div>
</nav>

<header class="hero">
  <div class="hero-bg"></div>
  <div class="hero-content">
    <span class="badge">★ Addon de Stremio</span>
    <h1>¿Qué vemos <em>hoy?</em></h1>
    <p>60 catálogos con lo mejor de TMDB: Tendencias, estrenos en cines, top valoradas, anime, y selecciones por <strong>plataforma</strong> (Netflix, Disney+, Max, Hulu, AMC+…) y por <strong>estudio</strong> (Marvel, Pixar, A24, Ghibli…). En español, gratis, sin cuenta.</p>
    <form class="search-pill" id="buscar" onsubmit="return false">
      <span class="s-icon">🔍</span>
      <input id="homeSearch" type="search" placeholder="Películas, series, anime: elige tu plan…" autocomplete="off" />
      <button type="button" id="searchBtn">Buscar</button>
    </form>
    <div class="search-hint">Filtra al instante los posters de esta página · instala el addon para verlo todo en Stremio</div>
    <div class="tabs" role="tablist" aria-label="Tipo de contenido">
      <button class="tab active" type="button" data-tab="movies" role="tab">Películas</button>
      <button class="tab" type="button" data-tab="series" role="tab">Series</button>
      <button class="tab" type="button" data-tab="anime" role="tab">Anime</button>
    </div>
    <div class="stats">
      <span class="stat"><b>60</b> catálogos</span>
      <span class="stat"><b>16</b> plataformas</span>
      <span class="stat"><b>9</b> estudios</span>
      <span class="stat"><b>3</b> proveedores 🧲</span>
      <span class="stat">${live ? '<span class="live-dot"></span>TMDB en vivo' : 'TMDB en vivo al configurar tu clave'}</span>
    </div>
  </div>
</header>

<main>
  <span id="plataformas"></span>
  ${providerRailHtml('/configure#plataformas')}

  <p class="no-results" id="noResults">Sin resultados para tu búsqueda en esta página. <a href="/configure" style="color:#ff8a5c">Instala el addon</a> para buscar en todos los catálogos.</p>

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
    <a class="btn btn-gold" href="${escapeHtml(stremioFast)}" style="font-size:1rem; padding:14px 30px">🚀 Instalar en Stremio</a>
    <div style="margin-top:12px"><a href="/configure" style="color:#ffb03a; font-size:.85rem; text-decoration:none; font-weight:700">⚙️ Prefiero elegir mis plataformas y estudios →</a></div>
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
