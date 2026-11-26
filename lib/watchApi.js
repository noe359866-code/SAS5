'use strict';

/**
 * API interna del reproductor web (/watch).
 *
 * Reutiliza los catálogos, metadatos y streams del addon sin duplicar lógica:
 *  - buildWatchCatalogs(cfg): estructura de secciones (Inicio, Películas,
 *    Series, Anime), plataformas y colección curada de respaldo cuando no hay
 *    clave de TMDB.
 *  - searchWatch({ query, type, page, lang }): búsqueda en vivo sobre TMDB
 *    (/search/multi, /movie, /tv) con respaldo sin clave (Cinemeta + TVMaze +
 *    colección curada).
 *  - getWatchMeta(type, id, cfg): ficha enriquecida con respaldo de Cinemeta y
 *    colección curada para que el reproductor web siempre muestre sinopsis y
 *    episodios aunque falte TMDB_API_KEY.
 *  - getWatchFallbackCatalog(type, id): metas curados por sección si TMDB no
 *    está configurado.
 */

const config = require('./config');
const cache = require('./cache');
const core = require('./core');
const tmdb = require('./tmdb');
const cinemeta = require('./cinemeta');
const { fetchJson } = require('./http');
const { buildDefs, PLATFORMS } = require('./catalogs');
const { activeProviders } = require('./streams');
const { cleanTitle, cleanOverview } = require('./sanitize');

const IMG_POSTER = 'https://image.tmdb.org/t/p/w342/';
const IMG_BACKDROP = 'https://image.tmdb.org/t/p/w1280/';

