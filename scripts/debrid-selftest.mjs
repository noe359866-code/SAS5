#!/usr/bin/env node
/**
 * Autocomprobación de credenciales debrid contra el proveedor REAL, usando el
 * mismo código que corre en el Worker (lib/torbox.js, lib/easyDebrid.js,
 * lib/premiumize.js, lib/realDebrid.js). Sirve para responder a «¿por qué no
 * validó mi clave de TorBox?» sin tocar el despliegue.
 *
 *   node scripts/debrid-selftest.mjs                          # muestra la ayuda
 *   DEBRID_KEY=xxxx node scripts/debrid-selftest.mjs torbox   # solo validar
 *   DEBRID_KEY=xxxx node scripts/debrid-selftest.mjs torbox --hash <infohash>
 *
 * Con `--hash` además comprueba la caché y pide un enlace (solo lectura: los
 * tres proveedores de API key consultan su caché; TorBox puede añadir el hit a
 * tu cuenta con add_only_if_cached=true, como hace el addon).
 *
 * La clave se lee SIEMPRE del entorno (nunca por argumentos, que se quedan en
 * el historial del shell y en `ps`).
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const shared = require('../lib/debridShared.js');
const providers = require('../lib/debridProviders.js');
const realDebrid = require('../lib/realDebrid.js');
const config = require('../lib/config.js');

config.reload({ DEBRID_VALIDATE_TIMEOUT_MS: '15000', DEBRID_TIMEOUT_MS: '10000' });

const KEY = String(process.env.DEBRID_KEY || '').trim();
const args = process.argv.slice(2);
const provider = (args.find((a) => !a.startsWith('--')) || '').toLowerCase();
const flag = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const hash = flag('hash');
const workerUrl = flag('url');

const USAGE = `Uso: DEBRID_KEY=<tu clave> node scripts/debrid-selftest.mjs <torbox|easydebrid|premiumize|realdebrid> [--hash <infohash>]

  La clave se pasa por variable de entorno para que no quede en el historial.
  TorBox:      API Key de https://torbox.app/settings (apartado «API key»).
  EasyDebrid:  token de la sección API de tu panel.
  Premiumize:  API key de https://www.premiumize.me/account (no el Customer ID).
  Real-Debrid: token OAuth (el addon usa OAuth; el token privado no se acepta
               en aplicaciones públicas y aquí solo se comprueba con /user).`;

if (!provider || !providers.PROVIDER_KEYS.includes(provider)) {
  console.log(USAGE);
  process.exit(provider ? 2 : 0);
}
if (!KEY) {
  console.error('Falta DEBRID_KEY. Ejemplo: DEBRID_KEY=xxxxx node scripts/debrid-selftest.mjs torbox');
  process.exit(2);
}

const token = shared.normalizeApiKey(KEY);
const shape = shared.apiKeyShapeError(token);
console.log(`· proveedor: ${provider}`);
console.log(`· clave: ${token.length} caracteres, formato ${shape ? `sospechoso (${shape})` : 'normal'}`);

/**
 * Modo «contra mi despliegue»: reproduce el POST que hace /configure. Es la
 * prueba que separa «mi clave está mal» de «el Worker no puede hablar con el
 * proveedor», porque el error que devuelve el Worker ya trae el código exacto.
 */
