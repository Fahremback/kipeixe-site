import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { pbkdf2Sync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { handleAdmin } from '../src/management.mjs';

const base = 'https://api.restaurantekipeixe.com.br';
const origin = 'https://restaurantekipeixe.com.br';
const firstUsername = 'original-owner';
const firstPassword = 'very-long-owner-test-password';
const newPassword = 'new-owner-test-password-123';

function createEnvironment(rounds = 210000) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../migrations/0008_admin_users.sql', import.meta.url), 'utf8'));
  sql.exec(`
    CREATE TABLE admin_sessions (token_hash TEXT PRIMARY KEY, username TEXT NOT NULL,
      expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE login_limits (ip TEXT NOT NULL, window_start INTEGER NOT NULL,
      hits INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(ip,window_start));
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY, actor TEXT, action TEXT, subject TEXT,
      details TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
  const salt = 'test-owner-salt';
  const digest = pbkdf2Sync(firstPassword, salt, rounds, 32, 'sha256').toString('hex');
  const env = {
    ADMIN_USERNAME: firstUsername,
    ADMIN_PASSWORD_SALT: salt,
    ADMIN_PASSWORD_HASH: digest,
    DB: {
      prepare(query) {
        const statement = sql.prepare(query);
        return {
          first: async () => statement.get() || null,
          all: async () => ({ results: statement.all() }),
          bind(...args) {
            return {
              first: async () => statement.get(...args) || null,
              all: async () => ({ results: statement.all(...args) }),
              run: async () => ({ meta: { changes: statement.run(...args).changes } }),
            };
          },
        };
      },
    },
  };
  return { env, sql };
}

async function api(env, path, method = 'GET', data = null, cookie = '') {
  const url = new URL(base + path);
  const headers = { Origin: origin };
  if (cookie) headers.Cookie = cookie;
  if (data) headers['Content-Type'] = 'application/json';
  const response = await handleAdmin(new Request(url, {
    method, headers, body: data ? JSON.stringify(data) : undefined,
  }), env, origin, url);
  return { status: response.status, data: await response.json(),
    cookie: response.headers.get('Set-Cookie')?.split(';')[0] };
}

test('owner can manage staff; staff cannot manage accounts; credentials can be changed', async () => {
  const { env, sql } = createEnvironment();
  const initial = await api(env, '/api/auth/login', 'POST',
    { username: firstUsername, password: firstPassword });
  assert.equal(initial.status, 200);
  assert.equal(initial.data.role, 'owner');
  const ownerCookie = initial.cookie;
  const ownerList = await api(env, '/api/admin/users', 'GET', null, ownerCookie);
  assert.deepEqual(ownerList.data.users.map(u => u.username), [firstUsername]);
  assert.ok(!JSON.stringify(ownerList.data).includes('password_hash'));

  const created = await api(env, '/api/admin/users', 'POST',
    { username: 'Atendente1', password: 'long-and-unique-staff-password' }, ownerCookie);
  assert.equal(created.status, 201);
  assert.equal(created.data.username, 'atendente1');
  const duplicate = await api(env, '/api/admin/users', 'POST',
    { username: 'ATENDENTE1', password: 'different-unique-staff-password' }, ownerCookie);
  assert.equal(duplicate.status, 409);
  const tooShort = await api(env, '/api/admin/users', 'POST',
    { username: 'another-user', password: 'short' }, ownerCookie);
  assert.equal(tooShort.status, 422);

  const staff = await api(env, '/api/auth/login', 'POST',
    { username: 'atendente1', password: 'long-and-unique-staff-password' });
  assert.equal(staff.status, 200);
  assert.equal(staff.data.role, 'staff');
  assert.equal((await api(env, '/api/admin/users', 'GET', null, staff.cookie)).status, 403);
  assert.equal((await api(env, '/api/admin/settings', 'GET', null, staff.cookie)).status, 403);
  assert.equal((await api(env, '/api/admin/users', 'POST',
    { username: 'illicit', password: 'long-password-not-allowed' }, staff.cookie)).status, 403);

  const badOwnerPassword = await api(env, '/api/admin/users/' + firstUsername, 'PUT', {
    username: 'new-owner', password: newPassword, currentPassword: 'incorrect-current-password',
  }, ownerCookie);
  assert.equal(badOwnerPassword.status, 403);
  const changed = await api(env, '/api/admin/users/' + firstUsername, 'PUT', {
    username: 'new-owner', password: newPassword, currentPassword: firstPassword,
  }, ownerCookie);
  assert.equal(changed.status, 200);
  assert.equal((await api(env, '/api/auth/login', 'POST',
    { username: firstUsername, password: firstPassword })).status, 401);
  assert.equal((await api(env, '/api/auth/login', 'POST',
    { username: 'new-owner', password: newPassword })).status, 200);
  assert.equal((await api(env, '/api/auth/session', 'GET', null, ownerCookie)).data.username, 'new-owner');

  const disabled = await api(env, '/api/admin/users/atendente1', 'PUT',
    { username: 'atendente1', active: false }, ownerCookie);
  assert.equal(disabled.status, 200);
  assert.equal((await api(env, '/api/auth/session', 'GET', null, staff.cookie)).data.authenticated, false);
  assert.equal((await api(env, '/api/auth/login', 'POST',
    { username: 'atendente1', password: 'long-and-unique-staff-password' })).status, 401);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM admin_users WHERE role='owner'").get().n, 1);
  sql.close();
});

test('original 100k-round owner login is imported without changing password', async () => {
  const { env, sql } = createEnvironment(100000);
  const response = await api(env, '/api/auth/login', 'POST',
    { username: firstUsername, password: firstPassword });
  assert.equal(response.status, 200);
  assert.equal(response.data.role, 'owner');
  sql.close();
});
