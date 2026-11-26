'use strict';

/**
 * Addon de Stremio «RamdonLatam Canales» (vía stremio-addon-sdk).
 * Punto de entrada para el servidor Node local y Vercel.
 * El núcleo (manifest + handlers) vive en lib/core.js y es compartido
 * con el Cloudflare Worker (worker.mjs).
 */

const { addonBuilder } = require('stremio-addon-sdk');
const core = require('./lib/core');

const builder = new addonBuilder(core.buildManifest());

builder.defineCatalogHandler(({ type, id, extra }) => core.handleCatalog(type, id, null, extra));
builder.defineMetaHandler(({ type, id }) => core.handleMeta(type, id));
builder.defineStreamHandler(({ type, id }) => core.handleStream(type, id));

module.exports = builder.getInterface();
