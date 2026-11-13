import test from 'node:test';
import assert from 'node:assert/strict';
import { createAsaasPix, checkedPixQrCode, pixPaymentMatches, pixRequestBody } from '../src/asaas-pix.mjs';
import worker from '../src/app.mjs';

const order = { id: '9bee4a35-7f6b-4ead-bd47-503c7c1cdcee', totalCents: 12000 };
const keyId = 'e1d2c3b4-1111-4222-8333-444444444444';
const qrId = 'c1d2c3b4-1111-4222-8333-444444444444';
const qrImage = 'a'.repeat(100);
const pixPayload = '000201' + 'a'.repeat(70);

test('Pix is tied to one order, exact amount, active key and 60-minute one-use validity', async t => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/pix/addressKeys?status=ACTIVE&limit=20'))
      return Response.json({ data: [{ id: keyId, status: 'ACTIVE' }] });
    if (url.endsWith('/pix/qrCodes/static'))
      return Response.json({ id: qrId, payload: pixPayload, encodedImage: qrImage });
    throw Error('Unexpected Asaas request');
  };
  const result = await createAsaasPix(order, { ASAAS_PRODUCTION_API_KEY: 'fake-secret' }, 'production');
  assert.deepEqual(result, { id: qrId, payload: pixPayload, encodedImage: qrImage });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.options.headers.access_token === 'fake-secret'));
  assert.equal(calls[1].url, 'https://api.asaas.com/v3/pix/qrCodes/static');
  const body = JSON.parse(calls[1].options.body);
  assert.deepEqual(body, pixRequestBody(order, keyId));
  assert.equal(body.value, 120);
  assert.equal(body.expirationSeconds, 3600);
  assert.equal(body.allowsMultiplePayments, false);
  assert.equal(body.externalReference, order.id);
  assert.ok(!JSON.stringify(body).includes('fake-secret'));
});

test('Pix cannot show fabricated or partial QR codes', async t => {
  assert.throws(() => checkedPixQrCode({ id: qrId, payload: pixPayload }), /incompleto/);
  assert.throws(() => checkedPixQrCode({ id: qrId, encodedImage: qrImage }), /incompleto/);
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => Response.json({ data: [] });
  await assert.rejects(createAsaasPix(order, { ASAAS_PRODUCTION_API_KEY: 'fake' }, 'production'),
    /cadastre e ative uma chave Pix/);
});

test('webhook only accepts a received Pix from the matching QR, amount and type', async () => {
  const row = { id: order.id, pix_qr_id: qrId, total_cents: order.totalCents,
    payment_status: 'PENDING', fulfillment_status: 'AWAITING_PAYMENT', scheduled_for: null };
  const payment = { id: 'pay_123456789', pixQrCodeId: qrId, value: 120,
    status: 'RECEIVED', billingType: 'PIX' };
  assert.equal(pixPaymentMatches(row, payment), true);
  assert.equal(pixPaymentMatches(row, { ...payment, value: 119.99 }), false);
  assert.equal(pixPaymentMatches(row, { ...payment, billingType: 'CREDIT_CARD' }), false);
  assert.equal(pixPaymentMatches(row, { ...payment, status: 'PENDING' }), false);
  assert.equal(pixPaymentMatches(row, { ...payment, pixQrCodeId: 'another' }), false);

  const updates = [];
  const env = { ASAAS_PRODUCTION_WEBHOOK_TOKEN: 'token_test_abcdefghijklmnop', DB: {
    prepare(sql) {
      return { bind(...params) { return {
        first: async () => row,
        run: async () => { updates.push({ sql, params }); return { meta: { changes: 1 } }; },
      }; } };
    },
  } };
  const ctx = { waitUntil() {} };
  const makeRequest = p => new Request('https://api.restaurantekipeixe.com.br/api/webhook/asaas/production', {
    method: 'POST', headers: { 'asaas-access-token': env.ASAAS_PRODUCTION_WEBHOOK_TOKEN },
    body: JSON.stringify({ id: 'evt_pix_1', event: 'PAYMENT_RECEIVED', payment: p }),
  });
  const denied = await worker.fetch(makeRequest({ ...payment, value: 115 }), env, ctx);
  assert.equal(denied.status, 422);
  assert.equal(updates.length, 0);
  const accepted = await worker.fetch(makeRequest(payment), env, ctx);
  assert.equal(accepted.status, 200);
  assert.equal(updates.length, 2);
  assert.match(updates[1].sql, /payment_id=\?/);
  assert.equal(updates[1].params[0], payment.id);
  assert.equal(updates[1].params.at(-1), order.id);
});
