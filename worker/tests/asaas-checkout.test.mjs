import test from 'node:test';
import assert from 'node:assert/strict';
import { asaasCheckoutItems } from '../src/app.mjs';

test('checkout items respect Asaas 30-character name limit', () => {
  const fullName = 'Filé de tilápia crocante ao molho especial (porção grande)';
  const items = asaasCheckoutItems({
    items: [{
      name: 'Filé de tilápia crocante ao molho especial',
      variant: 'porção grande',
      qty: 2,
      unitCents: 2900,
    }],
    deliveryCents: 975,
  });
  assert.equal(items.length, 2);
  assert.equal(items[0].name, fullName.slice(0, 30));
  assert.equal(items[0].description, fullName);
  assert.equal(items[0].quantity, 2);
  assert.equal(items[0].value, 29);
  assert.deepEqual(items[1], { name: 'Entrega', quantity: 1, value: 9.75 });
});

test('short item names are preserved and description stays optional', () => {
  const items = asaasCheckoutItems({
    items: [{ name: 'Tilápia', variant: '', qty: 1, unitCents: 5500 }],
    deliveryCents: 0,
  });
  assert.equal(items[0].name, 'Tilápia');
  assert.equal(items[0].description, undefined);
  assert.equal(items[0].value, 55);
});
