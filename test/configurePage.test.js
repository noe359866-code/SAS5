'use strict';

/** Regresión: el <script> inline de /configure debe ser JS válido y la
 *  codificación base64url de la config debe hacer roundtrip exacto. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { renderConfigure } = require('../lib/configurePage');
const userConfig = require('../lib/userConfig');
const { PLATFORM_KEYS, STUDIO_KEYS } = require('../lib/catalogs');
const configureScript = (html) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1]).find((script) => script.includes('const PLATFORMS ='));

test('el <script> inline de /configure es JS válido (node --check)', () => {
  const html = renderConfigure({ origin: 'https://addon.example', host: 'addon.example' });
  const script = configureScript(html);
  assert.ok(script, 'la página debe incluir el script del configurador');
  const tmp = path.join(os.tmpdir(), `configure-inline-${process.pid}.js`);
  fs.writeFileSync(tmp, script);
  const res = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr || 'el script inline tiene errores de sintaxis');
});

test('/configure: guía rápida orienta la configuración y adapta la navegación a móvil', () => {
  const html = renderConfigure({ origin: 'https://addon.example', host: 'addon.example' });
  assert.match(html, /aria-labelledby="quickGuideTitle"/);
  assert.match(html, /href="#idioma"[^>]*class="quick-step"|class="quick-step" href="#idioma"/);
  assert.match(html, /href="#plataformas"[^>]*class="quick-step"|class="quick-step" href="#plataformas"/);
  assert.match(html, /href="#filtros"[^>]*class="quick-step"|class="quick-step" href="#filtros"/);
  assert.match(html, /Debrid es opcional/);
  assert.match(html, /@media \(max-width: 760px\)[\s\S]*?\.side \{[\s\S]*?position: sticky; top: 74px/);
  assert.match(html, /scroll-snap-type: x proximity/);
  const { PHRASES, TRANSLATIONS, LANGUAGES } = require('../lib/webI18n');
  for (const source of [
    'Empieza aquí',
    '3 pasos · sin complicaciones',
    'Sugerencia: empieza por «Recomendado» para ocultar CAM, screener y 3D. Debrid es opcional.',
  ]) {
    const row = PHRASES.find((phrase) => phrase[0] === source);
    assert.ok(row, `falta traducción para «${source}»`);
    for (const language of LANGUAGES) assert.ok(TRANSLATIONS[language][source], `${language}: ${source}`);
  }
});

test('config region MX/es-MX sobrevive roundtrip base64url', () => {
  const encoded = userConfig.encodeConfig({
    lang: 'es-MX',
    region: 'MX',
    platforms: ['netflix', 'hulu'],
    studios: ['marvel'],
    base: ['tendencias', 'top'],
  });
  const decoded = userConfig.decodeConfig(encoded, PLATFORM_KEYS, STUDIO_KEYS);
  assert.equal(decoded.region, 'MX');
  assert.equal(decoded.lang, 'es-MX');
  assert.deepEqual(decoded.platforms.sort(), ['hulu', 'netflix']);
  assert.deepEqual(decoded.studios, ['marvel']);
  assert.deepEqual(decoded.base.sort(), ['tendencias', 'top']);
});

test('decodeConfig rechaza basura y segmentos reservados', () => {
  assert.equal(userConfig.decodeConfig('!!!', PLATFORM_KEYS, STUDIO_KEYS), null);
  assert.equal(userConfig.decodeConfig('bm90LWpzb24', PLATFORM_KEYS, STUDIO_KEYS), null); // "not-json"
  assert.equal(userConfig.decodeConfig('catalog', PLATFORM_KEYS, STUDIO_KEYS), null);
});

test('decodeConfig sin campos opcionales cae a defaults (todo activado)', () => {
  const encoded = userConfig.encodeConfig({ lang: 'es', region: 'AR' });
  const decoded = userConfig.decodeConfig(encoded, PLATFORM_KEYS, STUDIO_KEYS);
  assert.equal(decoded.region, 'AR');
  assert.equal(decoded.platforms, null); // null = todas
  assert.equal(decoded.studios, null);
});

test('config completa (todo marcado en /configure) cabe y decodifica', () => {
  const streams = require('../lib/streams');
  // Lo que genera /configure al marcar TODAS las plataformas, estudios,
  // catálogos base y proveedores: el caso real que rompía (596 caracteres
  // frente al límite antiguo de 512 → 404 invalid_config → sin streams).
  const encoded = userConfig.encodeConfig({
    lang: 'es',
    region: 'MX',
    platforms: PLATFORM_KEYS,
    studios: STUDIO_KEYS,
    base: userConfig.BASE_KEYS,
    streams: streams.PROVIDER_KEYS,
  });
  assert.ok(encoded.length > 512, `el segmento mide ${encoded.length} caracteres`);
  assert.ok(encoded.length <= userConfig.MAX_CONFIG_SEGMENT);
  const decoded = userConfig.decodeConfig(encoded, PLATFORM_KEYS, STUDIO_KEYS, streams.PROVIDER_KEYS);
  assert.ok(decoded, 'la config completa debe decodificar');
  assert.deepEqual(decoded.platforms.sort(), [...PLATFORM_KEYS].sort());
  assert.deepEqual(decoded.studios.sort(), [...STUDIO_KEYS].sort());
  assert.deepEqual(decoded.streams.sort(), [...streams.PROVIDER_KEYS].sort());
  assert.equal(decoded.region, 'MX');
});

test('landing y /configure comparten el sistema de diseño y no dejan plantillas sin resolver', () => {
  const { renderHome } = require('../lib/homePage');
  const home = renderHome({ origin: 'https://addon.example', host: 'addon.example', apiStatus: { tmdb: false } });
  const conf = renderConfigure({ origin: 'https://addon.example', host: 'addon.example' });
  for (const [label, html] of [['landing', home], ['configure', conf]]) {
    assert.equal(/\$\{/.test(html), false, `${label}: quedan placeholders sin resolver`);
    assert.match(html, /--brand:\s*#f5f5f7/, `${label}: sin tokens del tema`);
    assert.match(html, /--brand-2:\s*#2997ff/, `${label}: sin azul de sistema`);
    assert.match(html, /--grad:\s*linear-gradient/, `${label}: sin degradado de la acción principal`);
    assert.match(html, /class="nav"/, `${label}: sin barra de navegación`);
    assert.match(html, /class="page-glow"/, `${label}: sin fondo decorativo`);
    assert.match(html, /prefers-reduced-motion/, `${label}: no respeta reduced-motion`);
    assert.match(html, /<meta name="viewport"/, `${label}: sin viewport móvil`);
  }
  // El control segmentado y el buscador siguen existiendo en la portada.
  assert.match(home, /class="tab active"/);
  assert.match(home, /id="homeSearch"/);
  // La barra fija de instalación sigue existiendo en /configure.
  assert.match(conf, /id="installBtnFooter"/);
  assert.match(conf, /id="manifestUrl"/);
});

test('/configure: los proveedores añadidos después son elegibles y nacen marcados en un borrador antiguo', () => {
  const vm = require('node:vm');
  const all = ['knaben', 'torlock', 'blackholebay', 'nyaa', 'yts', 'eztv', 'rarbg', 'torrentindexer', 'torrentioes'];
  // Ejecuta el arranque del script (constantes, state, save y restore) con
  // un localStorage simulado y devuelve los proveedores que quedan marcados.
  const run = (draft, initialCfg) => {
    const html = renderConfigure({ origin: 'https://addon.example', host: 'addon.example', initialCfg });
    for (const key of all) assert.match(html, new RegExp(`data-group="streams" data-key="${key}"`), key);
    const script = configureScript(html);
    const setup = script.slice(0, script.indexOf('\nfunction b64url'));
    const sandbox = {
      saved: null,
      localStorage: {
        getItem: () => (draft ? JSON.stringify(draft) : null),
        setItem: (key, value) => { sandbox.saved = JSON.parse(value); },
      },
    };
    // En JSON: un array creado dentro del contexto no es deepEqual a uno de fuera.
    vm.runInNewContext(`${setup}\nrestore();\nglobalThis.streams = JSON.stringify([...state.streams]);\nsave();`, sandbox);
    return { streams: JSON.parse(sandbox.streams), saved: sandbox.saved };
  };

  // Primera visita: todo marcado.
  assert.deepEqual(run(null).streams, all);
  // Borrador guardado antes de existir Nyaa y YTS: los nuevos nacen marcados
  // y se respeta lo que el usuario había desmarcado.
  assert.deepEqual(run({ streams: ['knaben', 'torlock', 'blackholebay'] }).streams, all);
  assert.deepEqual(run({ streams: ['knaben'] }).streams, ['knaben', 'nyaa', 'yts', 'eztv', 'rarbg', 'torrentindexer', 'torrentioes']);
  assert.deepEqual(run({ streams: [] }).streams, ['nyaa', 'yts', 'eztv', 'rarbg', 'torrentindexer', 'torrentioes']);
  // Borrador guardado cuando había cinco proveedores, con YTS desmarcado:
  // EZTV, The RarBg e Índice BR nacen marcados y YTS sigue desmarcado.
  assert.deepEqual(
    run({ streams: ['knaben', 'nyaa'], knownStreams: all.slice(0, 5) }).streams,
    ['knaben', 'nyaa', 'eztv', 'rarbg', 'torrentindexer', 'torrentioes']
  );
  // Borrador nuevo: si el usuario desmarcó YTS, sigue desmarcado.
  const draft = run({ streams: ['knaben', 'nyaa'], knownStreams: all });
  assert.deepEqual(draft.streams, ['knaben', 'nyaa']);
  // El borrador anota qué proveedores conocía al guardarse.
  assert.deepEqual(draft.saved.streams, ['knaben', 'nyaa']);
  assert.deepEqual(draft.saved.knownStreams, all);
  // Desde Stremio (/<config>/configure) manda la config instalada, tal cual.
  const installed = { lang: 'es', region: 'MX', platforms: null, studios: null, base: null, streams: ['knaben', 'torlock', 'blackholebay'] };
  assert.deepEqual(run({ streams: all, knownStreams: all }, installed).streams, ['knaben', 'torlock', 'blackholebay']);
});
