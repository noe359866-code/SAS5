'use strict';

const fs = require('node:fs');
const path = require('node:path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const out = [];

function log(msg) {
  console.log(msg);
  out.push(msg);
}

async function probeUrl(url, headers = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, ...headers },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    log(`\n## ${url} -> ${res.status} (${res.url}) [${text.length} bytes]\n`);
    log('```html');
    log(text.slice(0, 6000));
    log('```');
    return { status: res.status, url: res.url, text };
  } catch (err) {
    log(`\n## ${url} -> ERROR: ${err.message}\n`);
    return null;
  }
}

async function main() {
  log('# Sonda videoapi.la\n');
  await probeUrl('https://videoapi.la/');
  await probeUrl('https://videoapi.la/api');
  await probeUrl('https://videoapi.la/e/movie/550', { Referer: 'https://videoapi.la/' });
  await probeUrl('https://videoapi.la/e/tv/1399/1/1', { Referer: 'https://videoapi.la/' });
  await probeUrl('https://api.videoapi.la/');

  const outPath = path.join(__dirname, '..', '.probe', 'videoapi.md');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, out.join('\n') + '\n', 'utf8');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
