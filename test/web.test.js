'use strict';

/**
 * Web (portada y /configure): enlace de soporte, controles de filtros,
 * selectores de idioma y región, y el script del navegador de /configure
 * ejecutado de verdad (estado, borrador guardado y URL personal).
 * Sin red y sin navegador: el script corre en un contexto de node:vm.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const config = require('../lib/config');
const { renderHome } = require('../lib/homePage');
const { renderConfigure } = require('../lib/configurePage');
const userConfig = require('../lib/userConfig');
const filters = require('../lib/streamFilters');
const { PROVIDER_KEYS } = require('../lib/streams');
const { PLATFORMS, STUDIOS, PLATFORM_KEYS, STUDIO_KEYS, buildDefs } = require('../lib/catalogs');
const { icon, iconMask, ICON_NAMES } = require('../lib/icons');
const { posterThumb } = require('../lib/rails');
const { supportLink } = require('../lib/layout');

const ORIGIN = 'https://addon.example';
const HOST = 'addon.example';
const DISCORD = 'https://discord.gg/eFVFuxg95';

/** Ejecuta `fn` con un entorno concreto y deja la config como estaba. */
function withEnv(env, fn) {
  config.reload(env);
  try {
    return fn();
  } finally {
    config.reload(null);
  }
}

const home = (extra = {}) => renderHome({ origin: ORIGIN, host: HOST, apiStatus: { tmdb: false }, ...extra });
const configure = (extra = {}) => renderConfigure({ origin: ORIGIN, host: HOST, ...extra });
const count = (text, needle) => text.split(needle).length - 1;
const decode = (segment) => userConfig.decodeConfig(segment, PLATFORM_KEYS, STUDIO_KEYS, PROVIDER_KEYS);

/**
 * Arranca el script de /configure hasta antes de tocar el DOM (constantes,
 * estado, guardar/restaurar y URL personal), ejecuta `actions` como si el
 * usuario pulsara y devuelve el estado y la URL que se instalaría.
 */
function runConfigure({ env = {}, draft = null, initialCfg, actions = '' } = {}) {
  const html = withEnv(env, () => configure({ initialCfg }));
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const cut = script.indexOf('\nfunction setChecks');
  assert.ok(cut > 0, 'no se encuentra el corte del script');
  const sandbox = {
    saved: null,
    window: { location: { origin: ORIGIN } },
    btoa: (text) => Buffer.from(text, 'binary').toString('base64'),
    localStorage: {
      getItem: () => (draft ? JSON.stringify(draft) : null),
      setItem: (key, value) => { sandbox.saved = JSON.parse(value); },
    },
  };
  vm.runInNewContext(`${script.slice(0, cut)}
restore();
${actions}
save();
globalThis.out = JSON.stringify({
  lang: state.lang, region: state.region, hide: [...state.hide], sort: state.sort, maxSize: state.maxSize,
  platforms: [...state.platforms], isDefault: isDefault(), url: personalUrl(),
});`, sandbox);
  const out = JSON.parse(sandbox.out);
  const match = out.url.match(/^https:\/\/addon\.example\/([^/]+)\/manifest\.json$/);
  return { ...out, saved: sandbox.saved, segment: match ? match[1] : null };
}

// ---------------------------------------------------------------- Soporte

test('soporte: el Discord sale en la barra, en la tarjeta y en el pie de las dos páginas', () => {
  withEnv({}, () => {
    for (const [label, html] of [['portada', home()], ['configure', configure()]]) {
      // Enlace de la barra, botón de icono (móvil), tarjeta y pie.
      assert.equal(count(html, `href="${DISCORD}" target="_blank" rel="noopener noreferrer"`), 4, label);
      assert.match(html, /Unirme al Discord/, label);
      assert.match(html, /Discord de Catálogos\+/, label);
      assert.match(html, /aria-label="Soporte en Discord"/, label);
    }
  });
});

