'use strict';

/**
 * Página de configuración (/configure) — estilo oscuro del addon.
 * El usuario elige idioma, región, plataformas, estudios y catálogos base;
 * la página genera la URL personal `/<base64url>/manifest.json` para instalar.
 */

const { LANG_OPTIONS, REGION_OPTIONS, BASE_OPTIONS } = require('./userConfig');
const { PLATFORMS, STUDIOS } = require('./catalogs');
const config = require('./config');

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pill(name, value, label, checked, extra = '') {
  return `<button type="button" class="pill" data-group="${name}" data-value="${escapeHtml(value)}" aria-pressed="${checked}">${label}</button>`;
}

function card(group, key, name) {
  return `
  <label class="card" data-group="${group}" data-key="${escapeHtml(key)}">
    <input type="checkbox" checked data-group="${group}" data-key="${escapeHtml(key)}" />
    <span class="brand">
      <span class="letter">${escapeHtml(name.charAt(0).toUpperCase())}</span>
      <img alt="${escapeHtml(name)}" loading="lazy" data-logo-for="${escapeHtml(key)}" data-logo-group="${group}" />
    </span>
    <span class="name">${escapeHtml(name)}</span>
    <span class="check">✓</span>
  </label>`;
}

function renderConfigure({ origin, host }) {
  const langPills = LANG_OPTIONS.map((o, i) => pill('lang', o.code, escapeHtml(o.label), i === 0)).join('\n');
  const regionPills = REGION_OPTIONS.map((o) =>
    pill('region', o.code, `${o.flag} ${escapeHtml(o.label)}`, o.code === (config.watchRegion || 'NI'))
  ).join('\n');
  const baseCards = BASE_OPTIONS.map((o) =>
    `<label class="chip"><input type="checkbox" checked data-group="base" data-key="${escapeHtml(o.key)}" /><span>${escapeHtml(o.label)}</span></label>`
  ).join('\n');
  const platformCards = PLATFORMS.map((p) => card('platforms', p.key, p.name)).join('\n');
  const studioCards = STUDIOS.map((s) => card('studios', s.key, s.name)).join('\n');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Configurar ${escapeHtml(config.addonName)} · Addon de Stremio</title>
<meta name="description" content="Elige idioma, región, plataformas y estudios para tu manifest personal de Stremio." />
<link rel="icon" href="/assets/logo.png" type="image/png" />
<style>
  :root { --bg:#0b0b12; --panel:#14141f; --panel2:#1b1b2a; --line:#23233a; --text:#f2f2f7; --muted:#9a9ab0; --accent:#7c3aed; --accent2:#a78bfa; --ok:#22c55e; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Segoe UI',system-ui,-apple-system,sans-serif; background:radial-gradient(1200px 700px at 80% -10%, #2a1b4e 0%, transparent 60%), var(--bg); color:var(--text); }
  .wrap { max-width:1060px; margin:0 auto; padding:26px 20px 140px; }
  header { display:flex; align-items:center; gap:16px; margin:10px 0 22px; }
  header img { width:72px; height:72px; border-radius:18px; box-shadow:0 6px 22px rgba(124,58,237,.45); }
  h1 { font-size:1.6rem; } h1 span { color:var(--accent2); }
  .sub { color:var(--muted); font-size:.9rem; margin-top:4px; }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:18px 20px; margin-bottom:16px; }
  .panel h2 { font-size:.78rem; text-transform:uppercase; letter-spacing:.09em; color:var(--accent2); margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; }
  .hint { color:var(--muted); font-size:.8rem; margin-top:8px; }
  .pills { display:flex; gap:8px; flex-wrap:wrap; }
  .pill { background:var(--panel2); border:1px solid var(--line); color:var(--text); padding:8px 14px; border-radius:999px; cursor:pointer; font-size:.88rem; transition:all .15s; }
  .pill[aria-pressed="true"] { background:var(--accent); border-color:var(--accent); box-shadow:0 4px 16px rgba(124,58,237,.45); }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(118px,1fr)); gap:10px; }
  .card { position:relative; display:flex; flex-direction:column; align-items:center; gap:8px; background:var(--panel2); border:1px solid var(--line); border-radius:14px; padding:14px 8px 12px; cursor:pointer; transition:all .15s; user-select:none; }
  .card:hover { border-color:#37375a; transform:translateY(-1px); }
  .card input { position:absolute; opacity:0; pointer-events:none; }
  .brand { position:relative; width:72px; height:72px; border-radius:16px; background:#23233a; display:flex; align-items:center; justify-content:center; overflow:hidden; }
  .letter { font-size:1.6rem; font-weight:800; color:#6d6d92; }
  .brand img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; background:#fff; }
  .name { font-size:.78rem; text-align:center; color:#d6d6e4; min-height:2.2em; display:flex; align-items:center; }
  .check { position:absolute; top:8px; right:8px; width:22px; height:22px; border-radius:999px; background:var(--ok); color:#052e14; font-size:.75rem; display:none; align-items:center; justify-content:center; font-weight:800; }
  .card input:checked ~ .check { display:flex; }
  .card:has(input:checked) { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent), 0 4px 18px rgba(124,58,237,.35); }
  .toggles { display:flex; gap:8px; }
  .mini { background:var(--panel2); border:1px solid var(--line); color:var(--muted); border-radius:8px; padding:4px 10px; font-size:.72rem; cursor:pointer; text-transform:none; letter-spacing:0; }
  .mini:hover { color:var(--text); border-color:#37375a; }
  .chips { display:flex; gap:10px; flex-wrap:wrap; }
  .chip { display:flex; align-items:center; gap:8px; background:var(--panel2); border:1px solid var(--line); padding:9px 14px; border-radius:12px; cursor:pointer; }
  .chip input { accent-color:var(--accent); width:16px; height:16px; }
  .footer { position:fixed; left:0; right:0; bottom:0; background:rgba(11,11,18,.92); backdrop-filter:blur(10px); border-top:1px solid var(--line); padding:12px 20px; z-index:10; }
  .footer-inner { max-width:1060px; margin:0 auto; display:flex; align-items:center; gap:14px; flex-wrap:wrap; justify-content:space-between; }
  .count { color:var(--muted); font-size:.85rem; } .count strong { color:var(--text); }
  .btn { display:inline-flex; align-items:center; gap:8px; padding:11px 20px; border-radius:12px; border:0; cursor:pointer; font-weight:700; text-decoration:none; font-size:.92rem; }
  .btn-primary { background:var(--accent); color:#fff; box-shadow:0 6px 22px rgba(124,58,237,.5); }
  .btn-ghost { background:var(--panel2); color:var(--text); }
  code { background:#0f0f1a; padding:2px 8px; border-radius:6px; color:#c4b5fd; font-size:.8em; word-break:break-all; }
  .personal { margin-top:14px; }
  .personal code { display:block; padding:10px 12px; border:1px solid var(--line); border-radius:10px; margin:8px 0; }
  @media (max-width:640px){ .grid { grid-template-columns:repeat(auto-fill,minmax(96px,1fr)); } header{flex-direction:column;text-align:center} }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <img src="/assets/logo.png" alt="logo" />
    <div>
      <h1>Configura ${escapeHtml(config.addonName)} <span>para Stremio</span></h1>
      <p class="sub">Elige idioma, región, plataformas y estudios. Tu selección genera un manifest personal — se instala solo a ti, nadie más.</p>
    </div>
  </header>

  <div class="panel">
    <h2>🌐 Idioma de los catálogos</h2>
    <div class="pills" id="langGroup">${langPills}</div>
    <p class="hint">Idioma de títulos, sinopsis y fichas (parámetro <code>language</code> de TMDB).</p>
  </div>

  <div class="panel">
    <h2>🌎 Región de plataformas (JustWatch)</h2>
    <div class="pills" id="regionGroup">${regionPills}</div>
    <p class="hint">Define qué catálogos de plataformas ves (disponibilidad real por país). La cobertura JustWatch es menor en Nicaragua: MX/US tienen mucho más contenido.</p>
  </div>

  <div class="panel">
    <h2>📺 Plataformas <span class="toggles"><button class="mini" data-toggle="platforms:all" type="button">Todas</button><button class="mini" data-toggle="platforms:none" type="button">Ninguna</button></span></h2>
    <div class="grid" id="platformGrid">${platformCards}</div>
    <p class="hint">Películas y series disponibles en cada plataforma: Netflix, Prime Video, Disney+, Max, Apple TV+, Paramount+, Star+, Crunchyroll, Hulu, AMC+, MUBI, Tubi, Pluto TV y Peacock.</p>
  </div>

  <div class="panel">
    <h2>🎬 Estudios (películas) <span class="toggles"><button class="mini" data-toggle="studios:all" type="button">Todos</button><button class="mini" data-toggle="studios:none" type="button">Ninguno</button></span></h2>
    <div class="grid" id="studioGrid">${studioCards}</div>
  </div>

  <div class="panel">
    <h2>📚 Catálogos base</h2>
    <div class="chips" id="baseGroup">${baseCards}</div>
  </div>
</div>

<div class="footer">
  <div class="footer-inner">
    <div class="count" id="countLine">Calculando…</div>
    <div style="display:flex; gap:10px; flex-wrap:wrap">
      <button class="btn btn-ghost" id="resetBtn" type="button">↺ Restablecer</button>
      <a class="btn btn-primary" id="installBtn" href="#">🚀 Instalar en Stremio</a>
      <button class="btn btn-ghost" id="copyBtn" type="button">📋 Copiar URL</button>
    </div>
  </div>
  <div class="footer-inner personal">
    <code id="manifestUrl"></code>
  </div>
</div>

<script>
const PLATFORMS = ${JSON.stringify(PLATFORMS.map(p => ({ key: p.key, name: p.name })))};
const STUDIOS = ${JSON.stringify(STUDIOS.map(s => ({ key: s.key, name: s.name })))};
const BASE = ${JSON.stringify(BASE_OPTIONS.map(o => o.key))};
const DEFAULT_REGION = ${JSON.stringify(config.watchRegion || 'NI')};
const STORAGE_KEY = 'catalogos-plus-config-v1';

const state = {
  lang: 'es',
  region: DEFAULT_REGION,
  platforms: new Set(PLATFORMS.map(p => p.key)),
  studios: new Set(STUDIOS.map(s => s.key)),
  base: new Set(BASE),
};

function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, platforms: [...state.platforms], studios: [...state.studios], base: [...state.base] })); } catch (e) {} }
function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved) return;
    if (saved.lang) state.lang = saved.lang;
    if (saved.region) state.region = saved.region;
    if (Array.isArray(saved.platforms)) state.platforms = new Set(saved.platforms);
    if (Array.isArray(saved.studios)) state.studios = new Set(saved.studios);
    if (Array.isArray(saved.base)) state.base = new Set(saved.base);
  } catch (e) {}
}

