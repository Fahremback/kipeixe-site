import test from 'node:test';
import assert from 'node:assert/strict';
import { asaasCheckoutPayload } from '../src/app.mjs';
import { checkoutCustomerAddress, checkoutCustomerData } from '../src/asaas-customer.mjs';

const id = 'ad2b3ed3-7cd8-49df-8b55-c72b93bf7d70';
const base = {
  id, name: 'Cliente Kipeixe', phone: '55 (45) 99999-9999',
  type: 'Retirada no Kipeixe', address: '', deliveryCents: 0,
  items: [{ name: 'Tilápia', qty: 1, variant: '', unitCents: 5500 }],
};

test('Pix checkout pre-fills only already collected name and mobile phone', () => {
  const payload = asaasCheckoutPayload(base, ['PIX']);
  assert.deepEqual(payload.customerData, {
    name: base.name, phone: '45999999999',
  });
  assert.equal('customer' in payload, false);
  assert.equal('email' in payload.customerData, false);
  assert.equal('cpfCnpj' in payload.customerData, false);
  assert.equal('address' in payload.customerData, false);
  assert.deepEqual(payload.items, [
    { name: 'Tilápia', description: undefined, quantity: 1, value: 55 },
  ]);
});

test('card checkout shares the same prefilled identification without fictitious details', () => {
  const payload = asaasCheckoutPayload({
    ...base, type: 'Consumir no local', address: 'Av. João Ricieri Maran, 1417',
  }, ['CREDIT_CARD']);
  assert.deepEqual(payload.customerData, { name: base.name, phone: '45999999999' });
});

test('verified iFood delivery provides street, number, district, zip and correct city code', () => {
  const order = {
    ...base, type: 'Entrega',
    address: 'Rua dos Ipês, 123, Vila A, CEP 85850000, Foz do Iguaçu - PR',
    ifoodAddress: {
      streetName: 'Rua dos Ipês', streetNumber: '123', neighborhood: 'Vila A',
      postalCode: '85850000', complement: 'Casa 2', city: 'Foz do Iguaçu',
    },
  };
  assert.deepEqual(checkoutCustomerData(order), {
    name: base.name, phone: '45999999999',
    address: 'Rua dos Ipês', addressNumber: 123,
    province: 'Vila A', postalCode: '85850000', complement: 'Casa 2',
    city: 4108304,
  });
  assert.deepEqual(asaasCheckoutPayload(order, ['PIX']).customerData,
    checkoutCustomerData(order));
});

test('Uber free-text address is mapped only when street, number and district are clear', () => {
  const order = { ...base, type: 'Entrega', address: 'Rua São Paulo, 415, Centro' };
  assert.deepEqual(checkoutCustomerAddress(order), {
    address: 'Rua São Paulo', addressNumber: 415, province: 'Centro',
  });
  assert.deepEqual(checkoutCustomerAddress({
    ...order, address: 'Perto da ponte e ao lado da farmácia',
  }), {});
});

test('optional documented tax id and e-mail are forwarded only if real and valid', () => {
  const data = checkoutCustomerData({
    ...base, cpfCnpj: '529.982.247-25', email: 'cliente@example.com',
  });
  assert.equal(data.cpfCnpj, '52998224725');
  assert.equal(data.email, 'cliente@example.com');
  const invalid = checkoutCustomerData({
    ...base, cpfCnpj: '11111111111', email: 'sem-email',
  });
  assert.equal(invalid.cpfCnpj, undefined);
  assert.equal(invalid.email, undefined);
});

test('existing checkout payload still omits customerData if no buyer data is known', () => {
  const payload = asaasCheckoutPayload({
    id, deliveryCents: 0,
    items: [{ name: 'Tilápia', qty: 1, unitCents: 5500 }],
  }, ['PIX']);
  assert.equal(payload.customerData, undefined);
});
