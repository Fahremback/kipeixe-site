import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/app.mjs';

test('checkout-created webhook recovers a REVIEW order after lost checkout response', async () => {
  const id = '7d0987c9-b92a-4a11-97f5-81d56df64c6f';
  const checkoutId = 'a2b3c4d5-e6f7-4890-b123-ccddeeff0011';
  const updates = [];
  const env = {
    ASAAS_PRODUCTION_WEBHOOK_TOKEN: 'whsec_test_valid_abcdefghijklmnopqrstuvwxyz123',
    DB: {
      prepare(sql) {
        return {
          bind(...params) {
            return {
              first: async () => {
                assert.match(sql, /FROM orders/);
                return { id, checkout_id: null, payment_status: 'REVIEW',
                  fulfillment_status: 'AWAITING_PAYMENT', scheduled_for: null };
              },
              run: async () => {
                updates.push({ sql, params });
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    },
  };
  const payload = {
    id: 'evt_test_20261112_1',
    event: 'CHECKOUT_CREATED',
    checkout: { id: checkoutId, externalReference: id },
  };
  const req = new Request('https://api.restaurantekipeixe.com.br/api/webhook/asaas/production', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'asaas-access-token': env.ASAAS_PRODUCTION_WEBHOOK_TOKEN,
    },
    body: JSON.stringify(payload),
  });
  const response = await worker.fetch(req, env, { waitUntil() {} });
  assert.equal(response.status, 200);
  assert.equal(updates.length, 2);
  assert.match(updates[0].sql, /webhook_events/);
  assert.match(updates[1].sql, /checkout_url/);
  assert.deepEqual(updates[1].params, [
    checkoutId,
    'https://asaas.com/checkoutSession/show?id=' + checkoutId,
    id,
  ]);
});
