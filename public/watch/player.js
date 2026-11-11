'use strict';
// Runs in an opaque-origin sandbox: no access to the application's DOM or storage.
let started = false;
window.addEventListener('message', event => {
  if (event.source !== parent || event.data?.type !== 'watch-play' || started) return;
  const { magnet, title } = event.data;
  if (typeof magnet !== 'string' || !/^magnet:\?xt=urn(?::|%3A)btih(?::|%3A)[a-f\d]{40}/i.test(magnet)) return;
  started = true;
  window.webtor = [{ id: 'webtor', magnet, title: String(title || '').slice(0, 250), lang: 'es', width: '100%', height: '440px', referer: '', on: e => {
    if (e.name === 'torrent error') parent.postMessage({ type: 'watch-error' }, '*');
  } }];
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/@webtor/embed-sdk-js@0.2.19/dist/index.min.js';
  script.referrerPolicy = 'no-referrer';
  script.onload = () => { document.getElementById('status').hidden = true; parent.postMessage({ type: 'watch-loaded' }, '*'); };
  script.onerror = () => { document.getElementById('status').textContent = 'No se pudo cargar Webtor.'; parent.postMessage({ type: 'watch-error' }, '*'); };
  document.head.append(script);
});
parent.postMessage({ type: 'watch-ready' }, '*');
