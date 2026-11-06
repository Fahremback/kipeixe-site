import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ifoodConfigured, ifoodReady, validateAddress, addressText, quoteDetails,
  quoteIFood, registerPayload, trackingUrl, dispatchIFood, syncIFoodEvents,
} from '../src/ifood-shipping.mjs';

const merchantId = '66b9cfe4-1e46-41ab-a326-e9c8dd07d374';
const clientId = 'e858424c-d688-44ca-bb40-7d2746e949fb';
const quoteId = 'a27eb986-2878-4c09-988b-256b9bbf53b0';
const orderId = '6319de01-6bd1-4de8-9471-e7a1d9c67c1f';
const deliveryId = 'e586a2e7-7629-4509-b42b-24f1f48643ef';
const env = { IFOOD_CLIENT_ID: clientId, IFOOD_CLIENT_SECRET: 'local-test-secret-not-production',
  IFOOD_MERCHANT_ID: merchantId, IFOOD_SHIPPING_ENABLED: 'true' };
const address = { postalCode: '85851000', streetName: 'Rua das Palmeiras',
  streetNumber: '123', neighborhood: 'Centro',
  city: 'Foz do Iguaçu', latitude: -25.5365, longitude: -54.5870 };
const quote = (fee = 7.99) => ({
  id: quoteId, expirationAt: new Date(Date.now() + 22 * 3600_000).toISOString(),
  quote: { netValue: fee }, preparationTime: 900,
});
const order = () => ({ id: orderId, name: 'Cliente Kipeixe', phone: '45987654321',
  payment_status: 'PAID', fulfillment_status: 'READY', order_type: 'Entrega',
  subtotal_cents: 5500, delivery_cents: 850, ifood_status: 'QUOTED',
  ifood_order_id: null, scheduled_for: null, ifood_address_json: JSON.stringify(validateAddress(address)),
  items_json: JSON.stringify([{ name: 'Tilápia', qty: 1, unitCents: 5500 }]) });

function database(row = order()) {
  const operations = [];
  return {
    operations,
    prepare(sql) {
      const query = { bind(...args) { this.args = args; return this; },
        async first() { return row; },
        async run() { operations.push({ sql, args: this.args }); return { meta: { changes: 1 } }; } };
      return query;
    },
  };
}

test('iFood only becomes available with explicit opt-in and credentials', () => {
  assert.equal(ifoodConfigured({}), false);
  assert.equal(ifoodConfigured(env), true);
  assert.equal(ifoodReady(env, { ifoodEnabled: false, deliveryEnabled: true }), false);
  assert.equal(ifoodReady(env, { ifoodEnabled: true, deliveryEnabled: true }), true);
  assert.equal(ifoodReady({ ...env, IFOOD_SHIPPING_ENABLED: 'false' },
    { ifoodEnabled: true, deliveryEnabled: true }), false);
});

test('validates CEP, house number, Foz location and formats address', () => {
  assert.equal(validateAddress(address).postalCode, '85851000');
  assert.match(addressText(address), /CEP 85851000, Foz do Iguaçu - PR/);
  assert.throws(() => validateAddress({ ...address, latitude: -23.5 }), /Foz do Iguaçu/);
  assert.throws(() => validateAddress({ ...address, streetNumber: '' }), /CEP/);
  assert.throws(() => validateAddress({ ...address, postalCode: '123' }), /CEP/);
});

test('converts iFood reais to cents and rejects stale, negative or malformed quotes', () => {
  assert.equal(quoteDetails(quote()).feeCents, 799);
  assert.equal(quoteDetails(quote(7.995)).feeCents, 800);
  assert.throws(() => quoteDetails(quote(-1)), /frete iFood/);
  assert.throws(() => quoteDetails({ ...quote(), id: 'bad-id' }), /Cotação/);
  assert.throws(() => quoteDetails({ ...quote(),
    expirationAt: new Date(Date.now() - 1000).toISOString() }), /Cotação/);
});

