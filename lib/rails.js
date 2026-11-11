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
const { icon, iconMask } = require('./icons');

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const RAILS_CSS = `
  .rail { margin: 30px 0 4px; }

  .rail-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin: 0 2px 16px; }
  .rail-head h2 {
    font-size: clamp(1.05rem, 1.8vw, 1.22rem); font-weight: 750; letter-spacing: -.02em; color: #fff;
    display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
  }
  .rail-head h2 span { font-size: .82rem; font-weight: 500; letter-spacing: 0; color: var(--muted); }
  .rail-head a {
    flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px;
    color: var(--text-soft); font-size: .8rem; font-weight: 600; text-decoration: none;
    border-radius: 11px; border: 1px solid var(--line); background: var(--surface);
    transition: color .18s, background .18s, border-color .18s;
  }
  .rail-head a:hover { color: #fff; background: var(--surface-2); border-color: var(--line-strong); }

  /* Los bordes se difuminan con una máscara. El izquierdo solo cuando ya se
     ha desplazado (.scrolled, lo pone RAILS_JS): al inicio no hay nada que
     insinuar y taparía la primera tarjeta. */
  .rail-scroll, .provider-strip {
    --fade-l: 0px;
    mask-image: linear-gradient(90deg, transparent 0, #000 var(--fade-l), #000 calc(100% - 56px), transparent 100%);
    -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 var(--fade-l), #000 calc(100% - 56px), transparent 100%);
  }
  .rail-scroll.scrolled, .provider-strip.scrolled { --fade-l: 40px; }
  .rail-scroll {
    display: flex; gap: 16px; overflow-x: auto; padding: 6px 2px 18px;
    scroll-snap-type: x proximity; scrollbar-width: none;
  }
  .rail-scroll::-webkit-scrollbar { display: none; }

  /* ── Tarjeta de poster ─────────────────────────────────────────────────── */
  .poster-card {
    position: relative; flex: 0 0 164px; scroll-snap-align: start;
    text-decoration: none; display: block; color: inherit;
    transition: transform .3s var(--ease);
  }
  .poster-card:hover { transform: translateY(-6px); }
  .poster-card .poster {
    position: relative; display: block; width: 164px; height: 246px;
    border-radius: 18px; overflow: hidden; background: var(--bg-soft);
    box-shadow: var(--shadow-md); border: 1px solid rgba(255,255,255,.08);
    transition: box-shadow .3s var(--ease), border-color .3s var(--ease);
  }
  .poster-card .poster::after {
    content: ''; position: absolute; inset: auto 0 0 0; height: 46%;
    background: linear-gradient(180deg, transparent, rgba(0,0,0,.66));
    pointer-events: none;
  }
  .poster-card:hover .poster {
    border-color: rgba(255,255,255,0.32);
    box-shadow: 0 24px 50px rgba(0,0,0,.62), 0 0 0 1px rgba(0,0,0,0.4), 0 0 44px rgba(0,0,0,0.2);
  }
  .poster-card img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .5s var(--ease); }
  .poster-card:hover img { transform: scale(1.05); }

  .poster-rating, .poster-year {
    position: absolute; z-index: 2; display: inline-flex; align-items: center; gap: 4px;
    height: 24px; padding: 0 8px; border-radius: 8px; font-size: .7rem; font-weight: 700;
    background: rgba(0,0,0,.62); border: 1px solid rgba(255,255,255,.14);
  }
  .poster-rating { left: 9px; bottom: 9px; color: var(--star); }
  /* La estrella se pinta con una máscara: una definición para todas las tarjetas. */
  .poster-rating::before, .poster-meta b::before {
    content: ''; display: inline-block; flex: 0 0 auto; width: 11px; height: 11px; background: currentColor;
    -webkit-mask: ${iconMask('star', { solid: true })} center / contain no-repeat;
    mask: ${iconMask('star', { solid: true })} center / contain no-repeat;
  }
  .poster-meta b::before { margin-right: 3px; vertical-align: -1px; }
  .poster-year { right: 9px; top: 9px; color: var(--text-soft); font-weight: 600; }

  .poster-title {
    margin-top: 10px; font-size: .8rem; font-weight: 600; line-height: 1.35; color: var(--text-soft);
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    min-height: 2.15em; transition: color .18s;
  }
  .poster-card:hover .poster-title { color: #fff; }
  .poster-meta {
    display: block; margin-top: 3px; font-size: .71rem; color: #727b93;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .poster-meta b { color: var(--star); font-weight: 650; }

  /* ── Tira de plataformas ───────────────────────────────────────────────── */
  .provider-strip { display: flex; gap: 12px; overflow-x: auto; padding: 6px 2px 12px; scrollbar-width: none; }
  .provider-strip::-webkit-scrollbar { display: none; }
  .provider-strip a {
    flex: 0 0 auto; display: flex; flex-direction: column; align-items: center; gap: 9px;
    text-decoration: none; width: 88px; transition: transform .22s var(--ease);
  }
  .provider-strip a:hover { transform: translateY(-4px); }
  .provider-strip .p-logo {
    width: 72px; height: 72px; border-radius: 20px; background: #fff;
    display: flex; align-items: center; justify-content: center; overflow: hidden;
    box-shadow: var(--shadow-sm), inset 0 0 0 1px rgba(0,0,0,.06);
    transition: box-shadow .22s var(--ease);
  }
  .provider-strip a:hover .p-logo {
    box-shadow: 0 14px 30px rgba(0,0,0,.55), 0 0 0 2px rgba(0,0,0,0.6), 0 0 28px rgba(0,0,0,0.3);
  }
  .provider-strip img { width: 62%; height: 62%; object-fit: contain; }
  .provider-strip .p-letter { font-weight: 800; color: #1a1a1a; font-size: 1.25rem; }
  .provider-strip .p-name {
    font-size: .7rem; color: var(--muted); max-width: 88px; text-align: center; line-height: 1.25;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .provider-strip a:hover .p-name { color: var(--text-soft); }

  /* ── Entrada suave al hacer scroll ─────────────────────────────────────── */
  /* Oculto hasta que RAILS_JS lo marca como .revealed. La transición de
     entrada vive en .revealing, que se retira al terminar: así no pisa los
     transform/transition propios de cada componente (hover, pulsación…). */
  .js-anim .poster-card:not(.revealed), .js-anim .feature:not(.revealed),
  .js-anim .provider-tile:not(.revealed), .js-anim .studio-tile:not(.revealed),
  .js-anim .rail:not(.revealed), .js-anim .reveal:not(.revealed) {
    opacity: 0; transform: translateY(18px);
  }
  .js-anim .revealing { transition: opacity .6s var(--ease), transform .7s var(--ease) !important; }

  @media (max-width: 720px) {
    .poster-card { flex-basis: 132px; }
    .poster-card .poster { width: 132px; height: 198px; border-radius: 15px; }
    .rail-scroll { gap: 12px; }
    .provider-strip .p-logo { width: 62px; height: 62px; border-radius: 17px; }
    .provider-strip a { width: 76px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .poster-card, .poster-card .poster, .poster-card img, .provider-strip a, .provider-strip .p-logo { transition: none !important; }
    .poster-card:hover, .provider-strip a:hover { transform: none; }
    .js-anim .poster-card:not(.revealed), .js-anim .feature:not(.revealed), .js-anim .provider-tile:not(.revealed),
    .js-anim .studio-tile:not(.revealed), .js-anim .rail:not(.revealed), .js-anim .reveal:not(.revealed) {
      opacity: 1; transform: none;
    }
  }

  /* ── Piel Apple TV para los rieles ───────────────────────────────────────
     Pósters sin borde, radio contenido y hover que levanta la tarjeta con un
     halo blanco fino: el color lo pone la obra, no la interfaz. */
  .rail-head h2 { font-size: clamp(1.15rem, 1.9vw, 1.4rem); font-weight: 700; letter-spacing: -.025em; }
  .rail-head h2 span { color: var(--muted); font-weight: 450; }
  .rail-head a {
    height: 32px; padding: 0 14px; border-radius: 980px;
    background: rgba(255,255,255,.07); border-color: transparent; color: #d2d2d7; font-weight: 550;
  }
  .rail-head a:hover { background: rgba(255,255,255,.14); border-color: transparent; color: #fff; }
  .poster-card:hover { transform: translateY(-4px) scale(1.02); }
  .poster-card .poster {
    border-radius: 10px; border: 0;
    box-shadow: 0 10px 26px rgba(0,0,0,.55);
  }
  .poster-card .poster::after { background: linear-gradient(180deg, transparent, rgba(0,0,0,.66)); }
  .poster-card:hover .poster { box-shadow: 0 22px 48px rgba(0,0,0,.72), 0 0 0 2px rgba(255,255,255,.22); }
  .poster-rating, .poster-year {
    border-radius: 6px; background: rgba(0,0,0,.62); border-color: rgba(255,255,255,.14);
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  }
  .poster-title { color: #d2d2d7; font-weight: 500; }
  .poster-meta { color: var(--muted); }
  .provider-strip .p-logo { border-radius: 14px; box-shadow: 0 4px 14px rgba(0,0,0,.5); }
  .provider-strip a:hover .p-logo { box-shadow: 0 14px 32px rgba(0,0,0,.65), 0 0 0 2px rgba(255,255,255,.25); }
  .provider-strip .p-name { color: var(--muted); }
  .provider-strip a:hover .p-name { color: #d2d2d7; }
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
  var revealEls = document.querySelectorAll('.poster-card, .feature, .provider-tile, .studio-tile, .rail, .reveal');
  if (!reduce && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        var siblings = el.parentElement ? Array.prototype.indexOf.call(el.parentElement.children, el) : 0;
        var delay = Math.min(siblings % 10, 8) * 45;
        el.style.transitionDelay = delay + 'ms';
        el.classList.add('revealing');
        el.classList.add('revealed');
        setTimeout(function () {
          el.classList.remove('revealing');
          el.style.transitionDelay = '';
        }, 800 + delay);
        io.unobserve(el);
      });
    }, { threshold: 0.1 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('revealed'); });
  }

  // ── Difuminado del borde izquierdo de las pistas ─────────
  document.querySelectorAll('.rail-scroll, .provider-strip').forEach(function (track) {
    var mark = function () { track.classList.toggle('scrolled', track.scrollLeft > 4); };
    track.addEventListener('scroll', mark, { passive: true });
    mark();
  });

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
  const tiles = PLATFORMS.map((p) => {
    const logo = STATIC_PROVIDER_LOGOS[p.key];
    const img = logo
      ? `<img src="${escapeHtml(logo)}" alt="" loading="lazy" />`
      : `<span class="p-letter">${escapeHtml(p.name.charAt(0))}</span>`;
    return `<a href="${escapeHtml(href)}" aria-label="${escapeHtml(p.name)}"><span class="p-logo">${img}</span><span class="p-name">${escapeHtml(p.name)}</span></a>`;
  }).join('\n');
  return `<section class="rail" aria-label="Plataformas">
  <div class="rail-head"><h2>Explorar por <span>plataforma</span></h2><a href="${escapeHtml(href)}">Elegir las mías ${icon('arrow-right', 14)}</a></div>
  <div class="provider-strip">${tiles}</div>
