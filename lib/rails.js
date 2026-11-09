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
  .poster-card { position:relative; flex:0 0 148px; scroll-snap-align:start; text-decoration:none; display:block; perspective:900px; }
  .poster-card .poster { position:relative; width:148px; height:222px; border-radius:12px; overflow:hidden; background:#1b1f2e; box-shadow:0 8px 22px rgba(0,0,0,.55); transition:transform .35s cubic-bezier(.2,.7,.3,1.4), box-shadow .35s ease; transform-style:preserve-3d; will-change:transform; }
  .poster-card:hover .poster { box-shadow:0 22px 44px rgba(0,0,0,.7), 0 0 0 1px rgba(245,197,24,.35), 0 0 34px rgba(245,197,24,.18); z-index:5; }
  .poster-card .poster::after { content:''; position:absolute; inset:0; background:radial-gradient(420px circle at var(--mx,50%) var(--my,50%), rgba(255,255,255,.38), rgba(255,255,255,.06) 42%, transparent 65%); opacity:var(--glare,0); transition:opacity .3s; pointer-events:none; }
  /* Giro automático y continuo de los posters (solos, sin ratón) */
  .poster-card .poster { animation:poster-giro 5.6s ease-in-out infinite; animation-delay:calc(var(--i, 0) * .28s); }
  @keyframes poster-giro {
    0%, 100% { transform:perspective(900px) rotateY(-17deg) rotateX(3deg) translateY(0); }
    50% { transform:perspective(900px) rotateY(17deg) rotateX(-3deg) translateY(-7px); }
  }
  .poster-card:hover .poster { animation-play-state:paused; }
  .provider-strip .p-logo { animation:poster-giro 6.5s ease-in-out infinite; animation-delay:calc(var(--i, 0) * .28s); }
  .provider-strip a:hover .p-logo { animation-play-state:paused; }
  .poster-card img { width:100%; height:100%; object-fit:cover; display:block; }
  /* Entrada moderna: los posters "giran" al aparecer al hacer scroll */
  .js-anim .poster-card, .js-anim .feature, .js-anim .provider-tile, .js-anim .studio-tile, .js-anim .rail { opacity:0; transform:perspective(900px) rotateY(38deg) translateY(26px); transform-origin:left center; }
  .js-anim .revealed { opacity:1 !important; transform:none !important; transition:opacity .7s ease, transform .8s cubic-bezier(.16,.8,.26,1); }
  /* Hero con zoom cinematográfico lento (Ken Burns) */
  .hero-bg { animation:kenburns 26s ease-in-out infinite alternate; }
  @keyframes kenburns { from { transform:scale(1.02) translateY(0); } to { transform:scale(1.16) translateY(-14px); } }
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
  @media (prefers-reduced-motion: reduce) {
    .poster-card:hover .poster, .provider-strip a:hover .p-logo { transform:none; }
    .poster-card .poster, .provider-strip .p-logo { animation:none; }
    .hero-bg { animation:none; }
    .js-anim .poster-card, .js-anim .feature, .js-anim .provider-tile, .js-anim .studio-tile, .js-anim .rail { opacity:1; transform:none; }
  }
`;

/**
 * JS compartido (portada + /configure):
 *  - Giro 3D de posters/tiles siguiendo el cursor, con destello de luz.
 *  - Entrada escalonada "girando" al hacer scroll (IntersectionObserver).
 *  - Auto-rotación suave de los rieles de posters (pausa al pasar el ratón).
 *  - Nav con cristal (blur) al hacer scroll.
 * Sin librerías; respeta prefers-reduced-motion.
 */
const RAILS_JS = `
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.add('js-anim');

  // ── Entrada al hacer scroll ──────────────────────────────
  var revealEls = document.querySelectorAll('.poster-card, .feature, .provider-tile, .studio-tile, .rail');
  if (!reduce && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        var siblings = el.parentElement ? Array.prototype.indexOf.call(el.parentElement.children, el) : 0;
        el.style.transitionDelay = Math.min(siblings % 10, 8) * 55 + 'ms';
        el.classList.add('revealed');
        setTimeout(function () { el.style.transitionDelay = '0ms'; }, 1100);
        io.unobserve(el);
      });
    }, { threshold: 0.12 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('revealed'); });
  }

  if (reduce) return;

  // ── Giro 3D siguiendo el cursor ──────────────────────────
  var tiltEls = document.querySelectorAll('.poster-card .poster, .provider-tile .tile-logo, .studio-tile .studio-logo');
  tiltEls.forEach(function (el) {
    var raf = null;
    // Al pasar el cursor, el giro automático se detiene y manda el ratón
    el.addEventListener('pointerenter', function () { el.style.animation = 'none'; });
    el.addEventListener('pointermove', function (ev) {
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = null;
        var r = el.getBoundingClientRect();
        var px = (ev.clientX - r.left) / r.width;
        var py = (ev.clientY - r.top) / r.height;
        el.style.transform = 'rotateY(' + ((px - 0.5) * 26).toFixed(2) + 'deg) rotateX(' + ((0.5 - py) * 20).toFixed(2) + 'deg) scale(1.07)';
        el.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
        el.style.setProperty('--my', (py * 100).toFixed(1) + '%');
        el.style.setProperty('--glare', '1');
      });
    });
    el.addEventListener('pointerleave', function () {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      el.style.transform = '';
      el.style.animation = ''; // reanuda el giro automático
      el.style.setProperty('--glare', '0');
    });
  });

  // ── Auto-rotación de rieles ──────────────────────────────
  document.querySelectorAll('.rail-scroll[data-autoscroll]').forEach(function (rail) {
    var paused = false, resumeAt = 0;
    ['pointerenter', 'touchstart', 'focusin'].forEach(function (evt) {
      rail.addEventListener(evt, function () { paused = true; }, { passive: true });
    });
    ['pointerleave', 'focusout'].forEach(function (evt) {
      rail.addEventListener(evt, function () { paused = false; resumeAt = Date.now() + 1200; });
    });
    rail.addEventListener('wheel', function () { resumeAt = Date.now() + 2500; }, { passive: true });
    setInterval(function () {
      if (paused || Date.now() < resumeAt || document.hidden) return;
      if (rail.scrollWidth - rail.clientWidth < 10) return;
      rail.scrollLeft += 1;
      if (rail.scrollLeft >= rail.scrollWidth - rail.clientWidth - 2) rail.scrollLeft = 0;
    }, 24);
  });

  // ── Nav cristal al hacer scroll ──────────────────────────
  var nav = document.querySelector('.nav');
  if (nav) {
    var onScroll = function () { nav.classList.toggle('scrolled', window.scrollY > 24); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
})();
`;

/** Rail "Explorar por plataforma" (logos estáticos, enlace a /configure). */
function providerRailHtml(href = '/configure#plataformas') {
  const tiles = PLATFORMS.map((p, i) => {
    const logo = STATIC_PROVIDER_LOGOS[p.key];
    const img = logo ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(p.name)}" loading="lazy" />` : `<span style="font-weight:900;color:#333;font-size:1.3rem">${escapeHtml(p.name.charAt(0))}</span>`;
    return `<a href="${escapeHtml(href)}" aria-label="${escapeHtml(p.name)}"><span class="p-logo" style="--i:${i % 9}">${img}</span><span class="p-name">${escapeHtml(p.name)}</span></a>`;
  }).join('\n');
  return `<section class="rail" aria-label="Plataformas">
  <div class="rail-head"><h2>Explorar por <span>plataforma</span></h2><a href="${escapeHtml(href)}">Configurar →</a></div>
  <div class="provider-strip">${tiles}</div>
</section>`;
}

