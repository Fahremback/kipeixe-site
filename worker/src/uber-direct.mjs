// Uber Direct integration. Credentials and signing keys remain server-side.
// https://developer.uber.com/docs/deliveries/get-started
const encoder = new TextEncoder();
let accessToken = null;
let tokenExpires = 0;

export const PICKUP_ADDRESS = 'Av. João Ricieri Maran, 1417, Três Lagoas, Foz do Iguaçu - PR, 85862-425, Brasil';
export const PICKUP_PHONE = '+554535772363';
export const uberConfigured = env => Boolean(
  env.UBER_DIRECT_CLIENT_ID && env.UBER_DIRECT_CLIENT_SECRET &&
  env.UBER_DIRECT_CUSTOMER_ID && env.UBER_DIRECT_WEBHOOK_SECRET &&
  env.UBER_PICKUP_ADDRESS && env.UBER_PICKUP_PHONE &&
  !env.UBER_DIRECT_CLIENT_ID.includes('NAO_CONFIGURADO'));
export const uberReady = (env, settings) => Boolean(
  uberConfigured(env) && env.UBER_DIRECT_ENABLED === 'true' &&
  settings.uberEnabled && settings.deliveryEnabled);

export function normalizedAddress(address) {
  const a = String(address || '').trim().replace(/\s+/g, ' ');
  if (a.length < 12 || a.length > 220 || !/\d/.test(a))
    throw Error('Informe rua, número e bairro para a entrega.');
  return /foz do igua[cç]u/i.test(a) ? a : a + ', Foz do Iguaçu - PR, Brasil';
}

async function oauth(env) {
  if (!uberConfigured(env)) throw Error('Uber Direct não configurado.');
  if (accessToken && tokenExpires > Date.now()) return accessToken;
  const params = new URLSearchParams({
    client_id: env.UBER_DIRECT_CLIENT_ID,
    client_secret: env.UBER_DIRECT_CLIENT_SECRET,
    grant_type: 'client_credentials', scope: 'eats.deliveries',
  });
  const result = await fetch('https://auth.uber.com/oauth/v2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params, signal: AbortSignal.timeout(12000),
  });
  if (!result.ok) throw Error('OAuth Uber Direct HTTP ' + result.status);
  const data = await result.json();
  if (!data.access_token) throw Error('Token Uber Direct inválido.');
  accessToken = data.access_token;
  tokenExpires = Date.now() + Math.max(60, (Number(data.expires_in) || 3600) - 120) * 1000;
  return accessToken;
}

export async function uberRequest(env, path, method = 'GET', payload = null) {
  if (!/^[\w-]{8,128}$/.test(env.UBER_DIRECT_CUSTOMER_ID || ''))
    throw Error('Customer ID Uber Direct inválido.');
  const response = await fetch('https://api.uber.com/v1/customers/' +
    encodeURIComponent(env.UBER_DIRECT_CUSTOMER_ID) + '/' + path, {
    method, signal: AbortSignal.timeout(16000),
    headers: { Authorization: 'Bearer ' + await oauth(env),
      Accept: 'application/json', 'Content-Type': 'application/json' },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = Error('Uber Direct HTTP ' + response.status);
    error.status = response.status;
    throw error;
  }
  return data;
}

export function parseQuote(quote, now = Date.now()) {
  const fee = quote?.fee, expires = Date.parse(quote?.expires || '');
  if (!/^[\w-]{8,128}$/.test(quote?.id || '') ||
      !Number.isSafeInteger(fee) || fee < 0 || fee > 30000 ||
      String(quote.currency_type || quote.currency || '').toUpperCase() !== 'BRL' ||
      !Number.isFinite(expires) || expires < now + 30_000 || expires > now + 20 * 60_000) {
    throw Error('Cotação Uber indisponível ou moeda inválida.');
  }
  return { uberQuoteId: quote.id, feeCents: fee, expiresAt: new Date(expires).toISOString() };
}

export async function quoteDelivery(env, destination) {
  const address = normalizedAddress(destination);
  const quote = await uberRequest(env, 'delivery_quotes', 'POST', {
    pickup_address: env.UBER_PICKUP_ADDRESS, dropoff_address: address,
    pickup_phone_number: env.UBER_PICKUP_PHONE,
  });
  return { address, ...parseQuote(quote) };
}

export function trackingUrl(value) {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      ['uber.com', 'ubereats.com'].some(host => url.hostname === host || url.hostname.endsWith('.' + host))
      ? url.href : null;
  } catch { return null; }
}

