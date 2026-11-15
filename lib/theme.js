'use strict';

/**
 * Sistema de diseño compartido (landing + /configure).
 *
 * Lenguaje visual: piel tipo Apple TV — negro profundo, tipografía SF grande y
 * ajustada, barra superior translúcida con blur, botones de píldora (blanco
 * sobre negro para la acción principal), superficies de vidrio con hairline y
 * rails de pósters limpios. El color lo pone el contenido, no la interfaz. Sin dependencias externas: no se cargan fuentes, CSS ni
 * scripts de terceros (cero peticiones, cero FOUC).
 *
 * Convenciones:
 *  - Tokens en :root (color, radio, sombra, medidas).
 *  - Componentes con prefijo claro (.btn, .pill, .chip, .feature, .support…).
 *  - El movimiento es una respuesta al usuario (hover, foco, scroll); lo
 *    único que se mueve solo es decorativo y se detiene con
 *    prefers-reduced-motion.
 */

// Pila de Apple TV: SF Pro en dispositivos Apple y la fuente del sistema en el
// resto. Sin descargas: sigue habiendo cero peticiones externas.
const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Inter var','Inter',ui-sans-serif,system-ui,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const MONO_STACK = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace";

// Grano de película: una tesela SVG generada con feTurbulence (sin imagen).
const NOISE_TILE =
  "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .5 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const CHECK_MARK =
  "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='none' stroke='%23000000' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round' d='M3.4 8.6l3 3 6.2-6.4'/%3E%3C/svg%3E\")";

