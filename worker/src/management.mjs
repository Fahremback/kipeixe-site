import { DEFAULT_HOURS, localSlot, openAt, validateHours, nextStatus, PENDING_DECISION } from './domain.mjs';
import { pbkdf2Sync } from 'node:crypto';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { paymentConfig, paymentConfigured, paymentReady, PAYMENT_MODES } from './asaas-environments.mjs';
import { uberConfigured, uberReady, dispatchDelivery } from './uber-direct.mjs';
import { ifoodConfigured, ifoodReady, dispatchIFood } from './ifood-shipping.mjs';

export const ALLOWED_ORIGINS = new Set([
  'https://restaurantekipeixe.com.br', 'https://www.restaurantekipeixe.com.br',
]);
const encoder = new TextEncoder();
const json = (value) => JSON.stringify(value);
export const isPaymentsReady = paymentReady;

export function reply(data, status = 200, origin = '', extra = {}) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...extra,
  });
  if (ALLOWED_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    headers.set('Vary', 'Origin');
  }
  return new Response(status === 204 ? null : json(data), { status, headers });
}
export const fail = (message, status = 400, origin = '') => reply({ error: message }, status, origin);

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = encoder.encode(a), bb = encoder.encode(b);
  let difference = aa.length ^ bb.length;
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) difference |= (aa[i] || 0) ^ (bb[i] || 0);
  return difference === 0;
}

