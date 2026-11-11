'use strict';

/**
 * Piezas de página compartidas por la portada (/) y /configure: fondo
 * decorativo, isla de navegación, tarjetas de soporte y donación y pie.
 *
 * El enlace de soporte sale de config.supportUrl (variable SUPPORT_URL; por
 * defecto, la invitación al Discord de Catálogos+) y el de donaciones de
 * config.kofiUrl (variable KOFI_USERNAME; por defecto, la página de Ko-fi).
 */

const config = require('./config');
const { icon } = require('./icons');
const { escapeHtml } = require('./rails');
const { LANGUAGE_OPTIONS } = require('./webI18n');

/** Datos del enlace de soporte: si es de Discord se presenta con su marca. */
function supportLink() {
  const url = config.supportUrl;
  let host = '';
  try { host = new URL(url).hostname; } catch (_) { /* config ya valida la URL */ }
  const discord = /(^|\.)(discord\.gg|discord\.com|discordapp\.com)$/i.test(host);
  return {
    href: escapeHtml(url),
    discord,
    name: discord ? 'Discord' : 'Soporte',
    iconName: discord ? 'discord' : 'life-buoy',
    attrs: 'target="_blank" rel="noopener noreferrer"',
  };
}

/**
 * Datos del enlace de donaciones (Ko-fi, donde se paga con PayPal o tarjeta).
 * `enabled: false` cuando KOFI_USERNAME=off o el valor no es de Ko-fi: en ese
 * caso la barra, la tarjeta y el pie se renderizan sin ninguna donación.
 */
function donationLink() {
  if (!config.kofiEnabled) return { enabled: false, href: '', username: '', name: '', iconName: '', attrs: '' };
  return {
    enabled: true,
    href: escapeHtml(config.kofiUrl),
    username: config.kofiUsername,
    name: 'Ko-fi',
    iconName: 'kofi',
    attrs: 'target="_blank" rel="noopener noreferrer"',
  };
}

function backgroundHtml() {
  return `<div class="page-glow" aria-hidden="true"></div>
<div class="page-grid" aria-hidden="true"></div>`;
}

/**
 * Isla de navegación.
 * @param {Array<[string, string]>} links  [href, texto] (se ocultan en móvil)
 * @param {string} actions                 HTML de los botones de la derecha
 *
 * El soporte va siempre: como enlace entre los `links` y, cuando estos se
 * ocultan (pantallas estrechas), como botón de icono junto a las acciones. La
 * donación (Ko-fi) se comporta igual, justo antes del soporte.
 */
function webLanguageSelectHtml() {
  const options = LANGUAGE_OPTIONS.map(([code, label]) =>
    `<option value="${escapeHtml(code)}">${escapeHtml(label)}</option>`
  ).join('');
  return `<label class="nav-language">${icon('globe', 16)}<span class="sr-only">Idioma de la web</span><select data-web-language aria-label="Idioma de la web" title="Idioma de la web">${options}</select></label>`;
}

