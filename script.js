(() => {
  const MENU = Array.isArray(window.KIPEIXE_MENU) ? window.KIPEIXE_MENU : [];
  const WHATSAPP = '554535772363';
  const VALID_PAGES = new Set(['inicio', 'cardapio', 'ambiente', 'pesque', 'contato']);
  const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

  const year = qs('[data-year]');
  if (year) year.textContent = new Date().getFullYear();

  const normalize = (value = '') =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

  const safeStorage = {
    get(key, fallback) {
      try {
        const parsed = JSON.parse(localStorage.getItem(key));
        return parsed ?? fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
    }
  };

  const pageNodes = qsa('[data-page]');
  const tabLinks = qsa('[data-page-link]');

  const hashPage = () => {
    const candidate = location.hash.replace(/^#/, '').split('/')[0];
    return VALID_PAGES.has(candidate) ? candidate : 'inicio';
  };

  const setPage = (page, updateHash = true) => {
    if (!VALID_PAGES.has(page)) page = 'inicio';
    pageNodes.forEach((node) => {
      const active = node.dataset.page === page;
      node.hidden = !active;
      node.classList.toggle('is-active', active);
    });
    tabLinks.forEach((button) => {
      button.classList.toggle('is-active', button.dataset.pageLink === page);
      if (button.dataset.pageLink === page) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (updateHash && location.hash !== `#${page}`) history.pushState({}, '', `#${page}`);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const cartDrawer = qs('[data-cart-drawer]');

  function closeCart() {
    cartDrawer?.classList.remove('is-open');
    cartDrawer?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('cart-open');
  }

  const menuCover = qs('[data-menu-cover]');
  const menuInside = qs('[data-menu-inside]');
  const menuItems = qs('[data-menu-items]');
  const categoryTabs = qs('[data-category-tabs]');
  const categoryTitle = qs('[data-category-title]');
  const categoryEyebrow = qs('[data-category-eyebrow]');
  const categoryImage = qs('[data-category-image]');
  const pageNumber = qs('[data-page-number]');
  const categoryProgress = qs('[data-category-progress]');
  const prevCategory = qs('[data-category-prev]');
  const nextCategory = qs('[data-category-next]');
  const bookPage = qs('.book-page');
  const categoryPhotoZoom = qs('[data-category-photo-zoom]');
  const photoLightbox = qs('[data-photo-lightbox]');
  const photoLightboxImage = qs('[data-photo-lightbox-image]');
  const photoTitle = qs('[data-photo-title]');
  let currentCategory = 0;
  const MENU_ASSET_VERSION = '20261009-7';
  const FALLBACK_DISH_IMAGE = 'assets/produtos/prato-completo.webp';
  const versionAsset = (path) => path
    ? `${path}${path.includes('?') ? '&' : '?'}v=${MENU_ASSET_VERSION}`
    : '';

  const localProductImage = (file) => `assets/produtos/${file}.webp`;
  const onlineProductImage = (file) => `assets/produtos/online/${file}.webp`;
  const pexelsProductImage = (id) => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=900`;
  const commonsProductImage = (file) => `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(file)}?width=900`;

  const categoryImages = {
    peixes: localProductImage('tilapia-vinagrete'),
    carnes: localProductImage('carne'),
    frango: localProductImage('frango'),
    porcoes: localProductImage('porcao-peixe'),
    saladas: localProductImage('salada'),
    lanches: onlineProductImage('cheeseburger'),
    bebidas: pexelsProductImage('12946714'),
    sucos: onlineProductImage('orange-juice'),
    vinhos: pexelsProductImage('9149107'),
    coqueteis: onlineProductImage('mojito')
  };

  // Mapeamento auditado item por item. Se não há foto realmente compatível,
  // o item fica sem miniatura em vez de exibir outro produto ou outra marca.
  const ITEM_PHOTOS = {
    "peixes|tilapia a milanesa": localProductImage('tilapia-milanesa'),
    "peixes|tilapia grelhada": onlineProductImage('grilled-fish'),
    "peixes|tilapia a parmegiana": '',
    "peixes|tilapia a dore": onlineProductImage('fried-fish-fillets'),
    "peixes|tilapia a brasileira": '',
    "peixes|camarao a milanesa": onlineProductImage('fried-shrimp'),
    "peixes|surubi grelhado": onlineProductImage('grilled-fish'),
    "peixes|surubi a milanesa": onlineProductImage('fried-fish-fillets'),
    "peixes|salmao ao molho fino": pexelsProductImage('31043029'),
    "peixes|sashimi completo": '',
    "peixes|tilapia a vinagrete": localProductImage('tilapia-vinagrete'),
    "peixes|sinfonia de kipeixe": onlineProductImage('brazilian-seafood'),
    "carnes|bisteca de porco": onlineProductImage('pork-chop'),
    "carnes|bisteca de porco a tropeira": onlineProductImage('pork-chop'),
    "carnes|bistecao a moda da casa": localProductImage('carne'),
    "carnes|file mignon a milanesa": pexelsProductImage('37389030'),
    "carnes|file mignon a parana": '',
    "carnes|file mignon a parmegiana": commonsProductImage("Bife a parmegiana com arroz e batata frita.jpg"),
    "carnes|file mignon com fritas": localProductImage('carne'),
    "carnes|picanha completa": localProductImage('carne'),
    "frango|frango grelhado": localProductImage('frango'),
    "frango|frango a milanesa": pexelsProductImage('33755321'),
    "frango|frango a passarinho": onlineProductImage('fried-chicken'),
    "frango|espaguete a bolonhesa": onlineProductImage('spaghetti-bolognese'),
    "frango|espaguete alho e oleo": onlineProductImage('spaghetti-aglio-olio'),
    "porcoes|tilapia": localProductImage('porcao-peixe'),
    "porcoes|tilapia em postas": localProductImage('porcao-peixe'),
    "porcoes|pacu em postas": localProductImage('porcao-peixe'),
    "porcoes|surubi": localProductImage('porcao-peixe'),
    "porcoes|camarao": onlineProductImage('fried-shrimp'),
    "porcoes|picanha": localProductImage('carne'),
    "porcoes|file mignon": localProductImage('carne'),
    "porcoes|calabresa": '',
    "porcoes|frango a passarinho": onlineProductImage('fried-chicken'),
    "porcoes|banana a milanesa": onlineProductImage('fried-banana'),
    "porcoes|bolinho de bacalhau": commonsProductImage("Bolinho de Bacalhau.jpg"),
    "porcoes|feijao": pexelsProductImage('8479384'),
    "porcoes|lambari": onlineProductImage('small-fried-fish'),
    "porcoes|batata frita": onlineProductImage('fries'),
    "porcoes|polenta": commonsProductImage("Polenta fritta da sgranocchiare.jpg"),
    "porcoes|mandioca": onlineProductImage('cassava-fries'),
    "porcoes|arroz": pexelsProductImage('8923092'),
    "porcoes|farofa": commonsProductImage("Farofa brazil.jpg"),
    "porcoes|pirao": localProductImage('pirao'),
    "porcoes|creme de alho": pexelsProductImage('6129134'),
    "porcoes|molho rose": '',
    "porcoes|molho tartaro": onlineProductImage('tartar-sauce'),
    "porcoes|vinagrete": localProductImage('vinagrete'),
    "saladas|palmito": '',
    "saladas|maionese pequena": onlineProductImage('potato-salad'),
    "saladas|maionese grande": onlineProductImage('potato-salad'),
    "saladas|salada mista pequena": onlineProductImage('mixed-salad'),
    "saladas|salada mista media": onlineProductImage('mixed-salad'),
    "saladas|salada mista grande": onlineProductImage('mixed-salad'),
    "lanches|x-salada": pexelsProductImage('6045440'),
    "lanches|x-burguer": onlineProductImage('cheeseburger'),
    "lanches|x-egg": pexelsProductImage('2293537'),
    "lanches|x-bacon": pexelsProductImage('3826320'),
    "lanches|x-tudo": onlineProductImage('bacon-egg-burger'),
    "lanches|x-frango": onlineProductImage('chicken-burger'),
    "lanches|x-calabresa": pexelsProductImage('18396045'),
    "bebidas|antarctica original": pexelsProductImage('12946714'),
    "bebidas|spaten": pexelsProductImage('12946714'),
    "bebidas|amstel": pexelsProductImage('12946714'),
    "bebidas|skol": pexelsProductImage('12946714'),
    "bebidas|malzbier": pexelsProductImage('12946714'),
    "bebidas|heineken": pexelsProductImage('12946714'),
    "bebidas|heineken zero": pexelsProductImage('12946714'),
    "bebidas|refrigerantes": pexelsProductImage('20045266'),
    "bebidas|agua sem gas": onlineProductImage('water'),
    "bebidas|agua com gas": onlineProductImage('sparkling-water'),
    "bebidas|agua tonica": onlineProductImage('sparkling-water'),
    "bebidas|agua h2o": onlineProductImage('sparkling-water'),
    "sucos|abacaxi": onlineProductImage('pineapple-juice'),
    "sucos|acerola": onlineProductImage('acerola-juice'),
    "sucos|laranja": onlineProductImage('orange-juice'),
    "sucos|limao": onlineProductImage('lime-juice'),
    "sucos|manga": onlineProductImage('mango-juice'),
    "sucos|maracuja": onlineProductImage('passionfruit-juice'),
    "sucos|morango": onlineProductImage('strawberry-juice'),
    "sucos|uva": pexelsProductImage('12987518'),
    "sucos|suco no copo": pexelsProductImage('7656390'),
    "sucos|adicional de leite": onlineProductImage('milk'),
    "sucos|adicional de fruta": onlineProductImage('mixed-fruit'),
    "vinhos|120 santa rita sauvignon blanc": pexelsProductImage('5732813'),
    "vinhos|casa amada carmenere": pexelsProductImage('9149107'),
    "vinhos|casillero del diablo red blend": pexelsProductImage('9149107'),
    "vinhos|estacao 36 bordo demi-sec": pexelsProductImage('9149107'),
    "vinhos|jarra de vinho": pexelsProductImage('9149107'),
    "vinhos|reservado cabernet sauvignon": pexelsProductImage('9149107'),
    "vinhos|reservado malbec": pexelsProductImage('9149107'),
    "vinhos|santa veronica cabernet sauvignon": pexelsProductImage('9149107'),
    "vinhos|santa veronica malbec alta reserve": pexelsProductImage('9149107'),
    "vinhos|taca de vinho": pexelsProductImage('9149107'),
    "coqueteis|bergamo": pexelsProductImage('8679432'),
    "coqueteis|pina colada": onlineProductImage('pina-colada'),
    "coqueteis|daiquiri de morango": onlineProductImage('strawberry-daiquiri'),
    "coqueteis|freyr": '',
    "coqueteis|gin tonica mediterraneo": onlineProductImage('gin-tonic'),
    "coqueteis|gin tonica tradicional": onlineProductImage('gin-tonic'),
    "coqueteis|mojito": onlineProductImage('mojito'),
    "coqueteis|rubro mojito": pexelsProductImage('30412118'),
    "coqueteis|caipirinha bacardi": pexelsProductImage('13059626'),
    "coqueteis|caipirinha cachaca": pexelsProductImage('13059626'),
    "coqueteis|caipirinha steinhager": pexelsProductImage('13059626'),
    "coqueteis|caipirinha vodka": pexelsProductImage('13059626'),
    "coqueteis|caipirinha vodka smirnoff": pexelsProductImage('13059626'),
    "coqueteis|caipirinha vodka com fruta": pexelsProductImage('13059626'),
    "coqueteis|adicional de frutas": onlineProductImage('mixed-fruit'),
  };

  const itemImage = (name, categoryId) =>
    ITEM_PHOTOS[`${categoryId}|${normalize(name)}`] ?? '';

  const escapeHtml = (text = '') =>
    String(text)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');

  const makeItemId = (name, variant = '') => `${normalize(name)}|${normalize(variant)}`;

  const renderMenuTabs = () => {
    if (!categoryTabs) return;
    categoryTabs.innerHTML = MENU.map((category, index) => `
      <button
        type="button"
        class="${index === currentCategory ? 'is-active' : ''}"
        data-category-index="${index}"
        aria-pressed="${index === currentCategory ? 'true' : 'false'}"
      >${escapeHtml(category.title)}</button>
    `).join('');
  };

  const renderMenuItem = (item, category) => {
    let actions = '';

    if (Array.isArray(item.variants) && item.variants.length) {
      actions = `
        <div class="variant-list">
          ${item.variants.map((variant) => `
            <button
              type="button"
              class="variant-button"
              data-add-item
              data-name="${escapeHtml(item.name)}"
              data-variant="${escapeHtml(variant.label || 'Opção')}"
              data-price="${variant.price}"
            >${escapeHtml(variant.label || 'Opção')} · ${currency.format(variant.price)}</button>
          `).join('')}
        </div>
      `;
    } else if (Number.isFinite(item.price)) {
      actions = `
        <div class="menu-entry-actions">
          <span class="menu-entry-price">${currency.format(item.price)}</span>
          <button
            type="button"
            class="add-button"
            data-add-item
            data-name="${escapeHtml(item.name)}"
            data-variant=""
            data-price="${item.price}"
          >+ Adicionar</button>
        </div>
      `;
    } else {
      actions = '<span class="consult-price">Consulte</span>';
    }

    return `
      <article class="menu-entry">
        <div class="menu-entry-main">
          <h4>${escapeHtml(item.name)}</h4>
          ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}
        </div>
        ${actions}
      </article>
    `;
  };

  const renderCategory = (index, animate = true) => {
    if (!MENU.length || !menuItems) return;
    currentCategory = Math.max(0, Math.min(MENU.length - 1, index));
    const category = MENU[currentCategory];

    categoryTitle.textContent = category.title;
    categoryEyebrow.textContent = category.eyebrow || 'Cardápio Kipeixe';
    pageNumber.textContent = String(currentCategory + 1).padStart(2, '0');
    categoryProgress.textContent = `${currentCategory + 1} / ${MENU.length}`;
    menuItems.innerHTML = category.items.map((item) => renderMenuItem(item, category)).join('');

    prevCategory.disabled = currentCategory === 0;
    nextCategory.disabled = currentCategory === MENU.length - 1;
    renderMenuTabs();

    if (animate && bookPage && bookPage.animate) {
      bookPage.animate(
        [
          { opacity: .35, transform: 'translateX(10px)' },
          { opacity: 1, transform: 'translateX(0)' }
        ],
        { duration: 210, easing: 'ease-out' }
      );
    }

    if (window.innerWidth < 761) {
      const active = qs('[data-category-index].is-active', categoryTabs);
      active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  };

  document.addEventListener('error', (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    if (!image.matches('.menu-entry-photo, [data-category-image]')) return;
    if (image.dataset.fallbackApplied === 'true') return;

    image.dataset.fallbackApplied = 'true';
    const fallbackSrc = versionAsset(FALLBACK_DISH_IMAGE);
    image.src = fallbackSrc;

    const zoomTrigger = image.closest('[data-photo-zoom]')
      || (image.matches('[data-category-image]') ? categoryPhotoZoom : null);
    if (zoomTrigger) zoomTrigger.dataset.photoSrc = fallbackSrc;
  }, true);

  categoryTabs?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-category-index]');
    if (!button) return;
    renderCategory(Number(button.dataset.categoryIndex));
  });
  prevCategory?.addEventListener('click', () => renderCategory(currentCategory - 1));
  nextCategory?.addEventListener('click', () => renderCategory(currentCategory + 1));

  function openMenu() {
    if (!menuCover || !menuInside) return;
    menuCover.hidden = true;
    menuInside.hidden = false;
    renderCategory(currentCategory, false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const closeMenu = () => {
    if (!menuCover || !menuInside) return;
    menuInside.hidden = true;
    menuCover.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openPhoto = (src, name = '') => {
    if (!photoLightbox || !photoLightboxImage || !src) return;
    photoLightboxImage.src = src;
    photoLightboxImage.alt = name ? `Foto ampliada de ${name}` : 'Foto ampliada do prato';
    if (photoTitle) photoTitle.textContent = name || 'Prato do Kipeixe';
    photoLightbox.classList.add('is-open');
    photoLightbox.setAttribute('aria-hidden', 'false');
    document.body.classList.add('photo-open');
    qs('[data-photo-close]', photoLightbox)?.focus({ preventScroll: true });
  };

  const closePhoto = () => {
    if (!photoLightbox) return;
    photoLightbox.classList.remove('is-open');
    photoLightbox.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('photo-open');
  };

  document.addEventListener('click', (event) => {
    const zoomTrigger = event.target.closest('[data-photo-zoom]');
    if (zoomTrigger) {
      event.preventDefault();
      openPhoto(zoomTrigger.dataset.photoSrc, zoomTrigger.dataset.photoName);
      return;
    }

    if (event.target.closest('[data-photo-close]')) closePhoto();
  });

  qs('[data-menu-open]')?.addEventListener('click', openMenu);
  qs('[data-menu-close]')?.addEventListener('click', closeMenu);

  tabLinks.forEach((button) => {
    button.addEventListener('click', () => {
      closeCart();
      setPage(button.dataset.pageLink);
      if (button.hasAttribute('data-open-menu')) openMenu();
    });
  });

  window.addEventListener('popstate', () => setPage(hashPage(), false));
  setPage(hashPage(), false);

  let cart = safeStorage.get('kipeixe_cart_v1', []);
  if (!Array.isArray(cart)) cart = [];

  const cartItems = qs('[data-cart-items]');
  const cartEmpty = qs('[data-cart-empty]');
  const cartCheckout = qs('[data-cart-checkout]');
  const cartTotal = qs('[data-cart-total]');
  const quickCheckout = qs('[data-quick-checkout]');
  const quickCount = qs('[data-quick-count]');
  const quickTotal = qs('[data-quick-total]');
  const orderForm = qs('[data-order-form]');
  const orderType = qs('[data-order-type]');
  const orderChoices = qsa('[data-order-choice]');
  const addressField = qs('[data-address-field]');
  const notesStep = qs('[data-notes-step]');
  const nameError = qs('[data-name-error]');
  const addressError = qs('[data-address-error]');

  function openCart() {
    cartDrawer?.classList.add('is-open');
    cartDrawer?.setAttribute('aria-hidden', 'false');
    document.body.classList.add('cart-open');
  }

  const cartCount = () => cart.reduce((sum, item) => sum + item.qty, 0);
  const cartValue = () => cart.reduce((sum, item) => sum + item.price * item.qty, 0);

  const renderCart = () => {
    const count = cartCount();
    qsa('[data-cart-count]').forEach((node) => { node.textContent = count; });
    document.body.classList.toggle('has-cart-items', count > 0);
    if (quickCheckout) {
      quickCheckout.hidden = count === 0;
      const itemLabel = `${count} ${count === 1 ? 'item' : 'itens'} no pedido`;
      const totalLabel = currency.format(cartValue());
      if (quickCount) quickCount.textContent = itemLabel;
      if (quickTotal) quickTotal.textContent = totalLabel;
      quickCheckout.setAttribute('aria-label', `Finalizar pedido. ${itemLabel}. Total ${totalLabel}`);
    }
    safeStorage.set('kipeixe_cart_v1', cart);

    if (!cartItems || !cartEmpty || !cartCheckout) return;
    cartEmpty.hidden = count > 0;
    cartCheckout.hidden = count === 0;
    if (cartTotal) cartTotal.textContent = currency.format(cartValue());

    cartItems.innerHTML = cart.map((item) => `
      <article class="cart-row" data-cart-id="${escapeHtml(item.id)}">
        <div>
          <strong>${escapeHtml(item.name)}</strong>
          ${item.variant ? `<small>${escapeHtml(item.variant)}</small>` : ''}
          <div class="qty-controls">
            <button type="button" data-qty-minus aria-label="Diminuir quantidade">−</button>
            <span>${item.qty}</span>
            <button type="button" data-qty-plus aria-label="Aumentar quantidade">+</button>
          </div>
        </div>
        <div class="cart-row-price">${currency.format(item.price * item.qty)}</div>
      </article>
    `).join('');
  };

  const addItem = (name, variant, price) => {
    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice)) return;
    const id = makeItemId(name, variant);
    const existing = cart.find((entry) => entry.id === id);
    if (existing) existing.qty += 1;
    else cart.push({ id, name, variant, price: numericPrice, qty: 1 });
    renderCart();
    if (quickCheckout && !quickCheckout.hidden) {
      quickCheckout.classList.remove('is-pulsing');
      void quickCheckout.offsetWidth;
      quickCheckout.classList.add('is-pulsing');
    }
  };

  menuItems?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-add-item]');
    if (!button) return;
    addItem(button.dataset.name, button.dataset.variant, button.dataset.price);
    const original = button.textContent;
    button.textContent = 'Adicionado ✓';
    setTimeout(() => { button.textContent = original; }, 850);
  });

  qsa('[data-cart-open]').forEach((button) => button.addEventListener('click', openCart));
  quickCheckout?.addEventListener('click', () => {
    openCart();
    qs('.cart-total', cartCheckout)?.scrollIntoView({ block: 'start', behavior: 'instant' });
  });
  qsa('[data-cart-close]').forEach((button) => button.addEventListener('click', closeCart));

  cartItems?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-cart-id]');
    if (!row) return;
    const item = cart.find((entry) => entry.id === row.dataset.cartId);
    if (!item) return;
    if (event.target.closest('[data-qty-plus]')) item.qty += 1;
    if (event.target.closest('[data-qty-minus]')) item.qty -= 1;
    cart = cart.filter((entry) => entry.qty > 0);
    renderCart();
  });

  const syncAddressField = () => {
    if (!orderType || !addressField) return;
    const delivery = orderType.value === 'Entrega';
    addressField.hidden = !delivery;
    const input = qs('input', addressField);
    if (!delivery && input) {
      input.removeAttribute('aria-invalid');
      if (addressError) addressError.hidden = true;
    }
    if (notesStep) notesStep.textContent = delivery ? '04' : '03';
  };

  const setFieldError = (input, errorNode, messageVisible) => {
    if (!input || !errorNode) return;
    errorNode.hidden = !messageVisible;
    if (messageVisible) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };

  orderChoices.forEach((button) => {
    button.addEventListener('click', () => {
      if (!orderType) return;
      orderType.value = button.dataset.orderChoice || 'Retirada no Kipeixe';
      orderChoices.forEach((choice) => {
        const selected = choice === button;
        choice.classList.toggle('is-selected', selected);
        choice.setAttribute('aria-checked', selected ? 'true' : 'false');
      });
      syncAddressField();
    });
  });
  syncAddressField();

  const nameInput = qs('input[name="name"]', orderForm);
  const addressInput = qs('input[name="address"]', orderForm);

  nameInput?.addEventListener('input', () => {
    if (nameInput.value.trim()) setFieldError(nameInput, nameError, false);
  });
  addressInput?.addEventListener('input', () => {
    if (addressInput.value.trim()) setFieldError(addressInput, addressError, false);
  });

  orderForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(orderForm);
    const name = String(data.get('name') || '').trim();
    const type = String(data.get('type') || '').trim();
    const address = String(data.get('address') || '').trim();
    const notes = String(data.get('notes') || '').trim();
    const needsAddress = type === 'Entrega';
    const nameInvalid = !name;
    const addressInvalid = needsAddress && !address;

    setFieldError(nameInput, nameError, nameInvalid);
    setFieldError(addressInput, addressError, addressInvalid);

    if (!cart.length || nameInvalid || addressInvalid) {
      const target = nameInvalid ? nameInput : addressInvalid ? addressInput : null;
      target?.focus({ preventScroll: true });
      target?.closest('.checkout-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const lines = [
      'Olá! Quero fazer este pedido pelo site do Kipeixe:',
      '',
      '*PEDIDO*',
      ...cart.map((item) => {
        const label = item.variant ? `${item.name} (${item.variant})` : item.name;
        return `• ${item.qty}x ${label} — ${currency.format(item.price * item.qty)}`;
      }),
      '',
      `*Total estimado:* ${currency.format(cartValue())}`,
      `*Nome:* ${name}`,
      `*Tipo:* ${type}`
    ];

    if (type === 'Entrega' && address) lines.push(`*Endereço:* ${address}`);
    if (notes) lines.push(`*Observações:* ${notes}`);
    lines.push('', 'Aguardo a confirmação do pedido. Obrigado!');

    const url = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(lines.join('\n'))}`;
    window.location.href = url;
  });

  renderMenuTabs();
  renderCategory(0, false);
  renderCart();

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closePhoto();
      closeCart();
    }
  });
})();
