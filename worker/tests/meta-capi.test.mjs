import test from 'node:test';
import assert from 'node:assert/strict';
import { META_PIXEL_ID, makeMetaOrderEvent, sendMetaOrderEvent } from '../src/meta-capi.mjs';

const orderId = 'a8402541-611d-4489-8720-d773e38e668f';
const sample = { name: 'InitiateCheckout', orderId, amountCents: 11200,
  clientIp: '203.0.113.10', userAgent: 'Kipeixe-Order-Test' };

test('CAPI only sends verified payment events in production with a secret', async () => {
  assert.equal(await sendMetaOrderEvent({}, { ...sample, paymentMode: 'production' }), false);
  assert.equal(await sendMetaOrderEvent({ META_CAPI_ACCESS_TOKEN: 'fake' },
    { ...sample, paymentMode: 'sandbox' }), false);
});

test('real checkout sends minimal browser matching data and correct value', async () => {
  const e = await makeMetaOrderEvent(sample);
  assert.equal(e.event_name, 'InitiateCheckout');
  assert.equal(e.custom_data.value, 112);
  assert.equal(e.custom_data.currency, 'BRL');
  assert.equal(e.event_id, `InitiateCheckout:${orderId}`);
  assert.equal(e.user_data.client_ip_address, '203.0.113.10');
  assert.equal(e.user_data.client_user_agent, 'Kipeixe-Order-Test');
  assert.equal(e.user_data.ph, undefined);
});

test('paid order hashes phone; never sends raw number or customer identity', async () => {
  const event = await makeMetaOrderEvent({
    name: 'Purchase', orderId, amountCents: 5500, phone: '45 99999-9999',
  });
  assert.equal(event.event_name, 'Purchase');
  assert.equal(event.custom_data.value, 55);
  assert.match(event.user_data.ph[0], /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(event), /99999/);
});

test('rejects fabricated payment event names, prices, and missing matching identifiers', async () => {
  await assert.rejects(makeMetaOrderEvent({ ...sample, name: 'CustomPurchase' }), /Invalid/);
  await assert.rejects(makeMetaOrderEvent({ ...sample, amountCents: 0 }), /Invalid/);
  await assert.rejects(makeMetaOrderEvent({ ...sample, clientIp: '', userAgent: '' }), /matching/);
});

test('CAPI sends over POST and does not put token in URL', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  try {
    globalThis.fetch = async (url, options) => {
      called = true;
      assert.ok(url.endsWith(`/${META_PIXEL_ID}/events`));
      assert.doesNotMatch(url, /secret/);
      assert.equal(options.method, 'POST');
      const payload = JSON.parse(options.body);
      assert.equal(payload.access_token, 'test-secret');
      assert.equal(payload.data[0].event_name, 'InitiateCheckout');
      return { ok: true, status: 200 };
    };
    assert.equal(await sendMetaOrderEvent({ META_CAPI_ACCESS_TOKEN: 'test-secret' },
      { ...sample, paymentMode: 'production' }), true);
    assert.equal(called, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