function navHtml({ links = [], actions = '' }) {
  const support = supportLink();
  const donate = donationLink();
  const linkHtml = links
    .map(([href, label]) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`)
    .join('');
  const donateLinkHtml = donate.enabled
    ? `<a href="${donate.href}" ${donate.attrs}>${icon(donate.iconName, 15)} Donar</a>`
    : '';
  const donateButtonHtml = donate.enabled
    ? `<a class="btn btn-ghost btn-sm nav-donate" href="${donate.href}" ${donate.attrs} aria-label="Donar en Ko-fi">${icon(donate.iconName, 16)}</a>`
    : '';
  return `<nav class="nav">
  <div class="nav-inner">
    <a class="brand" href="/" aria-label="Catálogos+, inicio"><img src="/assets/logo.png" alt="" width="32" height="32" /><span>Catálogos<i>+</i></span></a>
    <div class="nav-links">${linkHtml}${donateLinkHtml}<a href="${support.href}" ${support.attrs}>${icon(support.iconName, 15)} Soporte</a></div>
    <div class="nav-actions">${webLanguageSelectHtml()}${donateButtonHtml}<a class="btn btn-ghost btn-sm nav-support" href="${support.href}" ${support.attrs} aria-label="Soporte en ${support.name}">${icon(support.iconName, 16)}</a>${actions}</div>
  </div>
</nav>`;
}

/** Tarjeta grande de soporte. */
function supportCardHtml({ id = 'soporte' } = {}) {
  const support = supportLink();
  const title = support.discord ? '¿Dudas o algo no funciona? Estamos en Discord' : '¿Dudas o algo no funciona?';
  const text = support.discord
    ? 'Soporte de la comunidad, avisos de novedades y un canal para pedir catálogos, plataformas o filtros nuevos.'
    : 'Escríbenos: soporte, avisos de novedades y sugerencias de catálogos, plataformas o filtros nuevos.';
  const button = support.discord ? 'Unirme al Discord' : 'Abrir soporte';
  const buttonClass = support.discord ? 'btn-discord' : 'btn-primary';
  return `<div class="support reveal" id="${escapeHtml(id)}">
  <span class="support-icon">${icon(support.iconName, 34)}</span>
  <div class="support-text">
    <h3>${title}</h3>
    <p>${text}</p>
  </div>
  <a class="btn ${buttonClass} btn-lg" href="${support.href}" ${support.attrs}>${icon(support.iconName, 20)} ${button}</a>
</div>`;
}

/**
 * Tarjeta grande de donación (Ko-fi). Devuelve '' si las donaciones están
 * desactivadas, así la página queda exactamente como antes.
 */
function donateCardHtml({ id = 'donar' } = {}) {
  const donate = donationLink();
  if (!donate.enabled) return '';
  return `<div class="support donate reveal" id="${escapeHtml(id)}">
  <span class="support-icon">${icon(donate.iconName, 34)}</span>
  <div class="support-text">
    <h3>¿Te sirve Catálogos+? Invítame un café</h3>
    <p>El addon es gratis y no tiene anuncios ni cuentas. Si te ahorra búsquedas, puedes apoyar el mantenimiento con una donación en Ko-fi: se paga con PayPal o tarjeta y Ko-fi no cobra comisión por donar.</p>
    <span class="pay-badges"><span class="pay-badge">${icon('paypal', 13)} PayPal</span><span class="pay-badge">${icon(donate.iconName, 13)} Ko-fi</span></span>
  </div>
  <a class="btn btn-kofi btn-lg" href="${donate.href}" ${donate.attrs}>${icon(donate.iconName, 20)} Donar con Ko-fi</a>
</div>`;
}

function footerHtml() {
  const support = supportLink();
  const donate = donationLink();
  const donateItem = donate.enabled
    ? `        <li><a href="${donate.href}" ${donate.attrs}>Donar con Ko-fi</a></li>\n`
    : '';
  return `<footer class="page-footer">
  <div class="footer-grid">
    <div class="footer-about">
      <a class="brand" href="/"><img src="/assets/logo.png" alt="" width="32" height="32" /><span>Catálogos<i>+</i></span></a>
      <p>Addon de Stremio con catálogos por plataforma y estudio, fichas completas y streams filtrados a tu gusto. Gratis y sin cuenta.</p>
    </div>
    <div>
      <h4>Addon</h4>
      <ul>
        <li><a href="/configure">Configurar</a></li>
        <li><a href="/configure#idioma">Idioma y región</a></li>
        <li><a href="/configure#filtros">Filtros de streams</a></li>
        <li><a href="/manifest.json">manifest.json</a></li>
      </ul>
    </div>
    <div>
      <h4>Soporte</h4>
      <ul>
${donateItem}        <li><a href="${support.href}" ${support.attrs}>${support.discord ? 'Discord de Catálogos+' : 'Contactar con soporte'}</a></li>
        <li><a href="https://www.stremio.com/downloads" target="_blank" rel="noopener noreferrer">Descargar Stremio</a></li>
        <li><a href="/healthz">Estado del servicio</a></li>
      </ul>
    </div>
    <div>
      <h4>Datos</h4>
      <ul>
        <li><a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">TMDB</a></li>
        <li><a href="https://www.tvmaze.com/" target="_blank" rel="noopener noreferrer">TVMaze</a></li>
        <li><a href="https://www.justwatch.com/" target="_blank" rel="noopener noreferrer">JustWatch</a></li>
        <li><a href="https://www.omdbapi.com/" target="_blank" rel="noopener noreferrer">OMDb</a></li>
      </ul>
    </div>
  </div>
  <div class="footer-legal">
    <p>Catálogos+ · Datos cortesía de TMDB, JustWatch, TVMaze, OMDB, TheTVDB y Watchmode. Este producto usa la API de TMDB pero no está respaldado ni certificado por TMDB. Los logos son propiedad de sus respectivos servicios. No aloja ni distribuye contenido; solo organiza catálogos y enlaza fuentes públicas.</p>
  </div>
</footer>`;
}

module.exports = { supportLink, donationLink, backgroundHtml, navHtml, supportCardHtml, donateCardHtml, footerHtml, webLanguageSelectHtml };
