'use strict';

/** Token bucket sencillo por instancia para proteger endpoints de escritura. */
const buckets = new Map();
const MAX_BUCKETS = 2048;

function allow(key, { limit = 8, windowMs = 60_000 } = {}) {
  const bucketKey = String(key || 'unknown').slice(0, 160);
  const now = Date.now();
  const previous = buckets.get(bucketKey);
  if (!previous || now >= previous.resetAt) {
    buckets.delete(bucketKey);
    buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    while (buckets.size > MAX_BUCKETS) buckets.delete(buckets.keys().next().value);
    return true;
  }
  buckets.delete(bucketKey);
  buckets.set(bucketKey, previous);
  if (previous.count >= limit) return false;
  previous.count++;
  return true;
}

module.exports = { allow };
