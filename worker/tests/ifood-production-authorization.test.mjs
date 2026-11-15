import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ifoodCredentialsConfigured, ifoodConfigured, listAuthorizedIFoodMerchants,
  probeIFoodAuthorization,
} from '../src/ifood-shipping.mjs';

const envBase = {
  IFOOD_CLIENT_ID: 'd832c93a-2271-459e-844e-7adf9f9322c7',
  IFOOD_CLIENT_SECRET: 'ifood-production-test-secret-not-real',
};
function database() {
  const db = { value: null, writes: [] };
  db.prepare = sql => ({
    bind(...args) { this.params = args; return this; },
    async first() { return db.value ? { value: db.value } : null; },
    async run() {
      assert.match(sql, /ifood_authorization_probe/);
      db.value = this.params[0];
      db.writes.push(JSON.parse(db.value));
      return { meta: { changes: 1 } };
    },
  });
  return db;
}

test('separates OAuth credentials from merchant authorization and Shipping activation', () => {
  assert.equal(ifoodCredentialsConfigured(envBase), true);
  assert.equal(ifoodConfigured(envBase), false);
  assert.equal(ifoodCredentialsConfigured({ ...envBase, IFOOD_CLIENT_SECRET: '' }), false);
  assert.equal(ifoodConfigured({ ...envBase,
    IFOOD_MERCHANT_ID: 'dfd72ee2-9988-495b-a763-cd61efb2dff7' }), true);
});

test('reads authorized production merchants without creating couriers or requiring merchant ID', async t => {
  const oldFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = oldFetch; });
  const sent = [];
  globalThis.fetch = async (url, options) => {
    sent.push({ url, method: options.method });
    if (url.includes('/oauth/token')) {
      return Response.json({ accessToken: 'auth-for-list', expiresIn: 3600 });
    }
    assert.match(options.headers.Authorization, /^Bearer /);
    assert.match(url, /\/merchant\/v1\.0\/merchants\?size=50$/);
    return Response.json([{ id: '97a06fd5-1c7a-4adb-a062-73b1bec3b51b',
      name: 'KIPEIXE', corporateName: 'Restaurante' }]);
  };
  const merchantList = await listAuthorizedIFoodMerchants(envBase);
  assert.equal(merchantList.length, 1);
  assert.equal(merchantList[0].name, 'KIPEIXE');
  assert.equal(sent.length, 2);
  assert.equal(sent.every(entry => entry.method === 'GET' || entry.method === 'POST'), true);
  assert.equal(sent.some(entry => entry.url.includes('/shipping/')), false);
});

test('empty authorization is cached and leaves Shipping disabled', async t => {
  const oldFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = oldFetch; });
  const db = database();
  let count = 0;
  globalThis.fetch = async (url) => {
    count++;
    if (url.includes('/oauth/token')) return Response.json({ accessToken: 'auth-for-list', expiresIn: 3600 });
    return Response.json([]);
  };
  const env = { ...envBase, DB: db, IFOOD_SHIPPING_ENABLED: 'false' };
  const a = await probeIFoodAuthorization(env, Date.now());
  assert.equal(a.state, 'NO_AUTHORIZED_MERCHANT');
  const initialCount = count;
  const b = await probeIFoodAuthorization(env, Date.now() + 60_000);
  assert.deepEqual(a, b);
  assert.equal(count, initialCount);
  assert.equal(db.writes.length, 1);
  assert.equal(ifoodConfigured(env), false);
});

test('iFood denial is recorded without exposing credentials', async t => {
  const oldFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = oldFetch; });
  const db = database();
  globalThis.fetch = async (url) => {
    if (url.includes('/oauth/token')) return Response.json({ accessToken: 'auth-for-list', expiresIn: 3600 });
    return new Response(JSON.stringify({ code: 'Forbidden', message: 'No merchant permission' }), {
      status: 403, headers: { 'content-type': 'application/json' },
    });
  };
  const result = await probeIFoodAuthorization({ ...envBase, DB: db });
  assert.equal(result.state, 'IFOOD_API_ERROR');
  assert.match(result.error, /HTTP 403/);
  assert.equal(db.value.includes(envBase.IFOOD_CLIENT_SECRET), false);
});
