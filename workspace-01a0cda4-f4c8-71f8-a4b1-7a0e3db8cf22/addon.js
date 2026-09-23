/**
 * Definición del Addon de Stremio: Manifest y Stream Handler
 * Conforme a las especificaciones oficiales de stremio-addon-sdk y Stremio Protocol v3
 */

const { addonBuilder } = require('stremio-addon-sdk');
const { supabase, isConfigured } = require('./lib/supabase');
const { formatRowToStream } = require('./lib/formatter');

// 1. CONFIGURACIÓN COMPLETA DEL MANIFEST (ESPECIFICACIÓN OFICIAL STREMIO)
const manifest = {
  id: 'org.comunidad.torrents.espanol',
  version: '1.0.0',
  name: 'Torrents Español HD',
  description: 'Catálogo y buscador de torrents filtrados estrictamente en Español Castellano, Español Latino, Dual y Subtitulado en Español directamente desde Supabase.',
  icon: 'https://cdn-icons-png.flaticon.com/512/3172/3172520.png',
  logo: 'https://cdn-icons-png.flaticon.com/512/3172/3172520.png', // Requerido por clientes móviles y Android TV
  background: 'https://dl.strem.io/bg.jpg',
  resources: ['stream'],
  types: ['movie', 'series', 'anime'],
  idPrefixes: ['tt'],
  catalogs: [], // Obligatorio según el linter del SDK cuando no hay catálogos
  behaviorHints: {
    configurable: false,
    configurationRequired: false,
    p2p: true // Indica a Stremio que el addon provee contenido distribuido BitTorrent
  }
};

const builder = new addonBuilder(manifest);

// 2. LÓGICA DEL HANDLER DE STREAMS (defineStreamHandler)
builder.defineStreamHandler(async (args) => {
  const { type, id } = args;

  console.log(`[StreamHandler] Recibida petición: type="${type}", id="${id}"`);

  // Validación de seguridad de los parámetros recibidos
  if (!type || !id || !['movie', 'series', 'anime'].includes(type)) {
    return { streams: [] };
  }

  // Verificación de credenciales de Supabase
  if (!isConfigured || !supabase) {
    console.error('[StreamHandler] Error: Supabase no está configurado (revisa SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).');
    return { streams: [] };
  }

  try {
    // 2.1 Procesamiento y parseo del ID de Stremio
    // Formatos esperados:
    //   - Películas: 'tt0111161' o 'tt0111161.json'
    //   - Series/Anime: 'tt0944947:1:5' o 'tt0944947%3A1%3A5' (imdb_id:season:episode)
    const rawId = (id || '').replace(/\.json$/, '');
    const decodedId = decodeURIComponent(rawId);
    const idParts = decodedId.split(':');
    const imdbId = idParts[0];

    // Comprobar que cumpla estrictamente con el prefijo IMDb 'tt'
    if (!imdbId || !imdbId.startsWith('tt')) {
      return { streams: [] };
    }

    const isSeriesOrAnime = type === 'series' || type === 'anime';
    const seasonNumber = idParts[1] ? parseInt(idParts[1], 10) : null;
    const episodeNumber = idParts[2] ? parseInt(idParts[2], 10) : null;
    const hasSeasonAndEpisode = isSeriesOrAnime && !isNaN(seasonNumber) && seasonNumber !== null && !isNaN(episodeNumber) && episodeNumber !== null;

    // 2.2 Consulta a la base de datos Supabase (tabla: public.torrents)
    let query = supabase
      .from('torrents')
      .select('*')
      .eq('imdb_id', imdbId);

    // Si es serie o anime con temporada y episodio especificados
    if (hasSeasonAndEpisode) {
      query = query
        .eq('season', seasonNumber)
        .eq('episode', episodeNumber);
    }

    // Ordenar por número de semillas (seeders DESC) y aplicar límite de seguridad (máximo 30)
    query = query
      .order('seeders', { ascending: false })
      .limit(30);

    const { data: rows, error } = await query;

    if (error) {
      console.error('[StreamHandler] Error en consulta Supabase:', error.message);
      return { streams: [] };
    }

    if (!rows || rows.length === 0) {
      console.log(`[StreamHandler] Sin torrents encontrados para IMDb: ${imdbId}${hasSeasonAndEpisode ? ` S${seasonNumber}E${episodeNumber}` : ''}`);
      return {
        streams: [],
        cacheMaxAge: 1800, // 30 minutos de caché en Vercel Edge para respuestas vacías
        staleRevalidate: 3600
      };
    }

    // 2.3 Mapeo de filas encontradas al formato oficial de Stream de Stremio
    const streams = rows
      .map(row => formatRowToStream(row))
      .filter(stream => stream !== null);

    console.log(`[StreamHandler] Enviando ${streams.length} stream(s) para ${imdbId}`);

    // Headers de caché para Vercel Edge Network y reproductor de Stremio
    return {
      streams,
      cacheMaxAge: 1800,       // 30 minutos en caché CDN / Edge
      staleRevalidate: 3600,   // Permitir servir mientras revalida por 1 hora
      staleError: 86400        // En caso de fallo transitorio, usar caché hasta 24 horas
    };

  } catch (err) {
    // Si la consulta o el procesamiento falla, responde limpiamente con { "streams": [] }
    console.error('[StreamHandler] Excepción no controlada:', err);
    return { streams: [] };
  }
});

// Exporta la interfaz del addon
module.exports = builder.getInterface();
