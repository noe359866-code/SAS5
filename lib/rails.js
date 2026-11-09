'use strict';

/**
 * Constructores compartidos de "rails" (carrusel horizontal de posters) y
 * tiras de plataformas, usados por la landing (/) y por /configure.
 *
 * Diseño: tarjetas limpias tipo streaming moderno — sin rotaciones 3D
 * constantes; el movimiento solo responde al usuario (hover, scroll) y
 * respeta prefers-reduced-motion. Los bordes de la pista se difuminan con
 * mask-image para que el scroll se sienta continuo.
 */

const { PLATFORMS } = require('./catalogs');
const { STATIC_PROVIDER_LOGOS } = require('./staticLogos');

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const RAILS_CSS = `
  .rail { margin: 34px 0 6px; }

  .rail-head { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; margin: 0 2px 14px; }
  .rail-head h2 {
    font-size: clamp(1.02rem, 1.7vw, 1.18rem); font-weight: 700; letter-spacing: -.015em; color: #fff;
    display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
  }
  .rail-head h2 span {
    font-size: .8rem; font-weight: 500; letter-spacing: 0; color: var(--muted);
  }
  .rail-head a {
    flex: 0 0 auto; color: var(--text-soft); font-size: .8rem; font-weight: 600; text-decoration: none;
    padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface);
    transition: color .18s, background .18s, border-color .18s;
  }
  .rail-head a:hover { color: #fff; background: var(--surface-2); border-color: var(--line-strong); }

  .rail-scroll {
    display: flex; gap: 14px; overflow-x: auto; padding: 4px 2px 16px;
    scroll-snap-type: x proximity; scrollbar-width: none;
    mask-image: linear-gradient(90deg, transparent 0, #000 18px, #000 calc(100% - 44px), transparent 100%);
    -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 18px, #000 calc(100% - 44px), transparent 100%);
  }
  .rail-scroll::-webkit-scrollbar { display: none; }

  /* ── Tarjeta de poster ─────────────────────────────────────────────────── */
  .poster-card {
    position: relative; flex: 0 0 152px; scroll-snap-align: start;
    text-decoration: none; display: block; color: inherit;
    transition: transform .3s var(--ease);
  }
  .poster-card:hover { transform: translateY(-6px); }
  .poster-card .poster {
    position: relative; display: block; width: 152px; height: 228px;
    border-radius: 16px; overflow: hidden; background: var(--bg-soft);
    box-shadow: var(--shadow-md); border: 1px solid rgba(255,255,255,.07);
    transition: box-shadow .3s var(--ease), border-color .3s var(--ease);
  }
  .poster-card .poster::after {
    content: ''; position: absolute; inset: auto 0 0 0; height: 46%;
    background: linear-gradient(180deg, transparent, rgba(4,5,9,.72));
    opacity: .9; pointer-events: none;
  }
  .poster-card:hover .poster {
    border-color: rgba(124,92,255,.5);
    box-shadow: 0 22px 48px rgba(0,0,0,.6), 0 0 0 1px rgba(124,92,255,.35), 0 0 40px rgba(124,92,255,.16);
  }
  .poster-card img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .5s var(--ease); }
  .poster-card:hover img { transform: scale(1.05); }

  .poster-rating, .poster-year {
    position: absolute; z-index: 2; font-size: .68rem; font-weight: 700;
    padding: 4px 8px; border-radius: 999px;
    background: rgba(6,7,12,.72); border: 1px solid rgba(255,255,255,.14);
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  }
  .poster-rating { left: 8px; bottom: 8px; color: var(--star); }
  .poster-year { right: 8px; top: 8px; color: var(--text-soft); font-weight: 600; }

  .poster-title {
    margin-top: 9px; font-size: .78rem; font-weight: 550; line-height: 1.35; color: var(--text-soft);
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    min-height: 2.1em; transition: color .18s;
  }
  .poster-card:hover .poster-title { color: #fff; }
  .poster-meta {
    display: block; margin-top: 3px; font-size: .7rem; color: #77809a;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .poster-meta b { color: var(--star); font-weight: 650; }

  /* ── Tira de plataformas ───────────────────────────────────────────────── */
  .provider-strip {
    display: flex; gap: 12px; overflow-x: auto; padding: 4px 2px 12px; scrollbar-width: none;
    mask-image: linear-gradient(90deg, transparent 0, #000 18px, #000 calc(100% - 40px), transparent 100%);
    -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 18px, #000 calc(100% - 40px), transparent 100%);
  }
  .provider-strip::-webkit-scrollbar { display: none; }
  .provider-strip a {
    flex: 0 0 auto; display: flex; flex-direction: column; align-items: center; gap: 8px;
    text-decoration: none; width: 86px; transition: transform .22s var(--ease);
  }
  .provider-strip a:hover { transform: translateY(-4px); }
  .provider-strip .p-logo {
    width: 76px; height: 76px; border-radius: 20px; background: #fff;
    display: flex; align-items: center; justify-content: center; overflow: hidden;
    box-shadow: var(--shadow-sm), inset 0 0 0 1px rgba(0,0,0,.06);
    transition: box-shadow .22s var(--ease);
  }
  .provider-strip a:hover .p-logo {
    box-shadow: 0 14px 30px rgba(0,0,0,.55), 0 0 0 1px rgba(124,92,255,.4), 0 0 26px rgba(124,92,255,.18);
  }
  .provider-strip img { width: 62%; height: 62%; object-fit: contain; }
  .provider-strip .p-name {
    font-size: .68rem; color: var(--muted); max-width: 86px; text-align: center; line-height: 1.25;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .provider-strip a:hover .p-name { color: var(--text-soft); }

  /* ── Entrada suave al hacer scroll ─────────────────────────────────────── */
  .js-anim .poster-card, .js-anim .feature, .js-anim .provider-tile,
  .js-anim .studio-tile, .js-anim .rail {
    opacity: 0; transform: translateY(18px);
  }
  .js-anim .revealed {
    opacity: 1 !important; transform: none !important;
    transition: opacity .6s var(--ease), transform .7s var(--ease);
  }

  @media (max-width: 720px) {
    .poster-card { flex-basis: 128px; }
    .poster-card .poster { width: 128px; height: 192px; border-radius: 14px; }
    .rail-scroll { gap: 12px; }
    .provider-strip .p-logo { width: 64px; height: 64px; border-radius: 17px; }
    .provider-strip a { width: 74px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .poster-card, .poster-card .poster, .poster-card img, .provider-strip a, .provider-strip .p-logo { transition: none !important; }
    .poster-card:hover, .provider-strip a:hover { transform: none; }
    .js-anim .poster-card, .js-anim .feature, .js-anim .provider-tile, .js-anim .studio-tile, .js-anim .rail {
      opacity: 1; transform: none;
    }
  }
`;

