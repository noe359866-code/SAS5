'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const storage = new AsyncLocalStorage();

// Workers may retain settled values across requests, never pending I/O promises.
// Separate maps also keep the two cache layers' namespaces independent.
function run(loader) {
  return storage.run(new Map(), loader);
}
function flights(namespace, fallback) {
  const scope = storage.getStore();
  if (!scope) return fallback; // Node server: process-wide single-flight is safe.
  if (!scope.has(namespace)) scope.set(namespace, new Map());
  return scope.get(namespace);
}
module.exports = { run, flights };
