// Real API-backed operational screens for iFood homologation.
// These routes use only the local test app/merchant; production stays isolated.
import { ifoodConfigured, ifoodRequest, quoteDetails, trackingUrl } from './ifood-shipping.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAYS = new Set(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']);
const WEEKEND = [
  { dayOfWeek: 'SATURDAY', start: '10:00:00', duration: 540 },
  { dayOfWeek: 'SUNDAY', start: '09:00:00', duration: 180 },
  { dayOfWeek: 'SUNDAY', start: '13:00:00', duration: 180 },
  { dayOfWeek: 'SUNDAY', start: '17:00:00', duration: 360 },
];
const ok = data => ({ status: 200, data });
const err = (error, status = 422) => ({ status, data: { error } });
const id = value => {
  if (!UUID.test(value || '')) throw Error('Identificador iFood inválido.');
  return value;
};
const limitedJson = async request => {
  const raw = await request.text();
  if (raw.length > 16000) throw Error('Requisição muito grande.');
  return JSON.parse(raw);
};

export function testIFoodConfigured(env) {
  return env.LOCAL_DEVELOPMENT === 'true' && ifoodConfigured({
    IFOOD_CLIENT_ID: env.IFOOD_TEST_CLIENT_ID,
    IFOOD_CLIENT_SECRET: env.IFOOD_TEST_CLIENT_SECRET,
    IFOOD_MERCHANT_ID: env.IFOOD_TEST_MERCHANT_ID,
  });
}
export function testIFoodEnv(env) {
  if (!testIFoodConfigured(env)) throw Error('Aplicativo de testes iFood indisponível neste ambiente.');
  return { ...env, IFOOD_CLIENT_ID: env.IFOOD_TEST_CLIENT_ID,
    IFOOD_CLIENT_SECRET: env.IFOOD_TEST_CLIENT_SECRET,
    IFOOD_MERCHANT_ID: env.IFOOD_TEST_MERCHANT_ID };
}
const merchant = env => '/merchant/v1.0/merchants/' + id(env.IFOOD_MERCHANT_ID);
const shippingOrder = orderId => '/shipping/v1.0/orders/' + id(orderId);
const money = value => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 300) throw Error('Valor inválido.');
  return Math.round(n * 100) / 100;
};

export function mergeWeekendShifts(current, merchantId) {
  id(merchantId);
  const existing = Array.isArray(current) ? current : Array.isArray(current?.shifts) ? current.shifts : [];
  const weekdays = existing.filter(s => DAYS.has(s.dayOfWeek) &&
    s.dayOfWeek !== 'SATURDAY' && s.dayOfWeek !== 'SUNDAY').map(
      s => ({ dayOfWeek: s.dayOfWeek, start: s.start, duration: s.duration }));
  return { storeId: merchantId, shifts: [...weekdays, ...WEEKEND] };
}

function normalizedAddress(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const lat = Number(a.latitude), lon = Number(a.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
    lat < -35 || lat > 6 || lon < -75 || lon > -30)
    throw Error('Coordenadas inválidas para endereço de teste no Brasil.');
  const postalCode = String(a.postalCode || '').replace(/\D/g, '');
  const streetName = String(a.streetName || '').trim().slice(0, 50);
  const streetNumber = String(a.streetNumber || '').trim().slice(0, 15);
  const neighborhood = String(a.neighborhood || '').trim().slice(0, 50);
  const city = String(a.city || '').trim().slice(0, 50);
  const state = String(a.state || '').trim().toUpperCase();
  if (!/^\d{8}$/.test(postalCode) || !streetName || !streetNumber ||
    !neighborhood || !city || !/^[A-Z]{2}$/.test(state))
    throw Error('Endereço de teste incompleto.');
  return { postalCode, streetName, streetNumber, neighborhood, city, state,
    country: 'BR', complement: String(a.complement || '').slice(0, 50),
    reference: String(a.reference || '').slice(0, 70),
    coordinates: { latitude: lat, longitude: lon } };
}

