import { paymentConfig } from './asaas-environments.mjs';

function asaasHeaders(key) {
  return { access_token: key, Accept: 'application/json', 'Content-Type': 'application/json',
    'User-Agent': 'Kipeixe-Orders/2.1' };
}

const pixKeyStatusCache = new Map();

// The operator requests the provisioning job exclusively through private D1
// configuration. No public endpoint, login cookie or Asaas API credential is
// exposed. The state is claimed before any external mutation, preventing
// duplicate EVP registrations across overlapping cron invocations.
export async function provisionPixKeyIfRequested(env) {
  if (!env.DB) return 'unavailable';
  const record = await env.DB.prepare(
    "SELECT value FROM store_settings WHERE key='pix_setup_request'"
  ).first();
  if (record?.value !== 'requested') return 'not_requested';
  const claim = await env.DB.prepare(
    "UPDATE store_settings SET value='processing' WHERE key='pix_setup_request' AND value='requested'"
  ).run();
  if (!claim.meta?.changes) return 'already_claimed';

  let result = 'review';
  try {
    const { key, url } = paymentConfig(env, 'production');
    if (!key) throw new Error('api_key_missing');
    const headers = asaasHeaders(key);
    const existingResponse = await fetch(`${url}/pix/addressKeys?limit=100`, {
      headers, signal: AbortSignal.timeout(12000),
    });
    if (!existingResponse.ok) {
      result = `lookup_http_${existingResponse.status}`;
      return result;
    }
    const existing = await existingResponse.json();
    if (!Array.isArray(existing?.data)) throw new Error('invalid_key_list');
    if (existing.data.some(entry => entry.status === 'ACTIVE')) {
      result = 'already_active';
      return result;
    }
    if (existing.data.some(entry => entry.status === 'AWAITING_ACTIVATION')) {
      result = 'awaiting_activation';
      return result;
    }
    const created = await fetch(`${url}/pix/addressKeys`, {
      method: 'POST', headers, body: JSON.stringify({ type: 'EVP' }),
      signal: AbortSignal.timeout(15000),
    });
    if (!created.ok) {
      const payload = await created.json().catch(() => ({}));
      const code = String(payload?.errors?.[0]?.code || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
      result = `creation_http_${created.status}${code ? '_' + code : ''}`;
      return result;
    }
    result = 'created_awaiting_activation';
    pixKeyStatusCache.delete('production');
    return result;
  } catch (error) {
    // The request may have succeeded if the network disconnected. Do not
    // automatically create another key after an ambiguous outcome.
    result = error?.name === 'TimeoutError' ? 'review_timeout' : 'review_transport';
    console.warn('Pix provisioning needs review:', error?.name);
    return result;
  } finally {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE store_settings SET value='completed' WHERE key='pix_setup_request' AND value='processing'"
      ),
      env.DB.prepare(
        "INSERT INTO store_settings(key,value) VALUES ('pix_setup_result',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
      ).bind(result),
    ]);
  }
}

export async function activePixKeyStatus(env, mode) {
  if (env.PIX_READINESS_PROBE_ENABLED !== 'true') return null;
  const { key, url } = paymentConfig(env, mode);
  if (!key) return null;
  const previous = pixKeyStatusCache.get(mode);
  if (previous && previous.expiresAt > Date.now()) return previous.value;
  try {
    const response = await fetch(url + '/pix/addressKeys?status=ACTIVE&limit=20', {
      headers: asaasHeaders(key), signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return null;
    const result = await response.json();
    if (!Array.isArray(result?.data)) return null;
    const value = result.data.some(item => item.status === 'ACTIVE' &&
      /^[0-9a-f-]{36}$/i.test(String(item.id || '')));
    pixKeyStatusCache.set(mode, { value, expiresAt: Date.now() + 120000 });
    return value;
  } catch {
    return null; // Unknown status must not be misrepresented as missing.
  }
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
  if (!first) {
    const error = new Error('Asaas: cadastre e ative uma chave Pix na conta para exibir o QR Code.');
    error.code = 'PIX_KEY_UNAVAILABLE';
    throw error;
  }

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
