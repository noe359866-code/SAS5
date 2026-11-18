'use strict';

const { fetchJson, fetchText, timeoutError } = require('./http');

// Dos búsquedas en paralelo dejan margen para metadatos y otras consultas del Worker.
const SEARCH_REQUEST_LIMIT = 18;
const MAX_JSON_BYTES = 2 * 1024 * 1024;

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
    return { ...options, redirect: 'manual', timeoutMs: Math.min(remaining, options?.timeoutMs || remaining) };
  };
  return {
    text: async (url, options) => fetchText(url, optionsFor(url, options)),
    json: async (url, { stage = 'json', ...options } = {}) => {
      const maxBytes = Math.min(options.maxBytes || MAX_JSON_BYTES, MAX_JSON_BYTES);
      try { return await fetchJson(url, optionsFor(url, { ...options, maxBytes })); }
      catch (err) { if (err instanceof SyntaxError) throw providerFormatError(stage); throw err; }
    },
  };
}

function stopProvider(error) {
  return error?.timeout || error?.requestLimit || error?.challenge || [401, 403, 429, 521].includes(error?.status);
}

// El contenido del proveedor puede incluir URLs firmadas: no guardarlo en el error.
function providerFormatError(stage) {
  return Object.assign(new Error(`Respuesta inesperada en ${stage}`), { providerFormat: true, stage });
}

module.exports = { providerHttp, stopProvider, providerFormatError, SEARCH_REQUEST_LIMIT };