// Colección curada con IDs reales de IMDb y artes públicos del CDN de TMDB:
// garantiza que /watch se vea completo y permita buscar streams reales incluso
// en entornos locales sin TMDB_API_KEY.
const CURATED_MOVIES = [
  {
    id: 'tt0816692', type: 'movie', name: 'Interestelar', releaseInfo: '2014', imdbRating: '8.7',
    poster: `${IMG_POSTER}nrSaXF39nDfAAeLKksRCyvSzI2a.jpg`,
    background: `${IMG_BACKDROP}xJHokMbljvjADYdit5fK5VQsXEG.jpg`,
    description: 'Un grupo de exploradores aprovecha un agujero de gusano recién descubierto para superar las limitaciones de los viajes espaciales tripulados y buscar un nuevo hogar para la humanidad.',
    genre: ['Ciencia ficción', 'Drama', 'Aventura'],
  },
  {
    id: 'tt15239678', type: 'movie', name: 'Dune: Parte Dos', releaseInfo: '2024', imdbRating: '8.5',
    poster: `${IMG_POSTER}1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg`,
    background: `${IMG_BACKDROP}xOMo8BRK7PfcJv9JCnx7s5hj0PX.jpg`,
    description: 'Paul Atreides se une a Chani y a los Fremen mientras busca venganza contra los conspiradores que destruyeron a su familia y enfrenta una decisión entre el amor y el destino del universo.',
    genre: ['Ciencia ficción', 'Aventura'],
  },
  {
    id: 'tt1745960', type: 'movie', name: 'Top Gun: Maverick', releaseInfo: '2022', imdbRating: '8.2',
    poster: `${IMG_POSTER}n0YuM4f5lvGAP6MAW2kBIzugXnc.jpg`,
    background: `${IMG_BACKDROP}AaV1YIdWKnjAIAOe8UUKBFm327v.jpg`,
    description: 'Después de más de treinta años de servicio como uno de los mejores aviadores de la Armada, Pete «Maverick» Mitchell entrena a un destacamento de graduados para una misión especializada.',
    genre: ['Acción', 'Drama'],
  },
  {
    id: 'tt4633694', type: 'movie', name: 'Spider-Man: Un nuevo universo', releaseInfo: '2018', imdbRating: '8.4',
    poster: `${IMG_POSTER}iiZZdoQBEYBv6id8su7ImL0oCbD.jpg`,
    background: `${IMG_BACKDROP}qGQf2OHIkoh8SOK8Pp42mQ9xJ2f.jpg`,
    description: 'Miles Morales adquiere poderes arácnidos y cruza caminos con contrapartes de otras dimensiones para detener una amenaza capaz de destruir toda la realidad.',
    genre: ['Animación', 'Acción', 'Aventura'],
  },
  {
    id: 'tt0133093', type: 'movie', name: 'Matrix', releaseInfo: '1999', imdbRating: '8.7',
    poster: `${IMG_POSTER}qK76ozbrk1L64lH0t5v6u9P55k1.jpg`,
    background: `${IMG_BACKDROP}ncEsesgOJDNrTUED89hYbA117wo.jpg`,
    description: 'Un programador descubre que la realidad que conoce es una simulación creada por máquinas inteligentes y se une a la rebelión para liberar a la humanidad.',
    genre: ['Acción', 'Ciencia ficción'],
  },
  {
    id: 'tt1375666', type: 'movie', name: 'El origen', releaseInfo: '2010', imdbRating: '8.8',
    poster: `${IMG_POSTER}tXQvtRWfkUUnWJAn2tN3jERIUG.jpg`,
    background: `${IMG_BACKDROP}8ZTVqvKDQ8emSGUEMjsS4yHAwrp.jpg`,
    description: 'Un ladrón experto en infiltrarse en los sueños recibe la oportunidad de borrar su pasado si logra implantar una idea en el subconsciente de un heredero corporativo.',
    genre: ['Acción', 'Ciencia ficción', 'Suspense'],
  },
  {
    id: 'tt0172495', type: 'movie', name: 'Gladiador', releaseInfo: '2000', imdbRating: '8.5',
    poster: `${IMG_POSTER}aDb548BOkFfI4nFm0kx8A3Ezh7H.jpg`,
    background: `${IMG_BACKDROP}hND7xAaxxBgaIsu9iMle48z7z9F.jpg`,
    description: 'Un general romano traicionado y reducido a la esclavitud asciende como gladiador en la arena para vengar a su familia y restaurar el honor de Roma.',
    genre: ['Acción', 'Drama', 'Aventura'],
  },
  {
    id: 'tt2582802', type: 'movie', name: 'Whiplash: Música y obsesión', releaseInfo: '2014', imdbRating: '8.5',
    poster: `${IMG_POSTER}7fn624j5lj3xTme2SgiLCeuedmO.jpg`,
    background: `${IMG_BACKDROP}fRGxZuo7jJUWQsVg9PREb98Aclp.jpg`,
    description: 'Un ambicioso baterista de jazz de primer año en un prestigioso conservatorio choca con un implacable director dispuesto a empujarlo al límite.',
    genre: ['Drama', 'Música'],
  },
  {
    id: 'tt0468569', type: 'movie', name: 'Batman: El caballero de la noche', releaseInfo: '2008', imdbRating: '9.0',
    poster: `${IMG_POSTER}8QDQExnfNFOtabLDKqfDQuHDsIg.jpg`,
    background: `${IMG_BACKDROP}nMKdUUepR0i5zn0y1T4CsSB5chy.jpg`,
    description: 'Con la ayuda del teniente Gordon y el fiscal Harvey Dent, Batman busca desmantelar el crimen organizado de Gotham mientras enfrenta el caos desatado por el Joker.',
    genre: ['Acción', 'Crimen', 'Drama'],
  },
  {
    id: 'tt6751668', type: 'movie', name: 'Parásitos', releaseInfo: '2019', imdbRating: '8.5',
    poster: `${IMG_POSTER}7IiTTgloJzvGI1TAYymCfbfl3vT.jpg`,
    background: `${IMG_BACKDROP}TU9NIjwzjoKPwQHoHshkFcQUCG.jpg`,
    description: 'Todos los miembros de la familia Kim están sin empleo hasta que el hijo mayor logra infiltrarse como tutor en la mansión de los acaudalados Park.',
    genre: ['Comedia', 'Suspense', 'Drama'],
  },
];