test('soporte: SUPPORT_URL cambia el enlace en toda la web y va escapado', () => {
  withEnv({ SUPPORT_URL: 'https://ayuda.example/hilo?a=1&b=<x>' }, () => {
    const link = supportLink();
    assert.equal(link.discord, false);
    assert.equal(link.name, 'Soporte');
    for (const [label, html] of [['portada', home()], ['configure', configure()]]) {
      assert.equal(html.includes('discord.gg'), false, `${label}: sigue el Discord por defecto`);
      assert.equal(count(html, 'href="https://ayuda.example/hilo?a=1&amp;b=%3Cx%3E"'), 4, label);
      assert.equal(html.includes('a=1&b='), false, `${label}: «&» sin escapar`);
      assert.match(html, /Abrir soporte/, label);
      assert.match(html, /Contactar con soporte/, label);
      // Sin marca de Discord cuando el enlace no es de Discord.
      assert.equal(/Unirme al Discord|Estamos en Discord/.test(html), false, label);
    }
  });
  // Otra invitación de Discord conserva la presentación de Discord.
  withEnv({ SUPPORT_URL: 'discord.gg/permanente' }, () => {
    assert.equal(supportLink().discord, true);
    assert.match(home(), /href="https:\/\/discord\.gg\/permanente"/);
  });
});

test('soporte: una SUPPORT_URL que no es http(s) se ignora', () => {
  const urlFor = (value) => withEnv({ SUPPORT_URL: value }, () => config.supportUrl);
  assert.equal(urlFor(undefined), DISCORD);
  assert.equal(urlFor('   '), DISCORD);
  assert.equal(urlFor('javascript:alert(1)'), DISCORD);
  assert.equal(urlFor('data:text/html,<script>alert(1)</script>'), DISCORD);
  assert.equal(urlFor('ftp://example.org/x'), DISCORD);
  assert.equal(urlFor('http://'), DISCORD);
  assert.equal(urlFor('discord.gg/abc'), 'https://discord.gg/abc');
  assert.equal(urlFor(' https://t.me/canal '), 'https://t.me/canal');
  // discord.gg debe ser el dominio, no un trozo de otro.
  withEnv({ SUPPORT_URL: 'https://discord.gg.example.org/x' }, () => assert.equal(supportLink().discord, false));
  withEnv({ SUPPORT_URL: 'https://notdiscord.gg/x' }, () => assert.equal(supportLink().discord, false));
  withEnv({ SUPPORT_URL: 'https://www.discord.com/invite/x' }, () => assert.equal(supportLink().discord, true));
});

// ------------------------------------------------- Controles de /configure

test('/configure: hay un control por cada filtro, orden, tamaño, idioma y región', () => {
  const html = withEnv({}, () => configure());
  for (const key of filters.FILTER_KEYS) {
    assert.equal(count(html, `data-group="hide" data-key="${key}"`), 1, `filtro ${key}`);
  }
  for (const key of filters.SORT_KEYS) {
    assert.equal(count(html, `data-group="sort" data-value="${key}"`), 1, `orden ${key}`);
  }
  for (const gb of filters.SIZE_OPTIONS) {
    assert.equal(count(html, `data-group="maxSize" data-value="${gb}"`), 1, `tamaño ${gb}`);
  }
  for (const { code } of userConfig.LANG_OPTIONS) {
    assert.equal(count(html, `data-group="lang" data-value="${code}"`), 1, `idioma ${code}`);
  }
  for (const { code } of userConfig.REGION_OPTIONS) {
    assert.equal(count(html, `data-group="region" data-value="${code}"`), 1, `región ${code}`);
  }
  assert.match(html, /data-preset="all"/);
  // El botón «Recomendado» dice con palabras lo que oculta: si cambia la
  // lista, hay que cambiar también su texto.
  assert.match(html, /data-preset="recommended"[^>]*>(?:<svg[\s\S]*?<\/svg>)? ?Recomendado: sin CAM, screener ni 3D</);
  assert.deepEqual(filters.RECOMMENDED_HIDE, ['cam', 'scr', '3d']);
  // De serie no se oculta nada: todas las casillas de filtro nacen marcadas.
  assert.equal(count(html, 'checked data-group="hide"'), filters.FILTER_KEYS.length);
  // Solo una opción de cada selector nace pulsada.
  for (const group of ['lang', 'region', 'sort', 'maxSize']) {
    const pressed = html.match(new RegExp(`data-group="${group}"[^>]*aria-pressed="true"`, 'g')) || [];
    assert.equal(pressed.length, 1, `grupo ${group}`);
  }
  // Los idiomas con otro alfabeto llevan su nombre en español para buscarlos.
  assert.match(html, /data-search="日本語 Japonés ja"/);
  assert.match(html, /data-search="Nicaragua NI"/);
});

