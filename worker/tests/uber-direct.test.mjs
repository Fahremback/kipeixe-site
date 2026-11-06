import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  uberConfigured, uberReady, normalizedAddress, parseQuote, trackingUrl,
  verifySignature, deliveryPayload, quoteDelivery, dispatchDelivery, uberWebhook,
} from '../src/uber-direct.mjs';

const env = {
  UBER_DIRECT_CLIENT_ID: 'client-12345678',
  UBER_DIRECT_CLIENT_SECRET: 'secret-12345678',
  UBER_DIRECT_CUSTOMER_ID: 'customer-12345678',
  UBER_DIRECT_WEBHOOK_SECRET: 'signing-12345678',
  UBER_DIRECT_ENABLED: 'true',
  UBER_PICKUP_ADDRESS: 'Av. João Ricieri Maran, 1417, Foz do Iguaçu - PR',
  UBER_PICKUP_PHONE: '+554535772363',
};
const future = () => new Date(Date.now() + 15 * 60_000).toISOString();
const quote = (fee = 950) => ({ id: 'dqt_testid12345678', fee, expires: future(), currency: 'brl' });
const exampleOrder = () => ({
  id: '2ea38f2d-97c4-45bb-9f4f-81b3e82c7348', name: 'Cliente Teste',
  phone: '45999999999', address: 'Rua das Araucárias, 123, Centro',
  notes: '', subtotal_cents: 3200, delivery_cents: 1000,
  payment_status: 'PAID', fulfillment_status: 'READY', order_type: 'Entrega',
  uber_status: 'QUOTED', uber_delivery_id: null, scheduled_for: null,
  items_json: JSON.stringify([{ name: 'Tilápia', qty: 2, unitCents: 1600 }]),
});
function fakeDb(order = exampleOrder()) {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      const obj = {
        bind(...args) { obj.args = args; return obj; },
        async first() { return order; },
        async run() { statements.push({ sql, args: obj.args }); return { meta: { changes: 1 } }; },
      };
      return obj;
    },
  };
}

test('Uber Direct never enables without explicit credentials and store approval', () => {
  assert.equal(uberConfigured({}), false);
  assert.equal(uberReady(env, { deliveryEnabled: false, uberEnabled: true }), false);
  assert.equal(uberReady(env, { deliveryEnabled: true, uberEnabled: false }), false);
  assert.equal(uberReady(env, { deliveryEnabled: true, uberEnabled: true }), true);
});

test('normalize delivery addresses in Foz and reject missing street number', () => {
  assert.match(normalizedAddress('Rua das Araucárias, 123, Centro'), /Foz do Iguaçu/);
  assert.match(normalizedAddress('Rua do Comércio, 100, Foz do Iguaçu - PR'), /Comércio, 100/);
  assert.throws(() => normalizedAddress('Centro'), /rua, número e bairro/);
});

test('quote must have BRL currency, positive safe fee and valid 15-minute expiry', () => {
  assert.equal(parseQuote(quote()).feeCents, 950);
  assert.throws(() => parseQuote({ ...quote(), currency: 'USD' }), /moeda/);
  assert.throws(() => parseQuote({ ...quote(), fee: -1 }), /Cotação/);
  assert.throws(() => parseQuote({ ...quote(), expires: new Date(Date.now() - 1).toISOString() }), /Cotação/);
});

test('tracking link only accepts trusted Uber HTTPS hostnames', () => {
  assert.match(trackingUrl('https://www.ubereats.com/orders/abc'), /ubereats/);
  assert.equal(trackingUrl('https://ubereats.com.attackersite.com/orders/abc'), null);
  assert.equal(trackingUrl('http://www.ubereats.com/orders/abc'), null);
});

test('delivery request includes quote, order reference and no sandbox test settings', () => {
  const order = exampleOrder();
  const payload = deliveryPayload(order, { uberQuoteId: quote().id }, env);
  assert.equal(payload.idempotency_key, order.id);
  assert.equal(payload.manifest_total_value, 3200);
  assert.equal(payload.pickup_phone_number, env.UBER_PICKUP_PHONE);
  assert.equal(payload.manifest_items[0].quantity, 2);
  assert.match(payload.dropoff_address, /Foz do Iguaçu/);
  assert.equal('test_specifications' in payload, false);
});

test('oauth and quote API use server-side credentials and correct quote endpoints', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('oauth/v2/token')) return new Response(JSON.stringify({
      access_token: 'test-token', expires_in: 3600,
    }), { status: 200 });
    return new Response(JSON.stringify(quote()), { status: 200 });
  };
  try {
    const result = await quoteDelivery(env, 'Rua das Araucárias, 123, Centro');
    assert.equal(result.feeCents, 950);
    assert.equal(calls[0].options.method, 'POST');
    assert.match(calls.at(-1).url, /customers\/customer-12345678\/delivery_quotes$/);
    assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer test-token');
    assert.equal(JSON.parse(calls.at(-1).options.body).pickup_address, env.UBER_PICKUP_ADDRESS);
  } finally { globalThis.fetch = original; }
});

