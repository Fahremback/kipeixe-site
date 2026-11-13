import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/app.mjs';
import { clientConfig, handleAdmin, storeSettings, whatsappPhoneValid } from '../src/management.mjs';
import { DEFAULT_HOURS } from '../src/domain.mjs';

const origin = 'https://restaurantekipeixe.com.br';
const base = 'https://api.restaurantekipeixe.com.br';

function fixture(initial = {}) {
  const values = new Map([
    ['orders_enabled', 'true'], ['payments_enabled', 'true'], ['payment_mode', 'production'],
    ['delivery_enabled', 'false'], ['uber_enabled', 'false'], ['ifood_enabled', 'false'],
    ['delivery_provider', 'uber'], ['delivery_fee_cents', '0'],
    ...Object.entries(initial),
  ]);
  const db = {
    prepare(sql) {
      const key = /VALUES \('([^']+)',\?\)/.exec(sql)?.[1];
      return {
        first: async () => ({ username: 'owner', role: 'owner' }),
        all: async () => ({ results: [...values].map(([key, value]) => ({ key, value })) }),
        bind(...args) {
          return {
            first: async () => ({ username: 'owner', role: 'owner' }),
            run: async () => {
              if (key) values.set(key, String(args[0]));
              return { meta: { changes: 1 } };
            },
            all: async () => ({ results: [...values].map(([key, value]) => ({ key, value })) }),
          };
        },
      };
    },
    async batch(statements) { for (const statement of statements) await statement.run(); },
  };
  return { values, env: { DB: db, PAYMENTS_ENABLED: 'true' } };
}

function adminRequest(method, payload) {
  return new Request(base + '/api/admin/settings', {
    method,
    headers: { Origin: origin, Cookie: `kipeixe_session=${'f'.repeat(64)}`,
      'Content-Type': 'application/json' },
    body: payload && JSON.stringify(payload),
  });
}

test('WhatsApp is the default order channel even with Asaas payment flags enabled', async () => {
  const { env } = fixture();
  const settings = await storeSettings(env);
  assert.equal(settings.orderChannel, 'whatsapp');
  assert.equal(settings.whatsappNumber, '554535772363');
  const publicConfig = await clientConfig(env);
  assert.equal(publicConfig.orderChannel, 'whatsapp');
  assert.equal(publicConfig.acceptsOrders, true);
  assert.equal(publicConfig.onlinePaymentEnabled, false);
  assert.equal(publicConfig.whatsappNumber, '554535772363');
  const rejectCheckout = await worker.fetch(new Request(base + '/api/orders', {
    method: 'POST', headers: { Origin: origin }, body: '{}',
  }), env, { waitUntil() {} });
  assert.equal(rejectCheckout.status, 503);
});

test('only owner can update WhatsApp channel, number and manual delivery', async () => {
  const { values, env } = fixture();
  const read = await handleAdmin(adminRequest('GET'), env, origin,
    new URL(base + '/api/admin/settings'));
  assert.equal(read.status, 200);
  assert.equal((await read.json()).orderChannel, 'whatsapp');
  const data = {
    orderChannel: 'whatsapp', whatsappNumber: '5545999999999',
    ordersEnabled: true, deliveryEnabled: true, deliveryFeeCents: 0,
    deliveryProvider: 'uber', uberEnabled: false, ifoodEnabled: false,
    paymentMode: 'production', paymentsEnabled: true, hours: DEFAULT_HOURS,
  };
  const invalid = await handleAdmin(adminRequest('PUT', { ...data, whatsappNumber: 'https://evil.com' }),
    env, origin, new URL(base + '/api/admin/settings'));
  assert.equal(invalid.status, 422);
  const saved = await handleAdmin(adminRequest('PUT', data), env, origin,
    new URL(base + '/api/admin/settings'));
  assert.equal(saved.status, 200);
  assert.equal(values.get('order_channel'), 'whatsapp');
  assert.equal(values.get('whatsapp_number'), '5545999999999');
  const config = await clientConfig(env);
  assert.equal(config.deliveryEnabled, true);
  assert.equal(config.whatsappNumber, '5545999999999');
  assert.equal(config.onlinePaymentEnabled, false);
  const asaas = await handleAdmin(adminRequest('PUT', { ...data, orderChannel: 'asaas', deliveryEnabled: false }),
    env, origin, new URL(base + '/api/admin/settings'));
  assert.equal(asaas.status, 422);
  assert.match((await asaas.json()).error, /Asaas não configurado/);
  assert.equal(values.get('order_channel'), 'whatsapp');
});

test('WhatsApp numbers must have country code 55 and complete DDD', () => {
  assert.equal(whatsappPhoneValid('554535772363'), true);
  assert.equal(whatsappPhoneValid('5545999999999'), true);
  assert.equal(whatsappPhoneValid('5545123'), false);
  assert.equal(whatsappPhoneValid('https://wa.me/5545999999999'), false);
});
