import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { testIFoodConfigured, testIFoodEnv, mergeWeekendShifts, makeExternalTestOrder,
  ifoodAdminAction, pollTestIFoodEvents } from '../src/ifood-operations.mjs';
import { syncIFoodEvents } from '../src/ifood-shipping.mjs';
import { handleAdmin } from '../src/management.mjs';

const clientId = 'e858424c-d688-44ca-bb40-7d2746e949fb';
const merchantId = '66b9cfe4-1e46-41ab-a326-e9c8dd07d374';
const orderId = '6319de01-6bd1-4de8-9471-e7a1d9c67c1f';
const quoteId = 'a27eb986-2878-4c09-988b-256b9bbf53b0';
const env = { LOCAL_DEVELOPMENT: 'true', IFOOD_TEST_CLIENT_ID: clientId,
  IFOOD_TEST_CLIENT_SECRET: 'local-test-secret-not-production', IFOOD_TEST_MERCHANT_ID: merchantId };
const req = (path, method = 'GET', body = null) => new Request(
  'https://api.restaurantekipeixe.com.br/api/admin/ifood/' + path,
  { method, ...(body === null ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });

function db() {
  const sqlite = new DatabaseSync(':memory:');
  const migrations = new URL('../migrations/', import.meta.url);
  for (const f of readdirSync(migrations).filter(f => f.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(new URL(f, migrations), 'utf8'));
  return { sqlite, prepare(sql) { return {
    bind(...v) { return { first: async () => sqlite.prepare(sql).get(...v) || null,
      all: async () => ({ results: sqlite.prepare(sql).all(...v) }),
      run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...v).changes } }) }; },
    first: async () => sqlite.prepare(sql).get() || null,
    all: async () => ({ results: sqlite.prepare(sql).all() }) };
  } };
}

test('homologation requires local mode and separate test credentials', () => {
  assert.equal(testIFoodConfigured(env), true);
  assert.equal(testIFoodConfigured({ ...env, LOCAL_DEVELOPMENT: 'false' }), false);
  assert.equal(testIFoodConfigured({ ...env, IFOOD_TEST_CLIENT_SECRET: '' }), false);
  assert.equal(testIFoodEnv(env).IFOOD_CLIENT_ID, clientId);
});

test('weekend checklist preserves weekdays and configures four shifts', () => {
  const result = mergeWeekendShifts([{ dayOfWeek: 'MONDAY', start: '08:00:00', duration: 480 },
    { dayOfWeek: 'SUNDAY', start: '08:00:00', duration: 120 }], merchantId);
  assert.equal(result.storeId, merchantId);
  assert.deepEqual(result.shifts.filter(s => s.dayOfWeek === 'SUNDAY').map(s => [s.start, s.duration]),
    [['09:00:00', 180], ['13:00:00', 180], ['17:00:00', 360]]);
  assert.deepEqual(result.shifts.filter(s => s.dayOfWeek === 'SATURDAY').map(s => [s.start, s.duration]),
    [['10:00:00', 540]]);
  assert.ok(result.shifts.some(s => s.dayOfWeek === 'MONDAY'));
});

test('external order validates address, quote and item totals', () => {
  const input = { name: 'Cliente Teste', phone: '68999999999', quoteId, fee: 8,
    address: { postalCode: '69923000', streetName: 'Rua Central', streetNumber: '12',
      neighborhood: 'Centro', city: 'Bujari', state: 'AC', country: 'BR',
      latitude: -9.83, longitude: -67.95 },
    items: [{ name: 'Tilápia', quantity: 1, unitPrice: 25 }] };
  const payload = makeExternalTestOrder(input);
  assert.equal(payload.delivery.quoteId, quoteId);
  assert.equal(payload.delivery.deliveryAddress.city, 'Bujari');
  assert.equal(payload.items[0].totalPrice, 25);
  assert.equal(payload.payments.methods[0].value, 33);
  assert.equal(payload.payments.methods[0].card.brand, 'VISA');
  assert.equal(payload.displayId.length, 4);
  assert.throws(() => makeExternalTestOrder({ ...input, items: [] }), /iten|item/i);
  assert.throws(() => makeExternalTestOrder({ ...input, address: { ...input.address, latitude: 500 } }), /coordenada/i);
});

