'use strict';

const config = require('./config');

// Nunca incluir URL con parámetros ni respuestas del proveedor en mensajes de error:
// ambos pueden contener claves, tokens u otros datos sensibles.
function httpError(res, url, body) {
  const err = new Error(`HTTP ${res.status} al consultar ${safeUrl(url)}`);
  err.status = res.status;
  err.retryAfter = res.headers.get('retry-after');
  try {
    const data = JSON.parse(body);
    err.quotaExceeded = /request limit reached/i.test(String(data.Error || ''));
  } catch (_) { /* cuerpo no JSON */ }
  return err;
}

/** URL sin credenciales ni parámetros, apta para logs y mensajes de error. */
function safeUrl(url) {
  const safe = new URL(url);
  safe.username = '';
  safe.password = '';
  safe.search = '';
  safe.hash = '';
  return safe.toString();
}

/** Error de plazo agotado, marcado con `timeout: true`. */
function timeoutError(url, timeoutMs) {
  const err = new Error(`Timeout de ${timeoutMs} ms al consultar ${safeUrl(url)}`);
  err.timeout = true;
  return err;
}

/**
 * fetch con timeout vía AbortController. Al vencer el plazo lanza un error
 * claro («Timeout de 6000 ms al consultar …») marcado con `timeout: true`,
 * en vez del genérico «The operation was aborted» del runtime.
 *
 * `method`/`body` son opcionales: los añadió PlayLatinSRC, que resuelve las
 * fuentes con un POST. Sin `body`, el resto de llamadas siguen siendo GET.
 */
async function request(url, { headers = {}, timeoutMs = config.httpTimeoutMs, method, body } = {}, read) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const init = { headers, signal: controller.signal, redirect: 'follow' };
    if (method) init.method = method;
    if (body !== undefined) init.body = body;
    const res = await fetch(url, init);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw httpError(res, url, body);
    }
    return await read(res);
  } catch (err) {
    if (!timedOut) throw err;
    throw timeoutError(url, timeoutMs);
  } finally {
    clearTimeout(timer);
  }
}

/** fetch JSON con timeout. Lanza error con contexto. */
function fetchJson(url, options) {
  return request(url, options, (res) => res.json());
}

/** fetch de texto plano (feeds Torznab/RSS en XML) con el mismo timeout. */
function fetchText(url, options) {
  return request(url, options, (res) => res.text());
}

module.exports = { fetchJson, fetchText, timeoutError };
