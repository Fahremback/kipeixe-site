import { getAppearance } from './appearance.mjs';
import {
  ALLOWED_ORIGINS, reply, fail, safeEqual, hash, isPaymentsReady, storeSettings,
  clientConfig, getCatalog, priceCart, handleAdmin, sweepExpired, refundOrder,
} from './management.mjs';
import { ORDER_TYPES, validateFulfillment, acceptanceDeadline } from './domain.mjs';
import { paymentConfig, PAYMENT_MODES } from './asaas-environments.mjs';
import { uberReady, quoteDelivery, normalizedAddress, uberWebhook, dispatchScheduledReady } from './uber-direct.mjs';
import { ifoodReady, quoteIFood, validateAddress as validateIFoodAddress,
  addressText as ifoodAddressText, syncIFoodEvents, dispatchScheduledIFood } from './ifood-shipping.mjs';
import { sendMetaOrderEvent } from './meta-capi.mjs';

const SITE = 'https://restaurantekipeixe.com.br/';
const CHECKOUT_EVENTS = new Set(['CHECKOUT_CREATED', 'CHECKOUT_PAID', 'CHECKOUT_CANCELED', 'CHECKOUT_EXPIRED']);
const digits = value => String(value ?? '').replace(/\D/g, '');

async function createDeliveryQuote(request, env, origin) {
  const settings = await storeSettings(env);
  const ifood = settings.deliveryProvider === 'ifood';
  if (!(ifood ? ifoodReady(env, settings) : uberReady(env, settings)) || !settings.ordersEnabled)
    return fail('Serviço de entregas indisponível.', 503, origin);
  let address, ifoodAddress;
  try {
    const raw = await request.text();
    if (raw.length > 2500) return fail('Endereço excessivo.', 413, origin);
    const data = JSON.parse(raw);
    if (ifood) {
      ifoodAddress = validateIFoodAddress(data.ifoodAddress);
      address = ifoodAddressText(ifoodAddress);
      if (data.address !== address) throw Error('Endereço foi alterado. Recalcule o frete.');
    } else address = normalizedAddress(data.address);
  } catch (error) { return fail(error.message || 'Endereço inválido.', 422, origin); }
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const windowStart = Math.floor(Date.now() / 900_000);
  await env.DB.prepare('INSERT INTO uber_quote_limits(ip,window_start,hits) VALUES (?,?,1) ' +
    'ON CONFLICT(ip,window_start) DO UPDATE SET hits=hits+1').bind(ip, windowStart).run();
  const limit = await env.DB.prepare('SELECT hits FROM uber_quote_limits WHERE ip=? AND window_start=?')
    .bind(ip, windowStart).first();
  if (limit.hits > 20) return fail('Muitas cotações. Tente depois.', 429, origin);
  try {
    if (ifood) {
      const quote = await quoteIFood(env, ifoodAddress);
      const id = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO ifood_quotes(id,external_quote_id,address_json,fee_cents,expires_at) ' +
        'VALUES (?,?,?,?,?)').bind(id, quote.externalQuoteId, JSON.stringify(quote.address),
        quote.feeCents, quote.expiresAt).run();
      return reply({ quoteId: id, provider: 'ifood', feeCents: quote.feeCents,
        expiresAt: quote.expiresAt }, 200, origin);
    }
    const quote = await quoteDelivery(env, address);
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO uber_quotes(id,uber_quote_id,address,fee_cents,expires_at) ' +
      'VALUES (?,?,?,?,?)').bind(id, quote.uberQuoteId, quote.address,
      quote.feeCents, quote.expiresAt).run();
    return reply({ quoteId: id, provider: 'uber', feeCents: quote.feeCents, expiresAt: quote.expiresAt }, 200, origin);
  } catch (e) {
    console.warn('Delivery quote:', e.message);
    return fail('Entrega indisponível neste endereço ou horário. Tente mais tarde.', 422, origin);
  }
}