export async function hash(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
const cookieValue = request => (request.headers.get('Cookie') || '').split(';')
  .map(x => x.trim()).find(x => x.startsWith('kipeixe_session='))?.slice('kipeixe_session='.length) || '';
const adminCookie = (token, maxAge) => `kipeixe_session=${token}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
const limitedJson = async (request, limit = 20000) => {
  if ((Number(request.headers.get('content-length')) || 0) > limit) throw new Error('Requisição muito grande.');
  const text = await request.text();
  if (text.length > limit) throw new Error('Requisição muito grande.');
  return JSON.parse(text);
};
const normalize = text => String(text ?? '').trim();
const cents = value => value === null ? null : Number(value);
const canPrice = value => value === null || (Number.isInteger(value) && value >= 100 && value <= 500000);

export async function storeSettings(env) {
  if (!env.DB) return { ordersEnabled: false, paymentsEnabled: false, paymentMode: 'sandbox',
    deliveryEnabled: false, deliveryFeeCents: 0, uberEnabled: false,
    ifoodEnabled: false, deliveryProvider: 'uber', hours: DEFAULT_HOURS };
  const rows = (await env.DB.prepare('SELECT key, value FROM store_settings').all()).results;
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
  let hours = DEFAULT_HOURS;
  try { hours = validateHours(JSON.parse(values.opening_hours)); } catch {}
  return {
    ordersEnabled: values.orders_enabled === 'true',
    paymentsEnabled: values.payments_enabled === 'true',
    paymentMode: PAYMENT_MODES.has(values.payment_mode) ? values.payment_mode : 'sandbox',
    deliveryEnabled: values.delivery_enabled === 'true',
    deliveryFeeCents: Number(values.delivery_fee_cents) || 0,
    uberEnabled: values.uber_enabled === 'true',
    ifoodEnabled: values.ifood_enabled === 'true',
    deliveryProvider: values.delivery_provider === 'ifood' ? 'ifood' : 'uber',
    hours,
  };
}

export async function clientConfig(env) {
  const settings = await storeSettings(env);
  const now = new Date();
  return {
    onlinePaymentEnabled: isPaymentsReady(env, settings.paymentMode) &&
      settings.paymentsEnabled && settings.ordersEnabled,
    paymentsConfigured: paymentConfigured(env, settings.paymentMode),
    paymentMode: settings.paymentMode,
    deliveryEnabled: settings.deliveryProvider === 'ifood'
      ? ifoodReady(env, settings) : uberReady(env, settings),
    deliveryProvider: settings.deliveryProvider,
    uberDirectReady: uberReady(env, settings),
    ifoodShippingReady: ifoodReady(env, settings),
    deliveryFeeCents: settings.deliveryFeeCents,
    openingHours: settings.hours,
    openNow: openAt(now, settings.hours),
    localNow: localSlot(now),
    sandbox: settings.paymentMode === 'sandbox',
    acceptsOrders: settings.ordersEnabled,
  };
}

export async function getCatalog(env, all = false) {
  if (!env.DB) throw new Error('Banco de dados indisponível.');
  const [cats, products] = await Promise.all([
    env.DB.prepare(`SELECT * FROM categories ${all ? '' : 'WHERE active = 1'} ORDER BY sort_order, title`).all(),
    env.DB.prepare(`SELECT * FROM products ${all ? '' : 'WHERE active = 1 AND archived = 0'} ORDER BY sort_order, name`).all(),
  ]);
  if (all) return { categories: cats.results, products: products.results.map(p => ({
    ...p, variants: JSON.parse(p.variants_json), variants_json: undefined,
  })) };
  return { categories: cats.results.map(cat => ({
    id: cat.id, title: cat.title, eyebrow: cat.eyebrow,
    items: products.results.filter(p => p.category_id === cat.id).map(p => ({
      id: p.id, name: p.name, description: p.description,
      price: p.price_cents === null ? null : p.price_cents / 100,
      variants: JSON.parse(p.variants_json).map(v => ({ label: v.label, price: v.priceCents / 100 })),
    })),
  })).filter(cat => cat.items.length > 0) };
}

export async function priceCart(env, raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 30) throw new Error('Carrinho inválido.');
  const products = (await env.DB.prepare(`SELECT p.* FROM products p
    JOIN categories c ON c.id = p.category_id
    WHERE p.active = 1 AND p.archived = 0 AND c.active = 1`).all()).results;
  const byId = new Map(products.map(p => [p.id, p]));
  const byName = new Map(products.map(p => [p.name, p]));
  const merged = new Map();
  for (const input of raw) {
    if (!input || !Number.isInteger(input.qty) || input.qty < 1 || input.qty > 20) throw new Error('Quantidade inválida.');
    const product = byId.get(input.productId) || byName.get(input.name);
    if (!product) throw new Error('Produto indisponível.');
    const variant = normalize(input.variant);
    const variants = JSON.parse(product.variants_json);
    const found = variants.find(v => v.label === variant);
    const price = variants.length ? found?.priceCents : variant === '' ? product.price_cents : null;
    if (!Number.isInteger(price) || price <= 0) throw new Error('Preço do produto indisponível.');
    const key = `${product.id}::${variant}`;
    const quantity = (merged.get(key)?.qty || 0) + input.qty;
    if (quantity > 20) throw new Error('Quantidade máxima excedida.');
    merged.set(key, { productId: product.id, name: product.name, variant, qty: quantity, unitCents: price });
  }
  const items = [...merged.values()];
  if (items.reduce((sum, item) => sum + item.qty, 0) > 50) throw new Error('Máximo de 50 unidades por pedido.');
  const subtotalCents = items.reduce((sum, item) => sum + item.qty * item.unitCents, 0);
  if (subtotalCents > 500000) throw new Error('Valor máximo excedido.');
  return { items, subtotalCents };
}

async function verifyPassword(password, salt, expected) {
  if (!password || !salt || !expected) return false;
  if (typeof expected !== 'string' || !/^[0-9a-f]{64}$/i.test(expected) || salt.length > 256) return false;
  // New administrative credentials use 100k PBKDF2 rounds. Earlier installations
  // used 210k rounds, above the Worker native PBKDF2 hard limit of 100k.
  // Fall back to a portable implementation only for legacy password hashes.
  const current = pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  if (safeEqual(current, expected)) return true;
  const legacy = [...pbkdf2(sha256, password, salt, { c: 210000, dkLen: 32 })]
    .map(b => b.toString(16).padStart(2, '0')).join('');
  return safeEqual(legacy, expected);
}

const validUsername = value => /^[a-z0-9][a-z0-9._-]{2,39}$/.test(value);
const validNewPassword = value => typeof value === 'string' && value.length >= 12 && value.length <= 128;

async function ensureInitialOwner(env) {
  const owner = await env.DB.prepare("SELECT username FROM admin_users WHERE role='owner' LIMIT 1").first();
  if (owner || !env.ADMIN_USERNAME || !env.ADMIN_PASSWORD_HASH || !env.ADMIN_PASSWORD_SALT) return;
  // Idempotent bootstrap: the original Cloudflare credential remains usable
  // until the owner changes their login, but can never recreate an old account.
  await env.DB.prepare(`INSERT INTO admin_users (username,password_hash,password_salt,role)
    SELECT ?,?,?,'owner' WHERE NOT EXISTS (SELECT 1 FROM admin_users WHERE role='owner')`)
    .bind(env.ADMIN_USERNAME, env.ADMIN_PASSWORD_HASH, env.ADMIN_PASSWORD_SALT).run();
}

async function currentAdmin(request, env) {
  const token = cookieValue(request);
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  await ensureInitialOwner(env);
  const session = await env.DB.prepare(`SELECT u.username,u.role FROM admin_sessions s
    JOIN admin_users u ON u.username=s.username AND u.active=1
    WHERE s.token_hash=? AND s.expires_at>?`)
    .bind(await hash(token), Date.now()).first();
  return session || null;
}

async function login(request, env, origin) {
  if (!env.DB) {
    return fail('Painel administrativo não configurado.', 503, origin);
  }
  let data;
  try { data = await limitedJson(request, 3000); } catch { return fail('Dados inválidos.', 400, origin); }
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const windowStart = Math.floor(Date.now() / (15 * 60_000));
  await env.DB.prepare(`INSERT INTO login_limits (ip, window_start, hits) VALUES (?, ?, 1)
    ON CONFLICT(ip, window_start) DO UPDATE SET hits = hits + 1`).bind(ip, windowStart).run();
  const limit = await env.DB.prepare('SELECT hits FROM login_limits WHERE ip = ? AND window_start = ?')
    .bind(ip, windowStart).first();
  if (limit.hits > 8) return fail('Muitas tentativas. Aguarde 15 minutos.', 429, origin);
  await ensureInitialOwner(env);
  const username = normalize(data.username).toLowerCase();
  const password = String(data.password || '');
  const user = await env.DB.prepare('SELECT username,password_hash,password_salt,role,active FROM admin_users WHERE username=?')
    .bind(username).first();
  const passwordValid = user?.active === 1 && password.length <= 128 &&
    await verifyPassword(password, user.password_salt, user.password_hash);
  if (!passwordValid) {
    return fail('Credenciais inválidas.', 401, origin);
  }
  const token = randomToken();
  const expires = Date.now() + 8 * 60 * 60_000;
  await env.DB.prepare('INSERT INTO admin_sessions (token_hash, username, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(await hash(token), user.username, expires, Date.now()).run();
  return reply({ ok: true, username: user.username, role: user.role }, 200, origin,
    { 'Set-Cookie': adminCookie(token, 8 * 3600) });
}

async function adminUsersRoute(request, env, origin, url, actor) {
  const path = url.pathname;
  const match = /^\/api\/admin\/users(?:\/([a-z0-9._-]{3,40}))?$/.exec(path);
  if (!match) return null;
  if (actor.role !== 'owner') return fail('Somente o proprietário pode gerenciar usuários.', 403, origin);
  const target = match[1] || '';
  if (request.method === 'GET' && !target) {
    const users = (await env.DB.prepare(`SELECT username,role,active,created_at,updated_at
      FROM admin_users ORDER BY role='owner' DESC, username`).all()).results;
    return reply({ users }, 200, origin);
  }
  if (!['POST', 'PUT'].includes(request.method) || (request.method === 'POST' && target) ||
      (request.method === 'PUT' && !target)) return fail('Método não permitido.', 405, origin);
  let data;
  try { data = await limitedJson(request, 3000); } catch { return fail('Dados inválidos.', 400, origin); }
  const username = normalize(data.username).toLowerCase();
  if (!validUsername(username)) return fail('Usuário deve ter 3 a 40 caracteres: letras, números, ponto, hífen ou sublinhado.', 422, origin);
  if (request.method === 'POST') {
    if (!validNewPassword(data.password)) return fail('A senha deve ter de 12 a 128 caracteres.', 422, origin);
    const salt = [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('');
    const digest = pbkdf2Sync(data.password, salt, 100000, 32, 'sha256').toString('hex');
    try {
      await env.DB.prepare(`INSERT INTO admin_users(username,password_hash,password_salt,role)
        VALUES(?,?,?,'staff')`).bind(username, digest, salt).run();
    } catch { return fail('Esse nome de usuário já está em uso.', 409, origin); }
    await audit(env, actor.username, 'USER_CREATED', username);
    return reply({ ok: true, username }, 201, origin);
  }
  const old = await env.DB.prepare('SELECT username,password_hash,password_salt,role,active FROM admin_users WHERE username=?')
    .bind(target).first();
  if (!old) return fail('Usuário não encontrado.', 404, origin);
  if (old.role === 'owner') {
    if (old.username !== actor.username) return fail('Conta de proprietário protegida.', 403, origin);
    if (typeof data.currentPassword !== 'string' || !data.currentPassword)
      return fail('Informe sua senha atual.', 422, origin);
    if (!await verifyPassword(data.currentPassword, old.password_salt, old.password_hash))
      return fail('Senha atual incorreta.', 403, origin);
  }
  const changingPassword = data.password !== undefined && data.password !== '';
  if (changingPassword && !validNewPassword(data.password))
    return fail('A nova senha deve ter de 12 a 128 caracteres.', 422, origin);
  const active = old.role === 'owner' ? 1 : data.active === false ? 0 : 1;
  const salt = changingPassword
    ? [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('')
    : old.password_salt;
  const digest = changingPassword ? pbkdf2Sync(data.password, salt, 100000, 32, 'sha256').toString('hex') : old.password_hash;
  try {
    await env.DB.prepare(`UPDATE admin_users SET username=?,password_hash=?,password_salt=?,
      active=?,updated_at=CURRENT_TIMESTAMP WHERE username=?`)
      .bind(username, digest, salt, active, old.username).run();
  } catch { return fail('Esse nome de usuário já está em uso.', 409, origin); }
  const tokenHash = await hash(cookieValue(request));
  if (old.username === actor.username) {
    await env.DB.prepare('DELETE FROM admin_sessions WHERE username=? AND token_hash<>?')
      .bind(old.username, tokenHash).run();
    await env.DB.prepare('UPDATE admin_sessions SET username=? WHERE token_hash=?')
      .bind(username, tokenHash).run();
  } else {
    await env.DB.prepare('DELETE FROM admin_sessions WHERE username=?').bind(old.username).run();
  }
  await audit(env, actor.username, 'USER_UPDATED', username, `previous:${old.username} active:${active}`);
  return reply({ ok: true, username, active: Boolean(active) }, 200, origin);
}

async function audit(env, actor, action, subject, details = '') {
  await env.DB.prepare('INSERT INTO audit_log (actor, action, subject, details) VALUES (?, ?, ?, ?)')
    .bind(actor, action, subject, details).run();
}

async function asaas(env, mode, path, method = 'GET') {
  const account = paymentConfig(env, mode);
  if (!account.key) throw new Error('Credencial Asaas não configurada.');
  const response = await fetch(account.url + path, {
    method, signal: AbortSignal.timeout(15000),
    headers: { 'access_token': account.key, 'Accept': 'application/json',
      'Content-Type': 'application/json', 'User-Agent': 'Kipeixe-Orders/2.0' },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Asaas HTTP ${response.status}`);
  return body;
}

