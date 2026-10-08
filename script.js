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
  const MENU_ASSET_VERSION = '20261006-4';
  const FALLBACK_DISH_IMAGE = 'assets/produtos/prato-completo.webp';
  const versionAsset = (path) => path
    ? `${path}${path.includes('?') ? '&' : '?'}v=${MENU_ASSET_VERSION}`
    : '';

  const categoryImages = {
    peixes: 'assets/produtos/tilapia-vinagrete.webp',
    carnes: 'assets/produtos/carne.webp',
    frango: 'assets/produtos/frango.webp',
    porcoes: 'assets/produtos/porcao-peixe.webp',
    saladas: 'assets/produtos/salada.webp',
    lanches: 'assets/produtos/burger.webp',
    bebidas: 'assets/produtos/drink.webp',
    sucos: 'assets/produtos/drink.webp',
    vinhos: 'assets/produtos/drink.webp',
    coqueteis: 'assets/produtos/drink.webp'
  };

  const itemImage = (name, categoryId) => {
    const n = normalize(name);
    if (n === 'tilapia a milanesa') return 'assets/produtos/tilapia-milanesa.webp';
    if (n === 'tilapia a vinagrete') return 'assets/produtos/tilapia-vinagrete.webp';
    if (n === 'tilapia grelhada') return 'assets/produtos/tilapia-inteira.webp';
    if (n.includes('tilapia a parmegiana') || n.includes('tilapia a dore')) return 'assets/produtos/tilapia-milanesa.webp';
    if (n.includes('tilapia a brasileira')) return 'assets/produtos/prato-completo.webp';
    if (n.includes('sinfonia')) return 'assets/produtos/prato-completo.webp';
    if (n.includes('camarao')) return 'assets/produtos/porcao-peixe.webp';
    if (n.includes('surubi') || n.includes('salmao') || n.includes('sashimi')) return 'assets/produtos/peixe.webp';
    if (n === 'batata frita') return 'assets/produtos/batata.webp';
    if (n === 'pirao') return 'assets/produtos/pirao.webp';
    if (n === 'vinagrete') return 'assets/produtos/vinagrete.webp';
    if (n === 'x-burguer') return 'assets/produtos/burger.webp';
    if (n === 'frango grelhado') return 'assets/produtos/frango.webp';
    if (n.includes('bistecao') || n.includes('picanha completa')) return 'assets/produtos/carne.webp';
    if (n.includes('gin tonica mediterraneo') || n === 'bergamo') return 'assets/produtos/drink.webp';
    if (categoryId === 'saladas' && n.includes('salada mista grande')) return 'assets/produtos/salada.webp';

    if (categoryId === 'peixes') return 'assets/produtos/peixe.webp';

    if (categoryId === 'carnes') return 'assets/produtos/carne.webp';

    if (categoryId === 'frango') {
      if (n.includes('espaguete')) return 'assets/produtos/prato-completo.webp';
      return 'assets/produtos/frango.webp';
    }

    if (categoryId === 'porcoes') {
      if (n.includes('picanha') || n.includes('file mignon') || n.includes('calabresa')) return 'assets/produtos/carne.webp';
      if (n.includes('frango')) return 'assets/produtos/frango.webp';
      if (n.includes('batata') || n.includes('polenta') || n.includes('mandioca') || n.includes('banana')) return 'assets/produtos/batata.webp';
      if (n.includes('pirao') || n.includes('feijao') || n.includes('creme') || n.includes('molho')) return 'assets/produtos/pirao.webp';
      if (n.includes('vinagrete')) return 'assets/produtos/vinagrete.webp';
      if (n.includes('arroz') || n.includes('farofa')) return 'assets/produtos/prato-completo.webp';
      if (n.includes('tilapia')) return 'assets/produtos/porcao-tilapia.webp';
      return 'assets/produtos/porcao-peixe.webp';
    }

    if (categoryId === 'saladas') return 'assets/produtos/salada.webp';
    if (categoryId === 'lanches') return 'assets/produtos/burger.webp';
    if (categoryId === 'bebidas' || categoryId === 'sucos' || categoryId === 'vinhos' || categoryId === 'coqueteis') {
      return 'assets/produtos/drink.webp';
    }

    return 'assets/produtos/prato-completo.webp';
  };

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
    const photo = itemImage(item.name, category.id);
    const photoUrl = versionAsset(photo);
    const photoHtml = photo
      ? `
        <button
          type="button"
          class="menu-entry-photo-button"
          data-photo-zoom
          data-photo-src="${photoUrl}"
          data-photo-name="${escapeHtml(item.name)}"
          aria-label="Ampliar foto de ${escapeHtml(item.name)}"
        >
          <img class="menu-entry-photo" src="${photoUrl}" alt="${escapeHtml(item.name)}" loading="lazy" />
          <span aria-hidden="true">⌕</span>
        </button>
      `
      : '';
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
      <article class="menu-entry ${photo ? 'has-photo' : ''}">
        ${photoHtml}
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
    categoryImage.src = versionAsset(categoryImages[category.id] || 'assets/produtos/tilapia-vinagrete.webp');
    categoryImage.alt = `Categoria ${category.title}`;
    if (categoryPhotoZoom) {
      categoryPhotoZoom.dataset.photoSrc = categoryImage.src;
      categoryPhotoZoom.dataset.photoName = category.title;
      categoryPhotoZoom.setAttribute('aria-label', `Ampliar foto de ${category.title}`);
    }
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
