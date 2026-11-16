'use strict';

/**
 * Lógica común de `POST /internal/debrid/connect`, compartida por el Worker de
 * Cloudflare (worker.mjs) y el servidor Express/Vercel (api/index.js).
 *
 * Aquí se decide, en un único sitio:
 *  - cómo se normaliza la clave pegada (espacios, comillas, prefijo «Bearer »);
 *  - qué comprobaciones se hacen antes de llamar al proveedor;
 *  - y, sobre todo, QUÉ SE LE DICE AL USUARIO cuando algo falla. Un timeout,
 *    un bloqueo anti-bots de Cloudflare, un 404 de un endpoint movido y una
 *    clave inválida son cuatro cosas distintas y cada una merece su aviso.
 *
 * Nunca se devuelven URL, cuerpos crudos ni la clave: solo códigos y el
 * mensaje público del proveedor.
 */

const credentials = require('./debridCredentials');
const providers = require('./debridProviders');
const shared = require('./debridShared');

const API_KEY_PROVIDERS = ['torbox', 'easydebrid', 'premiumize'];

// Dónde está la clave de cada proveedor: la mayoría de rechazos son una clave
// equivocada (token de sesión, Customer ID, clave cortada al copiar).
const KEY_HINTS = {
  torbox: 'En TorBox es la «API Key» de torbox.app/settings (apartado API), no el token de sesión del navegador. Si la acabas de resetear, espera un minuto.',
  easydebrid: 'En EasyDebrid copia el token de la sección API de tu panel, completo y sin espacios.',
  premiumize: 'En Premiumize usa la API key de premiumize.me/account; el Customer ID por sí solo no autentica.',
};

const STATUS_BY_CODE = {
  invalid_credential: 400,
  provider_rate_limited: 429,
  provider_blocked: 502,
  provider_endpoint_missing: 502,
};

const SHAPE_MESSAGES = {
  empty: 'No has pegado ninguna clave.',
  too_short: (provider, length) => `La clave tiene ${length} caracteres: es demasiado corta para ${provider}. Copia la API Key completa desde tu cuenta.`,
  too_long: 'La clave supera los 256 caracteres: parece que has pegado otra cosa (una URL, un magnet…).',
  has_control_chars: 'La clave contiene caracteres de control; vuelve a copiarla desde la web del proveedor.',
};

/**
 * Valida la clave contra el proveedor y guarda la credencial cifrada.
 * Devuelve `{ status, payload }` —sin Response ni res— para que cada runtime
 * lo envuelva como le apetezca.
 *
 * @param {{provider?: string, token?: string}} body
 * @param {{ env?: object, storageMessage?: string }} [options]
 */
async function connect(body, { env, storageMessage } = {}) {
  const provider = String((body && body.provider) || '').trim().toLowerCase();
  if (provider === 'realdebrid') {
    return { status: 400, payload: { error: 'oauth_required', message: 'Real-Debrid debe conectarse mediante OAuth; no pegues tu token API privado.' } };
  }
  if (!API_KEY_PROVIDERS.includes(provider)) {
    return { status: 400, payload: { error: 'provider_invalid', message: 'Elige TorBox, EasyDebrid o Premiumize (Real-Debrid va por OAuth).' } };
  }
  const runtimeEnv = env || undefined;
  if (!credentials.isConfigured(runtimeEnv)) {
    return {
      status: 503,
      payload: {
        error: 'debrid_not_configured',
        message: storageMessage || 'El servidor debe configurar DEBRID_ENCRYPTION_KEY y un almacenamiento debrid (KV de Cloudflare o su Cache API).',
      },
    };
  }
  // Se normaliza ANTES de medir la longitud: pegar la clave con un salto de
  // línea, comillas o el prefijo «Bearer » es lo más común.
  const token = shared.normalizeApiKey(body && body.token);
  const shape = shared.apiKeyShapeError(token);
  if (shape) {
    const template = SHAPE_MESSAGES[shape];
    // Nombre de marca, no la clave interna: «demasiado corta para TorBox», no
    // «…para torbox».
    const label = ({ torbox: 'TorBox', easydebrid: 'EasyDebrid', premiumize: 'Premiumize' })[provider] || provider;
    const message = typeof template === 'function' ? template(label, token.length) : template;
    return { status: 400, payload: { error: 'credential_format', code: shape, message } };
  }
  try {
    const account = await providers.validateCredential(provider, token);
    const result = await credentials.createCredential({ provider, token }, runtimeEnv);
    // Solo datos no sensibles de la cuenta (plan/caducidad), para avisar en
    // /configure cuando la clave es válida pero la suscripción no acompaña.
    return {
      status: 200,
      payload: {
        ok: true,
        credentialId: result.credentialId,
        provider: result.provider,
        warning: (account && account.warning) || null,
        account: account && account.subscribed === undefined ? null : {
          subscribed: account.subscribed,
          expiresAt: account.expiresAt || null,
          plan: account.plan ?? null,
        },
      },
    };
  } catch (err) {
    if (err && (err.code === 'debrid_storage_not_configured' || err.code === 'debrid_encryption_not_configured')) {
      return {
        status: 503,
        payload: {
          error: 'debrid_not_configured',
          message: storageMessage || 'El servidor debe configurar DEBRID_ENCRYPTION_KEY y un almacenamiento debrid (KV de Cloudflare o su Cache API).',
        },
      };
    }
    if (err && err.code === 'provider_invalid') {
      return { status: 400, payload: { error: 'provider_invalid', message: 'Proveedor no soportado.' } };
    }
    if (err && err.code === 'oauth_required') {
      return { status: 400, payload: { error: 'oauth_required', message: 'Real-Debrid debe conectarse mediante OAuth.' } };
    }
    const diagnostic = shared.describeError(err);
    const hint = diagnostic.code === 'invalid_credential' ? KEY_HINTS[provider] : undefined;
    console.error(`[Debrid] validación rechazada: ${diagnostic.code}${diagnostic.providerStatus ? ` (HTTP ${diagnostic.providerStatus})` : ''}.`);
    return {
      status: STATUS_BY_CODE[diagnostic.code] || 502,
      payload: {
        error: diagnostic.code === 'invalid_credential' ? 'invalid_credential' : 'debrid_unavailable',
        code: diagnostic.code,
        message: diagnostic.message + (hint ? ` ${hint}` : ''),
        providerStatus: diagnostic.providerStatus,
        // Código propio del proveedor (p. ej. TorBox `BAD_TOKEN` o el
        // `error_code` 37 de Real-Debrid): ayuda a reportar el fallo.
        providerCode: diagnostic.providerCode,
        providerMessage: diagnostic.providerMessage,
      },
    };
  }
}

module.exports = { connect, API_KEY_PROVIDERS, KEY_HINTS, shared };
