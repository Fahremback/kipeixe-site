(() => {
  'use strict';
  const API = location.hostname === '127.0.0.1'
    ? 'http://127.0.0.1:8787'
    : 'https://api.restaurantekipeixe.com.br';
  const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((cents || 0) / 100);
  const formatDate = value => value ? new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value.replace(' ', 'T') + (value.includes('Z') ? '' : value.includes('T') ? '' : 'Z'))) : '—';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const LABELS = {
    AWAITING_PAYMENT: 'Aguardando pagamento', AWAITING_ACCEPTANCE: 'Aguardando aceite',
    SCHEDULED: 'Agendado', PREPARING: 'Preparando', READY: 'Pronto',
    COMPLETED: 'Concluído', REJECTED: 'Recusado', AUTO_REJECTED: 'Recusa automática',
    PAYMENT_EXPIRED: 'Pagamento expirado', PAYMENT_CANCELED: 'Pagamento cancelado',
    PAYMENT_REVIEW: 'Verificar pagamento',
  };
  const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  let orders = [], categories = [], products = [], settings = null, lastPendingIds = new Set();
  let users = [], currentUsername = '', currentRole = '';
  let firstPoll = true, pollBusy = false, activeTab = 'orders', soundArmed = false;
  let historyPage = 1, historyPages = 1, historySelected = null;
  let ordersRenderSignature = '', expandedOrderIds = new Set();
  let noticeHideTimer = null;
  const training = window.KipeixeTraining;
  const trainingOn = () => Boolean(training?.isEnabled());

  function updateTrainingUi() {
    const enabled = trainingOn();
    $('#training-toggle').checked = enabled;
    $('#training-settings-status').textContent = enabled
      ? 'Ativo neste navegador. Pedidos reais permanecem inalterados.'
      : 'Desativado — exibindo pedidos reais.';
    $('#training-settings-status').classList.toggle('is-ready', enabled);
    $('#training-banner').hidden = !enabled;
    $('#orders-view').classList.toggle('training-active', enabled);
    $('#training-go').disabled = !enabled;
    $('#training-add-order').disabled = !enabled;
    $('#view-title').textContent = enabled && activeTab === 'orders'
      ? 'Pedidos · Treinamento' : activeTab === 'orders' ? 'Pedidos recebidos'
      : $('#view-title').textContent;
  }

  async function api(path, options = {}) {
    const response = await fetch(API + path, {
      ...options, credentials: 'include',
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
      cache: 'no-store',
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && !path.startsWith('/api/auth/login')) showLogin();
      throw Error(result.error || `Erro HTTP ${response.status}`);
    }
    return result;
  }
  function notify(message, error = false) {
    clearTimeout(noticeHideTimer);
    const box = $('#notice');
    box.textContent = message;
    box.className = 'notice' + (error ? ' error' : '');
    box.hidden = false;
    noticeHideTimer = setTimeout(() => { box.hidden = true; }, error ? 8000 : 4500);
  }
  function resetPanelView() {
    activeTab = 'orders';
    $$('.main-nav button').forEach(button => button.classList.toggle('active', button.dataset.tab === 'orders'));
    $$('.view').forEach(view => view.hidden = view.id !== 'orders-view');
    $('#view-title').textContent = 'Pedidos recebidos';
    $('#edit-user-form').reset();
    $('#edit-user-form').hidden = true;
  }
  function showLogin() {
    $('#dashboard-view').hidden = true;
    $('#login-view').hidden = false;
    users = [];
    currentUsername = '';
    currentRole = '';
    expandedOrderIds.clear();
    ordersRenderSignature = '';
    $('#users-list').textContent = '';
    resetPanelView();
    updateTrainingUi();
  }
  function showDashboard(username, role = 'staff') {
    resetPanelView();
    ordersRenderSignature = '';
    $('#login-view').hidden = true;
    $('#dashboard-view').hidden = false;
    currentUsername = username;
    currentRole = role;
    $('#operator-name').textContent = username;
    $('.main-nav [data-tab="users"]').hidden = role !== 'owner';
    $('.main-nav [data-tab="settings"]').hidden = role !== 'owner';
    $('.main-nav [data-tab="appearance"]').hidden = role !== 'owner';
    updateTrainingUi();
  }
  function armAudio() {
    soundArmed = true;
  }
  function pingNewOrder() {
    if (!soundArmed || !$('#sound-toggle').checked) return;
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      const context = new Context();
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(740, context.currentTime);
      oscillator.frequency.setValueAtTime(930, context.currentTime + .12);
      gain.gain.setValueAtTime(.08, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .34);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(); oscillator.stop(context.currentTime + .35);
      oscillator.onended = () => context.close();
    } catch {}
  }

  function deadlineRemaining(iso) {
    if (!iso) return '—';
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return 'Prazo vencido';
    const min = Math.floor(ms / 60000), sec = Math.floor(ms % 60000 / 1000);
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  // Only paid orders needing immediate operational attention fill the main screen.
  // Future appointments, unpaid checkouts and finished orders stay accessible below.
  const isSoonScheduled = order => {
    const time = Date.parse(order.scheduled_for || '');
    return Number.isFinite(time) && time - Date.now() <= 45 * 60000;
  };
  const needsAttention = order => {
    if (order.training === true) return ['AWAITING_ACCEPTANCE', 'PREPARING', 'READY'].includes(order.fulfillment_status);
    // Sandbox orders (including demonstrations) must never compete for the
    // team's attention or trigger an operational notification.
    if (order.asaas_environment === 'sandbox' || order.name.startsWith('[DEMO]')) return false;
    if (order.refund_status === 'REVIEW' || order.payment_status === 'REVIEW') return true;
    if (order.payment_status !== 'PAID') return false;
    if (['AWAITING_ACCEPTANCE', 'PREPARING', 'READY'].includes(order.fulfillment_status)) return true;
    return order.fulfillment_status === 'SCHEDULED' && isSoonScheduled(order);
  };
  const decisionDue = order => order.training === true
    ? order.fulfillment_status === 'AWAITING_ACCEPTANCE'
    : order.asaas_environment !== 'sandbox' &&
    !order.name.startsWith('[DEMO]') && order.payment_status === 'PAID' &&
    (order.fulfillment_status === 'AWAITING_ACCEPTANCE' ||
      (order.fulfillment_status === 'SCHEDULED' && isSoonScheduled(order)));
  const priorityRank = order => {
    if (order.refund_status === 'REVIEW' || order.payment_status === 'REVIEW') return 0;
    if (decisionDue(order)) return 1;
    if (order.fulfillment_status === 'READY') return 2;
    return 3;
  };
  const orderTimestamp = order => {
    const value = order.created_at || '';
    const timestamp = Date.parse(value.includes('T') ? value :
      value.replace(' ', 'T') + 'Z');
    return Number.isFinite(timestamp) ? timestamp : 0;
  };

  function orderCard(order) {
    const waiting = order.payment_status === 'PAID' &&
      ['AWAITING_ACCEPTANCE', 'SCHEDULED'].includes(order.fulfillment_status);
    const reviewing = order.refund_status === 'REVIEW';
    const status = order.payment_status === 'PAID' ? order.fulfillment_status :
      ({ EXPIRED: 'PAYMENT_EXPIRED', CANCELED: 'PAYMENT_CANCELED',
        REVIEW: 'PAYMENT_REVIEW' }[order.payment_status] || 'AWAITING_PAYMENT');
    const demo = order.name.startsWith('[DEMO]');
    const paymentExpiration = order.payment_status === 'PENDING' && orderTimestamp(order)
      ? new Date(orderTimestamp(order) + 60 * 60000).toISOString() : '';
    const createdTime = formatDate(order.created_at);
    const environment = order.training ? ' · TREINO' :
      order.asaas_environment === 'production' ? '' : ' · Sandbox';
    const items = (order.items || []).map(item =>
      `<li><strong>${esc(item.qty)}×</strong> ${esc(item.name)}${item.variant ? ` · ${esc(item.variant)}` : ''}</li>`);
    const isIFood = order.delivery_provider === 'ifood';
    const logisticsName = isIFood ? 'iFood' : 'Uber Direct';
    const logisticsStatus = isIFood ? order.ifood_status : order.uber_status;
    const logisticsError = isIFood ? order.ifood_dispatch_error : order.uber_dispatch_error;
    const logisticsUrl = isIFood ? order.ifood_tracking_url : order.uber_tracking_url;
    const validLink = isIFood
      ? /^https:\/\/(?:[a-z0-9-]+\.)*ifood\.com\.br\//i.test(logisticsUrl || '')
      : /^https:\/\/(?:[^/]+\.)?uber(?:eats)?\.com\//.test(logisticsUrl || '');
    const uber = order.order_type === 'Entrega'
      ? '<p class="order-extra"><strong>' + logisticsName + ':</strong> ' +
        esc(logisticsStatus || 'Aguardando preparo') +
        (logisticsError ? ' · ' + esc(logisticsError) : '') +
        (validLink
          ? ' · <a href="' + esc(logisticsUrl) +
          '" target="_blank" rel="noopener noreferrer">Acompanhar entregador</a>' : '') + '</p>' : '';
    const actions = [];
    if (waiting) actions.push(`<button class="accept" data-action="ACCEPT" data-id="${esc(order.id)}">Aceitar</button><button class="reject" data-action="REJECT" data-id="${esc(order.id)}">Recusar</button>`);
    if (!order.training && status === 'PREPARING') actions.push(`<button data-action="READY" data-id="${order.id}">Marcar pronto</button>`);
    if (!order.training && status === 'READY' && order.order_type !== 'Entrega') actions.push(`<button data-action="COMPLETE" data-id="${order.id}">Finalizar</button>`);
    if (!order.training && status === 'READY' && order.order_type === 'Entrega' && !isIFood && order.uber_status === 'FAILED')
      actions.push(`<button data-uber-dispatch="${order.id}">Tentar solicitar Uber</button>`);
    if (!order.training && status === 'READY' && order.order_type === 'Entrega' && isIFood && order.ifood_status === 'FAILED')
      actions.push(`<button data-ifood-dispatch="${order.id}">Tentar solicitar iFood</button>`);
    if (!order.training && status === 'READY' && order.order_type === 'Entrega' && !order.uber_delivery_id &&
        !order.ifood_order_id && !['REQUESTING', 'REVIEW'].includes(logisticsStatus))
      actions.push(`<button class="reject" data-action="CANCEL_DELIVERY" data-id="${order.id}">Cancelar entrega e estornar</button>`);
    if (reviewing) actions.push(`<button class="reject" data-refund="${order.id}">Revisar estorno</button>`);
    const totalItems = items.length;
    const moreItems = totalItems > 3 ? `<span class="extra-items">+${totalItems - 3} item(ns) · abrir detalhes</span>` : '';
    const stageDeadline = order.training && order.accepted_at &&
      ['PREPARING', 'READY'].includes(status)
      ? new Date(Date.parse(order.accepted_at) + (status === 'PREPARING' ? 5000 : 10000)).toISOString()
      : '';
    return `<article class="order-card compact-order ${decisionDue(order) ? 'urgent' : ''} ${reviewing || order.payment_status === 'REVIEW' ? 'review' : ''} ${demo ? 'demo-order' : ''}">
      <div class="order-top">
        <span class="order-id">#${esc(order.id.slice(0, 8).toUpperCase())}</span>
        <span class="status-tag ${waiting ? 'wait' : reviewing ? 'fail' : ''}">${esc(LABELS[status] || status)}</span>
      </div>
      <div class="order-meta"><span>${esc(createdTime)}${environment}</span><span>${esc(order.order_type)}</span></div>
      <div class="order-customer">${esc(order.name)}</div>
      ${order.training ? '<p class="order-demo-note">SIMULAÇÃO · NENHUMA VENDA REAL</p>' :
        demo ? '<p class="order-demo-note">TESTE · NÃO PREPARAR / NÃO CONTABILIZAR</p>' : ''}
      ${order.notes ? `<p class="order-note"><strong>Obs:</strong> ${esc(order.notes)}</p>` : ''}
      <ul class="order-items">${items.slice(0, 3).join('')}${moreItems ? `<li>${moreItems}</li>` : ''}</ul>
      <div class="order-footer">
        <strong class="order-total">${money(order.total_cents)}</strong>
        ${waiting ? order.training ? '<span class="order-deadline">Sem prazo</span>' :
          `<span class="order-deadline">Aceite <span class="timer" data-deadline="${esc(order.acceptance_deadline || '')}">${deadlineRemaining(order.acceptance_deadline)}</span></span>` : ''}
        ${stageDeadline ? `<span class="order-deadline">Próxima etapa <span class="timer" data-deadline="${esc(stageDeadline)}">${deadlineRemaining(stageDeadline)}</span></span>` : ''}
        ${!order.training && order.payment_status === 'PAID' && !waiting ? '<span class="paid-indicator">✓ Pago</span>' : ''}
      </div>
      ${actions.length ? `<div class="order-actions">${actions.join('')}</div>` : ''}
      <details class="order-details" data-order-details="${esc(order.id)}" ${expandedOrderIds.has(order.id) ? 'open' : ''}>
        <summary>Detalhes ${moreItems ? `· ${totalItems} itens` : ''}</summary>
        <div class="order-details-content">
          <p><strong>Telefone:</strong> ${esc(order.phone)}</p>
          <p><strong>Pagamento:</strong> ${order.training ? 'Fictício — nenhum valor cobrado' :
            esc(order.payment_status) + (order.asaas_environment === 'sandbox' ? ' · Sandbox, sem cobrança real' : '')}</p>
          ${paymentExpiration ? `<p><strong>Expira em:</strong> <span class="timer" data-deadline="${esc(paymentExpiration)}">${deadlineRemaining(paymentExpiration)}</span></p>` : ''}
          ${order.scheduled_for ? `<p><strong>Agendado:</strong> ${esc(formatDate(order.scheduled_for))}</p>` : ''}
          ${order.address ? `<p><strong>Endereço:</strong> ${esc(order.address)}</p>` : ''}
          ${order.notes ? `<p><strong>Observações completas:</strong> ${esc(order.notes)}</p>` : ''}
          ${totalItems > 3 ? `<ul class="order-all-items">${items.join('')}</ul>` : ''}
          ${uber}
          ${order.refund_status !== 'NOT_REQUIRED' ? `<p><strong>Estorno:</strong> ${esc(order.refund_status)}</p>` : ''}
          ${order.closed_reason ? `<p><strong>Encerramento:</strong> ${esc(order.closed_reason)}</p>` : ''}
        </div>
      </details>
    </article>`;
  }
  function renderOrders() {
    const pending = orders.filter(decisionDue);
    const preparing = orders.filter(o => needsAttention(o) && o.fulfillment_status === 'PREPARING');
    const ready = orders.filter(o => needsAttention(o) && o.fulfillment_status === 'READY');
    const reviewing = orders.filter(o => needsAttention(o) &&
      (o.refund_status === 'REVIEW' || o.payment_status === 'REVIEW'));
    $('#stat-pending').textContent = pending.length;
    $('#stat-preparing').textContent = preparing.length;
    $('#stat-ready').textContent = ready.length;
    $('#stat-refunds').textContent = reviewing.length;
    $('#orders-view [data-stat="pending"]').classList.toggle('has-items', pending.length > 0);
    $('#orders-view [data-stat="refunds"]').classList.toggle('has-items', reviewing.length > 0);
    $('#pending-count').textContent = pending.length;
    const main = orders.filter(needsAttention).sort((a, b) =>
      priorityRank(a) - priorityRank(b) ||
      (priorityRank(a) === 1
        ? Date.parse(a.acceptance_deadline || '') - Date.parse(b.acceptance_deadline || '') || 0
        : 0) || orderTimestamp(b) - orderTimestamp(a));
    const secondary = orders.filter(o => !needsAttention(o)).sort((a, b) =>
      (a.fulfillment_status === 'SCHEDULED' ? 0 : 1) -
      (b.fulfillment_status === 'SCHEDULED' ? 0 : 1) || orderTimestamp(b) - orderTimestamp(a));
    $('#active-orders-count').textContent = main.length;
    const future = secondary.filter(o => o.payment_status === 'PAID' &&
      o.fulfillment_status === 'SCHEDULED' && o.asaas_environment !== 'sandbox' &&
      !o.name.startsWith('[DEMO]')).length;
    const tests = secondary.filter(o => o.asaas_environment === 'sandbox' || o.name.startsWith('[DEMO]')).length;
    const unpaid = secondary.filter(o => o.payment_status !== 'PAID' &&
      !['EXPIRED', 'CANCELED'].includes(o.payment_status) &&
      o.asaas_environment !== 'sandbox' && !o.name.startsWith('[DEMO]')).length;
    const closed = secondary.length - future - unpaid - tests;
    $('#secondary-orders-summary').textContent = `Outros pedidos · ${secondary.length}` +
      (tests ? `   ·   ${tests} teste(s)` : '') +
      (future ? `   ·   ${future} agendado(s)` : '') +
      (unpaid ? `   ·   ${unpaid} aguardando pagamento` : '') +
      (closed ? `   ·   ${closed} encerrado(s)` : '');
    $('#other-orders-panel').hidden = secondary.length === 0;
    const signature = JSON.stringify([orders, main.map(o => o.id), secondary.slice(0, 12).map(o => o.id)]);
    if (signature !== ordersRenderSignature) {
      $('#orders-list').innerHTML = main.length
        ? main.map(orderCard).join('')
        : '<div class="empty-state quiet-queue">Tudo em dia. Nenhum pedido exige ação agora.</div>';
      $('#secondary-orders-list').innerHTML = secondary.slice(0, 12).map(orderCard).join('');
      $('#secondary-limit-note').textContent = secondary.length > 12
        ? `Mostrando os 12 mais recentes de ${secondary.length} · use o histórico para os demais.`
        : 'Pedidos sem ação imediata ficam fora da fila principal.';
      ordersRenderSignature = signature;
    }
    const current = new Set(pending.map(o => o.id));
    if (!firstPoll && [...current].some(id => !lastPendingIds.has(id))) pingNewOrder();
    lastPendingIds = current;
    firstPoll = false;
  }
  async function loadOrders() {
    if (pollBusy || $('#dashboard-view').hidden) return;
    pollBusy = true;
    try {
      const inTraining = trainingOn();
      const loaded = inTraining ? training.list() : (await api('/api/admin/orders')).orders || [];
      if (inTraining !== trainingOn()) return;
      orders = loaded;
      if (activeTab === 'orders') renderOrders();
      else $('#pending-count').textContent = orders.filter(decisionDue).length;
    } catch (error) {
      notify('Falha ao atualizar pedidos: ' + error.message, true);
    } finally { pollBusy = false; }
  }
  // Use one action handler for both the priority queue and secondary orders.
  async function onOrderAction(event) {
    const action = event.target.closest('[data-action]');
    const refund = event.target.closest('[data-refund]');
    const dispatch = event.target.closest('[data-uber-dispatch]');
    const ifoodDispatch = event.target.closest('[data-ifood-dispatch]');
    if (!action && !refund && !dispatch && !ifoodDispatch) return;
    const id = action?.dataset.id || refund?.dataset.refund || dispatch?.dataset.uberDispatch ||
      ifoodDispatch?.dataset.ifoodDispatch;
    if (trainingOn()) {
      if (!id?.startsWith('TRN-') || !action ||
          !['ACCEPT', 'REJECT'].includes(action.dataset.action)) return;
      if (!training.act(id, action.dataset.action)) return;
      orders = training.list();
      renderOrders();
      notify(action.dataset.action === 'ACCEPT'
        ? 'Treinamento: pedido aceito. As próximas etapas avançam a cada 5 segundos.'
        : 'Treinamento: pedido recusado (sem estorno real).');
      return;
    }
    if (id?.startsWith('TRN-')) return; // never send training IDs to the API
    if (action?.dataset.action === 'REJECT' &&
      !confirm('Recusar este pedido pago e solicitar estorno pelo Asaas?')) return;
    if (action?.dataset.action === 'CANCEL_DELIVERY' &&
      !confirm('Cancelar este pedido pago sem entregador e solicitar estorno ao Asaas?')) return;
    event.target.disabled = true;
    try {
      if (refund) {
        const result = await api(`/api/admin/orders/${id}/retry-refund`, { method: 'POST' });
        notify(result.ok ? 'Estorno solicitado ao Asaas.' : 'Estorno ainda exige conferência na conta Asaas.', !result.ok);
      } else if (dispatch) {
        const result = await api(`/api/admin/orders/${id}/dispatch-uber`, { method: 'POST' });
        notify('Uber Direct: ' + (result.uber?.status || 'verificação pendente'), !result.ok);
      } else if (ifoodDispatch) {
        const result = await api(`/api/admin/orders/${id}/dispatch-ifood`, { method: 'POST' });
        notify('iFood: ' + (result.ifood?.status || 'verificação pendente'), !result.ok);
      } else {
        const result = await api(`/api/admin/orders/${id}/action`, {
          method: 'POST', body: JSON.stringify({ action: action.dataset.action })
        });
        notify(result.ifood ? 'Pedido pronto · iFood: ' + result.ifood.status
          : result.uber ? 'Pedido pronto · Uber Direct: ' + result.uber.status : 'Pedido atualizado.');
      }
      await loadOrders();
    } catch (error) { notify(error.message, true); }
    finally { event.target.disabled = false; }
  }
  for (const container of [$('#orders-list'), $('#secondary-orders-list')]) {
    container.addEventListener('click', onOrderAction);
    container.addEventListener('click', event => {
      const summary = event.target.closest('summary');
      const details = summary?.parentElement;
      if (!details?.matches('[data-order-details]')) return;
      const id = details.dataset.orderDetails;
      if (details.open) expandedOrderIds.delete(id);
      else expandedOrderIds.add(id);
    });
  }
  $('#open-history-from-orders').addEventListener('click', () => switchTab('history'));
  $('#refresh-orders').addEventListener('click', loadOrders);
  function updateClock() {
    $('#clock').textContent = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(new Date());
    $$('[data-deadline]').forEach(node => node.textContent = deadlineRemaining(node.dataset.deadline));
  }
  setInterval(updateClock, 1000);
  setInterval(() => {
    if (!trainingOn() || $('#dashboard-view').hidden) return;
    const result = training.tick();
    if (result.changed) {
      orders = training.list();
      if (activeTab === 'orders') renderOrders();
      else $('#pending-count').textContent = training.pending();
    }
  }, 1000);
  setInterval(loadOrders, 8000);

  function renderProducts() {
    const query = $('#product-search').value.toLowerCase().trim();
    const category = $('#product-category-filter').value;
    const visible = products.filter(p => !p.archived && (!category || p.category_id === category) &&
      (!query || p.name.toLowerCase().includes(query) || categories.find(c => c.id === p.category_id)?.title.toLowerCase().includes(query)));
    $('#products-list').innerHTML = visible.length ? visible.map(p => {
      const cat = categories.find(c => c.id === p.category_id)?.title || '';
      const variants = p.variants.length ? p.variants.map(v => `${esc(v.label)} ${money(v.priceCents)}`).join(' • ') : '';
      return `<div class="product-row ${p.active ? '' : 'off'}"><div class="details"><strong>${esc(p.name)}</strong>
        <small>${esc(cat)} • ${p.active ? 'Disponível' : 'Indisponível'} ${variants}</small></div>
        <span class="money">${p.price_cents === null ? (variants ? 'Variações' : 'Sob consulta') : money(p.price_cents)}</span>
        <button data-edit-product="${esc(p.id)}" type="button">Editar</button></div>`;
    }).join('') : '<div class="empty-state">Nenhum produto encontrado.</div>';
  }
  function fillVariantList(variants) {
    $('#variants-list').innerHTML = variants.map(v => `<div class="variant-row">
      <input class="variant-label" placeholder="Nome / tamanho" value="${esc(v.label)}">
      <input class="variant-price" type="number" min="1" step=".01" placeholder="R$" value="${(v.priceCents / 100).toFixed(2)}">
      <button type="button" data-delete-variant aria-label="Remover variação">×</button></div>`).join('');
  }
  function editProduct(id = '') {
    const p = products.find(item => item.id === id);
    const editor = $('#product-editor');
    editor.hidden = false;
    $('#editor-title').textContent = p ? 'Editar produto' : 'Novo produto';
    editor.elements.id.value = p?.id || '';
    editor.elements.name.value = p?.name || '';
    editor.elements.description.value = p?.description || '';
    editor.elements.price.value = p?.price_cents === null || p === undefined ? '' : (p.price_cents / 100).toFixed(2);
    editor.elements.categoryId.value = p?.category_id || categories[0]?.id || '';
    editor.elements.active.checked = p ? Boolean(p.active) : true;
    $('#archive-product').hidden = !p;
    fillVariantList(p?.variants || []);
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function loadCatalog() {
    const data = await api('/api/admin/catalog');
    categories = data.categories || [];
    products = data.products || [];
    const categoryOptions = categories.map(c => `<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('');
    $('#product-category-filter').innerHTML = '<option value="">Todas as categorias</option>' + categoryOptions;
    $('#product-editor').elements.categoryId.innerHTML = categoryOptions;
    $('#categories-list').innerHTML = categories.map(c => `<div class="category-line" data-cat="${esc(c.id)}">
      <input aria-label="Nome da categoria" value="${esc(c.title)}">
      <label class="check-line"><input type="checkbox" aria-label="Categoria disponível" ${c.active ? 'checked' : ''}> Ativa</label>
      <button type="button" class="subtle-btn" data-save-cat="${esc(c.id)}">Salvar</button></div>`).join('');
    renderProducts();
  }
  $('#product-search').addEventListener('input', renderProducts);
  $('#product-category-filter').addEventListener('change', renderProducts);
  $('#products-list').addEventListener('click', event => {
    const button = event.target.closest('[data-edit-product]');
    if (button) editProduct(button.dataset.editProduct);
  });
  $('#new-product').addEventListener('click', () => editProduct());
  $('#close-editor').addEventListener('click', () => $('#product-editor').hidden = true);
  $('#add-variant').addEventListener('click', () => {
    const list = $('#variants-list');
    list.insertAdjacentHTML('beforeend', `<div class="variant-row">
      <input class="variant-label" placeholder="Nome / tamanho">
      <input class="variant-price" type="number" min="1" step=".01" placeholder="R$">
      <button type="button" data-delete-variant aria-label="Remover variação">×</button></div>`);
  });
  $('#variants-list').addEventListener('click', event => {
    if (event.target.closest('[data-delete-variant]')) event.target.closest('.variant-row').remove();
  });
  $('#product-editor').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const variants = $$('#variants-list .variant-row').map(row => ({
      label: row.querySelector('.variant-label').value.trim(),
      priceCents: Math.round(Number(row.querySelector('.variant-price').value) * 100),
    }));
    const rawPrice = form.elements.price.value.trim();
    const id = form.elements.id.value;
    const body = {
      name: form.elements.name.value, description: form.elements.description.value,
      categoryId: form.elements.categoryId.value, priceCents: rawPrice ? Math.round(Number(rawPrice) * 100) : null,
      variants, active: form.elements.active.checked,
      sortOrder: products.find(item => item.id === id)?.sort_order || products.length,
    };
    try {
      await api(id ? `/api/admin/products/${encodeURIComponent(id)}` : '/api/admin/products', {
        method: id ? 'PUT' : 'POST', body: JSON.stringify(body),
      });
      notify('Produto salvo. O cardápio público será atualizado.');
      await loadCatalog();
      $('#product-editor').hidden = true;
    } catch (error) { notify(error.message, true); }
  });
  $('#archive-product').addEventListener('click', async () => {
    const id = $('#product-editor').elements.id.value;
    if (!id || !confirm('Arquivar este produto e removê-lo do cardápio público?')) return;
    try {
      await api(`/api/admin/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
      notify('Produto arquivado.'); $('#product-editor').hidden = true;
      await loadCatalog();
    } catch (error) { notify(error.message, true); }
  });
  $('#category-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api('/api/admin/categories', {
        method: 'POST', body: JSON.stringify({
          title: form.elements.title.value, eyebrow: form.elements.eyebrow.value,
          sortOrder: categories.length,
        }),
      });
      form.reset(); notify('Categoria criada.'); await loadCatalog();
    } catch (error) { notify(error.message, true); }
  });
  $('#categories-list').addEventListener('click', async event => {
    const button = event.target.closest('[data-save-cat]');
    if (!button) return;
    const category = categories.find(c => c.id === button.dataset.saveCat);
    const line = button.closest('[data-cat]');
    const title = line.querySelector('input:not([type="checkbox"])').value;
    const active = line.querySelector('input[type="checkbox"]').checked;
    try {
      await api(`/api/admin/categories/${encodeURIComponent(category.id)}`, {
        method: 'PUT', body: JSON.stringify({
          title, eyebrow: category.eyebrow, sortOrder: category.sort_order, active,
        }),
      });
      notify('Categoria atualizada.'); await loadCatalog();
    } catch (error) { notify(error.message, true); }
  });

  async function loadSettings() {
    settings = await api('/api/admin/settings');
    const form = $('#settings-form');
    form.elements.ordersEnabled.checked = settings.ordersEnabled;
    form.elements.deliveryEnabled.checked = settings.deliveryEnabled;
    form.elements.uberEnabled.checked = settings.uberEnabled || false;
    form.elements.ifoodEnabled.checked = settings.ifoodEnabled || false;
    form.elements.deliveryProvider.value = settings.deliveryProvider || 'uber';
    const ifoodReady = settings.ifoodShippingConfigured && settings.ifoodShippingSystemAvailable;
    const ifoodStatus = $('#ifood-integration-status');
    ifoodStatus.textContent = ifoodReady
      ? 'API iFood configurada. Selecione o operador e ative a integração.'
      : 'Aguardando credenciais de homologação Shipping/Entrega Fácil.';
    ifoodStatus.classList.toggle('is-ready', ifoodReady);
    const uberReady = settings.uberDirectConfigured && settings.uberDirectSystemAvailable;
    const uberStatus = $('#uber-integration-status');
    uberStatus.textContent = uberReady
      ? 'Conta Uber Direct conectada. Ative a entrega para disponibilizar cotações.'
      : 'Aguardando aprovação da conta Uber Direct e credenciais no servidor. Entregas desativadas.';
    uberStatus.classList.toggle('is-ready', uberReady);
    form.elements.deliveryFee.value = (settings.deliveryFeeCents / 100).toFixed(2);
    form.elements.paymentMode.value = settings.paymentMode || 'sandbox';
    form.elements.paymentsEnabled.checked = settings.paymentsEnabled || false;
    form.elements.orderChannel.value = settings.orderChannel || 'whatsapp';
    form.elements.whatsappNumber.value = settings.whatsappNumber || '554535772363';
    updateOrderChannel();
    updatePaymentEnvironment();
    $('#hours-list').innerHTML = DAYS.map((day, index) => {
      const slot = settings.hours[String(index)];
      return `<div class="hour-row" data-day="${index}">
        <input type="checkbox" aria-label="Aberto ${day}" ${slot ? 'checked' : ''}>
        <span>${day}</span><input type="time" aria-label="Abertura ${day}" value="${slot?.open || '09:00'}">
        <input type="time" aria-label="Fechamento ${day}" value="${slot?.close || '23:40'}">
      </div>`;
    }).join('');
  }
  function updatePaymentEnvironment() {
    if (!settings) return;
    const form = $('#settings-form');
    const mode = form.elements.paymentMode.value;
    const credentials = settings.asaasEnvironments?.[mode] || {};
    const ready = Boolean(credentials.configured && settings.paymentSystemAvailable);
    const status = $('#asaas-environment-status');
    if (credentials.apiKeyConfigured === false && credentials.webhookConfigured === true) {
      status.textContent = 'API Key ausente. Token do webhook já cadastrado. Falta apenas cadastrar a chave de ' +
        (mode === 'production' ? 'produção' : 'sandbox') + ' no servidor.';
    } else if (credentials.apiKeyConfigured === true && credentials.webhookConfigured === false) {
      status.textContent = 'API Key cadastrada. Token do webhook ausente neste ambiente.';
    } else if (credentials.apiKeyConfigured === false && credentials.webhookConfigured === false) {
      status.textContent = 'API Key e token do webhook ausentes neste ambiente.';
    } else if (!settings.paymentSystemAvailable) {
      status.textContent = 'Credenciais presentes, mas a integração está desabilitada no servidor.';
    } else if (ready) {
      status.textContent = 'API Key e webhook cadastrados. A conexão com o Asaas ainda precisa ser validada.';
    } else {
      status.textContent = 'Configuração incompleta. Confira as credenciais do ambiente no servidor.';
    }
    status.classList.toggle('is-ready', ready);
    $('#asaas-risk-note').textContent = mode === 'sandbox'
      ? 'MODO TESTE: pedidos e pagamentos simulados, sem transferência real de dinheiro.'
      : 'ATENÇÃO: Produção realiza cobranças reais na conta vinculada à chave de produção.';
  }
  function updateOrderChannel() {
    const form = $('#settings-form');
    const whatsapp = form.elements.orderChannel.value === 'whatsapp';
    $$('[data-asaas-settings]').forEach(section => { section.hidden = whatsapp; });
    $('[data-whatsapp-settings]').hidden = !whatsapp;
    $('[data-order-channel-status]').textContent = whatsapp
      ? 'Ativo: pedidos encaminhados ao WhatsApp.'
      : 'Ativo: pagamento online pelo Asaas.';
  }
  $('#settings-form').elements.orderChannel.addEventListener('change', updateOrderChannel);
  $('#settings-form').elements.paymentMode.addEventListener('change', updatePaymentEnvironment);
  async function changeTrainingMode(enabled) {
    if (!training) { notify('Não foi possível carregar o simulador.', true); return; }
    if (enabled) training.activate();
    else training.deactivate();
    firstPoll = true;
    lastPendingIds = new Set();
    ordersRenderSignature = '';
    updateTrainingUi();
    notify(enabled ? 'Treinamento ativado neste navegador. Nenhum pedido real foi alterado.' :
      'Treinamento desativado. Retornando à fila de pedidos reais.');
    await switchTab('orders');
  }
  $('#training-toggle').addEventListener('change', event => {
    changeTrainingMode(event.target.checked).catch(error => notify(error.message, true));
  });
  $('#training-stop').addEventListener('click', () => {
    changeTrainingMode(false).catch(error => notify(error.message, true));
  });
  $('#training-go').addEventListener('click', () => switchTab('orders'));
  $('#training-add-order').addEventListener('click', () => {
    if (!trainingOn()) return;
    if (!training.spawnNow()) {
      notify('Há seis pedidos aguardando aceite. Aceite ou recuse um antes de gerar outro.', true);
      return;
    }
    orders = training.list();
    renderOrders();
  });
  $('#training-reset').addEventListener('click', async () => {
    if (!trainingOn()) return;
    if (!confirm('Reiniciar apenas os pedidos fictícios deste navegador?')) return;
    training.reset();
    firstPoll = true;
    lastPendingIds = new Set();
    ordersRenderSignature = '';
    notify('Simulação reiniciada. Pedidos reais preservados.');
    await switchTab('orders');
  });
  $('#settings-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const hours = {};
    $$('#hours-list .hour-row').forEach(row => {
      const inputs = row.querySelectorAll('input');
      hours[row.dataset.day] = inputs[0].checked ? { open: inputs[1].value, close: inputs[2].value } : null;
    });
    try {
      await api('/api/admin/settings', {
        method: 'PUT', body: JSON.stringify({
          ordersEnabled: form.elements.ordersEnabled.checked,
          deliveryEnabled: form.elements.deliveryEnabled.checked,
          uberEnabled: form.elements.uberEnabled.checked,
          ifoodEnabled: form.elements.ifoodEnabled.checked,
          deliveryProvider: form.elements.deliveryProvider.value,
          deliveryFeeCents: Math.round(Number(form.elements.deliveryFee.value) * 100),
          paymentMode: form.elements.paymentMode.value,
          paymentsEnabled: form.elements.paymentsEnabled.checked,
          orderChannel: form.elements.orderChannel.value,
          whatsappNumber: form.elements.whatsappNumber.value.replace(/\D/g, ''),
          hours,
        }),
      });
      notify('Configurações salvas com sucesso.');
      await loadSettings();
    } catch (error) { notify(error.message, true); }
  });

  async function loadUsers() {
    const result = await api('/api/admin/users');
    users = result.users || [];
    $('#users-list').innerHTML = users.map(user => `
      <div class="user-row ${user.active ? '' : 'inactive'}">
        <div><strong>${esc(user.username)}</strong>
          <small>${user.role === 'owner' ? 'Proprietário' : 'Equipe'} ·
            ${user.active ? 'Ativo' : 'Desativado'}${user.username === currentUsername ? ' · Seu login' : ''}</small>
        </div>
        <button type="button" data-edit-user="${esc(user.username)}">Editar</button>
      </div>`).join('') || '<p>Nenhum usuário cadastrado.</p>';
  }

  $('#users-list').addEventListener('click', event => {
    const button = event.target.closest('[data-edit-user]');
    if (!button) return;
    const user = users.find(item => item.username === button.dataset.editUser);
    if (!user) return;
    const form = $('#edit-user-form');
    form.hidden = false;
    form.reset();
    form.elements.originalUsername.value = user.username;
    form.elements.username.value = user.username;
    form.elements.active.checked = Boolean(user.active);
    $('#edit-user-title').textContent = user.username;
    const isOwner = user.role === 'owner';
    $('#current-password-row').hidden = !isOwner;
    form.elements.currentPassword.required = isOwner;
    $('#user-active-row').hidden = isOwner;
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  $('#cancel-edit-user').addEventListener('click', () => {
    $('#edit-user-form').reset();
    $('#edit-user-form').hidden = true;
  });

  $('#new-user-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          username: form.elements.username.value,
          password: form.elements.password.value,
        }),
      });
      form.reset();
      notify('Usuário criado. A conta já pode acessar o painel.');
      await loadUsers();
    } catch (error) { notify(error.message, true); }
    finally { button.disabled = false; }
  });

  $('#edit-user-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const before = form.elements.originalUsername.value;
    const user = users.find(item => item.username === before);
    if (!user) return;
    if (user.role !== 'owner' && !form.elements.active.checked &&
        !confirm('Desativar esta conta e encerrar suas sessões?')) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await api('/api/admin/users/' + encodeURIComponent(before), {
        method: 'PUT',
        body: JSON.stringify({
          username: form.elements.username.value,
          password: form.elements.password.value || undefined,
          currentPassword: user.role === 'owner' ? form.elements.currentPassword.value : undefined,
          active: form.elements.active.checked,
        }),
      });
      if (before === currentUsername) {
        currentUsername = result.username;
        $('#operator-name').textContent = currentUsername;
      }
      form.reset();
      form.hidden = true;
      notify('Acesso atualizado com sucesso.');
      await loadUsers();
    } catch (error) { notify(error.message, true); }
    finally { button.disabled = false; }
  });

  const statusOf = order => order.payment_status === 'PAID' ? order.fulfillment_status :
    ({ EXPIRED: 'PAYMENT_EXPIRED', CANCELED: 'PAYMENT_CANCELED',
      REVIEW: 'PAYMENT_REVIEW' }[order.payment_status] || 'AWAITING_PAYMENT');

  async function loadHistory() {
    if ($('#dashboard-view').hidden) return;
    const form = $('#history-filters');
    const params = new URLSearchParams({ page: String(historyPage) });
    for (const field of ['q', 'status', 'from', 'to']) {
      const value = form.elements[field].value.trim();
      if (value && !(field === 'status' && value === 'ALL')) params.set(field, value);
    }
    const data = await api('/api/admin/history?' + params);
    historyPages = Math.max(1, data.pages || 1);
    const list = data.orders || [];
    $('#history-summary').textContent = `${data.total} pedido(s) encontrado(s).`;
    $('#history-list').innerHTML = list.map(order => `
      <article class="history-row">
        <div><strong>#${esc(order.id.slice(0, 8).toUpperCase())} · ${esc(order.name)}</strong>
          <small>${formatDate(order.created_at)} · ${esc(order.order_type)} ·
            ${order.asaas_environment === 'production' ? 'Produção' : 'Sandbox'} ·
            ${order.items.map(item => esc(item.qty + '× ' + item.name)).join(' • ')}</small>
        </div>
        <div class="history-row-right">
          <strong>${money(order.total_cents)}</strong>
          <span class="status-tag">${esc(LABELS[statusOf(order)] || statusOf(order))}</span>
          <button type="button" data-history-id="${esc(order.id)}">Ver histórico</button>
        </div>
      </article>`).join('') || '<div class="empty-state">Nenhum pedido encontrado para esses filtros.</div>';
    $('#history-page').textContent = `Página ${historyPage} de ${historyPages}`;
    $('#history-prev').disabled = historyPage <= 1;
    $('#history-next').disabled = historyPage >= historyPages;
  }

  function allowedHistoryCorrection(order) {
    if (order.payment_status !== 'PAID' || order.refund_status !== 'NOT_REQUIRED' ||
        order.uber_delivery_id || order.ifood_order_id ||
        ['REQUESTING','REVIEW','REQUESTED','PENDING','pickup','dropoff','delivered','completed']
          .includes(order.uber_status) ||
        ['REQUESTING','REVIEW','REQUESTED','PENDING','DELIVERED','COMPLETED']
          .includes(order.ifood_status)) return [];
    if (order.fulfillment_status === 'READY' && order.order_type !== 'Entrega')
      return ['PREPARING'];
    if (order.fulfillment_status === 'COMPLETED' && order.order_type !== 'Entrega') return ['READY'];
    if (order.fulfillment_status === 'PREPARING' &&
        order.acceptance_deadline && new Date(order.acceptance_deadline).getTime() > Date.now())
      return [order.scheduled_for ? 'SCHEDULED' : 'AWAITING_ACCEPTANCE'];
    return [];
  }

  async function openHistory(id) {
    const data = await api('/api/admin/orders/' + encodeURIComponent(id) + '/history');
    historySelected = data.order;
    const state = statusOf(data.order);
    $('#history-detail-title').textContent = '#' + id.slice(0, 8).toUpperCase() +
      ' · ' + data.order.name;
    $('#history-current-state').textContent =
      `Criado em ${formatDate(data.order.created_at)} · ${LABELS[state] || state} · ` +
      `Pagamento: ${data.order.payment_status} · Estorno: ${data.order.refund_status}`;
    const actionLabels = {
      ACCEPT: 'Pedido aceito', REJECT: 'Pedido recusado',
      READY: 'Marcado como pronto', COMPLETE: 'Pedido concluído',
      AUTO_REJECTED: 'Recusa automática', CANCEL_DELIVERY: 'Entrega cancelada',
      REFUND_REQUESTED: 'Estorno solicitado', REFUND_RETRY: 'Nova tentativa de estorno',
      ORDER_STATUS_CORRECTED: 'Marcação corrigida',
      IFOOD_DISPATCH_RETRY: 'Nova tentativa de despacho iFood',
      UBER_DISPATCH_RETRY: 'Nova tentativa de despacho Uber',
      ASAAS_CHECKOUT_FAILED: 'Falha ao iniciar pagamento Asaas',
    };
    $('#history-events').innerHTML = `
      <div class="history-event"><strong>Pedido registrado</strong>
        <small>${formatDate(data.order.created_at)} · Site</small></div>
      ${data.order.paid_at ? `<div class="history-event"><strong>Pagamento confirmado</strong>
        <small>${formatDate(data.order.paid_at)} · Asaas</small></div>` : ''}
      ${data.events.map(event => {
        let info = event.details || '';
        try {
          const details = JSON.parse(info);
          if (details && typeof details === 'object') {
            info = (details.from && details.to
              ? `${LABELS[details.from] || details.from} → ${LABELS[details.to] || details.to}`
              : '') + (details.reason ? ' · Motivo: ' + details.reason : '');
          }
        } catch {}
        return `<div class="history-event"><strong>${esc(actionLabels[event.action] || event.action)}</strong>
          <small>${formatDate(event.created_at)} · ${esc(event.actor)}</small>
          ${info ? `<p>${esc(info)}</p>` : ''}</div>`;
      }).join('')}`;
    const targets = data.canCorrect ? allowedHistoryCorrection(data.order) : [];
    const form = $('#history-correction');
    form.reset();
    form.hidden = targets.length === 0;
    $('#history-correction-note').textContent = !data.canCorrect
      ? 'Somente o proprietário pode corrigir marcações.'
      : targets.length ? 'A correção registra o operador, o horário e o motivo.'
      : 'Não há correção operacional segura para esse pedido. Pagamentos, estornos e entregas solicitadas não podem ser revertidos por esta tela.';
    if (targets.length) {
      form.elements.id.value = id;
      form.elements.expectedStatus.value = data.order.fulfillment_status;
      form.elements.targetStatus.innerHTML = targets.map(target =>
        `<option value="${esc(target)}">${esc(LABELS[target] || target)}</option>`).join('');
    }
    $('#history-detail').hidden = false;
    $('#history-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('#history-filters').addEventListener('submit', async event => {
    event.preventDefault();
    historyPage = 1;
    $('#history-detail').hidden = true;
    try { await loadHistory(); } catch (error) { notify(error.message, true); }
  });
  $('#history-clear').addEventListener('click', async () => {
    $('#history-filters').reset();
    historyPage = 1;
    $('#history-detail').hidden = true;
    try { await loadHistory(); } catch (error) { notify(error.message, true); }
  });
  $('#history-prev').addEventListener('click', async () => {
    if (historyPage <= 1) return;
    historyPage--;
    try { await loadHistory(); } catch (error) { notify(error.message, true); }
  });
  $('#history-next').addEventListener('click', async () => {
    if (historyPage >= historyPages) return;
    historyPage++;
    try { await loadHistory(); } catch (error) { notify(error.message, true); }
  });
  $('#history-list').addEventListener('click', async event => {
    const button = event.target.closest('[data-history-id]');
    if (!button) return;
    try { await openHistory(button.dataset.historyId); }
    catch (error) { notify(error.message, true); }
  });
  $('#history-close-detail').addEventListener('click', () => {
    $('#history-detail').hidden = true;
    historySelected = null;
  });
  $('#history-correction').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!historySelected || currentRole !== 'owner') return;
    const to = form.elements.targetStatus.value;
    const from = form.elements.expectedStatus.value;
    const question = `Corrigir o pedido #${historySelected.id.slice(0, 8).toUpperCase()}:
      ${LABELS[from] || from} → ${LABELS[to] || to}? Esta alteração ficará no histórico.`;
    if (!confirm(question)) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api('/api/admin/orders/' + encodeURIComponent(historySelected.id) + '/correct', {
        method: 'POST',
        body: JSON.stringify({ expectedStatus: from, targetStatus: to,
          reason: form.elements.reason.value }),
      });
      notify('Marcação corrigida e registrada no histórico.');
      await loadHistory();
      await openHistory(historySelected.id);
      await loadOrders();
    } catch (error) { notify(error.message, true); }
    finally { button.disabled = false; }
  });

  async function switchTab(tab) {
    if (['users', 'appearance', 'settings'].includes(tab) && currentRole !== 'owner') return;
    activeTab = tab;
    $$('.main-nav button').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
    $$('.view').forEach(view => view.hidden = view.id !== `${tab}-view`);
    $('#view-title').textContent = ({ orders: trainingOn() ? 'Pedidos · Treinamento' : 'Pedidos recebidos', products: 'Controle do cardápio',
      settings: 'Funcionamento do restaurante', users: 'Usuários e acessos',
      history: 'Histórico de pedidos', appearance: 'Aparência e cores do site' })[tab];
    try {
      if (tab === 'products') await loadCatalog();
      if (tab === 'settings') await loadSettings();
      if (tab === 'orders') await loadOrders();
      if (tab === 'users') await loadUsers();
      if (tab === 'history') await loadHistory();
      if (tab === 'appearance') document.dispatchEvent(new CustomEvent('kipeixe:appearance-open'));
    } catch (error) { notify(error.message, true); }
  }
  $$('.main-nav button').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));

  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    $('#login-error').hidden = true;
    try {
      const data = await api('/api/auth/login', {
        method: 'POST', body: JSON.stringify({
          username: form.elements.username.value, password: form.elements.password.value
        }),
      });
      form.elements.password.value = '';
      showDashboard(data.username, data.role);
      armAudio(); firstPoll = true; await loadOrders();
    } catch (error) {
      $('#login-error').textContent = error.message;
      $('#login-error').hidden = false;
    }
  });
  $('#logout').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    showLogin();
  });
  async function start() {
    try {
      const session = await api('/api/auth/session');
      if (!session.authenticated) {
        showLogin();
      } else {
        showDashboard(session.username, session.role);
        await loadOrders();
      }
    } catch { showLogin(); }
    updateClock();
  }
  start();
})();
