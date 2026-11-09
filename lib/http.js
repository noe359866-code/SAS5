'use strict';

const config = require('./config');

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
      throw new Error(`HTTP ${res.status} al consultar ${url} :: ${body.slice(0, 200)}`);
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
      throw new Error(`HTTP ${res.status} al consultar ${url} :: ${body.slice(0, 200)}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchJson, fetchText };
