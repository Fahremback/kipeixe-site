import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { handleAdmin } from '../src/management.mjs';

const origin = 'https://restaurantekipeixe.com.br';
const username = 'test-admin';
const password = 'dummy-test-password';
const salt = 'test-salt-never-for-production';

async function attemptLogin(rounds, suppliedPassword = password) {
  const digest = pbkdf2Sync(password, salt, rounds, 32, 'sha256').toString('hex');
  const db = {
    prepare(sql) {
      if (/SELECT username FROM admin_users/.test(sql)) return { first: async () => null };
      if (/INSERT INTO admin_users/.test(sql)) return { bind() { return { run: async () => ({ success: true }) }; } };
      if (/SELECT username,password_hash,password_salt,role,active FROM admin_users/.test(sql)) {
        return { bind() { return { first: async () => ({
          username, password_hash: digest, password_salt: salt, role: 'owner', active: 1,
        }) }; } };
      }
      return {
        bind() {
          if (/SELECT hits FROM login_limits/.test(sql)) return { first: async () => ({ hits: 1 }) };
          if (/INSERT INTO login_limits|INSERT INTO admin_sessions/.test(sql)) return { run: async () => ({ success: true }) };
          throw new Error('Unexpected SQL statement');
        },
      };
    },
  };
  const url = new URL('https://api.restaurantekipeixe.com.br/api/auth/login');
  const request = new Request(url, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: suppliedPassword }),
  });
  return handleAdmin(request, {
    ADMIN_USERNAME: username, ADMIN_PASSWORD_HASH: digest, ADMIN_PASSWORD_SALT: salt, DB: db,
  }, origin, url);
}

test('administrative login accepts existing 210k-round PBKDF2 hashes', async () => {
  const response = await attemptLogin(210000);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.match(response.headers.get('Set-Cookie'), /kipeixe_session=/);
});

test('administrative login accepts new 100k-round PBKDF2 hashes', async () => {
  const response = await attemptLogin(100000);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
});

test('administrative login still rejects an incorrect password', async () => {
  const response = await attemptLogin(210000, 'wrong-test-password');
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Credenciais inválidas.' });
});
