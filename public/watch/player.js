'use strict';
// Host page of the Webtor SDK. The SDK runs code sent by webtor.io in the page that loads it,
// so that page must never share the application's origin. watch.js builds it as a data:
// document, whose origin is always opaque, and this script refuses to start anywhere else:
// neither the application's DOM and storage nor a way out of the frame are within reach.
const isolated = (self.origin || location.origin) === 'null';
let started = false;
let loadTimer;
const tell = (type, detail) => parent.postMessage({ type, ...detail }, '*');
function reportError(reason, message) {
  clearTimeout(loadTimer);
  const status = document.getElementById('status');
  status.hidden = false;
  status.textContent = message;
  tell('watch-error', { reason });
}
// Webtor writes the poster into a CSS url(); accept plain https image addresses only.
const posterUrl = value => (typeof value === 'string' && value.length < 500 && /^https:\/\/[a-z\d.-]+\/[\w./~-]*$/i.test(value) ? value : null);
function start(event) {
  if (event.source !== parent || event.data?.type !== 'watch-play' || started) return;
  const { magnet, title, poster } = event.data;
  // Validate the complete hash, not just a matching prefix.
  let hash;
  try {
    const uri = new URL(magnet);
    if (uri.protocol !== 'magnet:') return;
    hash = new URLSearchParams(uri.search).get('xt');
  } catch (_) { return; }
  if (!/^urn:btih:[a-f\d]{40}$/i.test(hash || '')) return;
  started = true;
  window.webtor = [{ id: 'webtor', magnet, title: String(title || '').slice(0, 250), poster: posterUrl(poster), lang: 'es', width: '100%', height: '100%', referer: '', on: e => {
    // "inited" is the first moment the embed can be used: its play button is in place.
    if (e.name === 'inited') { document.getElementById('status').hidden = true; tell('watch-inited'); }
    if (e.name === 'torrent error') reportError('torrent', 'Webtor no pudo abrir este torrent. Vuelve a las fuentes y prueba otra copia.');
    if (e.name === 'torrent fetched') {
      document.getElementById('status').hidden = true;
      tell('watch-torrent-ready');
    }
  } }];
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/@webtor/embed-sdk-js@0.2.19/dist/index.min.js';
  script.referrerPolicy = 'no-referrer';
  // CDN failure must not leave an indefinite loading message. This timeout is
  // only for SDK loading, not for downloading/buffering a torrent.
  loadTimer = setTimeout(() => reportError('timeout', 'Webtor tarda demasiado en cargar. Comprueba la conexión o vuelve a las fuentes.'), 25000);
  script.onload = () => {
    clearTimeout(loadTimer);
    document.getElementById('status').hidden = true;
    tell('watch-loaded');
    // The SDK has just added the Webtor frame. Its load event lets the application tell a
    // slow connection from an embed that will never answer (switched off, blocked).
    document.querySelector('#webtor iframe')?.addEventListener('load', () => tell('watch-frame'));
  };
  script.onerror = () => reportError('sdk', 'No se pudo cargar Webtor. Comprueba la conexión o el bloqueo de contenido.');
  document.head.append(script);
}
if (isolated) {
  window.addEventListener('message', start);
  // The SDK keeps the click on Webtor's play button to itself; read it from the same message.
  window.addEventListener('message', event => {
    const frame = document.querySelector('#webtor iframe');
    if (frame && event.source === frame.contentWindow && event.data?.name === 'play_clicked') tell('watch-playing');
  });
  window.addEventListener('pagehide', () => clearTimeout(loadTimer));
  tell('watch-ready');
} else reportError('isolation', 'El reproductor externo solo se abre dentro de su marco aislado.');