/**
 * JS compartido (portada + /configure):
 *  - Entrada escalonada al hacer scroll (IntersectionObserver).
 *  - Inclinación 3D muy leve siguiendo el cursor en posters y logos.
 *  - Auto-desplazamiento lento de los rieles (se pausa al interactuar).
 *  - Nav con cristal al hacer scroll.
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
        el.style.transitionDelay = Math.min(siblings % 10, 8) * 45 + 'ms';
        el.classList.add('revealed');
        setTimeout(function () { el.style.transitionDelay = '0ms'; }, 900);
        io.unobserve(el);
      });
    }, { threshold: 0.1 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('revealed'); });
  }

  // ── Brillo que sigue al cursor en las tarjetas ───────────
  var cards = document.querySelectorAll('.feature');
  cards.forEach(function (card) {
    card.addEventListener('pointermove', function (ev) {
      var r = card.getBoundingClientRect();
      card.style.setProperty('--fx', ((ev.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      card.style.setProperty('--fy', ((ev.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    });
  });

  if (reduce) return;

  // ── Inclinación 3D muy leve (respuesta al cursor) ────────
  var tiltEls = document.querySelectorAll('.poster-card .poster, .provider-tile .tile-logo, .studio-tile .studio-logo');
  tiltEls.forEach(function (el) {
    var raf = null;
    el.addEventListener('pointermove', function (ev) {
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = null;
        var r = el.getBoundingClientRect();
        var px = (ev.clientX - r.left) / r.width;
        var py = (ev.clientY - r.top) / r.height;
        el.style.transform = 'rotateY(' + ((px - 0.5) * 7).toFixed(2) + 'deg) rotateX(' + ((0.5 - py) * 5).toFixed(2) + 'deg)';
      });
    });
    el.addEventListener('pointerleave', function () {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      el.style.transform = '';
    });
  });

  // ── Auto-desplazamiento suave de rieles ──────────────────
  document.querySelectorAll('.rail-scroll[data-autoscroll]').forEach(function (rail) {
    var paused = false, resumeAt = 0;
    ['pointerenter', 'touchstart', 'focusin'].forEach(function (evt) {
      rail.addEventListener(evt, function () { paused = true; }, { passive: true });
    });
    ['pointerleave', 'focusout'].forEach(function (evt) {
      rail.addEventListener(evt, function () { paused = false; resumeAt = Date.now() + 1500; });
    });
    rail.addEventListener('wheel', function () { resumeAt = Date.now() + 3000; }, { passive: true });
    setInterval(function () {
      if (paused || Date.now() < resumeAt || document.hidden) return;
      if (rail.scrollWidth - rail.clientWidth < 10) return;
      rail.scrollLeft += 0.6;
      if (rail.scrollLeft >= rail.scrollWidth - rail.clientWidth - 2) rail.scrollLeft = 0;
    }, 24);
  });

  // ── Nav con cristal al hacer scroll ──────────────────────
  var nav = document.querySelector('.nav');
  if (nav) {
    var onScroll = function () { nav.classList.toggle('scrolled', window.scrollY > 16); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
})();
`;

/** Tira "Explorar por plataforma" (logos estáticos, enlace a /configure). */
function providerRailHtml(href = '/configure#plataformas') {
  const tiles = PLATFORMS.map((p, i) => {
    const logo = STATIC_PROVIDER_LOGOS[p.key];
    const img = logo
      ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(p.name)}" loading="lazy" />`
      : `<span style="font-weight:800;color:#1a1a1a;font-size:1.25rem">${escapeHtml(p.name.charAt(0))}</span>`;
    return `<a href="${escapeHtml(href)}" aria-label="${escapeHtml(p.name)}"><span class="p-logo" style="--i:${i % 9}">${img}</span><span class="p-name">${escapeHtml(p.name)}</span></a>`;
  }).join('\n');
  return `<section class="rail" aria-label="Plataformas">
  <div class="rail-head"><h2>Explorar por <span>plataforma</span></h2><a href="${escapeHtml(href)}">Configurar</a></div>
  <div class="provider-strip">${tiles}</div>
</section>`;
}

