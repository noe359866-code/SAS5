'use strict';

const { fetchJson, fetchText, timeoutError } = require('./http');

/** Un único presupuesto para búsqueda, ficha y reproductores de una fuente. */
function providerHttp(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const optionsFor = (url, options) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw timeoutError(url, timeoutMs);
    return { redirect: 'manual', ...options, timeoutMs: remaining };
  };
  return {
    text: async (url, options) => fetchText(url, optionsFor(url, options)),
    json: async (url, options) => fetchJson(url, optionsFor(url, options)),
  };
}

module.exports = { providerHttp };
