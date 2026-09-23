/**
 * Cliente de conexión a Supabase con @supabase/supabase-js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL || '';
// Se prioriza SERVICE_ROLE_KEY para omitir restricciones de RLS en backend, o ANON_KEY si RLS está abierto
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

const isConfigured = Boolean(
  supabaseUrl &&
  supabaseKey &&
  supabaseUrl.startsWith('http')
);

if (!isConfigured) {
  console.warn('[Supabase] ⚠️ Advertencia: SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no están configuradas.');
  console.warn('[Supabase] ℹ️ Configura tus variables de entorno en el panel de Vercel o en tu archivo .env local.');
}

// Inicialización del cliente Supabase
// En entornos serverless se desactiva autoRefreshToken y persistSession
const supabase = isConfigured
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    })
  : null;

module.exports = {
  supabase,
  isConfigured
};