export function deliveryPayload(order, quote, env) {
  const items = JSON.parse(order.items_json);
  return {
    quote_id: quote.uberQuoteId,
    pickup_address: env.UBER_PICKUP_ADDRESS,
    pickup_name: 'Kipeixe Restaurante e Pesca',
    pickup_business_name: 'Kipeixe',
    pickup_phone_number: env.UBER_PICKUP_PHONE,
    pickup_notes: 'Retirar pedido pronto no balcão e confirmar referência.',
    dropoff_address: normalizedAddress(order.address),
    dropoff_name: order.name,
    dropoff_phone_number: '+55' + String(order.phone).replace(/\D/g, '').replace(/^55/, ''),
    dropoff_notes: order.notes || '',
    manifest_reference: order.id.slice(0, 8).toUpperCase(),
    manifest_total_value: order.subtotal_cents,
    manifest_items: items.map(item => ({
      name: String(item.name).slice(0, 90), quantity: item.qty,
      price: item.unitCents, size: 'small',
    })),
    undeliverable_action: 'return',
    deliverable_action: 'deliverable_action_meet_at_door',
    external_id: order.id,
    idempotency_key: order.id,
  };
}

export async function dispatchDelivery(env, orderId) {
  const order = await env.DB.prepare('SELECT id,name,phone,address,notes,items_json,' +
    'subtotal_cents,delivery_cents,payment_status,fulfillment_status,order_type,' +
    'scheduled_for,uber_status,uber_delivery_id FROM orders WHERE id=?').bind(orderId).first();
  if (!order || order.order_type !== 'Entrega' || order.payment_status !== 'PAID' ||
      order.fulfillment_status !== 'READY') return { status: 'NOT_ELIGIBLE' };
  if (order.uber_delivery_id) return { status: order.uber_status, id: order.uber_delivery_id };
  if (order.scheduled_for && Date.parse(order.scheduled_for) > Date.now() + 45 * 60_000)
    return { status: 'WAITING_SCHEDULE' };
  if (!['QUOTED', 'FAILED'].includes(order.uber_status)) return { status: order.uber_status || 'REVIEW' };
  if (!uberConfigured(env) || env.UBER_DIRECT_ENABLED !== 'true') return { status: 'DISABLED' };
  const claim = await env.DB.prepare(
    "UPDATE orders SET uber_status='REQUESTING',updated_at=CURRENT_TIMESTAMP " +
    "WHERE id=? AND uber_delivery_id IS NULL AND uber_status IN ('QUOTED','FAILED')"
  ).bind(order.id).run();
  if (!claim.meta.changes) return { status: 'REQUESTING' };
  try {
    // Quote expires in 15 minutes; the food can take longer to prepare.
    const quote = await quoteDelivery(env, order.address);
    if (quote.feeCents > order.delivery_cents) {
      await env.DB.prepare("UPDATE orders SET uber_status='PRICE_CHANGED'," +
        "uber_dispatch_error='Frete atualizado acima do valor pago; revisão necessária' WHERE id=?")
        .bind(order.id).run();
      return { status: 'PRICE_CHANGED' };
    }
    await env.DB.prepare('UPDATE orders SET uber_quote_id=?,uber_quote_fee_cents=? WHERE id=?')
      .bind(quote.uberQuoteId, quote.feeCents, order.id).run();
    const delivery = await uberRequest(env, 'deliveries', 'POST', deliveryPayload(order, quote, env));
    if (!/^del_[\w-]+$/.test(delivery?.id || '')) throw Error('Entrega Uber sem identificador.');
    const state = String(delivery.status || 'pending').slice(0, 40);
    await env.DB.prepare('UPDATE orders SET uber_delivery_id=?,uber_status=?,' +
      'uber_tracking_url=?,uber_dispatch_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .bind(delivery.id, state, trackingUrl(delivery.tracking_url), order.id).run();
    return { status: state, id: delivery.id };
  } catch (e) {
    // An HTTP 4xx is definitive. Timeouts/5xx might have dispatched: never blind-retry.
    const safeRetry = Number(e.status) >= 400 && Number(e.status) < 500;
    const state = safeRetry ? 'FAILED' : 'REVIEW';
    await env.DB.prepare('UPDATE orders SET uber_status=?,uber_dispatch_error=?,' +
      'updated_at=CURRENT_TIMESTAMP WHERE id=? AND uber_status=?')
      .bind(state, String(e.message).slice(0, 200), order.id, 'REQUESTING').run();
    return { status: state };
  }
}

export async function dispatchScheduledReady(env) {
  if (!uberConfigured(env) || env.UBER_DIRECT_ENABLED !== 'true' || !env.DB) return 0;
  const nowPlus45 = new Date(Date.now() + 45 * 60_000).toISOString();
  const orders = (await env.DB.prepare("SELECT id FROM orders WHERE payment_status='PAID' " +
    "AND fulfillment_status='READY' AND order_type='Entrega' AND uber_status='QUOTED' " +
    'AND scheduled_for IS NOT NULL AND scheduled_for <= ? LIMIT 20').bind(nowPlus45).all()).results;
  let count = 0;
  for (const row of orders) {
    const result = await dispatchDelivery(env, row.id);
    if (result.id) count++;
  }
  return count;
}

export async function verifySignature(raw, signature, secret) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(signature || '')) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(raw)));
  const expected = [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.toLowerCase().charCodeAt(i);
  return diff === 0;
}