function b64url(obj) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function currentConfig(allSelected) {
  const slim = {
    lang: state.lang,
    region: state.region,
    platforms: allSelected ? undefined : [...state.platforms],
    studios: allSelected ? undefined : [...state.studios],
    base: allSelected ? undefined : [...state.base],
  };
  return b64url(slim);
}
function render() {
  // pills
  document.querySelectorAll('.pill').forEach(p => {
    const on = state[p.dataset.group] === p.dataset.value;
    p.setAttribute('aria-pressed', String(on));
  });
  // cards
  document.querySelectorAll('input[data-group="platforms"]').forEach(i => { i.checked = state.platforms.has(i.dataset.key); });
  document.querySelectorAll('input[data-group="studios"]').forEach(i => { i.checked = state.studios.has(i.dataset.key); });
  document.querySelectorAll('input[data-group="base"]').forEach(i => { i.checked = state.base.has(i.dataset.key); });
  // counts
  const allPlatforms = state.platforms.size === PLATFORMS.length;
  const allStudios = state.studios.size === STUDIOS.length;
  const allBase = state.base.size === BASE.length;
  const baseCount = (state.base.has('tendencias')?2:0) + (state.base.has('populares')?2:0) + (state.base.has('top')?2:0) + (state.base.has('tvmaze_hoy')?1:0);
  const total = baseCount + state.platforms.size * 2 + state.studios.size;
  document.getElementById('countLine').innerHTML = '<strong>' + total + '</strong> catálogos · <strong>' + state.platforms.size + '</strong> plataformas · <strong>' + state.studios.size + '</strong> estudios · región <strong>' + state.region + '</strong>';
  // personal manifest url
  const allSelected = allPlatforms && allStudios && allBase && state.lang === 'es' && state.region === DEFAULT_REGION;
  const encoded = currentConfig(allSelected);
  const personal = allSelected
    ? window.location.origin + '/manifest.json'
    : window.location.origin + '/' + encoded + '/manifest.json';
  document.getElementById('manifestUrl').textContent = personal;
  document.getElementById('installBtn').href = 'stremio://' + window.location.host + (allSelected ? '/manifest.json' : '/' + encoded + '/manifest.json');
  save();
}

