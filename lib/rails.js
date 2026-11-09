'use strict';

/**
 * Constructores compartidos de "rails" estilo streaming (carrusel horizontal
 * de posters) y tiles de plataformas, usados por la landing (/) y /configure.
 * CSS compartido: RAILS_CSS.
 */

const { PLATFORMS } = require('./catalogs');
const { STATIC_PROVIDER_LOGOS } = require('./staticLogos');

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const RAILS_CSS = `
  .rail { margin: 30px 0 8px; }
  .rail-head { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin:0 2px 10px; }
  .rail-head h2 { font-size:1.18rem; letter-spacing:.02em; color:#fff; }
  .rail-head h2 span { color:#f5c518; }
  .rail-head a { color:#f5c518; font-size:.8rem; text-decoration:none; font-weight:700; }
  .rail-scroll { display:flex; gap:12px; overflow-x:auto; padding:4px 2px 14px; scroll-snap-type:x proximity; }
  .rail-scroll::-webkit-scrollbar { height:8px; }
  .rail-scroll::-webkit-scrollbar-thumb { background:#333a55; border-radius:99px; }
  .poster-card { position:relative; flex:0 0 148px; scroll-snap-align:start; text-decoration:none; display:block; }
  .poster-card .poster { position:relative; width:148px; height:222px; border-radius:12px; overflow:hidden; background:#1b1f2e; box-shadow:0 8px 22px rgba(0,0,0,.55); transition:transform .18s ease; }
  .poster-card:hover .poster { transform:scale(1.06); z-index:5; }
  .poster-card img { width:100%; height:100%; object-fit:cover; display:block; }
  .poster-rating { position:absolute; left:6px; bottom:6px; background:rgba(0,0,0,.8); color:#f5c518; font-size:.68rem; font-weight:800; padding:3px 7px; border-radius:6px; backdrop-filter:blur(3px); }
  .poster-year { position:absolute; right:6px; top:6px; background:rgba(0,0,0,.7); color:#e8e9f2; font-size:.62rem; padding:2px 6px; border-radius:6px; }
  .poster-title { margin-top:7px; font-size:.72rem; line-height:1.3; color:#d8dbea; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; min-height:1.9em; }
  .provider-strip { display:flex; gap:10px; overflow-x:auto; padding:6px 2px 12px; scrollbar-width:none; }
  .provider-strip::-webkit-scrollbar { display:none; }
  .provider-strip a { flex:0 0 auto; display:flex; flex-direction:column; align-items:center; gap:6px; text-decoration:none; }
  .provider-strip .p-logo { width:74px; height:74px; border-radius:16px; background:#fff; display:flex; align-items:center; justify-content:center; overflow:hidden; box-shadow:0 4px 14px rgba(0,0,0,.5); transition:transform .15s; }
  .provider-strip a:hover .p-logo { transform:scale(1.1); }
  .provider-strip img { width:64%; height:64%; object-fit:contain; }
  .provider-strip .p-name { font-size:.62rem; color:#aeb3cc; max-width:76px; text-align:center; }
  @media (prefers-reduced-motion: reduce) { .poster-card:hover .poster, .provider-strip a:hover .p-logo { transform:none; } }
`;

/** Rail "Explorar por plataforma" (logos estáticos, enlace a /configure). */
function providerRailHtml(href = '/configure#plataformas') {
  const tiles = PLATFORMS.map((p) => {
    const logo = STATIC_PROVIDER_LOGOS[p.key];
    const img = logo ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(p.name)}" loading="lazy" />` : `<span style="font-weight:900;color:#333;font-size:1.3rem">${escapeHtml(p.name.charAt(0))}</span>`;
    return `<a href="${escapeHtml(href)}" aria-label="${escapeHtml(p.name)}"><span class="p-logo">${img}</span><span class="p-name">${escapeHtml(p.name)}</span></a>`;
  }).join('\n');
  return `<section class="rail" aria-label="Plataformas">
  <div class="rail-head"><h2>Explorar por <span>plataforma</span></h2><a href="${escapeHtml(href)}">Configurar →</a></div>
  <div class="provider-strip">${tiles}</div>
</section>`;
}

/** Rail de posters. items: [{title, year, rating, poster}] */
function posterRailHtml({ title, accent, items, href = '/configure', cta = 'Configurar →' }) {
  const cards = (items || []).map((item) => {
    const img = item.poster ? `<img src="${escapeHtml(item.poster)}" alt="${escapeHtml(item.title)}" loading="lazy" onerror="this.onerror=null;this.style.opacity=.25" />` : '';
    const rating = item.rating ? `<span class="poster-rating">★ ${escapeHtml(item.rating)}</span>` : '';
    const year = item.year ? `<span class="poster-year">${escapeHtml(item.year)}</span>` : '';
    return `<a class="poster-card" href="${escapeHtml(href)}">
  <span class="poster">${img}${rating}${year}</span>
  <span class="poster-title">${escapeHtml(item.title)}</span>
</a>`;
  }).join('\n');
  return `<section class="rail" aria-label="${escapeHtml(title)}">
  <div class="rail-head"><h2>${escapeHtml(title)} ${accent ? `<span>${escapeHtml(accent)}</span>` : ''}</h2><a href="${escapeHtml(href)}">${escapeHtml(cta)}</a></div>
  <div class="rail-scroll">${cards}</div>
</section>`;
}

module.exports = { RAILS_CSS, providerRailHtml, posterRailHtml, escapeHtml };
