'use strict';

/**
 * Sistema de diseño compartido (landing + /configure).
 *
 * Lenguaje visual: superficie oscura "slate" casi negra, acento degradado
 * violeta → azul → cian, tipografía geométrica del sistema, bordes de 1px
 * translúcidos, radios grandes y sombras suaves. Sin dependencias externas
 * (no se cargan fuentes ni CSS de terceros: cero peticiones y cero FOUC).
 *
 * Convenciones:
 *  - Tokens en :root (color, radio, sombra, espacio).
 *  - Componentes con prefijo claro (.btn, .panel, .tile, .chip…).
 *  - Nada de animaciones constantes: el movimiento es una respuesta al
 *    usuario (hover/focus/scroll) y respeta prefers-reduced-motion.
 */

const FONT_STACK =
  "'Inter var','Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const MONO_STACK = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace";

const THEME_CSS = `
  :root {
    /* Superficies */
    --bg: #07080d;
    --bg-soft: #0b0d15;
    --surface: rgba(255,255,255,.036);
    --surface-2: rgba(255,255,255,.062);
    --surface-3: rgba(255,255,255,.09);
    --line: rgba(255,255,255,.085);
    --line-strong: rgba(255,255,255,.16);
    /* Texto */
    --text: #f4f6fb;
    --text-soft: #cdd3e1;
    --muted: #98a1b4;
    /* Acentos */
    --brand: #7c5cff;
    --brand-2: #4f8cff;
    --brand-3: #22d3ee;
    --brand-soft: rgba(124,92,255,.16);
    --star: #ffc53d;
    --ok: #34d399;
    --danger: #f87171;
    --grad: linear-gradient(135deg,#7c5cff 0%,#4f8cff 48%,#22d3ee 100%);
    --grad-soft: linear-gradient(135deg,rgba(124,92,255,.22),rgba(34,211,238,.14));
    /* Forma */
    --r-sm: 10px;
    --r-md: 14px;
    --r-lg: 20px;
    --r-xl: 28px;
    --r-pill: 999px;
    --shadow-sm: 0 2px 8px rgba(0,0,0,.34);
    --shadow-md: 0 14px 34px rgba(0,0,0,.46);
    --shadow-lg: 0 28px 70px rgba(0,0,0,.6);
    --ring: 0 0 0 1px rgba(255,255,255,.1);
    --ease: cubic-bezier(.22,.68,0,1);
    color-scheme: dark;
  }

  *, *::before, *::after { box-sizing: border-box; }
  * { margin: 0; padding: 0; }
  /* overflow-x: clip (no hidden) para no romper position:sticky del nav */
  html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; scroll-padding-top: 96px; overflow-x: clip; }
  body {
    font-family: ${FONT_STACK};
    font-size: 16px;
    line-height: 1.55;
    color: var(--text);
    background-color: var(--bg);
    background-image:
      radial-gradient(1000px 560px at 8% -12%, rgba(124,92,255,.26), transparent 62%),
      radial-gradient(820px 480px at 92% -6%, rgba(34,211,238,.16), transparent 60%),
      radial-gradient(700px 700px at 50% 118%, rgba(79,140,255,.1), transparent 65%);
    background-repeat: no-repeat;
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    overflow-x: clip;
  }
  img { user-select: none; border: 0; }
  button, input, select { font: inherit; color: inherit; }
  a { color: var(--brand-3); text-underline-offset: 3px; }
  ::selection { background: rgba(124,92,255,.4); color: #fff; }
  :focus-visible { outline: 2px solid var(--brand-2); outline-offset: 3px; border-radius: 6px; }

  /* ── Fondo decorativo global ───────────────────────────────────────────── */
  .page-glow { position: fixed; inset: 0; z-index: -1; pointer-events: none; overflow: hidden; }
  .page-glow::before,
  .page-glow::after {
    content: ''; position: absolute; width: 44vw; height: 44vw; min-width: 380px; min-height: 380px;
    border-radius: 50%; filter: blur(90px); opacity: .5;
  }
  .page-glow::before { top: -14vw; left: -10vw; background: radial-gradient(circle, rgba(124,92,255,.5), transparent 66%); }
  .page-glow::after { top: 6vw; right: -16vw; background: radial-gradient(circle, rgba(34,211,238,.32), transparent 66%); }
  .page-grid {
    position: fixed; inset: 0; z-index: -1; pointer-events: none;
    background-image: linear-gradient(rgba(255,255,255,.028) 1px, transparent 1px),
                      linear-gradient(90deg, rgba(255,255,255,.028) 1px, transparent 1px);
    background-size: 64px 64px;
    mask-image: radial-gradient(ellipse 80% 60% at 50% 0%, #000 20%, transparent 78%);
    -webkit-mask-image: radial-gradient(ellipse 80% 60% at 50% 0%, #000 20%, transparent 78%);
  }

  /* ── Navegación ────────────────────────────────────────────────────────── */
  .nav {
    position: sticky; top: 0; left: 0; right: 0; z-index: 40;
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 12px clamp(16px, 4vw, 40px);
    background: linear-gradient(180deg, rgba(7,8,13,.86), rgba(7,8,13,0));
    border-bottom: 1px solid transparent;
    transition: background .28s var(--ease), border-color .28s var(--ease), backdrop-filter .28s var(--ease);
  }
  .nav.scrolled {
    background: rgba(8,9,15,.72);
    border-bottom-color: var(--line);
    backdrop-filter: blur(18px) saturate(1.6);
    -webkit-backdrop-filter: blur(18px) saturate(1.6);
  }
  .brand, .nav-brand {
    display: inline-flex; align-items: center; gap: 11px;
    text-decoration: none; color: var(--text); font-weight: 750; letter-spacing: -.01em;
  }
  .brand img, .nav-brand img {
    width: 34px; height: 34px; border-radius: 11px; background: #fff;
    box-shadow: 0 6px 18px rgba(124,92,255,.32), var(--ring);
  }
  .brand span, .nav-brand b { font-size: 1.02rem; }
  .brand span i, .nav-brand b i {
    font-style: normal;
    background: var(--grad); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent;
  }
  .nav-links { display: flex; gap: 4px; }
  .nav-links a {
    color: var(--text-soft); text-decoration: none; font-size: .88rem; font-weight: 550;
    padding: 8px 13px; border-radius: var(--r-pill); transition: color .18s, background .18s;
  }
  .nav-links a:hover { color: #fff; background: var(--surface-2); }
  .nav-actions { display: flex; align-items: center; gap: 8px; }

  /* ── Botones ───────────────────────────────────────────────────────────── */
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 9px;
    border: 1px solid transparent; cursor: pointer; text-decoration: none; white-space: nowrap;
    border-radius: var(--r-pill); font-weight: 650; font-size: .93rem; letter-spacing: -.005em;
    padding: 11px 20px; transition: transform .16s var(--ease), box-shadow .22s var(--ease),
      background .22s var(--ease), border-color .22s var(--ease), filter .22s var(--ease);
  }
  .btn:active { transform: translateY(1px) scale(.995); }
  .btn-primary, .btn-gold {
    background: var(--grad); color: #080a12; font-weight: 750;
    box-shadow: 0 10px 26px rgba(79,140,255,.34), inset 0 1px 0 rgba(255,255,255,.4);
  }
  .btn-primary:hover, .btn-gold:hover {
    transform: translateY(-2px); filter: saturate(1.08) brightness(1.05);
    box-shadow: 0 18px 40px rgba(79,140,255,.44), inset 0 1px 0 rgba(255,255,255,.5);
  }
  .btn-ghost {
    background: var(--surface-2); color: var(--text); border-color: var(--line-strong);
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  }
  .btn-ghost:hover { background: var(--surface-3); transform: translateY(-2px); border-color: rgba(255,255,255,.26); }
  .btn-sm { padding: 8px 14px; font-size: .82rem; }
  .icon-btn, .icon-pill {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    height: 40px; padding: 0 14px; border-radius: var(--r-pill);
    background: var(--surface-2); border: 1px solid var(--line);
    color: var(--text); text-decoration: none; font-size: .86rem; font-weight: 600; cursor: pointer;
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
    transition: background .18s, transform .18s var(--ease), border-color .18s;
  }
  .icon-btn:hover, .icon-pill:hover { background: var(--surface-3); border-color: var(--line-strong); transform: translateY(-1px); }
  .icon-pill.gold { background: var(--grad); border-color: transparent; color: #080a12; font-weight: 750; box-shadow: 0 8px 22px rgba(79,140,255,.34); }
  @media (max-width: 720px) { .icon-btn .lbl, .icon-pill .lbl { display: none; } .icon-btn, .icon-pill { padding: 0 12px; } }

  /* ── Badges y etiquetas ────────────────────────────────────────────────── */
  .badge {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 6px 13px; border-radius: var(--r-pill);
    background: rgba(124,92,255,.12); border: 1px solid rgba(124,92,255,.34);
    color: #c9bcff; font-size: .72rem; font-weight: 650; letter-spacing: .1em; text-transform: uppercase;
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  }
  .badge .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--brand-3); box-shadow: 0 0 12px var(--brand-3); }

  /* ── Hero ──────────────────────────────────────────────────────────────── */
  .hero { position: relative; overflow: hidden; isolation: isolate; }
  .hero-bg {
    position: absolute; inset: 0; z-index: -2;
    background-size: cover; background-position: center 18%;
    opacity: .42; transform: scale(1.06); filter: saturate(.85);
  }
  .hero-veil {
    position: absolute; inset: 0; z-index: -1; pointer-events: none;
    background:
      radial-gradient(900px 420px at 50% 6%, rgba(124,92,255,.22), transparent 68%),
      linear-gradient(180deg, rgba(7,8,13,.7) 0%, rgba(7,8,13,.42) 42%, var(--bg) 96%);
  }
  .hero-content, .hero-inner { position: relative; z-index: 1; }
  .hero h1 {
    font-weight: 800; letter-spacing: -.035em; line-height: 1.02;
    font-size: clamp(2.5rem, 6.4vw, 4.35rem); color: #fff;
    text-wrap: balance; margin: 18px 0 14px;
  }
  .hero h1 em {
    font-style: normal;
    background: var(--grad); -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent; color: transparent;
  }
  .hero p, .hero .lead {
    color: var(--text-soft); font-size: clamp(.96rem, 1.5vw, 1.06rem);
    line-height: 1.62; max-width: 62ch; text-wrap: pretty;
  }
  .hero p strong { color: #fff; font-weight: 650; }

  /* ── Métricas ──────────────────────────────────────────────────────────── */
  .stats { display: flex; gap: 8px; flex-wrap: wrap; }
  .stat {
    display: inline-flex; align-items: baseline; gap: 6px;
    padding: 7px 14px; border-radius: var(--r-pill);
    background: var(--surface); border: 1px solid var(--line);
    color: var(--muted); font-size: .78rem; font-weight: 500;
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  }
  .stat b {
    font-size: .95rem; font-weight: 750; color: var(--text);
    font-variant-numeric: tabular-nums; letter-spacing: -.01em;
  }
  .live-dot {
    display: inline-block; width: 7px; height: 7px; border-radius: 50%;
    background: var(--ok); margin-right: 6px; box-shadow: 0 0 0 0 rgba(52,211,153,.7);
    animation: pulse-dot 2.4s ease-out infinite;
  }
  @keyframes pulse-dot {
    0% { box-shadow: 0 0 0 0 rgba(52,211,153,.5); }
    70% { box-shadow: 0 0 0 7px rgba(52,211,153,0); }
    100% { box-shadow: 0 0 0 0 rgba(52,211,153,0); }
  }

  /* ── Buscador ──────────────────────────────────────────────────────────── */
  .search-pill {
    display: flex; align-items: center; gap: 10px;
    max-width: 640px; padding: 6px 6px 6px 18px; border-radius: var(--r-pill);
    background: rgba(15,17,26,.78); border: 1px solid var(--line-strong);
    box-shadow: var(--shadow-md); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
    transition: border-color .22s, box-shadow .22s;
  }
  .search-pill:focus-within {
    border-color: rgba(124,92,255,.65);
    box-shadow: var(--shadow-md), 0 0 0 4px rgba(124,92,255,.16);
  }
  .search-pill .s-icon { opacity: .6; font-size: .95rem; }
  .search-pill input {
    flex: 1; min-width: 0; background: transparent; border: 0; outline: 0;
    color: var(--text); font-size: .95rem;
  }
  .search-pill input::placeholder { color: var(--muted); }
  .search-pill button {
    border: 0; cursor: pointer; border-radius: var(--r-pill);
    background: var(--grad); color: #080a12; font-weight: 750; font-size: .87rem;
    padding: 10px 20px; transition: filter .18s, transform .18s var(--ease);
  }
  .search-pill button:hover { filter: brightness(1.06); transform: translateY(-1px); }
  .search-hint { font-size: .76rem; color: var(--muted); }

  /* ── Pestañas (control segmentado) ─────────────────────────────────────── */
  .tabs {
    display: inline-flex; gap: 4px; padding: 4px;
    border-radius: var(--r-pill); background: rgba(15,17,26,.72);
    border: 1px solid var(--line); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  }
  .tab {
    border: 1px solid transparent; background: transparent; color: var(--muted);
    font-size: .9rem; font-weight: 600; padding: 8px 18px; border-radius: var(--r-pill);
    cursor: pointer; transition: color .18s, background .18s, box-shadow .18s;
  }
  .tab:hover { color: var(--text); }
  .tab.active {
    color: #fff; background: var(--surface-3); border-color: var(--line-strong);
    box-shadow: 0 6px 18px rgba(0,0,0,.36);
  }
  .tab-panel[hidden] { display: none; }

  /* ── Superficies / paneles ─────────────────────────────────────────────── */
  .panel {
    background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg);
    padding: 18px 20px; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  }
  .panel h3 {
    font-size: .74rem; font-weight: 650; letter-spacing: .13em; text-transform: uppercase;
    color: var(--muted); margin-bottom: 12px; display: flex; align-items: center; gap: 8px;
  }
  .feature {
    position: relative; overflow: hidden;
    background: linear-gradient(165deg, rgba(255,255,255,.06), rgba(255,255,255,.022));
    border: 1px solid var(--line); border-radius: var(--r-lg); padding: 20px;
    transition: transform .28s var(--ease), border-color .28s, box-shadow .28s;
  }
  .feature::before {
    content: ''; position: absolute; inset: 0; border-radius: inherit; opacity: 0;
    background: radial-gradient(320px circle at var(--fx, 50%) var(--fy, 0%), rgba(124,92,255,.18), transparent 62%);
    transition: opacity .3s;
  }
  .feature:hover { transform: translateY(-4px); border-color: rgba(124,92,255,.42); box-shadow: var(--shadow-md); }
  .feature:hover::before { opacity: 1; }
  .feature .fi {
    display: inline-flex; align-items: center; justify-content: center;
    width: 42px; height: 42px; border-radius: 13px; font-size: 1.15rem;
    background: var(--grad-soft); border: 1px solid rgba(124,92,255,.3);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.14);
    transition: transform .3s var(--ease);
  }
  .feature:hover .fi { transform: translateY(-2px) scale(1.06); }
  .feature h3 { font-size: .98rem; font-weight: 700; color: #fff; margin: 12px 0 6px; letter-spacing: -.01em; }
  .feature p { font-size: .845rem; color: var(--muted); line-height: 1.55; }

  /* ── Encabezados de sección ────────────────────────────────────────────── */
  .section-head { display: flex; align-items: flex-start; gap: 14px; margin: 44px 0 16px; }
  .section-num {
    flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
    min-width: 34px; height: 34px; padding: 0 8px; border-radius: 11px;
    background: var(--grad-soft); border: 1px solid rgba(124,92,255,.3);
    color: #cfc3ff; font-size: .78rem; font-weight: 750; font-variant-numeric: tabular-nums;
  }
  .section-head h2 { font-size: clamp(1.15rem, 2.1vw, 1.4rem); font-weight: 750; letter-spacing: -.02em; color: #fff; }
  .section-head small { display: block; color: var(--muted); font-size: .83rem; margin-top: 3px; line-height: 1.5; }
  .hint { color: var(--muted); font-size: .78rem; line-height: 1.55; margin-top: 10px; }
  .hint strong { color: var(--text-soft); font-weight: 600; }

  /* ── Pills de opción ───────────────────────────────────────────────────── */
  .pills { display: flex; gap: 8px; flex-wrap: wrap; }
  .pill {
    background: var(--surface-2); border: 1px solid var(--line); color: var(--text-soft);
    padding: 8px 15px; border-radius: var(--r-pill); cursor: pointer; font-size: .855rem; font-weight: 550;
    transition: background .16s, border-color .16s, color .16s, transform .16s var(--ease);
  }
  .pill:hover { border-color: var(--line-strong); color: #fff; transform: translateY(-1px); }
  .pill[aria-pressed="true"] {
    background: var(--grad); border-color: transparent; color: #080a12; font-weight: 700;
    box-shadow: 0 8px 20px rgba(79,140,255,.32);
  }

  /* ── Chips con checkbox ────────────────────────────────────────────────── */
  .chips { display: flex; gap: 10px; flex-wrap: wrap; }
  .chip {
    display: inline-flex; align-items: center; gap: 10px;
    background: var(--surface); border: 1px solid var(--line);
    padding: 11px 16px; border-radius: var(--r-md); cursor: pointer;
    font-size: .87rem; color: var(--text-soft);
    transition: border-color .16s, background .16s, transform .16s var(--ease), box-shadow .16s;
  }
  .chip:hover { transform: translateY(-1px); border-color: var(--line-strong); background: var(--surface-2); }
  .chip:has(input:checked) {
    border-color: rgba(124,92,255,.55); background: rgba(124,92,255,.1); color: #fff;
    box-shadow: 0 0 0 1px rgba(124,92,255,.22);
  }
  .chip input {
    appearance: none; -webkit-appearance: none; width: 17px; height: 17px; flex: 0 0 auto;
    border: 1.5px solid var(--line-strong); border-radius: 5px; background: rgba(0,0,0,.25);
    cursor: pointer; position: relative; transition: background .16s, border-color .16s;
  }
  /* La marca del check va como background-image: los pseudo-elementos no se
     pintan en <input> (es un elemento reemplazado). */
  .chip input:checked {
    background-color: var(--brand-2);
    background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='none' stroke='%23090b12' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round' d='M3.4 8.6l3 3 6.2-6.4'/%3E%3C/svg%3E");
    background-size: 118% 118%; background-position: center; background-repeat: no-repeat;
    border-color: transparent;
  }

  /* ── Tiles de plataforma / estudio ─────────────────────────────────────── */
  .provider-tile, .studio-tile { position: relative; cursor: pointer; }
  .provider-tile input, .studio-tile input { position: absolute; opacity: 0; pointer-events: none; }
  .tile-check {
    position: absolute; top: -6px; right: -6px; width: 24px; height: 24px; border-radius: 50%;
    background: var(--grad); color: #080a12; font-weight: 900; font-size: .76rem;
    display: none; align-items: center; justify-content: center;
    box-shadow: 0 4px 12px rgba(0,0,0,.5); z-index: 2;
  }
  .provider-tile input:checked ~ .tile-check,
  .studio-tile input:checked ~ .tile-check { display: flex; }
  .tile-name {
    font-size: .76rem; color: var(--muted); text-align: center; line-height: 1.3;
    min-height: 2.3em; transition: color .16s;
  }
  .provider-tile:has(input:checked) .tile-name,
  .studio-tile:has(input:checked) .tile-name { color: #fff; font-weight: 550; }

  /* ── Utilidades ────────────────────────────────────────────────────────── */
  .section-gap { margin-top: 34px; }
  .muted { color: var(--muted); }
  .no-results { display: none; text-align: center; color: var(--muted); font-size: .92rem; padding: 30px 10px 8px; }
  .page-footer {
    border-top: 1px solid var(--line); color: var(--muted); font-size: .75rem; line-height: 1.7;
    max-width: 1220px; margin: 40px auto 0; padding: 26px clamp(16px, 4vw, 32px) 34px;
  }
  .page-footer a { color: var(--text-soft); text-decoration: none; border-bottom: 1px solid rgba(255,255,255,.18); }
  .page-footer a:hover { color: #fff; border-bottom-color: var(--brand-3); }

  @media (max-width: 720px) {
    .nav-links { display: none; }
    .hero-bg { opacity: .34; }
    .feature { padding: 16px; }
    .section-head { margin-top: 34px; }
  }
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
  }
`;

module.exports = { THEME_CSS, FONT_STACK, MONO_STACK };
