// iFood Shipping / Entrega Fácil for orders created outside iFood.
// https://developer.ifood.com.br/en-US/docs/food/guides/modules/shipping/outside
const API = 'https://merchant-api.ifood.com.br';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let auth = { token: '', expires: 0, signature: '' };

export const ifoodConfigured = env => Boolean(
  UUID.test(env.IFOOD_MERCHANT_ID || '') &&
  UUID.test(env.IFOOD_CLIENT_ID || '') &&
  env.IFOOD_CLIENT_SECRET && env.IFOOD_CLIENT_SECRET.length >= 20 &&
  !env.IFOOD_CLIENT_SECRET.includes('NAO_CONFIGURADO'));
export const ifoodReady = (env, settings) => Boolean(
  env.IFOOD_SHIPPING_ENABLED === 'true' && ifoodConfigured(env) &&
  settings.ifoodEnabled && settings.deliveryEnabled);

const roundMoney = value => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw Error('Valor de frete iFood inválido.');
  return Math.round(value * 100);
};
export function validateAddress(source) {
  const input = source && typeof source === 'object' ? source : {};
  const postalCode = String(input.postalCode || '').replace(/\D/g, '');
  const streetName = String(input.streetName || '').trim();
  const streetNumber = String(input.streetNumber || '').trim();
  const neighborhood = String(input.neighborhood || '').trim();
  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);
  if (!/^\d{8}$/.test(postalCode) || !streetName || streetName.length > 50 ||
      !streetNumber || streetNumber.length > 15 ||
      !neighborhood || neighborhood.length > 50 ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -26 || latitude > -25 || longitude < -55 || longitude > -54 ||
      String(input.city || 'Foz do Iguaçu').toLowerCase() !== 'foz do iguaçu') {
    throw Error('Informe CEP, rua, número, bairro e localização exata em Foz do Iguaçu.');
  }
  return { postalCode, streetName, streetNumber, neighborhood, latitude, longitude,
    complement: String(input.complement || '').trim().slice(0, 50),
    reference: String(input.reference || '').trim().slice(0, 70),
    city: 'Foz do Iguaçu', state: 'PR', country: 'BR' };
}
export const addressText = address => {
  const a = validateAddress(address);
  return a.streetName + ', ' + a.streetNumber + ', ' + a.neighborhood +
    ', CEP ' + a.postalCode + ', Foz do Iguaçu - PR';
};

export function quoteDetails(data, now = Date.now()) {
  const expiry = Date.parse(data?.expirationAt || '');
  const feeCents = roundMoney(data?.quote?.netValue);
  if (!UUID.test(data?.id || '') || feeCents > 30000 || !Number.isFinite(expiry) ||
      expiry < now + 30_000 || expiry > now + 36 * 3600_000) {
    throw Error('Cotação do iFood inválida ou expirada.');
  }
  return { externalQuoteId: data.id, feeCents, expiresAt: new Date(expiry).toISOString(),
    preparationSeconds: Number.isFinite(data.preparationTime) ? data.preparationTime : 0 };
}

async function accessToken(env) {
  if (!ifoodConfigured(env)) throw Error('Credenciais iFood não configuradas.');
  const signature = env.IFOOD_CLIENT_ID + ':' + env.IFOOD_CLIENT_SECRET;
  if (auth.token && Date.now() < auth.expires && auth.signature === signature) return auth.token;
  const started = Date.now();
  const result = await fetch(API + '/authentication/v1.0/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json' },
    body: new URLSearchParams({ grantType: 'client_credentials',
      clientId: env.IFOOD_CLIENT_ID, clientSecret: env.IFOOD_CLIENT_SECRET }),
    signal: AbortSignal.timeout(13000),
  });
  try { env.IFOOD_API_LOGGER?.({ method:'POST',
    route:'/authentication/v1.0/oauth/token', status:result.status,
    durationMs:Date.now()-started }); } catch {}
  if (!result.ok) throw Error('Autenticação iFood HTTP ' + result.status);
  const data = await result.json();
  if (!data.accessToken || typeof data.accessToken !== 'string')
    throw Error('iFood não retornou access token.');
  auth = { token: data.accessToken, signature,
    expires: Date.now() + Math.max(30, Number(data.expiresIn || 3600) - 120) * 1000 };
  return data.accessToken;
}

