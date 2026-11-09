'use strict';

/**
 * Landing (/) — estilo streaming (inspirada en cinejoy.pk):
 * nav fija, hero cinematográfico con backdrop, "Explorar por plataforma",
 * rails de tendencias (TMDB en vivo si hay clave; posters estáticos si no),
 * features y CTA de instalación.
 */

const config = require('./config');
const { HERO_BACKDROP, HERO_BACKDROP_SMALL } = require('./staticLogos');
const { STATIC_TRENDING_MOVIES, STATIC_TRENDING_SERIES } = require('./posterData');
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

function renderHome({ origin, host, trendingMovies, trendingSeries, apiStatus }) {
  const movies = movieItems(trendingMovies, STATIC_TRENDING_MOVIES);
  const series = movieItems(trendingSeries, STATIC_TRENDING_SERIES);
  const stremioFast = `stremio://${host}/manifest.json`;
  const live = Boolean(apiStatus && apiStatus.tmdb);

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Catálogos+ · Addon de Stremio — Películas y series por plataforma y estudio</title>
<meta name="description" content="53 catálogos: tendencias, estrenos, top valoradas, por plataforma (Netflix, Disney+, Max, Hulu, AMC+…) y por estudio (Marvel, Pixar, Ghibli…). Gratis, en español y con región MX/US/ES." />
<link rel="icon" href="/assets/logo.png" type="image/png" />
<style>
  :root { --bg:#0d0f17; --panel:#151824; --panel-2:#1b1f2e; --line:#262b3f; --text:#f5f6fa; --muted:#9aa0b8; --gold:#f5c518; --gold-2:#ffd94a; }
  * { box-sizing:border-box; margin:0; padding:0; }
  html { scroll-behavior:smooth; }
  body { font-family:'Segoe UI',system-ui,-apple-system,sans-serif; background:var(--bg); color:var(--text); }
  img { user-select:none; }
${RAILS_CSS}
  .nav { position:fixed; top:0; left:0; right:0; z-index:30; display:flex; align-items:center; justify-content:space-between; padding:14px 28px; background:linear-gradient(180deg, rgba(13,15,23,.92), rgba(13,15,23,0)); transition:background .35s ease, box-shadow .35s ease, backdrop-filter .35s ease; }
  .nav.scrolled { background:rgba(13,15,23,.78); backdrop-filter:blur(14px) saturate(1.4); box-shadow:0 10px 34px rgba(0,0,0,.5); border-bottom:1px solid rgba(255,255,255,.07); }
  .nav-brand img { transition:transform .5s cubic-bezier(.2,.7,.3,1.4); }
  .nav-brand:hover img { transform:rotate(-8deg) scale(1.1); }
  .nav-brand { display:flex; align-items:center; gap:12px; text-decoration:none; }
  .nav-brand img { width:40px; height:40px; border-radius:10px; }
  .nav-brand b { font-size:1.15rem; color:#fff; } .nav-brand b i { color:var(--gold); font-style:normal; }
  .nav-links { display:flex; gap:22px; align-items:center; }
  .nav-links a { color:#cfd3e6; text-decoration:none; font-size:.88rem; }
  .nav-links a:hover { color:#fff; }
  .btn { display:inline-flex; align-items:center; gap:8px; border:0; cursor:pointer; border-radius:8px; font-weight:800; font-size:.92rem; padding:12px 20px; text-decoration:none; }
  .btn-gold { background:var(--gold); color:#141414; } .btn-gold:hover { background:var(--gold-2); }
  .btn-ghost { background:rgba(255,255,255,.14); color:#fff; backdrop-filter:blur(4px); } .btn-ghost:hover { background:rgba(255,255,255,.22); }
  @media (max-width:760px){ .nav-links { display:none; } .nav { padding:12px 16px; } }

  .hero { position:relative; min-height:82vh; display:flex; align-items:flex-end; overflow:hidden; }
  .hero-bg { position:absolute; inset:0; background-image:url('${HERO_BACKDROP}'); background-size:cover; background-position:center 15%; }
  @media (max-width:760px){ .hero-bg { background-image:url('${HERO_BACKDROP_SMALL}'); } }
  .hero::after { content:''; position:absolute; inset:0; background:linear-gradient(90deg, rgba(13,15,23,.97) 0%, rgba(13,15,23,.74) 40%, rgba(13,15,23,.05) 75%), linear-gradient(0deg, var(--bg) 2%, rgba(13,15,23,.2) 45%, rgba(13,15,23,.6) 100%); }
  .hero-content { position:relative; z-index:2; padding:0 28px 54px; max-width:760px; }
  .badge { display:inline-flex; align-items:center; gap:8px; background:rgba(0,0,0,.55); border:1px solid rgba(245,197,24,.5); color:var(--gold); font-size:.72rem; letter-spacing:.16em; text-transform:uppercase; padding:6px 12px; border-radius:6px; }
  .hero h1 { font-family:Georgia,'Times New Roman',serif; font-weight:700; font-size:clamp(2.5rem,6.4vw,4.1rem); line-height:1.02; margin:18px 0 14px; color:#fff; text-shadow:0 4px 30px rgba(0,0,0,.6); }
  .hero h1 em { font-style:italic; background:linear-gradient(92deg, #f5c518, #ffe98a, #f59e0b, #f5c518); background-size:220% 100%; -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; color:transparent; animation:shine-text 5s linear infinite; }
  @keyframes shine-text { to { background-position:220% 0; } }
  .badge { animation:float-badge 5s ease-in-out infinite; }
  @keyframes float-badge { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-4px); } }
  .btn { transition:transform .18s ease, box-shadow .18s ease, background .18s ease; }
  .btn-gold { box-shadow:0 6px 22px rgba(245,197,24,.32); }
  .btn-gold:hover, .btn-ghost:hover { transform:translateY(-2px); }
  .btn-gold:active { transform:translateY(0) scale(.98); }
  .hero p { color:#d8dbea; font-size:1.03rem; max-width:56ch; line-height:1.55; }
  .hero-ctas { display:flex; gap:12px; margin:24px 0 18px; flex-wrap:wrap; }
  .stats { display:flex; gap:10px; flex-wrap:wrap; }
  .stat { display:flex; align-items:baseline; gap:6px; background:rgba(0,0,0,.45); border:1px solid rgba(255,255,255,.12); padding:6px 12px; border-radius:8px; font-size:.78rem; color:#c9cddf; }
  .stat b { color:var(--gold); font-size:.98rem; }
  .live-dot { display:inline-block; width:7px; height:7px; border-radius:99px; background:#22c55e; margin-right:5px; }

  main { max-width:1180px; margin:0 auto; padding:8px 26px 40px; }

  .features { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:14px; margin:36px 0; }
  .feature { background:linear-gradient(160deg, var(--panel-2), var(--panel)); border:1px solid var(--line); border-radius:14px; padding:18px; transition:transform .25s ease, border-color .25s ease, box-shadow .25s ease; }
  .feature:hover { transform:translateY(-5px); border-color:rgba(245,197,24,.45); box-shadow:0 16px 34px rgba(0,0,0,.5), 0 0 24px rgba(245,197,24,.08); }
  .feature:hover .fi { transform:scale(1.18) rotate(-6deg); }
  .feature .fi { transition:transform .3s cubic-bezier(.2,.7,.3,1.5); display:inline-block; }
  .cta-panel::before { content:''; position:absolute; inset:-60%; background:conic-gradient(from 0deg, transparent 70%, rgba(245,197,24,.14), transparent 82%); animation:cta-spin 7s linear infinite; pointer-events:none; }
  @keyframes cta-spin { to { transform:rotate(360deg); } }
  .cta-panel > * { position:relative; z-index:1; }
  .feature .fi { font-size:1.5rem; }
  .feature h3 { font-size:.94rem; margin:8px 0 4px; color:#fff; }
  .feature p { font-size:.8rem; color:var(--muted); line-height:1.5; }

  .cta-panel { position:relative; overflow:hidden; border-radius:18px; border:1px solid rgba(245,197,24,.35); background:linear-gradient(120deg, #2a2410 0%, #171a28 60%); text-align:center; padding:44px 24px; margin:14px 0 30px; }
  .cta-panel h2 { font-family:Georgia,serif; font-size:1.8rem; color:#fff; } .cta-panel h2 em { color:var(--gold); }
  .cta-panel p { color:#c9cddf; margin:10px auto 18px; max-width:52ch; font-size:.92rem; }
  .cta-panel code { display:block; max-width:560px; margin:0 auto 16px; font-size:.74rem; color:#9be3ff; background:#0a0c12; border:1px solid var(--line); padding:9px 12px; border-radius:8px; word-break:break-all; }

  .page-footer { border-top:1px solid var(--line); padding:22px 28px; color:var(--muted); font-size:.73rem; line-height:1.65; max-width:1180px; margin:0 auto; }
  .page-footer a { color:#c9cddf; }
</style>
</head>
<body>

<nav class="nav">
  <a class="nav-brand" href="/"><img src="/assets/logo.png" alt="Catálogos+" /><b>Catá<i>logos+</i></b></a>
  <div class="nav-links">
    <a href="#plataformas">Plataformas</a>
    <a href="#tendencias">Tendencias</a>
    <a href="/configure">Configurar</a>
    <a class="btn btn-gold" href="${escapeHtml(stremioFast)}" style="padding:9px 16px">🚀 Instalar</a>
  </div>
</nav>

<header class="hero">
  <div class="hero-bg"></div>
  <div class="hero-content">
    <span class="badge">★ Addon para Stremio</span>
    <h1>Todo el cine y las series, <em>en un solo addon.</em></h1>
    <p>53 catálogos con lo mejor de TMDB: tendencias, estrenos en cines, top valoradas, anime, y selecciones por <strong>plataforma</strong> (Netflix, Disney+, Max, Hulu, AMC+…) y por <strong>estudio</strong> (Marvel, Pixar, A24, Ghibli…). En español, gratis, sin cuenta.</p>
    <div class="hero-ctas">
      <a class="btn btn-gold" href="${escapeHtml(stremioFast)}">🚀 Instalar en Stremio</a>
      <a class="btn btn-ghost" href="/configure">⚙️ Configurar mi selección</a>
    </div>
    <div class="stats">
      <span class="stat"><b>53</b> catálogos</span>
      <span class="stat"><b>16</b> plataformas</span>
      <span class="stat"><b>9</b> estudios</span>
      <span class="stat"><b>16</b> regiones</span>
      <span class="stat">${live ? '<span class="live-dot"></span>TMDB en vivo' : 'TMDB en vivo al configurar tu clave'}</span>
    </div>
  </div>
</header>

<main>
  <span id="plataformas"></span>
  ${providerRailHtml('/configure#plataformas')}

  <span id="tendencias"></span>
  ${posterRailHtml({ title: 'Tendencias', accent: 'películas esta semana', items: movies, href: '/configure' })}
  ${posterRailHtml({ title: 'Tendencias', accent: 'series esta semana', items: series, href: '/configure' })}

  <section class="features">
    <div class="feature"><div class="fi">🎬</div><h3>Catálogos que sí funcionan</h3><p>Tendencias, populares, top valoradas, estrenos, próximos estrenos, anime y series en emisión — más cada plataforma y estudio.</p></div>
    <div class="feature"><div class="fi">📺</div><h3>Dónde verlo ahora</h3><p>Fichas con disponibilidad real: "Disponible en Netflix · Max · Hulu…" vía Watchmode según tu región.</p></div>
    <div class="feature"><div class="fi">⭐</div><h3>Ratings completos</h3><p>IMDb, Rotten Tomatoes y Metacritic en cada ficha (OMDB) además de la puntuación TMDB.</p></div>
    <div class="feature"><div class="fi">🌐</div><h3>Tu idioma, tu región</h3><p>Fichas en es/es-MX/en/pt-BR… y región JustWatch (MX, US, ES, AR + 12 más) con respaldo automático MX→US.</p></div>
    <div class="feature"><div class="fi">🤝</div><h3>Datos de 5 fuentes</h3><p>TMDB · TVMaze (sin clave) · TheTVDB · OMDB · Watchmode. Si una falla, las demás tapan el hueco.</p></div>
    <div class="feature"><div class="fi">💸</div><h3>Gratis y sin cuenta</h3><p>Sin registro, sin scraping, sin suscripciones. Instala con un clic y listo.</p></div>
  </section>

  <div class="cta-panel">
    <h2>¿Listo para <em>instalarlo?</em></h2>
    <p>Pega esta URL en Stremio → Add-ons (o entra a Configurador y monta tu selección personal en 30 segundos):</p>
    <code>${escapeHtml(`${origin}/manifest.json`)}</code>
    <a class="btn btn-gold" href="${escapeHtml(stremioFast)}" style="font-size:1rem; padding:14px 30px">🚀 Instalar en Stremio</a>
    <div style="margin-top:12px"><a href="/configure" style="color:#f5c518; font-size:.85rem; text-decoration:none; font-weight:700">⚙️ Prefiero elegir mis plataformas y estudios →</a></div>
  </div>
</main>

<footer class="page-footer">
  Catálogos+ · Datos cortesía de <a href="https://www.themoviedb.org/">TMDB</a>, JustWatch, <a href="https://www.tvmaze.com/">TVMaze</a>, <a href="https://www.themoviedb.org/">OMDB</a>, TheTVDB y Watchmode. Este producto usa la API de TMDB pero no está respaldado ni certificado por TMDB. Los logos son propiedad de sus respectivos servicios. No aloja ni distribuye contenido; solo organiza catálogos.
</footer>

<script>${RAILS_JS}</script>
</body>
</html>`;
}

module.exports = { renderHome };
