import test from 'node:test';
import assert from 'node:assert/strict';
import { expireOrphanedPaymentReviews } from '../src/review-maintenance.mjs';

function fixture(environment = 'production') {
  const events = [];
  const rows = [{ id: 'd26d71f2-b324-4f50-8470-70c3d99ad79b', asaas_environment: environment }];
  const env = {
    ASAAS_PRODUCTION_API_KEY: 'fake-production-credential',
    DB: {
      prepare(sql) {
        const args = [];
        return {
          bind(...values) { args.push(...values); return this; },
          async all() { assert.match(sql, /checkout_id IS NULL/); return { results: rows }; },
          async run() {
            events.push({ sql, args });
            return { meta: { changes: sql.startsWith('UPDATE orders') ? 1 : 0 } };
          },
        };
      },
    },
  };
  return { env, events };
}

test('old orphaned review closes only when Asaas reports no payment', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let lookups = 0;
  globalThis.fetch = async (url, options) => {
    lookups++;
    assert.match(url, /\/payments\?externalReference=d26d71f2/);
    assert.equal(options.method, undefined);
    assert.equal(options.headers.access_token, 'fake-production-credential');
    return Response.json({ data: [] });
  };
  const { env, events } = fixture();
  assert.equal(await expireOrphanedPaymentReviews(env), 1);
  assert.equal(lookups, 1);
  assert.equal(events.length, 2);
  assert.match(events[0].sql, /payment_status='EXPIRED'/);
  assert.match(events[0].sql, /datetime\(created_at\) < datetime\(\?, '-48 hours'\)/);
  assert.equal(events[1].args[1], 'STALE_PAYMENT_REVIEW_EXPIRED');
});

test('any Asaas payment or failed lookup preserves review for reconciliation', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const { env, events } = fixture();
  globalThis.fetch = async () => Response.json({ data: [{ id: 'pay_existing', status: 'RECEIVED' }] });
  assert.equal(await expireOrphanedPaymentReviews(env), 0);
  globalThis.fetch = async () => new Response(null, { status: 503 });
  assert.equal(await expireOrphanedPaymentReviews(env), 0);
  assert.equal(events.length, 0);
});

test('sandbox orphaned reviews can be closed without payment API', async () => {
  const { env, events } = fixture('sandbox');
  assert.equal(await expireOrphanedPaymentReviews(env), 1);
  assert.equal(events.length, 2);
});