document.addEventListener('click', (ev) => {
  const pill = ev.target.closest('.pill');
  if (pill) { state[pill.dataset.group] = pill.dataset.value; render(); return; }
  const toggle = ev.target.closest('[data-toggle]');
  if (toggle) {
    const [group, mode] = toggle.dataset.toggle.split(':');
    const all = group === 'platforms' ? PLATFORMS.map(p => p.key) : STUDIOS.map(s => s.key);
    state[group] = mode === 'all' ? new Set(all) : new Set();
    render(); return;
  }
});
document.addEventListener('change', (ev) => {
  const input = ev.target;
  if (!input.dataset || !input.dataset.group) return;
  const { group, key } = input.dataset;
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
  catch { document.getElementById('copyBtn').textContent = '📋 Copiar URL'; }
  setTimeout(() => { document.getElementById('copyBtn').textContent = '📋 Copiar URL'; }, 1800);
});

// Logos vía /internal/branding.json (TMDB). Fallback: inicial de la marca.
async function loadLogos() {
  try {
    const res = await fetch('/internal/branding.json?lang=' + encodeURIComponent(state.lang));
    if (!res.ok) return;
    const data = await res.json();
    const groups = { providers: data.providers || {}, studios: data.studios || {} };
    document.querySelectorAll('img[data-logo-for]').forEach(img => {
      const group = img.dataset.logoGroup;
      const key = img.dataset.logoFor;
      const hit = groups[group] && groups[group][key];
      if (hit && hit.logo) { img.src = hit.logo; img.addEventListener('error', () => img.remove()); }
    });
  } catch (e) { /* sin logos: se muestran las iniciales */ }
}

restore();
render();
loadLogos();
</script>
</body>
</html>`;
}

module.exports = { renderConfigure };
