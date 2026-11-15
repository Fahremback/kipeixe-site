import test from 'node:test';
import assert from 'node:assert/strict';
import { provisionPixKeyIfRequested } from '../src/asaas-pix.mjs';

function environment(status = 'requested') {
  const entries = new Map([['pix_setup_request', status]]);
  return {
    entries,
    env: {
      ASAAS_PRODUCTION_API_KEY: 'test-credential',
      DB: {
        prepare(sql) {
          let value;
          return {
            bind(next) { value = next; return this; },
            async first() { return { value: entries.get('pix_setup_request') }; },
            async run() {
              if (sql.startsWith('UPDATE') && sql.includes("SET value='processing'")) {
                if (entries.get('pix_setup_request') !== 'requested') return { meta: { changes: 0 } };
                entries.set('pix_setup_request', 'processing');
              } else if (sql.startsWith('UPDATE') && sql.includes("SET value='completed'")) {
                entries.set('pix_setup_request', 'completed');
              } else if (sql.startsWith('INSERT')) {
                entries.set('pix_setup_result', value);
              } else throw Error('Unexpected SQL');
              return { meta: { changes: 1 } };
            },
          };
        },
        async batch(statements) { for (const query of statements) await query.run(); },
      },
    },
  };
}

test('one-shot Pix key creation with explicit EVP type and private state', async t => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init.method || 'GET', body: init.body });
    assert.equal(init.headers.access_token, 'test-credential');
    if (url.endsWith('/pix/addressKeys?limit=100')) return Response.json({ data: [] });
    if (url.endsWith('/pix/addressKeys')) return Response.json({ id: 'test-id', status: 'AWAITING_ACTIVATION' });
    throw Error('Unexpected endpoint');
  };
  const { env, entries } = environment();
  assert.equal(await provisionPixKeyIfRequested(env), 'created_awaiting_activation');
  assert.equal(entries.get('pix_setup_request'), 'completed');
  assert.equal(entries.get('pix_setup_result'), 'created_awaiting_activation');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[1].method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].body), { type: 'EVP' });
  assert.equal(await provisionPixKeyIfRequested(env), 'not_requested');
  assert.equal(calls.length, 2, 'No duplicate Pix key');
});

test('existing pending or active key never triggers another key creation', async t => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  for (const status of ['AWAITING_ACTIVATION', 'ACTIVE']) {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ data: [{ status }] });
    };
    const { env } = environment();
    const outcome = await provisionPixKeyIfRequested(env);
    assert.equal(outcome, status === 'ACTIVE' ? 'already_active' : 'awaiting_activation');
    assert.equal(calls, 1);
  }
});

test('provider denial stops provisioning with a safe diagnostic', async t => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async (url) => url.includes('?')
    ? Response.json({ data: [] })
    : Response.json({ errors: [{ code: 'invalid_action', description: 'private details' }] }, { status: 400 });
  const { env, entries } = environment();
  assert.equal(await provisionPixKeyIfRequested(env), 'creation_http_400_invalid_action');
  assert.equal(entries.get('pix_setup_request'), 'completed');
  assert.ok(!entries.get('pix_setup_result').includes('private details'));
});