test('Uber dispatch refuses a raised fee rather than charge restaurant unexpectedly', async () => {
  const original = globalThis.fetch;
  const db = fakeDb();
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    return new Response(JSON.stringify(quote(1600)), { status: 200 });
  };
  try {
    const result = await dispatchDelivery({ ...env, DB: db }, exampleOrder().id);
    assert.equal(result.status, 'PRICE_CHANGED');
    assert.equal(requests.filter(url => url.endsWith('/deliveries')).length, 0);
    assert.ok(db.statements.some(s => s.sql.includes("uber_status='PRICE_CHANGED'")));
  } finally { globalThis.fetch = original; }
});

test('Uber sandbox simulation dispatches a quoted order and receives signed courier updates', async () => {
  const original = globalThis.fetch;
  const requests = [];
  const db = fakeDb();
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith('/delivery_quotes')) return new Response(JSON.stringify(quote(950)), { status: 200 });
    if (url.endsWith('/deliveries')) {
      return new Response(JSON.stringify({
        id: 'del_robot123', status: 'pending',
        tracking_url: 'https://www.ubereats.com/orders/simulated',
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 });
  };
  try {
    const dispatch = await dispatchDelivery({ ...env, DB: db }, exampleOrder().id);
    assert.equal(dispatch.status, 'pending');
    assert.equal(dispatch.id, 'del_robot123');
    const deliveryCall = requests.find(call => call.url.endsWith('/deliveries'));
    assert.ok(deliveryCall);
    const body = JSON.parse(deliveryCall.options.body);
    assert.equal(body.quote_id, quote().id);
    assert.equal(body.external_id, exampleOrder().id);
    assert.equal(body.manifest_total_value, 3200);
    assert.equal(body.idempotency_key, exampleOrder().id);
    assert.equal(body.test_specifications, undefined, 'real backend must never inject robot testing flags');
    assert.ok(db.statements.some(statement => statement.args.includes('del_robot123')));

    for (const status of ['pickup', 'pickup_complete', 'dropoff', 'delivered']) {
      const event = JSON.stringify({
        kind: 'event.delivery_status',
        customer_id: env.UBER_DIRECT_CUSTOMER_ID,
        delivery_id: 'del_robot123',
        status,
        data: {
          external_id: exampleOrder().id,
          tracking_url: 'https://www.ubereats.com/orders/simulated',
        },
      });
      const signature = createHmac('sha256', env.UBER_DIRECT_WEBHOOK_SECRET)
        .update(event).digest('hex');
      const response = await uberWebhook(new Request('https://api.example.com/api/webhook/uber-direct', {
        method: 'POST', body: event, headers: { 'x-uber-signature': signature },
      }), { ...env, DB: db });
      assert.equal(response.status, 200);
    }
    assert.ok(db.statements.some(statement =>
      statement.args.includes('delivered') && statement.sql.includes('fulfillment_status')));
  } finally {
    globalThis.fetch = original;
  }
});

test('signed webhooks accept only authentic payloads and reject forgeries', async () => {
  const payload = JSON.stringify({ kind: 'event.delivery_status', delivery_id: 'del_123456789',
    status: 'pickup', customer_id: env.UBER_DIRECT_CUSTOMER_ID,
    data: { external_id: exampleOrder().id, tracking_url: 'https://www.ubereats.com/orders/test' } });
  const signed = createHmac('sha256', env.UBER_DIRECT_WEBHOOK_SECRET).update(payload).digest('hex');
  assert.equal(await verifySignature(payload, signed, env.UBER_DIRECT_WEBHOOK_SECRET), true);
  assert.equal(await verifySignature(payload, '0'.repeat(64), env.UBER_DIRECT_WEBHOOK_SECRET), false);
  const db = fakeDb({ id: exampleOrder().id });
  const result = await uberWebhook(new Request('https://api.restaurantekipeixe.com.br/api/webhook/uber-direct', {
    method: 'POST', headers: { 'x-uber-signature': signed }, body: payload,
  }), { ...env, DB: db });
  assert.equal(result.status, 200);
  assert.ok(db.statements.some(s => s.args.includes('pickup')));
  const bad = await uberWebhook(new Request('https://example.com', {
    method: 'POST', headers: { 'x-uber-signature': '0'.repeat(64) }, body: payload,
  }), { ...env, DB: db });
  assert.equal(bad.status, 401);
});
