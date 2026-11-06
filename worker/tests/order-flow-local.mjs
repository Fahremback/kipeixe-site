import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = 'http://127.0.0.1:8787';
const siteOrigin = 'https://restaurantekipeixe.com.br';
const credentials = readFileSync(resolve(root, '.local-admin-credentials.txt'), 'utf8');
const username = /Usuário: (.*)/.exec(credentials)[1];
const password = /Senha: (.*)/.exec(credentials)[1];
const webhookToken = /ASAAS_WEBHOOK_TOKEN="([^"]+)"/.exec(readFileSync(resolve(root, '.dev.vars'), 'utf8'))[1];

const sql = command => {
  const output = execFileSync(process.execPath, [
    resolve(root, 'node_modules/wrangler/bin/wrangler.js'),
    'd1', 'execute', 'kipeixe-orders', '--local', '--json', '--command', command,
  ], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const json = JSON.parse(output);
  assert.equal(json[0].success, true);
  return json[0].results;
};
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const jsonResponse = async response => {
  const json = await response.json();
  assert.equal(response.ok, true, JSON.stringify(json));
  return json;
};
const auth = await jsonResponse(await fetch(base + '/api/auth/login', {
  method: 'POST', headers: { Origin: siteOrigin, 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password }),
}));
assert.equal(auth.ok, true);
// The test logs in again to capture the secure cookie for local HTTP requests.
const login = await fetch(base + '/api/auth/login', {
  method: 'POST', headers: { Origin: siteOrigin, 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password }),
});
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie').split(';')[0];
const request = (path, options = {}) => fetch(base + path, {
  ...options, headers: { Origin: siteOrigin, Cookie: cookie, ...options.headers },
});
async function seed(scheduledFor = null, paid = false) {
  const id = randomUUID(), checkout = 'test-checkout-' + randomUUID();
  const fields = [
    quote(id), quote(randomUUID()), quote('hash' + randomUUID()), quote('Teste Kipeixe'),
    quote('45999999999'), quote('Retirada no Kipeixe'), quote(''), quote(''),
    quote(JSON.stringify([{ name: 'Tilápia', variant: '', qty: 1, unitCents: 5500 }])),
    5500, 0, 5500, quote(checkout),
    quote(paid ? 'PAID' : 'PENDING'),
    quote(paid ? 'AWAITING_ACCEPTANCE' : 'AWAITING_PAYMENT'),
    scheduledFor ? quote(scheduledFor) : 'NULL',
  ];
  sql(`INSERT INTO orders (id, request_id, access_hash, name, phone, order_type, address,
    notes, items_json, subtotal_cents, delivery_cents, total_cents, checkout_id, payment_status,
    fulfillment_status, scheduled_for) VALUES (${fields.join(',')})`);
  return { id, checkout };
}
async function paidWebhook(order, eventId = randomUUID()) {
  const response = await fetch(base + '/api/webhook/asaas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'asaas-access-token': webhookToken },
    body: JSON.stringify({
      id: eventId, event: 'CHECKOUT_PAID',
      checkout: { id: order.checkout, externalReference: order.id },
    }),
  });
  await jsonResponse(response);
}
async function state(id) {
  const [row] = sql(`SELECT * FROM orders WHERE id=${quote(id)}`);
  return row;
}
async function action(id, name) {
  const response = await request(`/api/admin/orders/${id}/action`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: name }),
  });
  return { status: response.status, body: await response.json() };
}

const immediate = await seed();
const duplicateEventId = randomUUID();
await paidWebhook(immediate, duplicateEventId);
let item = await state(immediate.id);
assert.equal(item.payment_status, 'PAID');
assert.equal(item.fulfillment_status, 'AWAITING_ACCEPTANCE');
assert.ok(new Date(item.acceptance_deadline).getTime() - new Date(item.paid_at).getTime() === 30 * 60_000);
await paidWebhook(immediate, duplicateEventId);
item = await state(immediate.id);
assert.equal(item.fulfillment_status, 'AWAITING_ACCEPTANCE', 'Webhook duplicado mantém estado');
assert.equal((await action(immediate.id, 'ACCEPT')).status, 200);
assert.equal((await action(immediate.id, 'READY')).status, 200);
assert.equal((await action(immediate.id, 'COMPLETE')).status, 200);
assert.equal((await state(immediate.id)).fulfillment_status, 'COMPLETED');
assert.equal((await action(immediate.id, 'REJECT')).status, 409);

const tomorrow = new Date(Date.now() + 24 * 3600_000);
tomorrow.setUTCHours(15, 0, 0, 0); // 12h America/Sao_Paulo
const scheduled = await seed(tomorrow.toISOString());
await paidWebhook(scheduled);
item = await state(scheduled.id);
assert.equal(item.fulfillment_status, 'SCHEDULED');
assert.equal(item.acceptance_deadline, tomorrow.toISOString());
assert.equal((await action(scheduled.id, 'ACCEPT')).status, 200);

const expired = await seed(null, true);
sql(`UPDATE orders SET acceptance_deadline='2020-01-01T00:00:00.000Z', paid_at='2019-12-31T23:30:00.000Z'
  WHERE id=${quote(expired.id)}`);
await jsonResponse(await fetch(base + '/cdn-cgi/local/scheduled?format=json').then(async res => {
  // Wrangler's local trigger returns a structured outcome but not an API JSON wrapper.
  return new Response(JSON.stringify({ ok: res.ok }), { status: res.status });
}));
item = await state(expired.id);
assert.equal(item.fulfillment_status, 'AUTO_REJECTED');
assert.ok(['REVIEW', 'REQUESTED'].includes(item.refund_status));
assert.equal((await action(expired.id, 'ACCEPT')).status, 409);

console.log('Fluxo local aprovado: pagamento confirmado, duplicidade, aceite, preparo, entrega, agendamento e expiração automática.');
