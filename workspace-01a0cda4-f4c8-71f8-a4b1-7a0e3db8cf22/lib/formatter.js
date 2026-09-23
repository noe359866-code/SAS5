/**
 * Formateador y utilidades para construir los objetos Stream requeridos por Stremio
 * Cumple estrictamente con la especificación oficial de Stremio SDK
 */

const PUBLIC_TRACKERS = [
  'tracker:http://tracker.opentrackr.org:1337/announce',
  'tracker:udp://open.demonii.com:1337/announce',
  'tracker:udp://tracker.openbittorrent.com:6969/announce',
  'tracker:udp://tracker.coppersurfer.tk:6969/announce',
  'tracker:udp://glotorrents.pw:6969/announce',
  'tracker:udp://torrent.gresille.org:80/announce',
  'tracker:udp://p4p.arenabg.com:1337/announce',
  'tracker:udp://tracker.leechers-paradise.org:6969/announce'
];

/**
 * Decodifica una cadena Base32 a Hexadecimal (para hashes en formato base32)
 */
function base32ToHex(base32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  const cleanBase32 = (base32 || '').toUpperCase().replace(/=+$/, '');

  for (let i = 0; i < cleanBase32.length; i++) {
    const val = alphabet.indexOf(cleanBase32[i]);
    if (val === -1) return null;
    bits += val.toString(2).padStart(5, '0');
  }

  let hex = '';
  for (let i = 0; i + 4 <= bits.length; i += 4) {
    const chunk = bits.substring(i, i + 4);
    hex += parseInt(chunk, 2).toString(16);
  }

  return hex.substring(0, 40).toLowerCase();
}

/**
 * Extrae y valida el infoHash en formato hex de 40 caracteres
 */
function extractInfoHash(rawHash, magnetUrl) {
  if (rawHash && typeof rawHash === 'string') {
    let cleaned = rawHash.trim().replace(/^urn:btih:/i, '').replace(/[^a-zA-Z0-9]/g, '');
    if (/^[0-9a-fA-F]{40}$/.test(cleaned)) {
      return cleaned.toLowerCase();
    }
    if (/^[a-zA-Z2-7]{32}$/.test(cleaned)) {
      const converted = base32ToHex(cleaned);
      if (converted && converted.length === 40) return converted;
    }
  }

  if (magnetUrl && typeof magnetUrl === 'string') {
    // Buscar hash hex de 40 caracteres en magnet
    const hexMatch = magnetUrl.match(/xt=urn:btih:([0-9a-fA-F]{40})/i);
    if (hexMatch && hexMatch[1]) {
      return hexMatch[1].toLowerCase();
    }
    // Buscar hash base32 de 32 caracteres en magnet
    const b32Match = magnetUrl.match(/xt=urn:btih:([a-zA-Z2-7]{32})/i);
    if (b32Match && b32Match[1]) {
      const converted = base32ToHex(b32Match[1]);
      if (converted && converted.length === 40) return converted;
    }
  }

  return null;
}

/**
 * Formatea tamaños numéricos en bytes a formato legible en GB o MB
 */
function formatSize(size) {
  if (size === null || size === undefined || size === '') {
    return 'N/A';
  }

  if (typeof size === 'string') {
    if (/GB|MB|GiB|MiB/i.test(size)) {
      return size.trim();
    }
    const parsed = parseFloat(size.replace(/[^0-9.]/g, ''));
    if (!isNaN(parsed)) {
      size = parsed;
    } else {
      return size;
    }
  }

  if (typeof size === 'number' && !isNaN(size)) {
    // Si el valor numérico es pequeño (< 100), ya viene expresado en GB (ej. 2.45)
    if (size > 0 && size < 100) {
      return `${size.toFixed(2)} GB`;
    }
    // Si está en bytes
    const gigabytes = size / (1024 * 1024 * 1024);
    if (gigabytes >= 1) {
      return `${gigabytes.toFixed(2)} GB`;
    }
    const megabytes = size / (1024 * 1024);
    if (megabytes >= 1) {
      return `${megabytes.toFixed(1)} MB`;
    }
    return `${size} B`;
  }

  return 'N/A';
}

/**
 * Detecta la resolución a partir de las columnas o del título
 */
function detectResolution(row) {
  const directRes = row.resolution || row.quality;
  if (directRes && typeof directRes === 'string') {
    const clean = directRes.trim().toUpperCase();
    if (/4K|2160/i.test(clean)) return '4K';
    if (/1080/i.test(clean)) return '1080p';
    if (/720/i.test(clean)) return '720p';
    if (/480/i.test(clean)) return '480p';
  }

  const textToScan = `${row.title || ''} ${row.release_title || ''} ${row.raw_title || ''} ${row.name || ''}`;
  if (/4k|2160p|uhd/i.test(textToScan)) return '4K';
  if (/1080p|fhd/i.test(textToScan)) return '1080p';
  if (/720p|hd\b/i.test(textToScan)) return '720p';
  if (/480p|sd\b/i.test(textToScan)) return '480p';

  return '1080p';
}

/**
 * Detecta la etiqueta de idioma (Castellano, Latino, Dual, Subtitulado)
 */