const CURATED_SERIES = [
  {
    id: 'tt0903747', type: 'series', name: 'Breaking Bad', releaseInfo: '2008', imdbRating: '9.5',
    poster: `${IMG_POSTER}ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg`,
    background: `${IMG_BACKDROP}tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg`,
    description: 'Un profesor de química diagnosticado con cáncer terminal se asocia con un antiguo alumno para asegurar el futuro de su familia fabricando metanfetamina.',
    genre: ['Drama', 'Crimen'],
  },
  {
    id: 'tt3581920', type: 'series', name: 'The Last of Us', releaseInfo: '2023', imdbRating: '8.7',
    poster: `${IMG_POSTER}uKvVjHNqB5VmOrdxqAt2F7J78ED.jpg`,
    background: `${IMG_BACKDROP}uDgy6hyPd82kOHh6I95FLtLnj6p.jpg`,
    description: 'Veinte años después de la destrucción de la civilización moderna, Joel es contratado para escoltar a Ellie fuera de una zona de cuarentena a través de un país devastado.',
    genre: ['Drama', 'Ciencia ficción', 'Aventura'],
  },
  {
    id: 'tt4574334', type: 'series', name: 'Stranger Things', releaseInfo: '2016', imdbRating: '8.7',
    poster: `${IMG_POSTER}49WJfeN0moxb9IPfGn8AIqMGskD.jpg`,
    background: `${IMG_BACKDROP}56v2KjBlU4XaOv9rVYEQypROD7P.jpg`,
    description: 'Tras la misteriosa desaparición de un niño en Hawkins, sus amigos descubren una red de experimentos secretos y fuerzas sobrenaturales.',
    genre: ['Ciencia ficción', 'Misterio', 'Drama'],
  },
  {
    id: 'tt5753856', type: 'series', name: 'Dark', releaseInfo: '2017', imdbRating: '8.7',
    poster: `${IMG_POSTER}apbrbWs8M9lyOpJYU5WXrpFbk1Z.jpg`,
    background: `${IMG_BACKDROP}3lBDg3i6nn5R2NKFCJ6oKyUo2j5.jpg`,
    description: 'La desaparición de dos jóvenes en un pueblo alemán destapa secretos ocultos y una conspiración que conecta cuatro familias a través de distintas épocas.',
    genre: ['Misterio', 'Ciencia ficción', 'Drama'],
  },
  {
    id: 'tt11126994', type: 'series', name: 'Arcane', releaseInfo: '2021', imdbRating: '9.0',
    poster: `${IMG_POSTER}fqldf2t8ztc9aiwn3k6mlX3tvRT.jpg`,
    background: `${IMG_BACKDROP}rkB4LyZHo1NHXFEDHl9vSD9r1lI.jpg`,
    description: 'En medio del conflicto entre las ciudades gemelas de Piltover y Zaun, dos hermanas luchan en bandos opuestos de una guerra entre tecnologías mágicas y convicciones enfrentadas.',
    genre: ['Animación', 'Acción', 'Ciencia ficción'],
  },
  {
    id: 'tt2531336', type: 'series', name: 'Lupin', releaseInfo: '2021', imdbRating: '7.7',
    poster: `${IMG_POSTER}h6Z2oogE4mJk2uffdtIlLhb0EHx.jpg`,
    background: `${IMG_BACKDROP}dVHejgvh0Q441e8K772F3Q0sN2B.jpg`,
    description: 'Inspirado por las aventuras de Arsène Lupin, el ladrón de guante blanco Assane Diop planea vengar la injusticia sufrida por su padre a manos de una familia poderosa.',
    genre: ['Crimen', 'Drama', 'Misterio'],
  },
  {
    id: 'tt7631058', type: 'series', name: 'El Señor de los Anillos: Los Anillos de Poder', releaseInfo: '2022', imdbRating: '7.2',
    poster: `${IMG_POSTER}bMXWXKM9ydUmMTNvDnYo9QtCBRt.jpg`,
    background: `${IMG_BACKDROP}1rO4ita9screen74X5R1Z2f3s7q.jpg`,
    description: 'Ambientada miles de años antes de El Hobbit, sigue el forjado de los grandes anillos y el resurgimiento de una antigua oscuridad en la Tierra Media.',
    genre: ['Fantasía', 'Aventura', 'Drama'],
  },
  {
    id: 'tt1190634', type: 'series', name: 'The Boys', releaseInfo: '2019', imdbRating: '8.7',
    poster: `${IMG_POSTER}2zmTngn1tYC1AvfnrFLhxeD82hz.jpg`,
    background: `${IMG_BACKDROP}7cqKGQMnNabzOpi7qaIgZvQ7NGV.jpg`,
    description: 'Un grupo de vigilantes sin poderes se propone desenmascarar y derribar a superhéroes corruptos respaldados por una poderosa corporación.',
    genre: ['Acción', 'Ciencia ficción', 'Comedia'],
  },
];

