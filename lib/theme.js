'use strict';

/**
 * Sistema de diseño compartido (landing + /configure).
 *
 * Lenguaje visual: interfaz cinematográfica en azul noche, acentos lavanda y
 * cian, superficies sobrias, titulares editoriales, iconos SVG de trazo y una
 * navegación compacta. Sin dependencias externas: no se cargan fuentes, CSS ni
 * scripts de terceros (cero peticiones, cero FOUC).
 *
 * Convenciones:
 *  - Tokens en :root (color, radio, sombra, medidas).
 *  - Componentes con prefijo claro (.btn, .pill, .chip, .feature, .support…).
 *  - El movimiento es una respuesta al usuario (hover, foco, scroll); lo
 *    único que se mueve solo es decorativo y se detiene con
 *    prefers-reduced-motion.
 */

const FONT_STACK =
  "'Inter var','Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const MONO_STACK = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace";

// Grano de película: una tesela SVG generada con feTurbulence (sin imagen).
const NOISE_TILE =
  "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .5 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const CHECK_MARK =
  "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='none' stroke='%2306070d' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round' d='M3.4 8.6l3 3 6.2-6.4'/%3E%3C/svg%3E\")";

const THEME_CSS = `
  :root {
    /* Superficies */
    --bg: #050508;
    --bg-soft: #0b0b14;
    --ink: #0c0d17;
    --surface: rgba(255,255,255,.035);
    --surface-2: rgba(255,255,255,.06);
    --surface-3: rgba(255,255,255,.095);
    --line: rgba(255,255,255,.08);
    --line-strong: rgba(255,255,255,.15);
    /* Texto */
    --text: #f5f6fb;
    --text-soft: #c7cce0;
    --muted: #8a92a8;
    /* Acentos */
    --brand: #7c5cff;
    --brand-2: #4f8cff;
    --brand-3: #22d3ee;
    --brand-4: #c084fc;
    --brand-soft: rgba(124,92,255,.16);
    --star: #ffc53d;
    --ok: #34d399;
    --warn: #fbbf24;
    --danger: #fb7185;
    --discord: #5865f2;
    --grad: linear-gradient(135deg,#7c5cff 0%,#4f8cff 48%,#22d3ee 100%);
    --grad-soft: linear-gradient(135deg,rgba(124,92,255,.22),rgba(34,211,238,.14));
    --grad-text: linear-gradient(115deg,#c4b5ff 0%,#8fb4ff 46%,#67e8f9 100%);
    /* Forma */
    --r-sm: 10px;
    --r-md: 14px;
    --r-lg: 20px;
    --r-xl: 28px;
    --r-pill: 999px;
    --shadow-sm: 0 2px 8px rgba(0,0,0,.36);
    --shadow-md: 0 14px 34px rgba(0,0,0,.5);
    --shadow-lg: 0 30px 80px rgba(0,0,0,.62);
    --ring: 0 0 0 1px rgba(255,255,255,.1);
    --glass: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.018));
    --ease: cubic-bezier(.22,.68,0,1);
    /* Medidas */
    --wrap: 1200px;
    --pad: clamp(16px, 4vw, 32px);
    color-scheme: dark;
  }

  *, *::before, *::after { box-sizing: border-box; }
  * { margin: 0; padding: 0; }
  /* overflow-x: clip (no hidden) para no romper position:sticky del nav */
  html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; scroll-padding-top: 92px; overflow-x: clip; }
  body {
    position: relative;
    font-family: ${FONT_STACK};
    font-size: 16px;
    line-height: 1.55;
    color: var(--text);
    background-color: var(--bg);
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    overflow-x: clip;
  }
  img { user-select: none; border: 0; max-width: 100%; }
  button, input, select { font: inherit; color: inherit; }
  a { color: var(--brand-3); text-underline-offset: 3px; }
  ::selection { background: rgba(124,92,255,.45); color: #fff; }
  :focus-visible { outline: 2px solid #93a5ff; outline-offset: 3px; border-radius: 8px; }
  [hidden] { display: none !important; }
  html[data-i18n-pending] body { visibility: hidden; }

  /* Iconos SVG (lib/icons.js): heredan el color del texto. */
  .ic { flex: 0 0 auto; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; vertical-align: middle; }
  .ic-fill { fill: currentColor; stroke: none; }

  /* ── Fondo decorativo: aurora + rejilla + grano ────────────────────────── */
  .page-glow {
    position: absolute; top: 0; left: 0; right: 0; height: 1180px; z-index: -2; pointer-events: none; overflow: hidden;
    background:
      radial-gradient(62vw 560px at 10% -6%, rgba(124,92,255,.36), transparent 64%),
      radial-gradient(46vw 460px at 97% 2%, rgba(34,211,238,.17), transparent 62%),
      radial-gradient(52vw 420px at 60% -12%, rgba(192,132,252,.18), transparent 64%);
    mask-image: linear-gradient(180deg, #000 55%, transparent 100%);
    -webkit-mask-image: linear-gradient(180deg, #000 55%, transparent 100%);
  }
  .page-glow::after {
    content: ''; position: absolute; inset: 0;
    background-image: ${NOISE_TILE}; background-size: 180px 180px;
    opacity: .07; mix-blend-mode: overlay;
  }
  .page-grid {
    position: absolute; top: 0; left: 0; right: 0; height: 900px; z-index: -1; pointer-events: none;
    background-image: linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px),
                      linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px);
    background-size: 56px 56px;
    mask-image: radial-gradient(ellipse 85% 75% at 50% 0%, #000 12%, transparent 74%);
    -webkit-mask-image: radial-gradient(ellipse 85% 75% at 50% 0%, #000 12%, transparent 74%);
  }

  /* ── Contenedores y titulares de sección ───────────────────────────────── */
  .wrap { max-width: var(--wrap); margin: 0 auto; padding-left: var(--pad); padding-right: var(--pad); }
  .section { padding-top: clamp(64px, 9vw, 112px); }
  /* Al saltar a un ancla, parte del aire de la sección queda bajo el nav. */
  .section[id] { scroll-margin-top: calc(24px - clamp(64px, 9vw, 112px)); }
  .eyebrow {
    display: inline-flex; align-items: center; gap: 10px;
    color: #b9abff; font-size: .74rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase;
  }
  .eyebrow::before { content: ''; width: 20px; height: 2px; border-radius: 2px; background: var(--grad); }
  .title {
    margin-top: 12px; color: #fff; font-weight: 800; letter-spacing: -.035em; line-height: 1.08;
    font-size: clamp(1.7rem, 3.6vw, 2.6rem); text-wrap: balance;
  }
  .title em, .grad-text {
    font-style: normal;
    background: var(--grad-text); -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent; color: transparent;
  }
  .subtitle {
    margin-top: 12px; max-width: 62ch; color: var(--text-soft);
    font-size: clamp(.96rem, 1.4vw, 1.05rem); line-height: 1.62; text-wrap: pretty;
  }
  .head-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px 28px; flex-wrap: wrap; margin-bottom: 26px; }

  /* ── Navegación: isla flotante de cristal ──────────────────────────────── */
  .nav { position: sticky; top: 0; z-index: 50; padding: 12px var(--pad) 0; pointer-events: none; }
  .nav-inner {
    pointer-events: auto; max-width: var(--wrap); margin: 0 auto; height: 58px;
    display: flex; align-items: center; justify-content: space-between; gap: 14px;
    padding: 0 9px 0 14px; border-radius: 18px;
    background: rgba(11,11,20,.55); border: 1px solid var(--line);
    backdrop-filter: blur(18px) saturate(1.7); -webkit-backdrop-filter: blur(18px) saturate(1.7);
    box-shadow: 0 10px 30px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.06);
    transition: background .28s var(--ease), border-color .28s var(--ease), box-shadow .28s var(--ease);
  }
  .nav.scrolled .nav-inner {
    background: rgba(11,11,20,.84); border-color: var(--line-strong);
    box-shadow: 0 16px 40px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.07);
  }
  .brand {
    display: inline-flex; align-items: center; gap: 10px; flex: 0 0 auto;
    text-decoration: none; color: var(--text); font-weight: 750; letter-spacing: -.015em;
  }
  .brand img {
    width: 32px; height: 32px; border-radius: 10px; background: #fff;
    box-shadow: 0 6px 18px rgba(124,92,255,.4), var(--ring);
  }
  .brand span { font-size: 1.02rem; }
  .brand span i {
    font-style: normal;
    background: var(--grad); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent;
  }
  .nav-links { display: flex; gap: 2px; }
  .nav-links a {
    display: inline-flex; align-items: center; gap: 7px; height: 36px; padding: 0 12px; border-radius: 11px;
    color: var(--text-soft); text-decoration: none; font-size: .87rem; font-weight: 550;
    transition: color .18s, background .18s;
  }
  .nav-links a:hover { color: #fff; background: var(--surface-2); }
  .nav-actions { display: flex; align-items: center; gap: 8px; }
  .nav-language {
    display: inline-flex; align-items: center; gap: 6px; height: 38px; padding: 0 9px;
    border: 1px solid var(--line-strong); border-radius: 12px; background: var(--surface-2); color: var(--text-soft);
  }
  .nav-language .ic { color: var(--muted); }
  .nav-language select {
    max-width: 104px; padding: 0; border: 0; outline: 0; background: transparent; color: inherit;
    cursor: pointer; font-size: .76rem; font-weight: 600;
  }
  .nav-language option { background: #11131c; color: #f5f6fb; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  /* El botón de soporte solo hace falta cuando los enlaces están ocultos. */
  .nav-actions .nav-support { display: none; padding: 0; width: 38px; }

  /* ── Botones ───────────────────────────────────────────────────────────── */
  .btn {
    position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 9px;
    height: 46px; padding: 0 20px; border-radius: 14px; border: 1px solid transparent;
    cursor: pointer; text-decoration: none; white-space: nowrap;
    font-weight: 650; font-size: .94rem; letter-spacing: -.005em; color: var(--text);
    transition: transform .16s var(--ease), box-shadow .22s var(--ease), background .22s var(--ease),
      border-color .22s var(--ease), filter .22s var(--ease);
  }
  .btn:active { transform: translateY(1px) scale(.99); }
  .btn-primary {
    overflow: hidden; background: var(--grad); color: #06070d; font-weight: 750;
    box-shadow: 0 10px 30px rgba(92,110,255,.42), inset 0 1px 0 rgba(255,255,255,.45);
  }
  .btn-primary::after {
    content: ''; position: absolute; top: 0; bottom: 0; left: -60%; width: 40%;
    background: linear-gradient(100deg, transparent, rgba(255,255,255,.5), transparent);
    transform: skewX(-18deg); transition: left .6s var(--ease);
  }
  .btn-primary:hover {
    transform: translateY(-2px); filter: saturate(1.08) brightness(1.05);
    box-shadow: 0 18px 44px rgba(92,110,255,.55), inset 0 1px 0 rgba(255,255,255,.55);
  }
  .btn-primary:hover::after { left: 120%; }
  .btn-ghost {
    background: var(--surface-2); border-color: var(--line-strong);
  }
  .btn-ghost:hover { background: var(--surface-3); transform: translateY(-2px); border-color: rgba(255,255,255,.28); }
  .btn-discord { background: var(--discord); color: #fff; box-shadow: 0 10px 28px rgba(88,101,242,.42), inset 0 1px 0 rgba(255,255,255,.22); }
  .btn-discord:hover { transform: translateY(-2px); filter: brightness(1.1); box-shadow: 0 18px 40px rgba(88,101,242,.55), inset 0 1px 0 rgba(255,255,255,.28); }
  .btn-sm { height: 38px; padding: 0 14px; font-size: .84rem; border-radius: 12px; gap: 7px; }
  .btn-lg { height: 54px; padding: 0 26px; font-size: 1rem; border-radius: 16px; }

  /* ── Etiquetas ─────────────────────────────────────────────────────────── */
  .badge {
    display: inline-flex; align-items: center; gap: 8px; height: 30px; padding: 0 13px; border-radius: var(--r-pill);
    background: rgba(124,92,255,.12); border: 1px solid rgba(124,92,255,.34);
    color: #cfc4ff; font-size: .72rem; font-weight: 650; letter-spacing: .1em; text-transform: uppercase;
  }
  .badge .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--brand-3); box-shadow: 0 0 12px var(--brand-3); }
  .code {
    display: inline-flex; align-items: center; justify-content: center; min-width: 32px; height: 22px; padding: 0 6px;
    border-radius: 7px; background: rgba(255,255,255,.08); color: var(--text-soft);
    font-family: ${MONO_STACK}; font-size: .68rem; font-weight: 700; letter-spacing: .02em;
  }

  /* ── Métricas ──────────────────────────────────────────────────────────── */
  .stats { display: flex; gap: 8px; flex-wrap: wrap; }
  .stat {
    display: inline-flex; align-items: baseline; gap: 6px; padding: 7px 13px; border-radius: 12px;
    background: var(--surface); border: 1px solid var(--line);
    color: var(--muted); font-size: .78rem; font-weight: 500;
  }
  .stat b { font-size: .96rem; font-weight: 750; color: var(--text); font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
  .live-dot {
    display: inline-block; width: 7px; height: 7px; border-radius: 50%; align-self: center;
    background: var(--ok); margin-right: 2px; box-shadow: 0 0 0 0 rgba(52,211,153,.7);
    animation: pulse-dot 2.4s ease-out infinite;
  }
  @keyframes pulse-dot {
    0% { box-shadow: 0 0 0 0 rgba(52,211,153,.5); }
    70% { box-shadow: 0 0 0 7px rgba(52,211,153,0); }
    100% { box-shadow: 0 0 0 0 rgba(52,211,153,0); }
  }

  /* ── Buscador ──────────────────────────────────────────────────────────── */
  .search-pill {
    display: flex; align-items: center; gap: 10px; height: 46px; padding: 0 6px 0 14px; border-radius: 14px;
    background: rgba(13,14,24,.8); border: 1px solid var(--line-strong); color: var(--muted);
    transition: border-color .22s, box-shadow .22s;
  }
  .search-pill:focus-within { border-color: rgba(124,92,255,.7); box-shadow: 0 0 0 4px rgba(124,92,255,.16); }
  .search-pill input {
    flex: 1; min-width: 0; height: 100%; background: transparent; border: 0; outline: 0;
    color: var(--text); font-size: .92rem;
  }
  .search-pill input::placeholder { color: var(--muted); }
  .search-pill input::-webkit-search-cancel-button { -webkit-appearance: none; }
  .search-pill button {
    height: 34px; padding: 0 14px; border: 0; cursor: pointer; border-radius: 10px;
    background: var(--surface-3); color: var(--text); font-weight: 650; font-size: .82rem;
    transition: background .18s;
  }
  .search-pill button:hover { background: rgba(255,255,255,.16); }

  /* ── Pestañas (control segmentado) ─────────────────────────────────────── */
  .tabs {
    display: inline-flex; gap: 4px; padding: 4px; border-radius: 14px;
    background: rgba(13,14,24,.75); border: 1px solid var(--line);
  }
  .tab {
    display: inline-flex; align-items: center; gap: 7px; height: 36px; padding: 0 14px; border-radius: 10px;
    border: 1px solid transparent; background: transparent; color: var(--muted);
    font-size: .88rem; font-weight: 600; cursor: pointer; transition: color .18s, background .18s, box-shadow .18s;
  }
  .tab:hover { color: var(--text); }
  .tab.active {
    color: #fff; background: linear-gradient(135deg, rgba(124,92,255,.42), rgba(79,140,255,.28));
    border-color: rgba(140,122,255,.6); box-shadow: 0 6px 18px rgba(92,80,255,.28);
  }
  .tab-panel[hidden] { display: none; }

  /* ── Tarjetas de cristal ───────────────────────────────────────────────── */
  .feature {
    position: relative; overflow: hidden; isolation: isolate;
    background: var(--glass); border: 1px solid var(--line); border-radius: var(--r-lg);
    padding: 24px; box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
    transition: transform .28s var(--ease), border-color .28s, box-shadow .28s;
  }
  /* Brillo que sigue al cursor (lib/rails.js pone --fx / --fy). */
  .feature::before {
    content: ''; position: absolute; inset: 0; z-index: -1; border-radius: inherit; opacity: 0;
    background: radial-gradient(380px circle at var(--fx, 50%) var(--fy, 0%), rgba(124,92,255,.2), transparent 62%);
    transition: opacity .3s;
  }
  .feature:hover { border-color: rgba(140,122,255,.45); box-shadow: var(--shadow-md), inset 0 1px 0 rgba(255,255,255,.08); }
  .feature:hover::before { opacity: 1; }
  .feature .fi {
    display: inline-flex; align-items: center; justify-content: center;
    width: 44px; height: 44px; border-radius: 13px; color: #d5ccff;
    background: var(--grad-soft); border: 1px solid rgba(124,92,255,.32);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.14);
  }
  .feature h3 { font-size: 1.06rem; font-weight: 700; color: #fff; margin: 14px 0 6px; letter-spacing: -.015em; }
  .feature p { font-size: .88rem; color: var(--muted); line-height: 1.58; }
  .feature p strong { color: var(--text-soft); font-weight: 600; }

  /* ── Pills de opción ───────────────────────────────────────────────────── */
  .pills { display: flex; gap: 8px; flex-wrap: wrap; }
  .pill {
    display: inline-flex; align-items: center; gap: 8px; height: 38px; padding: 0 14px; border-radius: 12px;
    background: var(--surface-2); border: 1px solid var(--line); color: var(--text-soft);
    cursor: pointer; font-size: .86rem; font-weight: 550; white-space: nowrap;
    transition: background .16s, border-color .16s, color .16s, box-shadow .16s;
  }
  .pill:has(.code) { padding-left: 8px; }
  .pill:hover { border-color: var(--line-strong); color: #fff; background: var(--surface-3); }
  .pill[aria-pressed="true"] {
    background: linear-gradient(135deg, rgba(124,92,255,.36), rgba(79,140,255,.24));
    border-color: rgba(140,122,255,.8); color: #fff; font-weight: 650;
    box-shadow: 0 0 0 1px rgba(124,92,255,.28), 0 8px 22px rgba(92,80,255,.26);
  }
  .pill[aria-pressed="true"] .code { background: var(--grad); color: #06070d; }

  /* ── Chips con casilla ─────────────────────────────────────────────────── */
  .chips { display: flex; gap: 10px; flex-wrap: wrap; }
  .chip {
    display: inline-flex; align-items: center; gap: 10px; min-height: 44px; padding: 8px 15px 8px 12px;
    border-radius: 13px; background: var(--surface); border: 1px solid var(--line);
    cursor: pointer; font-size: .87rem; color: var(--text-soft);
    transition: border-color .16s, background .16s, box-shadow .16s, color .16s;
  }
  .chip:hover { border-color: var(--line-strong); background: var(--surface-2); }
  .chip:has(input:checked) {
    border-color: rgba(124,92,255,.6); background: rgba(124,92,255,.11); color: #fff;
    box-shadow: 0 0 0 1px rgba(124,92,255,.22);
  }
  .chip:has(input:focus-visible) { outline: 2px solid #93a5ff; outline-offset: 3px; }
  .chip input {
    appearance: none; -webkit-appearance: none; width: 18px; height: 18px; flex: 0 0 auto;
    border: 1.5px solid var(--line-strong); border-radius: 6px; background: rgba(0,0,0,.28);
    cursor: pointer; transition: background .16s, border-color .16s;
  }
  /* La marca va como background-image: un <input> no pinta pseudo-elementos. */
  .chip input:checked {
    background-color: #8b7bff; background-image: ${CHECK_MARK};
    background-size: 118% 118%; background-position: center; background-repeat: no-repeat;
    border-color: transparent;
  }

  /* ── Tiles de plataforma / estudio ─────────────────────────────────────── */
  .provider-tile, .studio-tile { position: relative; cursor: pointer; }
  .provider-tile input, .studio-tile input { position: absolute; opacity: 0; pointer-events: none; }
  .provider-tile:has(input:focus-visible), .studio-tile:has(input:focus-visible) { outline: 2px solid #93a5ff; outline-offset: 3px; }
  .tile-check {
    position: absolute; top: -7px; right: -7px; width: 24px; height: 24px; border-radius: 50%;
    background: var(--grad); color: #06070d;
    display: none; align-items: center; justify-content: center;
    box-shadow: 0 4px 12px rgba(0,0,0,.5); z-index: 2;
  }
  .tile-check::after {
    content: ''; width: 13px; height: 13px; background: currentColor;
    -webkit-mask: ${CHECK_MARK} center / 124% no-repeat; mask: ${CHECK_MARK} center / 124% no-repeat;
  }
  .provider-tile input:checked ~ .tile-check,
  .studio-tile input:checked ~ .tile-check { display: flex; }
  .tile-name {
    font-size: .76rem; color: var(--muted); text-align: center; line-height: 1.3;
    min-height: 2.3em; transition: color .16s;
  }
  .provider-tile:has(input:checked) .tile-name,
  .studio-tile:has(input:checked) .tile-name { color: #fff; font-weight: 550; }

  /* ── Tarjeta de soporte (Discord) ──────────────────────────────────────── */
  .support {
    position: relative; overflow: hidden; isolation: isolate;
    display: flex; align-items: center; gap: 20px 24px; flex-wrap: wrap;
    padding: clamp(22px, 4vw, 34px); border-radius: var(--r-xl);
    border: 1px solid rgba(88,101,242,.5);
    background:
      radial-gradient(560px 280px at 0% 0%, rgba(88,101,242,.42), transparent 70%),
      radial-gradient(420px 240px at 100% 100%, rgba(124,92,255,.2), transparent 70%),
      linear-gradient(160deg, rgba(88,101,242,.14), rgba(11,11,20,.92));
    box-shadow: var(--shadow-md), inset 0 1px 0 rgba(255,255,255,.08);
  }
  .support-icon {
    flex: 0 0 auto; width: 64px; height: 64px; border-radius: 20px; background: var(--discord); color: #fff;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 14px 34px rgba(88,101,242,.55), inset 0 1px 0 rgba(255,255,255,.25);
  }
  .support-text { flex: 1 1 300px; min-width: 0; }
  .support h3 { font-size: clamp(1.15rem, 2.4vw, 1.45rem); font-weight: 800; letter-spacing: -.025em; color: #fff; }
  .support p { margin-top: 6px; color: var(--text-soft); font-size: .93rem; max-width: 58ch; }

  /* ── Pie de página ─────────────────────────────────────────────────────── */
  .page-footer {
    margin-top: clamp(64px, 9vw, 112px); border-top: 1px solid var(--line);
    background: linear-gradient(180deg, rgba(255,255,255,.022), transparent 60%);
    color: var(--muted); font-size: .84rem;
  }
  .footer-grid {
    display: grid; grid-template-columns: 1.7fr 1fr 1fr 1fr; gap: 30px;
    max-width: var(--wrap); margin: 0 auto; padding: 44px var(--pad) 26px;
  }
  .footer-grid h4 { color: var(--text); font-size: .76rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; margin-bottom: 12px; }
  .footer-grid ul { list-style: none; display: grid; gap: 9px; }
  .footer-grid a { color: var(--muted); text-decoration: none; transition: color .16s; }
  .footer-grid a:hover { color: #fff; }
  .footer-about p { margin-top: 12px; max-width: 40ch; line-height: 1.6; }
  .footer-legal { max-width: var(--wrap); margin: 0 auto; padding: 0 var(--pad) 34px; }
  .footer-legal p { border-top: 1px solid var(--line); padding-top: 18px; font-size: .74rem; line-height: 1.7; color: #7d859b; }

  /* ── Utilidades ────────────────────────────────────────────────────────── */
  .hint { color: var(--muted); font-size: .8rem; line-height: 1.6; }
  .hint strong { color: var(--text-soft); font-weight: 600; }
  .no-results { display: none; text-align: center; color: var(--muted); font-size: .92rem; padding: 30px 10px 8px; }
  .no-results a { color: var(--brand-3); }

  @media (max-width: 900px) {
    .nav-links { display: none; }
    .nav-actions .nav-support { display: inline-flex; }
    .footer-grid { grid-template-columns: 1fr 1fr; }
    .footer-about { grid-column: 1 / -1; }
  }
  @media (max-width: 640px) {
    .nav { padding-top: 8px; }
    .nav-inner { height: 54px; border-radius: 16px; padding: 0 7px 0 11px; gap: 8px; }
    .nav-actions { gap: 6px; }
    .nav-language { gap: 4px; padding: 0 7px; }
    .nav-language select { max-width: 72px; font-size: .7rem; }
    .nav-actions .btn { padding: 0 11px; }
    .nav-actions .nav-support { padding: 0; }
    .nav-actions .btn .lbl { display: none; }
    .nav-actions .btn-primary .lbl { display: inline; }
    .feature { padding: 20px; }
    .support { flex-direction: column; align-items: flex-start; }
    .support-text { flex: 0 1 auto; }
    .support .btn { width: 100%; }
  }
  @media (max-width: 380px) {
    .brand span { display: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
  }

  /* ── Refresh visual: cine contemporáneo, menos efecto cristal ─────────── */
  :root {
    --bg: #080b12;
    --bg-soft: #111725;
    --surface: rgba(17,24,39,.76);
    --surface-2: rgba(25,34,50,.88);
    --surface-3: rgba(38,49,68,.94);
    --line: rgba(178,191,211,.12);
    --line-strong: rgba(178,191,211,.22);
    --text: #f5f7fb;
    --text-soft: #c5cedd;
    --muted: #95a1b4;
    --brand: #8d7aff;
    --brand-2: #688aff;
    --brand-3: #62d3dc;
    --grad: linear-gradient(130deg,#9a81ff 0%,#7186ff 52%,#62d3dc 100%);
    --grad-soft: linear-gradient(135deg,rgba(141,122,255,.15),rgba(98,211,220,.08));
    --grad-text: linear-gradient(110deg,#c9baff 0%,#9bb4ff 54%,#76e2e2 100%);
    --shadow-sm: 0 3px 10px rgba(0,0,0,.24);
    --shadow-md: 0 18px 42px rgba(0,0,0,.32);
    --shadow-lg: 0 28px 72px rgba(0,0,0,.46);
    --wrap: 1220px;
  }
  body { background-color: var(--bg); }
  .page-glow {
    height: 1040px;
    background:
      radial-gradient(58vw 500px at 8% -8%, rgba(113,103,230,.24), transparent 66%),
      radial-gradient(48vw 430px at 96% 1%, rgba(58,164,184,.13), transparent 64%),
      radial-gradient(45vw 380px at 55% -12%, rgba(103,123,215,.11), transparent 68%);
  }
  .page-glow::after { opacity: .035; }
  .page-grid { opacity: .32; background-size: 72px 72px; }
  .nav { padding-top: 14px; }
  .nav-inner {
    height: 60px; padding: 0 10px 0 14px; border-radius: 17px;
    background: rgba(10,14,23,.82); border-color: rgba(178,191,211,.16);
    box-shadow: 0 12px 32px rgba(0,0,0,.22), inset 0 1px 0 rgba(255,255,255,.045);
  }
  .nav.scrolled .nav-inner {
    background: rgba(10,14,23,.94); border-color: rgba(178,191,211,.24);
    box-shadow: 0 16px 38px rgba(0,0,0,.34), inset 0 1px 0 rgba(255,255,255,.05);
  }
  .brand img { box-shadow: 0 5px 15px rgba(112,103,230,.28), var(--ring); }
  .nav-links a { border-radius: 10px; color: #aeb8c9; }
  .nav-links a:hover { color: #fff; background: rgba(255,255,255,.075); }
  .btn { border-radius: 13px; font-weight: 650; }
  .btn-primary {
    color: #090c14; box-shadow: 0 8px 22px rgba(100,113,228,.24), inset 0 1px 0 rgba(255,255,255,.32);
  }
  .btn-primary::after { display: none; }
  .btn-primary:hover {
    box-shadow: 0 12px 28px rgba(100,113,228,.34), inset 0 1px 0 rgba(255,255,255,.42);
  }
  .btn-ghost { background: rgba(255,255,255,.045); border-color: rgba(178,191,211,.18); }
  .btn-ghost:hover { background: rgba(255,255,255,.085); border-color: rgba(178,191,211,.3); }
  .badge { background: rgba(141,122,255,.1); border-color: rgba(141,122,255,.25); color: #d1c9ff; }
  .badge .dot { background: #8bdfd9; box-shadow: 0 0 10px rgba(98,211,220,.42); }
  .feature {
    background: linear-gradient(155deg,rgba(20,28,43,.84),rgba(14,20,32,.8));
    border-color: rgba(178,191,211,.105); border-radius: 20px;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.035);
  }
  .feature::before { background: radial-gradient(360px circle at var(--fx,50%) var(--fy,0%),rgba(141,122,255,.105),transparent 66%); }
  .feature:hover { border-color: rgba(141,122,255,.32); box-shadow: var(--shadow-md),inset 0 1px 0 rgba(255,255,255,.045); }
  .feature .fi { color: #c9c0ff; background: rgba(141,122,255,.105); border-color: rgba(141,122,255,.2); box-shadow: none; }
  .pill, .chip { border-radius: 11px; }
  .pill[aria-pressed="true"] {
    background: rgba(141,122,255,.17); border-color: rgba(157,143,255,.5); box-shadow: inset 0 0 0 1px rgba(141,122,255,.06);
  }
  .chip:has(input:checked) { background: rgba(141,122,255,.105); border-color: rgba(141,122,255,.42); box-shadow: none; }
  .support {
    border-color: rgba(109,125,230,.28);
    background: linear-gradient(115deg,rgba(75,82,157,.18),rgba(17,24,39,.88) 58%,rgba(28,64,81,.24));
    box-shadow: var(--shadow-md),inset 0 1px 0 rgba(255,255,255,.045);
  }
  .support-icon { box-shadow: 0 9px 24px rgba(88,101,242,.28),inset 0 1px 0 rgba(255,255,255,.2); }
  .page-footer { background: linear-gradient(180deg,rgba(255,255,255,.014),transparent 58%); }
  .footer-legal p { color: #858fa2; }
  @media (max-width: 640px) {
    .nav { padding-top: 8px; }
    .nav-inner { height: 54px; border-radius: 15px; }
  }
`;

module.exports = { THEME_CSS, FONT_STACK, MONO_STACK };
