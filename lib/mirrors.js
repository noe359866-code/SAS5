'use strict';

/**
 * Espejos de cuota: repartir el addon entre varios despliegues gratuitos.
 *
 * ## El problema que resuelve
 *
 * Cloudflare Workers Free da **100.000 invocaciones/día por CUENTA**, y ese
 * número no se puede subir por código: al agotarlo, Cloudflare responde
 * `Error 1027` y el Worker ni se ejecuta. Un addon con 173.000 peticiones/día
 * no cabe en una cuenta por muchas cachés que se añadan.
 *
 * ## La solución
 *
 * El mismo repositorio se despliega **dos (o más) veces** en cuentas
 * distintas —o en otro proveedor, como Vercel— y cada despliegue tiene su
 * propia cuota. Con `MIRROR_ORIGINS` el addon reparte a los usuarios entre
 * esos despliegues en el momento de instalar:
 *
 *   MIRROR_ORIGINS="https://catalogos-2.mi-subdominio.workers.dev,https://catalogos.vercel.app"
 *
 * Cada usuario cae siempre en el **mismo** espejo (hash determinista de su
 * configuración), así que su manifest, sus catálogos y sus fichas viven en un
 * solo origen y no se mezclan entre servidores. Con dos espejos el techo pasa
 * de 100.000 a **200.000 peticiones/día**; con tres, 300.000.
 *
 * Lo que NO hace: mover a los usuarios ya instalados. Stremio guarda la URL
 * que se instaló, así que para repartir el tráfico existente hay que
 * reinstalar el addon (o compartir el enlace del espejo nuevo). Lo que sí
 * alivia a los instalados sin tocar nada es `lib/edgeShortcuts.js`.
 */

/** Cuota diaria del plan gratuito de Cloudflare Workers, por cuenta. */
const FREE_DAILY_INVOCATIONS = 100_000;

/** Más de esto no se reparte: nadie mantiene nueve despliegues. */
const MAX_MIRRORS = 8;

/**
 * Normaliza un origen público.
 *
 * Acepta `catalogos.x.workers.dev` (sin esquema), quita la barra final y
 * descarta credenciales, rutas con query o esquemas raros. Devuelve '' si no
 * es un origen usable, para que una errata no rompa la instalación entera.
 *
 * @param {string} value
 * @returns {string} origen sin barra final (`https://host` o `https://host/base`)
 */
function normalizeOrigin(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let url;
  try {
    url = new URL(candidate);
  } catch (_) {
    return '';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  if (!url.hostname || url.username || url.password) return '';
  const pathname = url.pathname.replace(/\/+$/, '');
  // Sin query ni hash: un espejo es un origen, no una ruta con parámetros.
  return `${url.protocol}//${url.host.toLowerCase()}${pathname}`;
}

/**
 * Lista de espejos a partir de la variable de entorno.
 *
 * Acepta comas, punto y coma, espacios o saltos de línea como separadores
 * (pegar una lista de varias líneas es lo normal) y elimina duplicados.
 *
 * @param {string|string[]} value
 * @returns {string[]}
 */
function parseMirrors(value) {
  const parts = Array.isArray(value) ? value : String(value == null ? '' : value).split(/[\s,;]+/);
  const out = [];
  for (const part of parts) {
    const origin = normalizeOrigin(part);
    if (!origin || out.includes(origin)) continue;
    out.push(origin);
    if (out.length >= MAX_MIRRORS) break;
  }
  return out;
}

/**
 * Lista completa de orígenes: el propio primero y después los espejos.
 *
 * El orden importa: el índice 0 es el despliegue que sirve la página, así que
 * sin espejos configurados todo sigue apuntando a él (comportamiento
 * idéntico al de antes de existir este módulo).
 *
 * @param {string} self origen propio (p. ej. `location.origin`)
 * @param {string|string[]} mirrors `MIRROR_ORIGINS`
 * @returns {string[]}
 */
function withSelf(self, mirrors) {
  const own = normalizeOrigin(self);
  const out = own ? [own] : [];
  for (const origin of parseMirrors(mirrors)) {
    if (!out.includes(origin)) out.push(origin);
  }
  return out.slice(0, MAX_MIRRORS + 1);
}

/**
 * Hash FNV-1a de 32 bits. Determinista y barato (corre en el Worker y en el
 * navegador, y el navegador puede usar exactamente el mismo para que la URL
 * que enseña `/configure` sea la que sirve el servidor).
 *
 * @param {string} text
 * @returns {number} entero sin signo de 32 bits
 */
function hash32(text) {
  let hash = 0x811c9dc5;
  const value = String(text == null ? '' : text);
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Espejo que le toca a una instalación.
 *
 * `seed` debe ser estable por usuario: el segmento canónico de su
 * configuración (`/<cfg>/`) o un identificador guardado en el navegador para
 * la instalación por defecto. Con eso, dos peticiones del mismo usuario van
 * siempre al mismo servidor.
 *
 * @param {string} seed
 * @param {string[]} origins lista ya normalizada (ver `withSelf`)
 * @returns {string} origen, o '' si la lista está vacía
 */
function assign(seed, origins) {
  const list = Array.isArray(origins) ? origins : parseMirrors(origins);
  if (!list.length) return '';
  return list[hash32(seed) % list.length];
}

/**
 * Reparto de la cuota entre los espejos configurados.
 *
 * @param {number} mirrorCount número de espejos (sin contar el propio)
 * @returns {{mirrors: number, own: number, total: number, perMirror: number}}
 */
function capacity(mirrorCount) {
  const others = Math.max(0, Math.min(MAX_MIRRORS, Number(mirrorCount) || 0));
  const shards = others + 1;
  return {
    mirrors: others,
    own: FREE_DAILY_INVOCATIONS,
    perMirror: FREE_DAILY_INVOCATIONS,
    total: shards * FREE_DAILY_INVOCATIONS,
  };
}

/**
 * Informe para `/internal/mirrors.json` y `/healthz`.
 *
 * @param {object} args
 * @param {string} args.self origen propio
 * @param {string|string[]} args.mirrors `MIRROR_ORIGINS`
 * @returns {object}
 */
function report({ self, mirrors } = {}) {
  const own = normalizeOrigin(self);
  const others = parseMirrors(mirrors).filter((origin) => origin !== own);
  const split = capacity(others.length);
  return {
    self: own || null,
    mirrors: others,
    shards: others.length + 1,
    perShardDaily: FREE_DAILY_INVOCATIONS,
    dailyCapacity: split.total,
    // Lo que hay que hacer para duplicar de nuevo, sin adivinar.
    hint: others.length
      ? `Reparto activo: ${others.length + 1} despliegues × ${FREE_DAILY_INVOCATIONS.toLocaleString('es')} invocaciones/día.`
      : 'Define MIRROR_ORIGINS con la URL del segundo despliegue para duplicar la cuota (ver docs/espejos-cuota.md).',
  };
}

module.exports = {
  FREE_DAILY_INVOCATIONS,
  MAX_MIRRORS,
  assign,
  capacity,
  hash32,
  normalizeOrigin,
  parseMirrors,
  report,
  withSelf,
};