export async function ifoodRequest(env, route, { method = 'GET', body = null, headers = {} } = {}) {
  if (!/^\/(shipping\/v1\.0\/|events\/v1\.0\/|merchant\/v1\.0\/|order\/v1\.0\/)/.test(route))
    throw Error('Endpoint iFood não permitido.');
  const started = Date.now();
  const response = await fetch(API + route, {
    method, headers: { Authorization: 'Bearer ' + await accessToken(env),
      Accept: 'application/json', 'Content-Type': 'application/json', ...headers },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(16000),
  });
  try { env.IFOOD_API_LOGGER?.({ method, route, status:response.status,
    durationMs:Date.now()-started,
    requestId:response.headers.get('x-request-id') ||
      response.headers.get('x-correlation-id') || null }); } catch {}
  const result = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = String(result?.code || result?.error || '').slice(0, 80);
    const detail = String(result?.message || result?.description || '').slice(0, 180);
    const error = Error('API iFood HTTP ' + response.status +
      (code ? ' [' + code + ']' : '') + (detail ? ': ' + detail : ''));
    error.status = response.status;
    error.apiError = result;
    throw error;
  }
  return result;
}

export async function quoteIFood(env, address) {
  const destination = validateAddress(address);
  const route = '/shipping/v1.0/merchants/' + env.IFOOD_MERCHANT_ID +
    '/deliveryAvailabilities?latitude=' + encodeURIComponent(destination.latitude) +
    '&longitude=' + encodeURIComponent(destination.longitude);
  return { address: destination,
    ...quoteDetails(await ifoodRequest(env, route)) };
}

export function trackingUrl(value) {
  if (typeof value !== 'string' || value.length > 400) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      (url.hostname === 'meupedido.ifood.com.br' || url.hostname === 'ifood.com.br' ||
       url.hostname.endsWith('.ifood.com.br')) ? url.href : null;
  } catch { return null; }
}

export function registerPayload(order, quote, address) {
  const normalized = validateAddress(address);
  const phone = String(order.phone).replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (!/^\d{10,11}$/.test(phone)) throw Error('Telefone inválido para iFood.');
  const items = JSON.parse(order.items_json);
  return {
    customer: { name: String(order.name).slice(0, 50), phone: {
      countryCode: '55', areaCode: phone.slice(0, 2), number: phone.slice(2), type: 'CUSTOMER',
    } },
    delivery: {
      merchantFee: quote.feeCents / 100, quoteId: quote.externalQuoteId,
      deliveryAddress: {
        postalCode: normalized.postalCode, streetNumber: normalized.streetNumber,
        streetName: normalized.streetName, neighborhood: normalized.neighborhood,
        city: normalized.city, state: normalized.state, country: 'BR',
        complement: normalized.complement, reference: normalized.reference,
        coordinates: { latitude: normalized.latitude, longitude: normalized.longitude },
      },
    },
    // Payments omitted: the restaurant already collected payment through Asaas.
    items: items.map(item => ({
      id: crypto.randomUUID(), name: String(item.name).slice(0, 50),
      quantity: item.qty, unitPrice: item.unitCents / 100,
      price: item.unitCents * item.qty / 100, optionsPrice: 0,
      totalPrice: item.unitCents * item.qty / 100,
    })),
    displayId: order.id.slice(0, 4).toUpperCase(),
  };
}

