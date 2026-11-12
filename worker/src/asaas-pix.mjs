import { paymentConfig } from './asaas-environments.mjs';

function asaasHeaders(key) {
  return { access_token: key, Accept: 'application/json', 'Content-Type': 'application/json',
    'User-Agent': 'Kipeixe-Orders/2.1' };
}

export function pixRequestBody(order, addressKeyId) {
  if (!/^[0-9a-f-]{36}$/i.test(order.id) || !/^[0-9a-f-]{36}$/i.test(addressKeyId)) {
    throw new Error('Chave Pix não identificada.');
  }
  return {
    addressKey: addressKeyId,
    description: `Kipeixe - Pedido ${order.id.slice(0, 8)}`,
    value: order.totalCents / 100,
    format: 'ALL',
    expirationSeconds: 3600,
    allowsMultiplePayments: false,
    externalReference: order.id,
  };
}

export function checkedPixQrCode(data) {
  // QR and copia-e-cola must BOTH be returned by Asaas. Never synthesize a code.
  const id = String(data?.id || '');
  const payload = String(data?.payload || '');
  const encodedImage = String(data?.encodedImage || '');
  if (!/^[a-z0-9-]{15,100}$/i.test(id) || !/^[A-Za-z0-9+/=]{40,50000}$/.test(encodedImage) ||
      payload.length < 30 || payload.length > 5000) throw new Error('QR Code Pix incompleto no Asaas.');
  return { id, payload, encodedImage };
}

export async function createAsaasPix(order, env, mode) {
  const { key, url } = paymentConfig(env, mode);
  if (!key) throw new Error('Credencial Asaas não configurada.');
  const headers = asaasHeaders(key);
  const keysResponse = await fetch(`${url}/pix/addressKeys?status=ACTIVE&limit=20`, {
    headers, signal: AbortSignal.timeout(15000),
  });
  const keys = await keysResponse.json().catch(() => ({}));
  if (!keysResponse.ok) throw new Error(`Asaas Pix: consulta de chaves HTTP ${keysResponse.status}.`);
  const first = (keys.data || []).find(item => item.status === 'ACTIVE' &&
    /^[0-9a-f-]{36}$/i.test(item.id));
  if (!first) throw new Error('Asaas: cadastre e ative uma chave Pix na conta para exibir o QR Code.');

  const response = await fetch(`${url}/pix/qrCodes/static`, {
    method: 'POST', headers, signal: AbortSignal.timeout(15000),
    body: JSON.stringify(pixRequestBody(order, first.id)),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const descriptions = Array.isArray(data?.errors) ? data.errors.map(e => String(e.description || '').slice(0, 220)).join(' | ') : '';
    throw new Error(`Asaas Pix HTTP ${response.status}${descriptions ? ': ' + descriptions : ''}`);
  }
  return checkedPixQrCode(data);
}

export function pixPaymentMatches(order, payment) {
  return payment?.pixQrCodeId === order.pix_qr_id &&
    Number.isInteger(order.total_cents) && Number(payment.value) === order.total_cents / 100 &&
    payment.billingType === 'PIX' && payment.status === 'RECEIVED';
}
