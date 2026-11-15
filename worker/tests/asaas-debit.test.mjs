import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validCpfCnpj, validInvoiceUrl, asaasDebitInvoicePayload,
  createDebitInvoice, invoicePaymentMatches,
} from '../src/asaas-debit.mjs';
import worker from '../src/app.mjs';

const id = '01234567-89ab-4cde-8f01-234567890abc';
const paymentId = 'pay_debit_test_1234567890';
const order = {
  id, name: 'Teste de Débito', phone: '45999999999', totalCents: 2300,
};
const invoiceUrl = 'https://www.asaas.com/i/123456789012345';

test('valid CPF/CNPJ checks digits, rejects invalid numbers and mask variants', () => {
  assert.equal(validCpfCnpj('529.982.247-25'), true);
  assert.equal(validCpfCnpj('52998224725'), true);
  assert.equal(validCpfCnpj('11.222.333/0001-81'), true);
  for (const value of ['', '11111111111', '52998224724', '11222333000180', '1234567'])
    assert.equal(validCpfCnpj(value), false, value);
});

test('debit uses invoice billingType and Asaas-only HTTPS URL', () => {
  const data = asaasDebitInvoicePayload(order, 'cus_1234567890');
  assert.equal(data.billingType, 'CREDIT_CARD');
  assert.equal(data.externalReference, id);
  assert.equal(data.value, 23);
  assert.match(data.dueDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(validInvoiceUrl(invoiceUrl, 'production'));
  assert.ok(validInvoiceUrl('https://sandbox.asaas.com/i/1234567', 'sandbox'));
  for (const url of [
    'http://www.asaas.com/i/123', 'https://asaas.com.evil.test/i/123',
    'https://www.asaas.com/checkoutSession/show?id=123',
    'https://www.asaas.com/i/123?next=https://evil.test',
  ]) assert.equal(validInvoiceUrl(url, 'production'), false);
});

test('debit customer and payable invoice created via Asaas; no card details sent', async t => {
  const old = globalThis.fetch;
  t.after(() => { globalThis.fetch = old; });
  const sent = [];
  globalThis.fetch = async (url, options) => {
    if (url.includes('/customers?')) {
      sent.push({ url, method: 'GET' });
      return Response.json({ data: [] });
    }
    sent.push({ url, ...JSON.parse(options.body) });
    if (url.endsWith('/customers')) return Response.json({ id: 'cus_1234567890' });
    if (url.endsWith('/payments')) return Response.json({
      id: paymentId, invoiceUrl, externalReference: id,
    });
    throw Error('Unexpected URL');
  };
  const env = { ASAAS_PRODUCTION_API_KEY: 'test-api-key' };
  const result = await createDebitInvoice(order, '52998224725', env, 'production');
  assert.deepEqual(result, { paymentId, checkoutUrl: invoiceUrl });
  assert.equal(sent[0].method, 'GET');
  assert.equal(sent[1].cpfCnpj, '52998224725');
  assert.equal(sent[1].name, order.name);
  assert.equal(sent[1].notificationDisabled, true);
  assert.equal(sent[2].externalReference, id);
  assert.equal(sent[2].billingType, 'CREDIT_CARD');
  assert.equal(sent[2].value, 23);
  assert.equal(JSON.stringify(sent).includes('creditCardNumber'), false);
});

test('known CPF reuses existing Asaas customer instead of creating duplicate', async t => {
  const old = globalThis.fetch;
  t.after(() => { globalThis.fetch = old; });
  const paths = [];
  globalThis.fetch = async (url) => {
    paths.push(url);
    if (url.includes('customers?')) return Response.json({
      data: [{ id: 'cus_existing123456', cpfCnpj: '52998224725' }],
    });
    if (url.endsWith('/payments')) return Response.json({
      id: paymentId, invoiceUrl, externalReference: id,
    });
    throw Error('Customer should not be created');
  };
  const result = await createDebitInvoice(order, '529.982.247-25',
    { ASAAS_PRODUCTION_API_KEY: 'test-api-key' }, 'production');
  assert.equal(result.paymentId, paymentId);
  assert.equal(paths.length, 2);
});

test('new debit customers also receive verified delivery address without fake email', async t => {
  const old = globalThis.fetch;
  t.after(() => { globalThis.fetch = old; });
  let customerBody;
  globalThis.fetch = async (url, options) => {
    if (url.includes('/customers?')) return Response.json({ data: [] });
    if (url.endsWith('/customers')) {
      customerBody = JSON.parse(options.body);
      return Response.json({ id: 'cus_1234567890' });
    }
    if (url.endsWith('/payments')) return Response.json({
      id: paymentId, invoiceUrl, externalReference: id,
    });
    throw Error('Unexpected route');
  };
  await createDebitInvoice({
    ...order, type: 'Entrega', ifoodAddress: {
      streetName: 'Rua das Palmeiras', streetNumber: '121', neighborhood: 'Centro',
      postalCode: '85850000', city: 'Foz do Iguaçu',
    },
  }, '52998224725', { ASAAS_PRODUCTION_API_KEY: 'test-api-key' }, 'production');
  assert.equal(customerBody.address, 'Rua das Palmeiras');
  assert.equal(customerBody.addressNumber, 121);
  assert.equal(customerBody.province, 'Centro');
  assert.equal(customerBody.postalCode, '85850000');
  assert.equal(customerBody.email, undefined);
  assert.equal(customerBody.city, undefined); // City is not accepted by customer creation.
});

test('payment matching rejects wrong reference, mismatch amount or status', () => {
  const dbOrder = {
    id, payment_id: paymentId, checkout_id: null, pix_qr_id: null, total_cents: 2300,
  };
  const payment = { id: paymentId, externalReference: id, billingType: 'CREDIT_CARD',
    value: 23, status: 'CONFIRMED' };
  assert.equal(invoicePaymentMatches(dbOrder, payment), true);
  assert.equal(invoicePaymentMatches(dbOrder, { ...payment, billingType: 'DEBIT_CARD' }), true);
  assert.equal(invoicePaymentMatches(dbOrder, { ...payment, status: 'PENDING' }), false);
  assert.equal(invoicePaymentMatches(dbOrder, { ...payment, value: 23.01 }), false);
  assert.equal(invoicePaymentMatches(dbOrder, { ...payment, externalReference: 'different' }), false);
  assert.equal(invoicePaymentMatches({ ...dbOrder, checkout_id: 'checkout-id' }, payment), false);
});

test('authenticated PAYMENT_CONFIRMED marks only matched debit invoice paid', async () => {
  const queries = [];
  const env = {
    ASAAS_PRODUCTION_WEBHOOK_TOKEN: 'whsec_test_valid_abcdefghijklmnopqrstuvwxyz123',
    DB: {
      prepare(sql) {
        return {
          bind(...params) {
            return {
              first: async () => ({ id, payment_id: paymentId, checkout_id: null,
                pix_qr_id: null, total_cents: 2300, phone: '45999999999',
                payment_status: 'PENDING', fulfillment_status: 'AWAITING_PAYMENT',
                scheduled_for: null, created_at: new Date().toISOString() }),
              run: async () => { queries.push({ sql, params }); return { meta: { changes: 1 } }; },
            };
          },
        };
      },
    },
  };
  const payment = { id: paymentId, externalReference: id, billingType: 'CREDIT_CARD',
    value: 23, status: 'CONFIRMED' };
  const response = await worker.fetch(new Request(
    'https://api.restaurantekipeixe.com.br/api/webhook/asaas/production', {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        'asaas-access-token': env.ASAAS_PRODUCTION_WEBHOOK_TOKEN },
      body: JSON.stringify({ id: 'evt_debit_test_1', event: 'PAYMENT_CONFIRMED', payment }),
    }), env, { waitUntil() {} });
  assert.equal(response.status, 200);
  assert.ok(queries.some(query => query.sql.includes("payment_status='PAID'")));
  assert.ok(queries.some(query => query.sql.includes('webhook_events')));
});