async function throttle(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const windowStart = Math.floor(Date.now() / 600_000);
  await env.DB.prepare(`INSERT INTO order_limits(ip,window_start,hits) VALUES (?,?,1)
    ON CONFLICT(ip,window_start) DO UPDATE SET hits=hits+1`).bind(ip, windowStart).run();
  const row = await env.DB.prepare('SELECT hits FROM order_limits WHERE ip=? AND window_start=?')
    .bind(ip, windowStart).first();
  return row.hits <= 8;
}

function checkoutLink(id, mode) {
  const host = mode === 'sandbox' ? 'sandbox.asaas.com' : 'asaas.com';
  return `https://${host}/checkoutSession/show?id=${encodeURIComponent(id)}`;
}

export function asaasCheckoutItems(order) {
  const items = order.items.map(item => {
    const fullName = item.variant ? (item.name + ' (' + item.variant + ')') : item.name;
    return {
      name: fullName.slice(0, 30),
      description: fullName.length > 30 ? fullName.slice(0, 150) : undefined,
      quantity: item.qty,
      value: item.unitCents / 100,
    };
  });
  if (order.deliveryCents > 0) items.push({
    name: 'Entrega', quantity: 1, value: order.deliveryCents / 100,
  });
  return items;
}

export function asaasCheckoutBillingTypes(paymentMethod) {
  if (paymentMethod == null || paymentMethod === '') return ['PIX', 'CREDIT_CARD'];
  if (paymentMethod === 'PIX' || paymentMethod === 'CREDIT_CARD') return [paymentMethod];
  throw new Error('Forma de pagamento inválida.');
}

async function createAsaasCheckout(order, env, mode, billingTypes) {
  const account = paymentConfig(env, mode);
  const callback = {
    successUrl: `${SITE}?pedido=${order.id}&retorno=pagamento#cardapio`,
    cancelUrl: `${SITE}?pedido=${order.id}&retorno=cancelado#cardapio`,
    expiredUrl: `${SITE}?pedido=${order.id}&retorno=expirado#cardapio`,
  };
  const items = asaasCheckoutItems(order);
  const response = await fetch(`${account.url}/checkouts`, {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json',
      'User-Agent': 'Kipeixe-Orders/2.0', access_token: account.key },
    body: JSON.stringify({
      billingTypes, chargeTypes: ['DETACHED'], minutesToExpire: 60,
      externalReference: order.id, callback, items,
    }),
  });
  if (!response.ok) throw new Error(`Asaas HTTP ${response.status}`);
  const result = await response.json();
  if (!result?.id || !/^[a-z0-9-]{15,100}$/i.test(result.id)) throw new Error('Checkout inválido.');
  return { checkoutId: result.id, checkoutUrl: checkoutLink(result.id, mode) };
}

function validateBuyer(data, settings) {
  const customer = data.customer;
  if (!customer || typeof customer !== 'object') throw new Error('Dados do cliente inválidos.');
  const name = String(customer.name || '').trim();
  const phone = digits(customer.phone);
  const type = String(customer.type || '');
  const address = String(customer.address || '').trim();
  const notes = String(customer.notes || '').trim();
  if (name.length < 2 || name.length > 90) throw new Error('Informe seu nome.');
  if (!/^\d{10,13}$/.test(phone)) throw new Error('Informe telefone com DDD.');
  if (!ORDER_TYPES.has(type)) throw new Error('Forma de recebimento inválida.');
  if (address.length > 250 || notes.length > 500) throw new Error('Texto muito longo.');
  if (type === 'Entrega' && (!settings.deliveryEnabled || !address)) {
    throw new Error('Entrega indisponível ou endereço incompleto.');
  }
  return { name, phone, type, address, notes };
}

