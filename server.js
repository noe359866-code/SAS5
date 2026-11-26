'use strict';

/** Arranque local: `npm start` (o `npm run dev` con nodemon). */

const app = require('./api/index');
const config = require('./lib/config');

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`\n🚀 ${config.addonName} escuchando en http://localhost:${config.port}`);
  console.log(`   Manifest:  http://localhost:${config.port}/manifest.json`);
  console.log(`   Health:    http://localhost:${config.port}/healthz`);
  console.log(`\n   Addon exclusivo de canales de TV en vivo.\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`El puerto ${config.port} está ocupado. Define PORT=otroPuerto en tu .env`);
    process.exit(1);
  }
  throw err;
});
