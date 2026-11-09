import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../training-engine.js', import.meta.url), 'utf8');
const first = Date.parse('2026-11-09T18:00:00.000Z');

function create(storage = new Map()) {
  const window = {};
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, String(value)); },
  };
  // No fetch, backend, payment provider or courier API is available to this VM.
  runInNewContext(source, { window, localStorage, Date, JSON });
  return { engine: window.KipeixeTraining, storage };
}

test('enables locally, generates fictional paid orders, never charges anyone', () => {
  const { engine } = create();
  assert.equal(engine.isEnabled(), false);
  assert.equal(engine.activate(first), true);
  assert.equal(engine.isEnabled(), true);
  assert.equal(engine.list().length, 2);
  for (const order of engine.list()) {
    assert.equal(order.training, true);
    assert.equal(order.asaas_environment, 'training');
    assert.equal(order.payment_status, 'PAID');
    assert.equal(order.fulfillment_status, 'AWAITING_ACCEPTANCE');
    assert.equal(order.acceptance_deadline, null);
    assert.match(order.id, /^TRN-/);
  }
  assert.equal(engine.tick(first + 11999).arrivals, 0);
  assert.equal(engine.tick(first + 12000).arrivals, 1);
  assert.equal(engine.list().length, 3);
});

test('unaccepted orders never expire, including after days and browser reloads', () => {
  const { engine, storage } = create();
  engine.activate(first);
  for (let i = 1; i <= 30; i++) engine.tick(first + i * 12000);
  assert.equal(engine.pending(), 6);
  const pendingIds = engine.list().map(o => o.id);
  engine.tick(first + 30 * 24 * 3600000);
  assert.equal(engine.pending(), 6);
  assert.deepEqual(Array.from(engine.list(), o => o.id), Array.from(pendingIds));
  const reloaded = create(storage).engine;
  assert.equal(reloaded.isEnabled(), true);
  assert.equal(reloaded.pending(), 6);
  assert.deepEqual(Array.from(reloaded.list(), o => o.id), Array.from(pendingIds));
});

test('accepting progresses automatically at 5s boundaries and then completes', () => {
  const { engine } = create();
  engine.activate(first);
  const id = engine.list()[0].id;
  assert.equal(engine.act(id, 'ACCEPT', first), true);
  const status = () => engine.list().find(o => o.id === id).fulfillment_status;
  assert.equal(status(), 'PREPARING');
  engine.tick(first + 4999);
  assert.equal(status(), 'PREPARING');
  engine.tick(first + 5000);
  assert.equal(status(), 'READY');
  engine.tick(first + 9999);
  assert.equal(status(), 'READY');
  engine.tick(first + 10000);
  assert.equal(status(), 'COMPLETED');
  assert.equal(engine.act(id, 'REJECT'), false);
});

test('rejecting, reset, disable and reenable never modify real orders', () => {
  const { engine, storage } = create();
  engine.activate(first);
  const id = engine.list()[0].id;
  assert.equal(engine.act(id, 'REJECT', first), true);
  assert.equal(engine.list().find(o => o.id === id).fulfillment_status, 'REJECTED');
  assert.equal(engine.act('real-asaas-id', 'ACCEPT'), false);
  assert.equal(engine.spawnNow(first + 500), true);
  engine.deactivate();
  assert.equal(engine.isEnabled(), false);
  assert.equal(engine.act(engine.list()[1].id, 'ACCEPT'), false);
  assert.equal(engine.tick(first + 9999999).changed, false);
  assert.equal(create(storage).engine.isEnabled(), false);
  engine.activate(first + 10000);
  engine.reset(first + 11000);
  assert.equal(engine.pending(), 2);
  assert.equal(engine.list().length, 2);
});