test('/configure: el idioma y la región de partida son los del despliegue', () => {
  const start = (env) => {
    const html = withEnv(env, () => configure());
    return {
      html,
      lang: html.match(/const DEFAULT_LANG = "([^"]*)";/)[1],
      region: html.match(/const DEFAULT_REGION = "([^"]*)";/)[1],
    };
  };
  const br = start({ TMDB_LANGUAGE: 'pt-BR', WATCH_REGION: 'br' });
  assert.equal(br.lang, 'pt-BR');
  assert.equal(br.region, 'BR');
  assert.match(br.html, /data-group="lang" data-value="pt-BR"[^>]*aria-pressed="true"/);
  assert.match(br.html, /data-group="region" data-value="BR"[^>]*aria-pressed="true"/);
  assert.match(br.html, /id="langName">Português \(Brasil\)</);
  assert.match(br.html, /id="regionName">Brasil</);
  // Sin variables: español y Nicaragua. Un idioma que no está en la lista cae a español.
  assert.deepEqual([start({}).lang, start({}).region], ['es', 'NI']);
  assert.equal(start({ TMDB_LANGUAGE: 'xx-YY' }).lang, 'es');
  // Con el idioma del despliegue marcado, no tocar nada instala el manifest general.
  const untouched = runConfigure({ env: { TMDB_LANGUAGE: 'pt-BR', WATCH_REGION: 'BR' } });
  assert.equal(untouched.isDefault, true);
  assert.equal(untouched.url, `${ORIGIN}/manifest.json`);
});

test('/configure: el aviso de región de respaldo nombra las del despliegue', () => {
  assert.match(withEnv({}, () => configure()), /México y luego Estados Unidos como respaldo/);
  assert.match(withEnv({ WATCH_REGION_FALLBACK: 'es' }, () => configure()), /usa <strong>España como respaldo/);
  assert.equal(withEnv({ WATCH_REGION_FALLBACK: ',' }, () => configure()).includes('como respaldo'), false);
});

test('/configure: el contador de catálogos cuenta lo mismo que el manifest', () => {
  const html = withEnv({}, () => configure());
  const weights = JSON.parse(html.match(/const WEIGHTS = (\{.*?\});\n/)[1]);
  const total = (cfg) =>
    cfg.base.reduce((n, key) => n + weights.base[key], 0)
    + cfg.platforms.length * weights.platform
    + cfg.studios.length * weights.studio;
  const everything = { platforms: PLATFORM_KEYS, studios: STUDIO_KEYS, base: userConfig.BASE_KEYS };
  assert.equal(total(everything), buildDefs(null).length);
  for (const cfg of [
    { platforms: ['netflix', 'hulu'], studios: ['marvel'], base: ['tendencias', 'generos_series'] },
    { platforms: [], studios: [], base: ['tvmaze_hoy'] },
    { platforms: PLATFORM_KEYS.slice(0, 7), studios: STUDIO_KEYS.slice(3), base: [] },
  ]) {
    assert.equal(total(cfg), buildDefs(cfg).length, JSON.stringify(cfg));
  }
  // La portada anuncia ese mismo total.
  const landing = withEnv({}, () => home());
  assert.match(landing, new RegExp(`<b>${buildDefs(null).length}</b> catálogos`));
  assert.match(landing, new RegExp(`<b>${PLATFORMS.length}</b> plataformas`));
  assert.match(landing, new RegExp(`<b>${STUDIOS.length}</b> estudios`));
  assert.match(landing, new RegExp(`<b>${filters.FILTER_KEYS.length}</b> filtros de streams`));
  assert.match(landing, new RegExp(`<b>${userConfig.LANG_OPTIONS.length}</b> idiomas`));
  assert.match(landing, new RegExp(`<b>${userConfig.REGION_OPTIONS.length}</b> regiones`));
});

// ------------------------------------------- Script de /configure (en vm)