test('Shipping 2 confirms a sandbox order before requesting a driver', async () => {
  const old = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.push({ target, method: options.method || 'GET' });
    if (target.endsWith('/oauth/token'))
      return Response.json({ accessToken: 'unit-test', expiresIn: 3600 });
    if (target.endsWith('/order/v1.0/orders/' + orderId))
      return Response.json({ id: orderId, isTest: true, category: 'FOOD', merchant: { id: merchantId } });
    if (target.endsWith('/order/v1.0/orders/' + orderId + '/confirm'))
      return new Response(null, { status: 202 });
    throw Error('Unexpected request: ' + target);
  };
  const database = db();
  try {
    const result = await ifoodAdminAction(req('inside/confirm', 'POST', { orderId }),
      { ...env, DB: database });
    assert.equal(result.status, 200);
    assert.equal(result.data.accepted, true);
    assert.ok(calls.some(c => c.target.endsWith('/order/v1.0/orders/' + orderId + '/confirm') &&
      c.method === 'POST'));
  } finally { globalThis.fetch = old; database.sqlite.close(); }
});

test('Shipping 2 refuses to confirm orders outside the sandbox test merchant', async () => {
  const old = globalThis.fetch, calls = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target.endsWith('/oauth/token'))
      return Response.json({ accessToken: 'unit-test', expiresIn: 3600 });
    if (target.endsWith('/order/v1.0/orders/' + orderId))
      return Response.json({ id: orderId, isTest: false, merchant: { id: merchantId } });
    throw Error('Unexpected request ' + target);
  };
  const database = db();
  try {
    const result = await ifoodAdminAction(req('inside/confirm', 'POST', { orderId }),
      { ...env, DB: database });
    assert.notEqual(result.status, 200);
    assert.ok(!calls.some(c => c.endsWith('/confirm')));
  } finally { globalThis.fetch = old; database.sqlite.close(); }
});

test('Shipping 2 calls actual internal-order quote and requestDriver routes with quoteId', async () => {
  const old = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.push({ target, options });
    if (target.endsWith('/oauth/token'))
      return Response.json({ accessToken: 'unit-test', expiresIn: 3600 });
    if (target.endsWith('/deliveryAvailabilities'))
      return Response.json({ id: quoteId, quote: { netValue: 10.99 } });
    if (target.endsWith('/requestDriver'))
      return new Response(null, { status: 202 });
    throw Error('Unexpected endpoint ' + target);
  };
  const database = db();
  try {
    const local = { ...env, DB: database };
    const quotation = await ifoodAdminAction(req('inside/quote', 'POST', { orderId }), local);
    assert.equal(quotation.status, 200);
    assert.equal(quotation.data.id, quoteId);
    const requested = await ifoodAdminAction(req('inside/request-driver', 'POST',
      { orderId, quoteId }), local);
    assert.deepEqual(requested, { status: 200, data: { accepted: true, result: {} } });
    const route = '/shipping/v1.0/orders/' + orderId;
    assert.ok(calls.some(c => c.target.endsWith(route + '/deliveryAvailabilities')));
    const driver = calls.find(c => c.target.endsWith(route + '/requestDriver'));
    assert.equal(driver.options.method, 'POST');
    assert.deepEqual(JSON.parse(driver.options.body), { quoteId });
  } finally { globalThis.fetch = old; database.sqlite.close(); }
});

test('Shipping 2 fails explicitly when iFood sandbox does not support courier allocation', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/oauth/token'))
      return Response.json({ accessToken: 'unit-test', expiresIn: 3600 });
    if (String(url).endsWith('/requestDriver'))
      return Response.json({ code: 'RequestDriverUnavailable',
        message: 'Unable to request driver for order' }, { status: 400 });
    throw Error('Unexpected endpoint ' + url);
  };
  const database = db();
  try {
    const result = await ifoodAdminAction(req('inside/request-driver', 'POST',
      { orderId, quoteId }), { ...env, DB: database });
    assert.equal(result.status, 400);
    assert.match(result.data.error, /RequestDriverUnavailable/);
    assert.doesNotMatch(result.data.error, /accepted: true/);
  } finally { globalThis.fetch = old; database.sqlite.close(); }
});