test('builds complete outside-iFood order, without sending Asaas payment twice', () => {
  const payload = registerPayload(order(), { externalQuoteId: quoteId, feeCents: 799 }, address);
  assert.equal(payload.customer.phone.countryCode, '55');
  assert.equal(payload.customer.phone.areaCode, '45');
  assert.equal(payload.customer.phone.number, '987654321');
  assert.equal(payload.delivery.merchantFee, 7.99);
  assert.equal(payload.delivery.quoteId, quoteId);
  assert.equal(payload.delivery.deliveryAddress.postalCode, address.postalCode);
  assert.equal(payload.delivery.deliveryAddress.coordinates.latitude, address.latitude);
  assert.equal(payload.items[0].unitPrice, 55);
  assert.equal(payload.items[0].quantity, 1);
  assert.equal('payments' in payload, false);
  assert.equal('preparationTime' in payload.delivery, false);
});

test('accepts only trusted iFood HTTPS tracking destinations', () => {
  assert.equal(trackingUrl('https://meupedido.ifood.com.br/' + deliveryId),
    'https://meupedido.ifood.com.br/' + deliveryId);
  assert.equal(trackingUrl('https://meupedido.ifood.com.br.evil.example/'), null);
  assert.equal(trackingUrl('http://meupedido.ifood.com.br/'), null);
});

test('uses real iFood OAuth, quote and dispatch endpoint shapes with a mocked network', async () => {
  const oldFetch = globalThis.fetch, calls = [], db = database();
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/oauth/token')) return Response.json({ accessToken: 'fake-token', expiresIn: 3600 });
    if (url.includes('/deliveryAvailabilities?')) return Response.json(quote());
    if (url.endsWith('/orders')) return Response.json({
      id: deliveryId, trackingUrl: 'https://meupedido.ifood.com.br/' + deliveryId,
    });
    throw Error('Unexpected endpoint: ' + url);
  };
  try {
    const q = await quoteIFood(env, address);
    assert.equal(q.feeCents, 799);
    const result = await dispatchIFood({ ...env, DB: db }, orderId);
    assert.deepEqual(result, { status: 'REQUESTED', id: deliveryId });
    assert.match(calls[0].url, /authentication\/v1\.0\/oauth\/token/);
    assert.match(calls[1].url, /shipping\/v1\.0\/merchants\/.+\/deliveryAvailabilities\?/);
    assert.match(calls.at(-1).url, /shipping\/v1\.0\/merchants\/.+\/orders$/);
    const body = JSON.parse(calls.at(-1).options.body);
    assert.equal(body.delivery.merchantFee, 7.99);
    assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer fake-token');
    assert.ok(db.operations.some(op => op.args.includes(deliveryId)));
  } finally { globalThis.fetch = oldFetch; }
});

test('ifood dispatch never registers a more expensive delivery than prepaid freight', async () => {
  const oldFetch = globalThis.fetch, db = database();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    if (url.includes('deliveryAvailabilities?')) return Response.json(quote(19.75));
    throw Error('Unexpected API request ' + url);
  };
  try {
    const result = await dispatchIFood({ ...env, DB: db }, orderId);
    assert.equal(result.status, 'PRICE_CHANGED');
    assert.ok(calls.every(url => !url.endsWith('/orders')));
    assert.ok(db.operations.some(op => op.sql.includes('PRICE_CHANGED')));
  } finally { globalThis.fetch = oldFetch; }
});

test('disabled integration does not call any remote endpoint', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => { throw Error('Should never call iFood'); };
  try {
    assert.equal((await dispatchIFood({ ...env, IFOOD_SHIPPING_ENABLED: 'false',
      DB: database() }, orderId)).status, 'DISABLED');
    assert.equal(await syncIFoodEvents({ ...env, IFOOD_SHIPPING_ENABLED: 'false' }), 0);
  } finally { globalThis.fetch = oldFetch; }
});
