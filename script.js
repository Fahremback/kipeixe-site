(() => {
  // ChatGPT adds this attribution parameter to outbound links. Keep the
  // visible site URL clean without affecting campaign tracking from ads.
  const inboundUrl = new URL(window.location.href);
  if (inboundUrl.searchParams.get('utm_source')?.toLowerCase() === 'chatgpt.com') {
    inboundUrl.searchParams.delete('utm_source');
    history.replaceState(history.state, '', `${inboundUrl.pathname}${inboundUrl.search}${inboundUrl.hash}`);
  }

  let MENU = Array.isArray(window.KIPEIXE_MENU) ? window.KIPEIXE_MENU : [];
  let lastCatalogSignature = null;
  const API = location.hostname === '127.0.0.1'
    ? 'http://127.0.0.1:8787'
    : 'https://api.restaurantekipeixe.com.br';
  let storeConfig = null;
  const VALID_PAGES = new Set(['inicio', 'cardapio', 'ambiente', 'pesque', 'contato']);
  const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const track = (name, fields) => window.kipeixeTrack?.(name, fields);

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

  const productSlug = (value = '') => normalize(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

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
    return VALID_PAGES.has(candidate) ? candidate : 'cardapio';
  };

  const setPage = (page, updateHash = true) => {
    if (!VALID_PAGES.has(page)) page = 'cardapio';
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
    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.get('kipeixe_etapa') === 'checkout') {
      currentUrl.searchParams.delete('kipeixe_etapa');
      history.replaceState(history.state, '', `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
    }
  }

  const menuItems = qs('[data-menu-items]');
  const categoryTabs = qs('[data-category-tabs]');
  const categoryTitle = qs('[data-category-title]');
  const categoryEyebrow = qs('[data-category-eyebrow]');
  const menuSearch = qs('[data-menu-search]');
  const menuSearchClear = qs('[data-menu-search-clear]');
  const menuSearchStatus = qs('[data-menu-search-status]');
  const pageTurner = qs('[data-page-turner]');
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
  // Image paths are catalogued in product-images.js (original menu photos first).
  const ITEM_PHOTOS = window.KIPEIXE_PRODUCT_PHOTOS || {};

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
    const searching = Boolean(menuSearch?.value.trim());
    categoryTabs.innerHTML = MENU.map((category, index) => `
      <button
        type="button"
        class="${!searching && index === currentCategory ? 'is-active' : ''}"
        data-category-index="${index}"
        aria-pressed="${!searching && index === currentCategory ? 'true' : 'false'}"
      >${escapeHtml(category.title)}</button>
    `).join('');
  };

  const renderMenuItem = (item, category, showCategory = false) => {
    let actions = '';
    const photoSrc = itemImage(item.name, category.id);
    const photo = photoSrc
      ? `<button type="button" class="menu-entry-photo-button" data-photo-zoom
          data-photo-src="${escapeHtml(versionAsset(photoSrc))}"
          data-photo-name="${escapeHtml(item.name)}"
          aria-label="Ampliar foto de ${escapeHtml(item.name)}">
          <img class="menu-entry-photo" src="${escapeHtml(versionAsset(photoSrc))}"
            alt="${escapeHtml(item.name)}" loading="lazy" decoding="async">
        </button>`
      : '<div class="menu-entry-photo-placeholder" aria-hidden="true"><span>KIPEIXE</span></div>';

    if (Array.isArray(item.variants) && item.variants.length) {
      const startingPrice = Math.min(...item.variants.map((variant) => Number(variant.price)));
      actions = `
        <div class="menu-entry-actions">
          <strong class="menu-entry-price">A partir de ${currency.format(startingPrice)}</strong>
          <div class="variant-list" aria-label="Escolha o tamanho">
            ${item.variants.map((variant) => `
              <button type="button" class="variant-button" data-add-item
                data-product-id="${escapeHtml(item.id || '')}"
                data-name="${escapeHtml(item.name)}"
                data-variant="${escapeHtml(variant.label || 'Opção')}"
                data-price="${variant.price}"
                aria-label="Adicionar ${escapeHtml(item.name)} ${escapeHtml(variant.label || 'Opção')} por ${currency.format(variant.price)}"
              >${escapeHtml(variant.label || 'Opção')} · ${currency.format(variant.price)}</button>
            `).join('')}
          </div>
        </div>
      `;
    } else if (Number.isFinite(item.price)) {
      actions = `
        <div class="menu-entry-actions">
          <strong class="menu-entry-price">${currency.format(item.price)}</strong>
          <div class="menu-entry-control">
            <button type="button" class="add-button" data-add-item
              data-product-id="${escapeHtml(item.id || '')}"
              data-name="${escapeHtml(item.name)}" data-variant="" data-price="${item.price}"
              aria-label="Adicionar ${escapeHtml(item.name)} ao pedido"
            >Adicionar <span aria-hidden="true">+</span></button>
            <div class="menu-qty-controls" data-menu-qty-controls
              data-cart-id="${escapeHtml(makeItemId(item.name))}" hidden>
              <button type="button" data-menu-qty-minus aria-label="Diminuir ${escapeHtml(item.name)}">−</button>
              <strong data-menu-qty-value>1</strong>
              <button type="button" data-add-item
                data-product-id="${escapeHtml(item.id || '')}"
                data-name="${escapeHtml(item.name)}" data-variant="" data-price="${item.price}"
                aria-label="Adicionar mais um ${escapeHtml(item.name)}">+</button>
            </div>
          </div>
        </div>
      `;
    } else {
      actions = '<div class="menu-entry-actions"><span class="consult-price">Consulte o preço</span></div>';
    }

    return `
      <article class="menu-entry${photoSrc ? ' has-photo' : ''}">
        <div class="menu-entry-main">
          ${showCategory ? `<span class="menu-entry-category">${escapeHtml(category.title)}</span>` : ''}
          <h4>${escapeHtml(item.name)}</h4>
          ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}
        </div>
        ${actions}
        ${photo}
      </article>
    `;
  };

  const updateRailButtons = (rail) => {
    const section = rail.closest('[data-category-section]');
    if (!section) return;
    const left = section.querySelector('[data-rail-prev]');
    const right = section.querySelector('[data-rail-next]');
    const remaining = rail.scrollWidth - rail.clientWidth;
    if (left) left.disabled = rail.scrollLeft < 3;
    if (right) right.disabled = remaining < 3 || rail.scrollLeft >= remaining - 3;
  };

  const prepareRails = () => {
    qsa('[data-menu-rail]', menuItems).forEach((rail) => {
      let drag = null;
      let ignoreClickUntil = 0;
      rail.addEventListener('pointerdown', (event) => {
        if (event.pointerType !== 'mouse' || event.button !== 0) return;
        drag = { x: event.clientX, start: rail.scrollLeft, active: false, pointerId: event.pointerId };
      });
      rail.addEventListener('pointermove', (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const dx = event.clientX - drag.x;
        if (!drag.active && Math.abs(dx) > 7) {
          drag.active = true;
          rail.classList.add('is-dragging');
          rail.setPointerCapture(event.pointerId);
        }
        if (!drag.active) return;
        rail.scrollLeft = drag.start - dx;
        ignoreClickUntil = Date.now() + 350;
        event.preventDefault();
      });
      const finishDrag = () => {
        if (!drag) return;
        if (drag.active) ignoreClickUntil = Date.now() + 350;
        rail.classList.remove('is-dragging');
        drag = null;
      };
      rail.addEventListener('pointerup', finishDrag);
      rail.addEventListener('pointercancel', finishDrag);
      rail.addEventListener('lostpointercapture', finishDrag);
      rail.addEventListener('click', (event) => {
        if (Date.now() < ignoreClickUntil) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);
      rail.addEventListener('scroll', () => updateRailButtons(rail), { passive: true });
      updateRailButtons(rail);
    });
  };

  const renderAllCategories = () => {
    menuItems.dataset.menuLayout = 'rails';
    menuItems.innerHTML = MENU.map((category, index) => `
      <section class="menu-category-section" data-category-section="${index}"
        aria-labelledby="menu-category-title-${index}">
        <div class="menu-category-head">
          <div class="menu-category-copy">
            <h3 id="menu-category-title-${index}">${escapeHtml(category.title)}</h3>
            <span>${category.items.length} ${category.items.length === 1 ? 'opção' : 'opções'}</span>
          </div>
          <div class="menu-rail-controls" aria-label="Navegar nos pratos de ${escapeHtml(category.title)}">
            <button type="button" data-rail-prev aria-label="Voltar pratos de ${escapeHtml(category.title)}">‹</button>
            <button type="button" data-rail-next aria-label="Ver mais pratos de ${escapeHtml(category.title)}">›</button>
          </div>
        </div>
        <div class="menu-category-rail" data-menu-rail tabindex="0"
          aria-label="Pratos de ${escapeHtml(category.title)}. Deslize para o lado para ver mais.">
          ${category.items.map((item) => renderMenuItem(item, category)).join('')}
        </div>
      </section>
    `).join('');
    prepareRails();
    syncMenuControls();
  };

  const renderCategory = (index, scroll = true, rebuild = false) => {
    if (!MENU.length || !menuItems) return;
    if (menuSearch) menuSearch.value = '';
    if (menuSearchClear) menuSearchClear.hidden = true;
    if (menuSearchStatus) menuSearchStatus.textContent = '';
    if (pageTurner) pageTurner.hidden = true;
    currentCategory = Math.max(0, Math.min(MENU.length - 1, index));
    const category = MENU[currentCategory];
    categoryTitle.textContent = category.title;
    categoryEyebrow.textContent = category.eyebrow || 'Cardápio Kipeixe';
    pageNumber.textContent = String(currentCategory + 1).padStart(2, '0');
    categoryProgress.textContent = `${currentCategory + 1} / ${MENU.length}`;
    if (rebuild || menuItems.dataset.menuLayout !== 'rails') renderAllCategories();
    prevCategory.disabled = currentCategory === 0;
    nextCategory.disabled = currentCategory === MENU.length - 1;
    renderMenuTabs();
    if (scroll) {
      qs(`[data-category-section="${currentCategory}"]`, menuItems)?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        block: 'start', inline: 'nearest'
      });
      const active = qs('[data-category-index].is-active', categoryTabs);
      active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  };

  // The sticky category chips reflect the row currently visible while scrolling down.
  let categoryScrollFrame = 0;
  window.addEventListener('scroll', () => {
    if (categoryScrollFrame || menuItems?.dataset.menuLayout !== 'rails') return;
    categoryScrollFrame = requestAnimationFrame(() => {
      categoryScrollFrame = 0;
      const cutoff = window.innerWidth < 761 ? 205 : 216;
      let visible = 0;
      qsa('[data-category-section]', menuItems).forEach((section, index) => {
        if (section.getBoundingClientRect().top <= cutoff) visible = index;
      });
      if (visible === currentCategory) return;
      currentCategory = visible;
      qsa('[data-category-index]', categoryTabs).forEach((button) => {
        const active = Number(button.dataset.categoryIndex) === visible;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
    });
  }, { passive: true });

  const renderSearch = () => {
    if (!menuSearch || !menuItems) return;
    const query = normalize(menuSearch.value);
    if (!query) {
      renderCategory(currentCategory, false);
      return;
    }

    const results = MENU.flatMap((category) =>
      category.items
        .filter((item) => normalize(`${item.name} ${item.description || ''}`).includes(query))
        .map((item) => ({ item, category }))
    );
    const label = `${results.length} ${results.length === 1 ? 'produto encontrado' : 'produtos encontrados'}`;
    categoryTitle.textContent = 'Resultados da busca';
    categoryEyebrow.textContent = 'Em todo o cardápio';
    pageNumber.textContent = 'BUSCA';
    categoryProgress.textContent = label;
    menuSearchStatus.textContent = label;
    menuSearchClear.hidden = false;
    if (pageTurner) pageTurner.hidden = true;
    menuItems.dataset.menuLayout = 'search';
    menuItems.innerHTML = results.length
      ? results.map(({ item, category }) => renderMenuItem(item, category, true)).join('')
      : '<div class="menu-no-results" data-menu-no-results>Nenhum produto encontrado. Tente outro nome ou escolha uma categoria.</div>';
    renderMenuTabs();
    syncMenuControls();
  };

  menuSearch?.addEventListener('input', renderSearch);
  menuSearchClear?.addEventListener('click', () => {
    menuSearch.value = '';
    renderCategory(currentCategory, false);
    menuSearch.focus();
  });

  document.addEventListener('error', (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    if (!image.matches('.menu-entry-photo, [data-category-image]')) return;
    if (image.dataset.fallbackApplied === 'true') return;

    image.dataset.fallbackApplied = 'true';
    if (image.matches('.menu-entry-photo')) {
      const trigger = image.closest('[data-photo-zoom]');
      const placeholder = document.createElement('div');
      placeholder.className = 'menu-entry-photo-placeholder';
      placeholder.setAttribute('aria-hidden', 'true');
      placeholder.innerHTML = '<span>KIPEIXE</span>';
      trigger?.replaceWith(placeholder);
      return;
    }
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
  menuItems?.addEventListener('click', (event) => {
    const control = event.target.closest('[data-rail-prev], [data-rail-next]');
    if (!control) return;
    const rail = control.closest('[data-category-section]')?.querySelector('[data-menu-rail]');
    if (!rail) return;
    const distance = Math.max(rail.clientWidth * .8, 270);
    rail.scrollBy({left: control.hasAttribute('data-rail-next') ? distance : -distance, behavior: 'smooth'});
  });
  qsa('[data-category-scroll]').forEach((button) => {
    button.addEventListener('click', () => {
      categoryTabs?.scrollBy({
        left: Number(button.dataset.categoryScroll) * Math.max(220, categoryTabs.clientWidth * .75),
        behavior: 'smooth'
      });
    });
  });
  prevCategory?.addEventListener('click', () => renderCategory(currentCategory - 1));
  nextCategory?.addEventListener('click', () => renderCategory(currentCategory + 1));

  const openPhoto = (src, name = '') => {
    if (!photoLightbox || !photoLightboxImage || !src) return;
    const product = MENU.flatMap((category) => category.items)
      .find((item) => normalize(item.name) === normalize(name));
    if (product) {
      const value = Number.isFinite(product.price) ? product.price :
        product.variants?.[0]?.price;
      track('ViewContent', {
        content_name: product.name,
        content_ids: [makeItemId(product.name)],
        content_type: 'product',
        ...(Number.isFinite(value) ? { value, currency: 'BRL' } : {})
      });
    }
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

  tabLinks.forEach((button) => {
    button.addEventListener('click', () => {
      closeCart();
      setPage(button.dataset.pageLink);
    });
  });

  window.addEventListener('popstate', () => setPage(hashPage(), false));
  window.addEventListener('hashchange', () => setPage(hashPage(), false));
  setPage(hashPage(), false);
  if (!VALID_PAGES.has(location.hash.slice(1).split('/')[0])) {
    history.replaceState({}, '', '#cardapio');
  }

  let cart = safeStorage.get('kipeixe_cart_v1', []);
  if (!Array.isArray(cart)) cart = [];
  // Reconcile baskets saved before the 350 ml-only soda update.
  // Discontinued Coca-Cola products cannot be ordered, and remaining sodas
  // now have one available presentation. Merge old bottle/can quantities.
  const currentSodas = new Map(
    (MENU.find((category) => category.id === 'bebidas')?.items || [])
      .filter((item) => item.description?.startsWith('Refrigerante'))
      .map((item) => [normalize(item.name), item])
  );
  // Only allow current menu SKUs. This also removes old 600 ml beers saved
  // in a browser's localStorage, including Skol/Heineken bottle prices.
  const activeSkus = new Set(MENU.flatMap((category) => category.items.flatMap((item) =>
    item.variants.length
      ? item.variants.map((variant) => `${normalize(item.name)}::${normalize(variant.label)}::${variant.price}`)
      : item.price === null ? [] : [`${normalize(item.name)}::::${item.price}`]
  )));
  const retiredSodas = new Set(['coca-cola', 'coca-cola zero', 'refrigerantes']);
  const reconciled = new Map();
  cart.forEach((saved) => {
    if (!saved || typeof saved.name !== 'string') return;
    const nameKey = normalize(saved.name);
    if (retiredSodas.has(nameKey)) return;
    const current = currentSodas.get(nameKey);
    const sku = current
      ? { ...saved, name: current.name, variant: current.variants[0].label, price: current.variants[0].price }
      : saved;
    const qty = Number(sku.qty);
    if (!Number.isInteger(qty) || qty <= 0 || !Number.isFinite(Number(sku.price))) return;
    if (!activeSkus.has(`${normalize(sku.name)}::${normalize(sku.variant || '')}::${Number(sku.price)}`)) return;
    sku.id = makeItemId(sku.name, sku.variant);
    const previous = reconciled.get(sku.id);
    if (previous) previous.qty += qty;
    else reconciled.set(sku.id, { ...sku, qty });
  });
  cart = [...reconciled.values()];

  const cartItems = qs('[data-cart-items]');
  const cartEmpty = qs('[data-cart-empty]');
  const cartCheckout = qs('[data-cart-checkout]');
  const cartTotal = qs('[data-cart-total]');
  const paymentTotal = qs('[data-payment-total]');
  const quickCheckout = qs('[data-quick-checkout]');
  const quickCount = qs('[data-quick-count]');
  const quickTotal = qs('[data-quick-total]');
  const orderForm = qs('[data-order-form]');
  const orderType = qs('[data-order-type]');
  const orderChoices = qsa('[data-order-choice]');
  const addressField = qs('[data-address-field]');
  const deliveryQuoteButton = qs('[data-delivery-calculate]');
  const deliveryQuoteStatus = qs('[data-delivery-quote-status]');
  const ifoodAddressSection = qs('[data-ifood-address]');
  const ifoodLocationStatus = qs('[data-ifood-location-status]');
  const ifoodMapNode = qs('[data-ifood-map]');
  const ifoodFields = {
    postalCode: qs('[name="ifoodPostalCode"]', orderForm),
    streetNumber: qs('[name="ifoodStreetNumber"]', orderForm),
    streetName: qs('[name="ifoodStreetName"]', orderForm),
    neighborhood: qs('[name="ifoodNeighborhood"]', orderForm),
    complement: qs('[name="ifoodComplement"]', orderForm),
  };
  let ifoodCoordinates = null;
  let ifoodMap = null, ifoodMarker = null;
  let deliveryQuote = null;
  const notesStep = qs('[data-notes-step]');
  const nameError = qs('[data-name-error]');
  const addressError = qs('[data-address-error]');
  let checkoutTracked = false;

  function openCart(trackCheckout = true) {
    cartDrawer?.classList.add('is-open');
    cartDrawer?.setAttribute('aria-hidden', 'false');
    document.body.classList.add('cart-open');
    syncSchedule();
    if (cart.length && trackCheckout && !checkoutTracked) {
      checkoutTracked = true;
      track('InitiateCheckout', {
        value: cartValue(), currency: 'BRL', num_items: cartCount(),
        contents: cart.map((item) => ({ id: item.id, quantity: item.qty, item_price: item.price })),
        content_type: 'product'
      });
      // A real checkout step also gets its own URL-based Pixel page view.
      // This supports Meta's custom checkout conversion while the standard
      // InitiateCheckout event is not yet eligible for ad optimization.
      // Do not send personally identifying information or record a purchase.
      if (typeof window.fbq === 'function') {
        try {
          const checkoutUrl = new URL(window.location.href);
          checkoutUrl.searchParams.set('kipeixe_etapa', 'checkout');
          history.replaceState(history.state, '', `${checkoutUrl.pathname}${checkoutUrl.search}${checkoutUrl.hash}`);
          window.fbq('track', 'PageView');
        } catch (error) {
          console.warn('Checkout Pixel page-view tracking unavailable:', error);
        }
      }
    }
  }

  const cartCount = () => cart.reduce((sum, item) => sum + item.qty, 0);
  const cartValue = () => cart.reduce((sum, item) => sum + item.price * item.qty, 0);

  const syncMenuControls = () => {
    qsa('[data-menu-qty-controls]', menuItems).forEach((control) => {
      const qty = cart.find((item) => item.id === control.dataset.cartId)?.qty || 0;
      const addButton = control.parentElement?.querySelector('.add-button');
      if (addButton) addButton.hidden = qty > 0;
      control.hidden = qty === 0;
      const amount = qs('[data-menu-qty-value]', control);
      if (amount) amount.textContent = qty;
    });
  };

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
    syncMenuControls();

    if (!cartItems || !cartEmpty || !cartCheckout) return;
    cartEmpty.hidden = count > 0;
    cartCheckout.hidden = count === 0;
    if (cartTotal) cartTotal.textContent = currency.format(cartValue());
    if (paymentTotal) paymentTotal.textContent = currency.format(cartValue() +
      (orderType?.value === 'Entrega' ? Number(deliveryQuote?.feeCents || 0) / 100 : 0));

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

  const addItem = (name, variant, price, productId = '', quantity = 1) => {
    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice < 0 ||
        !Number.isInteger(quantity) || quantity < 1 || quantity > 5) return;
    const id = makeItemId(name, variant);
    const existing = cart.find((entry) => entry.id === id);
    if (existing) existing.qty += quantity;
    else cart.push({ id, name, variant, productId, price: numericPrice, qty: quantity });
    checkoutTracked = false;
    track('AddToCart', {
      content_name: name,
      content_ids: [id],
      content_type: 'product',
      contents: [{ id, quantity, item_price: numericPrice }],
      value: numericPrice * quantity,
      currency: 'BRL'
    });
    renderCart();
    if (quickCheckout && !quickCheckout.hidden) {
      quickCheckout.classList.remove('is-pulsing');
      void quickCheckout.offsetWidth;
      quickCheckout.classList.add('is-pulsing');
    }
    return true;
  };

  // Campaign/deep links: ?produto=porcoes:tilapia&quantidade=1#cardapio
  // Product names, categories and prices are always resolved against MENU.
  // The parameter is consumed so refreshing the page cannot add it twice.
  function applyProductDeepLink() {
    const url = new URL(window.location.href);
    const requests = url.searchParams.getAll('produto');
    if (!requests.length) return;
    url.searchParams.delete('produto');
    url.searchParams.delete('variante');
    url.searchParams.delete('quantidade');
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
    // Never change a basket during a return from the payment provider.
    if (url.searchParams.has('pedido') || url.searchParams.has('retorno')) return;

    const requestedQty = Number(inboundUrl.searchParams.get('quantidade') || '1');
    const quantity = Number.isInteger(requestedQty) && requestedQty >= 1 && requestedQty <= 5
      ? requestedQty : 1;
    const requestedVariant = productSlug(inboundUrl.searchParams.get('variante') || '');
    const added = [];
    // Limit external links to five products to prevent accidental huge orders.
    for (const request of requests.slice(0, 5)) {
      const [categorySlug, itemSlug, ...extra] = request.split(':');
      if (!categorySlug || !itemSlug || extra.length) continue;
      const categoryIndex = MENU.findIndex(c => productSlug(c.id) === productSlug(categorySlug));
      if (categoryIndex === -1) continue;
      const category = MENU[categoryIndex];
      const item = category.items.find(i => productSlug(i.name) === productSlug(itemSlug));
      if (!item) continue;
      let price = item.price, variant = '';
      if (item.variants?.length) {
        const option = item.variants.find(v => productSlug(v.label) === requestedVariant)
          || (item.variants.length === 1 && !requestedVariant ? item.variants[0] : null);
        if (!option) continue;
        price = option.price;
        variant = option.label;
      } else if (requestedVariant) continue;
      if (!Number.isFinite(price)) continue;
      if (!addItem(item.name, variant, price, item.id || '', quantity)) continue;
      added.push({ categoryIndex, item, price, variant });
    }

    if (!added.length) return;
    setPage('cardapio');
    renderCategory(added[0].categoryIndex, true);
    for (const { item, price, variant } of added) {
      track('ViewContent', {
        content_name: item.name, content_ids: [makeItemId(item.name, variant)],
        content_type: 'product', value: price, currency: 'BRL'
      });
    }
    // Display the prefilled order without claiming the visitor initiated checkout.
    openCart(false);
  }

  menuItems?.addEventListener('click', (event) => {
    const minus = event.target.closest('[data-menu-qty-minus]');
    if (minus) {
      const id = minus.closest('[data-menu-qty-controls]')?.dataset.cartId;
      const entry = cart.find((item) => item.id === id);
      if (entry) {
        entry.qty -= 1;
        cart = cart.filter((item) => item.qty > 0);
        renderCart();
      }
      return;
    }
    const button = event.target.closest('[data-add-item]');
    if (!button) return;
    addItem(button.dataset.name, button.dataset.variant, button.dataset.price, button.dataset.productId);
    if (button.matches('.variant-button')) {
      const original = button.textContent;
      button.textContent = 'Adicionado ✓';
      setTimeout(() => { if (button.isConnected) button.textContent = original; }, 850);
    }
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
    const useIFood = storeConfig?.deliveryProvider === 'ifood' && delivery;
    if (ifoodAddressSection) ifoodAddressSection.hidden = !useIFood;
    const inputAddress = qs('input[name="address"]', addressField);
    if (inputAddress) {
      inputAddress.readOnly = useIFood;
      inputAddress.placeholder = useIFood ? 'Preenchido automaticamente com os dados abaixo' : 'Rua, número e bairro';
    }
    if (useIFood && ifoodMap) setTimeout(() => ifoodMap.invalidateSize(), 0);
    const input = qs('input', addressField);
    if (!delivery && input) {
      input.removeAttribute('aria-invalid');
      if (addressError) addressError.hidden = true;
    }
    if (notesStep) notesStep.textContent = '05';
    renderCart();
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
      deliveryQuote = null;
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
  const isIFood = () => storeConfig?.deliveryProvider === 'ifood';
  const currentIFoodAddress = () => ({
    postalCode: String(ifoodFields.postalCode?.value || '').replace(/\D/g, ''),
    streetNumber: ifoodFields.streetNumber?.value.trim() || '',
    streetName: ifoodFields.streetName?.value.trim() || '',
    neighborhood: ifoodFields.neighborhood?.value.trim() || '',
    complement: ifoodFields.complement?.value.trim() || '',
    latitude: ifoodCoordinates?.latitude,
    longitude: ifoodCoordinates?.longitude,
    city: 'Foz do Iguaçu',
  });
  function updateIFoodAddress() {
    if (!isIFood()) return;
    const a = currentIFoodAddress();
    addressInput.value = a.streetName && a.streetNumber && a.neighborhood && /^\d{8}$/.test(a.postalCode)
      ? a.streetName + ', ' + a.streetNumber + ', ' + a.neighborhood +
        ', CEP ' + a.postalCode + ', Foz do Iguaçu - PR' : '';
    deliveryQuote = null;
    if (deliveryQuoteStatus) deliveryQuoteStatus.textContent = 'Endereço alterado. Calcule novamente o frete.';
    renderCart();
  }
  Object.values(ifoodFields).forEach(input => input?.addEventListener('input', updateIFoodAddress));
  ifoodFields.postalCode?.addEventListener('blur', async () => {
    const cep = currentIFoodAddress().postalCode;
    if (!/^\d{8}$/.test(cep)) return;
    try {
      const response = await fetch('https://viacep.com.br/ws/' + cep + '/json/', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || data.erro || data.localidade?.toLowerCase() !== 'foz do iguaçu') {
        ifoodLocationStatus.textContent = 'CEP não corresponde a Foz do Iguaçu.';
        return;
      }
      if (!ifoodFields.streetName.value.trim()) ifoodFields.streetName.value = data.logradouro || '';
      if (!ifoodFields.neighborhood.value.trim()) ifoodFields.neighborhood.value = data.bairro || '';
      updateIFoodAddress();
    } catch { ifoodLocationStatus.textContent = 'CEP não localizado. Preencha rua e bairro manualmente.'; }
  });
  function setIFoodCoordinates(latitude, longitude) {
    ifoodCoordinates = { latitude: Number(latitude.toFixed(6)), longitude: Number(longitude.toFixed(6)) };
    if (ifoodLocationStatus)
      ifoodLocationStatus.textContent = 'Ponto da entrega confirmado. Confira CEP, rua, número e bairro.';
    if (ifoodMap && window.L) {
      if (ifoodMarker) ifoodMarker.setLatLng([latitude, longitude]);
      else ifoodMarker = window.L.marker([latitude, longitude]).addTo(ifoodMap);
      ifoodMap.setView([latitude, longitude], 16);
    }
    updateIFoodAddress();
  }
  qs('[data-ifood-use-location]')?.addEventListener('click', () => {
    if (!navigator.geolocation) {
      ifoodLocationStatus.textContent = 'Seu navegador não oferece localização. Use o mapa.';
      return;
    }
    ifoodLocationStatus.textContent = 'Obtendo localização. Confirme que está no endereço da entrega.';
    navigator.geolocation.getCurrentPosition(position => {
      setIFoodCoordinates(position.coords.latitude, position.coords.longitude);
    }, () => { ifoodLocationStatus.textContent = 'Localização não autorizada. Marque o ponto no mapa.'; },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  });
  qs('[data-ifood-show-map]')?.addEventListener('click', async () => {
    ifoodMapNode.hidden = false;
    if (ifoodMap) { ifoodMap.invalidateSize(); return; }
    try {
      if (!window.L) {
        if (!document.querySelector('[data-leaflet-css]')) {
          const css = document.createElement('link');
          css.rel = 'stylesheet';
          css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
          css.dataset.leafletCss = '1';
          document.head.append(css);
        }
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
          script.onload = resolve; script.onerror = reject;
          document.head.append(script);
        });
      }
      ifoodMap = window.L.map(ifoodMapNode, { scrollWheelZoom: false })
        .setView(ifoodCoordinates ? [ifoodCoordinates.latitude, ifoodCoordinates.longitude] : [-25.5365, -54.5870],
          ifoodCoordinates ? 16 : 12);
      window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
      }).addTo(ifoodMap);
      ifoodMap.on('click', event => setIFoodCoordinates(event.latlng.lat, event.latlng.lng));
      if (ifoodCoordinates) setIFoodCoordinates(ifoodCoordinates.latitude, ifoodCoordinates.longitude);
      ifoodLocationStatus.textContent = 'Toque no mapa sobre o endereço exato da entrega.';
      setTimeout(() => ifoodMap.invalidateSize(), 150);
    } catch { ifoodLocationStatus.textContent = 'Mapa indisponível. Use o botão de localização.'; }
  });

  nameInput?.addEventListener('input', () => {
    if (nameInput.value.trim()) setFieldError(nameInput, nameError, false);
  });
  addressInput?.addEventListener('input', () => {
    if (addressInput.value.trim()) setFieldError(addressInput, addressError, false);
    deliveryQuote = null;
    if (deliveryQuoteStatus) deliveryQuoteStatus.textContent = 'Endereço alterado. Calcule novamente o frete.';
    renderCart();
  });

  deliveryQuoteButton?.addEventListener('click', async () => {
    if (!storeConfig?.deliveryEnabled) {
      deliveryQuoteStatus.textContent = 'Entregas temporariamente indisponíveis.';
      return;
    }
    deliveryQuoteButton.disabled = true;
    const provider = isIFood() ? 'iFood' : 'Uber Direct';
    deliveryQuoteStatus.textContent = 'Consultando taxa e disponibilidade com ' + provider + '...';
    deliveryQuote = null;
    renderCart();
    try {
      const response = await fetch(API + '/api/delivery/quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: addressInput.value.trim(),
          ...(isIFood() ? { ifoodAddress: currentIFoodAddress() } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Não foi possível cotar a entrega.');
      deliveryQuote = { ...data, address: addressInput.value.trim() };
      deliveryQuoteStatus.textContent = 'Entrega ' + provider + ': ' +
        currency.format(data.feeCents / 100) + '. Frete calculado para este endereço.';
      renderCart();
    } catch (error) {
      deliveryQuoteStatus.textContent = error.message;
    } finally { deliveryQuoteButton.disabled = false; }
  });

  const onlineButton = qs('[data-online-checkout]');
  const onlineHint = qs('[data-online-hint]');
  const pixPreview = qs('[data-payment-pix-preview]');
  const cardPreview = qs('[data-payment-card-preview]');
  function syncPaymentCaption() {
    const method = qs('input[name="paymentMethod"]:checked', orderForm)?.value;
    if (pixPreview) pixPreview.hidden = method === 'CREDIT_CARD';
    if (cardPreview) cardPreview.hidden = method !== 'CREDIT_CARD';
    if (!onlineButton || !storeConfig?.onlinePaymentEnabled) return;
    const caption = qs('small', onlineButton);
    if (caption) caption.textContent = (method === 'CREDIT_CARD' ? 'Cartão seguro no Asaas' : 'QR Code Pix no Kipeixe') +
      (storeConfig.sandbox ? ' · Sandbox Asaas' : ' · Ambiente seguro Asaas');
    const title = qs('strong', onlineButton);
    if (title) title.textContent = method === 'CREDIT_CARD' ? 'Continuar com cartão' : 'Gerar meu QR Code Pix';
  }
  qsa('input[name="paymentMethod"]', orderForm).forEach(input =>
    input.addEventListener('change', syncPaymentCaption));
  const hoursService = window.KIPEIXE_HOURS;
  const immediateInput = qs('input[name="mode"][value="immediate"]', orderForm);
  const scheduledInput = qs('input[name="mode"][value="scheduled"]', orderForm);
  const immediateOption = qs('[data-immediate-option]', orderForm);
  const fulfillmentSwitch = qs('[data-fulfillment-switch]', orderForm);
  const scheduleField = qs('[data-schedule-field]');
  const scheduleInput = qs('input[name="scheduledAt"]', orderForm);
  const hoursHint = qs('[data-hours-hint]');
  const scheduleError = qs('[data-schedule-error]');
  const onlineStatus = qs('[data-online-status]');
  const onlineStatusTitle = qs('[data-online-status-title]');
  const onlineStatusMessage = qs('[data-online-status-message]');
  const onlineStatusRefresh = qs('[data-online-status-refresh]');
  const onlinePixOpen = qs('[data-online-pix-open]');
  const onlineStatusLink = qs('[data-online-status-link]');
  const uberTrackingLink = qs('[data-uber-tracking]');
  const checkoutDisclaimer = qs('[data-checkout-disclaimer]');
  const phoneError = qs('[data-phone-error]');
  const phoneInput = qs('input[name="phone"]', orderForm);
  let currentOrder = safeStorage.get('kipeixe_current_order_v2', null);
  let paymentBusy = false;
  let statusInterval = null;
  const pixDrawer = qs('[data-pix-drawer]');
  const pixPanel = qs('.pix-panel', pixDrawer);
  const pixImage = qs('[data-pix-image]', pixDrawer);
  const pixCode = qs('[data-pix-code]', pixDrawer);
  const pixExpiration = qs('[data-pix-expiration]', pixDrawer);
  const pixTotal = qs('[data-pix-total]', pixDrawer);
  const pixCopy = qs('[data-pix-copy]', pixDrawer);
  const pixCheck = qs('[data-pix-check]', pixDrawer);
  const pixProgress = qs('.pix-payment-progress', pixDrawer);
  const pixProgressTitle = qs('[data-pix-progress-title]', pixDrawer);
  const pixProgressNote = qs('[data-pix-progress-note]', pixDrawer);
  let availablePix = null;

  function closePix() {
    pixDrawer?.classList.remove('is-open');
    pixDrawer?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('pix-open');
    onlinePixOpen?.focus({ preventScroll: true });
  }

  function displayPix(pix, totalCents) {
    if (!pix || !/^[A-Za-z0-9+/=]{40,50000}$/.test(pix.image || '') ||
        typeof pix.payload !== 'string' || pix.payload.length < 30 || pix.payload.length > 5000 ||
        !Number.isFinite(Date.parse(pix.expiresAt))) return false;
    availablePix = { ...pix, totalCents };
    if (pixImage) pixImage.src = 'data:image/png;base64,' + pix.image;
    if (pixCode) pixCode.value = pix.payload;
    if (pixTotal) pixTotal.textContent = currency.format(totalCents / 100);
    if (onlinePixOpen) onlinePixOpen.hidden = false;
    updatePixExpiration();
    return true;
  }

  function updatePixExpiration() {
    if (!availablePix || !pixExpiration) return;
    const remaining = Math.ceil((Date.parse(availablePix.expiresAt) - Date.now()) / 1000);
    pixExpiration.textContent = remaining > 0
      ? `Código válido por ${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`
      : 'Prazo de pagamento encerrado';
    if (remaining <= 0 && !pixPanel?.classList.contains('is-complete')) {
      pixCopy.disabled = true;
      if (pixProgressTitle) pixProgressTitle.textContent = 'Prazo do QR Code encerrado';
      if (pixProgressNote) pixProgressNote.textContent = 'Verifique o status antes de tentar fazer outro pedido.';
    }
  }

  function updatePixProgress(status) {
    if (!pixProgress) return;
    const paid = status === 'PAID';
    const expired = status === 'EXPIRED' || status === 'CANCELED';
    pixPanel?.classList.toggle('is-complete', paid || expired);
    pixProgress.classList.toggle('is-paid', paid);
    pixProgress.classList.toggle('is-expired', expired);
    if (pixProgressTitle) pixProgressTitle.textContent = paid ? 'Pagamento confirmado' :
      expired ? 'Código Pix expirado' : 'Aguardando pagamento';
    if (pixProgressNote) pixProgressNote.textContent = paid
      ? 'Recebemos a confirmação do Asaas. O Kipeixe irá avaliar seu pedido.'
      : expired ? 'O código não está mais disponível para pagamento.'
      : 'A confirmação é automática. Você também pode verificar abaixo.';
    if (pixCheck) pixCheck.hidden = paid || expired;
    if (onlinePixOpen) onlinePixOpen.hidden = paid || expired || !availablePix;
    if (pixCopy) pixCopy.disabled = paid || expired ||
      (availablePix && Date.parse(availablePix.expiresAt) <= Date.now());
  }

  function openPix() {
    if (!availablePix || !pixDrawer) return;
    pixDrawer.classList.add('is-open');
    pixDrawer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('pix-open');
    pixPanel?.focus({ preventScroll: true });
    if (!statusInterval) statusInterval = setInterval(checkOrderStatus, 12000);
    checkOrderStatus();
  }

  qsa('[data-pix-close]').forEach(button => button.addEventListener('click', closePix));
  onlinePixOpen?.addEventListener('click', openPix);
  pixCheck?.addEventListener('click', async () => {
    pixCheck.disabled = true;
    try { await checkOrderStatus(); } finally { pixCheck.disabled = false; }
  });
  pixCopy?.addEventListener('click', async () => {
    if (!availablePix || Date.parse(availablePix.expiresAt) <= Date.now()) return;
    try {
      await navigator.clipboard.writeText(availablePix.payload);
      pixCopy.textContent = '✓ Código Pix copiado';
    } catch {
      pixCode?.focus();
      pixCode?.select();
      pixCopy.textContent = 'Selecione e copie o código acima';
    }
  });
  setInterval(updatePixExpiration, 1000);
  let fulfillmentTouched = false;

  const activeOpeningHours = () => storeConfig?.openingHours ||
    (window.KIPEIXE_API_ENABLED !== true ? hoursService?.DEFAULT_HOURS : null);

  function clearScheduleError() {
    if (scheduleError) {
      scheduleError.textContent = '';
      scheduleError.hidden = true;
    }
    scheduleInput?.removeAttribute('aria-invalid');
  }

  function invalidSchedule(message) {
    if (scheduleError) {
      scheduleError.textContent = message;
      scheduleError.hidden = false;
    }
    scheduleInput?.setAttribute('aria-invalid', 'true');
    scheduleInput?.focus({ preventScroll: true });
    scheduleField?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }

  function syncSchedule() {
    const hours = activeOpeningHours();
    const canOrderNow = Boolean(hours && hoursService?.isOpenAt(hours, new Date()));
    if (immediateOption) immediateOption.hidden = !canOrderNow;
    if (immediateInput) immediateInput.disabled = !canOrderNow;
    fulfillmentSwitch?.classList.toggle('is-schedule-only', !canOrderNow);
    if (canOrderNow && !fulfillmentTouched && immediateInput) {
      immediateInput.checked = true;
    }
    if (!canOrderNow && scheduledInput && !scheduledInput.checked) {
      scheduledInput.checked = true;
      clearScheduleError();
    }
    const mode = qs('input[name="mode"]:checked', orderForm)?.value || 'scheduled';
    if (scheduleField) scheduleField.hidden = mode !== 'scheduled';
    if (scheduleInput) {
      const firstSlot = Math.ceil((Date.now() + 15 * 60_000) / (15 * 60_000)) * (15 * 60_000);
      scheduleInput.min = hoursService.toInputValue(new Date(firstSlot));
      scheduleInput.max = hoursService.toInputValue(new Date(Date.now() + 7 * 24 * 60 * 60_000));
      scheduleInput.required = mode === 'scheduled';
      scheduleInput.disabled = mode !== 'scheduled';
    }
    if (hoursHint) hoursHint.textContent = !hours
      ? 'Horários indisponíveis para consulta. Você pode agendar; confirme com o restaurante.'
      : canOrderNow
        ? 'Estamos abertos agora. Você também pode agendar seu pedido.'
        : 'Fora do horário de funcionamento. Agende para quando o restaurante estiver aberto.';
    return canOrderNow;
  }

  function validateScheduleChoice() {
    const canOrderNow = syncSchedule();
    const mode = qs('input[name="mode"]:checked', orderForm)?.value;
    const hours = activeOpeningHours();
    if (mode === 'immediate') {
      return canOrderNow || invalidSchedule('O restaurante está fechado. Escolha Agendar.');
    }
    if (mode !== 'scheduled') return invalidSchedule('Escolha Agora ou Agendar.');
    if (!hours) return invalidSchedule('Não foi possível consultar os horários. Tente novamente.');
    const validation = hoursService.validateSchedule(hours, scheduleInput?.value);
    return validation.valid || invalidSchedule(validation.message);
  }
  qsa('input[name="mode"]', orderForm).forEach(radio => radio.addEventListener('change', () => {
    fulfillmentTouched = true;
    clearScheduleError();
    syncSchedule();
  }));
  scheduleInput?.addEventListener('input', clearScheduleError);
  syncSchedule();

  function updateMenuFromApi(categories) {
    if (!Array.isArray(categories) || categories.length === 0) return;
    const signature = JSON.stringify(categories);
    const needsRedraw = signature !== lastCatalogSignature;
    lastCatalogSignature = signature;
    const railPositions = needsRedraw
      ? qsa('[data-category-section]', menuItems).map(section =>
          section.querySelector('[data-menu-rail]')?.scrollLeft || 0)
      : [];
    MENU = categories;
    const prices = new Map(MENU.flatMap(category => category.items.flatMap(item =>
      item.variants?.length
        ? item.variants.map(v => [makeItemId(item.name, v.label), { price: v.price, productId: item.id }])
        : item.price === null ? [] : [[makeItemId(item.name, ''), { price: item.price, productId: item.id }]]
    )));
    cart = cart.filter(entry => prices.has(entry.id)).map(entry => ({
      ...entry, ...prices.get(entry.id)
    }));
    currentCategory = Math.min(currentCategory, MENU.length - 1);
    if (needsRedraw) {
      if (menuSearch?.value.trim()) {
        renderSearch();
      } else {
        renderCategory(currentCategory, false, true);
        qsa('[data-category-section]', menuItems).forEach((section, index) => {
          const rail = section.querySelector('[data-menu-rail]');
          if (!rail) return;
          rail.scrollLeft = railPositions[index] || 0;
          updateRailButtons(rail);
        });
      }
    }
    renderCart();
  }

  async function refreshStore() {
    if (location.hostname !== '127.0.0.1' && window.KIPEIXE_API_ENABLED !== true) {
      storeConfig = null;
      if (onlineButton) onlineButton.disabled = true;
      if (onlineHint) onlineHint.textContent = 'Pagamento ainda não disponível.';
      syncSchedule();
      return;
    }
    try {
      const [configResponse, catalogResponse] = await Promise.all([
        fetch(`${API}/api/config`, { cache: 'no-store' }),
        fetch(`${API}/api/catalog`, { cache: 'no-store' })
      ]);
      if (!configResponse.ok || !catalogResponse.ok) throw Error('Serviço não disponível.');
      storeConfig = await configResponse.json();
      syncSchedule();
      updateMenuFromApi((await catalogResponse.json()).categories);
      if (onlineButton) onlineButton.disabled = paymentBusy || !storeConfig.onlinePaymentEnabled;
      if (onlineHint) onlineHint.textContent = storeConfig.onlinePaymentEnabled
        ? (storeConfig.sandbox
          ? 'Ambiente de testes: nenhum valor real será cobrado.'
          : 'Pagamento protegido pelo Asaas. Seu pedido só segue após confirmação.')
        : 'Pagamentos temporariamente indisponíveis. Nenhum pedido será enviado.';
      const deliveryChoice = qs('[data-order-choice="Entrega"]');
      if (deliveryChoice) deliveryChoice.hidden = !storeConfig.deliveryEnabled;
      if (deliveryQuoteButton) deliveryQuoteButton.textContent =
        'Calcular taxa pelo ' + (isIFood() ? 'iFood' : 'Uber Direct');
      syncAddressField();
      if (!storeConfig.deliveryEnabled && orderType?.value === 'Entrega') {
        qs('[data-order-choice="Retirada no Kipeixe"]')?.click();
      }
      if (!storeConfig.deliveryEnabled) deliveryQuote = null;
      const onlineLabel = qs('strong', onlineButton);
      const onlineCaption = qs('small', onlineButton);
      if (onlineLabel) onlineLabel.textContent = !storeConfig.onlinePaymentEnabled
        ? 'Pagamento indisponível'
        : storeConfig.sandbox ? 'Abrir pagamento de teste' : 'Continuar para pagamento';
      if (onlineCaption) onlineCaption.textContent = storeConfig.sandbox
        ? 'Pix ou cartão fictícios · Sandbox Asaas'
        : 'Pix ou cartão · Ambiente seguro Asaas';
      if (checkoutDisclaimer) checkoutDisclaimer.textContent = storeConfig.sandbox
        ? 'AMBIENTE DE TESTES: cobrança simulada, sem dinheiro real. O restaurante só recebe o pedido após a confirmação do Asaas.'
        : 'Depois do pagamento, aguarde o aceite do Kipeixe. Pedidos imediatos sem resposta em 30 minutos são recusados, com solicitação de estorno.';
      syncPaymentCaption();
      renderCart();
    } catch {
      // Falha fechada: checkout não envia pedidos por outro canal silenciosamente.
      storeConfig = null;
      if (onlineButton) {
        onlineButton.disabled = true;
        qs('strong', onlineButton).textContent = 'Pagamento indisponível';
        qs('small', onlineButton).textContent = 'Falha ao conectar ao Asaas. Tente novamente.';
      }
      if (onlineHint) onlineHint.textContent = 'Não foi possível consultar o serviço de pagamento. Nenhum pedido foi realizado.';
      syncSchedule();
    }
  }

  const orderMessages = {
    AWAITING_PAYMENT: ['Aguardando pagamento', 'Finalize o pagamento no Asaas. O restaurante só recebe o pedido depois disso.'],
    AWAITING_ACCEPTANCE: ['Pagamento recebido', 'Seu pedido aguarda a confirmação do restaurante por até 30 minutos.'],
    SCHEDULED: ['Pedido agendado', 'Pagamento recebido. O restaurante ainda precisa aceitar o horário solicitado.'],
    PREPARING: ['Pedido aceito', 'A cozinha está preparando seu pedido.'],
    READY: ['Pedido pronto', 'Seu pedido está pronto para retirada, consumo ou entrega combinada.'],
    COMPLETED: ['Pedido concluído', 'Obrigado por pedir no Kipeixe.'],
    REJECTED: ['Pedido recusado', 'O restaurante recusou o pedido. O estorno será solicitado ao Asaas.'],
    AUTO_REJECTED: ['Prazo esgotado', 'O pedido foi recusado automaticamente. O estorno será solicitado ao Asaas.']
  };

  function showOrderStatus(title, message, link = '') {
    if (!onlineStatus) return;
    onlineStatus.hidden = false;
    onlineStatusTitle.textContent = title;
    onlineStatusMessage.textContent = message;
    if (onlineStatusLink) {
      onlineStatusLink.hidden = !link;
      if (link && /^https:\/\/(?:sandbox\.)?asaas\.com\//.test(link)) onlineStatusLink.href = link;
    }
    if (onlineStatusRefresh) onlineStatusRefresh.hidden = !currentOrder;
  }

  async function checkOrderStatus() {
    if (!currentOrder?.orderId || !currentOrder?.accessToken) return;
    try {
      const response = await fetch(`${API}/api/orders/${encodeURIComponent(currentOrder.orderId)}`, {
        headers: { Authorization: `Bearer ${currentOrder.accessToken}` },
        cache: 'no-store'
      });
      if (!response.ok) throw Error('Não foi possível consultar o pedido.');
      const data = await response.json();
      if (currentOrder?.reviewUnresolved && ['PAID', 'EXPIRED', 'CANCELED'].includes(data.paymentStatus)) {
        currentOrder.reviewUnresolved = false;
        safeStorage.set('kipeixe_current_order_v2', currentOrder);
      }
      const [title, description] = orderMessages[data.orderStatus] ||
        ['Acompanhando pedido', 'O restaurante está atualizando a situação.'];
      const paymentText = data.paymentStatus === 'PAID' ? '' :
        data.paymentStatus === 'PENDING' ? ' Pagamento ainda não confirmado.' :
        data.paymentStatus === 'CANCELED' || data.paymentStatus === 'EXPIRED' ? ' Pagamento encerrado.' :
        data.paymentStatus === 'REVIEW' ? ' Pagamento não confirmado. Aguarde conferência do restaurante.' : '';
      const refundText = data.refundStatus === 'REVIEW' ? ' Estorno precisa de conferência do restaurante.' :
        data.refundStatus === 'REQUESTED' ? ' Estorno solicitado.' :
        data.refundStatus === 'REFUNDED' ? ' Estorno confirmado.' : '';
      const courierText = data.uberStatus && !['QUOTED'].includes(data.uberStatus)
        ? ' Uber Direct: ' + ({
          pending: 'procurando entregador', pickup: 'entregador a caminho do restaurante',
          pickup_complete: 'pedido retirado', dropoff: 'entregador a caminho do destino',
          delivered: 'entrega concluída', PRICE_CHANGED: 'frete alterado; restaurante revisando',
          REVIEW: 'solicitação em verificação', FAILED: 'restaurante verificando a entrega',
        }[data.uberStatus] || 'em acompanhamento') + '.' : '';
      const ifoodText = data.ifoodStatus && data.ifoodStatus !== 'QUOTED'
        ? ' iFood: ' + ({
          REQUESTED: 'entrega solicitada', DELIVERY_IN_TRANSIT: 'entregador a caminho',
          DELIVERY_CONCLUDED: 'pedido entregue', DELIVERY_CANCELLED: 'entrega cancelada',
          PRICE_CHANGED: 'frete alterado; restaurante analisando',
          REVIEW: 'solicitação em verificação', FAILED: 'restaurante verificando a entrega',
        }[data.ifoodStatus] || 'em acompanhamento') +
          '. Para receber, confirme os últimos 4 dígitos do seu telefone com o entregador.' : '';
      showOrderStatus(title, description + paymentText + refundText + courierText + ifoodText,
        data.paymentStatus === 'PENDING' ? data.checkoutUrl : '');
      if (data.paymentMethod === 'PIX') {
        if (data.pix) displayPix(data.pix, data.totalCents);
        updatePixProgress(data.paymentStatus);
        if (currentOrder?.pixPending && ['PAID', 'EXPIRED', 'CANCELED'].includes(data.paymentStatus)) {
          currentOrder.pixPending = false;
          safeStorage.set('kipeixe_current_order_v2', currentOrder);
        }
      }
      if (uberTrackingLink) {
        let safeTracking = null;
        try {
          const url = new URL(data.deliveryProvider === 'ifood' ? data.ifoodTrackingUrl : data.uberTrackingUrl);
          if (url.protocol === 'https:' &&
              (data.deliveryProvider === 'ifood'
                ? (url.hostname === 'ifood.com.br' || url.hostname.endsWith('.ifood.com.br'))
                : ['uber.com', 'ubereats.com'].some(domain =>
                  url.hostname === domain || url.hostname.endsWith('.' + domain)))) safeTracking = url.href;
        } catch {}
        uberTrackingLink.hidden = !safeTracking;
        if (safeTracking) uberTrackingLink.href = safeTracking;
        uberTrackingLink.textContent = data.deliveryProvider === 'ifood'
          ? 'Acompanhar entregador iFood' : 'Acompanhar entregador Uber';
      }
      if (['COMPLETED', 'REJECTED', 'AUTO_REJECTED'].includes(data.orderStatus) &&
          !['PENDING', 'REVIEW', 'PROCESSING'].includes(data.refundStatus)) {
        clearInterval(statusInterval);
        statusInterval = null;
      }
    } catch {
      showOrderStatus('Pedido registrado', 'Atualização temporariamente indisponível. Tente novamente.');
    }
  }

  async function startOnlineCheckout() {
    if (paymentBusy) return;
    if (currentOrder?.reviewUnresolved || currentOrder?.pixPending) {
      showOrderStatus('Pedido aguardando conferência',
        'Já existe um pedido com pagamento pendente. Confira o Pix antes de criar outra cobrança.');
      await checkOrderStatus();
      if (currentOrder?.pixPending && availablePix) openPix();
      return;
    }
    if (!storeConfig?.onlinePaymentEnabled) {
      showOrderStatus('Pagamento indisponível', 'O serviço de pagamento não está disponível. Nenhum pedido foi enviado.');
      return;
    }
    if (!validateScheduleChoice()) return;
    const data = new FormData(orderForm);
    const name = String(data.get('name') || '').trim();
    const phone = String(data.get('phone') || '').replace(/\D/g, '');
    const type = String(data.get('type') || '');
    const address = String(data.get('address') || '').trim();
    const mode = String(data.get('mode') || 'immediate');
    const dateInput = String(data.get('scheduledAt') || '');
    const paymentMethod = String(data.get('paymentMethod') || '');
    setFieldError(nameInput, nameError, name.length < 2);
    setFieldError(phoneInput, phoneError, phone.length < 10 || phone.length > 13);
    setFieldError(addressInput, addressError, type === 'Entrega' && !address);
    if (!cart.length || name.length < 2 || phone.length < 10 || phone.length > 13 || type === 'Entrega' && !address) {
      showOrderStatus('Confira os dados', !cart.length
        ? 'Adicione um produto antes de continuar.'
        : 'Informe seu nome, telefone com DDD e endereço quando necessário.');
      if (name.length < 2) nameInput?.focus();
      else if (phone.length < 10 || phone.length > 13) phoneInput?.focus();
      else if (type === 'Entrega' && !address) addressInput?.focus();
      return;
    }
    if (!['PIX', 'CREDIT_CARD'].includes(paymentMethod)) {
      showOrderStatus('Escolha como pagar', 'Selecione Pix ou cartão de crédito antes de continuar.');
      qs('input[name="paymentMethod"]', orderForm)?.focus();
      return;
    }
    if (type === 'Entrega' && (!deliveryQuote || deliveryQuote.address !== address ||
        Date.parse(deliveryQuote.expiresAt) < Date.now() + 30000)) {
      deliveryQuoteStatus.textContent = 'Calcule ou atualize a taxa de entrega antes de pagar.';
      deliveryQuoteButton?.focus();
      return;
    }
    if (mode === 'scheduled' && !dateInput) {
      scheduleInput?.focus();
      showOrderStatus('Escolha a data', 'Selecione o horário desejado antes de pagar.');
      return;
    }
    const scheduleDate = mode === 'scheduled' ? new Date(dateInput + ':00-03:00') : null;
    if (mode === 'scheduled' && !Number.isFinite(scheduleDate.getTime())) {
      showOrderStatus('Horário inválido', 'Informe uma data e hora válidas.');
      return;
    }
    const scheduledAt = scheduleDate?.toISOString() || null;
    const attempt = {
      requestId: crypto.randomUUID(), accessToken: crypto.randomUUID(),
      customer: { name, phone, type, address, notes: String(data.get('notes') || '') },
      mode, scheduledAt, paymentMethod,
      items: cart.map(item => ({ productId: item.productId || undefined,
        name: item.name, variant: item.variant || '', qty: item.qty })),
      deliveryQuoteId: type === 'Entrega' ? deliveryQuote.quoteId : null,
      ifoodAddress: type === 'Entrega' && isIFood() ? currentIFoodAddress() : null,
      expectedTotalCents: Math.round(cartValue() * 100) +
        (type === 'Entrega' ? Number(deliveryQuote.feeCents) : 0)
    };
    paymentBusy = true;
    onlineButton.disabled = true;
    showOrderStatus('Preparando pagamento', 'Validando os preços e criando o checkout seguro.');
    try {
      const response = await fetch(`${API}/api/orders`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attempt)
      });
      const result = await response.json();
      if (!response.ok) {
        if (result?.paymentStatus === 'REVIEW' && /^[0-9a-f-]{36}$/i.test(result.orderId || '')) {
          currentOrder = { orderId: result.orderId, accessToken: attempt.accessToken, reviewUnresolved: true };
          safeStorage.set('kipeixe_current_order_v2', currentOrder);
        }
        throw Error(result.error || 'Falha ao iniciar pagamento.');
      }
      if (result.paymentMode !== storeConfig.paymentMode) throw Error('Ambiente de pagamento mudou. Atualize o cardápio.');
      currentOrder = { orderId: result.orderId, accessToken: attempt.accessToken };
      if (paymentMethod === 'PIX') { currentOrder.hasPix = true; currentOrder.pixPending = true; }
      safeStorage.set('kipeixe_current_order_v2', currentOrder);
      track('InitiateCheckout', {
        value: cartValue(), currency: 'BRL', num_items: cartCount(),
        content_type: 'product', contents: cart.map(item => ({
          id: item.id, quantity: item.qty, item_price: item.price
        }))
      });
      if (paymentMethod === 'PIX') {
        if (!displayPix(result.pix, result.totalCents)) throw Error('QR Code inválido retornado pelo Asaas. Consulte o pedido antes de tentar novamente.');
        updatePixProgress('PENDING');
        showOrderStatus('Aguardando Pix', 'Escaneie o QR Code ou copie o código Pix para pagar.');
        paymentBusy = false;
        openPix();
        return;
      }
      if (!/^https:\/\/(?:sandbox\.)?asaas\.com\/checkoutSession\/show\?id=/.test(result.checkoutUrl)) throw Error('Link de pagamento inválido.');
      window.location.assign(result.checkoutUrl);
    } catch (error) {
      showOrderStatus('Pagamento indisponível', error.message);
      paymentBusy = false;
      await refreshStore();
    }
  }

  onlineStatusRefresh?.addEventListener('click', checkOrderStatus);

  orderForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await startOnlineCheckout();
  });

  renderMenuTabs();
  renderCategory(0, false);
  renderCart();
  window.setInterval(syncSchedule, 30_000);
  window.setInterval(() => {
    if (window.KIPEIXE_API_ENABLED === true) refreshStore();
  }, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      syncSchedule();
      if (window.KIPEIXE_API_ENABLED === true) refreshStore();
    }
  });
  refreshStore().then(() => {
    const returned = new URLSearchParams(location.search);
    if (currentOrder?.orderId && (returned.has('retorno') || returned.has('pedido'))) {
      openCart();
      checkOrderStatus();
      if (!statusInterval) statusInterval = setInterval(checkOrderStatus, 12000);
    }
    if (currentOrder?.hasPix && !returned.has('retorno') && !returned.has('pedido')) {
      checkOrderStatus();
    }
    applyProductDeepLink();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (pixDrawer?.classList.contains('is-open')) { closePix(); return; }
      closePhoto();
      closeCart();
    }
  });
})();