const CURATED_ANIME_SERIES = [
  {
    id: 'tt2560140', type: 'series', name: 'Attack on Titan', releaseInfo: '2013', imdbRating: '9.1', isAnime: true,
    poster: `${IMG_POSTER}hTP1DtLGFamjfu8WqjnuQdP1n4i.jpg`,
    background: `${IMG_BACKDROP}rqbCbjB19amtOtFQbb3K2lgm2zv.jpg`,
    description: 'Tras la destrucción de su ciudad natal por gigantes devoradores de humanos, Eren Jaeger jura erradicar a todos los titanes y descubrir la verdad más allá de las murallas.',
    genre: ['Anime', 'Acción', 'Fantasía'],
  },
  {
    id: 'tt9335498', type: 'series', name: 'Demon Slayer: Kimetsu no Yaiba', releaseInfo: '2019', imdbRating: '8.6', isAnime: true,
    poster: `${IMG_POSTER}xUfRZu2mi8jH6SzQEJGP6tjBuYj.jpg`,
    background: `${IMG_BACKDROP}nTvM4mhqNlHIvUkI1gVnW6XP7GG.jpg`,
    description: 'Tanjiro Kamado emprende un peligroso viaje como cazador de demonios para encontrar una cura para su hermana Nezuko y vengar a su familia.',
    genre: ['Anime', 'Acción', 'Aventura'],
  },
  {
    id: 'tt12343534', type: 'series', name: 'Jujutsu Kaisen', releaseInfo: '2020', imdbRating: '8.5', isAnime: true,
    poster: `${IMG_POSTER}fHpKWq9ayzSk8nSwqRuaAUemRKh.jpg`,
    background: `${IMG_BACKDROP}gmECX1DvFgdUPjtio2zaL8BPYPu.jpg`,
    description: 'Yuji Itadori ingiere un objeto maldito para salvar a sus amigos y se une a la escuela de hechicería para enfrentar maldiciones mortales.',
    genre: ['Anime', 'Acción', 'Fantasía'],
  },
  {
    id: 'tt21209876', type: 'series', name: 'Solo Leveling', releaseInfo: '2024', imdbRating: '8.4', isAnime: true,
    poster: `${IMG_POSTER}geCRueV3ElhRTr0xtJuEWJt6dJ1.jpg`,
    background: `${IMG_BACKDROP}odVlTMqPPiMkorWSN9LXBtUMjze.jpg`,
    description: 'Sung Jinwoo, conocido como el cazador más débil de la humanidad, obtiene un misterioso sistema que le permite subir de nivel sin límites.',
    genre: ['Anime', 'Acción', 'Fantasía'],
  },
  {
    id: 'tt26743760', type: 'series', name: 'The Apothecary Diaries', releaseInfo: '2023', imdbRating: '8.7', isAnime: true,
    poster: `${IMG_POSTER}sJZcy8QsOPuRPiCfoCWVB3r9Ohg.jpg`,
    background: `${IMG_BACKDROP}9Yte1j6065M5F5G4P3rH8z3gF8R.jpg`,
    description: 'Maomao, una brillante boticaria obsesionada con los venenos, resuelve misterios e intrigas dentro del palacio imperial.',
    genre: ['Anime', 'Misterio', 'Drama'],
  },
  {
    id: 'tt5607616', type: 'series', name: 'Re:ZERO -Starting Life in Another World-', releaseInfo: '2016', imdbRating: '8.1', isAnime: true,
    poster: `${IMG_POSTER}oHqYrPAsIiTD5m4DuxumV4er8BU.jpg`,
    background: `${IMG_BACKDROP}xJ6h8l243bV0m5C5C4Q3rL0gH3S.jpg`,
    description: 'Transportado repentinamente a un mundo de fantasía, Subaru Natsuki descubre que posee la capacidad de retroceder en el tiempo cada vez que muere.',
    genre: ['Anime', 'Fantasía', 'Drama'],
  },
  {
    id: 'tt0388629', type: 'series', name: 'One Piece', releaseInfo: '1999', imdbRating: '9.0', isAnime: true,
    poster: `${IMG_POSTER}cMD9Ygz11zjJzAovURpO75Qg7rT.jpg`,
    background: `${IMG_BACKDROP}2rmK7mnchw9Xr3XdiTFSxTTLXqv.jpg`,
    description: 'Monkey D. Luffy zarpa junto a su tripulación de los Sombrero de Paja en busca del legendario tesoro One Piece para convertirse en el Rey de los Piratas.',
    genre: ['Anime', 'Aventura', 'Acción'],
  },
  {
    id: 'tt0877057', type: 'series', name: 'Death Note', releaseInfo: '2006', imdbRating: '8.9', isAnime: true,
    poster: `${IMG_POSTER}nqPtk2c2i34uG1E5G8n9N5V3A9I.jpg`,
    background: `${IMG_BACKDROP}mB3l2tH5H4L9pR1A6W0z8F4J7Q1.jpg`,
    description: 'Un brillante estudiante encuentra un cuaderno sobrenatural capaz de matar a cualquier persona cuyo nombre se escriba en él, iniciando un duelo intelectual contra el detective L.',
    genre: ['Anime', 'Misterio', 'Suspense'],
  },
];

