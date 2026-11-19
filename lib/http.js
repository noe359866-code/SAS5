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
 */
async function request(url, { headers = {}, timeoutMs = config.httpTimeoutMs, redirect = 'follow', method = 'GET', body = undefined } = {}, read) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    // `method` y `body` se reenvían tal cual: el POST de Dooplay
    // (`admin-ajax.php`) y el de algún visor los necesitan.
    const res = await fetch(url, { headers, signal: controller.signal, redirect, method, ...(body === undefined ? {} : { body }) });
    // Las Challenge Pages pueden devolver incluso HTTP 200. El encabezado es
    // la señal documentada; no ejecutar ni resolver el desafío desde Worker.
    if ((res.headers.get('cf-mitigated') || '').toLowerCase() === 'challenge') {
      if (res.body) await res.body.cancel().catch(() => {});
      const err = new Error(`Challenge de Cloudflare al consultar ${safeUrl(url)}`);
      err.status = res.status;
      err.challenge = true;
      throw err;
    }
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

/** fetch de texto plano con el mismo timeout y límite opcional de lectura. */
function fetchText(url, options) {
  const maxBytes = options?.maxBytes;
  return request(url, options, async (res) => {
    if (!maxBytes || !res.body) return res.text();
    const tooLarge = () => new Error(`Respuesta demasiado grande de ${safeUrl(url)}`);
    if (Number(res.headers.get('content-length')) > maxBytes) {
      await res.body.cancel().catch(() => {});
      throw tooLarge();
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return text + decoder.decode();
        bytes += value.byteLength;
        if (bytes > maxBytes) throw tooLarge();
        text += decoder.decode(value, { stream: true });
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  });
}

module.exports = { fetchJson, fetchText, timeoutError };
