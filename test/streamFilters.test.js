'use strict';

/**
 * Filtros de streams: clasificador por nombre de release, preferencias del
 * usuario (ocultar, tamaño máximo, orden), su viaje dentro de la URL de
 * configuración y el recorrido completo por handleStream y el Worker.
 * Sin red: fetch va simulado.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

delete process.env.TMDB_API_KEY;
delete process.env.TMDB_ACCESS_TOKEN;

const config = require('../lib/config');
const filters = require('../lib/streamFilters');
const userConfig = require('../lib/userConfig');
const core = require('../lib/core');
const { PROVIDER_KEYS } = require('../lib/streams');
const { PLATFORM_KEYS, STUDIO_KEYS } = require('../lib/catalogs');

const originalFetch = global.fetch;
after(() => { global.fetch = originalFetch; });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });

const tagsOf = (name, titles) => filters.classify(name, titles).tags;
const normalize = (raw) => userConfig.normalizeConfig(raw, PLATFORM_KEYS, STUDIO_KEYS, PROVIDER_KEYS);
const decode = (segment) => userConfig.decodeConfig(segment, PLATFORM_KEYS, STUDIO_KEYS, PROVIDER_KEYS);
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

test('filtros: claves únicas, cada una en un grupo conocido y con texto para /configure', () => {
  assert.equal(new Set(filters.FILTER_KEYS).size, filters.FILTER_KEYS.length);
  const groups = filters.FILTER_GROUPS.map((g) => g.key);
  for (const filter of filters.FILTERS) {
    assert.ok(groups.includes(filter.group), filter.key);
    assert.ok(filter.name && filter.hint, filter.key);
  }
  // Lo que pidió el usuario: CAM, 3D, 4K y REMUX se pueden quitar.
  for (const key of ['cam', '3d', '4k', 'remux']) assert.ok(filters.FILTER_KEYS.includes(key), key);
  assert.deepEqual(filters.SORT_KEYS, ['seeders', 'quality', 'size']);
  assert.equal(filters.SIZE_OPTIONS[0], 0);
  for (const key of filters.RECOMMENDED_HIDE) assert.ok(filters.FILTER_KEYS.includes(key), key);
});

test('classify: todo stream lleva un tipo de copia y una resolución', () => {
  const sources = filters.FILTERS.filter((f) => f.group === 'source').map((f) => f.key);
  const resolutions = filters.FILTERS.filter((f) => f.group === 'resolution').map((f) => f.key);
  for (const name of ['', 'cualquier cosa', 'Movie.2024.1080p.WEB-DL.x264', '[Grupo] Serie - 01', null, undefined, 42]) {
    const { tags, quality } = filters.classify(name);
    assert.equal(tags.filter((t) => sources.includes(t)).length, 1, String(name));
    assert.equal(tags.filter((t) => resolutions.includes(t)).length, 1, String(name));
    assert.equal(typeof quality, 'string');
    for (const tag of tags) assert.ok(filters.FILTER_KEYS.includes(tag), tag);
  }
});

test('classify: tipo de copia (WEB, BluRay, REMUX, screener, CAM/TS y el resto)', () => {
  const cases = [
    ['Dune.Part.Two.2024.1080p.WEB-DL.DDP5.1.Atmos.H.264-FLUX', 'web'],
    ['Dune.Part.Two.2024.1080p.AMZN.WEBRip.x264', 'web'],
    ['Show.S01E01.1080p.WEB.h264-GRP', 'web'],
    ['Dune.Part.Two.2024.1080p.BluRay.x264-GRP', 'bluray'],
    ['Dune (2021) [1080p] [BluRay] [x264] [5.1]', 'bluray'], // nombre compuesto de YTS
    ['Movie.2019.BDRip.x264', 'bluray'],
    ['Movie.2019.BRRip.XviD', 'bluray'],
    ['[Judas] Jujutsu Kaisen - S01 [BD 1080p][HEVC x265 10bit]', 'bluray'],
    ['Dune Part Two 2024 2160p UHD BluRay REMUX DV HDR10+ TrueHD 7.1', 'remux'],
    ['Movie.2019.1080p.BDRemux.AVC', 'remux'],
    ['Pelicula 4KUHDremux 2160p', 'remux'],
    ['Movie.2019.BDMV.AVC.DTS-HD', 'remux'],
    ['Movie.2019.DVDScr.XviD-GRP', 'scr'],
    ['Movie.2019.SCREENER.x264', 'scr'],
    ['Pelicula [BluRay-Screener][Castellano][2019]', 'scr'],
    ['Movie.2019.PreDVDRip.x264', 'scr'],
    ['Dune.Part.Two.2024.HDCAM.c1nem4.x264', 'cam'],
    ['Dune Part Two 2024 CAM', 'cam'],
    ['Movie.2024.NEW.CAMRip.x264', 'cam'],
    ['Movie.2024.HQ-CAM.x264', 'cam'],
    ['Movie.2024.1080p.HDTS.x264', 'cam'],
    ['Movie.2024.HD-TS.x264', 'cam'],
    ['Movie.2024.TELESYNC.x264', 'cam'],
    ['Movie.2024.HDTC.x264', 'cam'],
    ['Movie.2024.TELECINE.XviD', 'cam'],
    ['Movie.2024.1080p.TS.x264', 'cam'], // TS suelto, en mayúsculas
    ['Movie.2024.TS', 'cam'],
    ['Film.2010.TC.XviD', 'cam'],
    ['Pelicula [TS-Screener][Castellano][2019]', 'cam'], // un TeleSync, no un screener
    ['Show.S01E01.720p.HDTV.x264-GRP', 'other'],
    ['Movie 2005 DVDRip XviD', 'other'],
    ['Movie.2023.HDRip.x264', 'other'],
    ['[SubsPlease] Sousou no Frieren - 01 (1080p) [ABCD1234].mkv', 'other'],
  ];
  for (const [name, expected] of cases) assert.equal(tagsOf(name)[0], expected, name);
});

test('classify: «TS», «TC» y «CAM» que no son una grabación de cine', () => {
  // Extensión y capturas de TV en transport stream.
  assert.equal(tagsOf('Show.S01E01.1080i.HDTV.MPEG2.DD5.1.ts')[0], 'other');
  assert.equal(tagsOf('Show.S01E01.1080i.HDTV.MPEG2.DD5.1.TS')[0], 'other');
  assert.equal(tagsOf('Concierto 2019.ts')[0], 'other');
  // «HD.ts» es un archivo de transport stream, no un «HD-TS»…
  assert.equal(tagsOf('Concierto.2019.HD.ts')[0], 'other');
  assert.equal(tagsOf('Show.S01E01.720p.HD.ts')[0], 'other');
  // …pero «HD.TS» dentro del nombre sí es un TeleSync.
  assert.equal(tagsOf('Movie.2024.HD.TS.x264.mkv')[0], 'cam');
  // Con otra fuente declarada, la sigla es otra cosa (p. ej. «Theatrical Cut»).
  assert.equal(tagsOf('Alien.1979.TC.1080p.BluRay.x264')[0], 'bluray');
  // Audio DTS y minúsculas sueltas.
  assert.equal(tagsOf('Movie.2019.1080p.BluRay.DTS.x264')[0], 'bluray');
  assert.equal(tagsOf('Movie.2019.DTS-HD.MA.5.1')[0], 'other');
  // Fansubs chinos: [TC] = chino tradicional; «[HD][TC]» no es «HD-TC».
  assert.equal(tagsOf('[KissSub][Titulo][01][1080P][TC][MP4]')[0], 'other');
  assert.equal(tagsOf('[Grupo][Titulo][01][HD][TC]')[0], 'other');
  // «Cam» como palabra del título de un episodio o de la propia película.
  assert.equal(tagsOf('Modern.Family.S05E10.Cam.And.Mitch.720p.HDTV.x264', ['Modern Family'])[0], 'other');
  assert.equal(tagsOf('Cam.2018.1080p.NF.WEB-DL.DDP5.1.x264', ['Cam'])[0], 'web');
  assert.equal(tagsOf('Cam.2018.x264', ['Cam'])[0], 'other');
  assert.equal(tagsOf('Cam 2018 CAM x264', ['Cam'])[0], 'cam'); // …y su copia de cine sí
});

test('classify: resolución y etiqueta visible', () => {
  const cases = [
    ['Movie.2023.2160p.WEB-DL.x265', '4k', '2160p'],
    ['Movie 2019 4K HDR', '4k', '2160p'],
    ['Movie.2019.UHD.BluRay.x265', '4k', '2160p'],
    // 1080p sacado de un UHD: manda el número.
    ['Movie.2019.UHD.BluRay.1080p.DTS-HD.MA.x264', '1080p', '1080p'],
    ['Movie.2023.1080p.WEB-DL', '1080p', '1080p'],
    ['Show.S01E01.1080i.HDTV', '1080p', '1080i'],
    ['Movie.2023.1080p60.WEB-DL', '1080p', '1080p'],
    ['Movie (1920x1080 HEVC AAC)', '1080p', '1080p'],
    ['Movie (1920x800 x264)', '1080p', '1080p'], // recortado a cinemascope
    ['Movie.2023.1440p.WEB-DL', '1080p', '1440p'],
    ['Movie.2023.720p.BluRay', '720p', '720p'],
    ['Movie 1280x720p', '720p', '720p'],
    ['Movie.2005.480p.DVDRip', 'sd', '480p'],
    ['Movie.2005.576p.BDRip', 'sd', '576p'],
    ['Movie (848x480)', 'sd', '480p'],
    ['Movie 2005 DVDRip XviD', 'sd', ''], // SD seguro, pero sin número que mostrar
    ['Movie.2023.HDRip.x264', 'unknown', ''],
    ['Avatar (2009) [3D] [BluRay] [x264] [5.1]', 'unknown', ''],
    // El número de episodio no es una resolución.
    ['One Piece - 720 [1080p]', '1080p', '1080p'],
    ['One Piece - 720', 'unknown', ''],
    ['Blade.Runner.2049.2017.BluRay', 'unknown', ''],
  ];
  for (const [name, resolution, quality] of cases) {
    const result = filters.classify(name);
    assert.equal(result.tags[1], resolution, name);
    assert.equal(result.quality, quality, name);
  }
});

test('classify: 3D, HDR, Dolby Vision, HEVC y AV1', () => {
  const extras = (name, titles) => tagsOf(name, titles).slice(2);
  assert.deepEqual(extras('Avatar.2009.1080p.3D.BluRay.Half-OU.x264'), ['3d']);
  assert.deepEqual(extras('Avatar (2009) [3D] [BluRay] [x264] [5.1]'), ['3d']);
  assert.deepEqual(extras('Avatar.2009.1080p.BluRay.H-SBS.x264'), ['3d']);
  assert.deepEqual(extras('Avatar.2009.1080p.BluRay.HSBS.x264'), ['3d']);
  assert.deepEqual(extras('Avatar.2009.BD3D.1080p'), ['3d']);
  assert.deepEqual(extras('Movie.2023.2160p.WEB-DL.DV.HDR10+.HEVC'), ['hdr', 'dv', 'hevc']);
  assert.deepEqual(extras('Movie.2023.2160p.WEB-DL.DoVi.H.265'), ['dv', 'hevc']);
  assert.deepEqual(extras('Movie.2023.2160p.WEB-DL.Dolby.Vision.x265'), ['dv', 'hevc']);
  assert.deepEqual(extras('Movie.2023.2160p.HLG.h265'), ['hdr', 'hevc']);
  assert.deepEqual(extras('Movie.2023.1080p.WEBRip.AV1.Opus'), ['av1']);
  assert.deepEqual(extras('Movie.2023.1080p.WEB-DL.H.264'), []);
  // Parecidos que no cuentan.
  assert.deepEqual(extras('Movie.2023.HDRip.x264'), []); // HDRip no es HDR
  assert.deepEqual(extras('Movie.2005.DVDRip.XviD'), []); // DVD no es DV
  assert.deepEqual(extras('Running.Man.E600.220417.720p.SBS.WEB-DL'), []); // SBS, la cadena coreana
  assert.deepEqual(extras('Hou.Gong.Zhen.Huan.Zhuan.EP01.1080p.WEB-DL'), []); // «Hou» no es H-OU
  assert.deepEqual(extras('[Grupo] Serie 3DCG - 01 [1080p]'), []);
});

test('classify: el título de la obra no se etiqueta a sí mismo', () => {
  // «Saw 3D» en 2D y en 3D de verdad.
  assert.deepEqual(tagsOf('Saw.3D.2010.1080p.BluRay.x264', ['Saw 3D']), ['bluray', '1080p']);
  assert.deepEqual(tagsOf('Saw.3D.2010.3D.HSBS.1080p.BluRay.x264', ['Saw 3D']), ['bluray', '1080p', '3d']);
  // Vale cualquiera de los títulos conocidos (inglés u original).
  assert.deepEqual(tagsOf('[Grupo] 3D Kanojo Real Girl - 01 [1080p]', ['Real Girl', '3D彼女 リアルガール']), ['other', '1080p']);
  assert.equal(tagsOf('Charlottes.Web.2006.1080p.BluRay.x264', ["Charlotte's Web"])[0], 'bluray');
  assert.equal(tagsOf('Charlottes.Web.2006.DVDRip.XviD', ["Charlotte's Web"])[0], 'other');
  assert.equal(tagsOf('Charlottes.Web.2006.1080p.WEB-DL.x264', ["Charlotte's Web"])[0], 'web');
  assert.equal(tagsOf('SD.Gundam.World.Heroes.01', ['SD Gundam World Heroes'])[1], 'unknown');
  // Sin título conocido se clasifica por lo que diga el nombre.
  assert.deepEqual(tagsOf('Saw.3D.2010.1080p.BluRay.x264'), ['bluray', '1080p', '3d']);
});

test('classify: nombres enormes o raros no cuelgan ni rompen', () => {
  const started = Date.now();
  for (const name of ['a'.repeat(50000), ' '.repeat(50000), '['.repeat(20000), 'TS.'.repeat(20000), '3D HDR DV '.repeat(5000)]) {
    assert.ok(Array.isArray(filters.classify(name, [name]).tags));
  }
  assert.ok(Date.now() - started < 1000, 'classify tarda demasiado');
});

const sample = [
  { id: 'cam', seeders: 2000, size: 1.5 * 1024 ** 3, tags: ['cam', 'unknown'] },
  { id: 'web', seeders: 900, size: 4 * 1024 ** 3, tags: ['web', '1080p'] },
  { id: 'remux', seeders: 500, size: 60 * 1024 ** 3, tags: ['remux', '4k', 'hdr', 'dv', 'hevc'] },
  { id: '3d', seeders: 300, size: 9 * 1024 ** 3, tags: ['bluray', '1080p', '3d'] },
  { id: '720', seeders: 100, size: 0.9 * 1024 ** 3, tags: ['bluray', '720p'] },
  { id: 'scr', seeders: 50, size: 0.7 * 1024 ** 3, tags: ['scr', 'sd'] },
  { id: 'sin-tamano', seeders: 10, size: 0, tags: ['other', 'unknown'] },
];
const ids = (list) => list.map((hit) => hit.id);

test('applyPrefs: sin preferencias deja la lista como está', () => {
  const all = ids(sample);
  assert.deepEqual(ids(filters.applyPrefs(sample, null)), all);
  assert.deepEqual(ids(filters.applyPrefs(sample, undefined)), all);
  assert.deepEqual(ids(filters.applyPrefs(sample, {})), all);
  assert.deepEqual(ids(filters.applyPrefs(sample, { hide: [], sort: 'seeders', maxSize: 0 })), all);
  assert.deepEqual(ids(filters.applyPrefs(sample, { hide: 'cam', sort: 'inventado', maxSize: 'x' })), all);
  assert.deepEqual(filters.applyPrefs(null, { hide: ['cam'] }), []);
});

test('applyPrefs: oculta por etiqueta y por tamaño máximo', () => {
  assert.deepEqual(ids(filters.applyPrefs(sample, { hide: ['cam'] })), ['web', 'remux', '3d', '720', 'scr', 'sin-tamano']);
  assert.deepEqual(ids(filters.applyPrefs(sample, { hide: filters.RECOMMENDED_HIDE })), ['web', 'remux', '720', 'sin-tamano']);
  // Una etiqueta oculta basta, aunque el resto estén permitidas.
  assert.deepEqual(ids(filters.applyPrefs(sample, { hide: ['dv'] })), ['cam', 'web', '3d', '720', 'scr', 'sin-tamano']);
  assert.deepEqual(ids(filters.applyPrefs(sample, { hide: ['1080p', 'unknown'] })), ['remux', '720', 'scr']);
  // «Solo REMUX»: se desmarca todo lo demás del grupo.
  assert.deepEqual(ids(filters.applyPrefs(sample, { hide: ['web', 'bluray', 'other', 'scr', 'cam'] })), ['remux']);
  // Tamaño: fuera lo que pesa más; lo de tamaño desconocido se queda.
  assert.deepEqual(ids(filters.applyPrefs(sample, { maxSize: 5 })), ['cam', 'web', '720', 'scr', 'sin-tamano']);
  assert.deepEqual(ids(filters.applyPrefs(sample, { maxSize: 4 })), ['cam', 'web', '720', 'scr', 'sin-tamano']); // 4 GB justos entra
  assert.deepEqual(ids(filters.applyPrefs(sample, { maxSize: 1, hide: ['scr'] })), ['720', 'sin-tamano']);
});

test('applyPrefs: orden por calidad y por tamaño, sin tocar la lista original', () => {
  const before = JSON.stringify(sample);
  assert.deepEqual(
    ids(filters.applyPrefs(sample, { sort: 'quality' })),
    ['remux', 'web', '3d', '720', 'sin-tamano', 'cam', 'scr'] // 4K, 1080p (2D antes que 3D), 720p, sin resolución; CAM y screener al final
  );
  assert.deepEqual(
    ids(filters.applyPrefs(sample, { sort: 'size' })),
    ['scr', '720', 'cam', 'web', '3d', 'remux', 'sin-tamano']
  );
  assert.deepEqual(ids(filters.applyPrefs(sample, { sort: 'size', hide: ['scr', 'cam'], maxSize: 10 })), ['720', 'web', '3d', 'sin-tamano']);
  // A igual calidad se conserva el orden por seeders recibido.
  const tie = [
    { id: 'a', seeders: 9, size: 5, tags: ['web', '1080p'] },
    { id: 'b', seeders: 8, size: 5, tags: ['bluray', '1080p'] },
    { id: 'c', seeders: 7, size: 5, tags: ['web', '1080p'] },
  ];
  assert.deepEqual(ids(filters.applyPrefs(tie, { sort: 'quality' })), ['a', 'b', 'c']);
  assert.deepEqual(ids(filters.applyPrefs(tie, { sort: 'size' })), ['a', 'b', 'c']);
  assert.equal(JSON.stringify(sample), before);
});

test('config de usuario: hide, sort y maxSize viajan en la URL y se validan', () => {
  const cfg = normalize({ lang: 'es-MX', region: 'MX', hide: ['cam', '3d', 'inventado', 'cam', 7], sort: 'quality', maxSize: 10 });
  assert.deepEqual(cfg.hide, ['cam', '3d']);
  assert.equal(cfg.sort, 'quality');
  assert.equal(cfg.maxSize, 10);
  const decoded = decode(userConfig.encodeConfig(cfg));
  assert.deepEqual(decoded, cfg);

  // Valores fuera de rango o de tipo equivocado caen al valor por defecto.
  for (const [raw, expected] of [
    [{ maxSize: -5 }, 0], [{ maxSize: 'abc' }, 0], [{ maxSize: null }, 0], [{ maxSize: Infinity }, 0],
    [{ maxSize: 2.9 }, 2], [{ maxSize: '20' }, 20], [{ maxSize: 5e9 }, filters.MAX_SIZE_GB],
  ]) {
    assert.equal(normalize(raw).maxSize, expected, JSON.stringify(raw));
  }
  assert.equal(normalize({ sort: 'aleatorio' }).sort, 'seeders');
  assert.equal(normalize({ sort: ['quality'] }).sort, 'seeders');
  assert.deepEqual(normalize({ hide: 'cam' }).hide, []);
  // …pero en una URL, un `hide` que no es lista delata una config corrupta.
  assert.equal(decode(b64url({ lang: 'es', region: 'NI', hide: 'cam' })), null);
  assert.equal(decode(b64url({ lang: 'es', region: 'NI', hide: { cam: true } })), null);
});

test('config de usuario: los valores por defecto no ocupan sitio y las URLs antiguas siguen valiendo', () => {
  const plain = normalize({ lang: 'es', region: 'NI' });
  assert.deepEqual([plain.hide, plain.sort, plain.maxSize], [[], 'seeders', 0]);
  const encoded = userConfig.encodeConfig(plain);
  assert.deepEqual(JSON.parse(Buffer.from(encoded, 'base64url').toString()), { lang: 'es', region: 'NI' });

  // URL generada por la versión anterior de /configure (sin los campos nuevos).
  const legacy = decode(b64url({ lang: 'es-MX', region: 'MX', platforms: ['netflix'], streams: ['knaben', 'yts'] }));
  assert.deepEqual(legacy.platforms, ['netflix']);
  assert.deepEqual(legacy.streams, ['knaben', 'yts']);
  assert.deepEqual([legacy.hide, legacy.sort, legacy.maxSize], [[], 'seeders', 0]);

  // La config por defecto del despliegue tampoco filtra nada.
  const base = userConfig.defaultConfig({});
  assert.deepEqual([base.hide, base.sort, base.maxSize], [[], 'seeders', 0]);

  // Con TODOS los filtros activos la URL sigue cabiendo.
  const full = normalize({
    lang: 'pt-BR', region: 'BR', platforms: PLATFORM_KEYS, studios: STUDIO_KEYS, base: userConfig.BASE_KEYS,
    streams: PROVIDER_KEYS, hide: filters.FILTER_KEYS, sort: 'quality', maxSize: filters.MAX_SIZE_GB,
  });
  const segment = userConfig.encodeConfig(full);
  assert.ok(segment.length <= userConfig.MAX_CONFIG_SEGMENT, `segmento de ${segment.length} caracteres`);
  assert.deepEqual(decode(segment), full);
});

test('idiomas y regiones: lista ampliada sin perder los códigos ya instalados', () => {
  const langs = userConfig.LANG_OPTIONS.map((o) => o.code);
  const regions = userConfig.REGION_OPTIONS.map((o) => o.code);
  assert.equal(new Set(langs).size, langs.length);
  assert.equal(new Set(regions).size, regions.length);
  // Códigos que ya podían estar en una URL instalada.
  for (const code of ['es', 'es-MX', 'en', 'pt-BR', 'fr', 'de', 'it']) assert.ok(langs.includes(code), code);
  for (const code of ['NI', 'MX', 'US', 'ES', 'AR', 'CO', 'CL', 'PE', 'UY', 'EC', 'VE', 'CR', 'PA', 'DO', 'GT', 'HN']) {
    assert.ok(regions.includes(code), code);
  }
  assert.ok(langs.length >= 15 && regions.length >= 40);
  for (const lang of userConfig.LANG_OPTIONS) {
    assert.match(lang.code, /^[a-z]{2}(-[A-Z]{2})?$/, lang.code); // formato del parámetro `language` de TMDB
    assert.ok(lang.label, lang.code);
  }
  for (const region of userConfig.REGION_OPTIONS) {
    assert.match(region.code, /^[A-Z]{2}$/, region.code); // ISO 3166-1
    assert.ok(region.label, region.code);
    assert.ok(userConfig.REGION_GROUPS.includes(region.group), region.code);
  }
  // Los nuevos se aceptan y los inventados caen al valor por defecto.
  assert.deepEqual([normalize({ lang: 'ja', region: 'jp' }).lang, normalize({ lang: 'ja', region: 'jp' }).region], ['ja', 'JP']);
  assert.deepEqual([normalize({ lang: 'xx', region: 'ZZ' }).lang, normalize({ lang: 'xx', region: 'ZZ' }).region], ['es', 'NI']);
  assert.ok(langs.includes(userConfig.DEFAULT_LANG) && regions.includes(userConfig.DEFAULT_REGION));
});

// ─────────────────────────────────────────────────────────────────────────────
// Recorrido completo: una sola búsqueda, varios usuarios con filtros distintos
// ─────────────────────────────────────────────────────────────────────────────
const GB = 1024 ** 3;
const RELEASES = [
  ['Example.Movie.2023.HDCAM.x264-GRP', 2000, 1.5],
  ['Example.Movie.2023.1080p.WEB-DL.DDP5.1.H.264-GRP', 900, 4],
  ['Example.Movie.2023.2160p.UHD.BluRay.REMUX.DV.HDR.HEVC-GRP', 500, 60],
  ['Example.Movie.2023.1080p.3D.BluRay.Half-SBS.x264-GRP', 300, 9],
  ['Example.Movie.2023.720p.BluRay.x264-GRP', 100, 0.9],
  ['Example.Movie.2023.DVDScr.XviD-GRP', 50, 0.7],
];
const hashOf = (index) => String(index + 1).repeat(40);
const knabenResponse = () => ({
  hits: RELEASES.map(([title, seeders, gigabytes], index) => ({
    title,
    hash: hashOf(index),
    magnetUrl: `magnet:?xt=urn:btih:${hashOf(index)}&tr=udp%3A%2F%2Ftracker.example%3A1337`,
    bytes: Math.round(gigabytes * GB),
    liveSeeders: seeders,
    livePeers: 3,
  })),
});
const [CAM, WEB, REMUX, THREE_D, HD, SCR] = RELEASES.map((_, index) => hashOf(index));
const hashes = (result) => result.streams.map((stream) => stream.infoHash);

function mockProvider(counter) {
  global.fetch = async (url) => {
    if (String(url).includes('cinemeta')) return json({ meta: { name: 'Example Movie', year: '2023' } });
    counter.calls++;
    return json(knabenResponse());
  };
}

test('handleStream: cada usuario ve su selección y la búsqueda se hace una sola vez', async () => {
  config.reload({ STREAM_PROVIDERS: 'knaben' });
  const counter = { calls: 0 };
  mockProvider(counter);
  const id = 'tt9820001';

  // Sin config (manifest por defecto): todo, por seeders, con el formato de siempre.
  const plain = await core.handleStream('movie', id);
  assert.deepEqual(hashes(plain), [CAM, WEB, REMUX, THREE_D, HD, SCR]);
  assert.equal(plain.cacheMaxAge, 3600);
  assert.deepEqual(plain.streams[1], {
    name: '🧲 1080p',
    title: 'Example.Movie.2023.1080p.WEB-DL.DDP5.1.H.264-GRP\n💾 4.00 GB  👤 900  ⬇ 3',
    infoHash: WEB,
    sources: ['tracker:udp://tracker.example:1337', `dht:${WEB}`],
    behaviorHints: { bingeGroup: 'catalogos-plus-22222222' },
  });
  assert.equal(plain.streams[0].name, '🧲 Torrent'); // la CAM no dice resolución
  assert.equal(plain.streams[2].name, '🧲 2160p');

  // Config sin filtros: lo mismo que sin config.
  assert.deepEqual(await core.handleStream('movie', id, normalize({ region: 'MX' })), plain);

  const through = (raw) => core.handleStream('movie', id, decode(userConfig.encodeConfig(normalize(raw))));
  assert.deepEqual(hashes(await through({ hide: ['cam', 'scr', '3d'] })), [WEB, REMUX, HD]);
  assert.deepEqual(hashes(await through({ hide: ['cam', 'scr', '3d'], maxSize: 10 })), [WEB, HD]);
  assert.deepEqual(hashes(await through({ hide: ['remux'] })), [CAM, WEB, THREE_D, HD, SCR]);
  assert.deepEqual(hashes(await through({ hide: ['web', 'bluray', 'other', 'scr', 'cam'] })), [REMUX]); // «solo REMUX»
  assert.deepEqual(hashes(await through({ hide: ['4k', '1080p'] })), [CAM, HD, SCR]);
  assert.deepEqual(hashes(await through({ hide: ['hevc'] })), [CAM, WEB, THREE_D, HD, SCR]);
  assert.deepEqual(hashes(await through({ sort: 'quality' })), [REMUX, WEB, THREE_D, HD, CAM, SCR]);
  assert.deepEqual(hashes(await through({ sort: 'size' })), [SCR, HD, CAM, WEB, THREE_D, REMUX]);
  const none = await through({ hide: filters.FILTER_KEYS });
  assert.deepEqual(none.streams, []);
  assert.equal(none.cacheMaxAge, 3600); // vacío por filtros, no por fallo: se puede cachear

  assert.equal(counter.calls, 1, 'los filtros no deben repetir la búsqueda');
});

test('handleStream: el límite de resultados se aplica DESPUÉS de filtrar', async () => {
  config.reload({ STREAM_PROVIDERS: 'knaben', STREAM_MAX_RESULTS: '2' });
  const counter = { calls: 0 };
  mockProvider(counter);
  const id = 'tt9820002';
  assert.deepEqual(hashes(await core.handleStream('movie', id)), [CAM, WEB]);
  // Sin la CAM entran los dos siguientes, no uno solo.
  assert.deepEqual(hashes(await core.handleStream('movie', id, normalize({ hide: ['cam'] }))), [WEB, REMUX]);
  assert.deepEqual(hashes(await core.handleStream('movie', id, normalize({ sort: 'size' }))), [SCR, HD]);
  assert.equal(counter.calls, 1);
});

test('Worker: la URL personal aplica los filtros de streams', async () => {
  const worker = (await import('../worker.mjs')).default;
  const counter = { calls: 0 };
  mockProvider(counter);
  const env = { STREAM_PROVIDERS: 'knaben' };
  const segment = userConfig.encodeConfig(normalize({ region: 'MX', hide: ['cam', 'scr', '3d'], sort: 'quality' }));

  const personal = await worker.fetch(new Request(`https://addon.example/${segment}/stream/movie/tt9820003.json`), env, {});
  assert.equal(personal.status, 200);
  assert.deepEqual(hashes(await personal.json()), [REMUX, WEB, HD]);

  const plain = await worker.fetch(new Request('https://addon.example/stream/movie/tt9820003.json'), env, {});
  assert.deepEqual(hashes(await plain.json()), [CAM, WEB, REMUX, THREE_D, HD, SCR]);
  assert.equal(counter.calls, 1);
});

test('diagnóstico de streams: cuenta los resultados por categoría de filtro', async () => {
  const streams = require('../lib/streams');
  config.reload({ STREAM_PROVIDERS: 'knaben' });
  mockProvider({ calls: 0 });
  const report = await streams.diagnose('movie', 'tt9820004', null);
  assert.equal(report.totalStreams, 6);
  assert.deepEqual(report.categories, {
    cam: 1, web: 1, remux: 1, bluray: 2, scr: 1,
    unknown: 1, '1080p': 2, '4k': 1, '720p': 1, sd: 1,
    '3d': 1, hdr: 1, dv: 1, hevc: 1,
  });
});
