import test from 'node:test';
import assert from 'node:assert/strict';
import { activePixKeyStatus } from '../src/asaas-pix.mjs';

test('public Pix availability uses a read-only, cached key lookup', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.match(url, /\/pix\/addressKeys\?status=ACTIVE&limit=20$/);
    assert.equal(options.headers.access_token, 'test-key');
    assert.equal(options.method, undefined);
    return Response.json({ data: [] });
  };
  const env = {
    PIX_READINESS_PROBE_ENABLED: 'true',
    ASAAS_PRODUCTION_API_KEY: 'test-key',
  };
  assert.equal(await activePixKeyStatus(env, 'production'), false);
  assert.equal(await activePixKeyStatus(env, 'production'), false);
  assert.equal(calls, 1);
});

test('Pix readiness is unknown if probing is not enabled', async () => {
  assert.equal(await activePixKeyStatus({}, 'production'), null);
});
