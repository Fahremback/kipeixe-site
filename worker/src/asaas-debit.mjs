import { paymentConfig } from './asaas-environments.mjs';
import { checkoutCustomerAddress } from './asaas-customer.mjs';
import { validCpfCnpj } from './cpf-validation.mjs';

const digits = value => String(value || '').replace(/\D/g, '');

export { validCpfCnpj };

export function validInvoiceUrl(raw, mode) {
  if (typeof raw !== 'string') return false;
  try {
    const url = new URL(raw);
    const hosts = mode === 'sandbox'
      ? ['sandbox.asaas.com', 'www.sandbox.asaas.com']
      : ['asaas.com', 'www.asaas.com'];
    return url.protocol === 'https:' && hosts.includes(url.hostname) &&
      /^\/i\/[a-z0-9_-]+\/?$/i.test(url.pathname) &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

export function invoicePaymentMatches(order, payment) {
  return Boolean(order && payment && order.id === payment.externalReference &&
    /^pay_[a-z0-9_-]{5,100}$/i.test(String(payment.id || '')) &&
    (!order.payment_id || order.payment_id === payment.id) &&
    !order.checkout_id && !order.pix_qr_id &&
    ['CREDIT_CARD', 'DEBIT_CARD'].includes(payment.billingType) &&
    ['CONFIRMED', 'RECEIVED'].includes(payment.status) && payment.deleted !== true &&
    Number.isFinite(Number(payment.value)) &&
    Math.round(Number(payment.value) * 100) === order.total_cents);
}

function invoiceDueDate() {
  // Next calendar day in the restaurant's timezone (not UTC), avoiding an
  // invoice immediately overdue at midnight.
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(Date.now() + 86400000));
}

export function asaasDebitInvoicePayload(order, customerId) {
  return {
    customer: customerId,
    billingType: 'CREDIT_CARD', // Invoice presents debit card; the API does not accept DEBIT_CARD.
    value: order.totalCents / 100,
    dueDate: invoiceDueDate(),
    description: 'Pedido Kipeixe ' + order.id.slice(0, 8).toUpperCase(),
    externalReference: order.id,
    callback: {
      successUrl: 'https://restaurantekipeixe.com.br/?pedido=' + order.id + '&retorno=pagamento#cardapio',
      autoRedirect: true,
    },
  };
}

async function asaasPost(url, key, data) {
  const response = await fetch(url, {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json',
      'User-Agent': 'Kipeixe-Orders/2.0', access_token: key },
    body: JSON.stringify(data),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error('Asaas payment request rejected');
    error.asaasHttpStatus = response.status;
    error.asaasCode = String(body?.errors?.[0]?.code || '').slice(0, 60);
    // Never log customer details or CPF/CNPJ.
    throw error;
  }
  return body;
}

export async function createDebitInvoice(order, cpfCnpj, env, mode) {
  if (!validCpfCnpj(cpfCnpj)) {
    const error = new Error('CPF ou CNPJ inválido.');
    error.validation = true;
    throw error;
  }
  const account = paymentConfig(env, mode);
  const taxId = digits(cpfCnpj);
  // Reuse an existing Asaas customer to avoid duplicates on repeat purchases.
  const listed = await fetch(account.url + '/customers?cpfCnpj=' + taxId + '&limit=10', {
    headers: { Accept: 'application/json', 'User-Agent': 'Kipeixe-Orders/2.0',
      access_token: account.key }, signal: AbortSignal.timeout(12000),
  });
  if (!listed.ok) {
    const error = new Error('Asaas customer lookup rejected');
    error.asaasHttpStatus = listed.status;
    throw error;
  }
  const customers = await listed.json();
  if (!Array.isArray(customers?.data)) throw Error('Asaas customer lookup inconclusive.');
  let customerId = customers.data.find(item =>
    digits(item.cpfCnpj) === taxId && item.deleted !== true)?.id;
  if (!customerId) {
    const customer = await asaasPost(account.url + '/customers', account.key, {
      name: order.name, cpfCnpj: taxId,
      mobilePhone: digits(order.phone).replace(/^55(?=\d{10,11}$)/, ''),
      ...Object.fromEntries(Object.entries(checkoutCustomerAddress(order))
        .filter(([key]) => key !== 'city')),
      externalReference: order.id, notificationDisabled: true,
    });
    customerId = customer.id;
  }
  if (!/^cus_[a-z0-9_-]{5,100}$/i.test(String(customerId || '')))
    throw new Error('Identificador do cliente Asaas inválido.');
  const result = await asaasPost(account.url + '/payments', account.key,
    asaasDebitInvoicePayload(order, customerId));
  if (!/^pay_[a-z0-9_-]{5,100}$/i.test(String(result.id || '')) ||
      result.externalReference && result.externalReference !== order.id ||
      !validInvoiceUrl(result.invoiceUrl, mode)) {
    // An invoice may have been created despite an invalid response. Do NOT retry.
    throw new Error('Resposta de cobrança Asaas inconclusiva.');
  }
  return { paymentId: result.id, checkoutUrl: result.invoiceUrl };
}
