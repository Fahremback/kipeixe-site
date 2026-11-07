import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAdmin } from '../src/management.mjs';
import app from '../src/app.mjs';

const origin = 'https://restaurantekipeixe.com.br';
const url = path => new URL('https://api.restaurantekipeixe.com.br' + path);
const request = (path, extra = {}) => new Request(url(path), { headers: { Origin: origin, ...extra } });

test('session probe returns anonymous state without HTTP error', async () => {
  const target = url('/api/auth/session');
  const response = await handleAdmin(request(target.pathname), { DB: {} }, origin, target);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: false, username: null, role: null });
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
    if (/SELECT username FROM admin_users/.test(sql)) return { first: async () => ({ username: 'gestor' }) };
    assert.match(sql, /SELECT u.username,u.role FROM admin_sessions/);
    return { bind(hash, expires) {
      assert.match(hash, /^[0-9a-f]{64}$/);
      assert.equal(typeof expires, 'number');
      return { first: async () => ({ username: 'gestor', role: 'owner' }) };
    }};
  }};
  const target = url('/api/auth/session');
  const response = await handleAdmin(request(target.pathname, { Cookie: 'kipeixe_session=' + token }),
    { DB: db }, origin, target);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: true, username: 'gestor', role: 'owner' });
});

test('login preflight advertises the permitted site origin and POST headers', async () => {
  const target = url('/api/auth/login');
  const response = await app.fetch(new Request(target, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  }), {}, {});
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), 'true');
  assert.match(response.headers.get('Access-Control-Allow-Headers'), /Content-Type/);
});

test('login failures return a CORS-enabled JSON error, not an uncaught exception', async () => {
  const target = url('/api/auth/login');
  const response = await app.fetch(new Request(target, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test', password: 'invalid' }),
  }), {
    ADMIN_USERNAME: 'test',
    ADMIN_PASSWORD_HASH: 'a'.repeat(64),
    ADMIN_PASSWORD_SALT: 'tests',
    DB: { prepare() { throw Error('DB temporarily unavailable'); } },
  }, {});
  assert.equal(response.status, 500);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.deepEqual(await response.json(), { error: 'Falha temporária no serviço.' });
});
