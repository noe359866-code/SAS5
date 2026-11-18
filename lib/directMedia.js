'use strict';

// Filtro conservador de URLs. No verifica el contenido ni identifica anuncios
// insertados dentro de una playlist o del propio vídeo.
function isDirectMedia(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return false; }
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return false;
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