test('/configure: sin tocar nada se instala el manifest general', () => {
  const first = runConfigure();
  assert.equal(first.isDefault, true);
  assert.equal(first.url, `${ORIGIN}/manifest.json`);
  assert.deepEqual(first.hide, []);
  assert.equal(first.sort, filters.DEFAULT_SORT);
  assert.equal(first.maxSize, '0');
  // El borrador guarda también los filtros.
  assert.deepEqual([first.saved.hide, first.saved.sort, first.saved.maxSize], [[], filters.DEFAULT_SORT, 0]);
});

test('/configure: los filtros viajan en la URL personal y el servidor los entiende igual', () => {
  const run = runConfigure({
    actions: "state.hide = new Set(RECOMMENDED_HIDE); state.sort = 'quality'; state.maxSize = '10'; state.region = 'MX'; state.lang = 'es-MX'; state.platforms.delete('hulu');",
  });
  assert.equal(run.isDefault, false);
  assert.ok(run.segment, `URL personal esperada: ${run.url}`);
  assert.ok(run.segment.length <= userConfig.MAX_CONFIG_SEGMENT, `segmento de ${run.segment.length} caracteres`);
  const cfg = decode(run.segment);
  assert.ok(cfg, 'el servidor debe decodificar la URL que genera la página');
  assert.deepEqual([...cfg.hide].sort(), [...filters.RECOMMENDED_HIDE].sort());
  assert.equal(cfg.sort, 'quality');
  assert.equal(cfg.maxSize, 10);
  assert.equal(cfg.region, 'MX');
  assert.equal(cfg.lang, 'es-MX');
  assert.equal(cfg.platforms.includes('hulu'), false);
  assert.equal(cfg.platforms.length, PLATFORM_KEYS.length - 1);
  assert.deepEqual(cfg.streams, PROVIDER_KEYS);
  // Navegador y servidor escriben la misma URL para la misma selección: al
  // reabrir /configure desde Stremio no aparece una "tercera" configuración.
  assert.equal(userConfig.encodeConfig(cfg), run.segment);

  // Un solo filtro basta para que la URL sea personal; los demás campos de
  // filtros no ocupan sitio si siguen en su valor de serie.
  const one = runConfigure({ actions: "state.hide.add('cam');" });
  const raw = JSON.parse(Buffer.from(one.segment, 'base64url').toString('utf8'));
  assert.deepEqual(raw.hide, ['cam']);
  assert.equal('sort' in raw, false);
  assert.equal('maxSize' in raw, false);
  // Lo mismo con solo el orden o solo el tamaño.
  assert.equal(decode(runConfigure({ actions: "state.sort = 'size';" }).segment).sort, 'size');
  assert.equal(decode(runConfigure({ actions: "state.maxSize = '5';" }).segment).maxSize, 5);
});

test('/configure: abierto desde Stremio carga los filtros instalados y reproduce la misma URL', () => {
  const segment = userConfig.encodeConfig({
    lang: 'en', region: 'US', platforms: ['netflix', 'max'], studios: [], base: ['tendencias'], streams: ['knaben', 'yts'],
    hide: ['cam', '3d', 'av1'], sort: 'size', maxSize: 20,
  });
  const initialCfg = decode(segment);
  // Un borrador distinto en el navegador no debe pisar lo instalado.
  const run = runConfigure({ initialCfg, draft: { lang: 'fr', hide: ['4k'], sort: 'quality', maxSize: 2 } });
  assert.deepEqual(run.hide.sort(), ['3d', 'av1', 'cam']);
  assert.equal(run.sort, 'size');
  assert.equal(run.maxSize, '20');
  assert.equal(run.lang, 'en');
  assert.equal(run.region, 'US');
  assert.deepEqual(run.platforms, ['netflix', 'max']);
  assert.equal(run.segment, segment);

  // Una instalación anterior a los filtros (URL antigua) llega sin ellos.
  const old = decode(Buffer.from(JSON.stringify({ lang: 'es', region: 'MX', platforms: ['netflix'] })).toString('base64url'));
  const legacy = runConfigure({ initialCfg: old });
  assert.deepEqual(legacy.hide, []);
  assert.equal(legacy.sort, filters.DEFAULT_SORT);
  assert.equal(legacy.maxSize, '0');
  assert.equal(decode(legacy.segment).region, 'MX');
});