/** Rail de posters. items: [{title, year, rating, poster}] */
function posterRailHtml({ title, accent, items, href = '/configure', cta = 'Configurar →' }) {
  const cards = (items || []).map((item, i) => {
    const img = item.poster ? `<img src="${escapeHtml(item.poster)}" alt="${escapeHtml(item.title)}" loading="lazy" onerror="this.onerror=null;this.style.opacity=.25" />` : '';
    const rating = item.rating ? `<span class="poster-rating">★ ${escapeHtml(item.rating)}</span>` : '';
    const year = item.year ? `<span class="poster-year">${escapeHtml(item.year)}</span>` : '';
    return `<a class="poster-card" href="${escapeHtml(href)}" style="--i:${i % 9}">
  <span class="poster">${img}${rating}${year}</span>
  <span class="poster-title">${escapeHtml(item.title)}</span>
</a>`;
  }).join('\n');
  return `<section class="rail" aria-label="${escapeHtml(title)}">
  <div class="rail-head"><h2>${escapeHtml(title)} ${accent ? `<span>${escapeHtml(accent)}</span>` : ''}</h2><a href="${escapeHtml(href)}">${escapeHtml(cta)}</a></div>
  <div class="rail-scroll" data-autoscroll="1">${cards}</div>
</section>`;
}

module.exports = { RAILS_CSS, RAILS_JS, providerRailHtml, posterRailHtml, escapeHtml };