export function makeExternalTestOrder(input) {
  id(input?.quoteId);
  const a = normalizedAddress(input.address);
  const phone = String(input.phone || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  const name = String(input.name || '').trim();
  if (!/^\d{10,11}$/.test(phone) || name.length < 2 || name.length > 50)
    throw Error('Nome ou telefone inválido.');
  const items = input.items;
  if (!Array.isArray(items) || !items.length || items.length > 30) throw Error('Itens do pedido inválidos.');
  let total = 0;
  const normalizedItems = items.map(item => {
    const n = String(item.name || '').trim().slice(0, 50);
    const q = Number(item.quantity), p = money(item.unitPrice);
    if (!n || !Number.isInteger(q) || q < 1 || q > 100 || p < 0.01)
      throw Error('Item ou quantidade inválido.');
    const line = Math.round(p * q * 100) / 100; total += line;
    return { id: crypto.randomUUID(), name: n, quantity: q,
      unitPrice: p, price: line, optionsPrice: 0, totalPrice: line };
  });
  const fee = money(input.fee);
  return {
    customer: { name, phone: { countryCode: '55', areaCode: phone.slice(0, 2),
      number: phone.slice(2), type: 'CUSTOMER' } },
    delivery: { merchantFee: fee, quoteId: input.quoteId, deliveryAddress: a },
    items: normalizedItems,
    payments: { methods: [{ method: 'CREDIT', type: 'OFFLINE',
      value: Math.round((total + fee) * 100) / 100, card: { brand: 'VISA' } }] },
    displayId: crypto.randomUUID().slice(0, 4).toUpperCase(),
  };
}

const eventIdentity = event => String(event?.eventId || event?.id || '');
const eventOrder = event => String(event?.orderId || event?.order?.id || '');
const eventCode = event => String(event?.fullCode || event?.code || '').slice(0, 48);
const pickupCode = data => {
  const v = data?.pickupCode ?? data?.delivery?.pickupCode ??
    data?.order?.pickupCode ?? data?.delivery?.pickup?.code;
  return v == null ? null : String(v).slice(0, 40);
};

export async function pollTestIFoodEvents(env, now = Date.now()) {
  const t = testIFoodEnv(env);
  const state = await env.DB.prepare('SELECT last_poll_ms FROM ifood_poll_state WHERE channel=?').bind('test').first();
  if (state && now - state.last_poll_ms < 30_000)
    return { newEvents: 0, duplicates: 0, skipped: true, nextPollAt: state.last_poll_ms + 30_000 };
  await env.DB.prepare('INSERT INTO ifood_poll_state(channel,last_poll_ms) VALUES (?,?) ' +
    'ON CONFLICT(channel) DO UPDATE SET last_poll_ms=excluded.last_poll_ms')
    .bind('test', now).run();
  // Test orders generated by Developer Portal emit ORDER events. The Shipping
  // test console must not filter those out; production logistics remains
  // separately scoped to DELIVERY in ifood-shipping.mjs.
  const events = await ifoodRequest(t, '/events/v1.0/events:polling?excludeHeartbeat=true',
    { headers: { 'x-polling-merchants': t.IFOOD_MERCHANT_ID } });
  if (events === null) return { newEvents: 0, duplicates: 0,
    acknowledged: 0, events: [], polledAt: new Date(now).toISOString(),
    nextPollAt: now + 30_000 };
  if (!Array.isArray(events)) throw Error('Eventos iFood retornaram formato inválido.');
  const acknowledged = [], recent = [];
  let newEvents = 0, duplicates = 0;
  for (const event of events.slice(0, 100)) {
    const eid = eventIdentity(event), oid = eventOrder(event);
    if (!UUID.test(eid) || (event.merchantId && event.merchantId !== t.IFOOD_MERCHANT_ID)) continue;
    const result = await env.DB.prepare('INSERT OR IGNORE INTO ifood_event_log ' +
      '(channel,event_id,order_id,event_code,pickup_code) VALUES (?,?,?,?,?)')
      .bind('test', eid, UUID.test(oid) ? oid : null, eventCode(event), pickupCode(event)).run();
    if (result.meta.changes) newEvents++; else duplicates++;
    acknowledged.push({ id: eid });
    recent.push({ eventId: eid, orderId: oid, code: eventCode(event), pickupCode: pickupCode(event) });
  }
  if (acknowledged.length) await ifoodRequest(t, '/events/v1.0/events/acknowledgment',
    { method: 'POST', body: acknowledged });
  return { newEvents, duplicates, acknowledged: acknowledged.length, events: recent,
    polledAt: new Date(now).toISOString(), nextPollAt: now + 30_000 };
}

export async function ifoodAdminAction(request, env) {
  const path = new URL(request.url).pathname.replace(/^\/api\/admin\/ifood/, '');
  if (path === '/config' && request.method === 'GET')
    return ok({ configured: testIFoodConfigured(env),
      clientId: testIFoodConfigured(env) ? env.IFOOD_TEST_CLIENT_ID : null,
      merchantId: testIFoodConfigured(env) ? env.IFOOD_TEST_MERCHANT_ID : null,
      environment: 'sandbox', intervalSeconds: 30 });
  if (!testIFoodConfigured(env)) return err('Ambiente de homologação iFood desabilitado.', 503);
  const t = testIFoodEnv(env), base = merchant(t);
  const method = request.method;
  try {
    if (path === '/merchants' && method === 'GET')
      return ok(await ifoodRequest(t, '/merchant/v1.0/merchants'));
    if (path === '/merchant' && method === 'GET')
      return ok(await ifoodRequest(t, base));
    if (path === '/merchant/status' && method === 'GET')
      return ok(await ifoodRequest(t, base + '/status'));
    if (path === '/merchant/interruptions' && method === 'GET')
      return ok(await ifoodRequest(t, base + '/interruptions'));
    if (path === '/merchant/interruptions' && method === 'POST') {
      const body = await limitedJson(request);
      const start = Date.parse(body.start), end = Date.parse(body.end);
      const description = String(body.description || '').trim();
      if (!description || description.length > 255 || !Number.isFinite(start) ||
        !Number.isFinite(end) || end - start < 60_000 || end - start > 7 * 86400_000 ||
        end <= Date.now()) return err('Interrupção inválida; informe motivo e período de 1 minuto a 7 dias.');
      return ok(await ifoodRequest(t, base + '/interruptions', { method: 'POST',
        body: { description, start: new Date(start).toISOString(), end: new Date(end).toISOString() } }));
    }
    const interruption = /^\/merchant\/interruptions\/([^/]+)$/.exec(path);
    if (interruption && method === 'DELETE') {
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(interruption[1])) return err('Identificador de pausa inválido.');
      return ok({ removed: true, result: await ifoodRequest(t,
        base + '/interruptions/' + encodeURIComponent(interruption[1]), { method: 'DELETE' }) });
    }
    if (path === '/merchant/hours' && method === 'GET')
      return ok(await ifoodRequest(t, base + '/opening-hours'));
    if (path === '/merchant/hours/weekend-checklist' && method === 'PUT') {
      const existing = await ifoodRequest(t, base + '/opening-hours');
      const shifts = mergeWeekendShifts(Array.isArray(existing) ? existing[0] : existing, t.IFOOD_MERCHANT_ID);
      return ok({ configured: shifts, result: await ifoodRequest(t,
        base + '/opening-hours', { method: 'PUT', body: shifts }) });
    }
    if (path === '/inside/confirm' && method === 'POST') {
      const body = await limitedJson(request), orderId = id(body.orderId);
      const details = await ifoodRequest(t, '/order/v1.0/orders/' + orderId);
      if (details?.isTest !== true || details?.merchant?.id !== t.IFOOD_MERCHANT_ID ||
          details?.category !== 'FOOD') {
        return err('Somente pedidos FOOD da loja de testes podem ser confirmados.', 403);
      }
      return ok({ accepted: true, result: await ifoodRequest(t,
        '/order/v1.0/orders/' + orderId + '/confirm', { method: 'POST' }) });
    }
    if (path === '/inside/quote' && method === 'POST') {
      const body = await limitedJson(request);
      return ok(await ifoodRequest(t, shippingOrder(body.orderId) + '/deliveryAvailabilities'));
    }
    if (path === '/inside/request-driver' && method === 'POST') {
      const body = await limitedJson(request);
      return ok({ accepted: true, result: await ifoodRequest(t, shippingOrder(body.orderId) +
        '/requestDriver', { method: 'POST', body: { quoteId: id(body.quoteId) } }) });
    }
    if (path === '/outside/quote' && method === 'POST') {
      const body = await limitedJson(request), lat = Number(body.latitude), lon = Number(body.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -35 || lat > 6 || lon < -75 || lon > -30)
        return err('Coordenadas inválidas para consulta.');
      const result = quoteDetails(await ifoodRequest(t, '/shipping/v1.0/merchants/' + t.IFOOD_MERCHANT_ID +
        '/deliveryAvailabilities?latitude=' + encodeURIComponent(lat) + '&longitude=' + encodeURIComponent(lon)));
      await env.DB.prepare('INSERT OR REPLACE INTO ifood_test_quotes ' +
        '(quote_id,merchant_id,fee_cents,latitude,longitude,expires_at) VALUES (?,?,?,?,?,?)')
        .bind(result.externalQuoteId, t.IFOOD_MERCHANT_ID,
          result.feeCents, lat, lon, result.expiresAt).run();
      return ok(result);
    }
    if (path === '/outside/create' && method === 'POST') {
      const body = await limitedJson(request);
      const stored = await env.DB.prepare('SELECT * FROM ifood_test_quotes WHERE quote_id=?').bind(body.quoteId).first();
      if (!stored || stored.merchant_id !== t.IFOOD_MERCHANT_ID ||
        Date.parse(stored.expires_at) <= Date.now()) return err('Cotação expirada; consulte novamente.');
      const payload = makeExternalTestOrder({ ...body, fee: stored.fee_cents / 100 });
      if (Math.abs(payload.delivery.deliveryAddress.coordinates.latitude - stored.latitude) > 0.00001 ||
          Math.abs(payload.delivery.deliveryAddress.coordinates.longitude - stored.longitude) > 0.00001)
        return err('Endereço diferente do usado na cotação.');
      const result = await ifoodRequest(t, '/shipping/v1.0/merchants/' + t.IFOOD_MERCHANT_ID + '/orders',
        { method: 'POST', body: payload });
      if (!UUID.test(result?.id || '')) throw Error('iFood não retornou ID de pedido válido.');
      await env.DB.prepare('INSERT OR IGNORE INTO ifood_test_orders ' +
        '(order_id,origin,tracking_url) VALUES (?,?,?)')
        .bind(result.id, 'outside', trackingUrl(result.trackingUrl)).run();
      return ok({ id: result.id, trackingUrl: trackingUrl(result.trackingUrl) });
    }
    if (path === '/events/poll' && method === 'POST')
      return ok(await pollTestIFoodEvents(env));
    if (path === '/events' && method === 'GET')
      return ok({ events: (await env.DB.prepare(
        'SELECT event_id AS eventId,order_id AS orderId,event_code AS code,pickup_code AS pickupCode,received_at AS receivedAt ' +
        "FROM ifood_event_log WHERE channel='test' ORDER BY received_at DESC LIMIT 100").all()).results });
    const orderMatch = /^\/orders\/([0-9a-f-]{36})\/(details|cancellation-reasons|cancel|address\/accept|address\/deny|address\/request)$/.exec(path);
    if (orderMatch) {
      const orderId = id(orderMatch[1]), action = orderMatch[2], route = shippingOrder(orderId);
      if (action === 'details' && method === 'GET') {
        const details = await ifoodRequest(t, '/order/v1.0/orders/' + orderId);
        return ok({ order: details, pickupCode: pickupCode(details) });
      }
      if (action === 'cancellation-reasons' && method === 'GET')
        return ok(await ifoodRequest(t, route + '/cancellationReasons'));
      if (action === 'cancel' && method === 'POST') {
        const body = await limitedJson(request);
        const reasons = await ifoodRequest(t, route + '/cancellationReasons');
        const selected = Array.isArray(reasons) && reasons.find(r =>
          Number(r.cancelCodeId) === Number(body.cancellationCode));
        if (!selected || !String(body.reason || '').trim()) return err('Selecione um motivo de cancelamento da API.');
        return ok({ accepted: true, result: await ifoodRequest(t, route + '/cancel', {
          method: 'POST', body: { reason: String(body.reason).trim().slice(0, 255),
            // The iFood sandbox accepts its returned cancelCodeId as a string.
            cancellationCode: String(selected.cancelCodeId) } }) });
      }
      if (['address/accept','address/deny','address/request'].includes(action) && method === 'POST') {
        const suffix = { 'address/accept': 'acceptDeliveryAddressChange',
          'address/deny': 'denyDeliveryAddressChange',
          'address/request': 'deliveryAddressChangeRequest' }[action];
        const body = action === 'address/request' ? await limitedJson(request) : null;
        const address = body ? normalizedAddress(body.address || body) : null;
        if (address) delete address.postalCode;
        return ok({ accepted: true, result: await ifoodRequest(t, route + '/' + suffix,
          { method: 'POST', ...(address ? { body: address } : {}) }) });
      }
    }
    return err('Operação iFood inexistente.', 404);
  } catch (error) {
    const status = Number(error.status) || (error instanceof SyntaxError ? 400 : 422);
    return err(error.message || 'Falha na API do iFood.', status);
  }
}