test('/configure: el borrador guardado recupera los filtros y descarta lo que no vale', () => {
  const good = runConfigure({ draft: { lang: 'ja', region: 'JP', hide: ['cam', 'hdr'], sort: 'quality', maxSize: 5 } });
  assert.deepEqual(good.hide, ['cam', 'hdr']);
  assert.equal(good.sort, 'quality');
  assert.equal(good.maxSize, '5');
  assert.equal(good.lang, 'ja');
  assert.equal(good.region, 'JP');
  assert.deepEqual([good.saved.hide, good.saved.sort, good.saved.maxSize], [['cam', 'hdr'], 'quality', 5]);

  // Claves desconocidas, tipos raros y números fuera de rango.
  const bad = runConfigure({ draft: { lang: 'klingon', region: 'ZZ', hide: ['cam', 'nope', 7], sort: 'azar', maxSize: -3 } });
  assert.deepEqual(bad.hide, ['cam']);
  assert.equal(bad.sort, filters.DEFAULT_SORT);
  assert.equal(bad.maxSize, '0');
  assert.equal(bad.lang, 'es');
  assert.equal(bad.region, 'NI');
  assert.deepEqual(runConfigure({ draft: { hide: 'cam' } }).hide, []);
  assert.equal(runConfigure({ draft: { maxSize: 99999 } }).maxSize, String(filters.MAX_SIZE_GB));
  assert.equal(runConfigure({ draft: { maxSize: '7.9' } }).maxSize, '7');
  assert.equal(runConfigure({ draft: { maxSize: 'mucho' } }).maxSize, '0');

  // Borrador de antes de existir los filtros: nada oculto y sigue siendo el manifest general.
  const legacy = runConfigure({ draft: { lang: 'es', region: 'NI', streams: PROVIDER_KEYS, knownStreams: PROVIDER_KEYS } });
  assert.deepEqual(legacy.hide, []);
  assert.equal(legacy.isDefault, true);
});

test('/configure: el tamaño que acepta la página es el que acepta el servidor', () => {
  for (const value of [0, 1, 5, 50, 1000, 1001, 5000, -1, 2.7, '12', 'x', null]) {
    const client = runConfigure({ draft: { maxSize: value } }).maxSize;
    assert.equal(client, String(filters.normalizeMaxSize(value)), `maxSize ${JSON.stringify(value)}`);
  }
});

// ------------------------------------------------------- HTML de las páginas