const THEME_CSS = `
  :root {
    /* Superficies: negro profundo y vidrio blanco de baja opacidad. */
    --bg: #000;
    --bg-soft: #0b0b0d;
    /* Tarjeta opaca sin borde (el gris de las fichas de Apple TV) y su hover. */
    --card: #141415;
    --card-hi: #1c1c1e;
    /* Alto de la barra de navegación: el hero se mete debajo de ella. */
    --nav-h: 56px;
    --ink: #000;
    --surface: rgba(255,255,255,.045);
    --surface-2: rgba(255,255,255,.075);
    --surface-3: rgba(255,255,255,.11);
    --line: rgba(255,255,255,.09);
    --line-strong: rgba(255,255,255,.18);
    /* Texto: blancos y grises del sistema de Apple. */
    --text: #f5f5f7;
    --text-soft: #d2d2d7;
    --muted: #86868b;
    /* Acentos: blanco para la acción principal y azul de sistema para enlaces. */
    --brand: #f5f5f7;
    --brand-2: #2997ff;
    --brand-3: #2997ff;
    --brand-4: #f5f5f7;
    --brand-soft: rgba(255,255,255,.08);
    --star: #ffd60a;
    --ok: #30d158;
    --warn: #ffd60a;
    --danger: #ff453a;
    --discord: #5865f2;
    --kofi: #ff6433;
    --paypal: #002991;
    --grad: linear-gradient(180deg,#ffffff 0%,#efeff1 100%);
    --grad-soft: linear-gradient(180deg,rgba(255,255,255,.14),rgba(255,255,255,.05));
    --grad-text: linear-gradient(180deg,#ffffff 0%,#f5f5f7 100%);
    /* Forma */
    --r-sm: 10px;
    --r-md: 14px;
    --r-lg: 18px;
    --r-xl: 22px;
    --r-pill: 980px;
    --shadow-sm: 0 2px 10px rgba(0,0,0,.5);
    --shadow-md: 0 16px 40px rgba(0,0,0,.55);
    --shadow-lg: 0 30px 80px rgba(0,0,0,.7);
    --ring: 0 0 0 1px rgba(255,255,255,.08);
    --glass: linear-gradient(180deg, rgba(255,255,255,.055), rgba(255,255,255,.02));
    --ease: cubic-bezier(.32,.72,0,1);
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
  ::selection { background: rgba(255,255,255,0.16); color: #fff; }
  :focus-visible { outline: 2px solid rgba(41,151,255,.9); outline-offset: 3px; border-radius: 8px; }
  .skip-link {
    position: fixed; top: 10px; left: 10px; z-index: 10000; transform: translateY(calc(-100% - 16px));
    padding: 11px 16px; border-radius: 980px; background: #f5f5f7; color: #000 !important;
    font-size: .9rem; font-weight: 700; text-decoration: none; box-shadow: 0 8px 24px rgba(0,0,0,.45);
    transition: transform .18s ease-out;
  }
  .skip-link:focus { transform: translateY(0); }
  [hidden] { display: none !important; }
  html[data-i18n-pending] body { visibility: hidden; }

  /* Iconos SVG (lib/icons.js): heredan el color del texto. */
  .ic { flex: 0 0 auto; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; vertical-align: middle; }
  .ic-fill { fill: currentColor; stroke: none; }

  /* ── Fondo decorativo: aurora + rejilla + grano ────────────────────────── */
  .page-glow {
    position: absolute; top: 0; left: 0; right: 0; height: 1180px; z-index: -2; pointer-events: none; overflow: hidden;
    background:
      radial-gradient(62vw 560px at 10% -6%, rgba(255,255,255,0.16), transparent 64%),
      radial-gradient(46vw 460px at 97% 2%, rgba(255,255,255,0.094), transparent 62%),
      radial-gradient(52vw 420px at 60% -12%, rgba(255,255,255,0.099), transparent 64%);
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
    color: #d2d2d7; font-size: .74rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase;
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
    background: rgba(0,0,0,.62); border: 1px solid var(--line);
    backdrop-filter: blur(18px) saturate(1.7); -webkit-backdrop-filter: blur(18px) saturate(1.7);
    box-shadow: 0 10px 30px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.06);
    transition: background .28s var(--ease), border-color .28s var(--ease), box-shadow .28s var(--ease);
  }
  .nav.scrolled .nav-inner {
    background: rgba(0,0,0,.88); border-color: var(--line-strong);
    box-shadow: 0 16px 40px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.07);
  }
  .brand {
    display: inline-flex; align-items: center; gap: 10px; flex: 0 0 auto;
    text-decoration: none; color: var(--text); font-weight: 750; letter-spacing: -.015em;
  }
  .brand img {
    width: 32px; height: 32px; border-radius: 10px; background: #fff;
    box-shadow: 0 6px 18px rgba(0,0,0,0.4), var(--ring);
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
  .nav-language option { background: #1c1c1e; color: #f5f6fb; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  /* Los botones de donar y de soporte solo hacen falta cuando los enlaces están ocultos. */
  .nav-actions .nav-support, .nav-actions .nav-donate { display: none; padding: 0; width: 38px; }
  .nav-actions .nav-donate { border-color: rgba(255,100,51,.38); color: #ffd0bd; }
  .nav-actions .nav-donate:hover { background: rgba(255,100,51,.16); border-color: rgba(255,100,51,.62); }

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
    overflow: hidden; background: var(--grad); color: #000; font-weight: 750;
    box-shadow: 0 10px 30px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,.45);
  }
  .btn-primary::after {
    content: ''; position: absolute; top: 0; bottom: 0; left: -60%; width: 40%;
    background: linear-gradient(100deg, transparent, rgba(255,255,255,.5), transparent);
    transform: skewX(-18deg); transition: left .6s var(--ease);
  }
  .btn-primary:hover {
    transform: translateY(-2px); filter: saturate(1.08) brightness(1.05);
    box-shadow: 0 18px 44px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,.55);
  }
  .btn-primary:hover::after { left: 120%; }
  .btn-ghost {
    background: var(--surface-2); border-color: var(--line-strong);
  }
  .btn-ghost:hover { background: var(--surface-3); transform: translateY(-2px); border-color: rgba(255,255,255,.28); }
  .btn-discord { background: var(--discord); color: #fff; box-shadow: 0 10px 28px rgba(88,101,242,.42), inset 0 1px 0 rgba(255,255,255,.22); }
  .btn-discord:hover { transform: translateY(-2px); filter: brightness(1.1); box-shadow: 0 18px 40px rgba(88,101,242,.55), inset 0 1px 0 rgba(255,255,255,.28); }
  .btn-kofi { background: var(--kofi); color: #fff; box-shadow: 0 10px 28px rgba(255,100,51,.4), inset 0 1px 0 rgba(255,255,255,.24); }
  .btn-kofi:hover { transform: translateY(-2px); filter: brightness(1.08); box-shadow: 0 18px 40px rgba(255,100,51,.52), inset 0 1px 0 rgba(255,255,255,.3); }
  .btn-sm { height: 38px; padding: 0 14px; font-size: .84rem; border-radius: 12px; gap: 7px; }
  .btn-lg { height: 54px; padding: 0 26px; font-size: 1rem; border-radius: 16px; }

  /* ── Etiquetas ─────────────────────────────────────────────────────────── */
  .badge {
    display: inline-flex; align-items: center; gap: 8px; height: 30px; padding: 0 13px; border-radius: var(--r-pill);
    background: rgba(255,255,255,0.096); border: 1px solid rgba(255,255,255,0.272);
    color: #d2d2d7; font-size: .72rem; font-weight: 650; letter-spacing: .1em; text-transform: uppercase;
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
    background: var(--ok); margin-right: 2px; box-shadow: 0 0 0 0 rgba(48,209,88,.7);
    animation: pulse-dot 2.4s ease-out infinite;
  }
  @keyframes pulse-dot {
    0% { box-shadow: 0 0 0 0 rgba(48,209,88,.5); }
    70% { box-shadow: 0 0 0 7px rgba(48,209,88,0); }
    100% { box-shadow: 0 0 0 0 rgba(48,209,88,0); }
  }

  /* ── Buscador ──────────────────────────────────────────────────────────── */
  .search-pill {
    display: flex; align-items: center; gap: 10px; height: 46px; padding: 0 6px 0 14px; border-radius: 14px;
    background: rgba(255,255,255,.07); border: 1px solid var(--line-strong); color: var(--muted);
    transition: border-color .22s, box-shadow .22s;
  }
  .search-pill:focus-within { border-color: rgba(0,0,0,0.6); box-shadow: 0 0 0 4px rgba(0,0,0,0.16); }
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
    background: rgba(255,255,255,.07); border: 1px solid var(--line);
  }
  .tab {
    display: inline-flex; align-items: center; gap: 7px; height: 36px; padding: 0 14px; border-radius: 10px;
    border: 1px solid transparent; background: transparent; color: var(--muted);
    font-size: .88rem; font-weight: 600; cursor: pointer; transition: color .18s, background .18s, box-shadow .18s;
  }
  .tab:hover { color: var(--text); }
  .tab.active {
    color: #fff; background: linear-gradient(135deg, rgba(255,255,255,0.16), rgba(255,255,255,0.154));
    border-color: rgba(0,0,0,0.6); box-shadow: 0 6px 18px rgba(0,0,0,0.28);
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
    background: radial-gradient(380px circle at var(--fx, 50%) var(--fy, 0%), rgba(255,255,255,0.11), transparent 62%);
    transition: opacity .3s;
  }
  .feature:hover { border-color: rgba(0,0,0,0.45); box-shadow: var(--shadow-md), inset 0 1px 0 rgba(255,255,255,.08); }
  .feature:hover::before { opacity: 1; }
  .feature .fi {
    display: inline-flex; align-items: center; justify-content: center;
    width: 44px; height: 44px; border-radius: 13px; color: #d2d2d7;
    background: var(--grad-soft); border: 1px solid rgba(255,255,255,0.256);
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
    background: linear-gradient(135deg, rgba(255,255,255,0.16), rgba(255,255,255,0.132));
    border-color: rgba(255,255,255,0.32); color: #fff; font-weight: 650;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.28), 0 8px 22px rgba(0,0,0,0.26);
  }
  .pill[aria-pressed="true"] .code { background: var(--grad); color: #000; }

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
    border-color: rgba(255,255,255,0.32); background: rgba(255,255,255,0.088); color: #fff;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.22);
  }
  .chip:has(input:focus-visible) { outline: 2px solid rgba(41,151,255,.9); outline-offset: 3px; }
  .chip input {
    appearance: none; -webkit-appearance: none; width: 18px; height: 18px; flex: 0 0 auto;
    border: 1.5px solid var(--line-strong); border-radius: 6px; background: rgba(255,255,255,.04);
    cursor: pointer; transition: background .16s, border-color .16s;
  }
  /* La marca va como background-image: un <input> no pinta pseudo-elementos. */
  .chip input:checked {
    background-color: #f5f5f7; background-image: ${CHECK_MARK};
    background-size: 118% 118%; background-position: center; background-repeat: no-repeat;
    border-color: transparent;
  }

  /* ── Tiles de plataforma / estudio ─────────────────────────────────────── */
  .provider-tile, .studio-tile { position: relative; cursor: pointer; }
  .provider-tile input, .studio-tile input { position: absolute; opacity: 0; pointer-events: none; }
  .provider-tile:has(input:focus-visible), .studio-tile:has(input:focus-visible) { outline: 2px solid rgba(41,151,255,.9); outline-offset: 3px; }
  .tile-check {
    position: absolute; top: -7px; right: -7px; width: 24px; height: 24px; border-radius: 50%;
    background: var(--grad); color: #000;
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
      radial-gradient(420px 240px at 100% 100%, rgba(255,255,255,0.11), transparent 70%),
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

  /* ── Tarjeta de donación (Ko-fi): misma pieza con el acento naranja ─────── */
  .support + .support { margin-top: 16px; }
  .support.donate {
    border-color: rgba(255,100,51,.45);
    background:
      radial-gradient(560px 280px at 0% 0%, rgba(255,100,51,.3), transparent 70%),
      radial-gradient(420px 240px at 100% 100%, rgba(255,255,255,0.088), transparent 70%),
      linear-gradient(160deg, rgba(255,100,51,.12), rgba(11,11,20,.92));
  }
  .support.donate .support-icon {
    background: var(--kofi);
    box-shadow: 0 14px 34px rgba(255,100,51,.5), inset 0 1px 0 rgba(255,255,255,.25);
  }
  .pay-badges { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
  .pay-badge {
    display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 11px;
    border-radius: var(--r-pill); border: 1px solid var(--line-strong);
    background: rgba(255,255,255,.05); color: var(--text-soft);
    font-size: .72rem; font-weight: 650; letter-spacing: .01em;
  }
  .pay-badge .ic { color: #fff; }

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
    .nav-actions .nav-support, .nav-actions .nav-donate { display: inline-flex; }
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
    .nav-actions .nav-support, .nav-actions .nav-donate { padding: 0; }
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

  /* ── Piel Apple TV ────────────────────────────────────────────────────────
     Capa final del sistema: negro profundo, tipografía SF grande y ajustada,
     barra translúcida con blur, píldoras (blanco sobre negro para la acción
     principal), vidrio con hairline y azul de sistema como único acento.
     El color lo pone el contenido (pósters y logos), nunca la interfaz. */
  /* Los tokens (color, radios, sombras y easing) viven en el :root de arriba. */
  html { scroll-padding-top: 76px; }
  body { background-color: var(--bg); letter-spacing: -.011em; }
  a { color: var(--brand-2); }
  ::selection { background: rgba(41,151,255,.42); color: #fff; }
  :focus-visible { outline: 2px solid rgba(41,151,255,.9); outline-offset: 3px; border-radius: 6px; }

  /* Fondo: negro puro con un levísimo halo superior; sin aurora ni rejilla. */
  .page-glow {
    height: 720px;
    background: radial-gradient(72vw 420px at 50% -16%, rgba(255,255,255,.075), transparent 68%);
  }
  .page-glow::after { opacity: .018; mix-blend-mode: screen; }
  .page-grid { display: none; }

  /* ── Titulares de sección ─────────────────────────────────────────────────
     Titular a dos tonos: la frase en blanco y su remate (<em>) en gris, el
     recurso de los titulares de Apple. Sin degradados ni guiones de adorno. */
  .eyebrow { color: var(--muted); font-size: .74rem; font-weight: 650; letter-spacing: .08em; }
  .eyebrow::before { display: none; }
  .title { margin-top: 10px; font-size: clamp(2rem, 4.2vw, 3.1rem); font-weight: 700; letter-spacing: -.035em; line-height: 1.06; }
  .title em, .grad-text {
    background: none; -webkit-background-clip: border-box; background-clip: border-box;
    -webkit-text-fill-color: currentColor; color: var(--muted);
  }
  .subtitle { margin-top: 14px; color: #a1a1a6; font-size: clamp(1.02rem, 1.4vw, 1.17rem); line-height: 1.5; letter-spacing: -.012em; }
  .head-row { margin-bottom: 30px; }

  /* ── Navegación: barra translúcida de borde a borde ───────────────────────
     Como la barra superior de tvOS: las secciones van en una cápsula de
     vidrio y la pestaña de la sección visible se rellena de blanco (la marca
     lib/rails.js con aria-current). Arriba del todo la barra es transparente
     para que el arte del hero pase por debajo; al bajar se vuelve vidrio. Sin
     JavaScript (.js-anim ausente) es vidrio siempre. */
  .nav {
    padding: 0; background: rgba(16,16,17,.76); border-bottom: 1px solid rgba(255,255,255,.08);
    backdrop-filter: saturate(180%) blur(20px); -webkit-backdrop-filter: saturate(180%) blur(20px);
    transition: background .35s var(--ease), border-color .35s var(--ease),
      backdrop-filter .35s var(--ease), -webkit-backdrop-filter .35s var(--ease);
  }
  .js-anim .nav:not(.scrolled) {
    background: rgba(0,0,0,0); border-bottom-color: transparent;
    backdrop-filter: saturate(100%) blur(0px); -webkit-backdrop-filter: saturate(100%) blur(0px);
  }
  .nav-inner {
    max-width: var(--wrap); height: var(--nav-h); padding: 0 var(--pad); border: 0; border-radius: 0;
    background: none; backdrop-filter: none; -webkit-backdrop-filter: none; box-shadow: none;
  }
  .nav.scrolled .nav-inner { background: none; border-color: transparent; box-shadow: none; }
  .brand { font-weight: 650; letter-spacing: -.02em; }
  .brand img { border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,.6); }
  .brand span { font-size: 1rem; }
  .brand span i { background: none; -webkit-text-fill-color: currentColor; color: var(--muted); }
  .nav-links {
    gap: 2px; padding: 3px; border-radius: 980px;
    background: rgba(118,118,128,.24); box-shadow: inset 0 0 0 1px rgba(255,255,255,.06);
    backdrop-filter: saturate(180%) blur(20px); -webkit-backdrop-filter: saturate(180%) blur(20px);
  }
  .nav-links a {
    height: 30px; padding: 0 13px; border-radius: 980px; white-space: nowrap;
    color: #e3e3e8; font-size: .8rem; font-weight: 550; letter-spacing: -.008em;
    transition: color .2s var(--ease), background .2s var(--ease);
  }
  .nav-links a:hover { color: #fff; background: rgba(255,255,255,.14); }
  .nav-links a[aria-current="true"] { background: #f5f5f7; color: #000; }
  .nav-language {
    height: 34px; padding: 0 10px; border-radius: 980px;
    background: rgba(118,118,128,.24); border-color: transparent;
  }
  .nav-language .ic { color: #d2d2d7; }
  .nav-language select { font-size: .76rem; font-weight: 550; }
  .nav-actions { gap: 8px; }
  .nav-actions .btn-ghost { background: rgba(118,118,128,.24); }
  .nav-actions .btn-ghost:hover { background: rgba(118,118,128,.42); }
  .nav-actions .nav-support, .nav-actions .nav-donate { width: 34px; border-radius: 980px; }
  .nav-actions .nav-donate { border-color: transparent; color: #f5f5f7; }
  .nav-actions .nav-donate:hover { background: rgba(255,100,51,.28); border-color: transparent; }

  /* ── Botones: píldora blanca (primario) y vidrio (secundario) ─────────── */
  .btn {
    height: 44px; padding: 0 22px; border-radius: 980px; gap: 8px;
    font-size: .92rem; font-weight: 600; letter-spacing: -.01em;
  }
  .btn-primary { color: #000; box-shadow: 0 6px 20px rgba(0,0,0,.45); }
  .btn-primary:hover { transform: scale(1.035); filter: none; box-shadow: 0 10px 28px rgba(0,0,0,.55); }
  .btn-primary:active { transform: scale(.985); }
  .btn-ghost { background: rgba(255,255,255,.1); border-color: transparent; color: #fff; backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
  .btn-ghost:hover { background: rgba(255,255,255,.18); border-color: transparent; transform: scale(1.035); }
  .btn-discord, .btn-kofi { border-radius: 980px; }
  .btn-discord { box-shadow: 0 6px 20px rgba(88,101,242,.32); }
  .btn-kofi { box-shadow: 0 6px 20px rgba(255,100,51,.3); }
  .btn-discord:hover, .btn-kofi:hover { transform: scale(1.035); filter: brightness(1.07); }
  .btn-sm { height: 34px; padding: 0 15px; font-size: .8rem; border-radius: 980px; gap: 6px; }
  .btn-lg { height: 50px; padding: 0 28px; font-size: 1rem; border-radius: 980px; }

  /* ── Etiquetas, códigos y métricas ────────────────────────────────────── */
  .badge { background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.14); color: #f5f5f7; letter-spacing: .06em; }
  .badge .dot { background: var(--ok); box-shadow: 0 0 10px rgba(48,209,88,.8); }
  .code { background: rgba(255,255,255,.1); color: #d2d2d7; border-radius: 6px; font-weight: 650; }
  .stat { background: none; border-color: transparent; padding: 0; color: var(--muted); }
  .stat b { color: #f5f5f7; font-weight: 650; }

  /* ── Buscador y control segmentado ────────────────────────────────────── */
  .search-pill { height: 44px; border-radius: 980px; background: rgba(255,255,255,.07); border-color: transparent; }
  .search-pill:focus-within { background: rgba(255,255,255,.1); border-color: transparent; box-shadow: 0 0 0 3px rgba(41,151,255,.45); }
  .search-pill button { border-radius: 980px; background: rgba(255,255,255,.14); }
  .search-pill button:hover { background: rgba(255,255,255,.22); }
  .tabs { padding: 3px; border-radius: 980px; background: rgba(255,255,255,.07); border-color: transparent; }
  .tab { height: 32px; padding: 0 14px; border-radius: 980px; color: #a1a1a6; font-weight: 550; }
  .tab:hover { color: #fff; }
  .tab.active { background: #f5f5f7; border-color: transparent; color: #000; box-shadow: 0 2px 8px rgba(0,0,0,.4); }

  /* ── Pills y chips: selección en blanco, como un segmented control ────── */
  .pill { height: 36px; border-radius: 980px; background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.09); color: #d2d2d7; font-weight: 500; }
  .pill:hover { background: rgba(255,255,255,.12); border-color: rgba(255,255,255,.16); color: #fff; }
  .pill[aria-pressed="true"] {
    background: #f5f5f7; border-color: transparent; color: #000; font-weight: 650;
    box-shadow: 0 2px 10px rgba(0,0,0,.45);
  }
  .pill[aria-pressed="true"] .code { background: rgba(0,0,0,.14); color: #000; }
  .pill[aria-pressed="true"] small { color: rgba(0,0,0,.55); }
  .chip { border-radius: 14px; background: rgba(255,255,255,.045); border-color: transparent; }
  .chip:hover { background: rgba(255,255,255,.09); border-color: transparent; }
  .chip:has(input:checked) { background: rgba(255,255,255,.1); border-color: transparent; color: #fff; box-shadow: none; }
  .chip:has(input:checked):hover { background: rgba(255,255,255,.15); }
  .chip input { border-radius: 6px; border-color: rgba(255,255,255,.28); background: rgba(255,255,255,.04); }
  .chip input:checked { background-color: #f5f5f7; border-color: transparent; }
  .chip:has(input:focus-visible) { outline: 2px solid rgba(41,151,255,.9); }

  /* ── Tarjetas de función ──────────────────────────────────────────────────
     Ficha opaca sin borde y de radio amplio; el icono va suelto y grande, de
     trazo fino, como un símbolo SF. Al pasar el cursor se aclara y se eleva. */
  .feature {
    padding: 28px; background: var(--card); border-color: transparent; border-radius: 24px;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.045);
    transition: transform .4s var(--ease), background .3s var(--ease), box-shadow .4s var(--ease);
  }
  .feature::before { background: radial-gradient(420px circle at var(--fx, 50%) var(--fy, 0%), rgba(255,255,255,.06), transparent 62%); }
  .feature:hover {
    background: var(--card-hi); border-color: transparent; transform: scale(1.012);
    box-shadow: 0 26px 60px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.08);
  }
  .feature .fi {
    width: auto; height: 32px; justify-content: flex-start;
    background: none; border: 0; border-radius: 0; color: #f5f5f7; box-shadow: none;
  }
  .feature .fi .ic { width: 30px; height: 30px; stroke-width: 1.6; }
  .feature h3 { margin: 18px 0 8px; font-size: 1.24rem; font-weight: 650; letter-spacing: -.022em; line-height: 1.2; }
  .feature p { color: #a1a1a6; font-size: .95rem; line-height: 1.52; }
  .feature p strong { color: #f5f5f7; font-weight: 600; }

  /* ── Tiles de plataforma y estudio ────────────────────────────────────── */
  .tile-check { background: #f5f5f7; color: #000; box-shadow: 0 2px 8px rgba(0,0,0,.6); }
  .provider-tile:has(input:focus-visible), .studio-tile:has(input:focus-visible) { outline: 2px solid rgba(41,151,255,.9); }
  .tile-name { color: var(--muted); }
  .provider-tile:has(input:checked) .tile-name,
  .studio-tile:has(input:checked) .tile-name { color: #f5f5f7; }

  /* ── Tarjetas de soporte y donación ───────────────────────────────────── */
  .support {
    border-color: transparent; border-radius: 24px; background: var(--card);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.045);
  }
  .support-icon { border-radius: 16px; box-shadow: 0 8px 22px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.25); }
  .support h3 { font-weight: 700; letter-spacing: -.025em; }
  .support p { color: #a1a1a6; }
  .support.donate { border-color: transparent; background: var(--card); }
  .support.donate .support-icon { box-shadow: 0 8px 22px rgba(255,100,51,.35), inset 0 1px 0 rgba(255,255,255,.25); }
  .pay-badge { background: rgba(255,255,255,.07); border-color: rgba(255,255,255,.12); border-radius: 980px; color: #d2d2d7; }

  /* ── Pie de página: hairlines y texto pequeño ─────────────────────────── */
  .page-footer { border-top-color: rgba(255,255,255,.08); background: none; color: var(--muted); font-size: .8rem; }
  .footer-grid h4 { color: #f5f5f7; font-size: .72rem; letter-spacing: .08em; }
  .footer-grid a { color: #a1a1a6; }
  .footer-grid a:hover { color: #fff; }
  .footer-about p { color: var(--muted); }
  .footer-legal p { border-top-color: rgba(255,255,255,.08); color: #6e6e73; line-height: 1.75; }

  .no-results a { color: var(--brand-2); }
  .hint strong { color: #d2d2d7; }

  /* La cápsula de pestañas necesita más ancho que los enlaces sueltos: se
     retira antes y deja paso a los botones de icono de donación y soporte. */
  @media (max-width: 1180px) {
    .nav-links { display: none; }
    .nav-actions .nav-support, .nav-actions .nav-donate { display: inline-flex; }
  }
  /* Ajuste al idioma: los textos de la barra miden distinto en cada lengua.
     lib/rails.js mide si desborda y va soltando lastre: 1) «Configurar» se
     queda en su icono, 2) donación y soporte salen de la cápsula y pasan a
     botones de icono, 3) la cápsula se retira. */
  .nav-fit-1 .nav-actions > .btn-ghost .lbl { display: none; }
  .nav-fit-1 .nav-actions > .btn-ghost:not(.nav-support):not(.nav-donate) { width: 34px; padding: 0; }
  .nav-fit-2 .nav-links .nav-ext { display: none; }
  .nav-fit-2 .nav-actions .nav-support, .nav-fit-2 .nav-actions .nav-donate { display: inline-flex; }
  .nav-fit-3 .nav-links { display: none; }
  @media (max-width: 640px) {
    :root { --nav-h: 48px; }
    .nav-inner { padding: 0 10px 0 14px; }
    .nav-actions { gap: 6px; }
    .nav-actions .btn { padding: 0 12px; }
    .nav-actions .nav-support, .nav-actions .nav-donate { padding: 0; }
    .nav-language { height: 32px; padding: 0 8px; }
    .btn, .btn-lg { width: auto; }
    .feature { padding: 22px; border-radius: 20px; }
    .feature h3 { font-size: 1.14rem; }
    .support { border-radius: 20px; }
  }
  /* Móvil: la barra tiene que caber entera, con «Instalar» siempre a la
     vista. El selector de idioma se queda en su icono (el <select> nativo
     sigue encima, invisible) y el acceso a /configure se retira: el hero ya
     lo ofrece a un toque. */
  @media (max-width: 480px) {
    .nav-language { position: relative; width: 34px; height: 34px; padding: 0; justify-content: center; }
    .nav-language select { position: absolute; inset: 0; width: 100%; max-width: none; height: 100%; opacity: 0; }
    .nav-actions > .btn-ghost:not(.nav-support):not(.nav-donate) { display: none; }
  }
  /* ── Piel Apple TV Plus (Fluid Modernism) ─────────────────────────────────
     Refinamiento óptico y cinético: barra flotante con cristal líquido,
     curvas spring físicas, sombras multicapa, profundidad especular sutil y
     transiciones sedosas a 60/120 fps. */
  :root {
    --ease: cubic-bezier(.22, 1, .36, 1);
    --ease-spring: cubic-bezier(.34, 1.56, .64, 1);
    --card: #121214;
    --card-hi: #19191d;
  }

  .page-glow {
    height: 860px;
    background:
      radial-gradient(76vw 460px at 50% -14%, rgba(255,255,255,.09), transparent 68%),
      radial-gradient(44vw 360px at 84% 4%, rgba(41,151,255,.055), transparent 66%);
  }

  .nav {
    border-bottom-color: rgba(255,255,255,.07);
    box-shadow: 0 1px 0 rgba(255,255,255,.03);
  }
  .nav.scrolled {
    background: rgba(12,12,14,.78);
    border-bottom-color: rgba(255,255,255,.11);
    box-shadow: 0 14px 36px rgba(0,0,0,.55), inset 0 -1px 0 rgba(255,255,255,.05);
  }
  .nav-links {
    background: rgba(118,118,128,.2);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.09), 0 4px 16px rgba(0,0,0,.22);
  }
  .nav-links a {
    transition: color .24s var(--ease), background .24s var(--ease), transform .2s var(--ease);
  }
  .nav-links a[aria-current="true"] {
    background: #f5f5f7; color: #000; font-weight: 650;
    box-shadow: 0 2px 10px rgba(0,0,0,.35);
  }

  .btn {
    will-change: transform;
    transition: transform .28s var(--ease-spring), box-shadow .28s var(--ease),
      background .24s var(--ease), border-color .24s var(--ease), filter .24s var(--ease);
  }
  .btn-primary {
    box-shadow: 0 8px 24px rgba(0,0,0,.48), 0 0 0 1px rgba(255,255,255,.92) inset;
  }
  .btn-primary:hover {
    transform: translateY(-1.5px) scale(1.03);
    box-shadow: 0 14px 34px rgba(0,0,0,.62), 0 0 26px rgba(255,255,255,.14);
  }
  .btn-primary:active { transform: translateY(0) scale(.975); }
  .btn-ghost {
    background: rgba(255,255,255,.09);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.12), 0 4px 14px rgba(0,0,0,.24);
  }
  .btn-ghost:hover {
    background: rgba(255,255,255,.16);
    transform: translateY(-1.5px) scale(1.025);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.2), 0 10px 24px rgba(0,0,0,.38);
  }
  .btn-ghost:active { transform: translateY(0) scale(.98); }

  .tabs {
    background: rgba(118,118,128,.18);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.07);
  }
  .tab {
    transition: color .24s var(--ease), background .28s var(--ease), transform .22s var(--ease), box-shadow .28s var(--ease);
  }
  .tab:active { transform: scale(.96); }
  .tab.active {
    box-shadow: 0 3px 12px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.8);
  }

  .pill {
    transition: background .22s var(--ease), border-color .22s var(--ease),
      color .2s var(--ease), transform .22s var(--ease-spring), box-shadow .24s var(--ease);
  }
  .pill:active { transform: scale(.96); }
  .chip {
    transition: background .22s var(--ease), color .2s var(--ease),
      transform .22s var(--ease-spring), box-shadow .24s var(--ease);
  }
  .chip:active { transform: scale(.985); }
  .chip:has(input:checked) {
    background: rgba(255,255,255,.115);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.14), 0 6px 18px rgba(0,0,0,.26);
  }

  .feature {
    background: linear-gradient(180deg, #161619 0%, #111113 100%);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.065), 0 10px 30px rgba(0,0,0,.32);
    transition: transform .42s var(--ease), background .32s var(--ease), box-shadow .42s var(--ease);
  }
  .feature::before {
    background: radial-gradient(460px circle at var(--fx, 50%) var(--fy, 0%), rgba(255,255,255,.085), transparent 60%);
  }
  .feature:hover {
    background: linear-gradient(180deg, #1d1d21 0%, #151518 100%);
    transform: translateY(-4px) scale(1.008);
    box-shadow: 0 28px 64px rgba(0,0,0,.64), inset 0 1px 0 rgba(255,255,255,.11);
  }

  .support {
    background: linear-gradient(165deg, #17171b 0%, #111113 100%);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.065), 0 16px 42px rgba(0,0,0,.38);
    transition: transform .38s var(--ease), box-shadow .38s var(--ease);
  }
  .support:hover {
    transform: translateY(-2px);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.1), 0 24px 56px rgba(0,0,0,.52);
  }
`;

module.exports = { THEME_CSS, FONT_STACK, MONO_STACK };
