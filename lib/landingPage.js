'use strict';

/**
 * Landing page del addon (raíz /). Muestra estado de las APIs,
 * lista de catálogos y botón de instalación en Stremio.
 */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function badge(label, ok) {
  const cls = ok ? 'badge ok' : 'badge off';
  const icon = ok ? '✓' : '✕';
  return `<span class="${cls}">${icon} ${escapeHtml(label)}</span>`;
}

function renderLanding({ manifestUrl, stremioDeepLink, manifest, apiStatus }) {
  const catalogs = manifest.catalogs || [];
  const movies = catalogs.filter((c) => c.type === 'movie');
  const series = catalogs.filter((c) => c.type === 'series');

  const list = (items) =>
    items.map((c) => `<li>${escapeHtml(c.name)}</li>`).join('\n');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(manifest.name)} · Addon de Stremio</title>
<meta name="description" content="${escapeHtml(manifest.description)}" />
<link rel="icon" href="/assets/logo.png" type="image/png" />
<style>
  :root { --bg:#0b0b12; --panel:#14141f; --panel2:#1b1b2a; --text:#f2f2f7; --muted:#9a9ab0; --accent:#7c3aed; --accent2:#a78bfa; --ok:#22c55e; --off:#ef4444; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Segoe UI',system-ui,-apple-system,sans-serif; background:radial-gradient(1200px 700px at 80% -10%, #2a1b4e 0%, transparent 60%), var(--bg); color:var(--text); min-height:100vh; }
  .wrap { max-width:1080px; margin:0 auto; padding:32px 20px 64px; }
  header { display:flex; align-items:center; gap:20px; margin:16px 0 28px; }
  header img { width:96px; height:96px; border-radius:22px; box-shadow:0 8px 30px rgba(124,58,237,.45); }
  h1 { font-size:2.1rem; line-height:1.1; }
  h1 span { color:var(--accent2); }
  .sub { color:var(--muted); margin-top:6px; max-width:640px; }
  .actions { display:flex; gap:12px; flex-wrap:wrap; margin:18px 0 26px; }
  .btn { display:inline-flex; align-items:center; gap:10px; padding:12px 22px; border-radius:12px; border:0; cursor:pointer; font-size:1rem; font-weight:600; text-decoration:none; }
  .btn-primary { background:var(--accent); color:#fff; box-shadow:0 6px 24px rgba(124,58,237,.5); }
  .btn-primary:hover { background:#8b5cf6; }
  .btn-ghost { background:var(--panel2); color:var(--text); }
  .panel { background:var(--panel); border:1px solid #23233a; border-radius:16px; padding:20px 22px; margin-bottom:18px; }
  .panel h2 { font-size:1.05rem; text-transform:uppercase; letter-spacing:.08em; color:var(--accent2); margin-bottom:12px; }
  .badges { display:flex; gap:10px; flex-wrap:wrap; }
  .badge { padding:6px 12px; border-radius:999px; font-size:.85rem; border:1px solid transparent; }
  .badge.ok { color:#052e14; background:#86efac; border-color:#22c55e; }
  .badge.off { color:#450a0a; background:#fca5a5; border-color:#ef4444; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
  @media (max-width:820px){ .grid2 { grid-template-columns:1fr; } header { flex-direction:column; text-align:center; } }
  ul { list-style:none; columns:2; gap:18px; }
  @media (max-width:560px){ ul { columns:1; } }
  li { padding:5px 0; color:#d6d6e4; border-bottom:1px dashed #23233a; font-size:.92rem; break-inside:avoid; }
  code { background:#0f0f1a; padding:2px 8px; border-radius:6px; color:#c4b5fd; font-size:.85em; }
  .hint { color:var(--muted); font-size:.85rem; margin-top:10px; }
  footer { color:var(--muted); font-size:.8rem; text-align:center; margin-top:28px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <img src="/assets/logo.png" alt="${escapeHtml(manifest.name)}" onerror="this.onerror=null;this.src='https://dl.strem.io/bg.jpg'" />
    <div>
      <h1>${escapeHtml(manifest.name)} <span>· Addon de Stremio</span></h1>
      <p class="sub">${escapeHtml(manifest.description)}</p>
    </div>
  </header>

  <div class="actions">
    <a class="btn btn-primary" href="/configure">⚙️ Configurar e instalar</a>
    <a class="btn btn-ghost" href="${escapeHtml(stremioDeepLink)}">⚡ Instalación rápida</a>
    <button class="btn btn-ghost" id="copyBtn" type="button">📋 Copiar URL del manifest</button>
  </div>

  <div class="panel">
    <h2>Estado de las fuentes de datos</h2>
    <div class="badges">
      ${badge('TMDB (catálogos y fichas)', apiStatus.tmdb)}
      ${badge('TVMaze (Series en TV hoy)', true)}
      ${badge('OMDB (IMDB / Rotten Tomatoes / Metacritic)', apiStatus.omdb)}
      ${badge('Watchmode (dónde ver en streaming)', apiStatus.watchmode)}
      ${badge('TVDB (fichas de series y películas)', apiStatus.tvdb)}
    </div>
    <p class="hint">TVMaze funciona sin clave. Si una insignia está en rojo, configura la variable de entorno correspondiente (ver <code>.env.example</code> o README).</p>
  </div>

  <div class="grid2">
    <div class="panel">
      <h2>Catálogos de Películas (${movies.length})</h2>
      <ul>
${list(movies)}
      </ul>
    </div>
    <div class="panel">
      <h2>Catálogos de Series (${series.length})</h2>
      <ul>
${list(series)}
      </ul>
    </div>
  </div>

  <div class="panel">
    <h2>Instalación manual</h2>
    <p>Tu favorito: <strong><a href="/configure" style="color:#a78bfa">configurar idioma, región, plataformas y estudios</a></strong> para generar tu manifest personal. O elige rápido:</p>
    <p>Abre Stremio → <strong>Add-ons</strong> → pega esta URL en el buscador:</p>
    <p style="margin-top:10px"><code id="manifestUrl">${escapeHtml(manifestUrl)}</code></p>
  </div>

  <footer>${escapeHtml(manifest.name)} v${escapeHtml(manifest.version)} · Funciona con TMDB, TVMaze, OMDB y Watchmode · Región de streaming: ${escapeHtml(apiStatus.watchRegion)}</footer>
</div>
<script>
  const url = ${JSON.stringify(manifestUrl)};
  document.getElementById('copyBtn').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); document.getElementById('copyBtn').textContent = '✅ ¡Copiada!'; }
    catch { document.getElementById('copyBtn').textContent = url; }
  });
</script>
</body>
</html>`;
}

module.exports = { renderLanding };
