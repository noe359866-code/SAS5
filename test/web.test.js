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
const { JSDOM } = require('jsdom');

const config = require('../lib/config');
const { renderHome } = require('../lib/homePage');
const { renderConfigure } = require('../lib/configurePage');
const userConfig = require('../lib/userConfig');
const filters = require('../lib/streamFilters');
const { PROVIDER_KEYS } = require('../lib/streams');
const { PLATFORMS, STUDIOS, PLATFORM_KEYS, STUDIO_KEYS, buildDefs } = require('../lib/catalogs');
const { icon, iconMask, ICON_NAMES } = require('../lib/icons');
const { posterThumb } = require('../lib/rails');
const { supportLink, donationLink, donateCardHtml } = require('../lib/layout');
const { LANGUAGES: WEB_LANGUAGES, PHRASES: WEB_PHRASES, TRANSLATIONS: WEB_TRANSLATIONS, WEB_I18N_BOOTSTRAP, WEB_I18N_SCRIPT, detectWebLanguage } = require('../lib/webI18n');

const ORIGIN = 'https://addon.example';
const HOST = 'addon.example';
const DISCORD = 'https://discord.gg/J6byqsRUfu';

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
const configureScript = (html) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1]).find((script) => script.includes('const PLATFORMS ='));

/**
 * Arranca el script de /configure hasta antes de tocar el DOM (constantes,
 * estado, guardar/restaurar y URL personal), ejecuta `actions` como si el
 * usuario pulsara y devuelve el estado y la URL que se instalaría.
 */