export async function refundOrder(env, id) {
  const order = await env.DB.prepare('SELECT id, checkout_id, refund_status, asaas_environment FROM orders WHERE id = ?').bind(id).first();
  if (!order || !order.checkout_id || !['PENDING', 'REVIEW'].includes(order.refund_status)) return false;
  const claim = await env.DB.prepare(`UPDATE orders SET refund_status = 'PROCESSING', updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND refund_status IN ('PENDING', 'REVIEW')`).bind(id).run();
  if (!claim.meta.changes) return false;
  try {
    const listing = await asaas(env, order.asaas_environment, `/payments?checkoutSession=${encodeURIComponent(order.checkout_id)}&limit=20`);
    const eligible = (listing.data || []).filter(p => ['RECEIVED', 'CONFIRMED'].includes(p.status));
    if (eligible.length !== 1) throw new Error('Cobrança paga não identificada univocamente.');
    await env.DB.prepare('UPDATE orders SET payment_id = ? WHERE id = ?').bind(eligible[0].id, id).run();
    await asaas(env, order.asaas_environment, `/payments/${encodeURIComponent(eligible[0].id)}/refund`, 'POST');
    await env.DB.prepare(`UPDATE orders SET refund_status = 'REQUESTED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(id).run();
    await audit(env, 'system', 'REFUND_REQUESTED', id, eligible[0].id);
    return true;
  } catch {
    await env.DB.prepare(`UPDATE orders SET refund_status = 'REVIEW', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(id).run();
    return false;
  }
}

export async function sweepExpired(env, now = new Date()) {
  if (!env.DB) return 0;
  const deadline = now.toISOString();
  // Asaas checkouts are valid for 60 minutes. Keep the local queue in sync
  // even if CHECKOUT_EXPIRED was not delivered by the payment webhook.
  // REVIEW is intentionally excluded: its charge outcome is uncertain.
  await env.DB.prepare(`UPDATE orders SET payment_status='EXPIRED', updated_at=CURRENT_TIMESTAMP
    WHERE payment_status='PENDING' AND datetime(created_at, '+60 minutes') <= datetime(?)`)
    .bind(deadline).run();
  const rows = (await env.DB.prepare(`SELECT id, checkout_id FROM orders
    WHERE payment_status = 'PAID' AND fulfillment_status IN ('AWAITING_ACCEPTANCE','SCHEDULED')
    AND acceptance_deadline IS NOT NULL AND acceptance_deadline <= ? LIMIT 100`)
    .bind(deadline).all()).results;
  let closed = 0;
  for (const row of rows) {
    const result = await env.DB.prepare(`UPDATE orders SET fulfillment_status = 'AUTO_REJECTED',
      refund_status = CASE WHEN checkout_id IS NULL THEN 'NOT_REQUIRED' ELSE 'PENDING' END,
      closed_reason = 'Prazo de aceitação esgotado', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND payment_status = 'PAID'
      AND fulfillment_status IN ('AWAITING_ACCEPTANCE','SCHEDULED') AND acceptance_deadline <= ?`)
      .bind(row.id, deadline).run();
    if (result.meta.changes) {
      closed++;
      await audit(env, 'system', 'AUTO_REJECTED', row.id);
      if (row.checkout_id) await refundOrder(env, row.id);
    }
  }
  await env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').bind(Date.now()).run();
  await env.DB.prepare('DELETE FROM login_limits WHERE window_start < ?')
    .bind(Math.floor(Date.now() / 900000) - 2).run();
  await env.DB.prepare('DELETE FROM uber_quote_limits WHERE window_start < ?')
    .bind(Math.floor(Date.now() / 900000) - 2).run();
  await env.DB.prepare('DELETE FROM uber_quotes WHERE expires_at < ? AND order_id IS NULL')
    .bind(new Date(Date.now() - 24 * 3600000).toISOString()).run();
  return closed;
}

function validateProduct(data) {
  const name = normalize(data.name), description = normalize(data.description);
  const categoryId = normalize(data.categoryId);
  const priceCents = cents(data.priceCents);
  const variants = Array.isArray(data.variants) ? data.variants : [];
  if (name.length < 2 || name.length > 120 || description.length > 1000 ||
      !/^[\w-]{2,90}$/.test(categoryId) || !canPrice(priceCents) || variants.length > 12) {
    throw new Error('Dados do produto inválidos.');
  }
  const seen = new Set();
  const validVariants = variants.map(v => {
    const label = normalize(v.label);
    if (!label || label.length > 70 || seen.has(label) || !canPrice(v.priceCents) || v.priceCents === null) {
      throw new Error('Variação inválida.');
    }
    seen.add(label);
    return { label, priceCents: v.priceCents };
  });
  if (!validVariants.length && priceCents === null) {
    // Price on request is allowed, but cannot be ordered through checkout.
  }
  return { name, description, categoryId, priceCents, variants: validVariants,
    active: data.active === false ? 0 : 1, sortOrder: Number.isInteger(data.sortOrder) ? data.sortOrder : 0 };
}

async function productRoute(request, env, origin, url, actor) {
  const match = /^\/api\/admin\/products(?:\/([\w-]+))?$/.exec(url.pathname);
  if (!match) return null;
  if (request.method === 'DELETE' && match[1]) {
    await env.DB.prepare('UPDATE products SET archived = 1, active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(match[1]).run();
    await audit(env, actor, 'PRODUCT_ARCHIVED', match[1]);
    return reply({ ok: true }, 200, origin);
  }
  if (!['POST', 'PUT'].includes(request.method)) return fail('Método não permitido.', 405, origin);
  if (request.method === 'POST' && match[1] || request.method === 'PUT' && !match[1]) return fail('Rota inválida.', 404, origin);
  let product;
  try { product = validateProduct(await limitedJson(request)); } catch (e) { return fail(e.message, 422, origin); }
  const category = await env.DB.prepare('SELECT id FROM categories WHERE id = ?').bind(product.categoryId).first();
  if (!category) return fail('Categoria não encontrada.', 422, origin);
  const id = match[1] || `manual-${crypto.randomUUID()}`;
  const duplicate = await env.DB.prepare('SELECT id FROM products WHERE lower(name) = lower(?) AND id != ? AND archived = 0 LIMIT 1')
    .bind(product.name, id).first();
  if (duplicate) return fail('Já existe outro produto com este nome.', 409, origin);
  if (request.method === 'PUT') {
    const result = await env.DB.prepare(`UPDATE products SET name = ?, description = ?, category_id = ?,
      price_cents = ?, variants_json = ?, active = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(product.name, product.description, product.categoryId, product.priceCents,
        json(product.variants), product.active, product.sortOrder, id).run();
    if (!result.meta.changes) return fail('Produto não encontrado.', 404, origin);
  } else {
    await env.DB.prepare(`INSERT INTO products
      (id, category_id, name, description, price_cents, variants_json, active, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, product.categoryId, product.name, product.description, product.priceCents,
        json(product.variants), product.active, product.sortOrder).run();
  }
  await audit(env, actor, request.method === 'POST' ? 'PRODUCT_CREATED' : 'PRODUCT_EDITED', id);
  return reply({ ok: true, id }, 200, origin);
}

async function categoryRoute(request, env, origin, url, actor) {
  const match = /^\/api\/admin\/categories(?:\/([\w-]+))?$/.exec(url.pathname);
  if (!match) return null;
  let data;
  try { data = await limitedJson(request); } catch { return fail('JSON inválido.', 400, origin); }
  const id = match[1] || `categoria-${crypto.randomUUID().slice(0, 8)}`;
  const title = normalize(data.title), eyebrow = normalize(data.eyebrow);
  const active = data.active === false ? 0 : 1;
  const sortOrder = Number.isInteger(data.sortOrder) ? data.sortOrder : 0;
  if (!title || title.length > 80 || eyebrow.length > 120) return fail('Categoria inválida.', 422, origin);
  if (request.method === 'POST' && !match[1]) {
    await env.DB.prepare('INSERT INTO categories(id,title,eyebrow,sort_order,active) VALUES (?,?,?,?,?)')
      .bind(id, title, eyebrow, sortOrder, active).run();
  } else if (request.method === 'PUT' && match[1]) {
    await env.DB.prepare('UPDATE categories SET title=?, eyebrow=?, sort_order=?, active=? WHERE id=?')
      .bind(title, eyebrow, sortOrder, active, id).run();
  } else return fail('Método não permitido.', 405, origin);
  await audit(env, actor, 'CATEGORY_SAVED', id);
  return reply({ ok: true, id }, 200, origin);
}

export async function handleAdmin(request, env, origin, url) {
  if (!env.DB) return fail('Banco de dados indisponível.', 503, origin);
  if (url.pathname === '/api/auth/login' && request.method === 'POST') return login(request, env, origin);
  if (url.pathname === '/api/auth/session' && request.method === 'GET') {
    const actor = await currentAdmin(request, env);
    return reply({ authenticated: Boolean(actor), username: actor?.username || null,
      role: actor?.role || null }, 200, origin);
  }
  const identity = await currentAdmin(request, env);
  if (!identity) return fail('Sessão inválida. Entre novamente.', 401, origin);
  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(await hash(cookieValue(request))).run();
    return reply({ ok: true }, 200, origin, { 'Set-Cookie': adminCookie('', 0) });
  }
  const userResult = await adminUsersRoute(request, env, origin, url, identity);
  if (userResult) return userResult;
  const actor = identity.username;
  if (url.pathname === '/api/admin/settings' && identity.role !== 'owner')
    return fail('Somente o proprietário pode alterar as configurações do restaurante.', 403, origin);
  if (url.pathname === '/api/admin/catalog' && request.method === 'GET') {
    return reply(await getCatalog(env, true), 200, origin);
  }
  if (url.pathname === '/api/admin/settings') {
    if (request.method === 'GET') return reply({
      ...(await storeSettings(env)),
      asaasEnvironments: {
        sandbox: { configured: paymentConfigured(env, 'sandbox') },
        production: { configured: paymentConfigured(env, 'production') },
      },
      paymentSystemAvailable: env.PAYMENTS_ENABLED === 'true',
      uberDirectConfigured: uberConfigured(env),
      uberDirectSystemAvailable: env.UBER_DIRECT_ENABLED === 'true',
      ifoodShippingConfigured: ifoodConfigured(env),
      ifoodShippingSystemAvailable: env.IFOOD_SHIPPING_ENABLED === 'true',
    }, 200, origin);
    if (request.method !== 'PUT') return fail('Método não permitido.', 405, origin);
    let data, hours;
    try {
      data = await limitedJson(request);
      hours = validateHours(data.hours);
      if (!Number.isInteger(data.deliveryFeeCents) || data.deliveryFeeCents < 0 || data.deliveryFeeCents > 30000) throw Error('Taxa de entrega inválida.');
      if (typeof data.ordersEnabled !== 'boolean' || typeof data.deliveryEnabled !== 'boolean') throw Error('Disponibilidade inválida.');
      if (typeof data.uberEnabled !== 'boolean') throw Error('Configuração Uber Direct inválida.');
      if (typeof data.ifoodEnabled !== 'boolean' ||
          !['uber', 'ifood'].includes(data.deliveryProvider))
        throw Error('Configuração do serviço de entrega inválida.');
      if (data.uberEnabled && (!uberConfigured(env) || env.UBER_DIRECT_ENABLED !== 'true'))
        throw Error('Uber Direct exige aprovação da conta e credenciais válidas no servidor.');
      if (data.ifoodEnabled && (!ifoodConfigured(env) || env.IFOOD_SHIPPING_ENABLED !== 'true'))
        throw Error('iFood Shipping exige credenciais autorizadas e habilitação no servidor.');
      if (data.deliveryEnabled && !(data.deliveryProvider === 'ifood' ? data.ifoodEnabled : data.uberEnabled))
        throw Error('Ative o serviço de entrega selecionado antes de oferecer entregas.');
      if (!PAYMENT_MODES.has(data.paymentMode) || typeof data.paymentsEnabled !== 'boolean') throw Error('Ambiente Asaas inválido.');
      if (data.paymentsEnabled && !isPaymentsReady(env, data.paymentMode)) {
        throw Error('Asaas não configurado neste ambiente. Configure a chave e o webhook antes de ativar pagamentos.');
      }
    } catch (e) { return fail(e.message, 422, origin); }
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO store_settings(key,value) VALUES ('orders_enabled',?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(String(data.ordersEnabled)),
      env.DB.prepare(`INSERT INTO store_settings(key,value) VALUES ('delivery_enabled',?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(String(data.deliveryEnabled)),
      env.DB.prepare(`INSERT INTO store_settings(key,value) VALUES ('delivery_fee_cents',?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(String(data.deliveryFeeCents)),
      env.DB.prepare(`INSERT INTO store_settings(key,value) VALUES ('opening_hours',?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(json(hours)),
      env.DB.prepare(`INSERT INTO store_settings(key,value) VALUES ('payment_mode',?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(data.paymentMode),
      env.DB.prepare(`INSERT INTO store_settings(key,value) VALUES ('uber_enabled',?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(String(data.uberEnabled)),
      env.DB.prepare(`INSERT INTO store_settings(key,value) VALUES ('ifood_enabled',?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(String(data.ifoodEnabled)),
      env.DB.prepare(`INSERT INTO store_settings(key,value) VALUES ('delivery_provider',?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(data.deliveryProvider),
      env.DB.prepare(`INSERT INTO store_settings(key,value) VALUES ('payments_enabled',?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(String(data.paymentsEnabled)),
    ]);
    await audit(env, actor, 'SETTINGS_CHANGED', 'store', `asaas:${data.paymentMode} payments:${data.paymentsEnabled}`);
    return reply({ ok: true }, 200, origin);
  }
  if (url.pathname === '/api/admin/orders' && request.method === 'GET') {
    await sweepExpired(env);
    const rows = (await env.DB.prepare(`SELECT id, name, phone, order_type, address, notes, items_json,
      subtotal_cents, delivery_cents, total_cents, payment_status, fulfillment_status, created_at,
      paid_at, scheduled_for, acceptance_deadline, closed_reason, refund_status, checkout_id, asaas_environment,
      uber_status,uber_delivery_id,uber_tracking_url,uber_quote_fee_cents,uber_dispatch_error
      ,delivery_provider,ifood_status,ifood_order_id,ifood_tracking_url,ifood_dispatch_error
      FROM orders ORDER BY created_at DESC LIMIT 250`).all()).results;
    return reply({ orders: rows.map(r => ({ ...r, items: JSON.parse(r.items_json), items_json: undefined })) }, 200, origin);
  }
  const action = /^\/api\/admin\/orders\/([0-9a-f-]{36})\/action$/i.exec(url.pathname);
  if (action && request.method === 'POST') {
    let data;
    try { data = await limitedJson(request); } catch { return fail('JSON inválido.', 400, origin); }
    const row = await env.DB.prepare('SELECT fulfillment_status, payment_status, acceptance_deadline, order_type, checkout_id, delivery_provider, uber_delivery_id, uber_status, ifood_order_id, ifood_status FROM orders WHERE id = ?')
      .bind(action[1]).first();
    if (!row || row.payment_status !== 'PAID') return fail('Pedido não pago ou inexistente.', 409, origin);
    if (data.action === 'COMPLETE' && row.order_type === 'Entrega')
      return fail('Entrega só é concluída após confirmação do parceiro logístico.', 409, origin);
    if (data.action === 'CANCEL_DELIVERY') {
      if (row.order_type !== 'Entrega' || row.fulfillment_status !== 'READY' ||
          row.uber_delivery_id || row.ifood_order_id ||
          ['REQUESTING', 'REVIEW'].includes(row.uber_status) ||
          ['REQUESTING', 'REVIEW'].includes(row.ifood_status))
        return fail('Despacho pendente ou já realizado. Verifique antes de estornar.', 409, origin);
      const changed = await env.DB.prepare("UPDATE orders SET fulfillment_status='REJECTED',refund_status='PENDING'," +
        "closed_reason='Entrega indisponível',updated_at=CURRENT_TIMESTAMP WHERE id=? AND " +
        "fulfillment_status='READY' AND uber_delivery_id IS NULL AND ifood_order_id IS NULL " +
        "AND (uber_status IS NULL OR uber_status NOT IN ('REQUESTING','REVIEW')) " +
        "AND (ifood_status IS NULL OR ifood_status NOT IN ('REQUESTING','REVIEW'))")
        .bind(action[1]).run();
      if (!changed.meta.changes) return fail('Pedido alterado por outro operador.', 409, origin);
      await audit(env, actor, 'CANCEL_DELIVERY', action[1]);
      await refundOrder(env, action[1]);
      return reply({ ok: true, status: 'REJECTED' }, 200, origin);
    }
    let target;
    try { target = nextStatus(row.fulfillment_status, data.action); } catch (e) { return fail(e.message, 409, origin); }
    if (PENDING_DECISION.has(row.fulfillment_status) && row.acceptance_deadline <= new Date().toISOString()) {
      await sweepExpired(env);
      return fail('Prazo encerrado.', 409, origin);
    }
    const rejecting = target === 'REJECTED';
    const result = await env.DB.prepare(`UPDATE orders SET fulfillment_status = ?,
      refund_status = CASE WHEN ? THEN 'PENDING' ELSE refund_status END,
      closed_reason = CASE WHEN ? THEN 'Recusado pelo restaurante' ELSE closed_reason END,
      updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status = 'PAID'
      AND fulfillment_status = ?
      AND (fulfillment_status NOT IN ('AWAITING_ACCEPTANCE','SCHEDULED') OR acceptance_deadline > ?)`)
      .bind(target, rejecting && row.checkout_id ? 1 : 0, rejecting ? 1 : 0, action[1], row.fulfillment_status, new Date().toISOString()).run();
    if (!result.meta.changes) return fail('Pedido foi alterado por outro atendente.', 409, origin);
    await audit(env, actor, data.action, action[1]);
    if (rejecting && row.checkout_id) await refundOrder(env, action[1]);
    const uber = target === 'READY' && row.order_type === 'Entrega' && row.delivery_provider !== 'ifood'
      ? await dispatchDelivery(env, action[1]) : null;
    const ifood = target === 'READY' && row.order_type === 'Entrega' && row.delivery_provider === 'ifood'
      ? await dispatchIFood(env, action[1]) : null;
    return reply({ ok: true, status: target, uber, ifood }, 200, origin);
  }
  const ifoodRetry = /^\/api\/admin\/orders\/([0-9a-f-]{36})\/dispatch-ifood$/i.exec(url.pathname);
  if (ifoodRetry && request.method === 'POST') {
    const state = await dispatchIFood(env, ifoodRetry[1]);
    await audit(env, actor, 'IFOOD_DISPATCH_RETRY', ifoodRetry[1], state.status);
    return reply({ ok: state.status === 'REQUESTED', ifood: state }, 200, origin);
  }
  const dispatch = /^\/api\/admin\/orders\/([0-9a-f-]{36})\/dispatch-uber$/i.exec(url.pathname);
  if (dispatch && request.method === 'POST') {
    const state = await dispatchDelivery(env, dispatch[1]);
    await audit(env, actor, 'UBER_DISPATCH_RETRY', dispatch[1], state.status);
    return reply({ ok: ['pending', 'pickup', 'dropoff'].includes(state.status), uber: state }, 200, origin);
  }
  const retry = /^\/api\/admin\/orders\/([0-9a-f-]{36})\/retry-refund$/i.exec(url.pathname);
  if (retry && request.method === 'POST') {
    const row = await env.DB.prepare('SELECT fulfillment_status, refund_status FROM orders WHERE id = ?').bind(retry[1]).first();
    if (!row || !['AUTO_REJECTED', 'REJECTED'].includes(row.fulfillment_status) || row.refund_status !== 'REVIEW')
      return fail('Revisão de estorno indisponível.', 409, origin);
    const success = await refundOrder(env, retry[1]);
    await audit(env, actor, 'REFUND_RETRY', retry[1], String(success));
    return reply({ ok: success, needsReview: !success }, 200, origin);
  }
  const product = await productRoute(request, env, origin, url, actor);
  if (product) return product;
  const category = await categoryRoute(request, env, origin, url, actor);
  if (category) return category;
  return fail('Rota não encontrada.', 404, origin);
}