export async function dispatchIFood(env, orderId) {
  if (!ifoodConfigured(env) || env.IFOOD_SHIPPING_ENABLED !== 'true')
    return { status: 'DISABLED' };
  const row = await env.DB.prepare('SELECT id,name,phone,items_json,subtotal_cents,delivery_cents,' +
    'payment_status,fulfillment_status,order_type,scheduled_for,ifood_status,ifood_order_id,' +
    'ifood_address_json FROM orders WHERE id=?').bind(orderId).first();
  if (!row || row.payment_status !== 'PAID' || row.fulfillment_status !== 'READY' ||
      row.order_type !== 'Entrega' || !row.ifood_address_json)
    return { status: 'NOT_ELIGIBLE' };
  if (row.ifood_order_id) return { status: row.ifood_status, id: row.ifood_order_id };
  if (!['QUOTED', 'FAILED'].includes(row.ifood_status)) return { status: row.ifood_status || 'REVIEW' };
  if (row.scheduled_for && Date.parse(row.scheduled_for) > Date.now() + 45 * 60_000)
    return { status: 'WAITING_SCHEDULE' };
  const claim = await env.DB.prepare("UPDATE orders SET ifood_status='REQUESTING'," +
    "updated_at=CURRENT_TIMESTAMP WHERE id=? AND ifood_order_id IS NULL " +
    "AND ifood_status IN ('QUOTED','FAILED')").bind(orderId).run();
  if (!claim.meta.changes) return { status: 'REQUESTING' };
  try {
    const address = JSON.parse(row.ifood_address_json);
    const newQuote = await quoteIFood(env, address);
    if (newQuote.feeCents > row.delivery_cents) {
      await env.DB.prepare("UPDATE orders SET ifood_status='PRICE_CHANGED'," +
        "ifood_dispatch_error='Frete iFood atualizado acima da taxa cobrada' WHERE id=?")
        .bind(orderId).run();
      return { status: 'PRICE_CHANGED' };
    }
    const result = await ifoodRequest(env,
      '/shipping/v1.0/merchants/' + env.IFOOD_MERCHANT_ID + '/orders',
      { method: 'POST', body: registerPayload(row, newQuote, address) });
    if (!UUID.test(result?.id || '')) throw Error('iFood não retornou identificador válido.');
    await env.DB.prepare("UPDATE orders SET ifood_order_id=?,ifood_status='REQUESTED'," +
      'ifood_tracking_url=?,ifood_dispatch_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .bind(result.id, trackingUrl(result.trackingUrl), orderId).run();
    return { id: result.id, status: 'REQUESTED' };
  } catch (error) {
    // Network errors/5xx after registration may mean a courier was already allocated.
    const definitive = Number(error.status) >= 400 && Number(error.status) < 500;
    const state = definitive ? 'FAILED' : 'REVIEW';
    await env.DB.prepare('UPDATE orders SET ifood_status=?,ifood_dispatch_error=?,' +
      "updated_at=CURRENT_TIMESTAMP WHERE id=? AND ifood_status='REQUESTING'")
      .bind(state, String(error.message).slice(0, 220), orderId).run();
    return { status: state };
  }
}

export async function dispatchScheduledIFood(env) {
  if (!ifoodConfigured(env) || env.IFOOD_SHIPPING_ENABLED !== 'true' || !env.DB) return 0;
  const cutoff = new Date(Date.now() + 45 * 60_000).toISOString();
  const orders = (await env.DB.prepare(
    "SELECT id FROM orders WHERE payment_status='PAID' AND fulfillment_status='READY' " +
    "AND order_type='Entrega' AND delivery_provider='ifood' AND ifood_status='QUOTED' " +
    "AND scheduled_for IS NOT NULL AND scheduled_for <= ? LIMIT 20"
  ).bind(cutoff).all()).results || [];
  let count = 0;
  for (const row of orders) {
    const result = await dispatchIFood(env, row.id);
    if (result.id) count++;
  }
  return count;
}

export async function syncIFoodEvents(env) {
  if (!ifoodConfigured(env) || env.IFOOD_SHIPPING_ENABLED !== 'true' || !env.DB) return 0;
  const now = Date.now();
  const last = await env.DB.prepare('SELECT last_poll_ms FROM ifood_poll_state WHERE channel=?')
    .bind('production').first();
  if (last && now - last.last_poll_ms < 30_000) return 0;
  await env.DB.prepare('INSERT INTO ifood_poll_state(channel,last_poll_ms) VALUES (?,?) ' +
    'ON CONFLICT(channel) DO UPDATE SET last_poll_ms=excluded.last_poll_ms')
    .bind('production', now).run();
  const events = await ifoodRequest(env, '/events/v1.0/events:polling?excludeHeartbeat=true&groups=DELIVERY',
    { headers: { 'x-polling-merchants': env.IFOOD_MERCHANT_ID } });
  if (!Array.isArray(events) || !events.length) return 0;
  const handled = [];
  for (const event of events.slice(0, 100)) {
    const eventId = event.eventId || event.id;
    const orderId = event.orderId || event.order?.id;
    if (!UUID.test(eventId || '') ||
        (event.merchantId && event.merchantId !== env.IFOOD_MERCHANT_ID)) continue;
    const existing = await env.DB.prepare(
      'SELECT event_id FROM ifood_event_log WHERE channel=? AND event_id=?')
      .bind('production', eventId).first();
    if (existing) { handled.push({ id: eventId }); continue; }
    const row = UUID.test(orderId || '') ? await env.DB.prepare(
      'SELECT id FROM orders WHERE ifood_order_id=?').bind(orderId).first() : null;
    const code = String(event.fullCode || event.code || '').slice(0, 48);
    const pickup = event.pickupCode || event.order?.pickupCode || event.delivery?.pickupCode || null;
    if (row) {
      await env.DB.prepare('UPDATE orders SET ifood_status=?,' +
        "fulfillment_status=CASE WHEN ?='DELIVERY_CONCLUDED' " +
        "AND fulfillment_status='READY' THEN 'COMPLETED' ELSE fulfillment_status END," +
        'ifood_pickup_code=COALESCE(?,ifood_pickup_code),' +
        'updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .bind(code, code, pickup ? String(pickup).slice(0, 40) : null, row.id).run();
    }
    await env.DB.prepare('INSERT OR IGNORE INTO ifood_event_log ' +
      '(channel,event_id,order_id,event_code,pickup_code) VALUES (?,?,?,?,?)')
      .bind('production', eventId, UUID.test(orderId || '') ? orderId : null,
        code, pickup ? String(pickup).slice(0, 40) : null).run();
    handled.push({ id: eventId });
  }
  if (handled.length) await ifoodRequest(env, '/events/v1.0/events/acknowledgment',
    { method: 'POST', body: handled });
  return handled.length;
}
