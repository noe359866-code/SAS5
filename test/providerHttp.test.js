'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { providerHttp } = require('../lib/providerHttp');

test('HTTP de proveedor: cancela un JSON demasiado grande aunque no declare Content-Length', async (t) => {
  let cancelled = false;
  t.mock.method(global, 'fetch', async (_url, options) => {
    assert.equal(options.redirect, 'manual');
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(17)); },
      cancel() { cancelled = true; },
    }));
  });
  await assert.rejects(() => providerHttp(1000).json('https://api.example/?private=signature', { maxBytes: 16, redirect: 'follow' }), (err) => {
    assert.equal(err.bodyLimit, true);
    assert.doesNotMatch(err.message, /private|signature/);
    return true;
  });
  assert.equal(cancelled, true);
});

test('HTTP de proveedor: limita el cuerpo de errores sin perder el estado HTTP', async (t) => {
  let cancelled = false;
  t.mock.method(global, 'fetch', async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(32 * 1024 + 1)); },
    cancel() { cancelled = true; },
  }), { status: 429 }));
  await assert.rejects(() => providerHttp(1000).json('https://api.example/search'), { status: 429 });
  assert.equal(cancelled, true);
});

test('HTTP de proveedor: JSON inválido identifica la etapa sin publicar el cuerpo', async (t) => {
  t.mock.method(global, 'fetch', async () => new Response('<html>token-privado</html>'));
  await assert.rejects(() => providerHttp(1000).json('https://api.example/search', { stage: 'search' }), (err) => {
    assert.equal(err.providerFormat, true);
    assert.equal(err.stage, 'search');
    assert.doesNotMatch(err.message, /token-privado/);
    return true;
  });
});
