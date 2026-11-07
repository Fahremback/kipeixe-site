import test from 'node:test';
import assert from 'node:assert/strict';
import { sweepExpired } from '../src/management.mjs';

test('checkout payments expire after 60 minutes even when Asaas webhook is missing', async () => {
  const statements = [];
  const env = {
    DB: {
      prepare(sql) {
        statements.push(sql);
        return {
          bind(...values) {
            return {
              run: async () => ({ meta: { changes: 0 } }),
              all: async () => ({ results: [] }),
              values,
            };
          },
        };
      },
    },
  };
  const now = new Date('2026-11-07T18:00:00.000Z');
  const rejected = await sweepExpired(env, now);
  assert.equal(rejected, 0);
  assert.match(statements[0], /payment_status='EXPIRED'/);
  assert.match(statements[0], /payment_status='PENDING'/);
  assert.match(statements[0], /datetime\(created_at, '\+60 minutes'\)/);
  assert.ok(!statements[0].includes('REVIEW'));
});
