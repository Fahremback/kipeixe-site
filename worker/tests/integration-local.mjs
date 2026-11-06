// Run with a local Wrangler dev server on 127.0.0.1:8787.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const text = readFileSync(resolve(root, '.local-admin-credentials.txt'), 'utf8');
const username = /Usuário: (.*)/.exec(text)?.[1];
const password = /Senha: (.*)/.exec(text)?.[1];
const rootUrl = 'http://127.0.0.1:8787';
const origin = 'https://restaurantekipeixe.com.br';
const request = async (path, options = {}) => fetch(rootUrl + path, {
  ...options, headers: { Origin: origin, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
});
const json = async response => response.json();

assert.equal((await request('/health')).status, 200);
const config = await json(await request('/api/config'));
assert.equal(config.onlinePaymentEnabled, false);
assert.equal(typeof config.openNow, 'boolean');
const menu = await json(await request('/api/catalog'));
assert.equal(menu.categories.length, 10);
assert.equal(menu.categories.reduce((n, c) => n + c.items.length, 0), 109);
assert.equal((await request('/api/admin/orders')).status, 401);
assert.equal((await request('/api/auth/login', {
  method: 'POST', body: JSON.stringify({ username, password: 'senha-invalida' }),
})).status, 401);
const login = await request('/api/auth/login', {
  method: 'POST', body: JSON.stringify({ username, password }),
});
assert.equal(login.status, 200, 'Login administrativo deveria funcionar');
const cookie = login.headers.get('set-cookie')?.split(';')[0];
assert.match(cookie, /^kipeixe_session=[0-9a-f]{64}$/);
const authed = async (path, options = {}) => request(path, {
  ...options, headers: { Cookie: cookie, ...options.headers },
});
const catalog = await json(await authed('/api/admin/catalog'));
assert.equal(catalog.products.length, 109);
const p = catalog.products.find(product => product.price_cents !== null);
const body = {
  name: p.name, description: p.description, categoryId: p.category_id,
  priceCents: p.price_cents, variants: p.variants, active: Boolean(p.active), sortOrder: p.sort_order,
};
const saved = await authed('/api/admin/products/' + p.id, {
  method: 'PUT', body: JSON.stringify(body),
});
assert.equal(saved.status, 200, 'Preço deveria ser editável');
const settings = await json(await authed('/api/admin/settings'));
const settingsSaved = await authed('/api/admin/settings', {
  method: 'PUT', body: JSON.stringify(settings),
});
assert.equal(settingsSaved.status, 200);
const webhook = await request('/api/webhook/asaas', { method: 'POST', body: '{}' });
assert.equal(webhook.status, 401);
const orders = await json(await authed('/api/admin/orders'));
assert.ok(Array.isArray(orders.orders));
console.log('Integração local aprovada: health, catálogo, login, sessão, produtos, configurações, pedidos, webhook.');
