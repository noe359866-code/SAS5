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
  return {
    text: async (url, options) => fetchText(url, optionsFor(url, options)),
    json: async (url, options) => fetchJson(url, optionsFor(url, options)),
  };
}

function stopProvider(error) {
  return error?.timeout || error?.requestLimit || error?.challenge || [401, 403, 429, 521].includes(error?.status);
}

module.exports = { providerHttp, stopProvider, SEARCH_REQUEST_LIMIT };
