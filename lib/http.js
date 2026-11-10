'use strict';

const config = require('./config');

// Nunca incluir URL con parámetros ni respuestas del proveedor en mensajes de error:
// ambos pueden contener claves, tokens u otros datos sensibles.
function httpError(res, url, body) {
  const safeUrl = new URL(url);
  safeUrl.username = '';
  safeUrl.password = '';
  safeUrl.search = '';
  safeUrl.hash = '';
  const err = new Error(`HTTP ${res.status} al consultar ${safeUrl.toString()}`);
  err.status = res.status;
  err.retryAfter = res.headers.get('retry-after');
  try {
    const data = JSON.parse(body);
    err.quotaExceeded = /request limit reached/i.test(String(data.Error || ''));
  } catch (_) { /* cuerpo no JSON */ }
  return err;
}

/**
 * fetch JSON con timeout vía AbortController. Lanza error con contexto.
 */
async function fetchJson(url, { headers = {}, timeoutMs = config.httpTimeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw httpError(res, url, body);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** fetch de texto plano (feeds Torznab/RSS en XML) con el mismo timeout. */
async function fetchText(url, { headers = {}, timeoutMs = config.httpTimeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw httpError(res, url, body);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchJson, fetchText };
