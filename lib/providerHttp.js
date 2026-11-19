'use strict';

const { fetchJson, fetchText, timeoutError } = require('./http');

// Dos búsquedas en paralelo dejan margen para metadatos y otras consultas del Worker.
const SEARCH_REQUEST_LIMIT = 18;

/** Un único presupuesto para búsqueda, ficha y reproductores de una fuente. */
function providerHttp(timeoutMs, maxRequests = Infinity) {
  const deadline = Date.now() + timeoutMs;
  let requested = 0;
  const optionsFor = (url, options) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw timeoutError(url, timeoutMs);
    if (requested >= maxRequests) {
      throw Object.assign(new Error('Presupuesto de peticiones agotado'), { requestLimit: true });
    }
    requested += 1;
    return { redirect: 'manual', ...options, timeoutMs: Math.min(remaining, options?.timeoutMs || remaining) };
  };
  /**
   * 301 legítimo de WordPress: misma ruta con barra final, o el mismo host por
   * https. Se sigue **una** vez; un 301 a otra ruta (típico de un 404 que
   * redirige a la portada) se deja como error para no aceptar una ficha falsa.
   */
  const followCanonical = async (url, options, read) => {
    const target = String(url);
    try {
      return await read(target, options);
    } catch (err) {
      if (![301, 302, 307, 308].includes(err?.status) || !err.location) throw err;
      const from = new URL(target);
      const to = new URL(err.location, target);
      const samePath = to.pathname.replace(/\/+$/, '') === from.pathname.replace(/\/+$/, '');
      const sameHost = to.hostname === from.hostname || `www.${from.hostname}` === to.hostname || from.hostname === `www.${to.hostname}`;
      if (!samePath || !sameHost) throw err;
      return read(to.href, optionsFor(to.href, options));
    }
  };
  return {
    text: (url, options) => followCanonical(url, options, (target, opts) => fetchText(target, opts)),
    json: (url, options) => followCanonical(url, options, (target, opts) => fetchJson(target, opts)),
  };
}

function stopProvider(error) {
  return error?.timeout || error?.requestLimit || error?.challenge || [401, 403, 429, 521].includes(error?.status);
}

module.exports = { providerHttp, stopProvider, SEARCH_REQUEST_LIMIT };
