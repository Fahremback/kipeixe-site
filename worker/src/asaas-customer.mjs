import { validCpfCnpj } from './cpf-validation.mjs';

const digits = value => String(value || '').replace(/\D/g, '');
const text = (value, max = 120) => String(value || '').trim().slice(0, max);

// Populate only fields actually provided by the buyer. Do not synthesize an
// email, tax ID or a home address for pickup / dine-in purchases.
export function checkoutCustomerData(order) {
  const customer = {};
  if (typeof order?.name === 'string' && order.name.trim())
    customer.name = text(order.name, 90);
  const phone = digits(order?.phone).replace(/^55(?=\d{10,11}$)/, '');
  if (/^\d{10,11}$/.test(phone)) customer.phone = phone;
  const taxId = digits(order?.cpfCnpj);
  if (taxId && validCpfCnpj(taxId)) customer.cpfCnpj = taxId;
  if (typeof order?.email === 'string' &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.email.trim()) &&
      order.email.trim().length <= 150) customer.email = order.email.trim();
  if (order?.type === 'Entrega') {
    const address = checkoutCustomerAddress(order);
    Object.assign(customer, address);
  }
  return customer;
}

// Convert known, structured delivery details into the Asaas schema. Its
// addressNumber and city fields are integers. Do not guess invalid values.
export function checkoutCustomerAddress(order) {
  if (order?.type !== 'Entrega') return {};
  const known = order.ifoodAddress;
  if (known && typeof known === 'object') {
    const out = {};
    if (text(known.streetName)) out.address = text(known.streetName);
    const number = digits(known.streetNumber);
    if (/^[1-9]\d{0,8}$/.test(number) &&
        /^\d+$/.test(String(known.streetNumber).trim()))
      out.addressNumber = Number(number);
    if (text(known.neighborhood)) out.province = text(known.neighborhood, 100);
    const postalCode = digits(known.postalCode);
    if (/^\d{8}$/.test(postalCode)) out.postalCode = postalCode;
    if (text(known.complement)) out.complement = text(known.complement, 150);
    // The existing iFood delivery form verifies that the address is in Foz.
    if (known.city === 'Foz do Iguaçu') out.city = 4108304;
    return out;
  }
  // Uber Direct uses one free-text field. Extract only unambiguous
  // "street, house-number, neighborhood" details.
  const raw = text(order.address, 250);
  const parts = raw.split(',').map(part => part.trim());
  if (parts.length < 3 || !parts[0] ||
      !/^[1-9]\d{0,8}$/.test(parts[1]) || !parts[2]) return {};
  const result = {
    address: text(parts[0]), addressNumber: Number(parts[1]),
    province: text(parts[2], 100),
  };
  const cep = raw.match(/\bCEP\s*:?\s*(\d{5}-?\d{3})\b/i);
  if (cep) result.postalCode = digits(cep[1]);
  return result;
}