test('Merchant status and cancellation use documented paths and API-provided reasons', async () => {
  const old = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/oauth/token')) return Response.json({ accessToken: 'fake', expiresIn: 3600 });
    if (String(url).endsWith('/cancellationReasons'))
      return Response.json([{ cancelCodeId: '817', description: 'Cliente cancelou' }]);
    if (String(url).endsWith('/cancel')) return new Response(null, { status: 202 });
    return Response.json({ ok: true });
  };
  try {
    const e = { ...env, DB: db() };
    assert.equal((await ifoodAdminAction(req('merchant/status'), e)).status, 200);
    assert.ok(calls.some(c => c.url.includes('/merchant/v1.0/merchants/' + merchantId + '/status')));
    assert.equal((await ifoodAdminAction(req('orders/' + orderId + '/cancel', 'POST',
      { cancellationCode: 999, reason: 'Teste' }), e)).status, 422);
    assert.equal(calls.filter(c => c.url.endsWith('/cancel')).length, 0);
    assert.equal((await ifoodAdminAction(req('orders/' + orderId + '/cancel', 'POST',
      { cancellationCode: 817, reason: 'Cliente cancelou' }), e)).status, 200);
    assert.equal(JSON.parse(calls.at(-1).options.body).cancellationCode, '817');
  } finally { globalThis.fetch = old; }
});

test('polling persists eventId, acknowledges duplicates, and reports state', async () => {
  const database = db(), old = globalThis.fetch, calls = [];
  const event = { id: '0e3c41aa-6694-4c9b-983b-f8b07d8e2cbc', orderId, merchantId, code: 'ASSIGN_DRIVER' };
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/oauth/token')) return Response.json({ accessToken: 'fake', expiresIn: 3600 });
    if (String(url).includes('events:polling')) return Response.json([event]);
    if (String(url).endsWith('/acknowledgment')) return new Response(null, { status: 202 });
    throw Error('Unexpected endpoint ' + url);
  };
  try {
    const first = await pollTestIFoodEvents({ ...env, DB: database }, 1_000_000_000);
    const throttled = await pollTestIFoodEvents({ ...env, DB: database }, 1_000_020_000);
    const second = await pollTestIFoodEvents({ ...env, DB: database }, 1_000_030_000);
    assert.equal(first.newEvents, 1);
    assert.equal(throttled.skipped, true);
    assert.equal(second.newEvents, 0);
    assert.equal(second.duplicates, 1);
    assert.equal(calls.filter(c => c.url.endsWith('/acknowledgment')).length, 2);
    assert.ok(calls.some(c => c.url.endsWith('/events/v1.0/events:polling?excludeHeartbeat=true')));
    assert.equal(database.sqlite.prepare('SELECT COUNT(*) AS n FROM ifood_event_log').get().n, 1);
  } finally { globalThis.fetch = old; database.sqlite.close(); }
});

test('polling treats HTTP 204 empty queue as a successful empty result', async () => {
  const database = db(), old = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).endsWith('/oauth/token')) return Response.json({ accessToken: 'fake', expiresIn: 3600 });
    if (String(url).includes('events:polling')) return new Response(null, { status: 204 });
    throw Error('Unexpected endpoint');
  };
  try {
    const result = await pollTestIFoodEvents({ ...env, DB: database }, 1_000_000_000);
    assert.deepEqual(result.events, []);
    assert.equal(result.newEvents, 0);
    assert.equal(result.acknowledged, 0);
  } finally { globalThis.fetch = old; database.sqlite.close(); }
});

