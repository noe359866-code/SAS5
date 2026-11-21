'use strict';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function probeUrl(url, headers = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, ...headers },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    console.log(`\n=== ${url} -> ${res.status} (${res.url}) [${text.length} bytes] ===`);
    console.log(text.slice(0, 3000));
    return { status: res.status, url: res.url, text };
  } catch (err) {
    console.log(`\n=== ${url} -> ERROR: ${err.message} ===`);
    return null;
  }
}

async function main() {
  await probeUrl('https://videoapi.la/');
  await probeUrl('https://videoapi.la/api');
  await probeUrl('https://videoapi.la/e/movie/550', { Referer: 'https://videoapi.la/' });
  await probeUrl('https://videoapi.la/e/tv/1399/1/1', { Referer: 'https://videoapi.la/' });
  await probeUrl('https://api.videoapi.la/');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
