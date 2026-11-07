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
    const box = $('#notice');
    box.textContent = message;
    box.className = 'notice' + (error ? ' error' : '');
    box.hidden = false;
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
    $('#users-list').textContent = '';
    resetPanelView();
  }
  function showDashboard(username, role = 'staff') {
    resetPanelView();
    $('#login-view').hidden = true;
    $('#dashboard-view').hidden = false;
    currentUsername = username;
    currentRole = role;
    $('#operator-name').textContent = username;
    $('.main-nav [data-tab="users"]').hidden = role !== 'owner';
    $('.main-nav [data-tab="settings"]').hidden = role !== 'owner';
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

  function orderCard(order) {
    const waiting = ['AWAITING_ACCEPTANCE', 'SCHEDULED'].includes(order.fulfillment_status);
    const reviewing = order.refund_status === 'REVIEW';
    const status = order.payment_status === 'PAID' ? order.fulfillment_status :
      ({ EXPIRED: 'PAYMENT_EXPIRED', CANCELED: 'PAYMENT_CANCELED',
        REVIEW: 'PAYMENT_REVIEW' }[order.payment_status] || 'AWAITING_PAYMENT');
    const demo = order.name.startsWith('[DEMO]');
    const paymentExpiration = order.payment_status === 'PENDING' ?
      new Date(Date.parse(order.created_at.replace(' ', 'T') + 'Z') + 60 * 60000).toISOString() : '';
    const paymentInfo = order.payment_status === 'PAID'
      ? '<p class="order-payment-ok">Pagamento confirmado' +
        (order.asaas_environment === 'sandbox' ? ' · Sandbox (sem dinheiro real)' : '') + '</p>'
      : paymentExpiration ? `<p class="order-extra">Pagamento expira em <span class="timer"
          data-deadline="${esc(paymentExpiration)}">${deadlineRemaining(paymentExpiration)}</span></p>` : '';
    const scheduled = order.scheduled_for ? `Agendado: ${formatDate(order.scheduled_for)}` : 'Pedido imediato';
    const environment = order.asaas_environment === 'production' ? 'Produção' : 'Sandbox';
    const items = order.items.map(item => `<li><strong>${item.qty}×</strong> ${esc(item.name)}${item.variant ? ` · ${esc(item.variant)}` : ''}</li>`).join('');
    const details = [
      order.address ? `Endereço: ${esc(order.address)}` : '',
      order.notes ? `Observações: ${esc(order.notes)}` : '',
    ].filter(Boolean).join('<p></p>');
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
    if (waiting) actions.push(`<button data-action="ACCEPT" data-id="${order.id}">Aceitar</button><button class="reject" data-action="REJECT" data-id="${order.id}">Recusar</button>`);
    if (status === 'PREPARING') actions.push(`<button data-action="READY" data-id="${order.id}">Marcar pronto</button>`);
    if (status === 'READY' && order.order_type !== 'Entrega') actions.push(`<button data-action="COMPLETE" data-id="${order.id}">Finalizar</button>`);
    if (status === 'READY' && order.order_type === 'Entrega' && !isIFood && order.uber_status === 'FAILED')
      actions.push(`<button data-uber-dispatch="${order.id}">Tentar solicitar Uber</button>`);
    if (status === 'READY' && order.order_type === 'Entrega' && isIFood && order.ifood_status === 'FAILED')
      actions.push(`<button data-ifood-dispatch="${order.id}">Tentar solicitar iFood</button>`);
    if (status === 'READY' && order.order_type === 'Entrega' && !order.uber_delivery_id &&
        !order.ifood_order_id && !['REQUESTING', 'REVIEW'].includes(logisticsStatus))
      actions.push(`<button class="reject" data-action="CANCEL_DELIVERY" data-id="${order.id}">Cancelar entrega e estornar</button>`);
    if (reviewing) actions.push(`<button class="reject" data-refund="${order.id}">Revisar estorno</button>`);
    return `
      <article class="order-card ${waiting ? 'urgent' : ''} ${reviewing ? 'review' : ''} ${demo ? 'demo-order' : ''}">
        <div class="order-top"><span class="order-id">#${esc(order.id.slice(0, 8).toUpperCase())}</span>
          <span class="status-tag ${waiting ? 'wait' : reviewing ? 'fail' : ''}">${esc(LABELS[status] || status)}</span></div>
        <div class="order-meta"><span>${formatDate(order.created_at)} · ${environment}</span><span>${esc(order.order_type)}</span></div>
        ${demo ? '<p class="order-demo-note">SIMULAÇÃO — pagamento fictício. Não preparar nem contabilizar como venda.</p>' : ''}
        <div class="order-customer">${esc(order.name)}</div>
        ${paymentInfo}
        <div class="order-extra">Telefone: ${esc(order.phone)}</div>
        <ul class="order-items">${items}</ul>
        <p class="order-extra">${scheduled}</p><div class="order-extra">${details}</div>${uber}
        <div class="order-footer"><strong class="order-total">${money(order.total_cents)}</strong>
          ${waiting ? `<span class="timer" data-deadline="${esc(order.acceptance_deadline || '')}">${deadlineRemaining(order.acceptance_deadline)}</span>` : ''}</div>
        ${order.refund_status !== 'NOT_REQUIRED' ? `<p class="order-extra">Estorno: ${esc(order.refund_status)}</p>` : ''}
        <div class="order-actions">${actions.join('')}</div>
      </article>`;
  }
  function renderOrders() {
    const pending = orders.filter(o => o.payment_status === 'PAID' &&
      ['AWAITING_ACCEPTANCE', 'SCHEDULED'].includes(o.fulfillment_status));
    const preparing = orders.filter(o => o.fulfillment_status === 'PREPARING');
    const ready = orders.filter(o => o.fulfillment_status === 'READY');
    const reviewing = orders.filter(o => o.refund_status === 'REVIEW');
    $('#stat-pending').textContent = pending.length;
    $('#stat-preparing').textContent = preparing.length;
    $('#stat-ready').textContent = ready.length;
    $('#stat-refunds').textContent = reviewing.length;
    $('#pending-count').textContent = pending.length;
    const priority = { AWAITING_ACCEPTANCE: 0, SCHEDULED: 1, PREPARING: 2, READY: 3,
      AWAITING_PAYMENT: 4, REJECTED: 5, AUTO_REJECTED: 5, COMPLETED: 6 };
    const sorted = [...orders].sort((a, b) => {
      const sa = a.payment_status === 'PAID' ? a.fulfillment_status : 'AWAITING_PAYMENT';
      const sb = b.payment_status === 'PAID' ? b.fulfillment_status : 'AWAITING_PAYMENT';
      return (priority[sa] ?? 9) - (priority[sb] ?? 9) ||
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    $('#orders-list').innerHTML = sorted.length
      ? sorted.map(orderCard).join('')
      : '<div class="empty-state">Nenhum pedido registrado ainda. A fila será atualizada automaticamente.</div>';
    const current = new Set(pending.map(o => o.id));
    if (!firstPoll && [...current].some(id => !lastPendingIds.has(id))) pingNewOrder();
    lastPendingIds = current;
    firstPoll = false;
  }
  async function loadOrders() {
    if (pollBusy || $('#dashboard-view').hidden) return;
    pollBusy = true;
    try {
      orders = (await api('/api/admin/orders')).orders || [];
      if (activeTab === 'orders') renderOrders();
      else $('#pending-count').textContent = orders.filter(o => o.payment_status === 'PAID' &&
        ['AWAITING_ACCEPTANCE', 'SCHEDULED'].includes(o.fulfillment_status)).length;
    } catch (error) {
      notify('Falha ao atualizar pedidos: ' + error.message, true);
    } finally { pollBusy = false; }
  }
  $('#orders-list').addEventListener('click', async event => {
    const action = event.target.closest('[data-action]');
    const refund = event.target.closest('[data-refund]');
    const dispatch = event.target.closest('[data-uber-dispatch]');
    const ifoodDispatch = event.target.closest('[data-ifood-dispatch]');
    if (!action && !refund && !dispatch && !ifoodDispatch) return;
    const id = action?.dataset.id || refund?.dataset.refund || dispatch?.dataset.uberDispatch ||
      ifoodDispatch?.dataset.ifoodDispatch;
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
  });
  $('#refresh-orders').addEventListener('click', loadOrders);
  function updateClock() {
    $('#clock').textContent = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(new Date());
    $$('[data-deadline]').forEach(node => node.textContent = deadlineRemaining(node.dataset.deadline));
  }
  setInterval(updateClock, 1000);
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
    const ready = Boolean(settings.asaasEnvironments?.[mode]?.configured && settings.paymentSystemAvailable);
    const status = $('#asaas-environment-status');
    status.textContent = ready
      ? 'Chave e webhook cadastrados — ambiente pronto para ativação.'
      : 'Ambiente ainda não configurado. Cadastre a API Key e o webhook no servidor antes de ativar.';
    status.classList.toggle('is-ready', ready);
    $('#asaas-risk-note').textContent = mode === 'sandbox'
      ? 'MODO TESTE: pedidos e pagamentos simulados, sem transferência real de dinheiro.'
      : 'ATENÇÃO: Produção realiza cobranças reais na conta vinculada à chave de produção.';
  }
  $('#settings-form').elements.paymentMode.addEventListener('change', updatePaymentEnvironment);
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

  async function switchTab(tab) {
    if (tab === 'users' && currentRole !== 'owner') return;
    activeTab = tab;
    $$('.main-nav button').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
    $$('.view').forEach(view => view.hidden = view.id !== `${tab}-view`);
    $('#view-title').textContent = ({ orders: 'Pedidos recebidos', products: 'Controle do cardápio',
      settings: 'Funcionamento do restaurante', users: 'Usuários e acessos' })[tab];
    try {
      if (tab === 'products') await loadCatalog();
      if (tab === 'settings') await loadSettings();
      if (tab === 'orders') await loadOrders();
      if (tab === 'users') await loadUsers();
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
