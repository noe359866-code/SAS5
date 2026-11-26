'use strict';

/**
 * Oculta los orígenes de canales de la respuesta /stream y retransmite HLS
 * desde el Worker. Los destinos van cifrados con AES-GCM en URLs opacas; no
 * se aceptan destinos sin un token válido.
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const TOKEN_PREFIX = '/__channel/';
const HLS_TYPE = /mpegurl|vnd\.apple\.mpegurl/i;

function b64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromB64url(value) {
  const base64 = String(value || '').replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(Math.ceil(String(value || '').length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

async function encryptionKey(secret) {
  if (!secret || String(secret).length < 24) throw new Error('M3U_PROXY_SECRET debe tener al menos 24 caracteres.');
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(secret)));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptTarget(payload, secret) {
  const key = await encryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(payload))
  ));
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv);
  combined.set(ciphertext, iv.length);
  return b64url(combined);
}

async function decryptTarget(token, secret) {
  const packed = fromB64url(token);
  if (packed.length < 29 || packed.length > 16_384) throw new Error('token inválido');
  const key = await encryptionKey(secret);
  const iv = packed.slice(0, 12);
  const ciphertext = packed.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  const payload = JSON.parse(decoder.decode(plaintext));
  const target = new URL(payload.url);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    throw new Error('destino inválido');
  }
  return { ...payload, url: target.href };
}

async function maskedStreams(streams, { origin, secret }) {
  const base = String(origin || '').replace(/\/+$/, '');
  if (!secret) return streams;
  return Promise.all(streams.map(async (stream) => {
    const requestHeaders = stream.behaviorHints?.proxyHeaders?.request || {};
    const token = await encryptTarget({ url: stream.url, headers: requestHeaders }, secret);
    return { ...stream, url: `${base}${TOKEN_PREFIX}${token}` };
  }));
}

function corsHeaders(headers = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Range, Origin, Accept, User-Agent',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Cache-Control': 'no-store',
    ...headers,
  };
}

async function proxiedUrl(url, headers, { origin, secret }) {
  const token = await encryptTarget({ url, headers }, secret);
  return `${String(origin || '').replace(/\/+$/, '')}${TOKEN_PREFIX}${token}`;
}

async function readBoundedText(response, maxBytes = 1_000_000) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error('HLS manifest exceeds size limit');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return decoder.decode(bytes);
}

async function rewriteManifest(text, responseUrl, options, inheritedHeaders) {
  const rewrite = async (raw) => {
    const value = String(raw || '').trim();
    if (!value || /^(?:data:|skd:|urn:)/i.test(value)) return value;
    let absolute;
    try { absolute = new URL(value, responseUrl).href; } catch { return value; }
    return proxiedUrl(absolute, inheritedHeaders, options);
  };
  const lines = String(text).split(/\r?\n/);
  const rewritten = [];
  for (const line of lines) {
    if (!line.trim()) { rewritten.push(line); continue; }
    if (line.trimStart().startsWith('#')) {
      let result = line;
      const matches = [...line.matchAll(/URI="([^"]+)"/g)];
      for (const match of matches) {
        const masked = await rewrite(match[1]);
        result = result.replace(match[0], `URI="${masked}"`);
      }
      rewritten.push(result);
    } else {
      rewritten.push(await rewrite(line));
    }
  }
  return rewritten.join('\n');
}

async function proxyRequest(request, token, { secret, origin }) {
  if (!secret) return new Response('Channel proxy is not configured.', { status: 503, headers: corsHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }) });
  let target;
  try { target = await decryptTarget(token, secret); }
  catch { return new Response('Not found', { status: 404, headers: corsHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }) }); }

  const headers = new Headers();
  for (const [name, value] of Object.entries(target.headers || {})) {
    if (/^(user-agent|referer|origin)$/i.test(name) && value) headers.set(name, value);
  }
  const range = request.headers.get('Range');
  if (range) headers.set('Range', range);
  const ifRange = request.headers.get('If-Range');
  if (ifRange) headers.set('If-Range', ifRange);

  let upstream;
  try {
    upstream = await fetch(target.url, { method: request.method === 'HEAD' ? 'HEAD' : 'GET', headers, redirect: 'follow' });
  } catch {
    return new Response('Upstream unavailable', { status: 502, headers: corsHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }) });
  }

  const type = upstream.headers.get('Content-Type') || '';
  const looksLikePlaylist = HLS_TYPE.test(type) || /\.m3u8(?:$|[?#])/i.test(target.url);
  if (request.method !== 'HEAD' && looksLikePlaylist && upstream.ok) {
    let text;
    try { text = await readBoundedText(upstream); }
    catch { return new Response('Invalid HLS manifest', { status: 502, headers: corsHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }) }); }
    if (text.startsWith('#EXTM3U')) {
      const body = await rewriteManifest(text, upstream.url || target.url, { origin, secret }, target.headers || {});
      return new Response(body, {
        status: upstream.status,
        headers: corsHeaders({
          'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
          ...(upstream.headers.get('Last-Modified') ? { 'Last-Modified': upstream.headers.get('Last-Modified') } : {}),
        }),
      });
    }
    return new Response(text, {
      status: upstream.status,
      headers: corsHeaders({ 'Content-Type': type || 'application/octet-stream' }),
    });
  }

  const forwarded = new Headers(corsHeaders());
  for (const name of ['Content-Type', 'Content-Range', 'Accept-Ranges', 'ETag', 'Last-Modified']) {
    const value = upstream.headers.get(name);
    if (value) forwarded.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: forwarded });
}

function tokenFromPath(pathname) {
  return pathname.startsWith(TOKEN_PREFIX) ? pathname.slice(TOKEN_PREFIX.length) : '';
}

module.exports = { TOKEN_PREFIX, encryptTarget, decryptTarget, maskedStreams, proxyRequest, tokenFromPath };
