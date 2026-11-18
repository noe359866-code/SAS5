'use strict';

const { isDirectMedia } = require('./directMedia');
const { resolutionToken } = require('./resolution');
const { hitMatches } = require('./streamChoices');
const { allowedVideoUrl, inspectVimeos, resolveVimeosEmbed, proxiedHls, REFERER } = require('./vimeos');

function mediaCollector(page, provider, title) {
  const hits = new Map();
  const embeds = new Map();
  function add(raw, audioLabel, quality) {
    if (!raw || !audioLabel) return;
    let url;
    try { url = new URL(raw, page); } catch { return; }
    if (url.protocol !== 'https:' || url.port || url.username || url.password) return;
    const hit = { provider, title, url: url.href, audioLabel, referer: page, resolution: resolutionToken(quality) };
    if (!hitMatches(hit, null)) return;
    if (allowedVideoUrl(url.href) && /^(?:\/embed[-/]|.*\.m3u8$)/i.test(url.pathname)) embeds.set(url.href, hit);
    else if (isDirectMedia(url.href, provider, false)) hits.set(url.href, hit);
  }
  return { add, hits, embeds };
}

// Lee referencias publicadas por el HTML; no ejecuta eventos ni scripts.
function collectElements($, add, { selector = 'video[src], video source[src], video[data-src], iframe[src], iframe[data-src], a[data-src], button[data-src]', defaultLabel = '' } = {}) {
  for (const node of $(selector).toArray()) {
    const el = $(node);
    if (el.is('[download]') || el.closest('[id*="trailer" i],[class*="trailer" i]').length) continue;
    const label = el.closest('[data-language],[data-lang]');
    const fromPlayer = node.name === 'video' || node.name === 'source';
    const audio = label.attr('data-language') || label.attr('data-lang') || (fromPlayer ? defaultLabel : '') || el.attr('title');
    add(el.attr('data-src') || el.attr('src'), audio, el.attr('data-quality') || el.attr('label') || el.attr('res'));
  }
}

async function expandMedia({ hits, embeds }, http) {
  // No seguir iframes desconocidos ni inferir URLs a partir de IDs opacos.
  for (const hit of [...embeds.values()].slice(0, 2)) {
    const inspect = /\.m3u8$/i.test(new URL(hit.url).pathname) ? inspectVimeos(hit.url, http) : resolveVimeosEmbed(hit.url, hit.referer, http);
    const media = await inspect.catch((err) => {
      if (err.timeout && !hits.size) throw err;
      return null;
    });
    if (!media) continue;
    hits.set(media.master, { ...hit, url: proxiedHls(media.master), directUrl: media.master, referer: REFERER,
      quality: 'HLS', resolution: media.resolution, expiresAt: media.expiresAt, verification: media.verification, subtitles: media.subtitles });
  }
  return [...hits.values()];
}

module.exports = { mediaCollector, collectElements, expandMedia };
