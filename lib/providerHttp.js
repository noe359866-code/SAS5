'use strict';

const { fetchJson, fetchText, timeoutError } = require('./http');

// Identificación de navegador de escritorio. Muchos sitios responden 301/404 a
// clientes con User-Agent desconocido; no es un disfraz para saltarse un
// challenge (eso se sigue rechazando), solo el mismo cliente que usa la web.
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

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
    // `&#038;` es el `&` codificado con el que WordPress escribe sus enlaces:
    // sin decodificarlo el `trid` nunca llega al servidor.
    const requested = target.replace(/&(?:amp|#0*38);/g, '&');
    // Los adaptadores fijan `redirect: 'manual'` (nunca siguen una redirección
    // sin comprobarla) y aquí se respeta; solo `method`/`body` se omiten
    // cuando no se pidieron, para no cambiar el tipo de petición.
    const clean = optionsFor(requested, options);
    if (clean.method === 'GET' || clean.method === undefined) delete clean.method;
    if (clean.body === undefined) delete clean.body;
    try {
      return await read(requested, withUa(clean));
    } catch (err) {
      if (![301, 302, 307, 308].includes(err?.status) || !err.location) throw err;
      const from = new URL(requested);
      const to = new URL(err.location, target);
      const samePath = to.pathname.replace(/\/+$/, '') === from.pathname.replace(/\/+$/, '');
      const sameHost = to.hostname === from.hostname || `www.${from.hostname}` === to.hostname || from.hostname === `www.${to.hostname}`;
      if (!samePath || !sameHost) throw err;
      return read(to.href, withUa(optionsFor(to.href, options)));
    }
  };
  /** Cliente de navegador: cada extractor declara el suyo. Los adaptadores
   *  que no lo declaran conservan su comportamiento (sin cabecera añadida). */
  const withUa = (options) => {
    const headers = { ...(options?.headers || {}) };
    const hasUa = Object.keys(headers).some((key) => key.toLowerCase() === 'user-agent');
    if (!hasUa) headers['User-Agent'] = DESKTOP_UA;
    return { ...options, headers };
  };
  return {
    text: (url, options) => followCanonical(url, options, (target, opts) => fetchText(target, opts)),
    json: (url, options) => followCanonical(url, options, (target, opts) => fetchJson(target, opts)),
  };
}

function stopProvider(error) {
  return error?.timeout || error?.requestLimit || error?.challenge || [401, 403, 429, 521].includes(error?.status);
}

/**
 * La página no existe: 404/410, o un 301/302/307/308 que `followCanonical`
 * rechazó porque apunta a otra ruta **del mismo origen** (el patrón habitual
 * es redirigir a la portada cuando el slug no existe). No es un error de la
 * búsqueda: se pasa al siguiente candidato. Un redirect a otro origen no se
 * disimula: sigue siendo error.
 */
function isNotFound(error, requestUrl) {
  if ([404, 410].includes(error?.status)) return true;
  if (![301, 302, 307, 308].includes(error?.status) || !error?.location || !requestUrl) return false;
  try {
    return new URL(error.location, requestUrl).origin === new URL(requestUrl).origin;
  } catch { return false; }
}

module.exports = { providerHttp, stopProvider, isNotFound, SEARCH_REQUEST_LIMIT };
