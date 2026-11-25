'use strict';

/**
 * Capa visual final de la web (portada y /configure): «Cine en casa».
 *
 * Segunda dirección sobre los tokens de marca (azul noche #060f1a + naranja
 * #ff8a2b): aurora cálida cenital, tipografía display gigante, pósters en
 * abanico con perspectiva, tarjetas con borde luminoso y el configurador con
 * riel lateral de progreso y barra de instalación flotante. Todo se resuelve
 * con CSS y los recursos que ya sirve el Worker: ni fuentes, ni imágenes
 * nuevas, ni scripts extra. Esta capa se inyecta al final del <style>, así
 * que manda sobre lib/theme.js y sobre el CSS propio de cada página.
 */

const REDESIGN_CSS = `
  :root {
    --bg: #060f1a;
    --bg-soft: #091627;
    --card: #0c1d2f;
    --card-hi: #122a42;
    --brand: #ff8a2b;
    --brand-2: #ffa552;
    --brand-3: #ffc98f;
    --brand-soft: rgba(255,138,43,.13);
    --text: #f6f8fb;
    --text-soft: #d3deea;
    --muted: #8ea3b8;
    --line: rgba(174,205,228,.12);
    --line-strong: rgba(174,205,228,.22);
    --glass: linear-gradient(165deg, rgba(255,255,255,.07), rgba(255,255,255,.016));
    --shadow-md: 0 18px 54px rgba(0,5,12,.6);
    --shadow-lg: 0 36px 96px rgba(0,5,12,.78);
    --ease: cubic-bezier(.2,.8,.2,1);
    --wrap: 1240px;
  }

  html { scroll-padding-top: 108px; }
  body { background: var(--bg); }
  ::selection { background: rgba(255,138,43,.36); }

  /* ── Aurora cenital: luz cálida sobre el azul noche ────────────────────── */
  .page-glow {
    height: 940px;
    background:
      radial-gradient(52vw 420px at 72% -12%, rgba(255,138,43,.17), transparent 66%),
      radial-gradient(40vw 380px at 18% -8%, rgba(56,130,196,.18), transparent 70%),
      radial-gradient(26vw 300px at 50% 0%, rgba(255,201,143,.07), transparent 72%);
  }
  .page-grid { display: none; }

  /* ── Navegación: cápsula flotante con borde luminoso ───────────────────── */
  .nav { padding-top: 16px; }
  .nav-inner {
    max-width: 1360px; height: 62px; border-radius: 20px;
    background: linear-gradient(180deg, rgba(13,32,50,.72), rgba(8,20,33,.72));
    border: 1px solid rgba(255,255,255,.13);
    box-shadow:
      0 14px 44px rgba(0,4,10,.5),
      inset 0 1px 0 rgba(255,255,255,.09),
      inset 0 -1px 0 rgba(255,138,43,.06);
    backdrop-filter: blur(22px) saturate(160%);
    -webkit-backdrop-filter: blur(22px) saturate(160%);
  }
  .nav.scrolled .nav-inner { background: rgba(7,17,28,.94); }
  .nav .brand span { letter-spacing: -.03em; }
  .nav .brand i { color: var(--brand-2); }
  .nav-links a { border-radius: 12px; }
  .nav-links a:hover { color: var(--brand-2); background: rgba(255,138,43,.1); }
  .nav-links a[aria-current="true"] {
    background: var(--grad); color: #10283d; font-weight: 700;
    box-shadow: 0 4px 16px rgba(245,130,31,.35);
  }
  .btn-primary { color: #10283d !important; font-weight: 700; }
  .btn-primary:hover { box-shadow: 0 10px 30px rgba(245,130,31,.4); transform: translateY(-1px); }
  .btn-ghost { border-color: var(--line-strong); border-radius: 980px; }
  .btn-ghost:hover { border-color: rgba(255,138,43,.5); background: rgba(255,138,43,.08); }
  :focus-visible { outline-color: var(--brand-2); }

  /* ── Hero: marquesina editorial con pósters en abanico ─────────────────── */
  .hero {
    margin-top: calc(-1 * var(--nav-h));
    padding-top: calc(var(--nav-h) + clamp(64px, 10vh, 120px));
    padding-bottom: 0;
    isolation: isolate;
    border-bottom: 1px solid rgba(255,255,255,.07);
  }
  .hero::before {
    content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none;
    background: linear-gradient(180deg, rgba(6,15,26,.34) 0%, transparent 24%, var(--bg) 96%);
  }
  .hero-backdrop { display: block; z-index: -2; }
  .hero-backdrop img { filter: saturate(.9) contrast(1.05) brightness(.94); object-position: 62% 42%; }
  .hero-backdrop::after {
    background:
      linear-gradient(90deg, rgba(5,13,22,.96) 0%, rgba(5,13,22,.88) 30%, rgba(5,13,22,.5) 58%, rgba(5,13,22,.42) 80%, rgba(5,13,22,.7) 100%),
      linear-gradient(180deg, rgba(5,13,22,.68) 0%, rgba(5,13,22,.04) 36%, rgba(6,15,26,.78) 88%, var(--bg) 100%),
      radial-gradient(40vw 340px at 74% 8%, rgba(255,138,43,.22), transparent 66%);
  }
  .hero-grid {
    min-height: clamp(540px, 70vh, 720px);
    grid-template-columns: minmax(0, 1.05fr) minmax(0, .95fr);
    gap: clamp(28px, 5vw, 80px);
    align-items: center;
    padding-bottom: 40px;
  }
  .hero-copy { gap: 22px; }
  .announce {
    border: 1px solid rgba(255,138,43,.4);
    background: rgba(10,24,38,.66);
    border-radius: 980px;
    box-shadow: 0 10px 28px rgba(0,0,0,.32), inset 0 1px 0 rgba(255,255,255,.1);
    backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  }
  .announce b {
    background: var(--grad); color: #10283d; font-weight: 800;
    border-radius: 980px; letter-spacing: .01em;
  }
  .announce:hover { border-color: rgba(255,165,82,.65); transform: translateY(-1px); }
  .hero h1 {
    max-width: 13ch; font-size: clamp(3.3rem, 6.8vw, 6rem);
    line-height: .95; letter-spacing: -.06em; font-weight: 800;
    text-shadow: 0 8px 42px rgba(0,0,0,.55);
  }
  .hero h1 em {
    background: linear-gradient(94deg, var(--brand-2) 10%, var(--brand-3) 55%, #ffe3c2 100%);
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent; color: transparent;
  }
  .lead { color: #d8e2ec; font-size: clamp(1.02rem, 1.5vw, 1.15rem); line-height: 1.74; max-width: 52ch; }
  .lead strong { color: #fff; font-weight: 650; }
  .hero-cta { gap: 14px; }
  .hero-cta .btn-lg { border-radius: 980px; padding-inline: 30px; }
  .hero-points { gap: 10px; }
  .hero-points li {
    color: #c9d6e2; border: 1px solid rgba(255,255,255,.14); border-radius: 980px;
    padding: 7px 14px; background: rgba(255,255,255,.05);
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  }
  .hero-points .ic { color: var(--brand-2); }

  /* Pósters: abanico en perspectiva con brillo de pantalla */
  .editorial-art { padding: 30px 20px 34px; perspective: 1200px; }
  .editorial-posters {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 18px; transform: rotate(-3deg) rotateY(-9deg) translateY(4px);
    transform-style: preserve-3d;
  }
  .editorial-posters img {
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,.22);
    box-shadow:
      0 36px 76px rgba(0,0,0,.74),
      0 0 0 1px rgba(255,138,43,.08),
      inset 0 1px 0 rgba(255,255,255,.14);
  }
  .editorial-posters img:nth-child(1) { transform: translateY(10px) rotate(-1deg); }
  .editorial-posters img:nth-child(2) { transform: translateY(-38px) rotate(1.5deg) translateZ(46px); z-index: 2; }
  .editorial-posters img:nth-child(3) { transform: translateY(18px) rotate(2.5deg); }
  .editorial-posters::after {
    content: ''; position: absolute; left: 4%; right: 4%; bottom: -18px; height: 40px;
    background: radial-gradient(ellipse at center, rgba(255,138,43,.3), transparent 70%);
    filter: blur(16px); z-index: -1;
  }
  .editorial-caption {
    margin-top: 48px; padding-top: 14px;
    border-top: 1px solid rgba(255,255,255,.14);
    color: #b9c8d6; font-size: 10px; letter-spacing: 2.6px; text-transform: uppercase;
  }
  .editorial-caption b { color: var(--brand-2); }

  /* Stats: banda de cristal con números display */
  .hero-stats {
    display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px; margin-top: 0; padding: 0 0 34px;
    border-top: 0; background: none;
  }
  .hero-stats .stat {
    display: grid; gap: 4px; padding: 18px 22px;
    border: 1px solid rgba(255,255,255,.11); border-left: 2px solid rgba(255,138,43,.55);
    border-radius: 16px;
    background: linear-gradient(160deg, rgba(255,255,255,.055), rgba(255,255,255,.014));
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.07);
  }
  .hero-stats .stat b {
    color: #fff; font-size: clamp(1.6rem, 2.8vw, 2.3rem);
    font-weight: 800; line-height: 1; letter-spacing: -.03em;
  }
  .hero-stats .stat span { color: var(--muted); font-size: .78rem; }

  /* ── Secciones y tarjetas ──────────────────────────────────────────────── */
  .section { padding-top: clamp(72px, 8.5vw, 112px); }
  .eyebrow { color: var(--brand-2); letter-spacing: .17em; }
  .eyebrow::before { background: var(--grad); width: 20px; height: 2px; }
  .title { font-size: clamp(2.1rem, 4.4vw, 3.3rem); letter-spacing: -.045em; }
  .title em { color: var(--brand-2); }
  .subtitle { color: var(--text-soft); }
  .tabs { background: rgba(255,255,255,.05); border-color: var(--line); border-radius: 980px; padding: 5px; }
  .tab { border-radius: 980px; }
  .tab.active { background: var(--grad); color: #10283d; font-weight: 700; box-shadow: 0 4px 14px rgba(245,130,31,.35); }
  .search-pill { background: rgba(255,255,255,.05); border-color: var(--line-strong); border-radius: 980px; }
  .search-pill:focus-within { box-shadow: 0 0 0 4px rgba(255,138,43,.22); border-color: var(--brand); }

  /* Rails: póster con elevación y halo naranja al pasar */
  .rail-head a { color: var(--brand-2); }
  .rail-head a:hover { color: var(--brand-3); }
  .poster-card { transition: transform .25s var(--ease), box-shadow .25s var(--ease); }
  .poster-card:hover {
    transform: translateY(-6px) scale(1.02);
    box-shadow: 0 22px 48px rgba(0,4,10,.66), 0 0 0 1px rgba(255,138,43,.34);
  }
  .poster-rating { color: #ffd60a; }
  .provider-strip a {
    border-radius: 14px; border: 1px solid var(--line);
    background: rgba(255,255,255,.04);
    transition: border-color .2s var(--ease), background .2s var(--ease), transform .2s var(--ease);
  }
  .provider-strip a:hover {
    border-color: rgba(255,138,43,.5); background: rgba(255,138,43,.1);
    transform: translateY(-3px);
  }

  /* Bento de funciones: cristal con icono en tile naranja */
  .feature {
    background: linear-gradient(158deg, rgba(255,255,255,.065), rgba(255,255,255,.014));
    border-color: var(--line); border-radius: 20px;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.07);
    transition: transform .25s var(--ease), border-color .25s var(--ease), background .25s var(--ease);
  }
  .feature:hover {
    border-color: rgba(255,138,43,.44);
    background: linear-gradient(158deg, rgba(255,138,43,.1), rgba(255,255,255,.02));
    transform: translateY(-3px);
  }
  .feature .fi {
    color: #10283d; background: var(--grad); border-color: transparent;
    border-radius: 12px; box-shadow: 0 6px 18px rgba(245,130,31,.32);
  }
  .feature h3 { color: #fff; }
  .feature p { color: var(--muted); }

  /* Pasos: numeración display */
  .step .step-n, .quick-number {
    font-weight: 800; letter-spacing: -.04em;
    background: linear-gradient(180deg, var(--brand-3), var(--brand));
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent; color: transparent;
  }

  .support, .donate, .cta-panel {
    border-color: rgba(255,138,43,.3);
    background:
      radial-gradient(40vw 200px at 88% 0%, rgba(255,138,43,.14), transparent 66%),
      linear-gradient(115deg, #132a3d 0%, #0a1a29 62%, #081522 100%);
    box-shadow: var(--shadow-md);
    border-radius: 24px;
  }
  .btn-discord { background: #5865f2; border-radius: 980px; }
  .faq details { border-bottom-color: var(--line); }
  .faq summary { border-radius: 10px; }
  .faq summary:hover { color: var(--brand-2); }
  .footer { border-top-color: var(--line); }

  /* ── Explorador de catálogos ───────────────────────────────────────────── */
  .explorer-toolbar {
    display: flex; gap: 16px; align-items: center; flex-wrap: wrap;
    background: rgba(255,255,255,.045); border: 1px solid var(--line);
    border-radius: 18px; padding: 16px 18px; margin: 26px 0 20px;
  }
  .explorer-search { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 210px; color: var(--brand); }
  .explorer-search input { width: 100%; min-width: 0; background: transparent; border: 0; color: var(--text); font: inherit; padding: 8px; }
  .explorer-type { color: var(--muted); font-size: .8rem; display: flex; gap: 12px; align-items: center; }
  .explorer-type select { font: inherit; background: #0e2337; color: var(--text); border: 1px solid var(--line); border-radius: 10px; padding: 10px; }
  #catalogCount { color: var(--muted); font-size: .78rem; min-width: 86px; }
  .explorer-group { border-bottom: 1px solid var(--line); padding: 6px 0 16px; }
  .explorer-group summary { display: flex; align-items: center; gap: 18px; cursor: pointer; list-style: none; padding: 18px 0; }
  .explorer-group summary::-webkit-details-marker { display: none; }
  .group-number { color: var(--brand); font-family: ui-monospace, monospace; font-size: .76rem; }
  .explorer-group summary strong { display: block; font-size: 1.24rem; font-weight: 650; letter-spacing: -.02em; }
  .explorer-group summary small { display: block; margin-top: 4px; color: var(--muted); font-size: .76rem; }
  .group-toggle { margin-left: auto; color: var(--muted); font-size: 1.5rem; transition: transform .2s var(--ease); }
  .explorer-group[open] .group-toggle { transform: rotate(45deg); color: var(--brand); }
  .catalog-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 9px; padding-bottom: 8px; }
  .catalog-item {
    display: flex; align-items: center; gap: 12px; min-width: 0;
    padding: 14px 12px; border: 1px solid var(--line); border-radius: 12px;
    background: rgba(255,255,255,.035); text-decoration: none;
    transition: background .2s var(--ease), border-color .2s var(--ease), transform .2s var(--ease);
  }
  .catalog-item:hover { background: rgba(255,138,43,.1); border-color: rgba(255,138,43,.45); transform: translateY(-2px); }
  .catalog-item b { display: block; font-size: .83rem; font-weight: 620; color: var(--text); overflow-wrap: anywhere; }
  .catalog-item small { display: block; margin-top: 3px; font-size: .72rem; color: var(--muted); }
  .catalog-symbol {
    display: grid; place-items: center; flex: 0 0 auto; width: 34px; height: 38px;
    border-radius: 9px; background: rgba(255,138,43,.12); color: var(--brand-2);
  }
  .catalog-arrow { margin-left: auto; color: var(--muted); }
  .explorer-note { color: var(--muted); font-size: .78rem; line-height: 1.7; margin-top: 18px; }
  .catalog-item[hidden], .explorer-group[hidden], #catalogEmpty[hidden] { display: none !important; }

  /* ── Configurador: cabecera con aurora y riel lateral de progreso ──────── */
  .cfg-hero {
    position: relative; overflow: hidden;
    border-bottom: 1px solid rgba(255,255,255,.09);
    background:
      radial-gradient(56vw 300px at 86% -12%, rgba(255,138,43,.2), transparent 68%),
      radial-gradient(30vw 240px at 12% 0%, rgba(56,130,196,.12), transparent 70%),
      linear-gradient(118deg, #0f2438, #081423 58%, #060f1a);
    padding: clamp(52px, 6.5vw, 88px) 0 clamp(30px, 3.6vw, 48px);
  }
  .cfg-hero::after {
    content: ''; position: absolute; inset: 0; pointer-events: none;
    background-image: repeating-linear-gradient(90deg, rgba(255,255,255,.022) 0 1px, transparent 1px 64px);
    mask-image: linear-gradient(180deg, #000, transparent 78%);
    -webkit-mask-image: linear-gradient(180deg, #000, transparent 78%);
  }
  .cfg-hero .wrap { position: relative; z-index: 1; gap: 16px; }
  .cfg-hero h1 { font-size: clamp(2.7rem, 6vw, 4.7rem); line-height: .98; letter-spacing: -.052em; font-weight: 800; }
  .cfg-hero h1 em {
    background: linear-gradient(94deg, var(--brand-2), var(--brand-3));
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent; color: transparent;
  }
  .cfg-hero p { color: var(--text-soft); max-width: 62ch; }
  .hero-ctas .btn { border-radius: 980px; }

  .quick-guide {
    background: rgba(255,255,255,.04); border: 1px solid var(--line);
    border-radius: 18px; box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
  }
  .quick-step { border-radius: 14px; }

  .layout { grid-template-columns: 252px minmax(0, 1fr); gap: 26px; }
  .side {
    position: sticky; top: 96px; padding: 10px;
    background: rgba(10,22,36,.6); border: 1px solid var(--line);
    border-radius: 18px; backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
  }
  .side a { border-radius: 12px; }
  .side a:hover { background: rgba(255,138,43,.08); }
  .side a[aria-current="true"] { background: var(--brand-soft); color: var(--brand-2); }
  .side a[aria-current="true"] .n {
    background: var(--grad); color: #10283d; border-color: transparent;
    font-weight: 800; box-shadow: 0 3px 10px rgba(245,130,31,.35);
  }

  /* Tarjetas de sección: número display a la izquierda */
  .card {
    background: linear-gradient(165deg, rgba(255,255,255,.045), rgba(255,255,255,.015));
    border: 1px solid var(--line); border-radius: 20px;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.05);
    scroll-margin-top: 108px;
  }
  .card-head { border-bottom-color: var(--line); }
  .card-num {
    color: transparent; background: linear-gradient(180deg, var(--brand-3), var(--brand));
    -webkit-background-clip: text; background-clip: text;
    font-weight: 800; font-size: 1.5rem; letter-spacing: -.04em;
  }
  .card-count { background: var(--brand-soft); color: var(--brand-2); border-radius: 980px; }

  .provider-tile, .studio-tile {
    background: rgba(255,255,255,.04) !important; border-color: var(--line) !important;
    border-radius: 14px !important;
    transition: border-color .2s var(--ease), background .2s var(--ease), transform .2s var(--ease);
  }
  .provider-tile:hover, .studio-tile:hover { transform: translateY(-2px); }
  .provider-tile:has(input:checked), .studio-tile:has(input:checked) {
    border-color: var(--brand) !important;
    background: var(--brand-soft) !important;
    box-shadow: 0 0 0 1px rgba(255,138,43,.4), 0 8px 22px rgba(245,130,31,.14);
  }
  .chip, .pill { border-radius: 980px; }
  .chip:hover, .pill:hover { border-color: var(--line-strong); }
  .chip:has(input:checked), .pill[aria-pressed="true"] {
    border-color: var(--brand); background: var(--brand-soft); color: var(--brand-3);
  }
  .manifest-box { background: #071423; border-color: var(--line); border-radius: 14px; }

  /* Barra de instalación flotante: cristal con luz superior naranja */
  .dock-inner {
    border: 1px solid rgba(255,255,255,.14);
    border-top: 1px solid rgba(255,138,43,.42);
    background: linear-gradient(180deg, rgba(13,30,47,.86), rgba(8,19,31,.86));
    backdrop-filter: blur(22px) saturate(160%);
    -webkit-backdrop-filter: blur(22px) saturate(160%);
    border-radius: 20px;
    box-shadow: 0 22px 60px rgba(0,4,10,.6), inset 0 1px 0 rgba(255,255,255,.08);
  }
  .dock .btn-primary { border-radius: 980px; box-shadow: 0 6px 20px rgba(245,130,31,.4); }

  @media (min-width: 1000px) {
    .explorer-group:not(:first-child) .catalog-grid {
      max-height: 330px; overflow-y: auto; padding-right: 8px;
      scrollbar-width: thin; scrollbar-color: #3c5a70 transparent;
    }
  }
  @media (max-width: 980px) {
    .hero-grid { gap: 30px; }
    .hero h1 { letter-spacing: -.04em; }
    .editorial-posters { gap: 13px; transform: rotate(-2deg) rotateY(-5deg); }
    .hero-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .catalog-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .layout { grid-template-columns: 1fr; }
    .side { position: static; }
  }
  @media (max-width: 680px) {
    .nav-inner { height: 56px; border-radius: 16px; }
    .hero { padding-top: calc(var(--nav-h) + 48px); }
    .hero-grid { grid-template-columns: 1fr; min-height: auto; gap: 22px; padding-bottom: 12px; }
    .hero h1 { font-size: clamp(2.9rem, 12.5vw, 4rem); letter-spacing: -.045em; }
    .editorial-art { max-width: 400px; margin: 14px auto 0; padding: 18px 18px 24px; }
    .editorial-posters { gap: 10px; }
    .editorial-caption { margin-top: 34px; }
    .hero-stats { gap: 10px; padding-bottom: 24px; }
    .hero-stats .stat { padding: 14px 16px; }
    .catalog-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .catalog-symbol { display: none; }
    .cfg-hero { padding-top: 50px; }
    .section { padding-top: 60px; }
    .head-row { align-items: flex-start; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .001ms !important; animation-duration: .001ms !important; }
  }
`;

module.exports = { REDESIGN_CSS };