test('production events persist pickupCode and dedupe independently of sandbox', async () => {
  const database = db(), old = globalThis.fetch, calls = [];
  const sampleOrderId = 'f64401a3-6bc7-4a76-bdea-f564e2d48a12';
  const eventId = '8c61c21e-c89d-4325-b78d-c3d6c73212fb';
  database.sqlite.prepare(
    `INSERT INTO orders(id,request_id,access_hash,name,phone,order_type,items_json,
    subtotal_cents,total_cents,payment_status,fulfillment_status,ifood_order_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(sampleOrderId, 'req', 'access', 'Cliente Teste', '45999999999', 'Entrega',
    '[]', 2500, 2500, 'PAID', 'READY', orderId);
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/oauth/token')) return Response.json({ accessToken: 'fake', expiresIn: 3600 });
    if (String(url).includes('events:polling'))
      return Response.json([{ eventId, orderId, merchantId, code: 'ASSIGN_DRIVER', pickupCode: 'AB123' }]);
    if (String(url).endsWith('/acknowledgment')) return new Response(null, { status: 202 });
    throw Error('Unexpected endpoint ' + url);
  };
  try {
    const production = { ...env, IFOOD_CLIENT_ID: env.IFOOD_TEST_CLIENT_ID,
      IFOOD_CLIENT_SECRET: env.IFOOD_TEST_CLIENT_SECRET, IFOOD_MERCHANT_ID: merchantId,
      IFOOD_SHIPPING_ENABLED: 'true', DB: database };
    assert.equal(await syncIFoodEvents(production), 1);
    const row = database.sqlite.prepare('SELECT ifood_status, ifood_pickup_code FROM orders WHERE id=?')
      .get(sampleOrderId);
    assert.deepEqual({ ...row }, { ifood_status: 'ASSIGN_DRIVER', ifood_pickup_code: 'AB123' });
    assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM ifood_event_log').first()).n, 1);
    assert.equal(await syncIFoodEvents(production), 0);
    assert.equal(calls.filter(c => c.url.includes('events:polling')).length, 1);
    database.sqlite.prepare('UPDATE ifood_poll_state SET last_poll_ms=0 WHERE channel=?').run('production');
    assert.equal(await syncIFoodEvents(production), 1);
    assert.equal(database.sqlite.prepare('SELECT COUNT(*) AS n FROM ifood_event_log').get().n, 1);
    assert.equal(calls.filter(c => c.url.endsWith('/acknowledgment')).length, 2);
  } finally { globalThis.fetch = old; database.sqlite.close(); }
});

test('owner-only sandbox operations reject anonymous and staff sessions', async () => {
  const database = db();
  const origin = 'https://restaurantekipeixe.com.br';
  const token = '9'.repeat(64);
  const tokenHash = createHash('sha256').update(token).digest('hex');
  database.sqlite.prepare(
    'INSERT INTO admin_users(username,password_hash,password_salt,role) VALUES (?,?,?,?)'
  ).run('homologacao-teste', 'testhash', 'testsalt', 'staff');
  database.sqlite.prepare(
    'INSERT INTO admin_sessions(token_hash,username,expires_at,created_at) VALUES (?,?,?,?)'
  ).run(tokenHash, 'homologacao-teste', Date.now() + 3600_000, Date.now());
  const target = 'https://api.restaurantekipeixe.com.br/api/admin/ifood/config';
  try {
    const a = await handleAdmin(new Request(target, { headers: { Origin: origin } }),
      { ...env, DB: database }, origin, new URL(target));
    assert.equal(a.status, 401);
    const b = await handleAdmin(new Request(target, { headers: {
      Origin: origin, Cookie: 'kipeixe_session=' + token } }),
      { ...env, DB: database }, origin, new URL(target));
    assert.equal(b.status, 403);
    database.sqlite.prepare('UPDATE admin_users SET role=? WHERE username=?')
      .run('owner', 'homologacao-teste');
    const c = await handleAdmin(new Request(target, { headers: {
      Origin: origin, Cookie: 'kipeixe_session=' + token } }),
      { ...env, DB: database }, origin, new URL(target));
    assert.equal(c.status, 200);
    const body = await c.json();
    assert.equal(body.configured, true);
    assert.equal(body.merchantId, merchantId);
  } finally { database.sqlite.close(); }
});
