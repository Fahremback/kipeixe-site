import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAdmin } from '../src/management.mjs';

const origin = 'https://restaurantekipeixe.com.br';
const url = path => new URL('https://api.restaurantekipeixe.com.br' + path);
const request = (path, extra = {}) => new Request(url(path), { headers: { Origin: origin, ...extra } });

test('session probe returns anonymous state without HTTP error', async () => {
  const target = url('/api/auth/session');
  const response = await handleAdmin(request(target.pathname), { DB: {} }, origin, target);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: false, username: null });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
});

test('admin endpoints still refuse requests without a valid session', async () => {
  const target = url('/api/admin/orders');
  const response = await handleAdmin(request(target.pathname), { DB: {} }, origin, target);
  assert.equal(response.status, 401);
});

test('session probe keeps a valid session authenticated', async () => {
  const token = 'a'.repeat(64);
  const db = { prepare(sql) {
    assert.match(sql, /SELECT username FROM admin_sessions/);
    return { bind(hash, expires) {
      assert.match(hash, /^[0-9a-f]{64}$/);
      assert.equal(typeof expires, 'number');
      return { first: async () => ({ username: 'gestor' }) };
    }};
  }};
  const target = url('/api/auth/session');
  const response = await handleAdmin(request(target.pathname, { Cookie: 'kipeixe_session=' + token }),
    { DB: db }, origin, target);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: true, username: 'gestor' });
});
