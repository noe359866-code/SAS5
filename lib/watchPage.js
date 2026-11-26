'use strict';

/**
 * Reproductor web (/watch) de RamdonLatam: explora, busca y reproduce
 * películas, series y anime directamente desde el navegador usando los
 * catálogos, fichas y fuentes directas del addon.
 *
 * - Sin dependencias de build ni frameworks externos: HTML/CSS/JS autónomo.
 * - Misma identidad visual de RamdonLatam (azul noche #060f1a + naranja #ff8a2b).
 * - `Referrer-Policy: no-referrer` para maximizar compatibilidad con CDN HLS/MP4.
 * - Reproductor HTML5 + hls.js (carga bajo demanda) con conmutación automática
 *   entre señales, selector de calidad/audio/subtítulos (.vtt y .srt),
 *   progreso guardado, lista personal, episodios y atajos de teclado.
 */

const config = require('./config');
const { icon } = require('./icons');
const { escapeHtml } = require('./rails');
const { FONT_STACK, MONO_STACK } = require('./theme');

function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function renderWatch({ origin = '', host = '', cfgPrefix = '', region = '' } = {}) {
  const safeOrigin = escapeHtml(String(origin || ''));
  const cleanPrefix = /^\/[A-Za-z0-9_-]{8,4096}$/.test(String(cfgPrefix || '')) ? String(cfgPrefix) : '';
  const effRegion = /^[A-Z]{2}$/.test(String(region || '')) ? String(region) : (config.watchRegion || 'NI');
  const ogImage = safeOrigin ? `${safeOrigin}/assets/og-cover.png` : '/assets/og-cover.png';

  const bootstrap = safeJson({
    cfgPrefix: cleanPrefix,
    region: effRegion,
    host: String(host || ''),
  });

  // Iconos SVG pre-renderizados para usarlos dentro del JS del cliente.
  const clientIcons = safeJson({
    play: icon('play', 16),
    playLg: icon('play', 20),
    info: icon('info', 16),
    plus: icon('plus', 16),
    check: icon('check', 16),
    bookmark: icon('bookmark', 16),
    star: icon('star', 13),
    chevLeft: icon('chevron-left', 20),
    chevRight: icon('chevron-right', 20),
    arrowLeft: icon('arrow-left', 17),
    close: icon('x', 18),
    copy: icon('copy', 15),
    ext: icon('external-link', 15),
    skip: icon('skip-forward', 16),
    subs: icon('subtitles', 15),
    refresh: icon('refresh-cw', 15),
    share: icon('share-2', 15),
    max: icon('maximize', 15),
    alert: icon('circle-alert', 16),
    film: icon('film', 15),
    tv: icon('tv', 15),
    sparkles: icon('sparkles', 15),
    clock: icon('clock', 14),
  });

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<meta name="referrer" content="no-referrer" />
<title>RamdonLatam Watch · Ver películas, series y anime online</title>
<meta name="description" content="Explora y reproduce películas, series y anime en español latino y subtitulado directamente desde la web con RamdonLatam. Gratis y sin cuenta." />
<meta name="theme-color" content="#060f1a" />
<meta property="og:type" content="website" />
<meta property="og:title" content="RamdonLatam Watch · Películas, series y anime" />
<meta property="og:description" content="Catálogos por plataforma, buscador en vivo y reproductor web con audio latino y subtitulado." />
<meta property="og:image" content="${ogImage}" />
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" />
<link rel="icon" href="/assets/icon-192.png" type="image/png" sizes="192x192" />
<link rel="apple-touch-icon" href="/assets/icon-192.png" />
<link rel="manifest" href="/site.webmanifest" />
<style>
  :root {
    --bg: #060f1a;
    --bg-soft: #091627;
    --card: #0c1d2f;
    --card-hi: #122a42;
    --brand: #ff8a2b;
    --brand-2: #ffa552;
    --brand-3: #ffc98f;
    --brand-soft: rgba(255,138,43,.14);
    --grad: linear-gradient(180deg,#ffa552 0%,#f5821f 52%,#e8680f 100%);
    --text: #f6f8fb;
    --text-soft: #d3deea;
    --muted: #8ea3b8;
    --line: rgba(174,205,228,.12);
    --line-strong: rgba(174,205,228,.24);
    --ok: #30d158;
    --warn: #ffd60a;
    --danger: #ff453a;
    --star: #ffd60a;
    --r-sm: 10px;
    --r-md: 14px;
    --r-lg: 20px;
    --r-pill: 980px;
    --ease: cubic-bezier(.2,.8,.2,1);
    --wrap: 1380px;
    --pad: clamp(14px, 3.2vw, 36px);
    --nav-h: 66px;
    color-scheme: dark;
  }

  *, *::before, *::after { box-sizing: border-box; }
  * { margin: 0; padding: 0; }
  html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; overflow-x: clip; }
  body {
    font-family: ${FONT_STACK};
    font-size: 15px;
    line-height: 1.5;
    color: var(--text);
    background: var(--bg);
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
    overflow-x: clip;
  }
  button, input, select { font: inherit; color: inherit; }
  button { cursor: pointer; background: none; border: 0; }
  a { color: inherit; text-decoration: none; }
  img { display: block; max-width: 100%; user-select: none; }
  [hidden] { display: none !important; }
  :focus-visible { outline: 2px solid var(--brand-2); outline-offset: 2px; border-radius: 8px; }
  ::selection { background: rgba(255,138,43,.35); color: #fff; }
  .ic { flex: 0 0 auto; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; vertical-align: middle; }
  .ic-fill { fill: currentColor; stroke: none; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }

  .bg-glow {
    position: fixed; inset: 0; z-index: -1; pointer-events: none;
    background:
      radial-gradient(58vw 460px at 78% -10%, rgba(255,138,43,.13), transparent 66%),
      radial-gradient(45vw 420px at 14% -8%, rgba(45,120,190,.16), transparent 68%);
  }

  /* ── Barra superior flotante ────────────────────────────────────────────── */
  .w-nav {
    position: sticky; top: 0; z-index: 60;
    padding: 10px var(--pad) 0;
  }
  .w-nav-inner {
    max-width: var(--wrap); margin: 0 auto; min-height: 58px;
    display: flex; align-items: center; gap: 12px; padding: 6px 10px 6px 14px;
    border-radius: 18px;
    background: rgba(8,20,33,.82);
    border: 1px solid var(--line);
    backdrop-filter: saturate(180%) blur(20px);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    box-shadow: 0 12px 36px rgba(0,5,12,.48), inset 0 1px 0 rgba(255,255,255,.07);
  }
  .w-brand {
    display: inline-flex; align-items: center; gap: 9px; flex: 0 0 auto;
    font-weight: 800; letter-spacing: -.03em; font-size: 1.02rem;
  }
  .w-brand img { width: 32px; height: 32px; border-radius: 10px; box-shadow: 0 4px 14px rgba(0,0,0,.45); }
  .w-brand i { font-style: normal; color: var(--brand-2); }
  .w-brand-badge {
    font-size: .64rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase;
    padding: 2px 7px; border-radius: var(--r-pill);
    background: var(--brand-soft); color: var(--brand-2); border: 1px solid rgba(255,138,43,.3);
  }

  .w-tabs {
    display: flex; align-items: center; gap: 3px; margin-left: 6px;
    overflow-x: auto; scrollbar-width: none;
  }
  .w-tabs::-webkit-scrollbar { display: none; }
  .w-tab {
    display: inline-flex; align-items: center; gap: 6px;
    height: 36px; padding: 0 13px; border-radius: 11px;
    color: var(--text-soft); font-size: .88rem; font-weight: 600; white-space: nowrap;
    transition: background .18s var(--ease), color .18s var(--ease);
  }
  .w-tab:hover { color: #fff; background: rgba(255,255,255,.07); }
  .w-tab.active {
    background: var(--grad); color: #10283d; font-weight: 750;
    box-shadow: 0 4px 14px rgba(245,130,31,.32);
  }
  .w-tab .badge-n {
    display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px;
    padding: 0 5px; border-radius: var(--r-pill); font-size: .7rem; font-weight: 750;
    background: rgba(255,255,255,.14); color: inherit;
  }
  .w-tab.active .badge-n { background: rgba(16,40,61,.2); }

  .w-search {
    position: relative; flex: 1 1 220px; max-width: 340px; margin-left: auto;
    display: flex; align-items: center;
  }
  .w-search .ic-search {
    position: absolute; left: 12px; color: var(--muted); pointer-events: none;
  }
  .w-search input {
    width: 100%; height: 38px; padding: 0 34px 0 36px; border-radius: var(--r-pill);
    background: rgba(255,255,255,.06); border: 1px solid var(--line);
    color: var(--text); font-size: .88rem;
    transition: background .18s, border-color .18s, box-shadow .18s;
  }
  .w-search input::placeholder { color: var(--muted); }
  .w-search input:focus {
    outline: none; background: rgba(12,29,47,.95);
    border-color: rgba(255,138,43,.6); box-shadow: 0 0 0 3px rgba(255,138,43,.18);
  }
  .w-search-clear {
    position: absolute; right: 7px; width: 24px; height: 24px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    color: var(--muted); background: rgba(255,255,255,.08);
  }
  .w-search-clear:hover { color: #fff; background: rgba(255,255,255,.16); }

  .w-nav-actions { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    height: 40px; padding: 0 18px; border-radius: var(--r-pill);
    font-size: .88rem; font-weight: 700; white-space: nowrap;
    transition: transform .18s var(--ease), background .18s, border-color .18s, box-shadow .18s;
  }
  .btn:active { transform: scale(.98); }
  .btn-sm { height: 34px; padding: 0 13px; font-size: .82rem; gap: 6px; }
  .btn-lg { height: 46px; padding: 0 24px; font-size: .95rem; }
  .btn-primary {
    background: var(--grad); color: #10283d;
    box-shadow: 0 8px 24px rgba(245,130,31,.32), inset 0 1px 0 rgba(255,255,255,.45);
  }
  .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 12px 30px rgba(245,130,31,.45); }
  .btn-ghost {
    background: rgba(255,255,255,.07); color: var(--text);
    border: 1px solid var(--line-strong);
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  }
  .btn-ghost:hover { background: rgba(255,255,255,.13); border-color: rgba(255,138,43,.5); }
  .btn-icon { width: 38px; padding: 0; }

  /* ── Contenedor principal ───────────────────────────────────────────────── */
  .w-main { max-width: var(--wrap); margin: 0 auto; padding: 18px var(--pad) 84px; }

  /* ── Hero destacado ─────────────────────────────────────────────────────── */
  .hero {
    position: relative; overflow: hidden; border-radius: 24px;
    min-height: clamp(360px, 50vh, 520px);
    background: linear-gradient(135deg, #0d253d, #071321);
    border: 1px solid var(--line);
    box-shadow: 0 24px 68px rgba(0,5,12,.62);
    display: flex; align-items: flex-end;
    margin-bottom: 28px;
  }
  .hero-bg {
    position: absolute; inset: 0; z-index: 0;
  }
  .hero-bg img {
    width: 100%; height: 100%; object-fit: cover; object-position: center 22%;
    transition: opacity .45s ease;
  }
  .hero-bg::after {
    content: ''; position: absolute; inset: 0;
    background:
      linear-gradient(90deg, rgba(6,15,26,.95) 0%, rgba(6,15,26,.82) 38%, rgba(6,15,26,.34) 68%, rgba(6,15,26,.22) 100%),
      linear-gradient(180deg, rgba(6,15,26,.22) 0%, rgba(6,15,26,.08) 40%, rgba(6,15,26,.94) 100%);
  }
  .hero-content {
    position: relative; z-index: 2; width: 100%;
    padding: clamp(24px, 4vw, 48px);
    display: flex; flex-direction: column; gap: 14px; max-width: 680px;
  }
  .hero-meta {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    font-size: .8rem; font-weight: 650; color: var(--text-soft);
  }
  .pill {
    display: inline-flex; align-items: center; gap: 5px;
    height: 26px; padding: 0 10px; border-radius: var(--r-pill);
    background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.14);
    backdrop-filter: blur(8px); font-size: .75rem; font-weight: 700;
  }
  .pill-brand { background: var(--brand-soft); border-color: rgba(255,138,43,.45); color: var(--brand-2); }
  .pill-star { color: var(--star); }
  .hero-title {
    font-size: clamp(1.9rem, 4.2vw, 3.35rem); font-weight: 850;
    letter-spacing: -.04em; line-height: 1.04; text-wrap: balance;
    text-shadow: 0 6px 28px rgba(0,0,0,.6);
  }
  .hero-desc {
    color: var(--text-soft); font-size: clamp(.92rem, 1.2vw, 1.02rem); line-height: 1.55;
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
    max-width: 58ch;
  }
  .hero-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 4px; }
  .hero-nav {
    position: absolute; right: 20px; bottom: 20px; z-index: 3;
    display: flex; align-items: center; gap: 8px;
  }
  .hero-dots { display: flex; align-items: center; gap: 6px; margin-right: 4px; }
  .hero-dot {
    width: 8px; height: 8px; border-radius: var(--r-pill);
    background: rgba(255,255,255,.28); transition: width .24s var(--ease), background .24s;
  }
  .hero-dot.active { width: 24px; background: var(--brand); }
  .hero-arrow {
    width: 34px; height: 34px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    background: rgba(6,15,26,.65); border: 1px solid rgba(255,255,255,.18);
    color: #fff; backdrop-filter: blur(10px);
  }
  .hero-arrow:hover { background: rgba(255,138,43,.25); border-color: var(--brand); }

  /* ── Franja de plataformas ──────────────────────────────────────────────── */
  .platforms-strip { margin: 0 0 28px; }
  .strip-label {
    font-size: .74rem; font-weight: 750; letter-spacing: .1em; text-transform: uppercase;
    color: var(--muted); margin-bottom: 10px; display: flex; align-items: center; gap: 8px;
  }
  .platforms-scroll {
    display: flex; gap: 9px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: none;
  }
  .platforms-scroll::-webkit-scrollbar { display: none; }
  .plat-pill {
    flex: 0 0 auto; display: inline-flex; align-items: center; gap: 9px;
    height: 44px; padding: 4px 15px 4px 7px; border-radius: 13px;
    background: var(--card); border: 1px solid var(--line);
    color: var(--text-soft); font-size: .85rem; font-weight: 650;
    transition: transform .18s var(--ease), border-color .18s, background .18s, color .18s;
  }
  .plat-pill:hover, .plat-pill.active {
    transform: translateY(-2px); color: #fff;
    background: var(--card-hi); border-color: rgba(255,138,43,.55);
  }
  .plat-pill.active { box-shadow: 0 0 0 2px rgba(255,138,43,.28); }
  .plat-logo {
    width: 30px; height: 30px; border-radius: 8px; overflow: hidden;
    background: rgba(255,255,255,.08); display: grid; place-items: center;
    font-size: .72rem; font-weight: 800; color: var(--brand-2);
  }
  .plat-logo img { width: 100%; height: 100%; object-fit: cover; }

  /* ── Estantes (Rails) ───────────────────────────────────────────────────── */
  .rail-section { margin-bottom: 32px; }
  .rail-head {
    display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
    margin-bottom: 14px;
  }
  .rail-title {
    font-size: clamp(1.12rem, 2vw, 1.38rem); font-weight: 800; letter-spacing: -.025em;
    display: flex; align-items: center; gap: 9px;
  }
  .rail-title .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--brand); }
  .rail-more {
    font-size: .82rem; font-weight: 700; color: var(--brand-2);
    display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: var(--r-pill);
  }
  .rail-more:hover { background: var(--brand-soft); }

  .rail-wrap { position: relative; }
  .rail-track {
    display: grid; grid-auto-flow: column;
    grid-auto-columns: clamp(134px, 15.5vw, 184px);
    gap: 14px; overflow-x: auto; scroll-snap-type: x proximity;
    padding: 4px 2px 12px; scrollbar-width: none;
  }
  .rail-track::-webkit-scrollbar { display: none; }
  .rail-track.continue-track { grid-auto-columns: clamp(220px, 24vw, 290px); }

  .rail-arrow {
    position: absolute; top: 42%; transform: translateY(-50%); z-index: 4;
    width: 38px; height: 38px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    background: rgba(6,15,26,.85); border: 1px solid rgba(255,255,255,.2);
    color: #fff; box-shadow: 0 8px 24px rgba(0,0,0,.55);
    opacity: 0; transition: opacity .2s, background .2s, border-color .2s;
  }
  .rail-wrap:hover .rail-arrow, .rail-arrow:focus-visible { opacity: 1; }
  .rail-arrow:hover { background: var(--brand); color: #10283d; border-color: var(--brand); }
  .rail-arrow.prev { left: -12px; }
  .rail-arrow.next { right: -12px; }

  /* ── Tarjeta de póster ──────────────────────────────────────────────────── */
  .card {
    position: relative; scroll-snap-align: start;
    display: flex; flex-direction: column; gap: 8px; text-align: left;
    border-radius: 14px; transition: transform .24s var(--ease);
  }
  .card:hover { transform: translateY(-5px); }
  .card-poster {
    position: relative; aspect-ratio: 2 / 3; border-radius: 14px; overflow: hidden;
    background: linear-gradient(160deg, #10263b, #081523);
    border: 1px solid var(--line);
    box-shadow: 0 10px 26px rgba(0,5,12,.45);
    transition: border-color .22s, box-shadow .22s;
  }
  .card:hover .card-poster {
    border-color: rgba(255,138,43,.6);
    box-shadow: 0 18px 36px rgba(0,5,12,.68), 0 0 0 1px rgba(255,138,43,.3);
  }
  .card-poster img { width: 100%; height: 100%; object-fit: cover; transition: transform .35s var(--ease); }
  .card:hover .card-poster img { transform: scale(1.04); }
  .card-fallback {
    position: absolute; inset: 0; padding: 14px;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; gap: 8px; color: var(--muted); font-size: .8rem; font-weight: 700;
  }
  .card-overlay {
    position: absolute; inset: 0;
    background: linear-gradient(180deg, rgba(6,15,26,.05) 35%, rgba(6,15,26,.88) 100%);
    opacity: 0; transition: opacity .22s;
    display: flex; align-items: center; justify-content: center;
  }
  .card:hover .card-overlay, .card:focus-visible .card-overlay { opacity: 1; }
  .card-play {
    width: 48px; height: 48px; border-radius: 50%;
    background: var(--grad); color: #10283d;
    display: grid; place-items: center;
    box-shadow: 0 10px 26px rgba(245,130,31,.5);
    transform: scale(.9); transition: transform .2s var(--ease);
  }
  .card:hover .card-play { transform: scale(1); }
  .card-rating {
    position: absolute; top: 8px; left: 8px; z-index: 2;
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 7px; border-radius: 8px;
    background: rgba(6,15,26,.78); border: 1px solid rgba(255,255,255,.12);
    backdrop-filter: blur(8px); font-size: .72rem; font-weight: 750; color: var(--star);
  }
  .card-type {
    position: absolute; top: 8px; right: 8px; z-index: 2;
    padding: 3px 7px; border-radius: 8px;
    background: rgba(6,15,26,.78); border: 1px solid rgba(255,255,255,.12);
    font-size: .66rem; font-weight: 750; text-transform: uppercase; letter-spacing: .04em;
    color: var(--text-soft);
  }
  .card-type.anime { background: rgba(255,138,43,.22); border-color: rgba(255,138,43,.5); color: var(--brand-3); }
  .card-title {
    font-size: .88rem; font-weight: 700; color: var(--text); line-height: 1.28;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .card-sub { font-size: .76rem; color: var(--muted); }

  /* Tarjeta horizontal "Seguir viendo" */
  .cw-card {
    position: relative; scroll-snap-align: start; border-radius: 14px; overflow: hidden;
    background: var(--card); border: 1px solid var(--line); text-align: left;
    transition: transform .22s var(--ease), border-color .22s;
  }
  .cw-card:hover { transform: translateY(-4px); border-color: rgba(255,138,43,.55); }
  .cw-thumb { position: relative; aspect-ratio: 16 / 9; background: #091627; overflow: hidden; }
  .cw-thumb img { width: 100%; height: 100%; object-fit: cover; }
  .cw-thumb::after {
    content: ''; position: absolute; inset: 0;
    background: linear-gradient(180deg, transparent 35%, rgba(6,15,26,.9) 100%);
  }
  .cw-progress { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: rgba(255,255,255,.18); z-index: 2; }
  .cw-progress i { display: block; height: 100%; background: var(--brand); }
  .cw-remove {
    position: absolute; top: 8px; right: 8px; z-index: 3; width: 28px; height: 28px; border-radius: 50%;
    display: grid; place-items: center; background: rgba(6,15,26,.78); color: var(--text-soft);
    border: 1px solid rgba(255,255,255,.15);
  }
  .cw-remove:hover { background: var(--danger); color: #fff; border-color: var(--danger); }
  .cw-body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 2px; }
  .cw-title { font-size: .88rem; font-weight: 750; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cw-meta { font-size: .76rem; color: var(--brand-2); font-weight: 650; }

  /* ── Rejilla completa (Búsqueda / Explorar / Mi Lista / Plataforma) ────── */
  .view-bar {
    display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
    margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid var(--line);
  }
  .view-bar-left { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .view-heading { font-size: clamp(1.3rem, 2.6vw, 1.85rem); font-weight: 800; letter-spacing: -.03em; }
  .filter-pills { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .fpill {
    height: 34px; padding: 0 14px; border-radius: var(--r-pill);
    background: rgba(255,255,255,.06); border: 1px solid var(--line);
    color: var(--text-soft); font-size: .82rem; font-weight: 650;
  }
  .fpill:hover { border-color: var(--line-strong); color: #fff; }
  .fpill.active { background: var(--grad); color: #10283d; border-color: transparent; font-weight: 750; }

  .poster-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(clamp(132px, 16vw, 178px), 1fr));
    gap: 18px 14px;
  }
  .load-more-wrap { display: flex; justify-content: center; margin-top: 28px; }

  .empty-state {
    padding: 56px 20px; text-align: center; border-radius: 20px;
    background: var(--card); border: 1px dashed var(--line-strong);
    display: flex; flex-direction: column; align-items: center; gap: 10px;
  }
  .empty-state h3 { font-size: 1.12rem; font-weight: 750; }
  .empty-state p { color: var(--muted); max-width: 44ch; font-size: .92rem; }

  /* Skeleton shimmer */
  .skel-card { aspect-ratio: 2 / 3; border-radius: 14px; background: linear-gradient(110deg, #0c1d2f 25%, #14304c 50%, #0c1d2f 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite linear; }
  @keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }

  /* ── Vista de Detalle + Reproductor Cinema ──────────────────────────────── */
  .detail-overlay {
    position: fixed; inset: 0; z-index: 100; overflow-y: auto;
    background: rgba(3,9,16,.92);
    backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
    padding: clamp(10px, 2.5vw, 28px);
  }
  .detail-shell {
    max-width: 1120px; margin: 0 auto; border-radius: 24px; overflow: hidden;
    background: #081523; border: 1px solid var(--line-strong);
    box-shadow: 0 32px 90px rgba(0,0,0,.78);
  }
  .detail-top-bar {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 12px 16px; background: rgba(6,15,26,.85); border-bottom: 1px solid var(--line);
    position: sticky; top: 0; z-index: 10; backdrop-filter: blur(16px);
  }
  .detail-crumb {
    font-size: .9rem; font-weight: 700; color: var(--text-soft);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  /* Escenario del reproductor */
  .player-stage {
    background: #000; border-bottom: 1px solid var(--line);
  }
  .video-box {
    position: relative; width: 100%; aspect-ratio: 16 / 9; max-height: 72vh;
    background: #000; display: flex; align-items: center; justify-content: center;
  }
  .video-box video {
    width: 100%; height: 100%; background: #000; outline: none;
  }
  .player-status {
    position: absolute; inset: 0; z-index: 3; padding: 24px;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; gap: 12px; background: rgba(4,10,18,.84);
  }
  .spinner {
    width: 40px; height: 40px; border-radius: 50%;
    border: 3px solid rgba(255,255,255,.16); border-top-color: var(--brand);
    animation: spin .85s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .player-status-title { font-size: 1rem; font-weight: 750; color: #fff; }
  .player-status-sub { font-size: .86rem; color: var(--muted); max-width: 48ch; }

  .next-ep-prompt {
    position: absolute; right: 18px; bottom: 122px; z-index: 4;
    padding: 10px 14px; border-radius: 14px;
    background: rgba(8,20,33,.92); border: 1px solid rgba(255,138,43,.55);
    display: flex; align-items: center; gap: 10px; box-shadow: 0 14px 36px rgba(0,0,0,.65);
  }
  .skip-prompt {
    position: absolute; right: 18px; bottom: 64px; z-index: 5;
    display: flex; align-items: center; gap: 8px;
  }
  .skip-prompt-btn {
    display: inline-flex; align-items: center; gap: 9px;
    padding: 10px 16px; border-radius: 14px;
    background: rgba(8,20,33,.92); color: #fff;
    border: 1px solid rgba(255,138,43,.72);
    font-size: .88rem; font-weight: 760; letter-spacing: -.01em;
    box-shadow: 0 14px 38px rgba(0,0,0,.68);
    backdrop-filter: blur(12px);
    transition: transform .14s ease, background .16s ease, border-color .16s ease;
  }
  .skip-prompt-btn:hover {
    transform: translateY(-2px);
    background: linear-gradient(135deg, var(--brand) 0%, #ff6a00 100%);
    border-color: var(--brand-2); color: #08121d;
  }
  .skip-prompt-src {
    font-family: ${MONO_STACK}; font-size: .68rem; font-weight: 700;
    padding: 2px 7px; border-radius: 999px;
    background: rgba(255,255,255,.12); color: var(--brand-3);
  }
  .skip-prompt-btn:hover .skip-prompt-src {
    background: rgba(8,18,29,.22); color: #08121d;
  }
  .skip-prompt-kbd {
    font-family: ${MONO_STACK}; font-size: .66rem; font-weight: 750;
    padding: 2px 6px; border-radius: 6px;
    border: 1px solid rgba(255,255,255,.22); color: var(--muted);
  }
  .skip-prompt-btn:hover .skip-prompt-kbd {
    border-color: rgba(8,18,29,.35); color: #08121d;
  }
  .btn-toggle.active {
    background: var(--brand-soft); border-color: var(--brand); color: #fff;
  }
  .skip-bar {
    display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
    padding: 9px 12px; border-radius: 12px;
    background: rgba(255,138,43,.06); border: 1px solid rgba(255,138,43,.22);
    font-size: .78rem; color: var(--text-soft);
  }
  .skip-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .skip-chip {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 9px; border-radius: 999px;
    background: rgba(255,255,255,.07); border: 1px solid var(--line-strong);
    color: var(--text-soft); font-size: .74rem; font-weight: 650;
    transition: background .15s, border-color .15s, color .15s;
  }
  .skip-chip:hover { background: rgba(255,138,43,.2); border-color: var(--brand); color: #fff; }
  .skip-chip-time { font-family: ${MONO_STACK}; font-size: .69rem; color: var(--brand-3); }
  .skip-providers-note { font-size: .72rem; color: var(--muted); }

  .player-controls-bar {
    display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
    padding: 10px 16px; background: #071321; border-top: 1px solid var(--line);
  }
  .player-ctrl-group { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .player-select {
    height: 32px; padding: 0 10px; border-radius: 9px;
    background: rgba(255,255,255,.07); border: 1px solid var(--line-strong);
    color: var(--text); font-size: .78rem; font-weight: 650;
  }
  .player-select option { background: #0c1d2f; color: #fff; }

  .sources-panel {
    padding: 14px 16px; background: #091829; border-top: 1px solid var(--line);
    display: flex; flex-direction: column; gap: 10px;
  }
  .sources-head {
    display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
  }
  .sources-label {
    font-size: .76rem; font-weight: 750; letter-spacing: .08em; text-transform: uppercase;
    color: var(--muted);
  }
  .sources-list { display: flex; gap: 8px; flex-wrap: wrap; }
  .source-chip {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 7px 12px; border-radius: 11px;
    background: rgba(255,255,255,.06); border: 1px solid var(--line-strong);
    color: var(--text-soft); font-size: .8rem; font-weight: 650;
    transition: background .16s, border-color .16s, color .16s;
  }
  .source-chip:hover { background: rgba(255,255,255,.12); color: #fff; }
  .source-chip.active {
    background: var(--brand-soft); border-color: var(--brand); color: #fff;
    box-shadow: 0 0 0 1px rgba(255,138,43,.35);
  }
  .source-chip.failed { opacity: .55; border-color: rgba(255,69,58,.4); }
  .source-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); }
  .source-chip.active .source-dot { background: var(--ok); box-shadow: 0 0 8px var(--ok); }
  .source-chip.failed .source-dot { background: var(--danger); }
  .source-q {
    font-family: ${MONO_STACK}; font-size: .7rem; font-weight: 750;
    padding: 1px 6px; border-radius: 6px; background: rgba(255,255,255,.1); color: var(--brand-3);
  }

  .fallback-bar {
    display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
    padding: 10px 12px; border-radius: 12px;
    background: rgba(255,255,255,.035); border: 1px solid var(--line);
    font-size: .8rem; color: var(--muted);
  }
  .fallback-actions { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }

  /* Ficha de título */
  .detail-hero {
    position: relative; overflow: hidden; padding: clamp(20px, 3.4vw, 34px);
    display: grid; grid-template-columns: 185px minmax(0, 1fr); gap: 24px; align-items: start;
  }
  .detail-backdrop { position: absolute; inset: 0; z-index: 0; opacity: .28; }
  .detail-backdrop img { width: 100%; height: 100%; object-fit: cover; }
  .detail-backdrop::after {
    content: ''; position: absolute; inset: 0;
    background: linear-gradient(180deg, rgba(8,21,35,.45) 0%, #081523 100%);
  }
  .detail-poster {
    position: relative; z-index: 1; aspect-ratio: 2 / 3; border-radius: 16px; overflow: hidden;
    border: 1px solid var(--line-strong); box-shadow: 0 18px 44px rgba(0,0,0,.6);
    background: var(--card);
  }
  .detail-poster img { width: 100%; height: 100%; object-fit: cover; }
  .detail-info { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
  .detail-title { font-size: clamp(1.5rem, 3.2vw, 2.3rem); font-weight: 850; letter-spacing: -.035em; line-height: 1.08; }
  .detail-tags { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .detail-desc { color: var(--text-soft); font-size: .94rem; line-height: 1.62; white-space: pre-line; }
  .detail-credits { display: flex; flex-direction: column; gap: 4px; font-size: .84rem; color: var(--muted); }
  .detail-credits strong { color: var(--text-soft); }
  .detail-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 4px; }

  /* Episodios */
  .episodes-box { padding: 4px clamp(16px, 3vw, 34px) 32px; }
  .seasons-bar {
    display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
    margin-bottom: 16px; padding-top: 14px; border-top: 1px solid var(--line);
  }
  .seasons-tabs { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; }
  .seasons-tabs::-webkit-scrollbar { display: none; }
  .manual-ep {
    display: flex; align-items: center; gap: 6px; font-size: .8rem; color: var(--muted);
  }
  .manual-ep input {
    width: 56px; height: 32px; padding: 0 8px; border-radius: 8px; text-align: center;
    background: rgba(255,255,255,.07); border: 1px solid var(--line-strong); color: #fff;
  }
  .episodes-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 12px;
  }
  .ep-card {
    display: flex; gap: 12px; padding: 10px; border-radius: 14px; text-align: left;
    background: var(--card); border: 1px solid var(--line);
    transition: border-color .18s, background .18s, transform .18s;
  }
  .ep-card:hover { background: var(--card-hi); border-color: rgba(255,138,43,.5); transform: translateY(-2px); }
  .ep-card.playing { border-color: var(--brand); background: rgba(255,138,43,.1); }
  .ep-thumb {
    position: relative; flex: 0 0 112px; aspect-ratio: 16 / 9; border-radius: 9px; overflow: hidden;
    background: #071321; align-self: center;
  }
  .ep-thumb img { width: 100%; height: 100%; object-fit: cover; }
  .ep-num {
    position: absolute; bottom: 4px; left: 4px; padding: 1px 6px; border-radius: 5px;
    background: rgba(6,15,26,.85); font-family: ${MONO_STACK}; font-size: .68rem; font-weight: 750;
  }
  .ep-body { min-width: 0; display: flex; flex-direction: column; gap: 3px; flex: 1; }
  .ep-title { font-size: .86rem; font-weight: 750; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ep-date { font-size: .72rem; color: var(--muted); }
  .ep-ov {
    font-size: .77rem; color: var(--muted); line-height: 1.4;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }

  /* Toast */
  .toast {
    position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%) translateY(16px);
    z-index: 200; padding: 10px 18px; border-radius: var(--r-pill);
    background: rgba(12,29,47,.96); border: 1px solid rgba(255,138,43,.5);
    color: #fff; font-size: .86rem; font-weight: 650;
    box-shadow: 0 14px 36px rgba(0,0,0,.6);
    opacity: 0; pointer-events: none; transition: opacity .22s, transform .22s var(--ease);
  }
  .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

  /* Pie */
  .w-footer {
    max-width: var(--wrap); margin: 0 auto; padding: 24px var(--pad) 40px;
    border-top: 1px solid var(--line); color: var(--muted); font-size: .8rem;
    display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
  }
  .w-footer-links { display: flex; gap: 16px; flex-wrap: wrap; }
  .w-footer-links a:hover { color: var(--brand-2); }

  @media (max-width: 920px) {
    .w-nav-inner { flex-wrap: wrap; padding: 8px 10px; gap: 8px; }
    .w-tabs { order: 3; width: 100%; margin-left: 0; padding-top: 2px; }
    .w-search { flex: 1 1 160px; max-width: none; }
    .w-nav-actions .lbl { display: none; }
    .detail-hero { grid-template-columns: 1fr; }
    .detail-poster { width: 136px; }
  }
  @media (max-width: 600px) {
    .hero { min-height: 360px; border-radius: 18px; }
    .hero-nav { right: 12px; bottom: 12px; }
    .rail-arrow { display: none; }
    .detail-overlay { padding: 0; }
    .detail-shell { border-radius: 0; border: 0; min-height: 100vh; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
  }
</style>
</head>
<body>
<div class="bg-glow" aria-hidden="true"></div>

<nav class="w-nav" aria-label="Navegación principal">
  <div class="w-nav-inner">
    <a class="w-brand" href="/watch" id="brandHome" aria-label="RamdonLatam Watch, inicio">
      <img src="/assets/logo.png" alt="" width="32" height="32" />
      <span>Ramdon<i>Latam</i></span>
      <span class="w-brand-badge">Watch</span>
    </a>

    <div class="w-tabs" role="tablist" aria-label="Secciones">
      <button class="w-tab active" type="button" role="tab" aria-selected="true" data-section="inicio">${icon('home', 15)} Inicio</button>
      <button class="w-tab" type="button" role="tab" aria-selected="false" data-section="peliculas">${icon('film', 15)} Películas</button>
      <button class="w-tab" type="button" role="tab" aria-selected="false" data-section="series">${icon('tv', 15)} Series</button>
      <button class="w-tab" type="button" role="tab" aria-selected="false" data-section="anime">${icon('sparkles', 15)} Anime</button>
      <button class="w-tab" type="button" role="tab" aria-selected="false" data-section="lista">${icon('bookmark', 15)} Mi lista <span class="badge-n" id="listCount" hidden>0</span></button>
    </div>

    <form class="w-search" id="searchForm" role="search" autocomplete="off">
      ${icon('search', 16, 'ic-search')}
      <input id="searchInput" type="search" placeholder="Buscar películas, series o anime… (/)" aria-label="Buscar películas, series o anime" />
      <button class="w-search-clear" id="searchClear" type="button" aria-label="Limpiar búsqueda" hidden>${icon('x', 14)}</button>
    </form>

    <div class="w-nav-actions">
      <a class="btn btn-ghost btn-sm" href="/configure" title="Configurar addon">${icon('sliders-horizontal', 15)}<span class="lbl">Configurar</span></a>
      <a class="btn btn-ghost btn-sm" href="/" title="Ir a la portada del addon">${icon('download', 15)}<span class="lbl">Stremio</span></a>
    </div>
  </div>
</nav>

<main class="w-main" id="appRoot">
  <section id="browseView">
    <div id="heroMount"></div>
    <div id="platformsMount" class="platforms-strip" hidden></div>
    <div id="railsMount"></div>
  </section>

  <section id="gridView" hidden></section>
  <section id="searchView" hidden></section>
</main>

<div class="detail-overlay" id="detailOverlay" role="dialog" aria-modal="true" aria-labelledby="detailTitle" hidden>
  <div class="detail-shell" id="detailShell"></div>
</div>

<div class="toast" id="toast" role="status" aria-live="polite"></div>

<footer class="w-footer">
  <span>RamdonLatam Watch · Películas, series y anime en español latino y subtitulado. Gratis y sin cuenta.</span>
  <div class="w-footer-links">
    <a href="/">Addon Stremio</a>
    <a href="/configure">Configurar</a>
    <a href="/manifest.json">manifest.json</a>
    <a href="/healthz">Estado</a>
  </div>
</footer>

<script>
(function () {
  'use strict';

  const BOOT = ${bootstrap};
  const IC = ${clientIcons};
  const CFG_PREFIX = BOOT.cfgPrefix || '';
  const LS_LIST = 'rl_watch_mylist_v1';
  const LS_HISTORY = 'rl_watch_history_v1';
  const LS_AUTOSKIP = 'rl_watch_autoskip_v1';
  const HLS_CDNS = [
    'https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js',
    'https://unpkg.com/hls.js@1.5.20/dist/hls.min.js',
  ];

  const state = {
    catalogs: null,
    branding: { providers: {} },
    section: 'inicio',
    heroItems: [],
    heroIndex: 0,
    heroTimer: null,
    catalogCache: new Map(),
    metaCache: new Map(),
    activePlatform: null,
    searchQuery: '',
    searchType: 'all',
    searchTimer: null,
    searchToken: 0,
    gridContext: null,
    detail: null,
    player: {
      hls: null,
      streams: [],
      streamIndex: -1,
      failedIndices: new Set(),
      blobUrls: [],
      episodeKey: null,
      loading: false,
      lastSaveAt: 0,
      autoAdvanceShown: false,
      skipSegments: [],
      skipProviders: [],
      skipFetchToken: 0,
      skipDurationRequested: 0,
      activeSkipSeg: null,
      autoSkippedKeys: new Set(),
    },
  };

  const $ = (id) => document.getElementById(id);
  const browseView = $('browseView');
  const heroMount = $('heroMount');
  const platformsMount = $('platformsMount');
  const railsMount = $('railsMount');
  const gridView = $('gridView');
  const searchView = $('searchView');
  const detailOverlay = $('detailOverlay');
  const detailShell = $('detailShell');
  const searchInput = $('searchInput');
  const searchClear = $('searchClear');
  const toastEl = $('toast');

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeUrl(u) {
    const s = String(u || '').trim();
    return /^https?:\\/\\//i.test(s) ? s : '';
  }

  function posterUrl(u, size) {
    const s = safeUrl(u);
    if (!s) return '';
    return s.replace(/^(https:\\/\\/image\\.tmdb\\.org\\/t\\/p\\/)w\\d+\\//i, '$1' + (size || 'w342') + '/');
  }

  let toastTimer = null;
  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
  }

  // ── Persistencia local: Mi lista e Historial ("Seguir viendo") ────────────
  function readStore(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }
  function writeStore(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) { /* cuota */ }
  }
  function getAutoSkip() {
    return Boolean(readStore(LS_AUTOSKIP, false));
  }
  function setAutoSkip(enabled) {
    writeStore(LS_AUTOSKIP, Boolean(enabled));
  }
  function fmtClock(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
    const rr = String(r).padStart(2, '0');
    return h > 0 ? (h + ':' + mm + ':' + rr) : (mm + ':' + rr);
  }

  function getMyList() {
    const list = readStore(LS_LIST, []);
    return Array.isArray(list) ? list : [];
  }
  function isInMyList(type, id) {
    return getMyList().some((it) => it.id === id && it.type === type);
  }
  function toggleMyList(item) {
    if (!item || !item.id) return false;
    const list = getMyList();
    const idx = list.findIndex((it) => it.id === item.id && it.type === item.type);
    let added = false;
    if (idx >= 0) {
      list.splice(idx, 1);
    } else {
      list.unshift({
        id: item.id,
        type: item.type || 'movie',
        name: item.name || item.id,
        poster: item.poster || '',
        background: item.background || '',
        releaseInfo: item.releaseInfo || '',
        imdbRating: item.imdbRating || '',
        description: item.description || '',
        isAnime: Boolean(item.isAnime),
      });
      added = true;
    }
    writeStore(LS_LIST, list.slice(0, 120));
    updateListBadge();
    showToast(added ? 'Añadido a Mi lista' : 'Quitado de Mi lista');
    return added;
  }

  function updateListBadge() {
    const n = getMyList().length;
    const el = $('listCount');
    if (!el) return;
    el.textContent = String(n);
    el.hidden = n === 0;
  }

  function getHistory() {
    const list = readStore(LS_HISTORY, []);
    return Array.isArray(list) ? list : [];
  }
  function saveProgress(entry) {
    if (!entry || !entry.id) return;
    const list = getHistory().filter((it) => !(it.id === entry.id && it.type === entry.type));
    list.unshift({ ...entry, updatedAt: Date.now() });
    writeStore(LS_HISTORY, list.slice(0, 40));
  }
  function removeHistory(type, id) {
    writeStore(LS_HISTORY, getHistory().filter((it) => !(it.id === id && it.type === type)));
  }
  function findProgress(type, id, season, episode) {
    const found = getHistory().find((it) => it.id === id && it.type === type);
    if (!found) return null;
    if (type === 'series' && season != null && episode != null) {
      if (Number(found.season) !== Number(season) || Number(found.episode) !== Number(episode)) return null;
    }
    return found;
  }

  // ── Peticiones al backend de RamdonLatam ──────────────────────────────────
  async function fetchJson(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function loadCatalog(type, id, skip) {
    const pageSkip = Number(skip) || 0;
    const key = type + ':' + id + ':' + pageSkip;
    if (state.catalogCache.has(key)) return state.catalogCache.get(key);
    const suffix = pageSkip > 0 ? '/skip=' + pageSkip + '.json' : '.json';
    const url = CFG_PREFIX + '/catalog/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + suffix;
    try {
      const data = await fetchJson(url);
      let metas = Array.isArray(data && data.metas) ? data.metas : [];
      if (!metas.length && pageSkip === 0) {
        const fb = await fetchJson('/internal/watch/fallback/' + encodeURIComponent(type) + '/' + encodeURIComponent(id)).catch(() => null);
        if (fb && Array.isArray(fb.metas)) metas = fb.metas;
      }
      if (id === 'tv_anime' || id === 'cine_anime' || id === 'tv_crunchyroll' || id === 'cine_crunchyroll') {
        metas = metas.map((m) => ({ ...m, isAnime: true }));
      }
      state.catalogCache.set(key, metas);
      return metas;
    } catch (_) {
      return [];
    }
  }

  async function loadMeta(type, id) {
    const key = type + ':' + id;
    if (state.metaCache.has(key)) return state.metaCache.get(key);
    const url = '/internal/watch/meta/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + '.json';
    const data = await fetchJson(url);
    const meta = (data && data.meta) || { id, type, name: id };
    state.metaCache.set(key, meta);
    return meta;
  }

  async function loadStreams(type, streamId) {
    const url = CFG_PREFIX + '/stream/' + encodeURIComponent(type) + '/' + encodeURIComponent(streamId) + '.json';
    const data = await fetchJson(url);
    return Array.isArray(data && data.streams) ? data.streams : [];
  }

  // ── Carga diferida de hls.js ──────────────────────────────────────────────
  let hlsPromise = null;
  function ensureHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (hlsPromise) return hlsPromise;
    hlsPromise = new Promise((resolve) => {
      let idx = 0;
      function tryNext() {
        if (idx >= HLS_CDNS.length) return resolve(null);
        const s = document.createElement('script');
        s.src = HLS_CDNS[idx++];
        s.async = true;
        s.crossOrigin = 'anonymous';
        s.referrerPolicy = 'no-referrer';
        s.onload = () => resolve(window.Hls || null);
        s.onerror = () => { s.remove(); tryNext(); };
        document.head.appendChild(s);
      }
      tryNext();
    });
    return hlsPromise;
  }

  // ── Renderizado de tarjetas y estantes ────────────────────────────────────
  function typeBadgeLabel(item) {
    if (item.isAnime) return { text: 'Anime', cls: 'anime' };
    return item.type === 'series' ? { text: 'Serie', cls: '' } : { text: 'Película', cls: '' };
  }

  function cardHtml(item) {
    const poster = posterUrl(item.poster, 'w342');
    const badge = typeBadgeLabel(item);
    const year = esc(String(item.releaseInfo || '').slice(0, 4));
    const rating = item.imdbRating ? '<span class="card-rating">' + IC.star + ' ' + esc(item.imdbRating) + '</span>' : '';
    const img = poster
      ? '<img src="' + esc(poster) + '" alt="' + esc(item.name) + '" loading="lazy" decoding="async" referrerpolicy="no-referrer" />'
      : '';
    const fb = '<div class="card-fallback"' + (poster ? ' hidden' : '') + '>' + IC.film + '<span>' + esc(item.name) + '</span></div>';
    return '<button type="button" class="card" data-open-type="' + esc(item.type || 'movie') + '" data-open-id="' + esc(item.id) + '" data-item-json="' + esc(JSON.stringify({
      id: item.id, type: item.type || 'movie', name: item.name || item.id,
      poster: item.poster || '', background: item.background || '',
      releaseInfo: item.releaseInfo || '', imdbRating: item.imdbRating || '',
      description: item.description || '', isAnime: Boolean(item.isAnime),
    })) + '">'
      + '<div class="card-poster">' + img + fb + rating
      + '<span class="card-type ' + badge.cls + '">' + badge.text + '</span>'
      + '<span class="card-overlay"><span class="card-play">' + IC.play + '</span></span></div>'
      + '<div class="card-title">' + esc(item.name || item.id) + '</div>'
      + (year ? '<div class="card-sub">' + year + '</div>' : '')
      + '</button>';
  }

  function continueWatchingHtml() {
    const hist = getHistory();
    if (!hist.length) return '';
    const cards = hist.slice(0, 12).map((h) => {
      const thumb = posterUrl(h.background || h.poster, 'w500');
      const pct = h.duration > 0 ? Math.min(100, Math.max(4, Math.round((h.time / h.duration) * 100))) : 12;
      const sub = h.type === 'series' && h.season && h.episode
        ? 'T' + h.season + ' · E' + h.episode + (h.episodeTitle ? ' · ' + h.episodeTitle : '')
        : 'Continuar película';
      return '<div class="cw-card">'
        + '<button type="button" class="cw-remove" data-cw-remove-type="' + esc(h.type) + '" data-cw-remove-id="' + esc(h.id) + '" aria-label="Quitar de Seguir viendo">' + IC.close + '</button>'
        + '<button type="button" style="display:block;width:100%;text-align:left" data-open-type="' + esc(h.type) + '" data-open-id="' + esc(h.id) + '" data-open-season="' + esc(h.season || '') + '" data-open-ep="' + esc(h.episode || '') + '" data-autoplay="1">'
        + '<div class="cw-thumb">'
        + (thumb ? '<img src="' + esc(thumb) + '" alt="' + esc(h.name) + '" loading="lazy" referrerpolicy="no-referrer" />' : '')
        + '<div class="cw-progress"><i style="width:' + pct + '%"></i></div></div>'
        + '<div class="cw-body"><div class="cw-title">' + esc(h.name) + '</div><div class="cw-meta">' + esc(sub) + '</div></div>'
        + '</button></div>';
    }).join('');
    return '<section class="rail-section" id="continueSection">'
      + '<div class="rail-head"><h2 class="rail-title"><span class="dot"></span>Seguir viendo</h2></div>'
      + '<div class="rail-wrap"><div class="rail-track continue-track">' + cards + '</div></div>'
      + '</section>';
  }

  // ── Hero destacado ────────────────────────────────────────────────────────
  function renderHero(items) {
    clearInterval(state.heroTimer);
    state.heroItems = (items || []).filter((m) => m && (m.background || m.poster)).slice(0, 6);
    if (!state.heroItems.length) {
      heroMount.innerHTML = '';
      return;
    }
    state.heroIndex = 0;
    paintHero();
    state.heroTimer = setInterval(() => {
      if (detailOverlay.hidden && !browseView.hidden) {
        state.heroIndex = (state.heroIndex + 1) % state.heroItems.length;
        paintHero();
      }
    }, 8000);
  }

  function paintHero() {
    const item = state.heroItems[state.heroIndex];
    if (!item) return;
    const bg = posterUrl(item.background || item.poster, 'w1280');
    const badge = typeBadgeLabel(item);
    const saved = isInMyList(item.type, item.id);
    const desc = String(item.description || '').split('\\n\\n')[0];
    const dots = state.heroItems.map((_, i) =>
      '<button type="button" class="hero-dot' + (i === state.heroIndex ? ' active' : '') + '" data-hero-dot="' + i + '" aria-label="Destacado ' + (i + 1) + '"></button>'
    ).join('');

    heroMount.innerHTML = '<section class="hero" aria-label="Destacado">'
      + '<div class="hero-bg">' + (bg ? '<img src="' + esc(bg) + '" alt="" referrerpolicy="no-referrer" />' : '') + '</div>'
      + '<div class="hero-content">'
      + '<div class="hero-meta">'
      + '<span class="pill pill-brand">' + esc(badge.text) + '</span>'
      + (item.releaseInfo ? '<span class="pill">' + esc(String(item.releaseInfo).slice(0, 4)) + '</span>' : '')
      + (item.imdbRating ? '<span class="pill pill-star">' + IC.star + ' ' + esc(item.imdbRating) + '</span>' : '')
      + '</div>'
      + '<h1 class="hero-title">' + esc(item.name) + '</h1>'
      + (desc ? '<p class="hero-desc">' + esc(desc) + '</p>' : '')
      + '<div class="hero-actions">'
      + '<button type="button" class="btn btn-primary btn-lg" id="heroPlay">' + IC.playLg + ' Reproducir ahora</button>'
      + '<button type="button" class="btn btn-ghost btn-lg" id="heroInfo">' + IC.info + ' Más info</button>'
      + '<button type="button" class="btn btn-ghost btn-lg" id="heroList">' + (saved ? IC.check + ' En mi lista' : IC.plus + ' Mi lista') + '</button>'
      + '</div></div>'
      + (state.heroItems.length > 1
        ? '<div class="hero-nav"><div class="hero-dots">' + dots + '</div>'
          + '<button type="button" class="hero-arrow" id="heroPrev" aria-label="Anterior">' + IC.chevLeft + '</button>'
          + '<button type="button" class="hero-arrow" id="heroNext" aria-label="Siguiente">' + IC.chevRight + '</button></div>'
        : '')
      + '</section>';

    $('heroPlay').onclick = () => openDetail(item, { autoplay: true });
    $('heroInfo').onclick = () => openDetail(item, { autoplay: false });
    $('heroList').onclick = () => { toggleMyList(item); paintHero(); };
    const prev = $('heroPrev');
    const next = $('heroNext');
    if (prev) prev.onclick = () => { state.heroIndex = (state.heroIndex - 1 + state.heroItems.length) % state.heroItems.length; paintHero(); };
    if (next) next.onclick = () => { state.heroIndex = (state.heroIndex + 1) % state.heroItems.length; paintHero(); };
    heroMount.querySelectorAll('[data-hero-dot]').forEach((btn) => {
      btn.onclick = () => { state.heroIndex = Number(btn.dataset.heroDot); paintHero(); };
    });
  }

  // ── Franja de plataformas ─────────────────────────────────────────────────
  function renderPlatformsStrip() {
    if (!state.catalogs || !state.catalogs.platforms || !state.catalogs.platforms.length) {
      platformsMount.hidden = true;
      return;
    }
    const show = ['inicio', 'peliculas', 'series'].includes(state.section);
    platformsMount.hidden = !show;
    if (!show) return;

    const providers = (state.branding && state.branding.providers) || {};
    const pills = state.catalogs.platforms.slice(0, 16).map((p) => {
      const logo = safeUrl(providers[p.key]);
      const initials = esc(p.name.slice(0, 2).toUpperCase());
      return '<button type="button" class="plat-pill' + (state.activePlatform === p.key ? ' active' : '') + '" data-platform="' + esc(p.key) + '">'
        + '<span class="plat-logo">' + (logo ? '<img src="' + esc(logo) + '" alt="" loading="lazy" />' : initials) + '</span>'
        + '<span>' + esc(p.name) + '</span></button>';
    }).join('');
    platformsMount.innerHTML = '<div class="strip-label">Explorar por plataforma</div><div class="platforms-scroll">' + pills + '</div>';
    platformsMount.querySelectorAll('[data-platform]').forEach((btn) => {
      btn.onclick = () => openPlatformView(btn.dataset.platform);
    });
  }

  // ── Secciones principales ─────────────────────────────────────────────────
  function setActiveTab(sec) {
    state.section = sec;
    document.querySelectorAll('.w-tab').forEach((btn) => {
      const on = btn.dataset.section === sec;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function showOnlyView(name) {
    browseView.hidden = name !== 'browse';
    gridView.hidden = name !== 'grid';
    searchView.hidden = name !== 'search';
  }

  async function renderSection(sec) {
    setActiveTab(sec);
    state.activePlatform = null;
    if (sec === 'lista') {
      showOnlyView('grid');
      renderMyListView();
      return;
    }
    showOnlyView('browse');
    renderPlatformsStrip();
    const defs = (state.catalogs && state.catalogs.sections && state.catalogs.sections[sec]) || [];

    // Esqueletos inmediatos mientras cargan los catálogos.
    railsMount.innerHTML = (sec === 'inicio' ? continueWatchingHtml() : '')
      + defs.map((def, idx) =>
        '<section class="rail-section" data-rail-idx="' + idx + '">'
        + '<div class="rail-head"><h2 class="rail-title"><span class="dot"></span>' + esc(def.name) + '</h2>'
        + '<button type="button" class="rail-more" data-explore-type="' + esc(def.type) + '" data-explore-id="' + esc(def.id) + '" data-explore-name="' + esc(def.name) + '">Ver todo ' + IC.chevRight + '</button></div>'
        + '<div class="rail-wrap"><div class="rail-track" id="rail-' + idx + '">'
        + Array.from({ length: 8 }, () => '<div class="skel-card"></div>').join('')
        + '</div>'
        + '<button type="button" class="rail-arrow prev" data-scroll-dir="-1" data-scroll-target="rail-' + idx + '" aria-label="Desplazar izquierda">' + IC.chevLeft + '</button>'
        + '<button type="button" class="rail-arrow next" data-scroll-dir="1" data-scroll-target="rail-' + idx + '" aria-label="Desplazar derecha">' + IC.chevRight + '</button>'
        + '</div></section>'
      ).join('');

    const token = ++state.searchToken;
    const loaded = await Promise.all(defs.map((def) => loadCatalog(def.type, def.id, 0)));
    if (token !== state.searchToken || state.section !== sec) return;

    // Elegir los destacados del Hero combinando el primer y segundo rail.
    const heroPool = [];
    if (loaded[0]) heroPool.push(...loaded[0].slice(0, 4));
    if (loaded[1]) heroPool.push(...loaded[1].slice(0, 2));
    renderHero(heroPool);

    loaded.forEach((items, idx) => {
      const track = $('rail-' + idx);
      if (!track) return;
      if (!items.length) {
        const secEl = track.closest('.rail-section');
        if (secEl) secEl.hidden = true;
        return;
      }
      track.innerHTML = items.map(cardHtml).join('');
    });
  }

  function renderMyListView() {
    const list = getMyList();
    const hist = getHistory();
    gridView.innerHTML = '<div class="view-bar"><div class="view-bar-left"><h1 class="view-heading">Mi lista</h1>'
      + '<span class="pill">' + list.length + ' guardados</span></div></div>'
      + (hist.length ? continueWatchingHtml() : '')
      + (list.length
        ? '<div class="poster-grid">' + list.map(cardHtml).join('') + '</div>'
        : '<div class="empty-state"><h3>Tu lista está vacía</h3><p>Pulsa «＋ Mi lista» en cualquier película, serie o anime para guardarlo aquí y verlo cuando quieras.</p>'
          + '<button type="button" class="btn btn-primary" id="emptyExplore">Explorar catálogo</button></div>');
    const btn = $('emptyExplore');
    if (btn) btn.onclick = () => renderSection('inicio');
  }

  async function openPlatformView(platformKey) {
    const plat = (state.catalogs && state.catalogs.platforms || []).find((p) => p.key === platformKey);
    if (!plat) return;
    state.activePlatform = platformKey;
    const defaultType = state.section === 'series' && plat.seriesId ? 'series' : (plat.movieId ? 'movie' : 'series');
    const catalogId = defaultType === 'movie' ? plat.movieId : plat.seriesId;
    await openExploreGrid({
      type: defaultType,
      id: catalogId,
      name: plat.name,
      platform: plat,
    });
  }

  async function openExploreGrid({ type, id, name, platform = null }) {
    showOnlyView('grid');
    state.gridContext = { type, id, name, platform, skip: 0, items: [] };
    gridView.innerHTML = '<div class="view-bar"><div class="view-bar-left">'
      + '<button type="button" class="btn btn-ghost btn-sm" id="gridBack">' + IC.arrowLeft + ' Volver</button>'
      + '<h1 class="view-heading">' + esc(name) + '</h1></div>'
      + (platform ? '<div class="filter-pills">'
        + (platform.movieId ? '<button type="button" class="fpill' + (type === 'movie' ? ' active' : '') + '" data-plat-switch="movie">Películas</button>' : '')
        + (platform.seriesId ? '<button type="button" class="fpill' + (type === 'series' ? ' active' : '') + '" data-plat-switch="series">Series</button>' : '')
        + '</div>' : '')
      + '</div><div class="poster-grid" id="gridItems">'
      + Array.from({ length: 12 }, () => '<div class="skel-card"></div>').join('')
      + '</div><div class="load-more-wrap" id="gridMoreWrap" hidden><button type="button" class="btn btn-ghost" id="gridLoadMore">Cargar más</button></div>';

    $('gridBack').onclick = () => renderSection(state.section === 'lista' ? 'inicio' : state.section);
    gridView.querySelectorAll('[data-plat-switch]').forEach((btn) => {
      btn.onclick = () => {
        const nextType = btn.dataset.platSwitch;
        openExploreGrid({
          type: nextType,
          id: nextType === 'movie' ? platform.movieId : platform.seriesId,
          name: platform.name,
          platform,
        });
      };
    });
    $('gridLoadMore').onclick = () => appendGridPage();
    await appendGridPage();
  }

  async function appendGridPage() {
    const ctx = state.gridContext;
    if (!ctx) return;
    const moreBtn = $('gridLoadMore');
    if (moreBtn) { moreBtn.disabled = true; moreBtn.textContent = 'Cargando…'; }
    const batch = await loadCatalog(ctx.type, ctx.id, ctx.skip);
    if (state.gridContext !== ctx) return;
    const existingIds = new Set(ctx.items.map((x) => x.id));
    const fresh = batch.filter((x) => !existingIds.has(x.id));
    ctx.items.push(...fresh);
    ctx.skip += 20;
    const mount = $('gridItems');
    if (mount) {
      mount.innerHTML = ctx.items.length
        ? ctx.items.map(cardHtml).join('')
        : '<div class="empty-state" style="grid-column:1/-1"><h3>Sin resultados en esta colección</h3><p>Prueba otra plataforma o usa el buscador superior.</p></div>';
    }
    const wrap = $('gridMoreWrap');
    if (wrap) wrap.hidden = fresh.length < 15;
    if (moreBtn) { moreBtn.disabled = false; moreBtn.textContent = 'Cargar más'; }
  }

  // ── Búsqueda en vivo ──────────────────────────────────────────────────────
  async function runSearch(query, type) {
    const q = String(query || '').trim();
    state.searchQuery = q;
    state.searchType = type || state.searchType || 'all';
    searchClear.hidden = !q;

    if (q.length < 2) {
      if (!searchView.hidden) renderSection(state.section);
      return;
    }

    showOnlyView('search');
    const types = [
      ['all', 'Todo'],
      ['movie', 'Películas'],
      ['series', 'Series'],
      ['anime', 'Anime'],
    ];
    searchView.innerHTML = '<div class="view-bar"><div class="view-bar-left">'
      + '<button type="button" class="btn btn-ghost btn-sm" id="searchBack">' + IC.arrowLeft + ' Volver</button>'
      + '<h1 class="view-heading">Resultados para «' + esc(q) + '»</h1></div>'
      + '<div class="filter-pills">'
      + types.map(([k, lbl]) => '<button type="button" class="fpill' + (state.searchType === k ? ' active' : '') + '" data-stype="' + k + '">' + lbl + '</button>').join('')
      + '</div></div>'
      + '<div class="poster-grid" id="searchGrid">'
      + Array.from({ length: 10 }, () => '<div class="skel-card"></div>').join('')
      + '</div>';

    $('searchBack').onclick = () => {
      searchInput.value = '';
      searchClear.hidden = true;
      state.searchQuery = '';
      renderSection(state.section);
    };
    searchView.querySelectorAll('[data-stype]').forEach((btn) => {
      btn.onclick = () => runSearch(q, btn.dataset.stype);
    });

    const token = ++state.searchToken;
    try {
      const data = await fetchJson('/internal/watch/search?q=' + encodeURIComponent(q) + '&type=' + encodeURIComponent(state.searchType));
      if (token !== state.searchToken) return;
      const results = Array.isArray(data && data.results) ? data.results : [];
      const grid = $('searchGrid');
      if (!grid) return;
      grid.innerHTML = results.length
        ? results.map(cardHtml).join('')
        : '<div class="empty-state" style="grid-column:1/-1"><h3>No encontramos «' + esc(q) + '»</h3><p>Prueba con el título original en inglés o cambia el filtro entre Películas, Series y Anime.</p></div>';
    } catch (_) {
      const grid = $('searchGrid');
      if (grid) grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><h3>Error al buscar</h3><p>Inténtalo de nuevo en unos segundos.</p></div>';
    }
  }

  // ── Detalle de título + Reproductor Cinema ────────────────────────────────
  function updateUrlParams(params) {
    try {
      const u = new URL(window.location.href);
      ['type', 'id', 's', 'e'].forEach((k) => u.searchParams.delete(k));
      if (params && params.type && params.id) {
        u.searchParams.set('type', params.type);
        u.searchParams.set('id', params.id);
        if (params.season) u.searchParams.set('s', String(params.season));
        if (params.episode) u.searchParams.set('e', String(params.episode));
      }
      history.replaceState(null, '', u.pathname + u.search);
    } catch (_) { /* ignore */ }
  }

  function teardownPlayer() {
    if (state.player.hls) {
      try { state.player.hls.destroy(); } catch (_) { /* ignore */ }
      state.player.hls = null;
    }
    for (const u of state.player.blobUrls) {
      try { URL.revokeObjectURL(u); } catch (_) { /* ignore */ }
    }
    state.player.blobUrls = [];
    const v = $('watchVideo');
    if (v) {
      try { v.pause(); v.removeAttribute('src'); v.load(); } catch (_) { /* ignore */ }
    }
  }

  function closeDetail() {
    teardownPlayer();
    resetSkipState();
    state.detail = null;
    detailOverlay.hidden = true;
    document.body.style.overflow = '';
    updateUrlParams(null);
    if (state.section === 'inicio' && !browseView.hidden) {
      const cw = $('continueSection');
      const fresh = continueWatchingHtml();
      if (cw && fresh) cw.outerHTML = fresh;
      else if (!cw && fresh) railsMount.insertAdjacentHTML('afterbegin', fresh);
    }
  }

  async function openDetail(seed, opts = {}) {
    teardownPlayer();
    const type = seed.type === 'series' ? 'series' : 'movie';
    const id = String(seed.id || '');
    if (!id) return;

    state.detail = {
      type,
      id,
      meta: { ...seed, type, id },
      season: opts.season ? Number(opts.season) : null,
      episode: opts.episode ? Number(opts.episode) : null,
      seasonsMap: new Map(),
      playerOpen: Boolean(opts.autoplay),
    };

    detailOverlay.hidden = false;
    detailOverlay.scrollTop = 0;
    document.body.style.overflow = 'hidden';
    updateUrlParams({ type, id, season: state.detail.season, episode: state.detail.episode });
    renderDetailShell();

    if (opts.autoplay && type === 'movie') {
      startPlayback(type, id);
    } else if (opts.autoplay && type === 'series' && state.detail.season && state.detail.episode) {
      startPlayback('series', id + ':' + state.detail.season + ':' + state.detail.episode, {
        season: state.detail.season,
        episode: state.detail.episode,
      });
    }

    try {
      const full = await loadMeta(type, id);
      if (!state.detail || state.detail.id !== id) return;
      state.detail.meta = {
        ...state.detail.meta,
        ...full,
        poster: full.poster || state.detail.meta.poster,
        background: full.background || state.detail.meta.background,
        isAnime: state.detail.meta.isAnime || (Array.isArray(full.genre) && full.genre.some((g) => /anim/i.test(g))),
      };
      if (type === 'series' && Array.isArray(full.videos)) {
        const map = new Map();
        for (const ep of full.videos) {
          const s = Number(ep.season);
          const e = Number(ep.episode || ep.number);
          if (!Number.isFinite(s) || s <= 0 || !Number.isFinite(e) || e <= 0) continue;
          if (!map.has(s)) map.set(s, []);
          map.get(s).push({ ...ep, season: s, episode: e });
        }
        for (const list of map.values()) list.sort((a, b) => a.episode - b.episode);
        state.detail.seasonsMap = map;
        if (!state.detail.season && map.size) {
          const hist = getHistory().find((h) => h.id === id && h.type === 'series');
          state.detail.season = (hist && map.has(Number(hist.season))) ? Number(hist.season) : [...map.keys()].sort((a, b) => a - b)[0];
        }
      }
      renderDetailInfoAndEpisodes();
      if (opts.autoplay && type === 'series' && !state.detail.episode) {
        const hist = getHistory().find((h) => h.id === id && h.type === 'series');
        const firstSeason = state.detail.season || 1;
        const eps = state.detail.seasonsMap.get(firstSeason) || [];
        const targetS = (hist && hist.season) || firstSeason;
        const targetE = (hist && hist.episode) || (eps[0] ? eps[0].episode : 1);
        playSeriesEpisode(targetS, targetE);
      }
    } catch (_) { /* mantener datos semilla */ }
  }

  function renderDetailShell() {
    const d = state.detail;
    if (!d) return;
    detailShell.innerHTML = '<div class="detail-top-bar">'
      + '<button type="button" class="btn btn-ghost btn-sm" id="detailBack">' + IC.arrowLeft + ' Cerrar</button>'
      + '<div class="detail-crumb" id="detailCrumb">' + esc(d.meta.name || d.id) + '</div>'
      + '<button type="button" class="btn btn-ghost btn-sm btn-icon" id="detailCloseX" aria-label="Cerrar ventana">' + IC.close + '</button>'
      + '</div>'
      + '<div class="player-stage" id="playerStage"' + (d.playerOpen ? '' : ' hidden') + '>'
      + '<div class="video-box" id="videoBox">'
      + '<video id="watchVideo" controls playsinline preload="metadata" crossorigin="anonymous"></video>'
      + '<div class="player-status" id="playerStatus">'
      + '<div class="spinner" id="playerSpinner"></div>'
      + '<div class="player-status-title" id="playerStatusTitle">Buscando señales disponibles…</div>'
      + '<div class="player-status-sub" id="playerStatusSub">Consultando fuentes en español latino y subtitulado.</div>'
      + '</div>'
      + '<div class="skip-prompt" id="skipPrompt" hidden>'
      + '<button type="button" class="skip-prompt-btn" id="skipPromptBtn">'
      + IC.skip + ' <span id="skipPromptLabel">Omitir intro</span>'
      + '<span class="skip-prompt-src" id="skipPromptSrc"></span>'
      + '<span class="skip-prompt-kbd" aria-hidden="true">S</span>'
      + '</button></div>'
      + '<div class="next-ep-prompt" id="nextEpPrompt" hidden>'
      + '<span id="nextEpLabel">Siguiente episodio</span>'
      + '<button type="button" class="btn btn-primary btn-sm" id="nextEpGo">' + IC.skip + ' Reproducir</button>'
      + '</div></div>'
      + '<div class="player-controls-bar" id="playerControlsBar">'
      + '<div class="player-ctrl-group">'
      + '<button type="button" class="btn btn-ghost btn-sm" id="btnBack10">-10s</button>'
      + '<button type="button" class="btn btn-ghost btn-sm" id="btnFwd10">+10s</button>'
      + '<select class="player-select" id="selQuality" aria-label="Calidad de video" hidden></select>'
      + '<select class="player-select" id="selAudio" aria-label="Pista de audio" hidden></select>'
      + '<select class="player-select" id="selSubs" aria-label="Subtítulos" hidden></select>'
      + '<select class="player-select" id="selSpeed" aria-label="Velocidad">'
      + '<option value="0.75">0.75×</option><option value="1" selected>1× Normal</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option>'
      + '</select></div>'
      + '<div class="player-ctrl-group">'
      + '<button type="button" class="btn btn-ghost btn-sm btn-toggle' + (getAutoSkip() ? ' active' : '') + '" id="btnAutoSkip" aria-pressed="' + (getAutoSkip() ? 'true' : 'false') + '" title="Omitir automáticamente intros y resúmenes (TheIntroDB, SkipDB, Anime Skip)">' + IC.skip + ' Auto-omitir: ' + (getAutoSkip() ? 'Sí' : 'No') + '</button>'
      + '<button type="button" class="btn btn-primary btn-sm" id="btnNextEp" hidden>' + IC.skip + ' Siguiente episodio</button>'
      + '<button type="button" class="btn btn-ghost btn-sm" id="btnPip">PiP</button>'
      + '<button type="button" class="btn btn-ghost btn-sm" id="btnFs">' + IC.max + ' Pantalla completa</button>'
      + '</div></div>'
      + '<div class="sources-panel" id="sourcesPanel">'
      + '<div class="skip-bar" id="skipBar" hidden></div>'
      + '<div class="sources-head"><span class="sources-label" id="sourcesLabel">Señales disponibles</span>'
      + '<button type="button" class="btn btn-ghost btn-sm" id="btnRetryStreams">' + IC.refresh + ' Recargar señales</button></div>'
      + '<div class="sources-list" id="sourcesList"></div>'
      + '<div class="fallback-bar" id="fallbackBar" hidden></div>'
      + '</div></div>'
      + '<div id="detailInfoMount"></div>'
      + '<div id="detailEpisodesMount"></div>';

    $('detailBack').onclick = closeDetail;
    $('detailCloseX').onclick = closeDetail;
    bindPlayerControls();
    renderDetailInfoAndEpisodes();
  }

  function renderDetailInfoAndEpisodes() {
    const d = state.detail;
    if (!d) return;
    const m = d.meta;
    const crumb = $('detailCrumb');
    if (crumb) {
      crumb.textContent = d.type === 'series' && d.season && d.episode
        ? (m.name || d.id) + ' · T' + d.season + 'E' + d.episode
        : (m.name || d.id);
    }

    const poster = posterUrl(m.poster, 'w500');
    const bg = posterUrl(m.background || m.poster, 'w1280');
    const saved = isInMyList(d.type, d.id);
    const genres = Array.isArray(m.genre) ? m.genre : (Array.isArray(m.genres) ? m.genres : []);
    const stremioLink = 'stremio:///detail/' + encodeURIComponent(d.type) + '/' + encodeURIComponent(d.id);

    const infoMount = $('detailInfoMount');
    if (infoMount) {
      infoMount.innerHTML = '<div class="detail-hero">'
        + '<div class="detail-backdrop">' + (bg ? '<img src="' + esc(bg) + '" alt="" referrerpolicy="no-referrer" />' : '') + '</div>'
        + '<div class="detail-poster">' + (poster ? '<img src="' + esc(poster) + '" alt="' + esc(m.name) + '" referrerpolicy="no-referrer" />' : '') + '</div>'
        + '<div class="detail-info">'
        + '<h1 class="detail-title" id="detailTitle">' + esc(m.name || d.id) + '</h1>'
        + '<div class="detail-tags">'
        + '<span class="pill pill-brand">' + esc(typeBadgeLabel(m).text) + '</span>'
        + (m.releaseInfo ? '<span class="pill">' + esc(String(m.releaseInfo).slice(0, 4)) + '</span>' : '')
        + (m.runtime ? '<span class="pill">' + IC.clock + ' ' + esc(m.runtime) + '</span>' : '')
        + (m.imdbRating ? '<span class="pill pill-star">' + IC.star + ' ' + esc(m.imdbRating) + '</span>' : '')
        + genres.slice(0, 4).map((g) => '<span class="pill">' + esc(g) + '</span>').join('')
        + '</div>'
        + (m.description ? '<p class="detail-desc">' + esc(m.description) + '</p>' : '')
        + '<div class="detail-credits">'
        + (Array.isArray(m.director) && m.director.length ? '<div><strong>' + (d.type === 'series' ? 'Creación:' : 'Dirección:') + '</strong> ' + esc(m.director.join(', ')) + '</div>' : '')
        + (Array.isArray(m.cast) && m.cast.length ? '<div><strong>Reparto:</strong> ' + esc(m.cast.slice(0, 8).join(', ')) + '</div>' : '')
        + '</div>'
        + '<div class="detail-actions">'
        + '<button type="button" class="btn btn-primary btn-lg" id="detailPlayBtn">' + IC.playLg + ' ' + (d.type === 'series' ? 'Ver episodio' : 'Reproducir película') + '</button>'
        + '<button type="button" class="btn btn-ghost" id="detailListBtn">' + (saved ? IC.check + ' En mi lista' : IC.plus + ' Mi lista') + '</button>'
        + '<button type="button" class="btn btn-ghost" id="detailShareBtn">' + IC.share + ' Compartir</button>'
        + '<a class="btn btn-ghost" href="' + esc(stremioLink) + '">' + IC.ext + ' Stremio</a>'
        + '</div></div></div>';

      $('detailPlayBtn').onclick = () => {
        if (d.type === 'movie') {
          startPlayback('movie', d.id);
        } else {
          const hist = getHistory().find((h) => h.id === d.id && h.type === 'series');
          const s = d.season || (hist && hist.season) || 1;
          const eps = d.seasonsMap.get(s) || [];
          const e = d.episode || (hist && hist.episode) || (eps[0] ? eps[0].episode : 1);
          playSeriesEpisode(s, e);
        }
      };
      $('detailListBtn').onclick = () => {
        toggleMyList(d.meta);
        renderDetailInfoAndEpisodes();
      };
      $('detailShareBtn').onclick = () => copyText(window.location.href, 'Enlace copiado');
    }

    const epMount = $('detailEpisodesMount');
    if (!epMount) return;
    if (d.type !== 'series') {
      epMount.innerHTML = '';
      return;
    }

    const seasonNums = [...d.seasonsMap.keys()].sort((a, b) => a - b);
    const activeSeason = d.season || seasonNums[0] || 1;
    const episodes = d.seasonsMap.get(activeSeason) || [];
    const fallbackPoster = posterUrl(m.background || m.poster, 'w342');

    epMount.innerHTML = '<div class="episodes-box">'
      + '<div class="seasons-bar">'
      + '<div class="seasons-tabs">'
      + (seasonNums.length
        ? seasonNums.map((s) => '<button type="button" class="fpill' + (s === activeSeason ? ' active' : '') + '" data-season-tab="' + s + '">Temporada ' + s + '</button>').join('')
        : '<span class="sources-label">Selector de episodio</span>')
      + '</div>'
      + '<form class="manual-ep" id="manualEpForm">'
      + '<span>Ir a T</span><input type="number" id="manSeason" min="1" max="99" value="' + esc(activeSeason) + '" aria-label="Temporada" />'
      + '<span>E</span><input type="number" id="manEp" min="1" max="2000" value="' + esc(d.episode || 1) + '" aria-label="Episodio" />'
      + '<button type="submit" class="btn btn-primary btn-sm">' + IC.play + ' Ver</button>'
      + '</form></div>'
      + (episodes.length
        ? '<div class="episodes-grid">' + episodes.map((ep) => {
          const isPlaying = d.season === ep.season && d.episode === ep.episode && d.playerOpen;
          const thumb = safeUrl(ep.thumbnail) || fallbackPoster;
          const epTitle = ep.name || ep.title || ('Episodio ' + ep.episode);
          const airDate = ep.released ? String(ep.released).slice(0, 10) : '';
          return '<button type="button" class="ep-card' + (isPlaying ? ' playing' : '') + '" data-play-s="' + ep.season + '" data-play-e="' + ep.episode + '">'
            + '<div class="ep-thumb">'
            + (thumb ? '<img src="' + esc(thumb) + '" alt="" loading="lazy" referrerpolicy="no-referrer" />' : '')
            + '<span class="ep-num">T' + ep.season + 'E' + ep.episode + '</span></div>'
            + '<div class="ep-body"><div class="ep-title">' + esc(epTitle) + '</div>'
            + (airDate ? '<div class="ep-date">' + esc(airDate) + '</div>' : '')
            + (ep.overview ? '<div class="ep-ov">' + esc(ep.overview) + '</div>' : '')
            + '</div></button>';
        }).join('') + '</div>'
        : '<div class="empty-state"><h3>Usa el selector de temporada y episodio</h3><p>Elige cualquier temporada y episodio arriba para buscar streams disponibles en español latino y subtitulado.</p></div>')
      + '</div>';

    epMount.querySelectorAll('[data-season-tab]').forEach((btn) => {
      btn.onclick = () => {
        d.season = Number(btn.dataset.seasonTab);
        renderDetailInfoAndEpisodes();
      };
    });
    epMount.querySelectorAll('[data-play-s]').forEach((btn) => {
      btn.onclick = () => playSeriesEpisode(Number(btn.dataset.playS), Number(btn.dataset.playE));
    });
    const form = $('manualEpForm');
    if (form) {
      form.onsubmit = (ev) => {
        ev.preventDefault();
        const s = Math.max(1, Number($('manSeason').value) || 1);
        const e = Math.max(1, Number($('manEp').value) || 1);
        playSeriesEpisode(s, e);
      };
    }
  }

  function findNextEpisode() {
    const d = state.detail;
    if (!d || d.type !== 'series' || !d.season || !d.episode) return null;
    const eps = d.seasonsMap.get(d.season) || [];
    const idx = eps.findIndex((x) => x.episode === d.episode);
    if (idx >= 0 && eps[idx + 1]) return eps[idx + 1];
    const seasons = [...d.seasonsMap.keys()].sort((a, b) => a - b);
    const sIdx = seasons.indexOf(d.season);
    if (sIdx >= 0 && seasons[sIdx + 1]) {
      const nextList = d.seasonsMap.get(seasons[sIdx + 1]) || [];
      if (nextList[0]) return nextList[0];
    }
    return { season: d.season, episode: d.episode + 1, name: 'Episodio ' + (d.episode + 1) };
  }

  function playSeriesEpisode(season, episode) {
    const d = state.detail;
    if (!d) return;
    d.season = season;
    d.episode = episode;
    const epObj = (d.seasonsMap.get(season) || []).find((x) => x.episode === episode);
    updateUrlParams({ type: 'series', id: d.id, season, episode });
    renderDetailInfoAndEpisodes();
    startPlayback('series', d.id + ':' + season + ':' + episode, {
      season,
      episode,
      episodeTitle: epObj ? (epObj.name || epObj.title || '') : '',
    });
  }

  // ── Motor de reproducción (HLS + MP4 + Subtítulos + Auto-failover) ────────
  function parseStreamMeta(stream, index) {
    const text = String(stream.title || '');
    const lines = text.split(/\\r?\\n/).map((l) => l.trim()).filter(Boolean);
    const headline = lines[0] || ('Opción ' + (index + 1));
    const badges = lines[1] || (/\\.mp4(?:$|[?#])/i.test(stream.url || '') ? 'MP4' : 'HLS');
    return { headline, badges };
  }

  function srtToVtt(srtText) {
    return 'WEBVTT\\n\\n' + String(srtText || '')
      .replace(/\\r\\n/g, '\\n')
      .replace(/\\r/g, '\\n')
      .replace(/(\\d{2}:\\d{2}:\\d{2}),(\\d{3})/g, '$1.$2');
  }

  function setPlayerStatus({ show, spinning = false, title = '', sub = '' }) {
    const box = $('playerStatus');
    if (!box) return;
    box.hidden = !show;
    const sp = $('playerSpinner');
    if (sp) sp.hidden = !spinning;
    const t = $('playerStatusTitle');
    if (t) t.textContent = title;
    const s = $('playerStatusSub');
    if (s) s.textContent = sub;
  }

  const SKIP_KIND_SHORT = {
    intro: 'Intro',
    recap: 'Resumen',
    credits: 'Créditos',
    preview: 'Avance',
  };
  const SKIP_SOURCE_NAMES = {
    theintrodb: 'TheIntroDB',
    skipdb: 'SkipDB',
    animeskip: 'Anime Skip',
    aniskip: 'AniSkip',
  };

  function resetSkipState() {
    state.player.skipSegments = [];
    state.player.skipProviders = [];
    state.player.skipFetchToken += 1;
    state.player.skipDurationRequested = 0;
    state.player.activeSkipSeg = null;
    state.player.autoSkippedKeys = new Set();
    const prompt = $('skipPrompt');
    if (prompt) prompt.hidden = true;
    const bar = $('skipBar');
    if (bar) { bar.hidden = true; bar.innerHTML = ''; }
  }

  function renderSkipBar() {
    const bar = $('skipBar');
    if (!bar) return;
    const segs = state.player.skipSegments;
    if (!segs || !segs.length) {
      bar.hidden = true;
      bar.innerHTML = '';
      return;
    }
    const providers = [...new Set(segs.map((s) => SKIP_SOURCE_NAMES[s.source] || s.sourceLabel || s.source))];
    bar.hidden = false;
    bar.innerHTML = '<div class="skip-chips">'
      + segs.map((seg, idx) => {
        const range = seg.endSec != null
          ? (fmtClock(seg.startSec) + '–' + fmtClock(seg.endSec))
          : (fmtClock(seg.startSec) + '–fin');
        return '<button type="button" class="skip-chip" data-skip-idx="' + idx + '" title="' + esc(seg.label) + ' (' + esc(seg.sourceLabel || seg.source) + ')">'
          + '<span>' + esc(SKIP_KIND_SHORT[seg.kind] || seg.kind) + '</span>'
          + '<span class="skip-chip-time">' + esc(range) + '</span>'
          + '</button>';
      }).join('')
      + '</div>'
      + '<span class="skip-providers-note">Saltos: ' + esc(providers.join(' · ')) + '</span>';

    bar.querySelectorAll('[data-skip-idx]').forEach((btn) => {
      btn.onclick = () => {
        const seg = state.player.skipSegments[Number(btn.dataset.skipIdx)];
        if (seg) executeSkipSegment(seg, false);
      };
    });
  }

  async function fetchSkipSegments(durationSec) {
    const d = state.detail;
    if (!d || !state.player.episodeKey) return;
    const dur = Number.isFinite(durationSec) && durationSec >= 30 ? Math.round(durationSec) : 0;
    if (dur > 0 && state.player.skipDurationRequested > 0 && Math.abs(dur - state.player.skipDurationRequested) < 15) {
      return;
    }
    const token = ++state.player.skipFetchToken;
    const keySnapshot = state.player.episodeKey;
    state.player.skipDurationRequested = dur;

    const params = new URLSearchParams();
    params.set('type', d.type === 'series' ? 'series' : 'movie');
    params.set('id', d.id);
    if (d.meta && d.meta.imdb_id) params.set('imdb', d.meta.imdb_id);
    if (d.type === 'series') {
      const s = (state.player.epInfo && state.player.epInfo.season) || d.season;
      const e = (state.player.epInfo && state.player.epInfo.episode) || d.episode;
      if (s) params.set('season', String(s));
      if (e) params.set('episode', String(e));
    }
    if (dur > 0) params.set('duration', String(dur));
    if (d.meta && d.meta.isAnime) params.set('anime', '1');

    try {
      const data = await fetchJson('/internal/watch/skip?' + params.toString());
      if (!state.detail || state.player.episodeKey !== keySnapshot || token !== state.player.skipFetchToken) return;
      if (data && Array.isArray(data.segments) && data.segments.length) {
        state.player.skipSegments = data.segments;
        state.player.skipProviders = Array.isArray(data.providers) ? data.providers : [];
        renderSkipBar();
        const video = $('watchVideo');
        if (video) updateSkipOverlay(video);
      }
    } catch (_) { /* silencioso: el vídeo sigue igual */ }
  }

  function executeSkipSegment(seg, isAuto) {
    const video = $('watchVideo');
    const d = state.detail;
    if (!video || !seg) return;

    const segKey = seg.kind + ':' + seg.startSec + ':' + (seg.endSec == null ? 'end' : seg.endSec);
    state.player.autoSkippedKeys.add(segKey);

    const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const isNearEndCredits = seg.kind === 'credits' && d && d.type === 'series'
      && (seg.endSec == null || (dur > 0 && seg.endSec >= dur - 8));

    if (isNearEndCredits && !isAuto) {
      const next = findNextEpisode();
      if (next) {
        playSeriesEpisode(next.season, next.episode);
        return;
      }
    }

    const target = seg.endSec != null
      ? Math.min(dur > 0 ? Math.max(0, dur - 0.5) : seg.endSec, seg.endSec)
      : (dur > 0 ? Math.max(0, dur - 1) : video.currentTime);
    if (Number.isFinite(target) && target > video.currentTime) {
      try { video.currentTime = target; } catch (_) { /* ignore */ }
    }
    state.player.activeSkipSeg = null;
    const prompt = $('skipPrompt');
    if (prompt) prompt.hidden = true;

    const srcName = SKIP_SOURCE_NAMES[seg.source] || seg.sourceLabel || seg.source;
    const shortName = SKIP_KIND_SHORT[seg.kind] || 'Segmento';
    showToast((isAuto ? 'Auto-omitido: ' : 'Omitido: ') + shortName + ' · ' + srcName);
  }

  function updateSkipOverlay(video) {
    const prompt = $('skipPrompt');
    if (!prompt || !video) return;
    const segs = state.player.skipSegments;
    if (!segs || !segs.length) {
      state.player.activeSkipSeg = null;
      prompt.hidden = true;
      return;
    }

    const t = Number(video.currentTime) || 0;
    const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const active = segs.find((seg) => {
      const end = seg.endSec != null ? seg.endSec : (dur > 0 ? dur : Infinity);
      return t >= seg.startSec && t < (end - 0.5);
    }) || null;

    if (!active) {
      state.player.activeSkipSeg = null;
      prompt.hidden = true;
      return;
    }

    const segKey = active.kind + ':' + active.startSec + ':' + (active.endSec == null ? 'end' : active.endSec);
    if (getAutoSkip() && (active.kind === 'intro' || active.kind === 'recap') && !state.player.autoSkippedKeys.has(segKey) && !video.paused) {
      executeSkipSegment(active, true);
      return;
    }

    state.player.activeSkipSeg = active;
    const lbl = $('skipPromptLabel');
    const src = $('skipPromptSrc');
    if (lbl) lbl.textContent = active.label || 'Omitir';
    if (src) src.textContent = SKIP_SOURCE_NAMES[active.source] || active.sourceLabel || active.source;
    prompt.hidden = false;
  }

  async function startPlayback(type, streamId, epInfo = {}) {
    const d = state.detail;
    if (!d) return;
    d.playerOpen = true;
    const stage = $('playerStage');
    if (stage) {
      stage.hidden = false;
      detailOverlay.scrollTo({ top: 0, behavior: 'smooth' });
    }
    teardownPlayer();
    resetSkipState();
    state.player.streams = [];
    state.player.streamIndex = -1;
    state.player.failedIndices = new Set();
    state.player.episodeKey = streamId;
    state.player.epInfo = epInfo;
    state.player.autoAdvanceShown = false;

    const nextPrompt = $('nextEpPrompt');
    if (nextPrompt) nextPrompt.hidden = true;
    const nextBtn = $('btnNextEp');
    if (nextBtn) nextBtn.hidden = type !== 'series';

    // Consulta en paralelo TheIntroDB, SkipDB y Anime Skip para este título/episodio.
    fetchSkipSegments(0);

    setPlayerStatus({
      show: true,
      spinning: true,
      title: 'Buscando señales disponibles…',
      sub: 'Consultando los proveedores de RamdonLatam en español latino y subtitulado.',
    });
    renderSourcesList();

    const currentKey = streamId;
    try {
      const streams = await loadStreams(type, streamId);
      if (!state.detail || state.player.episodeKey !== currentKey) return;
      state.player.streams = streams;
      if (!streams.length) {
        setPlayerStatus({
          show: true,
          spinning: false,
          title: 'No se encontraron señales para este título',
          sub: 'Prueba recargar señales, comprobar otro episodio o abrirlo en Stremio.',
        });
        renderSourcesList();
        renderFallbackBar(null);
        return;
      }
      renderSourcesList();
      await playStreamAt(0);
    } catch (_) {
      if (!state.detail || state.player.episodeKey !== currentKey) return;
      setPlayerStatus({
        show: true,
        spinning: false,
        title: 'Error al consultar las señales',
        sub: 'Revisa tu conexión e inténtalo de nuevo.',
      });
      renderFallbackBar(null);
    }
  }

  function renderSourcesList() {
    const listEl = $('sourcesList');
    const lbl = $('sourcesLabel');
    if (!listEl) return;
    const streams = state.player.streams;
    if (lbl) lbl.textContent = streams.length ? ('Señales disponibles (' + streams.length + ')') : 'Señales disponibles';
    listEl.innerHTML = streams.map((st, i) => {
      const meta = parseStreamMeta(st, i);
      const active = i === state.player.streamIndex;
      const failed = state.player.failedIndices.has(i);
      return '<button type="button" class="source-chip' + (active ? ' active' : '') + (failed ? ' failed' : '') + '" data-stream-idx="' + i + '">'
        + '<span class="source-dot"></span>'
        + '<span>' + esc(meta.headline) + '</span>'
        + '<span class="source-q">' + esc(meta.badges) + '</span>'
        + '</button>';
    }).join('');

    listEl.querySelectorAll('[data-stream-idx]').forEach((btn) => {
      btn.onclick = () => playStreamAt(Number(btn.dataset.streamIdx));
    });
  }

  function renderFallbackBar(stream) {
    const bar = $('fallbackBar');
    const d = state.detail;
    if (!bar || !d) return;
    const stremioUrl = 'stremio:///detail/' + encodeURIComponent(d.type) + '/' + encodeURIComponent(d.id);
    const streamUrl = stream && safeUrl(stream.url) ? stream.url : '';
    const vlcUrl = streamUrl ? ('vlc://' + streamUrl) : '';
    bar.hidden = false;
    bar.innerHTML = '<span>¿No reproduce en el navegador? Algunas señales requieren reproductor externo.</span>'
      + '<div class="fallback-actions">'
      + (streamUrl ? '<button type="button" class="btn btn-ghost btn-sm" id="fbCopy">' + IC.copy + ' Copiar enlace</button>' : '')
      + (vlcUrl ? '<a class="btn btn-ghost btn-sm" href="' + esc(vlcUrl) + '">' + IC.play + ' VLC</a>' : '')
      + (streamUrl ? '<a class="btn btn-ghost btn-sm" href="' + esc(streamUrl) + '" target="_blank" rel="noopener noreferrer">' + IC.ext + ' Enlace directo</a>' : '')
      + '<a class="btn btn-ghost btn-sm" href="' + esc(stremioUrl) + '">' + IC.ext + ' Stremio</a>'
      + '</div>';
    const copyBtn = $('fbCopy');
    if (copyBtn) copyBtn.onclick = () => copyText(streamUrl, 'URL del stream copiada');
  }

  async function attachExternalSubtitles(video, subtitles) {
    video.querySelectorAll('track[data-rl-sub]').forEach((t) => t.remove());
    const selSubs = $('selSubs');
    if (!Array.isArray(subtitles) || !subtitles.length) return;
    const loaded = [];
    for (let i = 0; i < Math.min(subtitles.length, 6); i++) {
      const sub = subtitles[i];
      if (!sub || !safeUrl(sub.url)) continue;
      let trackSrc = sub.url;
      try {
        const res = await fetch(sub.url, { referrerPolicy: 'no-referrer' });
        if (res.ok) {
          const text = await res.text();
          const vtt = /^\\s*WEBVTT/i.test(text) ? text : srtToVtt(text);
          const blobUrl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt;charset=utf-8' }));
          state.player.blobUrls.push(blobUrl);
          trackSrc = blobUrl;
        }
      } catch (_) { /* usar URL directa si el navegador permite track */ }
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = sub.lang || ('Subtítulo ' + (i + 1));
      track.srclang = String(sub.lang || 'es').slice(0, 5);
      track.src = trackSrc;
      track.dataset.rlSub = '1';
      if (i === 0) track.default = true;
      video.appendChild(track);
      loaded.push({ idx: i, label: track.label });
    }
    if (selSubs && loaded.length) {
      selSubs.hidden = false;
      selSubs.innerHTML = '<option value="-1">Subtítulos: No</option>'
        + loaded.map((s) => '<option value="ext:' + s.idx + '"' + (s.idx === 0 ? ' selected' : '') + '>Sub: ' + esc(s.label) + '</option>').join('');
    }
  }

  async function playStreamAt(index) {
    const streams = state.player.streams;
    const stream = streams[index];
    if (!stream || !stream.url) return;
    const video = $('watchVideo');
    if (!video) return;

    teardownPlayer();
    state.player.streamIndex = index;
    renderSourcesList();
    renderFallbackBar(stream);

    const selQ = $('selQuality');
    const selA = $('selAudio');
    const selS = $('selSubs');
    if (selQ) { selQ.hidden = true; selQ.innerHTML = ''; }
    if (selA) { selA.hidden = true; selA.innerHTML = ''; }
    if (selS) { selS.hidden = true; selS.innerHTML = ''; }

    const meta = parseStreamMeta(stream, index);
    setPlayerStatus({
      show: true,
      spinning: true,
      title: 'Conectando señal ' + (index + 1) + ' de ' + streams.length + '…',
      sub: meta.headline + ' · ' + meta.badges,
    });

    const d = state.detail;
    const saved = d ? findProgress(d.type, d.id, d.season, d.episode) : null;
    const resumeAt = saved && saved.time > 10 && (!saved.duration || saved.time < saved.duration - 30) ? saved.time : 0;

    let settled = false;
    const failAndAdvance = (reason) => {
      if (settled || state.player.streamIndex !== index) return;
      settled = true;
      state.player.failedIndices.add(index);
      renderSourcesList();
      const nextIdx = streams.findIndex((_, i) => i > index && !state.player.failedIndices.has(i));
      if (nextIdx >= 0) {
        showToast('Señal ' + (index + 1) + ' no disponible, probando la siguiente…');
        playStreamAt(nextIdx);
      } else {
        setPlayerStatus({
          show: true,
          spinning: false,
          title: 'El navegador bloqueó la reproducción directa',
          sub: reason || 'Estas señales exigen cabeceras que el navegador no permite enviar. Usa «Copiar enlace», «VLC» o «Stremio» abajo.',
        });
      }
    };

    const loadTimer = setTimeout(() => {
      if (!settled && video.readyState < 2) {
        failAndAdvance('Tiempo de espera agotado al conectar con el servidor de vídeo.');
      }
    }, 14000);

    const onReady = () => {
      if (settled) return;
      settled = true;
      clearTimeout(loadTimer);
      setPlayerStatus({ show: false });
      if (Number.isFinite(video.duration) && video.duration >= 30) {
        fetchSkipSegments(video.duration);
      }
      if (resumeAt > 0) {
        try { video.currentTime = resumeAt; } catch (_) { /* ignore */ }
      }
      video.play().catch(() => { /* autoplay bloqueado: el usuario pulsa play */ });
    };

    video.onloadedmetadata = onReady;
    video.oncanplay = onReady;
    video.onerror = () => {
      clearTimeout(loadTimer);
      failAndAdvance('Error al cargar el vídeo desde el servidor externo.');
    };

    attachExternalSubtitles(video, stream.subtitles).catch(() => {});

    const url = stream.url;
    const isMp4 = /\\.(?:mp4|webm|m4v)(?:$|[?#])/i.test(url);
    const nativeHls = !isMp4 && Boolean(video.canPlayType('application/vnd.apple.mpegurl'));

    if (isMp4 || nativeHls) {
      video.src = url;
      video.load();
      return;
    }

    const Hls = await ensureHls();
    if (state.player.streamIndex !== index) { clearTimeout(loadTimer); return; }

    if (Hls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 30,
        xhrSetup(xhr) {
          xhr.withCredentials = false;
        },
      });
      state.player.hls = hls;
      hls.loadSource(url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        if (selQ && data && Array.isArray(data.levels) && data.levels.length > 1) {
          selQ.hidden = false;
          selQ.innerHTML = '<option value="-1">Calidad: Auto</option>'
            + data.levels.map((lv, li) => '<option value="' + li + '">' + (lv.height ? (lv.height + 'p') : ('Nivel ' + (li + 1))) + '</option>').join('');
        }
        if (selA && hls.audioTracks && hls.audioTracks.length > 1) {
          selA.hidden = false;
          selA.innerHTML = hls.audioTracks.map((tr, ti) => '<option value="' + ti + '">' + esc(tr.name || tr.lang || ('Audio ' + (ti + 1))) + '</option>').join('');
        }
        if (selS && hls.subtitleTracks && hls.subtitleTracks.length) {
          selS.hidden = false;
          selS.innerHTML = '<option value="-1">Subtítulos: No</option>'
            + hls.subtitleTracks.map((tr, ti) => '<option value="hls:' + ti + '">Sub: ' + esc(tr.name || tr.lang || ('Pista ' + (ti + 1))) + '</option>').join('');
        }
        onReady();
      });

      hls.on(Hls.Events.ERROR, (_, errData) => {
        if (errData && errData.fatal) {
          clearTimeout(loadTimer);
          try { hls.destroy(); } catch (_) { /* ignore */ }
          state.player.hls = null;
          failAndAdvance('El CDN rechazó la conexión directa desde el navegador (CORS o firma vencida).');
        }
      });
    } else {
      // Último intento directo
      video.src = url;
      video.load();
    }
  }

  function bindPlayerControls() {
    const video = $('watchVideo');
    if (!video) return;

    $('btnBack10').onclick = () => { video.currentTime = Math.max(0, (video.currentTime || 0) - 10); };
    $('btnFwd10').onclick = () => { video.currentTime = Math.min(video.duration || Infinity, (video.currentTime || 0) + 10); };
    $('selSpeed').onchange = (ev) => { video.playbackRate = Number(ev.target.value) || 1; };
    $('selQuality').onchange = (ev) => {
      if (state.player.hls) state.player.hls.currentLevel = Number(ev.target.value);
    };
    $('selAudio').onchange = (ev) => {
      if (state.player.hls) state.player.hls.audioTrack = Number(ev.target.value);
    };
    $('selSubs').onchange = (ev) => {
      const val = String(ev.target.value);
      for (let i = 0; i < video.textTracks.length; i++) video.textTracks[i].mode = 'disabled';
      if (state.player.hls) state.player.hls.subtitleTrack = -1;
      if (val.startsWith('hls:') && state.player.hls) {
        state.player.hls.subtitleTrack = Number(val.slice(4));
      } else if (val.startsWith('ext:')) {
        const idx = Number(val.slice(4));
        if (video.textTracks[idx]) video.textTracks[idx].mode = 'showing';
      }
    };
    $('btnPip').onclick = async () => {
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else if (video.requestPictureInPicture) await video.requestPictureInPicture();
      } catch (_) { showToast('Picture-in-Picture no disponible'); }
    };
    $('btnFs').onclick = () => {
      const box = $('videoBox');
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else if (box && box.requestFullscreen) box.requestFullscreen().catch(() => {});
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    };
    $('btnNextEp').onclick = () => {
      const next = findNextEpisode();
      if (next) playSeriesEpisode(next.season, next.episode);
    };
    $('nextEpGo').onclick = () => {
      const next = findNextEpisode();
      if (next) playSeriesEpisode(next.season, next.episode);
    };
    $('btnRetryStreams').onclick = () => {
      if (state.detail && state.player.episodeKey) {
        startPlayback(state.detail.type, state.player.episodeKey, state.player.epInfo || {});
      }
    };
    const skipBtn = $('skipPromptBtn');
    if (skipBtn) {
      skipBtn.onclick = () => {
        if (state.player.activeSkipSeg) executeSkipSegment(state.player.activeSkipSeg, false);
      };
    }
    const autoSkipBtn = $('btnAutoSkip');
    if (autoSkipBtn) {
      autoSkipBtn.onclick = () => {
        const nextVal = !getAutoSkip();
        setAutoSkip(nextVal);
        autoSkipBtn.classList.toggle('active', nextVal);
        autoSkipBtn.setAttribute('aria-pressed', nextVal ? 'true' : 'false');
        autoSkipBtn.innerHTML = IC.skip + ' Auto-omitir: ' + (nextVal ? 'Sí' : 'No');
        showToast(nextVal ? 'Auto-omitir intros y resúmenes activado' : 'Auto-omitir desactivado');
      };
    }

    video.ontimeupdate = () => {
      const d = state.detail;
      if (!d) return;
      updateSkipOverlay(video);
      if (!video.duration || video.currentTime < 3) return;
      const now = Date.now();
      if (now - state.player.lastSaveAt > 5000) {
        state.player.lastSaveAt = now;
        saveProgress({
          id: d.id,
          type: d.type,
          name: d.meta.name || d.id,
          poster: d.meta.poster || '',
          background: d.meta.background || '',
          season: d.season || null,
          episode: d.episode || null,
          episodeTitle: (state.player.epInfo && state.player.epInfo.episodeTitle) || '',
          time: Math.floor(video.currentTime),
          duration: Math.floor(video.duration),
        });
      }
      if (d.type === 'series' && !state.player.autoAdvanceShown && video.duration > 60 && (video.duration - video.currentTime) <= 20) {
        const next = findNextEpisode();
        const prompt = $('nextEpPrompt');
        const lbl = $('nextEpLabel');
        if (next && prompt && lbl) {
          state.player.autoAdvanceShown = true;
          lbl.textContent = 'Siguiente: T' + next.season + 'E' + next.episode;
          prompt.hidden = false;
        }
      }
    };
  }

  function copyText(text, okMsg) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => showToast(okMsg || 'Copiado')).catch(() => showToast('No se pudo copiar'));
    } else {
      showToast('Copia manual requerida');
    }
  }

  // ── Delegación de eventos y atajos de teclado ─────────────────────────────
  document.addEventListener('error', (ev) => {
    const img = ev.target;
    if (!img || img.tagName !== 'IMG') return;
    img.hidden = true;
    const fb = img.parentElement && img.parentElement.querySelector('.card-fallback');
    if (fb) fb.hidden = false;
  }, true);

  document.addEventListener('click', (ev) => {
    const rm = ev.target.closest('[data-cw-remove-id]');
    if (rm) {
      ev.stopPropagation();
      removeHistory(rm.dataset.cwRemoveType, rm.dataset.cwRemoveId);
      const card = rm.closest('.cw-card');
      if (card) card.remove();
      if (!getHistory().length) {
        const sec = $('continueSection');
        if (sec) sec.remove();
      }
      return;
    }

    const openBtn = ev.target.closest('[data-open-id]');
    if (openBtn) {
      let seed = { id: openBtn.dataset.openId, type: openBtn.dataset.openType || 'movie', name: openBtn.dataset.openId };
      if (openBtn.dataset.itemJson) {
        try { seed = JSON.parse(openBtn.dataset.itemJson); } catch (_) { /* fallback */ }
      }
      openDetail(seed, {
        autoplay: openBtn.dataset.autoplay === '1',
        season: openBtn.dataset.openSeason ? Number(openBtn.dataset.openSeason) : null,
        episode: openBtn.dataset.openEp ? Number(openBtn.dataset.openEp) : null,
      });
      return;
    }

    const exploreBtn = ev.target.closest('[data-explore-id]');
    if (exploreBtn) {
      openExploreGrid({
        type: exploreBtn.dataset.exploreType,
        id: exploreBtn.dataset.exploreId,
        name: exploreBtn.dataset.exploreName,
      });
      return;
    }

    const scrollBtn = ev.target.closest('[data-scroll-target]');
    if (scrollBtn) {
      const track = $(scrollBtn.dataset.scrollTarget);
      if (track) {
        const dir = Number(scrollBtn.dataset.scrollDir) || 1;
        track.scrollBy({ left: dir * Math.max(320, track.clientWidth * 0.8), behavior: 'smooth' });
      }
    }
  });

  detailOverlay.addEventListener('click', (ev) => {
    if (ev.target === detailOverlay) closeDetail();
  });

  document.querySelectorAll('.w-tab').forEach((btn) => {
    btn.onclick = () => {
      searchInput.value = '';
      searchClear.hidden = true;
      renderSection(btn.dataset.section);
    };
  });

  $('brandHome').onclick = (ev) => {
    ev.preventDefault();
    searchInput.value = '';
    searchClear.hidden = true;
    renderSection('inicio');
  };

  $('searchForm').onsubmit = (ev) => {
    ev.preventDefault();
    runSearch(searchInput.value, state.searchType);
  };
  searchInput.addEventListener('input', () => {
    clearTimeout(state.searchTimer);
    const val = searchInput.value.trim();
    searchClear.hidden = !val;
    if (!val) {
      if (!searchView.hidden) renderSection(state.section);
      return;
    }
    state.searchTimer = setTimeout(() => runSearch(val, state.searchType), 320);
  });
  searchClear.onclick = () => {
    searchInput.value = '';
    searchClear.hidden = true;
    searchInput.focus();
    if (!searchView.hidden) renderSection(state.section);
  };

  document.addEventListener('keydown', (ev) => {
    const tag = (ev.target && ev.target.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (ev.key === '/' && !typing && detailOverlay.hidden) {
      ev.preventDefault();
      searchInput.focus();
      return;
    }
    if (ev.key === 'Escape' && !detailOverlay.hidden) {
      closeDetail();
      return;
    }
    if (typing || detailOverlay.hidden) return;
    const video = $('watchVideo');
    if (!video || !state.detail || !state.detail.playerOpen) return;
    if (ev.key === ' ' || ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      if (video.paused) video.play().catch(() => {}); else video.pause();
    } else if (ev.key === 'ArrowRight') {
      video.currentTime = Math.min(video.duration || Infinity, (video.currentTime || 0) + 10);
    } else if (ev.key === 'ArrowLeft') {
      video.currentTime = Math.max(0, (video.currentTime || 0) - 10);
    } else if (ev.key.toLowerCase() === 'm') {
      video.muted = !video.muted;
    } else if (ev.key.toLowerCase() === 'f') {
      const btn = $('btnFs');
      if (btn) btn.click();
    } else if (ev.key.toLowerCase() === 's' && state.player.activeSkipSeg) {
      ev.preventDefault();
      executeSkipSegment(state.player.activeSkipSeg, false);
    } else if (ev.key.toLowerCase() === 'n' && state.detail.type === 'series') {
      const next = findNextEpisode();
      if (next) playSeriesEpisode(next.season, next.episode);
    }
  });

  // ── Arranque inicial ──────────────────────────────────────────────────────
  async function boot() {
    updateListBadge();
    try {
      const [catData, brandData] = await Promise.all([
        fetchJson('/internal/watch/catalogs'),
        fetchJson('/internal/branding.json').catch(() => ({ providers: {} })),
      ]);
      state.catalogs = catData;
      state.branding = brandData || { providers: {} };
    } catch (_) {
      state.catalogs = { sections: { inicio: [], peliculas: [], series: [], anime: [] }, platforms: [] };
    }

    await renderSection('inicio');

    // Deep-link directo: /watch?type=series&id=tt0903747&s=1&e=1
    const sp = new URLSearchParams(window.location.search);
    const qType = sp.get('type');
    const qId = sp.get('id');
    const qSearch = sp.get('q');
    if (qSearch) {
      searchInput.value = qSearch;
      runSearch(qSearch, 'all');
    } else if ((qType === 'movie' || qType === 'series') && qId) {
      openDetail({ type: qType, id: qId, name: qId }, {
        autoplay: Boolean(sp.get('play') === '1' || sp.get('e')),
        season: sp.get('s') ? Number(sp.get('s')) : null,
        episode: sp.get('e') ? Number(sp.get('e')) : null,
      });
    }
  }

  boot();
})();
</script>
</body>
</html>`;
}

module.exports = { renderWatch };