const CURATED_ANIME_MOVIES = [
  {
    id: 'tt32820897', type: 'movie', name: 'Demon Slayer: Castillo Infinito', releaseInfo: '2025', imdbRating: '8.8', isAnime: true,
    poster: `${IMG_POSTER}fWVSwgjpT2D78VUh6X8UBd2rorW.jpg`,
    background: `${IMG_BACKDROP}nTvM4mhqNlHIvUkI1gVnW6XP7GG.jpg`,
    description: 'Los Pilares y el Cuerpo de Cazadores de Demonios descienden al Castillo Infinito para librar la batalla definitiva contra Muzan Kibutsuji.',
    genre: ['Anime', 'Acción', 'Fantasía'],
  },
  {
    id: 'tt5311514', type: 'movie', name: 'Your Name', releaseInfo: '2016', imdbRating: '8.4', isAnime: true,
    poster: `${IMG_POSTER}q719jXXEzOoYaps6babgKnONONX.jpg`,
    background: `${IMG_BACKDROP}dIWwZW7dJJtqC6CgWzYkNVKIUm8.jpg`,
    description: 'Dos adolescentes desconocidos comienzan a intercambiar cuerpos de manera inexplicable y buscan encontrarse antes de que un cometa cambie sus destinos.',
    genre: ['Anime', 'Romance', 'Drama'],
  },
  {
    id: 'tt0245429', type: 'movie', name: 'El viaje de Chihiro', releaseInfo: '2001', imdbRating: '8.6', isAnime: true,
    poster: `${IMG_POSTER}39wmItIWsg5sZMyRUHLkWBcuVCM.jpg`,
    background: `${IMG_BACKDROP}Ab8mkHmkYADjU7wQiOkia9BzGvS.jpg`,
    description: 'Al perderse en un mundo gobernado por espíritus y dioses, una niña de diez años debe reunir valor e ingenio para rescatar a sus padres.',
    genre: ['Anime', 'Fantasía', 'Aventura'],
  },
  {
    id: 'tt11032374', type: 'movie', name: 'Demon Slayer: El Tren Infinito', releaseInfo: '2020', imdbRating: '8.2', isAnime: true,
    poster: `${IMG_POSTER}h8Rb9gBr48ODIwYUttZNYeMWeUU.jpg`,
    background: `${IMG_BACKDROP}xPpXYnCWfjkt3zzE0dpCNME1pXF.jpg`,
    description: 'Tanjiro, Nezuko, Zenitsu e Inosuke se unen al Pilar de la Llama Kyojuro Rengoku para investigar misteriosas desapariciones a bordo de un tren nocturno.',
    genre: ['Anime', 'Acción', 'Aventura'],
  },
  {
    id: 'tt16428256', type: 'movie', name: 'Suzume', releaseInfo: '2022', imdbRating: '7.9', isAnime: true,
    poster: `${IMG_POSTER}vIeu8WysZrTSFb2uhPViKjX9EcC.jpg`,
    background: `${IMG_BACKDROP}4HodYYKEIsGOdinkGi2Ucz6X9i0.jpg`,
    description: 'Una joven de Kyushu ayuda a un misterioso viajero a cerrar puertas sobrenaturales por todo Japón para evitar catástrofes.',
    genre: ['Anime', 'Aventura', 'Fantasía'],
  },
];

const ALL_CURATED = [
  ...CURATED_MOVIES,
  ...CURATED_SERIES,
  ...CURATED_ANIME_SERIES,
  ...CURATED_ANIME_MOVIES,
];
const CURATED_BY_ID = new Map(ALL_CURATED.map((item) => [`${item.type}:${item.id}`, item]));

// Plataformas destacadas para el selector rápido de /watch (orden editorial).
const FEATURED_PLATFORM_KEYS = [
  'netflix', 'prime', 'disney', 'max', 'appletv', 'paramount',
  'crunchyroll', 'vix', 'hulu', 'pluto', 'tubi', 'mubi', 'clarovideo',
];

function catalogRef(def, label) {
  if (!def) return null;
  return {
    id: def.id,
    type: def.type,
    name: label || def.name,
    kind: def.kind,
    paginated: def.source !== 'tvmaze',
  };
}

