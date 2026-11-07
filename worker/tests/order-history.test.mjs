import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { pbkdf2Sync, randomUUID, createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { handleAdmin, canCorrectOrder } from '../src/management.mjs';

const origin = 'https://restaurantekipeixe.com.br';
const base = 'https://api.restaurantekipeixe.com.br';
const future = '2099-12-31T23:59:59.000Z';
const ownerToken = '1'.repeat(64);
const staffToken = '2'.repeat(64);
const hash = token => createHash('sha256').update(token).digest('hex');

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  const directory = new URL('../migrations/', import.meta.url);
  for (const migration of readdirSync(directory).filter(f => f.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(migration, directory), 'utf8'));
  }
  for (const [username, role] of [['owner-test', 'owner'], ['staff-test', 'staff']]) {
    sqlite.prepare('INSERT INTO admin_users(username,password_hash,password_salt,role) VALUES (?,?,?,?)')
      .run(username, pbkdf2Sync('test-only-password', 'test-salt', 100000, 32, 'sha256').toString('hex'),
        'test-salt', role);
  }
  const expiry = Date.now() + 10000000;
  sqlite.prepare('INSERT INTO admin_sessions(token_hash,username,expires_at,created_at) VALUES (?,?,?,?)')
    .run(hash(ownerToken), 'owner-test', expiry, Date.now());
  sqlite.prepare('INSERT INTO admin_sessions(token_hash,username,expires_at,created_at) VALUES (?,?,?,?)')
    .run(hash(staffToken), 'staff-test', expiry, Date.now());
  const db = {
    prepare(text) {
      const statement = sqlite.prepare(text);
      return {
        first: async () => statement.get() || null,
        all: async () => ({ results: statement.all() }),
        bind(...values) {
          return {
            first: async () => statement.get(...values) || null,
            all: async () => ({ results: statement.all(...values) }),
            run: async () => ({ meta: { changes: statement.run(...values).changes } }),
          };
        },
      };
    },
  };
  const env = { DB: db };
  function addOrder({ name = 'Cliente Histórico', status = 'PREPARING', payment = 'PAID',
    type = 'Retirada no Kipeixe', refund = 'NOT_REQUIRED', courier = null,
    created = '2026-11-07 12:00:00' } = {}) {
    const id = randomUUID();
    sqlite.prepare(`INSERT INTO orders (id,request_id,access_hash,name,phone,order_type,items_json,
      subtotal_cents,total_cents,payment_status,fulfillment_status,refund_status,created_at,
      acceptance_deadline,uber_delivery_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, randomUUID(), 'testhash', name,
      '45999999999', type, '[{"name":"Tilápia","qty":1}]', 5000, 5000,
      payment, status, refund, created, future, courier);
    return id;
  }
  async function call(path, method = 'GET', body = null, role = 'owner') {
    const url = new URL(base + path);
    const headers = { Origin: origin, Cookie: 'kipeixe_session=' +
      (role === 'owner' ? ownerToken : staffToken) };
    if (body) headers['Content-Type'] = 'application/json';
    const response = await handleAdmin(new Request(url, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    }), env, origin, url);
    return { status: response.status, data: await response.json() };
  }
  return { sqlite, addOrder, call };
}

test('history searches and paginates without exposing payment access secrets', async () => {
  const { sqlite, addOrder, call } = fixture();
  const id = addOrder({ name: 'Joana História', status: 'READY' });
  addOrder({ name: 'Maria', payment: 'EXPIRED', status: 'AWAITING_PAYMENT' });
  for (let i = 0; i < 52; i++) addOrder({ name: 'Cliente ' + i });
  const first = await call('/api/admin/history?page=1');
  assert.equal(first.status, 200);
  assert.equal(first.data.total, 54);
  assert.equal(first.data.pages, 2);
  assert.equal(first.data.orders.length, 50);
  assert.ok(!JSON.stringify(first.data).includes('access_hash'));
  const second = await call('/api/admin/history?page=2');
  assert.equal(second.data.orders.length, 4);
  const byName = await call('/api/admin/history?q=Joana');
  assert.equal(byName.data.total, 1);
  assert.equal(byName.data.orders[0].id, id);
  const byStatus = await call('/api/admin/history?status=PAYMENT_EXPIRED');
  assert.equal(byStatus.data.total, 1);
  const byDate = await call('/api/admin/history?from=2026-11-07&to=2026-11-07');
  assert.equal(byDate.data.total, 54);
  const invalid = await call('/api/admin/history?status=INJECTED');
  assert.equal(invalid.status, 422);
  assert.equal((await call('/api/admin/history?from=2026-02-30')).status, 422);
  sqlite.close();
});

test('history records owner corrections, validates transitions and prevents staff edits', async () => {
  const { sqlite, addOrder, call } = fixture();
  const id = addOrder();
  const detail = await call('/api/admin/orders/' + id + '/history', 'GET', null, 'staff');
  assert.equal(detail.status, 200);
  assert.equal(detail.data.canCorrect, false);
  const correction = {
    expectedStatus: 'PREPARING', targetStatus: 'AWAITING_ACCEPTANCE',
    reason: 'Aceite registrado por engano no caixa.',
  };
  assert.equal((await call('/api/admin/orders/' + id + '/correct', 'POST',
    correction, 'staff')).status, 403);
  assert.equal((await call('/api/admin/orders/' + id + '/correct', 'POST',
    { ...correction, reason: 'x' })).status, 422);
  const result = await call('/api/admin/orders/' + id + '/correct', 'POST', correction);
  assert.equal(result.status, 200);
  assert.equal(result.data.status, 'AWAITING_ACCEPTANCE');
  assert.equal(sqlite.prepare('SELECT payment_status FROM orders WHERE id=?').get(id).payment_status, 'PAID');
  const events = await call('/api/admin/orders/' + id + '/history');
  assert.equal(events.data.events[0].actor, 'owner-test');
  assert.equal(events.data.events[0].action, 'ORDER_STATUS_CORRECTED');
  assert.match(events.data.events[0].details, /registrado por engano/);
  assert.equal((await call('/api/admin/orders/' + id + '/correct', 'POST', correction)).status, 409);

  const refunded = addOrder({ refund: 'REQUESTED' });
  assert.equal((await call('/api/admin/orders/' + refunded + '/correct', 'POST', correction)).status, 409);
  const dispatched = addOrder({ status: 'READY', type: 'Entrega', courier: 'courier-42' });
  assert.equal((await call('/api/admin/orders/' + dispatched + '/correct', 'POST', {
    expectedStatus: 'READY', targetStatus: 'PREPARING', reason: 'Marquei pronto sem querer.',
  })).status, 409);
  const pickup = addOrder({ status: 'COMPLETED' });
  assert.equal((await call('/api/admin/orders/' + pickup + '/correct', 'POST', {
    expectedStatus: 'COMPLETED', targetStatus: 'READY', reason: 'Ainda nao foi entregue.',
  })).status, 200);
  sqlite.close();
});

test('pure correction rules exclude unpaid, refunded, couriers and invalid jumps', () => {
  const baseline = {
    payment_status: 'PAID', fulfillment_status: 'READY', order_type: 'Retirada no Kipeixe',
    refund_status: 'NOT_REQUIRED', uber_delivery_id: null, ifood_order_id: null,
    uber_status: null, ifood_status: null,
  };
  assert.equal(canCorrectOrder(baseline, 'PREPARING'), true);
  assert.equal(canCorrectOrder({ ...baseline, order_type: 'Entrega' }, 'PREPARING'), false);
  assert.equal(canCorrectOrder({ ...baseline, payment_status: 'PENDING' }, 'PREPARING'), false);
  assert.equal(canCorrectOrder({ ...baseline, refund_status: 'REVIEW' }, 'PREPARING'), false);
  assert.equal(canCorrectOrder({ ...baseline, uber_status: 'REQUESTING' }, 'PREPARING'), false);
  assert.equal(canCorrectOrder(baseline, 'AWAITING_ACCEPTANCE'), false);
});
