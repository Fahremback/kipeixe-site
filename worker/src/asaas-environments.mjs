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

export function paymentConfigured(env, mode) {
  const cfg = paymentConfig(env, mode);
  return Boolean(cfg.key && cfg.webhookToken &&
    !cfg.key.includes('NAO_CONFIGURADA') && cfg.webhookToken.length >= 32);
}

export function paymentReady(env, mode) {
  return Boolean(env.DB && env.PAYMENTS_ENABLED === 'true' && paymentConfigured(env, mode));
}
