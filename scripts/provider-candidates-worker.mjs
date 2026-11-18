// Standalone diagnostic Worker. Never imported by the production entry point.
import { load } from 'cheerio';

const candidates = [
  ['AnimeJara', 'https://animejara.com/', /(?:\/(?:ver|episodios?|capitulos?)\/|[-/](?:episodio|capitulo)-\d+|\/[a-z0-9-]+\/\d+\/?$)/i],
  ['AnimeBum', 'https://animebum.org/', /\/(?:episodio|anime|ver)\//],
  ['PoseidonHD2', 'https://www.poseidonhd2.co/', /\/(?:movies|pelicula|series|serie)\//],
  ['JKAnime', 'https://jkanime.net/', /\/[a-z0-9-]+\/\d+\/?$/i],
  ['TioAnime', 'https://tioanime.com/directorio?q=Naruto&p=1', /\/anime\//],
  ['Latanime', 'https://latanime.org/buscar?q=Naruto', /\/anime\//],
];

async function inspect(url) {
  const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
  const status = res.status;
  if (res.headers.get('cf-mitigated') === 'challenge' || status < 200 || status >= 300) {
    await res.body?.cancel();
    return { status, state: res.headers.get('cf-mitigated') === 'challenge' ? 'challenge' : status < 400 ? 'redirect' : 'http-error' };
  }
  const reader = res.body.getReader();
  let bytes = 0;
  let html = '';
  const decoder = new TextDecoder();
  try {
    while (bytes < 1024 * 1024) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      html += decoder.decode(value, { stream: true });
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (/just a moment|cf-browser-verification|making sure you.re not a bot/i.test(html)) return { status, state: 'challenge' };
  return { status, state: 'ok', $: load(html) };
}

async function probe([name, url, path]) {
  try {
    const { $, ...entry } = await inspect(url);
    if (!$) return { name, entry };
    const base = new URL(url);
    const detail = $('a[href]').toArray().map((el) => {
      try { return new URL($(el).attr('href'), url); } catch { return null; }
    }).find((link) => link && link.origin === base.origin && !link.username && !link.password && path.test(link.pathname));
    if (!detail) return { name, entry, detail: { state: 'no-matching-link' } };
    const { $: page, ...result } = await inspect(detail.href);
    if (!page) return { name, entry, detail: result };
    const frames = page('iframe[src]').toArray().filter((el) => /player|embed|video|\.mp4|\.m3u8/i.test(page(el).attr('src'))).length;
    const markup = page('script:not([src])').toArray().map((el) => page(el).html() || '').join('\n');
    const directElements = page('video[src],video source[src]').toArray().filter((el) => /\.(?:m3u8|mp4)(?:$|[?#])/i.test(page(el).attr('src')));
    const taggedSpanish = directElements.filter((el) => {
      const label = page(el).closest('[data-language],[data-lang]');
      return /^(?:latino|castellano|español(?: latino| de españa)?)$/i.test((label.attr('data-language') || label.attr('data-lang') || '').trim());
    }).length;
    return { name, entry, detail: { ...result, frames, directElements: directElements.length, taggedSpanish, playerScript: /\b(?:dataLink|videos|sources|servers)\s*[:=]/i.test(markup) } };
  } catch (error) {
    return { name, entry: { state: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'fetch-error' } };
  }
}

export default { async fetch() { return Response.json(await Promise.all(candidates.map(probe))); } };
