'use strict';

// Filtro conservador de URLs. No verifica el contenido ni identifica anuncios
// insertados dentro de una playlist o del propio vídeo.
//
// Además de la extensión en la ruta se aceptan dos formas medidas en los
// sitios del registro (19-11-2026), porque el reproductor declara el formato en
// vez de la extensión:
//   · token bajo `/m3u8/…` — el player propio de AnimeFLV
//     (`player.zilla-networks.com/m3u8/<token>`, master `#EXTM3U` verificado);
//   · un parámetro que es solo la extensión — UnLimPlay lo pide como
//     `cps.php?t=…&e=…&s=…&x=.m3u8`.
// El valor del parámetro tiene que ser exactamente la extensión: un `?u=<url>`
// de un relé sigue sin pasar.
const EXT = /\.(?:m3u8|mp4|m4v|webm)$/;
const EXT_ONLY = /^\.(?:m3u8|mp4|m4v|webm)$/;
const TOKEN_PATH = /\/(?:m3u8|hls)\/[a-z0-9_-]{8,}$/;

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
  if (EXT.test(path)) return true;
  for (const value of u.searchParams.values()) if (EXT_ONLY.test(value)) return true;
  return TOKEN_PATH.test(path);
}
module.exports = { isDirectMedia };