/** Estructura de catálogos, secciones y plataformas para /watch. */
function buildWatchCatalogs(cfg = null) {
  const defs = buildDefs(cfg);
  const byId = new Map(defs.map((d) => [d.id, d]));
  const pick = (id, label) => catalogRef(byId.get(id), label);

  const inicio = [
    pick('cine_tendencias', 'Películas en tendencia'),
    pick('tv_tendencias', 'Series en tendencia'),
    pick('tv_anime', 'Anime popular'),
    pick('cine_anime', 'Películas de anime'),
    pick('cine_estrenos', 'En cines ahora'),
    pick('tv_enemision', 'Series en emisión'),
    pick('cine_top', 'Películas mejor valoradas'),
    pick('tv_top', 'Series mejor valoradas'),
  ].filter(Boolean);

  const peliculas = [
    pick('cine_tendencias', 'Tendencias'),
    pick('cine_estrenos', 'En cines'),
    pick('cine_popular', 'Populares'),
    pick('cine_top', 'Top valoradas'),
    pick('cine_proximos', 'Próximos estrenos'),
    pick('cine_anime', 'Anime (Películas)'),
  ].filter(Boolean);

  const seriesGenreRows = defs
    .filter((d) => d.type === 'series' && (d.kind === 'genre' || d.kind === 'miniseries'))
    .map((d) => catalogRef(d));

  const series = [
    pick('tv_tendencias', 'Tendencias'),
    pick('tv_enemision', 'En emisión'),
    pick('tv_popular', 'Populares'),
    pick('tv_top', 'Top valoradas'),
    ...seriesGenreRows,
    pick('tvmaze_hoy', 'En TV hoy'),
  ].filter(Boolean);

  const anime = [
    pick('tv_anime', 'Series de anime populares'),
    pick('cine_anime', 'Películas de anime'),
    pick('tv_crunchyroll', 'Crunchyroll · Series'),
    pick('cine_crunchyroll', 'Crunchyroll · Películas'),
  ].filter(Boolean);

  const platformOrder = new Map(FEATURED_PLATFORM_KEYS.map((k, i) => [k, i]));
  const platforms = PLATFORMS
    .filter((p) => byId.has(`cine_${p.key}`) || byId.has(`tv_${p.key}`))
    .slice()
    .sort((a, b) => {
      const ia = platformOrder.has(a.key) ? platformOrder.get(a.key) : 999;
      const ib = platformOrder.has(b.key) ? platformOrder.get(b.key) : 999;
      return ia - ib;
    })
    .map((p) => ({
      key: p.key,
      name: p.name,
      movieId: byId.has(`cine_${p.key}`) ? `cine_${p.key}` : null,
      seriesId: byId.has(`tv_${p.key}`) ? `tv_${p.key}` : null,
    }));

  return {
    ok: true,
    tmdbConfigured: Boolean(config.tmdbConfigured),
    region: (cfg && cfg.region) || config.watchRegion || 'NI',
    language: config.tmdbLanguage || 'es-MX',
    streamProvidersCount: activeProviders(cfg).length,
    sections: { inicio, peliculas, series, anime },
    platforms,
    fallback: {
      movies: CURATED_MOVIES,
      series: CURATED_SERIES,
      animeSeries: CURATED_ANIME_SERIES,
      animeMovies: CURATED_ANIME_MOVIES,
    },
  };
}

/** Catálogo curado de respaldo si un catálogo TMDB devuelve vacío (sin clave). */
function getWatchFallbackCatalog(type, id) {
  const cleanId = String(id || '');
  if (cleanId === 'tv_anime' || cleanId === 'tv_crunchyroll') return { metas: CURATED_ANIME_SERIES };
  if (cleanId === 'cine_anime' || cleanId === 'cine_crunchyroll') return { metas: CURATED_ANIME_MOVIES };
  if (type === 'series' || cleanId.startsWith('tv_')) return { metas: CURATED_SERIES };
  return { metas: CURATED_MOVIES };
}

