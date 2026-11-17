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
     Estantes como los de la app: el arte va limpio (año y nota aparecen al
     enfocar), la tarjeta enfocada crece con un brillo que sigue al cursor
     —el foco de tvOS— y las pistas se recorren con flechas de vidrio.
     --pw es el ancho del póster y --logo el lado del icono de plataforma. */
  .rail { --pw: 170px; --logo: 80px; margin: 34px 0 4px; }
  .rail-head { margin: 0 0 6px; }
  .rail-head h2 { font-size: clamp(1.2rem, 2vw, 1.5rem); font-weight: 700; letter-spacing: -.025em; }
  .rail-head h2 span { color: var(--muted); font-size: inherit; font-weight: 700; letter-spacing: inherit; }
  .rail-head a {
    height: 32px; padding: 0 14px; border-radius: 980px;
    background: rgba(255,255,255,.08); border-color: transparent; color: #f5f5f7; font-weight: 550;
  }
  .rail-head a:hover { background: rgba(255,255,255,.16); border-color: transparent; color: #fff; }

  /* La pista sobresale 12 px por cada lado (y deja aire arriba y abajo) para
     que la tarjeta enfocada crezca sin que el scroll la recorte. */
  .rail-view { position: relative; }
  .rail-scroll { gap: 14px; margin: 0 -12px; padding: 14px 12px 22px; scroll-padding-left: 12px; }
  .provider-strip { gap: 14px; margin: 0 -12px; padding: 12px 12px 14px; }

  /* Crece el arte, no la tarjeta entera: el título se queda en su sitio y no
     se vuelve a rasterizar. Con cursor, RAILS_JS añade la inclinación. */
  .poster-card { flex: 0 0 var(--pw); }
  .poster-card:hover, .poster-card:focus-visible { transform: none; z-index: 2; }
  .poster-card .poster {
    width: 100%; height: auto; aspect-ratio: 2 / 3; border-radius: 14px; border: 0;
    box-shadow: 0 10px 26px rgba(0,0,0,.56), 0 0 0 1px rgba(255,255,255,.06);
    transition: transform .36s var(--ease), box-shadow .45s var(--ease);
    will-change: transform;
  }
  .poster-card:hover .poster, .poster-card:focus-visible .poster {
    transform: translateY(-4px) scale(1.055);
    box-shadow: 0 32px 64px rgba(0,0,0,.82), 0 0 0 1px rgba(255,255,255,.22), 0 0 36px rgba(255,255,255,.06);
  }
  .poster-card img {
    opacity: 1;
    transition: transform .55s var(--ease), opacity .38s var(--ease), filter .35s var(--ease);
  }
  .poster-card:hover img { transform: none; filter: saturate(1.05) contrast(1.02); }
  /* Brillo especular: RAILS_JS mueve --mx / --my con el cursor. */
  .poster-card .poster::before {
    content: ''; position: absolute; inset: 0; z-index: 1; pointer-events: none; opacity: 0;
    background: radial-gradient(115% 85% at var(--mx, 50%) var(--my, 0%), rgba(255,255,255,.3), rgba(255,255,255,0) 56%);
    transition: opacity .35s var(--ease);
  }
  .poster-card .poster::after { background: linear-gradient(180deg, transparent, rgba(0,0,0,.7)); }
  .poster-rating, .poster-year {
    height: 22px; padding: 0 7px; border-radius: 7px; border: 0; font-size: .68rem;
    background: rgba(28,28,30,.72);
    backdrop-filter: saturate(180%) blur(12px); -webkit-backdrop-filter: saturate(180%) blur(12px);
  }
  .poster-year { color: #f5f5f7; }
  /* Con ratón, el arte va limpio hasta enfocar la tarjeta; en pantallas
     táctiles (sin hover) el año y la nota se quedan siempre a la vista. */
  @media (hover: hover) {
    .poster-rating, .poster-year, .poster-card .poster::after { opacity: 0; transition: opacity .3s var(--ease); }
    .poster-card:hover .poster-rating, .poster-card:hover .poster-year, .poster-card:hover .poster::after,
    .poster-card:focus-visible .poster-rating, .poster-card:focus-visible .poster-year,
    .poster-card:focus-visible .poster::after, .poster-card:hover .poster::before { opacity: 1; }
  }
  /* Por encima del póster: su sombra de foco no debe oscurecer el texto. */
  .poster-title, .poster-meta { position: relative; z-index: 1; }
  .poster-title { margin-top: 10px; color: #f5f5f7; font-size: .84rem; font-weight: 500; letter-spacing: -.01em; }
  .poster-meta { margin-top: 2px; color: var(--muted); font-size: .74rem; }

  .provider-strip a { width: calc(var(--logo) + 12px); gap: 10px; transition: transform .35s var(--ease); }
  .provider-strip a:hover { transform: scale(1.07); }
  .provider-strip .p-logo {
    width: var(--logo); height: var(--logo); border-radius: 22.5%;
    box-shadow: 0 6px 18px rgba(0,0,0,.55); transition: box-shadow .35s var(--ease);
  }
  .provider-strip a:hover .p-logo { box-shadow: 0 12px 24px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.18); }
  .provider-strip .p-name { max-width: none; color: var(--muted); font-size: .74rem; }
  .provider-strip a:hover .p-name { color: #f5f5f7; }

  /* Flechas de la pista (las crea RAILS_JS): solo con puntero fino; en táctil
     se desliza con el dedo. Centradas en la altura del arte. */
  .rail-nav {
    position: absolute; z-index: 3; top: calc(14px + var(--pw) * .75); width: 40px; height: 40px; margin-top: -20px;
    display: none; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%;
    cursor: pointer; background: rgba(44,44,46,.84); color: #f5f5f7; opacity: 0;
    backdrop-filter: saturate(180%) blur(20px); -webkit-backdrop-filter: saturate(180%) blur(20px);
    box-shadow: 0 8px 24px rgba(0,0,0,.55), inset 0 0 0 1px rgba(255,255,255,.1);
    transition: opacity .25s var(--ease), transform .25s var(--ease), background .2s var(--ease);
  }
  .rail-nav-prev { left: -8px; }
  .rail-nav-next { right: -8px; }
  .rail-nav-prev .ic { transform: rotate(180deg); }
  .provider-strip ~ .rail-nav { top: calc(12px + var(--logo) / 2); }
  .rail-nav[disabled] { pointer-events: none; }
  @media (hover: hover) and (pointer: fine) {
    .rail-nav { display: flex; }
    .rail-view:hover .rail-nav:not([disabled]) { opacity: 1; }
    .rail-nav:hover { background: rgba(72,72,74,.92); transform: scale(1.08); }
    .rail-nav:active { transform: scale(.96); }
  }

  @media (max-width: 720px) {
    .rail { --pw: 132px; --logo: 64px; }
    .rail-scroll, .provider-strip { gap: 12px; }
    .poster-card .poster { width: 100%; height: auto; border-radius: 10px; }
    .provider-strip .p-logo { width: var(--logo); height: var(--logo); border-radius: 22.5%; }
    .provider-strip a { width: calc(var(--logo) + 10px); }
  }
  @media (prefers-reduced-motion: reduce) {
    .poster-card:hover .poster, .poster-card:focus-visible .poster, .provider-strip a:hover { transform: none; }
  }
`;

/**
 * JS compartido (portada + /configure):
 *  - Entrada escalonada al hacer scroll (IntersectionObserver).
 *  - Flechas para recorrer las pistas y difuminado de sus bordes.
 *  - Nav de cristal al hacer scroll, con la pestaña de la sección visible.
 *  - Inclinación 3D muy leve y brillo siguiendo el cursor en posters y logos.
 *  - Auto-desplazamiento lento de los rieles (se pausa al interactuar).
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

  // ── Pistas: difuminado del borde izquierdo y flechas ─────
  // Las flechas son un atajo de ratón (el CSS solo las muestra con puntero
  // fino): con teclado se recorre tarjeta a tarjeta, así que quedan fuera del
  // orden de tabulación y del árbol de accesibilidad.
  var CHEVRON = '<svg class="ic" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9 18 6-6-6-6"/></svg>';
  document.querySelectorAll('.rail-scroll, .provider-strip').forEach(function (track) {
    var view = track.parentElement;
    var arrows = [];
    if (view && view.classList.contains('rail-view')) {
      [-1, 1].forEach(function (dir) {
        var arrow = document.createElement('button');
        arrow.type = 'button';
        arrow.tabIndex = -1;
        arrow.setAttribute('aria-hidden', 'true');
        arrow.className = 'rail-nav ' + (dir < 0 ? 'rail-nav-prev' : 'rail-nav-next');
        arrow.innerHTML = CHEVRON;
        arrow.addEventListener('click', function () {
          var step = Math.max(240, Math.round(track.clientWidth * 0.8));
          track.scrollBy({ left: dir * step, behavior: reduce ? 'auto' : 'smooth' });
        });
        view.appendChild(arrow);
        arrows.push(arrow);
      });
    }
    var mark = function () {
      var max = track.scrollWidth - track.clientWidth;
      track.classList.toggle('scrolled', track.scrollLeft > 4);
      if (arrows.length) {
        arrows[0].disabled = track.scrollLeft <= 4;
        arrows[1].disabled = track.scrollLeft >= max - 4;
      }
    };
    track.addEventListener('scroll', mark, { passive: true });
    // El ancho cambia sin scroll (pestañas, buscador, giro de pantalla).
    if (arrows.length) view.addEventListener('pointerenter', mark);
    window.addEventListener('resize', mark, { passive: true });
    mark();
  });

  // ── Nav: cristal al bajar y pestaña de la sección visible ─
  var nav = document.querySelector('.nav');
  if (nav) {
    var spy = [];
    nav.querySelectorAll('.nav-links a[href^="#"]').forEach(function (link) {
      var target = document.getElementById(link.getAttribute('href').slice(1));
      if (target) spy.push({ link: link, target: target });
    });
    var queued = false;
    var onScroll = function () {
      queued = false;
      nav.classList.toggle('scrolled', window.scrollY > 16);
      // Sección que cruza una línea situada a un tercio de la ventana.
      var line = window.innerHeight * 0.34;
      spy.forEach(function (item) {
        var box = item.target.getBoundingClientRect();
        if (box.top <= line && box.bottom > line) item.link.setAttribute('aria-current', 'true');
        else item.link.removeAttribute('aria-current');
      });
    };
    var queueScroll = function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(onScroll);
    };
    window.addEventListener('scroll', queueScroll, { passive: true });
    window.addEventListener('resize', queueScroll, { passive: true });
    onScroll();

    // Que la barra quepa en cualquier idioma: si su contenido desborda se
    // aplican, por orden, los recortes .nav-fit-1…3 de lib/theme.js. Se
    // vuelve a medir cuando cambia el ancho o la traducción cambia los textos.
    var inner = nav.querySelector('.nav-inner');
    var fits = ['nav-fit-1', 'nav-fit-2', 'nav-fit-3'];
    // Desborda si el último bloque se sale de la caja de contenido (el
    // padding lateral no cuenta como sitio libre).
    var overflows = function () {
      var last = inner.lastElementChild;
      if (!last) return false;
      var limit = inner.getBoundingClientRect().right - (parseFloat(getComputedStyle(inner).paddingRight) || 0);
      return last.getBoundingClientRect().right > limit + 0.5;
    };
    var fitNav = function () {
      fits.forEach(function (name) { nav.classList.remove(name); });
      for (var i = 0; i < fits.length && overflows(); i += 1) nav.classList.add(fits[i]);
    };
    if (inner) {
      fitNav();
      if ('ResizeObserver' in window) {
        var fitWatch = new ResizeObserver(fitNav);
        fitWatch.observe(inner);
        Array.prototype.forEach.call(inner.children, function (child) { fitWatch.observe(child); });
      } else {
        window.addEventListener('resize', fitNav, { passive: true });
      }
    }
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

  // ── Inclinación 3D muy leve y brillo (respuesta al cursor) ─
  var tiltEls = document.querySelectorAll('.poster-card .poster, .provider-tile .tile-logo, .studio-tile .studio-logo');
  tiltEls.forEach(function (el) {
    var raf = null, lastEv = null;
    // El póster enfocado además crece (mismo factor que su :hover en CSS).
    var grow = el.classList.contains('poster') ? ' translateY(-4px) scale(1.055)' : '';
    el.addEventListener('pointermove', function (ev) {
      lastEv = ev;
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = null;
        if (!lastEv) return;
        var r = el.getBoundingClientRect();
        var px = Math.min(1, Math.max(0, (lastEv.clientX - r.left) / r.width));
        var py = Math.min(1, Math.max(0, (lastEv.clientY - r.top) / r.height));
        el.style.transform = 'perspective(700px)' + grow + ' rotateY(' + ((px - 0.5) * 7.5).toFixed(2) + 'deg) rotateX(' + ((0.5 - py) * 5.5).toFixed(2) + 'deg)';
        el.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
        el.style.setProperty('--my', (py * 100).toFixed(1) + '%');
      });
    });
    el.addEventListener('pointerleave', function () {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      lastEv = null;
      el.style.transform = '';
    });
  });

  // ── Auto-desplazamiento fluido con requestAnimationFrame ─
  var autoRails = Array.prototype.slice.call(document.querySelectorAll('.rail-scroll[data-autoscroll]'));
  if (autoRails.length && typeof requestAnimationFrame === 'function') {
    var railStates = autoRails.map(function (rail) {
      var st = { rail: rail, paused: false, resumeAt: 0, visible: true, carry: 0, dir: 1 };
      ['pointerenter', 'touchstart', 'focusin'].forEach(function (evt) {
        rail.addEventListener(evt, function () { st.paused = true; }, { passive: true });
      });
      ['pointerleave', 'focusout'].forEach(function (evt) {
        rail.addEventListener(evt, function () { st.paused = false; st.resumeAt = performance.now() + 1600; });
      });
      rail.addEventListener('wheel', function () { st.resumeAt = performance.now() + 3200; }, { passive: true });
      return st;
    });
    if ('IntersectionObserver' in window) {
      var visObs = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          for (var i = 0; i < railStates.length; i += 1) {
            if (railStates[i].rail === e.target) railStates[i].visible = e.isIntersecting;
          }
        });
      }, { threshold: 0.05 });
      railStates.forEach(function (st) { visObs.observe(st.rail); });
    }
    var prevTs = 0;
    var stepRails = function (ts) {
      var dt = prevTs ? Math.min(48, ts - prevTs) : 16.67;
      prevTs = ts;
      if (!document.hidden) {
        for (var i = 0; i < railStates.length; i += 1) {
          var st = railStates[i];
          if (st.paused || !st.visible || ts < st.resumeAt || st.rail.offsetParent === null) continue;
          var maxScroll = st.rail.scrollWidth - st.rail.clientWidth;
          if (maxScroll < 12) continue;
          st.carry += dt * 0.022 * st.dir;
          var delta = st.carry > 0 ? Math.floor(st.carry) : Math.ceil(st.carry);
          if (delta !== 0) {
            st.carry -= delta;
            st.rail.scrollLeft += delta;
            if (st.rail.scrollLeft >= maxScroll - 2) st.dir = -1;
            else if (st.rail.scrollLeft <= 1) st.dir = 1;
          }
        }
      }
      requestAnimationFrame(stepRails);
    };
    requestAnimationFrame(stepRails);
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
  <div class="rail-view"><div class="provider-strip">${tiles}</div></div>
</section>`;
}

/**
 * Miniatura de un póster de TMDB. Las tarjetas miden 170 px de ancho como
 * mucho (340 px en pantallas 2×): w185 pesa la cuarta parte que w500 y se
 * ve igual. Cualquier otra URL se devuelve sin tocar.
 */
function posterThumb(url) {
  return String(url || '').replace(/^(https:\/\/image\.tmdb\.org\/t\/p\/)w\d+\//, '$1w185/');
}

/**
 * Póster minúsculo (w92) para el catálogo del addon.
 *
 * Cada póster es una petición del cliente a TMDB, y Stremio pinta filas de 20:
 * w500 pesa ~40 KB por título (~800 KB por fila) frente a ~5 KB de w92. El
 * catálogo es una lista, no una galería: al abrir la ficha se carga el grande.
 */
function posterList(url) {
  return String(url || '').replace(/^(https:\/\/image\.tmdb\.org\/t\/p\/)w\d+\//, '$1w92/');
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
  <div class="rail-view"><div class="rail-scroll" data-autoscroll="1">${cards}</div></div>
</section>`;
}

module.exports = {
  RAILS_CSS, RAILS_JS, escapeHtml,
  posterList, posterRailHtml, posterThumb, providerRailHtml,
};