function detectLanguage(row) {
  const textToScan = `${row.language || ''} ${row.languages || ''} ${row.audio || ''} ${row.title || ''} ${row.release_title || ''}`.toLowerCase();

  let tag = '[ESP]';
  let audioDesc = 'Castellano';
  let subsDesc = row.subtitles || row.subs || 'No especificado';

  const isLatino = /latino|latin|audio latino|es-la|\blat\b/.test(textToScan);
  const isDual = /dual|multi|castellano.*latino|latino.*castellano/.test(textToScan);
  const isVose = /vose|subtitulado|sub español|subtitulos|vos\b/.test(textToScan);
  const isCastellano = /castellano|español|spanish|\besp\b|\bspa\b/.test(textToScan);

  if (isDual) {
    tag = '[DUAL]';
    audioDesc = 'Dual (Castellano / Latino / Inglés)';
  } else if (isLatino) {
    tag = '[LAT]';
    audioDesc = 'Español Latino';
  } else if (isVose && !isCastellano) {
    tag = '[SUB]';
    audioDesc = row.audio || 'V.O. Original';
    subsDesc = 'Español';
  } else {
    tag = '[ESP]';
    audioDesc = 'Español Castellano';
  }

  if (row.audio && typeof row.audio === 'string') {
    audioDesc = row.audio;
  }
  if (row.subtitles && typeof row.subtitles === 'string') {
    subsDesc = row.subtitles;
  }

  return { tag, audioDesc, subsDesc };
}

/**
 * Detecta el códec de video
 */
function detectCodec(row) {
  const direct = row.codec || row.video_codec;
  if (direct && typeof direct === 'string') return direct.trim();

  const textToScan = `${row.title || ''} ${row.release_title || ''}`;
  if (/x265|hevc|h\.?265/i.test(textToScan)) return 'x265';
  if (/x264|avc|h\.?264/i.test(textToScan)) return 'x264';
  if (/av1/i.test(textToScan)) return 'AV1';
  if (/xvid|divx/i.test(textToScan)) return 'XviD';

  return 'x264';
}

/**
 * Detecta la fuente o tipo de rip
 */
function detectSource(row) {
  const direct = row.source || row.rip_type;
  if (direct && typeof direct === 'string') return direct.trim();

  const textToScan = `${row.title || ''} ${row.release_title || ''}`;
  if (/bluray|bdrip|brrip/i.test(textToScan)) return 'BluRay';
  if (/web-?dl/i.test(textToScan)) return 'WEB-DL';
  if (/webrip/i.test(textToScan)) return 'WEBRip';
  if (/hdtv|hdrip/i.test(textToScan)) return 'HDTV';
  if (/dvdrip/i.test(textToScan)) return 'DVDRip';
  if (/cam|telesync|ts/i.test(textToScan)) return 'CAM';

  return 'WEB-DL';
}

/**
 * Convierte una fila de la base de datos Supabase al objeto Stream oficial de Stremio
 */
function formatRowToStream(row) {
  const rawHash = row.info_hash || row.infoHash || row.hash || row.infohash;
  const magnet = row.magnet_url || row.magnetUrl || row.magnet;
  const infoHash = extractInfoHash(rawHash, magnet);

  // Si no hay hash ni magnet no es reproducible
  if (!infoHash && !magnet) {
    return null;
  }

  const resolution = detectResolution(row);
  const { tag, audioDesc, subsDesc } = detectLanguage(row);
  const codec = detectCodec(row);
  const source = detectSource(row);
  const seeders = row.seeders ?? row.seeds ?? 0;
  const rawSize = row.size_bytes ?? row.byte_size ?? row.size ?? row.file_size;
  const formattedSize = formatSize(rawSize);

  // Título original o nombre del release
  const releaseTitle = row.release_title || row.raw_title || row.title || row.name || 'Release HD';

  // 1. Nombre descriptivo en pantalla (ej. [ESP] 1080p o [LAT] 4K)
  const name = `${tag} ${resolution}`;

  // 2. Metadatos multilínea estructurados
  const titleLines = [
    `🎬 ${releaseTitle}`,
    `🔊 Audio: ${audioDesc} | 📝 Subs: ${subsDesc}`,
    `💾 Tamaño: ${formattedSize} | 👥 Seeders: ${seeders}`,
    `⚙️ Formato: ${source} ${codec}`
  ];

  const fullDescription = titleLines.join('\n');
  const streamObj = {
    name,
    title: fullDescription,
    description: fullDescription, // Compatibilidad presente y futura con Stremio
    behaviorHints: {
      bingeGroup: `torrents-esp-${resolution.toLowerCase()}`
    }
  };

  if (infoHash) {
    streamObj.infoHash = infoHash;
    streamObj.sources = [
      ...PUBLIC_TRACKERS,
      `dht:${infoHash}`
    ];
  } else if (magnet) {
    streamObj.magnetUrl = magnet;
  }

  const fileIdx = row.file_idx ?? row.fileIdx ?? row.file_index;
  if (fileIdx !== undefined && fileIdx !== null && !isNaN(parseInt(fileIdx, 10))) {
    streamObj.fileIdx = parseInt(fileIdx, 10);
  }

  return streamObj;
}

module.exports = {
  PUBLIC_TRACKERS,
  extractInfoHash,
  formatSize,
  detectResolution,
  detectLanguage,
  detectCodec,
  detectSource,
  formatRowToStream
};