function runConfigure({ env = {}, draft = null, initialCfg, actions = '' } = {}) {
  const html = withEnv(env, () => configure({ initialCfg }));
  const script = configureScript(html);
  assert.ok(script, 'no se encuentra el script del configurador');
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

// ---------------------------------------------------------- Refresh visual

test('la portada y el configurador comparten la identidad de RamdonLatam y el diseño responsive', () => {
  const homeHtml = withEnv({}, () => home());
  const configureHtml = withEnv({}, () => configure());
  assert.match(homeHtml, /<h1>Tu próxima historia\.<em>A tu manera\.<\/em><\/h1>/);
  assert.match(homeHtml, /class="stats hero-stats"/);
  assert.match(homeHtml, /@media \(max-width: 700px\)/);
  assert.match(configureHtml, /<h1>Tu Stremio, <em>a tu gusto\.<\/em><\/h1>/);
  assert.match(configureHtml, /Refinamiento visual del configurador/);
  assert.match(configureHtml, /@media \(max-width: 760px\)/);
  for (const [label, html] of [['portada', homeHtml], ['configure', configureHtml]]) {
    // Azul noche de la marca, SF primero y barra translúcida con blur.
    assert.match(html, /--bg: #060f1a;/, label);
    assert.match(html, /--card: #0e2337;/, label);
    assert.match(html, /<meta name="theme-color" content="#060f1a" \/>/, label);
    assert.match(html, /-apple-system,BlinkMacSystemFont,'SF Pro Display'/, label);
    assert.match(html, /backdrop-filter: saturate\(180%\) blur\(20px\)/, label);
    // Botones y controles de píldora; la acción principal es el naranja de marca.
    assert.match(html, /border-radius: 980px/, label);
    assert.match(html, /\.btn-primary \{[^}]*color: #10283d;/, label);
    assert.match(html, /--grad: linear-gradient\(180deg,#ffa552 0%,#f5821f 52%,#e8680f 100%\)/, label);
    assert.match(html, /Ramdon<i>Latam<\/i>/, label);
    // El icono de la marca es el nuevo: master vectorial + PNG del Worker.
    assert.match(html, /<img src="\/assets\/logo.png"[^>]*width="32" height="32"/, label);
    assert.match(html, /<link rel="icon" href="\/assets\/favicon.svg" type="image\/svg\+xml" \/>/, label);
    // El azul de sistema de la piel anterior y el violeta→cian no vuelven.
    assert.equal(html.includes('rgba(124,92,255'), false, `${label}: queda violeta de marca`);
    assert.equal(html.includes('2997ff'), false, `${label}: queda azul de sistema`);
    // En la configuración predeterminada solo está el enlace externo de soporte.
    assert.equal((html.match(/<a class="nav-ext" /g) || []).length, 1, label);
    assert.match(html, /\.nav-fit-2 \.nav-links \.nav-ext \{ display: none; \}/, label);
    // Los estantes llevan su marco (.rail-view), donde el script cuelga las flechas.
    assert.match(html, /<div class="rail-view"><div class="rail-scroll" data-autoscroll="1">/, label);
  }
  // La portada presenta una selección editorial de tres pósters.
  assert.match(homeHtml, /class="editorial-art"/);
  assert.match(homeHtml, /class="editorial-posters"/);
  assert.match(homeHtml, /id="catalogSearch"/);
  assert.match(homeHtml, /<meta property="og:image" content="https:\/\/addon\.example\/assets\/og-cover\.png" \/>/);
});


// ---------------------------------------------------------------- Soporte

test('soporte: el Discord sale en la barra, en la tarjeta y en el pie de las dos páginas', () => {
  withEnv({}, () => {
    for (const [label, html] of [['portada', home()], ['configure', configure()]]) {
      // Enlace de la barra, botón de icono (móvil), tarjeta y pie.
      assert.equal(count(html, `href="${DISCORD}" target="_blank" rel="noopener noreferrer"`), 4, label);
      assert.match(html, /Unirme al Discord/, label);
      assert.match(html, /Discord de RamdonLatam/, label);
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
      // Sin marca de Discord en el contenido visible cuando el enlace no lo es.
      const visibleHtml = html.replace(/<script>[\s\S]*?<\/script>/g, '');
      assert.equal(/Unirme al Discord|Estamos en Discord/.test(visibleHtml), false, label);
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

// ------------------------------------------------------------ Donaciones

test('donaciones: una cuenta Ko-fi solo aparece si el despliegue la configura', () => {
  withEnv({}, () => {
    assert.equal(config.kofiUrl, '');
    assert.equal(donationLink().enabled, false);
  });
  withEnv({ KOFI_USERNAME: 'amiga' }, () => {
    assert.equal(config.kofiUrl, 'https://ko-fi.com/amiga');
    assert.equal(donationLink().name, 'Ko-fi');
    assert.equal(donationLink().iconName, 'kofi');
    for (const html of [home(), configure()]) {
      assert.equal(count(html, 'href="https://ko-fi.com/amiga"'), 4);
      assert.match(html, /Donar con Ko-fi/);
    }
  });
});

test('donaciones: KOFI_USERNAME acepta el usuario o la URL y solo enlaza a ko-fi.com', () => {
  const urlFor = (value) => withEnv({ KOFI_USERNAME: value }, () => config.kofiUrl);
  assert.equal(urlFor(undefined), '');
  assert.equal(urlFor('   '), '');
  assert.equal(urlFor('amiga'), 'https://ko-fi.com/amiga');
  assert.equal(urlFor('@amiga'), 'https://ko-fi.com/amiga');
  assert.equal(urlFor('ko-fi.com/amiga'), 'https://ko-fi.com/amiga');
  assert.equal(urlFor('https://www.ko-fi.com/amiga/'), 'https://ko-fi.com/amiga');
  // off y cualquier valor que no sea de Ko-fi desactivan las donaciones, para
  // que un error de tipeo no enlace a la página de otra persona.
  for (const value of [
    'off', 'OFF', 'none', 'disabled', '0', 'false',
    'https://paypal.me/amiga', 'https://ko-fi.com.evil.example/x', 'javascript:alert(1)',
    'con espacios', 'a'.repeat(51), '<img src=x>', 'https://ko-fi.com/a" onload="alert(1)',
  ]) {
    assert.equal(urlFor(value), '', `KOFI_USERNAME=${value}`);
  }
});

test('donaciones: con KOFI_USERNAME=off no queda rastro en la web y el soporte sigue igual', () => {
  withEnv({ KOFI_USERNAME: 'off' }, () => {
    assert.equal(config.kofiEnabled, false);
    assert.equal(donationLink().enabled, false);
    assert.equal(donateCardHtml(), '');
    for (const [label, html] of [['portada', home()], ['configure', configure()]]) {
      // Sin script (el diccionario i18n siempre lleva las frases) ni estilos
      // (las clases de la tarjeta quedan definidas aunque no se use).
      const markup = html.replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<style>[\s\S]*?<\/style>/g, '');
      assert.equal(markup.includes('ko-fi'), false, label);
      assert.equal(markup.includes('Donar'), false, label);
      assert.equal(markup.includes('nav-donate'), false, label);
      assert.equal(markup.includes('btn-kofi'), false, label);
      assert.equal(markup.includes('pay-badge'), false, label);
      assert.equal(markup.includes('support donate'), false, label);
      // El Discord conserva sus cuatro enlaces de siempre.
      assert.equal(count(html, `href="${DISCORD}" target="_blank" rel="noopener noreferrer"`), 4, label);
    }
  });
  // Otra página cambia el enlace en toda la web y borra el usuario por defecto.
  withEnv({ KOFI_USERNAME: 'amiga' }, () => {
    for (const html of [home(), configure()]) {
      assert.equal(count(html, 'href="https://ko-fi.com/amiga"'), 4);
    }
  });
});

test('donaciones: las frases nuevas se traducen a los seis idiomas de la web', () => {
  const sources = [
    'Donar',
    'Donar en Ko-fi',
    'Donar con Ko-fi',
    '¿Te sirve RamdonLatam? Invítame un café',
  ];
  for (const source of sources) {
    assert.ok(WEB_PHRASES.some((row) => row[0] === source), `falta la frase «${source}»`);
    for (const language of WEB_LANGUAGES) {
      assert.ok(WEB_TRANSLATIONS[language][source], `${language}: ${source}`);
    }
  }
  const cardText = WEB_PHRASES.find((row) => row[0].startsWith('El addon es gratis y no tiene anuncios'));
  assert.ok(cardText && cardText.every((value) => value.length > 40), 'el texto de la tarjeta va traducido entero');
});

// ------------------------------------------------- Controles de /configure

test('/configure: idioma latino fijo y controles para filtros, orden, tamaño y región', () => {
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
  assert.equal(count(html, 'data-group="lang" data-value='), 0, 'el idioma de contenido no es configurable');
  assert.match(html, /id="langCode">es-MX/);
  assert.match(html, /id="langName">Español latino/);
  assert.match(html, /Fijo para todos los catálogos, fichas y streams/);
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
  // Solo una opción de cada selector configurable nace pulsada.
  for (const group of ['region', 'sort', 'maxSize']) {
    const pressed = html.match(new RegExp(`data-group="${group}"[^>]*aria-pressed="true"`, 'g')) || [];
    assert.equal(pressed.length, 1, `grupo ${group}`);
  }
  // Los idiomas con otro alfabeto llevan su nombre en español para buscarlos.
  assert.match(html, /Español latino/);
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
  const br = start({ TMDB_LANGUAGE: 'en', WATCH_REGION: 'br' });
  assert.equal(br.lang, 'es-MX');
  assert.equal(br.region, 'BR');
  assert.doesNotMatch(br.html, /data-group="lang" data-value=/);
  assert.match(br.html, /class="code" id="langCode">es-MX</);
  assert.match(br.html, /data-group="region" data-value="BR"[^>]*aria-pressed="true"/);
  assert.match(br.html, /id="langName">Español latino</);
  assert.match(br.html, /id="regionName">Brasil</);
  // El idioma editorial es fijo aunque el entorno solicite inglés.
  assert.deepEqual([start({}).lang, start({}).region], ['es-MX', 'NI']);
  assert.equal(start({ TMDB_LANGUAGE: 'xx-YY' }).lang, 'es-MX');
  // Con el idioma fijo marcado, no tocar nada instala el manifest general.
  const untouched = runConfigure({ env: { TMDB_LANGUAGE: 'en', WATCH_REGION: 'BR' } });
  assert.equal(untouched.isDefault, true);
  assert.equal(untouched.url, `${ORIGIN}/manifest.json`);
});

test('/configure: el aviso de región de respaldo nombra las del despliegue', () => {
  const visible = (env) => withEnv(env, () => configure()).replace(/<script>[\s\S]*?<\/script>/g, '');
  assert.match(visible({}), /México y luego Estados Unidos como respaldo/);
  assert.match(visible({ WATCH_REGION_FALLBACK: 'es' }), /usa <strong>España como respaldo/);
  assert.equal(visible({ WATCH_REGION_FALLBACK: ',' }).includes('como respaldo'), false);
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
  // La portada anuncia el mismo total con métricas visuales más breves.
  const landing = withEnv({}, () => home());
  assert.match(landing, new RegExp(`<b>${buildDefs(null).length}</b><span>catálogos</span>`));
  assert.match(landing, new RegExp(`<b>${PLATFORMS.length}</b><span>plataformas</span>`));
  assert.equal(landing.includes('<span>estudios</span>'), false);
  assert.match(landing, new RegExp(`<b>${filters.FILTER_KEYS.length}</b><span>filtros</span>`));
  assert.match(landing, /<b>es-MX<\/b><span>español latino<\/span>/);
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
    const script = configureScript(pages['/configure']);
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
    const markup = conf.replace(/<script>[\s\S]*?<\/script>/g, '');
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
  assert.equal(count(html, '<script'), 3); // bootstrap de idioma, configurador e i18n local
});

// ------------------------------------------------------------ Piezas sueltas

test('iconos: un nombre desconocido falla en vez de dejar un hueco', () => {
  assert.throws(() => icon('no-existe'), /Icono desconocido/);
  assert.throws(() => iconMask('no-existe'), /Icono desconocido/);
  assert.ok(ICON_NAMES.includes('discord'));
  // Marcas de las donaciones: Ko-fi y PayPal (Simple Icons, figura rellena).
  assert.ok(ICON_NAMES.includes('kofi') && ICON_NAMES.includes('paypal'));
  for (const brand of ['kofi', 'paypal']) assert.match(icon(brand, 18), /class="ic ic-fill"/);
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
  // w185: la tarjeta mide ~170 px CSS y en pantallas 2× necesita 340 px.
  // w500 pesaba ~40 KB por título frente a ~10 KB.
  assert.equal(posterThumb('https://image.tmdb.org/t/p/w500/abc.jpg'), 'https://image.tmdb.org/t/p/w185/abc.jpg');
  assert.equal(posterThumb('https://image.tmdb.org/t/p/w780/abc.jpg'), 'https://image.tmdb.org/t/p/w185/abc.jpg');
  // Otros orígenes y tamaños sin número ("original") se dejan como llegan.
  assert.equal(posterThumb('https://example.org/t/p/w500/abc.jpg'), 'https://example.org/t/p/w500/abc.jpg');
  assert.equal(posterThumb('https://image.tmdb.org/t/p/original/abc.jpg'), 'https://image.tmdb.org/t/p/original/abc.jpg');
  assert.equal(posterThumb(''), '');
  assert.equal(posterThumb(undefined), '');
  // Y las páginas las usan: ningún póster de rail a tamaño grande.
  const html = withEnv({}, () => home());
  assert.match(html, /class="poster"><img src="https:\/\/image\.tmdb\.org\/t\/p\/w185\//);
  assert.equal(/class="poster"><img src="https:\/\/image\.tmdb\.org\/t\/p\/w(342|500|780)\//.test(html), false);
});

// ------------------------------------------------------------- Web i18n

class I18nTextNode {
  constructor(value, parentElement = null) {
    this.nodeType = 3;
    this.nodeValue = value;
    this.parentElement = parentElement;
  }
}

class I18nElement {
  constructor(tagName = 'div', attrs = {}) {
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.attributes = { ...attrs };
    this.childNodes = [];
    this.parentElement = null;
    this.dataset = {};
    this.listeners = {};
  }
  append(child) {
    child.parentElement = this;
    this.childNodes.push(child);
    return child;
  }
  closest() { return null; }
  matches(selector) { return selector === '[data-sum="idioma"]' && this.dataset.sum === 'idioma'; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  getAttribute(name) { return this.hasAttribute(name) ? this.attributes[name] : null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  querySelector() { return null; }
  get textContent() {
    return this.childNodes.map((child) => child.nodeType === 3 ? child.nodeValue : child.textContent).join('');
  }
  set textContent(value) { this.childNodes = [new I18nTextNode(String(value), this)]; }
}

function runWebI18n({ languages = ['en-US'], language = '', savedLanguage = null } = {}) {
  const root = new I18nElement('html', { 'data-i18n-pending': '' });
  const body = root.append(new I18nElement('body'));
  const text = (value, attrs = {}) => {
    const el = body.append(new I18nElement('p', attrs));
    const node = el.append(new I18nTextNode(value, el));
    return { el, node };
  };
  const heading = text('Tendencias');
  const popular = text('Populares');
  const otherFormats = text('HDTV · DVD · otras');
  const message = text('Gratis y sin cuenta.');
  const counter = text('30 plataformas y 21 estudios');
  const fallback = text('Nicaragua y luego Estados Unidos como respaldo');
  const placeholder = text('', { placeholder: 'Filtrar esta portada…' });
  const meta = body.append(new I18nElement('meta', {
    content: '121 catálogos para Stremio: tendencias, estrenos, top valoradas, por plataforma (Netflix, Disney+, Max, Hulu, AMC+…) y por estudio (Marvel, Pixar, Ghibli…). Streams con filtros (oculta CAM, 3D, 4K…), 18 idiomas y 44 regiones. Gratis y sin cuenta.',
  }));
  const catalogLanguage = body.append(new I18nElement('span'));
  catalogLanguage.id = 'langCode';
  catalogLanguage.textContent = 'es';
  const catalogLanguageName = body.append(new I18nElement('span'));
  catalogLanguageName.id = 'langName';
  catalogLanguageName.textContent = 'Español';
  const catalogRegion = body.append(new I18nElement('span'));
  catalogRegion.id = 'regionCode';
  catalogRegion.textContent = 'NI';
  const catalogRegionName = body.append(new I18nElement('span'));
  catalogRegionName.id = 'regionName';
  catalogRegionName.textContent = 'Nicaragua';
  const summary = body.append(new I18nElement('span'));
  summary.dataset.sum = 'idioma';
  summary.textContent = 'Español · NI';
  const select = body.append(new I18nElement('select'));
  select.value = 'auto';
  const autoOption = select.append(new I18nElement('option'));
  autoOption.textContent = 'Auto';
  const observerCallbacks = [];
  const document = {
    documentElement: root,
    ready: null,
    querySelector(selector) { return selector === '[data-web-language]' ? select : null; },
    querySelectorAll(selector) { return selector === '[data-sum="idioma"]' ? [summary] : []; },
    getElementById(id) {
      return ({ langCode: catalogLanguage, langName: catalogLanguageName, regionCode: catalogRegion, regionName: catalogRegionName })[id] || null;
    },
    addEventListener(name, callback) { if (name === 'DOMContentLoaded') this.ready = callback; },
  };
  const storage = { value: savedLanguage };
  const context = {
    document,
    window: { setTimeout() {} },
    navigator: { languages, language },
    localStorage: {
      getItem() { return storage.value; },
      setItem(_key, value) { storage.value = value; },
      removeItem() { storage.value = null; },
    },
    MutationObserver: class {
      constructor(callback) { observerCallbacks.push(callback); }
      observe() {}
    },
    Intl,
  };
  vm.runInNewContext(WEB_I18N_SCRIPT, context);
  document.ready();
  return {
    root, body, heading, popular, otherFormats, message, counter, fallback, placeholder, meta, summary,
    select, autoOption, storage, observer: observerCallbacks[0],
  };
}

test('idioma de interfaz: negocia entre las seis opciones, con español como fallback', () => {
  assert.deepEqual(WEB_LANGUAGES, ['es', 'en', 'pt', 'fr', 'de', 'it']);
  assert.equal(detectWebLanguage(['ja-JP', 'pt-BR']), 'pt');
  assert.equal(detectWebLanguage(['fr-CA', 'en-US']), 'fr');
  assert.equal(detectWebLanguage(['de_DE']), 'de');
  assert.equal(detectWebLanguage(['nl-NL', 'xx']), 'es');
  assert.equal(detectWebLanguage([]), 'es');
  assert.ok(WEB_PHRASES.every((row) => row.length === 6), 'cada frase tiene una versión por idioma');
  assert.equal(new Set(WEB_PHRASES.map((row) => row[0])).size, WEB_PHRASES.length, 'no hay frases fuente repetidas');
  assert.deepEqual(Object.keys(WEB_TRANSLATIONS), WEB_LANGUAGES);
  for (const language of WEB_LANGUAGES) assert.ok(Object.keys(WEB_TRANSLATIONS[language]).length > 200);
});



test('idioma de interfaz: español predeterminado y preferencia guardada sin cambiar la config del catálogo', () => {
  const fallback = runWebI18n({ languages: ['ja-JP'] });
  assert.equal(fallback.root.lang, 'es');
  assert.equal(fallback.heading.node.nodeValue, 'Tendencias');
  assert.equal(fallback.root.hasAttribute('data-i18n-pending'), false);

  const saved = runWebI18n({ languages: ['it-IT'], savedLanguage: 'en' });
  assert.equal(saved.root.lang, 'en');
  assert.equal(saved.heading.node.nodeValue, 'Trending');

  const invalidSaved = runWebI18n({ languages: ['zh-CN'], savedLanguage: 'nl' });
  assert.equal(invalidSaved.root.lang, 'es');

  withEnv({ TMDB_LANGUAGE: 'pt-BR', WATCH_REGION: 'BR' }, () => {
    const html = configure();
    assert.match(html, /<span class="code" id="langCode">es-MX<\/span>/);
    assert.match(html, /<span class="code" id="regionCode">BR<\/span>/);
  });
});

test('idioma de interfaz: ambas páginas incluyen selector accesible y localización local, sin servicios externos', () => {
  const pages = [home(), configure()];
  for (const html of pages) {
    assert.match(html, /<html lang="es">/);
    assert.match(html, /<script>\s*\(function \(\) \{/);
    assert.match(html, /<select data-web-language aria-label="Idioma de la web"/);
    for (const code of ['auto', 'es', 'en', 'pt', 'fr', 'de', 'it']) assert.match(html, new RegExp(`<option value="${code}"`));
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    const bootstrapScript = scripts[0];
    assert.equal(bootstrapScript, WEB_I18N_BOOTSTRAP);
    assert.doesNotThrow(() => new vm.Script(bootstrapScript));
    const bootstrapRoot = new I18nElement('html');
    vm.runInNewContext(bootstrapScript, {
      document: { documentElement: bootstrapRoot },
      navigator: { languages: ['xx-XX', 'pt-BR'], language: 'xx-XX' },
      localStorage: { getItem: () => null },
    });
    assert.equal(bootstrapRoot.lang, 'pt');
    assert.equal(bootstrapRoot.hasAttribute('data-i18n-pending'), true);
    const spanishRoot = new I18nElement('html');
    vm.runInNewContext(bootstrapScript, {
      document: { documentElement: spanishRoot },
      navigator: { languages: ['en-US'], language: 'en-US' },
      localStorage: { getItem: () => 'es' },
    });
    assert.equal(spanishRoot.lang, 'es');
    assert.equal(spanishRoot.hasAttribute('data-i18n-pending'), false);

    const localizationScript = scripts.at(-1);
    assert.doesNotThrow(() => new vm.Script(localizationScript));
    assert.doesNotMatch(bootstrapScript + localizationScript, /\bfetch\s*\(|XMLHttpRequest|geolocation/i);
  }
});

test('/configure: dos selecciones iguales producen exactamente la misma URL', () => {
  // La URL de instalación es la identidad del usuario: si dependiera del orden
  // en que se marcaron las casillas, sus catálogos no se podrían pregenerar.
  const install = (actions) => runConfigure({ actions }).url;
  const a = install(`state.platforms = new Set(['disney','netflix']); state.studios = new Set(['pixar','marvel']);
    state.hide = new Set(['3d','cam']); state.lang = 'es'; state.region = 'NI';`);
  const b = install(`state.platforms = new Set(['netflix','disney']); state.studios = new Set(['marvel','pixar']);
    state.hide = new Set(['cam','3d']); state.lang = 'es'; state.region = 'NI';`);
  assert.equal(a, b);

  // Y el servidor decodifica esa URL a la misma configuración.
  const segment = a.split('/')[3];
  const cfg = decode(segment);
  assert.deepEqual(cfg.platforms, ['netflix', 'disney']);
  assert.deepEqual(cfg.studios, []);
  assert.equal(cfg.lang, 'es-MX');
  assert.equal(cfg.region, 'NI');
});

test('/configure: solo ofrece fuentes que el despliegue realmente consulta', () => {
  const defaults = withEnv({}, () => configure());
  const offered = (html) => [...html.matchAll(/data-group="streams" data-key="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(offered(defaults), ['fanpelis', 'spinflix',
    'cuevanas3', 'allpeliculas', 'lamovie', 'hackstore', 'allcalidad',
    'animeflv', 'animeav1', 'otakustv', 'fuegocine', 'pelisjuanita', 'videoapi']);
  for (const key of PROVIDER_KEYS) assert.ok(defaults.includes(`checked data-group="streams" data-key="${key}"`), key);

  assert.equal(runConfigure().url, `${ORIGIN}/manifest.json`);

  const env = { STREAM_PROVIDERS: 'fanpelis,spinflix,playlatin' };
  assert.deepEqual(offered(withEnv(env, () => configure())), ['fanpelis', 'spinflix']);
  assert.deepEqual(offered(withEnv({ ...env, FANPELIS: 'off' }, () => configure())), ['spinflix']);
  assert.deepEqual(offered(withEnv({ STREAM_PROVIDERS: 'off' }, () => configure())), []);

  const olderConfig = runConfigure({ env: { STREAM_PROVIDERS: 'fanpelis' }, initialCfg: { region: 'MX', streams: ['spinflix'] } });
  assert.deepEqual(decode(olderConfig.segment).streams, [], 'no activa otras fuentes sin permiso');
});

test('/configure: un borrador anterior al retiro no amplía la selección guardada', () => {
  const knownStreams = ['fanpelis', 'flixlatam', 'playlatin', 'spinflix', 'fuegocine', 'animeonlineninja', 'cuevana3', 'gnulahd'];
  const oldDraft = runConfigure({ draft: { knownStreams, streams: ['flixlatam', 'spinflix'] } });
  assert.deepEqual(oldDraft.saved.knownStreams, PROVIDER_KEYS);
  assert.deepEqual(decode(oldDraft.segment).streams, ['spinflix']);
  const disabledDraft = runConfigure({ draft: { knownStreams, streams: [] } });
  assert.deepEqual(decode(disabledDraft.segment).streams, []);
});

test('/configure: el idioma de catálogos se mantiene fijo en español latino', () => {
  const pt = runConfigure({ env: { TMDB_LANGUAGE: 'en', WATCH_REGION: 'BR' }, actions: `state.platforms = new Set(['netflix']);` });
  const cfg = decode(pt.segment);
  assert.equal(cfg.lang, 'es-MX');
  assert.equal(cfg.region, 'BR');
  const es = runConfigure({ actions: `state.platforms = new Set(['netflix']);` });
  assert.equal(decode(es.segment).lang, 'es-MX');
  const other = runConfigure({ actions: `state.platforms = new Set(['netflix']); state.lang = 'en';` });
  assert.equal(decode(other.segment).lang, 'es-MX');
});

test('/configure: la página pregenerada de una región nace con esa región elegida', () => {
  // Es el archivo al que apunta el «Configurar» de Stremio vía _redirects:
  // región correcta y 0 invocaciones del Worker.
  const html = withEnv({ TMDB_LANGUAGE: 'es', WATCH_REGION: 'NI' }, () => configure({ preset: { region: 'MX' } }));
  const script = configureScript(html);
  const cut = script.indexOf('\nfunction setChecks');
  const sandbox = {
    window: { location: { origin: ORIGIN } },
    btoa: (text) => Buffer.from(text, 'binary').toString('base64'),
    localStorage: { getItem: () => null, setItem: () => {} },
  };
  vm.runInNewContext(`${script.slice(0, cut)}\nrestore();globalThis.out = JSON.stringify({ region: state.region, lang: state.lang, url: personalUrl() });`, sandbox);
  const out = JSON.parse(sandbox.out);
  assert.equal(out.region, 'MX');
  assert.equal(out.lang, 'es-MX', 'el idioma es fijo en español latino');

  // El borrador guardado del navegador sigue mandando sobre el preset.
  const draft = { region: 'ES', platforms: ['netflix'], studios: [], base: ['tendencias'], streams: [] };
  const withDraft = runConfigure({ draft, initialCfg: undefined, actions: '' });
  assert.equal(withDraft.region, 'ES');
});

test('pósters: el catálogo del addon usa el tamaño mínimo (w92)', () => {
  // Una fila de Stremio son 20 títulos: a w500 son ~800 KB por fila y a w92
  // ~100 KB. El grande se carga al abrir la ficha.
  const { posterList } = require('../lib/rails');
  assert.equal(posterList('https://image.tmdb.org/t/p/w500/abc.jpg'), 'https://image.tmdb.org/t/p/w92/abc.jpg');
  assert.equal(posterList('https://example.org/t/p/w500/abc.jpg'), 'https://example.org/t/p/w500/abc.jpg');
  const tmdb = require('../lib/tmdb');
  const meta = tmdb.mapTmdbItem({ id: 1, title: 'X', poster_path: '/p.jpg', vote_average: 7 }, 'movie');
  assert.equal(meta.poster, 'https://image.tmdb.org/t/p/w185/p.jpg');
});