async function createOrder(request, env, origin, ctx) {
  const settings = await storeSettings(env);
  if (!isPaymentsReady(env, settings.paymentMode) || !settings.paymentsEnabled || !settings.ordersEnabled) {
    return fail('Pedidos online indisponíveis.', 503, origin);
  }
  let body, buyer, schedule, priced, billingTypes;
  try {
    if ((Number(request.headers.get('content-length')) || 0) > 25000) return fail('Pedido muito grande.', 413, origin);
    const text = await request.text();
    if (text.length > 25000) return fail('Pedido muito grande.', 413, origin);
    body = JSON.parse(text);
    buyer = validateBuyer(body, settings);
    billingTypes = asaasCheckoutBillingTypes(body.paymentMethod);
    schedule = validateFulfillment(body.mode, body.scheduledAt, settings.hours);
    priced = await priceCart(env, body.items);
  } catch (error) {
    return fail(error instanceof SyntaxError ? 'JSON inválido.' : error.message, 422, origin);
  }
  const requestId = String(body.requestId || ''), accessToken = String(body.accessToken || '');
  if (!/^[0-9a-f-]{36}$/i.test(requestId) || !/^[0-9a-f-]{36}$/i.test(accessToken)) {
    return fail('Identificador do pedido inválido.', 422, origin);
  }
  const tokenHash = await hash(accessToken);
  const previous = await env.DB.prepare('SELECT id, access_hash, checkout_url, payment_status FROM orders WHERE request_id = ?')
    .bind(requestId).first();
  if (previous) {
    if (!safeEqual(previous.access_hash, tokenHash)) return fail('Identificador já utilizado.', 409, origin);
    if (previous.checkout_url && previous.payment_status === 'PENDING') {
      return reply({ orderId: previous.id, checkoutUrl: previous.checkout_url }, 200, origin);
    }
    return fail('Pedido já registrado. Consulte seu status.', 409, origin);
  }
  if (!await throttle(request, env)) return fail('Muitos pedidos. Tente novamente depois.', 429, origin);
  let deliveryQuote = null;
  if (buyer.type === 'Entrega') {
    const ifood = settings.deliveryProvider === 'ifood';
    if (!(ifood ? ifoodReady(env, settings) : uberReady(env, settings)))
      return fail('Serviço de entregas indisponível.', 503, origin);
    const quoteId = String(body.deliveryQuoteId || '');
    if (!/^[0-9a-f-]{36}$/i.test(quoteId)) return fail('Calcule o frete antes de pagar.', 422, origin);
    const table = ifood ? 'ifood_quotes' : 'uber_quotes';
    deliveryQuote = await env.DB.prepare('SELECT * FROM ' + table + ' WHERE id=? AND ' +
      'expires_at > ? AND order_id IS NULL').bind(quoteId, new Date().toISOString()).first();
    if (ifood) {
      let normalized;
      try { normalized = validateIFoodAddress(body.ifoodAddress); }
      catch (error) { return fail(error.message, 422, origin); }
      if (!deliveryQuote || buyer.address !== ifoodAddressText(normalized) ||
          deliveryQuote.address_json !== JSON.stringify(normalized))
        return fail('Frete vencido ou endereço alterado. Calcule novamente.', 409, origin);
    } else if (!deliveryQuote || deliveryQuote.address !== normalizedAddress(buyer.address))
      return fail('Frete vencido ou endereço alterado. Calcule novamente.', 409, origin);
  }
  const deliveryCents = deliveryQuote ? deliveryQuote.fee_cents : 0;
  if (Number.isInteger(body.expectedTotalCents) &&
      body.expectedTotalCents !== priced.subtotalCents + deliveryCents) {
    return fail('Os preços do cardápio mudaram. Atualize a página antes de pagar.', 409, origin);
  }
  const order = {
    ...buyer, ...priced, deliveryCents, totalCents: priced.subtotalCents + deliveryCents,
    id: crypto.randomUUID(), requestId, accessToken, scheduledFor: schedule,
  };
  try {
    await env.DB.prepare(`INSERT INTO orders
      (id,request_id,access_hash,name,phone,order_type,address,notes,items_json,
       subtotal_cents,delivery_cents,total_cents,payment_status,fulfillment_status,scheduled_for,asaas_environment,
       uber_quote_id,uber_quote_fee_cents,uber_status,delivery_provider,ifood_quote_id,ifood_address_json,ifood_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'CREATING', 'AWAITING_PAYMENT', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(order.id, requestId, tokenHash, buyer.name, buyer.phone, buyer.type, buyer.address,
        buyer.notes, JSON.stringify(order.items), order.subtotalCents, deliveryCents, order.totalCents,
        schedule, settings.paymentMode, settings.deliveryProvider === 'uber' ? deliveryQuote?.uber_quote_id || null : null,
        settings.deliveryProvider === 'uber' ? deliveryQuote?.fee_cents ?? null : null,
        deliveryQuote && settings.deliveryProvider === 'uber' ? 'QUOTED' : null,
        buyer.type === 'Entrega' ? settings.deliveryProvider : null,
        settings.deliveryProvider === 'ifood' ? deliveryQuote?.external_quote_id || null : null,
        settings.deliveryProvider === 'ifood' ? deliveryQuote?.address_json || null : null,
        deliveryQuote && settings.deliveryProvider === 'ifood' ? 'QUOTED' : null).run();
  } catch { return fail('Pedido já registrado.', 409, origin); }
  if (deliveryQuote) {
    const quoteTable = settings.deliveryProvider === 'ifood' ? 'ifood_quotes' : 'uber_quotes';
    const claim = await env.DB.prepare('UPDATE ' + quoteTable + ' SET order_id=? WHERE id=? AND order_id IS NULL')
      .bind(order.id, deliveryQuote.id).run();
    if (!claim.meta.changes) {
      await env.DB.prepare('DELETE FROM orders WHERE id=?').bind(order.id).run();
      return fail('Cotação já utilizada. Recalcule o frete.', 409, origin);
    }
  }
  try {
    const checkout = await createAsaasCheckout(order, env, settings.paymentMode, billingTypes);
    await env.DB.prepare(`UPDATE orders SET checkout_id=?, checkout_url=?, payment_status='PENDING',
      updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(checkout.checkoutId, checkout.checkoutUrl, order.id).run();
    if (settings.paymentMode === 'production' && env.META_CAPI_ACCESS_TOKEN) {
      ctx.waitUntil(sendMetaOrderEvent(env, {
        name: 'InitiateCheckout', orderId: order.id, amountCents: order.totalCents,
        clientIp: request.headers.get('CF-Connecting-IP'), userAgent: request.headers.get('User-Agent'),
        paymentMode: settings.paymentMode,
      }).catch(error => console.warn('Meta CAPI checkout:', error.message)));
    }
    return reply({ orderId: order.id, checkoutUrl: checkout.checkoutUrl, totalCents: order.totalCents,
      scheduledFor: schedule, paymentMode: settings.paymentMode }, 201, origin);
  } catch (error) {
    // The provider may have created a payment even if the HTTP response was lost.
    await env.DB.prepare(`UPDATE orders SET payment_status='REVIEW', updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(order.id).run();
    return fail('Pagamento não confirmado. Não faça outro pedido antes de consultar o restaurante.', 502, origin);
  }
}

async function readOrder(request, env, origin, id) {
  if (!env.DB) return fail('Serviço indisponível.', 503, origin);
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!/^[0-9a-f-]{36}$/i.test(token)) return fail('Acesso negado.', 401, origin);
  const row = await env.DB.prepare(`SELECT id, access_hash, payment_status, fulfillment_status, total_cents,
    delivery_cents, checkout_url, scheduled_for, acceptance_deadline, created_at, refund_status, closed_reason,
    asaas_environment, uber_delivery_id, uber_status, uber_tracking_url,delivery_provider,
    ifood_order_id,ifood_status,ifood_tracking_url
    FROM orders WHERE id=?`).bind(id).first();
  if (!row || !safeEqual(row.access_hash, await hash(token))) return fail('Pedido não encontrado.', 404, origin);
  const { access_hash, ...data } = row;
  return reply({ orderId: data.id, paymentStatus: data.payment_status, orderStatus: data.fulfillment_status,
    totalCents: data.total_cents, deliveryCents: data.delivery_cents, checkoutUrl: data.checkout_url,
    scheduledFor: data.scheduled_for, acceptanceDeadline: data.acceptance_deadline, refundStatus: data.refund_status,
    closedReason: data.closed_reason, createdAt: data.created_at, paymentMode: data.asaas_environment,
    deliveryProvider: data.delivery_provider,
    uberDeliveryId: data.uber_delivery_id, uberStatus: data.uber_status, uberTrackingUrl: data.uber_tracking_url,
    ifoodOrderId: data.ifood_order_id, ifoodStatus: data.ifood_status,
    ifoodTrackingUrl: data.ifood_tracking_url }, 200, origin);
}

async function webhook(request, env, ctx, mode) {
  if (!PAYMENT_MODES.has(mode)) return fail('Ambiente inválido.', 404);
  const account = paymentConfig(env, mode);
  if (!env.DB || !account.webhookToken ||
      !safeEqual(request.headers.get('asaas-access-token') || '', account.webhookToken)) {
    return fail('Webhook não autorizado.', 401);
  }
  let payload;
  try {
    if ((Number(request.headers.get('content-length')) || 0) > 50000) return fail('Payload excessivo.', 413);
    const text = await request.text();
    if (text.length > 50000) return fail('Payload excessivo.', 413);
    payload = JSON.parse(text);
  } catch { return fail('JSON inválido.', 400); }
  if (!payload?.id || typeof payload.id !== 'string' || payload.id.length > 200) return fail('Evento inválido.', 400);
  const event = payload.event, checkout = payload.checkout;
  if (!CHECKOUT_EVENTS.has(event)) {
    if (event === 'PAYMENT_REFUNDED' && payload.payment?.id) {
      await env.DB.prepare(`UPDATE orders SET refund_status='REFUNDED', updated_at=CURRENT_TIMESTAMP
        WHERE payment_id=? AND asaas_environment=? AND refund_status IN ('REQUESTED','PROCESSING','REVIEW')`)
        .bind(payload.payment.id, mode).run();
    }
    return reply({ received: true });
  }
  if (!checkout?.id || typeof checkout.id !== 'string') return fail('Checkout inválido.', 400);
  const row = await env.DB.prepare(`SELECT id, checkout_id, payment_status, fulfillment_status, scheduled_for
    FROM orders WHERE asaas_environment = ? AND (checkout_id = ? OR id = ?)`)
    .bind(mode, checkout.id, checkout.externalReference || '').first();
  if (!row) return fail('Pedido ainda não sincronizado.', 503);
  if (row.checkout_id && row.checkout_id !== checkout.id) return fail('Checkout divergente.', 409);
  if (checkout.externalReference && checkout.externalReference !== row.id) return fail('Referência divergente.', 409);
  // Store event ID for observability; state updates below remain idempotent.
  // A retry must still apply the state change if a prior attempt failed after this INSERT.
  await env.DB.prepare(`INSERT OR IGNORE INTO webhook_events(id,checkout_id,event) VALUES (?,?,?)`)
    .bind(payload.id, checkout.id, event).run();
  if (event === 'CHECKOUT_PAID') {
    const paidAt = new Date().toISOString();
    const deadline = acceptanceDeadline(paidAt, row.scheduled_for);
    const late = deadline <= paidAt;
    const status = late ? 'AUTO_REJECTED' : row.scheduled_for ? 'SCHEDULED' : 'AWAITING_ACCEPTANCE';
    const result = await env.DB.prepare(`UPDATE orders SET checkout_id=?, payment_status='PAID',
      fulfillment_status=?, paid_at=?, acceptance_deadline=?,
      refund_status=CASE WHEN ? THEN 'PENDING' ELSE refund_status END,
      closed_reason=CASE WHEN ? THEN 'Pagamento após horário agendado' ELSE closed_reason END,
      updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND payment_status IN ('CREATING','PENDING','REVIEW','EXPIRED','CANCELED')
        AND fulfillment_status='AWAITING_PAYMENT'`)
      .bind(checkout.id, status, paidAt, deadline, late ? 1 : 0, late ? 1 : 0, row.id).run();
    if (late && result.meta.changes) ctx.waitUntil(refundOrder(env, row.id));
    if (!late && result.meta.changes && mode === 'production' && env.META_CAPI_ACCESS_TOKEN) {
      const paidOrder = await env.DB.prepare('SELECT phone,total_cents FROM orders WHERE id=?')
        .bind(row.id).first();
      if (paidOrder) ctx.waitUntil(sendMetaOrderEvent(env, {
        name: 'Purchase', orderId: row.id, amountCents: paidOrder.total_cents,
        phone: paidOrder.phone, paymentMode: mode,
      }).catch(error => console.warn('Meta CAPI purchase:', error.message)));
    }
  } else if (event === 'CHECKOUT_CANCELED' || event === 'CHECKOUT_EXPIRED') {
    const state = event === 'CHECKOUT_CANCELED' ? 'CANCELED' : 'EXPIRED';
    await env.DB.prepare(`UPDATE orders SET payment_status=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND payment_status IN ('CREATING','PENDING','REVIEW') AND fulfillment_status='AWAITING_PAYMENT'`)
      .bind(state, row.id).run();
  }
  return reply({ received: true });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url), origin = request.headers.get('Origin') || '';
    const pathname = url.pathname;
    if (env.LOCAL_DEVELOPMENT === 'true' && origin === 'http://127.0.0.1:8080') {
      ALLOWED_ORIGINS.add(origin);
    }
    if (pathname === '/health' && request.method === 'GET') return reply({ ok: true });
    if (origin && !ALLOWED_ORIGINS.has(origin) && !origin.startsWith('http://127.0.0.1:')) {
      return fail('Origem não permitida.', 403);
    }
    if (request.method === 'OPTIONS') {
      if (!ALLOWED_ORIGINS.has(origin)) return fail('Origem não permitida.', 403);
      return reply(null, 204, origin);
    }
    try {
      const webhookMode = /^\/api\/webhook\/asaas\/(sandbox|production)$/.exec(pathname)?.[1];
      if (webhookMode && request.method === 'POST') return webhook(request, env, ctx, webhookMode);
      if (pathname === '/api/webhook/uber-direct' && request.method === 'POST') {
        const result = await uberWebhook(request, env);
        return reply(result.data, result.status);
      }
      if (pathname === '/api/delivery/quote' && request.method === 'POST') {
        if (!ALLOWED_ORIGINS.has(origin)) return fail('Origem não autorizada.', 403, origin);
        return createDeliveryQuote(request, env, origin);
      }
      if (pathname === '/api/config' && request.method === 'GET') return reply(await clientConfig(env), 200, origin);
      if (pathname === '/api/appearance' && request.method === 'GET') return reply(await getAppearance(env), 200, origin);
      if (pathname === '/api/catalog' && request.method === 'GET') {
        return reply(await getCatalog(env), 200, origin);
      }
      if (pathname.startsWith('/api/admin/') || pathname.startsWith('/api/auth/')) {
        if (!ALLOWED_ORIGINS.has(origin)) return fail('Origem administrativa não autorizada.', 403, origin);
        return await handleAdmin(request, env, origin, url);
      }
      if (pathname === '/api/orders' && request.method === 'POST') {
        if (!ALLOWED_ORIGINS.has(origin)) return fail('Origem não autorizada.', 403, origin);
        return createOrder(request, env, origin, ctx);
      }
      const match = /^\/api\/orders\/([0-9a-f-]{36})$/i.exec(pathname);
      if (match && request.method === 'GET') return readOrder(request, env, origin, match[1]);
      return fail('Rota não encontrada.', 404, origin);
    } catch (error) {
      console.error('Kipeixe Worker', error.message);
      return fail('Falha temporária no serviço.', 500, origin);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(Promise.all([
      sweepExpired(env), dispatchScheduledReady(env),
      dispatchScheduledIFood(env).catch(error => console.warn('iFood dispatch:', error.message)),
      syncIFoodEvents(env).catch(error => console.warn('iFood events:', error.message)),
    ]));
  },
};
