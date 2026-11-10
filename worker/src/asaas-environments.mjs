export const PAYMENT_MODES = new Set(['sandbox', 'production']);

export function paymentConfig(env, mode) {
  if (!PAYMENT_MODES.has(mode)) throw new Error('Ambiente de pagamento inválido.');
  const production = mode === 'production';
  return {
    mode,
    url: production ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3',
    key: production ? env.ASAAS_PRODUCTION_API_KEY : env.ASAAS_SANDBOX_API_KEY,
    webhookToken: production ? env.ASAAS_PRODUCTION_WEBHOOK_TOKEN : env.ASAAS_SANDBOX_WEBHOOK_TOKEN,
  };
}

// Read-only readiness flags. Credential values never leave the Worker.
export function paymentCredentialStatus(env, mode) {
  const cfg = paymentConfig(env, mode);
  const apiKeyConfigured = typeof cfg.key === 'string' &&
    cfg.key.length > 0 && !cfg.key.includes('NAO_CONFIGURADA');
  const webhookConfigured = typeof cfg.webhookToken === 'string' &&
    cfg.webhookToken.length >= 32;
  return {
    apiKeyConfigured,
    webhookConfigured,
    configured: apiKeyConfigured && webhookConfigured,
  };
}

export function paymentConfigured(env, mode) {
  return paymentCredentialStatus(env, mode).configured;
}

export function paymentReady(env, mode) {
  return Boolean(env.DB && env.PAYMENTS_ENABLED === 'true' && paymentConfigured(env, mode));
}