</section>`;
}

/**
 * Miniatura de un póster de TMDB. Las tarjetas miden 164 px de ancho como
 * mucho (328 px en pantallas 2×): w342 pesa menos de la mitad que w500 y se
 * ve igual. Cualquier otra URL se devuelve sin tocar.
 */
function posterThumb(url) {
  return String(url || '').replace(/^(https:\/\/image\.tmdb\.org\/t\/p\/)w\d+\//, '$1w342/');
}

/**
 * Rail de posters. items: [{title, year, rating, poster}]
 *  - media: etiqueta bajo el título ("Película", "Serie", "Anime").
 */
function posterRailHtml({ title, accent, items, href = '/configure', cta = 'Configurar', media = '' }) {
  const cards = (items || []).map((item) => {
    const img = item.poster
      ? `<img src="${escapeHtml(posterThumb(item.poster))}" alt="${escapeHtml(item.title)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.style.opacity=.2" />`
      : '';
    const rating = item.rating ? `<span class="poster-rating">${escapeHtml(item.rating)}</span>` : '';
    const year = item.year ? `<span class="poster-year">${escapeHtml(item.year)}</span>` : '';
    const metaLine = media
      ? `<span class="poster-meta">${escapeHtml(media)}${item.year ? ` · ${escapeHtml(item.year)}` : ''}${item.rating ? ` · <b>${escapeHtml(item.rating)}</b>` : ''}</span>`
      : '';
    return `<a class="poster-card" href="${escapeHtml(href)}" data-title="${escapeHtml(String(item.title || '').toLowerCase())}">
  <span class="poster">${img}${rating}${year}</span>
  <span class="poster-title">${escapeHtml(item.title)}</span>${metaLine}
</a>`;
  }).join('\n');
  return `<section class="rail" aria-label="${escapeHtml([title, accent].filter(Boolean).join(' '))}">
  <div class="rail-head"><h2>${escapeHtml(title)} ${accent ? `<span>${escapeHtml(accent)}</span>` : ''}</h2><a href="${escapeHtml(href)}">${escapeHtml(cta)} ${icon('arrow-right', 14)}</a></div>
  <div class="rail-scroll" data-autoscroll="1">${cards}</div>
</section>`;
}

module.exports = { RAILS_CSS, RAILS_JS, providerRailHtml, posterRailHtml, posterThumb, escapeHtml };
