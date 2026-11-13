(() => {
  'use strict';
  const API = location.hostname === '127.0.0.1'
    ? (['8788','8789'].includes(location.port) ? location.origin : 'http://127.0.0.1:8787')
    : 'https://api.restaurantekipeixe.com.br';
  const $ = id => document.getElementById(id);
  const output = (id, data) => {
    let rendered = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    if (data && typeof data === 'object') {
      if ((id === 'ifood-outside-output' || id === 'ifood-inside-output') &&
          Object.prototype.hasOwnProperty.call(data, 'pickupCode')) {
        rendered = 'CÓDIGO DE RETIRADA (pickupCode): ' +
          (data.pickupCode || 'Não retornado pelo iFood') + '\n\n' + rendered;
      }
      if (id === 'ifood-hours-output') {
        const shifts = Array.isArray(data) ? data.flatMap(x => x.shifts || []) :
          data.shifts || data.configured?.shifts || [];
        const weekend = shifts.filter(x => x.dayOfWeek === 'SATURDAY' || x.dayOfWeek === 'SUNDAY')
          .sort((a, b) => a.dayOfWeek.localeCompare(b.dayOfWeek) || a.start.localeCompare(b.start));
        if (weekend.length) {
          const summary = weekend.map(x => {
            const minutes = Number(x.start.slice(0, 2)) * 60 + Number(x.start.slice(3, 5));
            const end = minutes + Number(x.duration);
            const pad = n => String(n).padStart(2, '0');
            return (x.dayOfWeek === 'SATURDAY' ? 'SÁBADO' : 'DOMINGO') +
              ': ' + x.start.slice(0, 5) + '–' + pad(Math.floor(end / 60)) + ':' + pad(end % 60);
          });
          rendered = 'HORÁRIOS DE FIM DE SEMANA\n' + summary.join('\n') + '\n\n' + rendered;
        }
      }
    }
    $(id).textContent = rendered;
  };
  // Local homologation console is already scoped to sandbox and requires an
  // ephemeral localhost session; avoid browser modal dialogs in recordings.
  const confirmAction = message => ['8788', '8789'].includes(location.port) || confirm(message);
  let configured = false;
  let busyPolling = false;
  let lastPollSummary = '';
  async function api(path, method = 'GET', body = null) {
    const response = await fetch(API + '/api/admin/ifood/' + path, {
      method, credentials: 'include', cache: 'no-store',
      headers: body == null ? {} : { 'Content-Type': 'application/json' },
      ...(body == null ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || 'iFood HTTP ' + response.status);
    return data;
  }
  async function act(path, method, body, target) {
    try {
      output(target, 'Enviando solicitação ao iFood...');
      const result = await api(path, method, body);
      output(target, result);
      return result;
    } catch (error) {
      output(target, 'Erro: ' + error.message);
      return null;
    }
  }
  const iso = value => new Date(value).toISOString();
  const form = name => Object.fromEntries(new FormData($(name)));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
  const displayTime = value => {
    const d = new Date(value);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  function prefillMerchantAddress(merchant) {
    const a = merchant?.address || {};
    const f = $('ifood-outside-form').elements;
    const set = (name, value) => { if (value !== undefined && value !== null && !f[name].value) f[name].value = value; };
    set('phone', '68999999999');
    set('postalCode', String(a.postalCode || '').replace(/\D/g, ''));
    set('streetName', a.streetName || a.street);
    set('streetNumber', a.streetNumber || a.number);
    set('neighborhood', a.neighborhood || a.district);
    set('city', a.city);
    set('state', a.state);
    set('latitude', Number(a.latitude) + 0.002);
    set('longitude', Number(a.longitude) + 0.002);
  }
  function printPauseList(data) {
    const items = Array.isArray(data) ? data : Array.isArray(data?.interruptions) ? data.interruptions : [];
    const root = $('ifood-pauses');
    root.replaceChildren();
    if (!items.length) { root.textContent = 'Nenhuma pausa cadastrada.'; return; }
    for (const item of items) {
      const article = document.createElement('article');
      const span = document.createElement('span');
      span.textContent = (item.description || 'Pausa') + ' — ' +
        (item.start || '') + ' até ' + (item.end || '');
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'danger-outline'; button.textContent = 'Remover';
      button.onclick = async () => {
        if (!confirmAction('Remover a pausa no Portal do Parceiro de testes?')) return;
        const result = await act('merchant/interruptions/' + encodeURIComponent(item.id),
          'DELETE', null, 'ifood-merchant-output');
        if (result) await showPauses(item.id, false);
      };
      article.append(span, button); root.appendChild(article);
    }
  }
  async function showPauses(expectId = null, present = true) {
    // The iFood test merchant can retain a just-removed interruption in GET
    // for minutes after DELETE 204. Keep checking the real API rather than
    // presenting the HTTP status alone as proof of removal.
    const maxAttempts = !expectId ? 1 : (present ? 40 : 120);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const result = await act('merchant/interruptions', 'GET', null, 'ifood-merchant-output');
      if (result) {
        printPauseList(result);
        const items = Array.isArray(result) ? result : result.interruptions || [];
        if (!expectId || items.some(item => item.id === expectId) === present) return;
      }
      await sleep(1500);
    }
    output('ifood-merchant-output', 'A API aceitou a alteração, mas o GET não confirmou ' +
      (present ? 'a presença após 60 segundos.' : 'a ausência após 180 segundos.'));
    if (expectId && present) {
      // The sandbox can return HTTP 201 and a pause ID while GET still returns [].
      // Keep an explicit cleanup action without presenting that ID as a listed pause.
      const root = $('ifood-pauses');
      const article = document.createElement('article');
      const label = document.createElement('span');
      label.textContent = 'Pausa ID ' + expectId + ' criada, mas não confirmada na listagem do iFood. ';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'danger-outline';
      button.textContent = 'Remover pausa pelo ID';
      button.addEventListener('click', async () => {
        if (!confirmAction('Remover a pausa recém-criada pelo ID retornado pela API?')) return;
        const result = await act('merchant/interruptions/' + encodeURIComponent(expectId),
          'DELETE', null, 'ifood-merchant-output');
        if (result) await showPauses(expectId, false);
      });
      article.append(label, button);
      root.replaceChildren(article);
    }
  }
  async function poll() {
    if (!configured || busyPolling) return;
    busyPolling = true;
    try {
      const result = await api('events/poll', 'POST');
      if (!result.skipped) {
        lastPollSummary = 'Consulta realizada às ' + new Date(result.polledAt).toLocaleTimeString('pt-BR') +
          '. Novos: ' + result.newEvents + ', duplicados: ' + result.duplicates +
          ', reconhecidos pelo iFood: ' + (result.acknowledged || 0) + '.';
      }
      $('ifood-poll-state').textContent = result.skipped
        ? 'Aguarde 30 segundos para a próxima consulta. ' + lastPollSummary
        : lastPollSummary;
      output('ifood-events-output', (await api('events')).events || []);
    } catch (error) {
      $('ifood-poll-state').textContent = 'Falha no polling: ' + error.message;
    } finally { busyPolling = false; }
  }
  async function load() {
    const status = $('ifood-ops-status');
    try {
      const config = await api('config');
      configured = Boolean(config.configured);
      status.textContent = configured
        ? 'Aplicativo de teste conectado. Operações reais no ambiente de homologação.'
        : 'Credenciais de teste ausentes ou ambiente local desativado. Operações bloqueadas.';
      $('ifood-ops-client').textContent = configured
        ? 'Client ID: ' + config.clientId + ' | Loja de teste: ' + config.merchantId
        : 'Configure IFOOD_TEST_CLIENT_ID, IFOOD_TEST_CLIENT_SECRET e IFOOD_TEST_MERCHANT_ID apenas no Worker local.';
      document.querySelectorAll('#ifood-view button[data-ifood], #ifood-view form button')
        .forEach(button => { button.disabled = !configured; });
      if (!configured) return;
      const details = await act('merchant', 'GET', null, 'ifood-merchant-output');
      if (details) prefillMerchantAddress(details);
      // On the dedicated 8789 recording console, only the visible operator
      // click should start polling. Otherwise an unseen intro tab can consume
      // and acknowledge sandbox events before full-screen recording begins.
      if (location.port !== '8789') await poll();
    } catch (error) { status.textContent = 'Erro: ' + error.message; configured = false; }
  }
  async function action(name) {
    if (!configured) return;
    const inside = form('ifood-inside-form');
    const outside = form('ifood-outside-form');
    const address = form('ifood-address-form');
    const cancel = form('ifood-cancel-form');
    const merchant = 'ifood-merchant-output';
    if (name === 'merchants') return act('merchants', 'GET', null, merchant);
    if (name === 'merchant') {
      const data = await act('merchant', 'GET', null, merchant);
      if (data) prefillMerchantAddress(data);
      return data;
    }
    if (name === 'status') return act('merchant/status', 'GET', null, merchant);
    if (name === 'pauses') return showPauses();
    if (name === 'hours') return act('merchant/hours', 'GET', null, 'ifood-hours-output');
    if (name === 'hours-update') {
      if (!confirmAction('Aplicar os quatro turnos de sábado e domingo na loja iFood de testes?')) return;
      const data = await act('merchant/hours/weekend-checklist', 'PUT', {},
        'ifood-hours-output');
      if (data) {
        const expected = data.configured?.shifts || [];
        const key = s => [s.dayOfWeek, s.start, Number(s.duration)].join('|');
        let lastActual = null;
        for (let attempt = 0; attempt < 15; attempt++) {
          const actual = await act('merchant/hours', 'GET', null, 'ifood-hours-output');
          lastActual = actual;
          const shifts = Array.isArray(actual) ? actual.flatMap(item => item.shifts || []) :
            actual?.shifts || [];
          if (expected.length && expected.length === shifts.length &&
              expected.every(item => shifts.some(s => key(item) === key(s)))) {
            output('ifood-hours-output', {
              validated: true, readbackAfterAttempts: attempt + 1,
              shifts: actual?.shifts || shifts,
            });
            return;
          }
          await sleep(1500);
        }
        const observed = Array.isArray(lastActual) ? lastActual.flatMap(item => item.shifts || []) :
          lastActual?.shifts || [];
        output('ifood-hours-output', {
          validated: false,
          warning: 'A API aceitou o PUT, mas o GET não confirmou a configuração após 15 consultas.',
          requested: expected.map(key), observed: observed.map(key),
        });
      }
      return;
    }
    if (name === 'poll') return poll();
    if (['inside-confirm', 'inside-quote', 'inside-request', 'inside-details'].includes(name)) {
      if (!uuid(inside.orderId)) { output('ifood-inside-output', 'Informe o UUID do pedido de teste.'); return; }
      if (name === 'inside-confirm') {
        if (!confirmAction('Confirmar este pedido FOOD no ambiente de testes do iFood?')) return;
        return act('inside/confirm', 'POST', { orderId: inside.orderId }, 'ifood-inside-output');
      }
      if (name === 'inside-quote') {
        const data = await act('inside/quote', 'POST', { orderId: inside.orderId }, 'ifood-inside-output');
        if (data?.id) $('ifood-inside-form').elements.quoteId.value = data.id;
      }
      if (name === 'inside-request') {
        if (!uuid(inside.quoteId)) return output('ifood-inside-output', 'Consulte a cotação primeiro.');
        if (!confirmAction('Solicitar entregador iFood para este pedido de teste?')) return;
        return act('inside/request-driver', 'POST', { orderId: inside.orderId, quoteId: inside.quoteId },
          'ifood-inside-output');
      }
      if (name === 'inside-details') return act('orders/' + inside.orderId + '/details', 'GET',
        null, 'ifood-inside-output');
    }
    if (['outside-quote', 'outside-create'].includes(name)) {
      const a = { postalCode: outside.postalCode, streetName: outside.streetName,
        streetNumber: outside.streetNumber, neighborhood: outside.neighborhood,
        city: outside.city, state: outside.state,
        latitude: Number(outside.latitude), longitude: Number(outside.longitude) };
      if (name === 'outside-quote') {
        const data = await act('outside/quote', 'POST', a, 'ifood-outside-output');
        if (data) {
          $('ifood-outside-form').elements.quoteId.value = data.externalQuoteId;
          $('ifood-outside-form').elements.fee.value = (data.feeCents / 100).toFixed(2);
        }
      }
      if (name === 'outside-create') {
        if (!$('ifood-outside-form').reportValidity()) return;
        if (!uuid(outside.quoteId)) return output('ifood-outside-output', 'Consulte a disponibilidade antes de criar o pedido.');
        if (!confirmAction('Criar pedido real de teste e solicitar logística no iFood?')) return;
        const data = await act('outside/create', 'POST',
          { name: outside.name, phone: outside.phone, quoteId: outside.quoteId,
            address: a, items: [{ name: outside.itemName, quantity: Number(outside.itemQty),
              unitPrice: Number(outside.itemPrice) }] }, 'ifood-outside-output');
        if (data?.id) {
          $('ifood-outside-form').elements.orderId.value = data.id;
          const f = $('ifood-address-form').elements;
          f.orderId.value = data.id;
          for (const field of ['postalCode', 'streetName', 'streetNumber',
            'neighborhood', 'city', 'state']) f[field].value = a[field];
          f.streetNumber.value = String(Number(a.streetNumber) + 1 || a.streetNumber);
          f.latitude.value = Number((a.latitude + 0.0001).toFixed(6));
          f.longitude.value = Number((a.longitude + 0.0001).toFixed(6));
          $('ifood-cancel-form').elements.orderId.value = data.id;
          if (data.trackingUrl) {
            const link = $('ifood-test-tracking');
            link.href = data.trackingUrl;
            link.hidden = false;
          }
        }
      }
    }
    if (name === 'outside-details') {
      if (!uuid(outside.orderId))
        return output('ifood-outside-output', 'Crie um pedido de teste antes de consultar os detalhes.');
      return act('orders/' + outside.orderId + '/details', 'GET', null, 'ifood-outside-output');
    }
    if (name === 'address-request') {
      if (!uuid(address.orderId)) return output('ifood-address-output', 'ID de pedido inválido.');
      if (!$('ifood-address-form').reportValidity()) return;
      if (!confirmAction('Solicitar alteração de endereço real para o pedido de testes?')) return;
      return act('orders/' + address.orderId + '/address/request', 'POST', {
        address: { postalCode: address.postalCode, streetName: address.streetName,
          streetNumber: address.streetNumber, neighborhood: address.neighborhood,
          city: address.city, state: address.state, latitude: Number(address.latitude),
          longitude: Number(address.longitude) },
      }, 'ifood-address-output');
    }
    if (['address-accept', 'address-deny'].includes(name)) {
      if (!uuid(address.orderId)) return output('ifood-address-output', 'ID de pedido inválido.');
      if (!confirmAction((name === 'address-accept' ? 'Aceitar' : 'Negar') + ' alteração de endereço do pedido de teste?')) return;
      return act('orders/' + address.orderId + '/address/' +
        (name === 'address-accept' ? 'accept' : 'deny'), 'POST', {}, 'ifood-address-output');
    }
    if (name === 'cancel-reasons') {
      if (!uuid(cancel.orderId)) return output('ifood-cancel-output', 'Informe o ID do pedido externo.');
      let list = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        list = await act('orders/' + cancel.orderId + '/cancellation-reasons', 'GET',
          null, 'ifood-cancel-output');
        if (Array.isArray(list) && list.length) break;
        await sleep(1500);
      }
      const select = $('ifood-cancel-form').elements.cancellationCode;
      select.replaceChildren(new Option('Escolha um motivo', ''));
      if (Array.isArray(list)) list.forEach(r =>
        select.add(new Option(r.description || r.cancelCodeId, String(r.cancelCodeId))));
    }
  }
  document.querySelectorAll('#ifood-view [data-ifood]').forEach(button =>
    button.addEventListener('click', () => action(button.dataset.ifood)));
  $('ifood-pause-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!configured) return;
    const data = form('ifood-pause-form');
    if (!confirmAction('Criar uma interrupção real na loja de testes?')) return;
    const created = await act('merchant/interruptions', 'POST',
      { description: data.description, start: iso(data.start), end: iso(data.end) },
      'ifood-merchant-output');
    if (created) await showPauses(created.id, true);
  });
  $('ifood-cancel-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!configured) return;
    const data = form('ifood-cancel-form');
    if (!uuid(data.orderId) || !data.cancellationCode) return;
    if (!confirmAction('Cancelar este pedido de teste no iFood?')) return;
    await act('orders/' + data.orderId + '/cancel', 'POST',
      { cancellationCode: Number(data.cancellationCode), reason: data.reason },
      'ifood-cancel-output');
  });
  const now = Date.now();
  $('ifood-pause-form').elements.start.value = displayTime(now + 5 * 60_000);
  $('ifood-pause-form').elements.end.value = displayTime(now + 35 * 60_000);
  setInterval(() => {
    if (configured && !$('ifood-view').hidden) poll();
  }, 30_000);
  window.ifoodOps = { load };
})();
