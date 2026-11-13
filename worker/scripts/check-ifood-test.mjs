import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { ifoodConfigured, quoteDetails } from '../src/ifood-shipping.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const path = resolve(root, '.env.ifood-test');
const env = {};
for (const line of readFileSync(path, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (match) env[match[1]] = match[2];
}
if (!ifoodConfigured(env)) throw Error('Credenciais de teste inválidas.');

try {
  const auth = await fetch('https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grantType: 'client_credentials',
      clientId: env.IFOOD_CLIENT_ID, clientSecret: env.IFOOD_CLIENT_SECRET }),
  });
  const tokens = await auth.json();
  console.log('OAuth HTTP:', auth.status, 'token retornado:', Boolean(tokens.accessToken));
  if (!auth.ok || !tokens.accessToken) throw Error('Falha na autenticação de teste.');
  const merchantResponse = await fetch('https://merchant-api.ifood.com.br/merchant/v1.0/merchants/' + env.IFOOD_MERCHANT_ID, {
    headers: { Authorization: 'Bearer ' + tokens.accessToken, Accept: 'application/json' },
  });
  const merchant = await merchantResponse.json().catch(() => ({}));
  console.log('Merchant GET HTTP:', merchantResponse.status,
    'campos:', Object.keys(merchant).join(','));
  if (merchantResponse.ok) console.log('Localização de testes:', JSON.stringify({
    address: merchant.address, location: merchant.location,
  }).slice(0, 1000));
  const { latitude, longitude } = merchant.address || {};
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
    throw Error('Loja de teste sem coordenadas.');
  const route = '/shipping/v1.0/merchants/' + env.IFOOD_MERCHANT_ID +
    '/deliveryAvailabilities?latitude=' + (latitude + 0.002) +
    '&longitude=' + (longitude + 0.002);
  const response = await fetch('https://merchant-api.ifood.com.br' + route, {
    headers: { Authorization: 'Bearer ' + tokens.accessToken, Accept: 'application/json' },
  });
  const data = await response.json().catch(() => ({}));
  console.log('Shipping GET HTTP:', response.status,
    'campos:', data && typeof data === 'object' ? Object.keys(data).join(',') : '');
  if (!response.ok) {
    console.log('Resposta de erro:', JSON.stringify({ code: data.code, message: data.message,
      error: data.error, details: data.details, description: data.description }).slice(0, 700));
    process.exitCode = 1;
  } else {
    const quote = quoteDetails(data);
    console.log('Cotação validada:', (quote.feeCents / 100).toFixed(2),
      'BRL; expira:', quote.expiresAt);
    console.log('Métodos aceitos na cotação:', JSON.stringify(
      (data.paymentMethods || []).map(m => ({ method: m.method, paymentType: m.paymentType,
        brand: m.brand, liability: m.liability }))));
  }
} catch (error) {
  console.error('iFood test:', error.message);
  process.exitCode = 1;
}
