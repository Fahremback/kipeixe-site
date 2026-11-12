import test from 'node:test';
import assert from 'node:assert/strict';
import { asaasCheckoutItems, asaasCheckoutBillingTypes, asaasErrorDetails } from '../src/app.mjs';

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

test('checkout accepts explicit Pix and credit-card selections', () => {
  assert.deepEqual(asaasCheckoutBillingTypes('PIX'), ['PIX']);
  assert.deepEqual(asaasCheckoutBillingTypes('CREDIT_CARD'), ['CREDIT_CARD']);
});

test('legacy checkout allows both; invalid methods are rejected', () => {
  assert.deepEqual(asaasCheckoutBillingTypes(undefined), ['PIX', 'CREDIT_CARD']);
  assert.deepEqual(asaasCheckoutBillingTypes(''), ['PIX', 'CREDIT_CARD']);
  assert.throws(() => asaasCheckoutBillingTypes('BOLETO'), /Forma de pagamento/);
  assert.throws(() => asaasCheckoutBillingTypes(['PIX']), /Forma de pagamento/);
});

test('Asaas 400 invalid_object exposes the missing field instead of dropping the description', () => {
  const result = asaasErrorDetails({
    errors: [
      { code: 'invalid_object', description: 'O campo items deve ser informado.' },
      { code: 'invalid_object', description: 'billingTypes inválido.' },
    ],
  });
  assert.equal(result.code, 'invalid_object');
  assert.equal(result.description, 'O campo items deve ser informado. | billingTypes inválido.');
});

test('Asaas 400 diagnostic redacts credentials and limits untrusted descriptions', () => {
  const result = asaasErrorDetails({
    errors: [{code: 'invalid_object', description: '$aact_prod_SECRETVALUE ' + 'a'.repeat(2000)}],
  });
  assert.ok(!result.description.includes('$aact_prod_'));
  assert.ok(result.description.length <= 600);
  assert.equal(asaasErrorDetails(null).description, '');
});
