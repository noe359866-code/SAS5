'use strict';

const config = require('./config');

// Filtro conservador de URLs. No verifica el contenido ni identifica anuncios
// insertados dentro de una playlist o del propio vídeo.
function isDirectMedia(raw, provider, allowProxy = true) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return false; }
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return false;
  // El proxy local contiene la URL final en u. No inspeccionar otros parámetros
  // porque los tokens de acceso pueden contener cualquier cadena.
  if (allowProxy && u.pathname === '/hls' && u.searchParams.has('u')) {
    let origin;
    try { origin = new URL(config.addonBaseUrl).origin; } catch { return false; }
    return u.origin === origin && isDirectMedia(u.searchParams.get('u'), provider, false);
  }
  if (/(?:^|\.)(?:ads?|adserver|adservice|advertising|doubleclick|adsterra)(?:\.|$)/i.test(u.hostname)) return false;
  let path;
  try { path = decodeURIComponent(u.pathname).toLowerCase(); } catch { return false; }
  // Indicadores inequívocos en componentes completos, no palabras dentro del
  // nombre de una película (por ejemplo The Advertiser o Ad Astra).
  if (/(?:^|\/)(?:ads?|advert|adverts|advertising|preroll|pre-roll|vast|vpaid)(?:\/|$)/.test(path)) return false;
  if (/\.(?:m3u8|mp4|m4v|webm)$/.test(path)) return true;
  return false;
}
module.exports = { isDirectMedia };