/** Rail de posters. items: [{title, year, rating, poster}]
 *  media: etiqueta bajo el título ("Película", "Serie", "Anime"). */
function posterRailHtml({ title, accent, items, href = '/configure', cta = 'Configurar', media = '' }) {
  const cards = (items || []).map((item, i) => {
    const img = item.poster
      ? `<img src="${escapeHtml(item.poster)}" alt="${escapeHtml(item.title)}" loading="lazy" onerror="this.onerror=null;this.style.opacity=.2" />`
      : '';
    const rating = item.rating ? `<span class="poster-rating">★ ${escapeHtml(item.rating)}</span>` : '';
    const year = item.year ? `<span class="poster-year">${escapeHtml(item.year)}</span>` : '';
    const metaLine = media
      ? `<span class="poster-meta">${escapeHtml(media)}${item.year ? ` • ${escapeHtml(item.year)}` : ''}${item.rating ? ` • <b>★ ${escapeHtml(item.rating)}</b>` : ''}</span>`
      : '';
    return `<a class="poster-card" href="${escapeHtml(href)}" style="--i:${i % 9}" data-title="${escapeHtml(String(item.title || '').toLowerCase())}">
  <span class="poster">${img}${rating}${year}</span>
  <span class="poster-title">${escapeHtml(item.title)}</span>${metaLine}
</a>`;
  }).join('\n');
  return `<section class="rail" aria-label="${escapeHtml(title)}">
  <div class="rail-head"><h2>${escapeHtml(title)} ${accent ? `<span>${escapeHtml(accent)}</span>` : ''}</h2><a href="${escapeHtml(href)}">${escapeHtml(cta)}</a></div>
  <div class="rail-scroll" data-autoscroll="1">${cards}</div>
</section>`;
}

module.exports = { RAILS_CSS, RAILS_JS, providerRailHtml, posterRailHtml, escapeHtml };
