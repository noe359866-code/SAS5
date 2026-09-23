/**
 * Servidor para ejecución en entorno local de desarrollo
 * Ejecutar con: npm start  o  node server.js
 */

require('dotenv').config();
const app = require('./api/index');

const PORT = process.env.PORT || 7000;

const server = app.listen(PORT, () => {
  const host = `http://localhost:${PORT}`;
  console.log('\n========================================================');
  console.log('  🚀 Addon Stremio: Torrents Español HD (Local Dev)');
  console.log('========================================================');
  console.log(`  🌐 Landing Page:          ${host}`);
  console.log(`  📋 Manifest URL:          ${host}/manifest.json`);
  console.log(`  🔗 Stremio Install Link:  stremio://localhost:${PORT}/manifest.json`);
  console.log(`  🧪 Test Película (IMDb):  ${host}/stream/movie/tt0111161.json`);
  console.log(`  🧪 Test Serie (IMDb):     ${host}/stream/series/tt0944947:1:1.json`);
  console.log('========================================================\n');
});

// Manejo de señales de terminación
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
