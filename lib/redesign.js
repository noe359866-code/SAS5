'use strict';

/**
 * Capa visual final de la web (portada y /configure): dirección cinematográfica.
 *
 * Azul noche profundo + naranja ámbar de la marca, luz rasante sobre el hero,
 * pósters en abanico y cristal oscuro. Todo se resuelve con CSS y los recursos
 * que ya sirve el Worker: ni fuentes, ni imágenes nuevas, ni scripts extra.
 * Esta capa se inyecta al final del <style>, así que manda sobre lib/theme.js.
 */

const REDESIGN_CSS = `
  :root {
    --bg: #050b12;
    --bg-soft: #08131d;
    --card: #0c1a26;
    --card-hi: #122738;
    --brand: #ff9a3c;
    --brand-2: #ffb469;
    --brand-3: #ffd0a0;
    --brand-soft: rgba(255,154,60,.14);
    --text: #f6f8fb;
    --text-soft: #cfdae6;
    --muted: #8ba0b2;
    --line: rgba(174,205,228,.13);
    --line-strong: rgba(174,205,228,.24);
    --glass: linear-gradient(160deg, rgba(255,255,255,.075), rgba(255,255,255,.018));
    --shadow-md: 0 20px 60px rgba(0,4,10,.62);
    --shadow-lg: 0 34px 90px rgba(0,4,10,.78);
    --ease: cubic-bezier(.2,.8,.2,1);
    --wrap: 1220px;
  }

  html { scroll-padding-top: 104px; }
  body { background: var(--bg); }
  ::selection { background: rgba(255,154,60,.34); }

  /* ── Navegación: barra flotante sobre la imagen ───────────────────────── */
  .nav { padding-top: 14px; }
  .nav-inner {
    max-width: 1380px; height: 64px; border-radius: 18px;
    background: rgba(5,13,21,.68);
    border: 1px solid rgba(255,255,255,.12);
    backdrop-filter: blur(20px) saturate(150%);
    -webkit-backdrop-filter: blur(20px) saturate(150%);
    box-shadow: 0 12px 40px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.08);
  }
  .nav.scrolled .nav-inner { background: rgba(5,11,18,.94); }
  .nav-links a:hover { color: var(--brand-2); background: rgba(255,154,60,.09); }
  .nav-links a[aria-current="true"] { background: var(--brand); color: #10283d; }
  .btn-primary { color: #231505 !important; }
  .btn-ghost { border-color: var(--line-strong); }
  :focus-visible { outline-color: var(--brand-2); }

  /* ── Hero: luz de atardecer y pósters protagonistas ──────────────────── */
  .page-glow, .page-grid { display: none; }
  .hero {
    margin-top: calc(-1 * var(--nav-h));
    padding-top: calc(var(--nav-h) + clamp(52px, 9vh, 104px));
    padding-bottom: 0;
    isolation: isolate;
    border-bottom: 1px solid rgba(255,255,255,.08);
  }
  .hero::before {
    content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none;
    background: linear-gradient(180deg, rgba(5,11,18,.28) 0%, transparent 26%, var(--bg) 98%);
  }
  .hero-backdrop { display: block; z-index: -2; }
  .hero-backdrop img { filter: saturate(.86) contrast(1.06); object-position: 65% 48%; }
  .hero-backdrop::after {
    background:
      linear-gradient(90deg, rgba(4,11,19,.97) 0%, rgba(4,11,19,.9) 27%, rgba(4,11,19,.58) 55%, rgba(4,11,19,.38) 78%, rgba(4,11,19,.72) 100%),
      linear-gradient(180deg, rgba(4,11,19,.72) 0%, rgba(4,11,19,.05) 34%, rgba(5,11,18,.72) 86%, var(--bg) 100%),
      radial-gradient(44vw 320px at 78% 16%, rgba(255,154,60,.26), transparent 68%);
  }
  .hero-grid {
    min-height: clamp(520px, 68vh, 700px);
    grid-template-columns: minmax(0, 1.06fr) minmax(0, .94fr);
    gap: clamp(24px, 5vw, 76px);
    align-items: center;
    padding-bottom: 34px;
  }
  .hero-copy { gap: 20px; }
  .announce {
    border: 1px solid rgba(255,154,60,.36);
    background: rgba(9,22,33,.7);
    box-shadow: 0 8px 24px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.08);
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  }
  .announce b { background: var(--brand); color: #231505; font-weight: 750; }
  .hero h1 {
    max-width: 14ch; font-size: clamp(3.1rem, 6.4vw, 5.6rem);
    line-height: .97; letter-spacing: -.055em; font-weight: 780;
    text-shadow: 0 6px 38px rgba(0,0,0,.5);
  }
  .hero h1 em {
    color: var(--brand-2);
    background: none; -webkit-text-fill-color: currentColor;
  }
  .lead { color: #d6e0e9; font-size: clamp(1rem, 1.45vw, 1.12rem); line-height: 1.72; max-width: 50ch; }
  .lead strong { color: #fff; font-weight: 650; }
  .hero-points li { color: #c5d2dd; border-color: rgba(255,255,255,.16); }
  .hero-points .ic { color: var(--brand); }

  .editorial-art { padding: 26px 18px 30px; }
  .editorial-posters {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px; transform: rotate(-4deg) translateY(6px);
  }
  .editorial-posters img {
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,.2);
    box-shadow: 0 32px 70px rgba(0,0,0,.72), 0 0 0 1px rgba(255,154,60,.1);
  }
  .editorial-posters img:nth-child(2) { transform: translateY(-34px) rotate(2deg); z-index: 2; }
  .editorial-posters img:nth-child(3) { transform: translateY(14px) rotate(3deg); }
  .editorial-posters::after {
    content: ''; position: absolute; left: 8%; right: 8%; bottom: -16px; height: 34px;
    background: radial-gradient(ellipse at center, rgba(255,154,60,.26), transparent 70%);
    filter: blur(14px); z-index: -1;
  }
  .editorial-caption {
    margin-top: 44px; padding-top: 12px;
    border-top: 1px solid rgba(255,255,255,.16);
    color: #b5c6d4; font-size: 10px; letter-spacing: 2.4px;
  }
  .editorial-caption b { color: var(--brand-2); }

  .hero-stats {
    display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0; margin-top: 0; padding: 22px 0 26px;
    border-top: 1px solid rgba(255,255,255,.12);
    background: linear-gradient(180deg, rgba(255,255,255,.035), transparent);
  }
  .hero-stats .stat {
    display: grid; gap: 3px; border-left: 1px solid rgba(255,255,255,.12);
    padding: 0 22px; background: none;
  }
  .hero-stats .stat:first-child { border-left: 0; padding-left: 0; }
  .hero-stats .stat b { color: #fff; font-size: clamp(1.5rem, 2.6vw, 2.1rem); font-weight: 700; line-height: 1; }
  .hero-stats .stat:nth-child(odd) b { color: var(--brand-2); }
  .hero-stats .stat span { color: var(--muted); font-size: .76rem; }

  /* ── Secciones y tarjetas ─────────────────────────────────────────────── */
  .section { padding-top: clamp(68px, 8vw, 104px); }
  .eyebrow { color: var(--brand-2); letter-spacing: .16em; }
  .eyebrow::before { background: var(--brand); }
  .title { font-size: clamp(2rem, 4.2vw, 3.1rem); letter-spacing: -.042em; }
  .title em { color: var(--brand-2); }
  .subtitle { color: var(--text-soft); }
  .tabs { background: rgba(255,255,255,.05); border-color: var(--line); }
  .tab.active { background: var(--brand); color: #231505; }
  .search-pill { background: rgba(255,255,255,.05); border-color: var(--line-strong); }
  .search-pill:focus-within { box-shadow: 0 0 0 4px rgba(255,154,60,.22); border-color: var(--brand); }
  .feature {
    background: linear-gradient(155deg, rgba(255,255,255,.07), rgba(255,255,255,.018));
    border-color: var(--line); border-radius: 18px;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.07);
  }
  .feature:hover { border-color: rgba(255,154,60,.42); background: linear-gradient(155deg, rgba(255,154,60,.11), rgba(255,255,255,.02)); }
  .feature .fi { color: var(--brand-2); background: var(--brand-soft); border-color: rgba(255,154,60,.25); }
  .feature h3 { color: #fff; }
  .feature p { color: var(--muted); }
  .support, .donate, .cta-panel {
    border-color: rgba(255,154,60,.28);
    background: linear-gradient(115deg, #152c3c 0%, #0b1a26 62%, #0a1520 100%);
    box-shadow: var(--shadow-md);
  }
  .btn-discord { background: #5865f2; }
  .faq details { border-bottom-color: var(--line); }
  .faq summary:hover { color: var(--brand-2); }
  .footer { border-top-color: var(--line); }

  /* ── Explorador de catálogos ──────────────────────────────────────────── */
  .explorer-toolbar {
    display: flex; gap: 16px; align-items: center; flex-wrap: wrap;
    background: rgba(255,255,255,.045); border: 1px solid var(--line);
    border-radius: 16px; padding: 16px 18px; margin: 26px 0 20px;
  }
  .explorer-search { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 210px; color: var(--brand); }
  .explorer-search input { width: 100%; min-width: 0; background: transparent; border: 0; color: var(--text); font: inherit; padding: 8px; }
  .explorer-type { color: var(--muted); font-size: .8rem; display: flex; gap: 12px; align-items: center; }
  .explorer-type select { font: inherit; background: #102130; color: var(--text); border: 1px solid var(--line); border-radius: 9px; padding: 10px; }
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
    padding: 14px 12px; border: 1px solid var(--line); border-radius: 11px;
    background: rgba(255,255,255,.035); text-decoration: none;
    transition: background .2s var(--ease), border-color .2s var(--ease), transform .2s var(--ease);
  }
  .catalog-item:hover { background: rgba(255,154,60,.1); border-color: rgba(255,154,60,.45); transform: translateY(-2px); }
  .catalog-item b { display: block; font-size: .83rem; font-weight: 620; color: var(--text); overflow-wrap: anywhere; }
  .catalog-item small { display: block; margin-top: 3px; font-size: .72rem; color: var(--muted); }
  .catalog-symbol {
    display: grid; place-items: center; flex: 0 0 auto; width: 34px; height: 38px;
    border-radius: 8px; background: rgba(255,154,60,.12); color: var(--brand-2);
  }
  .catalog-arrow { margin-left: auto; color: var(--muted); }
  .explorer-note { color: var(--muted); font-size: .78rem; line-height: 1.7; margin-top: 18px; }
  .catalog-item[hidden], .explorer-group[hidden], #catalogEmpty[hidden] { display: none !important; }

  /* ── Configurador: cabecera cinematográfica y panel lateral ───────────── */
  .cfg-hero {
    position: relative; overflow: hidden;
    border-bottom: 1px solid rgba(255,255,255,.1);
    background:
      radial-gradient(60vw 280px at 88% -10%, rgba(255,154,60,.18), transparent 70%),
      linear-gradient(120deg, #102637, #07121c 58%, #050b12);
    padding: clamp(48px, 6vw, 82px) 0 clamp(28px, 3.4vw, 44px);
  }
  .cfg-hero::after {
    content: ''; position: absolute; inset: 0; pointer-events: none;
    background-image: repeating-linear-gradient(90deg, rgba(255,255,255,.025) 0 1px, transparent 1px 64px);
    mask-image: linear-gradient(180deg, #000, transparent 80%);
    -webkit-mask-image: linear-gradient(180deg, #000, transparent 80%);
  }
  .cfg-hero .wrap { position: relative; z-index: 1; gap: 16px; }
  .cfg-hero h1 { font-size: clamp(2.6rem, 5.8vw, 4.5rem); line-height: 1; letter-spacing: -.05em; }
  .cfg-hero h1 em { color: var(--brand-2); }
  .cfg-hero p { color: var(--text-soft); max-width: 62ch; }
  .layout { grid-template-columns: 246px minmax(0, 1fr); gap: 24px; }
  .side {
    position: sticky; top: 92px; padding: 9px;
    background: rgba(255,255,255,.04); border: 1px solid var(--line);
    border-radius: 16px; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  }
  .side a { border-radius: 11px; }
  .side a[aria-current="true"] { background: var(--brand-soft); color: var(--brand-2); }
  .side a[aria-current="true"] .n { background: var(--brand); color: #231505; border-color: transparent; }
  .card { background: rgba(255,255,255,.035); border: 1px solid var(--line); border-radius: 16px; box-shadow: none; }
  .card-head { border-bottom-color: var(--line); }
  .card-num { color: var(--brand-2); background: var(--brand-soft); border-radius: 9px; }
  .provider-tile, .studio-tile { background: rgba(255,255,255,.04) !important; border-color: var(--line) !important; border-radius: 10px !important; }
  .provider-tile:has(input:checked), .studio-tile:has(input:checked) {
    border-color: var(--brand) !important; background: var(--brand-soft) !important;
  }
  .chip, .pill { border-radius: 9px; }
  .chip:has(input:checked), .pill[aria-pressed="true"] { border-color: var(--brand); }
  .quick-guide { background: rgba(255,255,255,.04); border: 1px solid var(--line); border-radius: 14px; }
  .manifest-box { background: #06101a; border-color: var(--line); }

  @media (min-width: 1000px) {
    .explorer-group:not(:first-child) .catalog-grid {
      max-height: 330px; overflow-y: auto; padding-right: 8px;
      scrollbar-width: thin; scrollbar-color: #3c5a70 transparent;
    }
  }
  @media (max-width: 980px) {
    .hero-grid { gap: 28px; }
    .hero h1 { letter-spacing: -.035em; }
    .editorial-posters { gap: 12px; }
    .hero-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); row-gap: 16px; }
    .hero-stats .stat:nth-child(3) { border-left: 0; padding-left: 0; }
    .catalog-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .layout { grid-template-columns: 1fr; }
    .side { position: static; }
  }
  @media (max-width: 680px) {
    .nav-inner { height: 58px; }
    .hero { padding-top: calc(var(--nav-h) + 44px); }
    .hero-grid { grid-template-columns: 1fr; min-height: auto; gap: 20px; padding-bottom: 10px; }
    .hero h1 { font-size: clamp(2.8rem, 12vw, 3.8rem); letter-spacing: -.04em; }
    .editorial-art { max-width: 380px; margin: 12px auto 0; padding: 18px 18px 22px; }
    .editorial-posters { gap: 9px; }
    .editorial-caption { margin-top: 30px; }
    .hero-stats { gap: 14px; padding-top: 18px; }
    .hero-stats .stat { padding: 0 12px 0 0; }
    .hero-stats .stat:nth-child(odd) { border-left: 0; }
    .catalog-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .catalog-symbol { display: none; }
    .cfg-hero { padding-top: 46px; }
    .section { padding-top: 56px; }
    .head-row { align-items: flex-start; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .001ms !important; animation-duration: .001ms !important; }
  }
`;

module.exports = { REDESIGN_CSS };
