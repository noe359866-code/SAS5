'use strict';

/**
 * Addon de Stremio «Catálogos+» (vía stremio-addon-sdk).
 * Punto de entrada para el servidor Node local y Vercel.
 * El núcleo (manifest + handlers) vive en lib/core.js y es compartido
 * con el Cloudflare Worker (worker.mjs).
 */

const { addonBuilder } = require('stremio-addon-sdk');
const core = require('./lib/core');

const builder = new addonBuilder(core.buildManifest());

builder.defineCatalogHandler(({ type, id }) => core.handleCatalog(type, id));
builder.defineMetaHandler(({ type, id }) => core.handleMeta(type, id));
builder.defineStreamHandler(({ type, id }) => core.handleStream(type, id));

module.exports = builder.getInterface();
