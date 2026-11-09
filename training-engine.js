/* Local-only operational training. Never sends payment, order or courier data. */
(() => {
  'use strict';
  const KEY = 'kipeixe-training-v1';
  const ARRIVAL_MS = 12000;
  const MAX_WAITING = 6;
  const NAMES = ['Ana Souza', 'Marcos Ferreira', 'Carla Martins', 'João Ribeiro', 'Fernanda Lima', 'Pedro Alves'];
  const DISHES = [
    [{ name: 'Tilápia à milanesa', qty: 2, unitCents: 2500 }, { name: 'Batata frita', qty: 1, unitCents: 2800 }],
    [{ name: 'Picanha completa', qty: 1, unitCents: 15200 }],
    [{ name: 'Filé mignon', qty: 1, unitCents: 9500 }, { name: 'Refrigerante', qty: 2, unitCents: 800 }],
    [{ name: 'Frango à passarinho', qty: 1, unitCents: 5200 }, { name: 'Arroz', qty: 1, unitCents: 1600 }],
    [{ name: 'Tilápia em postas', qty: 2, unitCents: 4900 }],
  ];
  function fresh() { return { enabled: false, nextSeq: 1, lastArrival: 0, orders: [] }; }
  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!value || !Array.isArray(value.orders) || value.orders.length > 100 ||
          !Number.isSafeInteger(value.nextSeq) || value.nextSeq < 1) return fresh();
      return { enabled: value.enabled === true, nextSeq: value.nextSeq,
        lastArrival: Number.isFinite(value.lastArrival) ? value.lastArrival : 0,
        orders: value.orders.filter(o => o && o.training === true &&
          typeof o.id === 'string' && o.id.startsWith('TRN-') &&
          ['AWAITING_ACCEPTANCE', 'PREPARING', 'READY', 'COMPLETED', 'REJECTED']
            .includes(o.fulfillment_status)) };
    } catch { return fresh(); }
  }
  let state = read();
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* memory-only fallback */ }
  };
  const pending = () => state.orders.filter(o => o.fulfillment_status === 'AWAITING_ACCEPTANCE').length;
  function add(now) {
    const seq = state.nextSeq++;
    const items = DISHES[(seq - 1) % DISHES.length].map(item => ({ ...item, variant: '' }));
    const order = {
      id: 'TRN-' + String(seq).padStart(8, '0') + '-' + now,
      training: true, name: NAMES[(seq - 1) % NAMES.length], phone: '00000000000',
      order_type: seq % 3 === 0 ? 'Entrega' : 'Retirada no Kipeixe',
      address: seq % 3 === 0 ? 'Endereço fictício — treinamento' : '',
      notes: seq % 4 === 0 ? 'Sem cebola, por favor.' : '',
      created_at: new Date(now).toISOString(), paid_at: new Date(now).toISOString(),
      acceptance_deadline: null, scheduled_for: null, accepted_at: null,
      payment_status: 'PAID', fulfillment_status: 'AWAITING_ACCEPTANCE',
      refund_status: 'NOT_REQUIRED', asaas_environment: 'training',
      delivery_provider: 'training', uber_status: '', ifood_status: '',
      uber_delivery_id: null, ifood_order_id: null,
      items, subtotal_cents: items.reduce((sum, item) => sum + item.qty * item.unitCents, 0),
    };
    order.delivery_cents = 0;
    order.total_cents = order.subtotal_cents;
    state.orders.unshift(order);
    state.lastArrival = now;
    return order;
  }
  function prune() {
    let done = 0;
    state.orders = state.orders.filter(order => {
      if (['COMPLETED', 'REJECTED'].includes(order.fulfillment_status)) return ++done <= 15;
      return true; // waiting orders never expire or disappear automatically
    });
  }
  function activate(now = Date.now()) {
    if (state.enabled) return false;
    state.enabled = true;
    if (!state.orders.length) { add(now); add(now + 1); }
    state.lastArrival = now;
    save();
    return true;
  }
  function deactivate() {
    state.enabled = false;
    save();
  }
  function reset(now = Date.now()) {
    state.orders = [];
    state.nextSeq = 1;
    state.lastArrival = now;
    if (state.enabled) { add(now); add(now + 1); }
    save();
  }
  function tick(now = Date.now()) {
    if (!state.enabled) return { changed: false, arrivals: 0 };
    let changed = false, arrivals = 0;
    for (const order of state.orders) {
      if (!order.accepted_at || !['PREPARING', 'READY'].includes(order.fulfillment_status)) continue;
      const elapsed = now - Date.parse(order.accepted_at);
      const next = elapsed >= 10000 ? 'COMPLETED' : elapsed >= 5000 ? 'READY' : 'PREPARING';
      if (order.fulfillment_status !== next) { order.fulfillment_status = next; changed = true; }
    }
    if (now - state.lastArrival >= ARRIVAL_MS) {
      state.lastArrival = now;
      if (pending() < MAX_WAITING) { add(now); arrivals = 1; changed = true; }
    }
    if (changed) { prune(); save(); }
    else if (now - state.lastArrival < 1000) save();
    return { changed, arrivals };
  }
  function act(id, action, now = Date.now()) {
    if (!state.enabled || !['ACCEPT', 'REJECT'].includes(action)) return false;
    const order = state.orders.find(o => o.id === id);
    if (!order || order.fulfillment_status !== 'AWAITING_ACCEPTANCE') return false;
    if (action === 'REJECT') order.fulfillment_status = 'REJECTED';
    else {
      order.fulfillment_status = 'PREPARING';
      order.accepted_at = new Date(now).toISOString();
    }
    save();
    return true;
  }
  function spawnNow(now = Date.now()) {
    if (!state.enabled || pending() >= MAX_WAITING) return false;
    add(now);
    prune();
    save();
    return true;
  }
  const list = () => state.orders.map(o => ({ ...o, items: o.items.map(i => ({ ...i })) }));
  const isEnabled = () => state.enabled;
  window.KipeixeTraining = { activate, deactivate, reset, tick, act, spawnNow, list, isEnabled, pending };
})();
