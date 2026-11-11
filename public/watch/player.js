'use strict';
// Runs in an opaque-origin sandbox: no access to the application's DOM or storage.
let started = false;
let loadTimer;
function reportError(message) {
  clearTimeout(loadTimer);
  const status = document.getElementById('status');
  status.hidden = false;
  status.textContent = message;
  parent.postMessage({ type: 'watch-error' }, '*');
}
window.addEventListener('message', event => {
  if (event.source !== parent || event.data?.type !== 'watch-play' || started) return;
  const { magnet, title } = event.data;
  // Validate the complete hash, not just a matching prefix.
  let hash;
  try {
    const uri = new URL(magnet);
    if (uri.protocol !== 'magnet:') return;
    hash = new URLSearchParams(uri.search).get('xt');
  } catch (_) { return; }
  if (!/^urn:btih:[a-f\d]{40}$/i.test(hash || '')) return;
  started = true;
  window.webtor = [{ id: 'webtor', magnet, title: String(title || '').slice(0, 250), lang: 'es', width: '100%', height: '100%', referer: '', on: e => {
    if (e.name === 'torrent error') reportError('Webtor no pudo abrir este torrent. Vuelve a las fuentes y prueba otra copia.');
    if (e.name === 'torrent fetched') {
      document.getElementById('status').hidden = true;
      parent.postMessage({ type: 'watch-torrent-ready' }, '*');
    }
  } }];
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/@webtor/embed-sdk-js@0.2.19/dist/index.min.js';
  script.referrerPolicy = 'no-referrer';
  // CDN failure must not leave an indefinite loading message. This timeout is
  // only for SDK loading, not for downloading/buffering a torrent.
  loadTimer = setTimeout(() => reportError('Webtor tarda demasiado en cargar. Comprueba la conexión o vuelve a las fuentes.'), 25000);
  script.onload = () => {
    clearTimeout(loadTimer);
    document.getElementById('status').hidden = true;
    parent.postMessage({ type: 'watch-loaded' }, '*');
  };
  script.onerror = () => reportError('No se pudo cargar Webtor. Comprueba la conexión o el bloqueo de contenido.');
  document.head.append(script);
});
window.addEventListener('pagehide', () => clearTimeout(loadTimer));
parent.postMessage({ type: 'watch-ready' }, '*');