if (workerUrl) {
  const base = String(workerUrl).replace(/\/+$/, '');
  const target = `${base}/internal/debrid/connect`;
  try {
    const origin = new URL(base).origin;
    console.log(`· probando el despliegue: POST ${target}`);
    const response = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        Referer: `${base}/configure`,
      },
      // La clave se manda igual que desde /configure: nunca por la URL.
      body: JSON.stringify({ provider, token }),
    });
    const data = await response.json().catch(() => ({ raw: 'respuesta no JSON' }));
    const redacted = JSON.stringify(data, null, 2).split(token).join('‹clave›');
    console.log(`· HTTP ${response.status}`);
    console.log(redacted);
    if (data.ok) console.log('✅ El Worker validó la clave y guardó la credencial: vuelve a /configure y actualiza (el id ya debería estar puesto).');
    else if (data.code === 'provider_blocked' || data.code === 'provider_timeout' || data.code === 'provider_unreachable') {
      console.log('❌ El fallo es la comunicación Worker↔proveedor, no tu clave. Ejecuta el script SIN --url para comprobarlo desde tu máquina.');
    } else if (data.code === 'invalid_credential' || data.error === 'invalid_credential') {
      console.log('❌ El proveedor rechazó la clave también desde el Worker: la clave no vale (o la acabas de resetear).');
    } else if (data.error === 'debrid_not_configured') {
      console.log('❌ Al Worker le falta DEBRID_KV y/o DEBRID_ENCRYPTION_KEY: sin ellos no puede guardar ninguna credencial.');
    } else if (data.error === 'origin_not_allowed') {
      console.log('❌ El Worker no reconoce el origen. Usa el dominio exacto donde está desplegado.');
    }
    process.exit(response.ok ? 0 : 1);
  } catch (err) {
    console.error(`❌ No se pudo hablar con el Worker: ${err.message}`);
    process.exit(1);
  }
}

try {
  const account = provider === 'realdebrid'
    ? { provider: 'realdebrid', ...(await realDebrid.validateAccessToken(token)) }
    : await providers.validateCredential(provider, token);
  console.log('✅ El proveedor aceptó la clave.');
  if (account && account.warning === 'plan_inactive') {
    console.log('⚠️  La cuenta no muestra suscripción activa: el proveedor puede rechazar enlaces directos.');
  }
  if (hash) {
    const hit = { infoHash: hash, title: 'selftest', sources: [] };
    const adapter = providers.ADAPTERS[provider];
    if (provider === 'realdebrid') {
      console.log('· RD: buscando el hash en tu biblioteca personal…');
      const availability = await realDebrid.checkCached(token, 'selftest', [hit]);
      const entry = availability.get(hash.toLowerCase());
      console.log(entry ? '✅ El torrent está en tu biblioteca de RD.' : '❌ Ese hash no está descargado en tu cuenta de RD.');
    } else {
      console.log('· consultando la caché del proveedor…');
      const availability = await adapter.checkCached(token, 'selftest', [hit]);
      const entry = availability.get(hash.toLowerCase());
      if (!entry) {
        console.log('❌ El proveedor NO tiene ese hash cacheado (los streams caerán al magnet público).');
      } else {
        console.log('✅ Hit de caché:', JSON.stringify(entry.name || entry.filename || entry.hash || '').slice(0, 120));
        const stream = await adapter.resolveCached(token, 'selftest', hit, entry, { mediaType: 'movie' });
        if (stream) console.log('✅ Enlace directo obtenido:', stream.url.split('?')[0], '(los enlaces caducan rápido)');
        else console.log('❌ Hubo hit de caché pero el proveedor no devolvió un enlace: revisa la selección de archivos / límites de la cuenta.');
      }
    }
  }
} catch (err) {
  const diagnostic = shared.describeError(err);
  console.log(`❌ No se pudo validar la clave: ${diagnostic.message}`);
  if (diagnostic.providerStatus) console.log(`   estado HTTP del proveedor: ${diagnostic.providerStatus}`);
  if (diagnostic.providerMessage) console.log(`   mensaje del proveedor: ${diagnostic.providerMessage}`);
  const byCode = {
    invalid_credential: 'La clave la rechaza el propio proveedor: compruébala en su web, o regenérala.',
    provider_blocked: 'El bloqueo viene del borde (Cloudflare/anti-bot), no de tu clave. Desde esta máquina la llamada SÍ funciona: el problema es la red del Worker.',
    provider_timeout: 'El proveedor tardó más de lo permitido. Repite con la red más cerca o sube DEBRID_VALIDATE_TIMEOUT_MS.',
    provider_unreachable: 'No hay salida de red hacia el proveedor desde aquí.',
    provider_rate_limited: 'Límite de peticiones del proveedor alcanzado (TorBox 300/min, RD 250/min).',
    provider_endpoint_missing: 'El endpoint cambió: hay que actualizar el adaptador (informa de esto en el repo).',
    credential_format: 'La clave pegada tiene una forma rara (le faltan o le sobran caracteres).',
  };
  if (byCode[diagnostic.code]) console.log(`   → ${byCode[diagnostic.code]}`);
  process.exit(1);
}
