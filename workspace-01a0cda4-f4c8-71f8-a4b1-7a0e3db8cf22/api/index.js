/**
 * Servidor HTTP y Adaptador Serverless para Vercel
 * Expone la API oficial de Stremio con doble capa de enrutamiento resiliente,
 * soporte completo de CORS y Landing Page interactiva.
 */

const express = require('express');
const cors = require('cors');
const { getRouter } = require('stremio-addon-sdk');
const addonInterface = require('../addon');

const app = express();

// 1. Cabeceras HTTP de CORS obligatorias para el protocolo Stremio
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Responder a peticiones preflight OPTIONS inmediatamente con 204 No Content
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// Middleware CORS estándar de Express como capa de seguridad
app.use(cors({ origin: '*' }));

// 2. Normalizador de rutas para el entorno Serverless de Vercel
app.use((req, res, next) => {
  const matchedPath = req.headers['x-matched-path'];
  if (matchedPath && (req.url === '/api' || req.url === '/api/index.js' || req.url.startsWith('/api/index.js') || req.url.startsWith('/api?'))) {
    req.url = matchedPath;
  }
  next();
});

// 3. Landing Page visual interactiva en la raíz (/) para navegadores web
app.get(['/', '/api'], (req, res, next) => {
  const acceptHeader = req.headers['accept'] || '';
  if (acceptHeader.includes('application/json') && !acceptHeader.includes('text/html')) {
    return next();
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:7000';
  const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
  const manifestUrl = `${proto}://${host}/manifest.json`;
  const stremioDeepLink = `stremio://${host}/manifest.json`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${addonInterface.manifest.name} - Addon Stremio</title>
  <link rel="icon" href="${addonInterface.manifest.icon}" type="image/png">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #0f1016;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: #1a1c29;
      border: 1px solid #2d3248;
      border-radius: 16px;
      max-width: 620px;
      width: 100%;
      padding: 36px 30px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
      text-align: center;
    }
    .logo {
      width: 88px;
      height: 88px;
      border-radius: 20px;
      margin-bottom: 20px;
      border: 2px solid #6366f1;
      padding: 8px;
      background: #25283c;
    }
    h1 {
      font-size: 26px;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 8px;
    }
    .badge {
      display: inline-block;
      background: #059669;
      color: #ecfdf5;
      font-size: 12px;
      font-weight: 600;
      padding: 4px 12px;
      border-radius: 9999px;
      margin-bottom: 16px;
    }
    p.desc {
      color: #94a3b8;
      font-size: 15px;
      line-height: 1.6;
      margin-bottom: 24px;
    }
    .btn-install {
      display: inline-block;
      background: #6366f1;
      color: #ffffff;
      font-weight: 600;
      font-size: 16px;
      padding: 14px 32px;
      border-radius: 12px;
      text-decoration: none;
      transition: all 0.2s ease;
      box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);
      margin-bottom: 24px;
    }
    .btn-install:hover {
      background: #4f46e5;
      transform: translateY(-2px);
    }
    .manifest-box {
      background: #11131f;
      border: 1px solid #292e44;
      border-radius: 10px;
      padding: 12px;
      margin-bottom: 24px;
      text-align: left;
    }
    .manifest-box label {
      display: block;
      font-size: 12px;
      color: #818cf8;
      font-weight: 600;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .manifest-box input {
      width: 100%;
      background: transparent;
      border: none;
      color: #f1f5f9;
      font-family: monospace;
      font-size: 13px;
      outline: none;
    }
    .features {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      text-align: left;
      font-size: 13px;
      color: #cbd5e1;
      border-top: 1px solid #2d3248;
      padding-top: 20px;
    }
    .feature-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }
  </style>
</head>
<body>
  <div class="card">
    <img src="${addonInterface.manifest.icon}" alt="Logo" class="logo">
    <h1>${addonInterface.manifest.name}</h1>
    <span class="badge">● v${addonInterface.manifest.version} Online</span>
    <p class="desc">${addonInterface.manifest.description}</p>

    <a href="${stremioDeepLink}" class="btn-install">🚀 Instalar en Stremio</a>

    <div class="manifest-box">
      <label>URL del Manifest (para copiar y pegar):</label>
      <input type="text" readonly value="${manifestUrl}" onclick="this.select(); document.execCommand('copy'); alert('¡Enlace copiado al portapapeles!');">
    </div>

    <div class="features">
      <div class="feature-item">🇪🇸 Castellano & Latino</div>
      <div class="feature-item">⚡ 100% Serverless en Vercel</div>
      <div class="feature-item">🎬 Películas & Series</div>
      <div class="feature-item">🗄️ Backend Supabase PostgreSQL</div>
    </div>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// 4. Capa de Enrutamiento Explícito Fail-Safe para Entornos Serverless
// Garantiza respuesta instantánea incluso si Vercel modifica el prefijo o la ruta
app.get(['/manifest.json', '/api/manifest.json'], (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=3600, stale-while-revalidate=14400, public');
  res.end(JSON.stringify(addonInterface.manifest));
});

const handleStreamRequest = async (req, res) => {
  const { type, id, extra } = req.params;
  const cleanId = decodeURIComponent((id || '').replace(/\.json$/, ''));

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const extraObj = extra ? { extra } : {};
    const resp = await addonInterface.get('stream', type, cleanId, extraObj);

    if (resp.cacheMaxAge) {
      res.setHeader('Cache-Control', `max-age=${resp.cacheMaxAge}, stale-while-revalidate=${resp.staleRevalidate || 3600}, stale-if-error=${resp.staleError || 86400}, public`);
    }

    res.end(JSON.stringify(resp));
  } catch (err) {
    console.error('[API] Error al procesar recurso stream:', err);
    res.end(JSON.stringify({ streams: [] }));
  }
};

app.get('/stream/:type/:id.json', handleStreamRequest);
app.get('/api/stream/:type/:id.json', handleStreamRequest);
app.get('/stream/:type/:id/:extra.json', handleStreamRequest);
app.get('/api/stream/:type/:id/:extra.json', handleStreamRequest);

// 5. Router oficial de stremio-addon-sdk como capa primaria/respaldo
const addonRouter = getRouter(addonInterface);
app.use('/', addonRouter);
app.use('/api', addonRouter);

// 6. Manejador para rutas no existentes (404 limpio en formato JSON)
app.use((req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(404).json({ err: 'Endpoint no encontrado en este Addon' });
});

// Exportar la aplicación Express para que Vercel la ejecute como función Serverless
module.exports = app;