test('web: los enlaces internos apuntan a secciones que existen', () => {
  withEnv({}, () => {
    const pages = { '/': home(), '/configure': configure() };
    const idsOf = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const ids = { '/': idsOf(pages['/']), '/configure': idsOf(pages['/configure']) };
    for (const [path, html] of Object.entries(pages)) {
      // Sin ids repetidos: un ancla o un getElementById ambiguo falla en silencio.
      const all = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
      assert.deepEqual(all.filter((id, i) => all.indexOf(id) !== i), [], `${path}: ids repetidos`);
      for (const [, href] of html.matchAll(/href="([^"]*#[^"]*)"/g)) {
        const [target, hash] = href.split('#');
        const page = target === '' ? path : target;
        assert.ok(ids[page], `${path}: enlace a una página desconocida: ${href}`);
        assert.ok(ids[page].has(hash), `${path}: ${href} no lleva a ninguna sección`);
      }
    }
    // El script de /configure solo busca ids que la página tiene.
    const script = pages['/configure'].match(/<script>([\s\S]*?)<\/script>/)[1];
    const wanted = [...script.matchAll(/(?:getElementById|setText|showSelected)\('([^']+)'/g)].map((m) => m[1]);
    assert.ok(wanted.length >= 10, `solo ${wanted.length} ids en el script`);
    for (const id of wanted) assert.ok(ids['/configure'].has(id), `el script busca #${id} y no existe`);
  });
});

test('web: instalar y copiar usan la dirección desde la que se sirve la página', () => {
  withEnv({}, () => {
    const landing = home();
    assert.equal(count(landing, 'href="stremio://addon.example/manifest.json"') >= 3, true);
    assert.match(landing, /id="manifestUrl"[^>]*>https:\/\/addon\.example\/manifest\.json</);
    assert.match(landing, /id="copyManifest"[^>]*data-copy="https:\/\/addon\.example\/manifest\.json"/);
    // /configure: tres botones de instalar; el script les pone la URL personal.
    const conf = configure();
    const markup = conf.replace(/<script>[\s\S]*?<\/script>/, '');
    assert.equal(count(markup, ' data-install'), 3);
    assert.match(conf, /querySelectorAll\('\[data-install\]'\)/);
    assert.match(conf, /id="copyBtn"/);
    assert.match(conf, /id="resetBtn"/);
  });
});

test('web: ni la cabecera Host ni los datos de TMDB pueden inyectar HTML', () => {
  const evil = 'x"><script>alert(1)</script>';
  const data = {
    results: [{
      title: '<img src=x onerror=alert(2)>',
      name: '<img src=x onerror=alert(2)>',
      poster_path: '/a.jpg" onload="alert(3)',
      release_date: '2026"><b>',
      first_air_date: '2026"><b>',
      vote_average: 7.5,
    }],
  };
  withEnv({}, () => {
    const pages = [
      renderHome({ origin: `https://${evil}`, host: evil, trendingMovies: data, trendingSeries: data, trendingAnime: data, apiStatus: { tmdb: true } }),
      renderConfigure({ origin: `https://${evil}`, host: evil, trendingMovies: data, trendingSeries: data }),
    ];
    for (const html of pages) {
      assert.equal(html.includes('<script>alert(1)'), false, 'Host sin escapar');
      assert.equal(html.includes('<img src=x'), false, 'título sin escapar');
      assert.equal(html.includes('" onload="alert(3)'), false, 'póster sin escapar');
      assert.equal(html.includes('2026"><b>'), false, 'año sin escapar');
      assert.match(html, /&lt;img src=x onerror=alert\(2\)&gt;/);
    }
  });
  // La config instalada entra en un <script>: no puede cerrarlo.
  const html = withEnv({}, () => configure({ initialCfg: { lang: 'es', region: '</script><script>alert(4)</script>', hide: [] } }));
  assert.equal(html.includes('</script><script>alert(4)'), false);
  assert.equal(count(html, '<script'), 1);
});

// ------------------------------------------------------------ Piezas sueltas

test('iconos: un nombre desconocido falla en vez de dejar un hueco', () => {
  assert.throws(() => icon('no-existe'), /Icono desconocido/);
  assert.throws(() => iconMask('no-existe'), /Icono desconocido/);
  assert.ok(ICON_NAMES.includes('discord'));
  for (const name of ICON_NAMES) {
    const svg = icon(name, 20);
    assert.match(svg, /^<svg class="ic[^"]*" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"/, name);
    assert.match(svg, /<\/svg>$/, name);
    // Como imagen de CSS va dentro de url("…"): sin comillas dobles ni «#» sueltos.
    const inner = iconMask(name, { color: '#f87171' }).replace(/^url\("/, '').replace(/"\)$/, '');
    assert.match(inner, /^data:image\/svg\+xml;charset=utf-8,%3Csvg /, name);
    assert.equal(/["#<>]/.test(inner), false, name);
    assert.match(inner, /%23f87171/, name);
  }
});

test('pósters: las miniaturas piden a TMDB el tamaño pequeño', () => {
  assert.equal(posterThumb('https://image.tmdb.org/t/p/w500/abc.jpg'), 'https://image.tmdb.org/t/p/w342/abc.jpg');
  assert.equal(posterThumb('https://image.tmdb.org/t/p/w780/abc.jpg'), 'https://image.tmdb.org/t/p/w342/abc.jpg');
  // Otros orígenes y tamaños sin número ("original") se dejan como llegan.
  assert.equal(posterThumb('https://example.org/t/p/w500/abc.jpg'), 'https://example.org/t/p/w500/abc.jpg');
  assert.equal(posterThumb('https://image.tmdb.org/t/p/original/abc.jpg'), 'https://image.tmdb.org/t/p/original/abc.jpg');
  assert.equal(posterThumb(''), '');
  assert.equal(posterThumb(undefined), '');
  // Y las páginas las usan: ningún póster de rail a tamaño grande.
  const html = withEnv({}, () => home());
  assert.match(html, /class="poster"><img src="https:\/\/image\.tmdb\.org\/t\/p\/w342\//);
  assert.equal(/class="poster"><img src="https:\/\/image\.tmdb\.org\/t\/p\/w(500|780)\//.test(html), false);
});