function normalizeQuery(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function isTmdbAnime(item) {
  const genres = Array.isArray(item && item.genre_ids) ? item.genre_ids : [];
  return genres.includes(16) && String(item.original_language || '').toLowerCase() === 'ja';
}

function mapTmdbSearchItem(item, fallbackType) {
  const rawType = item.media_type || fallbackType;
  if (rawType !== 'movie' && rawType !== 'tv') return null;
  const type = rawType === 'movie' ? 'movie' : 'series';
  const title = cleanTitle(item.title || item.name || '') || '';
  if (!title) return null;
  const date = item.release_date || item.first_air_date || '';
  const rating = Number(item.vote_average || 0);
  const overview = cleanOverview(item.overview) || '';
  return {
    id: `tmdb:${rawType}:${item.id}`,
    type,
    name: title,
    poster: tmdb.image(item.poster_path, 'w342') || '',
    background: tmdb.image(item.backdrop_path, 'w1280') || '',
    releaseInfo: date ? String(date).slice(0, 4) : '',
    imdbRating: rating > 0 ? rating.toFixed(1) : undefined,
    description: overview,
    isAnime: isTmdbAnime(item),
    popularity: Number(item.popularity || 0),
  };
}

function dedupeResults(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item || !item.id || !item.name) continue;
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function searchViaCinemeta(query, type) {
  const wanted = type === 'movie' ? ['movie'] : type === 'series' ? ['series'] : ['movie', 'series'];
  const encoded = encodeURIComponent(query);
  const settled = await Promise.allSettled(
    wanted.map(async (mediaType) => {
      const url = `https://v3-cinemeta.strem.io/catalog/${mediaType}/top/search=${encoded}.json`;
      const data = await fetchJson(url, { timeoutMs: 4500 });
      const metas = Array.isArray(data && data.metas) ? data.metas : [];
      return metas.slice(0, 18).map((m) => ({
        id: String(m.id || m.imdb_id || ''),
        type: mediaType,
        name: cleanTitle(m.name || '') || String(m.name || ''),
        poster: m.poster || '',
        background: m.background || '',
        releaseInfo: String(m.releaseInfo || m.year || '').slice(0, 4),
        imdbRating: m.imdbRating ? String(m.imdbRating) : undefined,
        description: cleanOverview(m.description) || '',
        isAnime: Array.isArray(m.genres) && m.genres.some((g) => /anim/i.test(String(g))),
      }));
    })
  );
  const items = [];
  for (const r of settled) if (r.status === 'fulfilled') items.push(...r.value);
  return items;
}

async function searchViaTvmaze(query) {
  try {
    const data = await fetchJson(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`, { timeoutMs: 4500 });
    if (!Array.isArray(data)) return [];
    return data.slice(0, 14).map((entry) => {
      const show = entry && entry.show;
      if (!show || !show.id) return null;
      const imdb = show.externals && show.externals.imdb;
      const summary = String(show.summary || '').replace(/<[^>]+>/g, '').trim();
      const isAnime = String(show.type || '').toLowerCase() === 'animation'
        && String(show.language || '').toLowerCase() === 'japanese';
      return {
        id: imdb || `tvmaze:${show.id}`,
        type: 'series',
        name: cleanTitle(show.name || '') || show.name || '',
        poster: (show.image && (show.image.medium || show.image.original)) || '',
        background: (show.image && show.image.original) || '',
        releaseInfo: show.premiered ? String(show.premiered).slice(0, 4) : '',
        imdbRating: show.rating && show.rating.average ? Number(show.rating.average).toFixed(1) : undefined,
        description: summary,
        isAnime,
      };
    }).filter(Boolean);
  } catch (_) {
    return [];
  }
}

/**
 * Búsqueda unificada de películas, series y anime para /watch.
 */
async function searchWatch({ query, type = 'all', page = 1, lang } = {}) {
  const cleanQuery = String(query || '').trim().slice(0, 120);
  const safeType = ['all', 'movie', 'series', 'anime'].includes(type) ? type : 'all';
  const safePage = Math.max(1, Math.min(10, Number(page) || 1));

  if (cleanQuery.length < 2) {
    return { query: cleanQuery, type: safeType, page: safePage, results: [], totalResults: 0, source: 'empty' };
  }

  const effLang = lang || config.tmdbLanguage || 'es-MX';
  const cacheKey = `watch:search:v1:${safeType}:${safePage}:${effLang}:${config.tmdbConfigured ? 1 : 0}:${cleanQuery.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  return cache.coalesce(`load:${cacheKey}`, async () => {
    const again = cache.get(cacheKey);
    if (again) return again;

    let results = [];
    let totalResults = 0;
    let source = 'curated';

    if (config.tmdbConfigured) {
      source = 'tmdb';
      if (safeType === 'movie') {
        const data = await tmdb.tmdbGet('/search/movie', { query: cleanQuery, page: safePage, include_adult: 'false' }, 600, effLang);
        results = ((data && data.results) || []).map((item) => mapTmdbSearchItem(item, 'movie')).filter(Boolean);
        totalResults = Number((data && data.total_results) || results.length);
      } else if (safeType === 'series') {
        const data = await tmdb.tmdbGet('/search/tv', { query: cleanQuery, page: safePage, include_adult: 'false' }, 600, effLang);
        results = ((data && data.results) || []).map((item) => mapTmdbSearchItem(item, 'tv')).filter(Boolean);
        totalResults = Number((data && data.total_results) || results.length);
      } else if (safeType === 'anime') {
        const [tvData, movieData] = await Promise.all([
          tmdb.tmdbGet('/search/tv', { query: cleanQuery, page: safePage, include_adult: 'false' }, 600, effLang),
          tmdb.tmdbGet('/search/movie', { query: cleanQuery, page: safePage, include_adult: 'false' }, 600, effLang),
        ]);
        const combined = [
          ...((tvData && tvData.results) || []).map((item) => ({ raw: item, mapped: mapTmdbSearchItem(item, 'tv') })),
          ...((movieData && movieData.results) || []).map((item) => ({ raw: item, mapped: mapTmdbSearchItem(item, 'movie') })),
        ].filter((entry) => entry.mapped);
        const jpAnime = combined.filter((e) => e.mapped.isAnime);
        const anyAnim = combined.filter((e) => Array.isArray(e.raw.genre_ids) && e.raw.genre_ids.includes(16));
        const chosen = jpAnime.length ? jpAnime : (anyAnim.length ? anyAnim : combined);
        results = chosen
          .sort((a, b) => (b.mapped.popularity || 0) - (a.mapped.popularity || 0))
          .map((e) => e.mapped);
        totalResults = results.length;
      } else {
        const data = await tmdb.tmdbGet('/search/multi', { query: cleanQuery, page: safePage, include_adult: 'false' }, 600, effLang);
        results = ((data && data.results) || []).map((item) => mapTmdbSearchItem(item)).filter(Boolean);
        totalResults = Number((data && data.total_results) || results.length);
      }
    } else {
      // Sin clave de TMDB: Cinemeta + TVMaze + colección curada local.
      const qNorm = normalizeQuery(cleanQuery);
      const localMatches = ALL_CURATED.filter((item) => {
        if (safeType === 'movie' && item.type !== 'movie') return false;
        if (safeType === 'series' && item.type !== 'series') return false;
        if (safeType === 'anime' && !item.isAnime) return false;
        return normalizeQuery(item.name).includes(qNorm);
      });
      const [cm, tvm] = await Promise.all([
        searchViaCinemeta(cleanQuery, safeType === 'anime' ? 'all' : safeType),
        safeType === 'movie' ? Promise.resolve([]) : searchViaTvmaze(cleanQuery),
      ]);
      let remote = [...cm, ...tvm];
      if (safeType === 'anime') {
        const animOnly = remote.filter((item) => item.isAnime);
        if (animOnly.length) remote = animOnly;
      }
      results = dedupeResults([...localMatches, ...remote]);
      totalResults = results.length;
      source = remote.length ? 'fallback-live' : 'curated';
    }

    results = dedupeResults(results).slice(0, 30);
    const payload = { query: cleanQuery, type: safeType, page: safePage, results, totalResults, source };
    cache.set(cacheKey, payload, results.length ? 600 : 120);
    return payload;
  });
}

/**
 * Ficha enriquecida para /watch: usa core.handleMeta y, si el entorno no tiene
 * claves TMDB/OMDB, cae a Cinemeta + colección curada para mostrar siempre
 * póster, sinopsis y episodios.
 */
async function getWatchMeta(type, id, cfg = null) {
  const safeType = type === 'series' ? 'series' : 'movie';
  const cleanId = String(id || '').trim();
  const base = await core.handleMeta(safeType, cleanId, cfg);
  let meta = base && base.meta ? { ...base.meta } : { id: cleanId, type: safeType, name: cleanId };

  const needsEnrich = !meta.poster || !meta.name || meta.name === cleanId
    || (safeType === 'series' && (!Array.isArray(meta.videos) || !meta.videos.length));

  if (needsEnrich && /^tt\d+$/.test(cleanId)) {
    const cm = await cinemeta.lookup(safeType, cleanId, 4500).catch(() => null);
    if (cm) {
      meta = {
        ...cm,
        ...meta,
        name: (meta.name && meta.name !== cleanId) ? meta.name : (cm.name || cleanId),
        poster: meta.poster || cm.poster,
        background: meta.background || cm.background,
        description: (meta.description && !meta.description.startsWith('Metadatos no disponibles'))
          ? meta.description
          : (cm.description || meta.description),
        releaseInfo: meta.releaseInfo || cm.releaseInfo || (cm.year ? String(cm.year) : undefined),
        imdbRating: meta.imdbRating || cm.imdbRating,
        runtime: meta.runtime || cm.runtime,
        genre: (Array.isArray(meta.genre) && meta.genre.length) ? meta.genre : (cm.genres || cm.genre),
        director: meta.director || cm.director,
        cast: meta.cast || cm.cast,
        videos: (Array.isArray(meta.videos) && meta.videos.length) ? meta.videos : cm.videos,
      };
    }
  }

  const curated = CURATED_BY_ID.get(`${safeType}:${cleanId}`);
  if (curated) {
    if (!meta.name || meta.name === cleanId) meta.name = curated.name;
    if (!meta.poster) meta.poster = curated.poster;
    if (!meta.background) meta.background = curated.background;
    if (!meta.releaseInfo) meta.releaseInfo = curated.releaseInfo;
    if (!meta.imdbRating) meta.imdbRating = curated.imdbRating;
    if (!meta.genre || !meta.genre.length) meta.genre = curated.genre;
    if (!meta.description || meta.description.startsWith('Metadatos no disponibles')) {
      meta.description = curated.description;
    }
  }

  return { meta, cacheMaxAge: base && base.cacheMaxAge ? base.cacheMaxAge : 1800 };
}

module.exports = {
  buildWatchCatalogs,
  getWatchFallbackCatalog,
  searchWatch,
  getWatchMeta,
  CURATED_MOVIES,
  CURATED_SERIES,
  CURATED_ANIME_SERIES,
  CURATED_ANIME_MOVIES,
};