export async function uberWebhook(request, env) {
  if (!uberConfigured(env)) return { status: 503, data: { error: 'Uber Direct indisponível.' } };
  const raw = await request.text();
  if (raw.length > 50000 || !await verifySignature(raw,
    request.headers.get('x-uber-signature') || request.headers.get('x-postmates-signature'),
    env.UBER_DIRECT_WEBHOOK_SECRET)) {
    return { status: 401, data: { error: 'Assinatura Uber inválida.' } };
  }
  let payload;
  try { payload = JSON.parse(raw); } catch { return { status: 400, data: { error: 'JSON inválido.' } }; }
  if (payload.kind !== 'event.delivery_status') return { status: 200, data: { ok: true } };
  if (payload.customer_id && payload.customer_id !== env.UBER_DIRECT_CUSTOMER_ID)
    return { status: 403, data: { error: 'Customer ID divergente.' } };
  const deliveryId = String(payload.delivery_id || '');
  const status = String(payload.status || payload.data?.status || '');
  if (!/^del_[\w-]+$/.test(deliveryId) || !/^[a-z_]{3,40}$/.test(status))
    return { status: 400, data: { error: 'Evento inválido.' } };
  const orderId = String(payload.data?.external_id || '');
  const order = await env.DB.prepare('SELECT id FROM orders WHERE uber_delivery_id=? OR ' +
    "(id=? AND uber_status IN ('REQUESTING','REVIEW')) LIMIT 1")
    .bind(deliveryId, orderId).first();
  if (!order) return { status: 503, data: { error: 'Entrega ainda não sincronizada.' } };
  await env.DB.prepare('UPDATE orders SET uber_delivery_id=?,uber_status=?,' +
    'uber_tracking_url=COALESCE(?,uber_tracking_url),uber_dispatch_error=NULL,' +
    "fulfillment_status=CASE WHEN ?='delivered' AND fulfillment_status='READY' THEN 'COMPLETED' " +
    'ELSE fulfillment_status END,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .bind(deliveryId, status, trackingUrl(payload.data?.tracking_url), status, order.id).run();
  return { status: 200, data: { ok: true } };
}
