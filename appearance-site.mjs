import { PAGE_NAMES, ELEMENT_SWATCHES, validateAppearance, emptyAppearance, makeAppearanceCss } from './appearance-config.mjs';

const stylesheet = document.createElement('style');
stylesheet.id = 'kipeixe-live-appearance';
document.head.append(stylesheet);
let appearance = emptyAppearance();
let pickerEnabled = false;
let hoverTarget = null;
let selectedTarget = null;
let selectedInfo = null;
let palette = null;
const preview = window.parent !== window && new URLSearchParams(location.search).has('theme_editor');
const allowedPage = page => Object.hasOwn(PAGE_NAMES, page);

// Visual preview is read-only: never create real orders, payments or delivery requests.
if (preview) {
  const browserFetch = window.fetch.bind(window);
  window.fetch = (input, options) => {
    const method = String(options?.method || input?.method || 'GET').toUpperCase();
    if (!['GET','HEAD','OPTIONS'].includes(method))
      return Promise.reject(new Error('Prévia visual: operações de escrita desativadas.'));
    return browserFetch(input, options);
  };
  document.addEventListener('click', event => {
    if (pickerEnabled) return;
    const link = event.target.closest?.('a[href]');
    if (link && (link.origin !== location.origin || !link.hash.startsWith('#'))) event.preventDefault();
  }, true);
}


function render(data) {
  try { appearance = validateAppearance(data); } catch { return; }
  stylesheet.textContent = makeAppearanceCss(appearance);
  for (const node of document.querySelectorAll('.site-page[data-page]')) {
    const key = node.dataset.page;
    const modified = Object.keys(appearance.pages[key] || {}).length || (appearance.elements[key] || []).length;
    if (modified) node.setAttribute('data-theme-active','');
    else node.removeAttribute('data-theme-active');
  }
}
function stopHover() {
  if (hoverTarget) hoverTarget.classList.remove('appearance-editor-hover');
  hoverTarget = null;
}
function selectMode(enabled) {
  pickerEnabled = Boolean(enabled) && preview;
  stopHover();
  if (!pickerEnabled) clearSelection();
  document.documentElement.classList.toggle('appearance-picking',pickerEnabled);
}
function clearSelection() {
  selectedTarget?.classList.remove('appearance-editor-selected');
  selectedTarget = null;selectedInfo = null;
  if (palette) palette.hidden = true;
}
function elementSelector(element, container) {
  const parts=[];
  for (let n=element; n && n!==container; n=n.parentElement) {
    const siblings=[...(n.parentElement?.children || [])].filter(s=>s.tagName===n.tagName);
    const index=siblings.indexOf(n)+1;
    if (index<1 || index>999 || parts.length>=16) return '';
    parts.unshift(n.tagName.toLowerCase()+`:nth-of-type(${index})`);
  }
  return parts.join(' > ');
}
function hex(value) {
  const m=String(value).match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? '#'+m.slice(1,4).map(n=>Math.min(255,Number(n)).toString(16).padStart(2,'0')).join('') : '#ffffff';
}

if (preview) {
  // All of this interface exists only in the owner-only preview iframe.
  const editorStyle = document.createElement('style');
  editorStyle.textContent = `
    .appearance-picking .appearance-editor-hover:not(.appearance-editor-selected) {
      outline: 2px dashed #08a6aa !important; outline-offset: 2px !important;
      cursor: crosshair !important;
    }
    .appearance-picking .appearance-editor-selected {
      outline: 3px solid #f07c32 !important; outline-offset: 3px !important;
    }
    .appearance-color-popup {
      position: fixed; z-index: 2147483647; width: min(292px,calc(100vw - 16px));
      box-sizing: border-box; padding: 12px; border: 1px solid #dfd7ce;
      border-radius: 14px; background: #fff; color: #252a27;
      box-shadow: 0 12px 36px rgba(0,0,0,.25);
      font: 13px/1.4 system-ui,Arial,sans-serif;
    }
    .appearance-color-popup[hidden] {display:none !important;}
    .appearance-color-popup * {box-sizing:border-box;}
    .appearance-color-popup-head {display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;}
    .appearance-color-popup-title {font-size:13px;font-weight:800;line-height:1.35;max-width:240px;overflow-wrap:anywhere;}
    .appearance-color-popup-close {width:28px;height:28px;border:0;background:#f3f3f1;border-radius:7px;font-size:19px;color:#333;cursor:pointer;}
    .appearance-color-popup-fields {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;}
    .appearance-color-popup-fields label {display:flex;flex-direction:column;gap:5px;align-items:center;padding:7px 3px;border:1px solid #e7e5df;border-radius:9px;font-size:11px;font-weight:700;color:#434840;text-align:center;}
    .appearance-color-popup-fields label input {width:100%;max-width:72px;height:35px;padding:2px;border:1px solid #cecec8;border-radius:6px;background:#fff;cursor:pointer;}
    .appearance-color-popup-reset {width:100%;margin-top:9px;background:#fff;color:#6b4632;border:1px solid #e6d8ce;border-radius:7px;padding:6px 8px;font:inherit;font-size:11px;font-weight:700;cursor:pointer;}
  `;
  document.head.append(editorStyle);
  palette = document.createElement('aside');
  palette.className = 'appearance-color-popup';
  palette.setAttribute('aria-label','Alterar cores do elemento selecionado');
  palette.hidden = true;
  palette.innerHTML = '<div class="appearance-color-popup-head"><strong class="appearance-color-popup-title"></strong><button type="button" class="appearance-color-popup-close" aria-label="Fechar paleta">×</button></div><div class="appearance-color-popup-fields"></div><button type="button" class="appearance-color-popup-reset">Restaurar cores deste item</button>';
  document.body.append(palette);
  const labelForColor = (scope,key) => scope === 'element'
    ? ({color:'Texto',backgroundColor:'Fundo',borderColor:'Borda'}[key])
    : ({background:'Fundo',text:'Texto',border:'Borda',header:'Fundo',headerText:'Texto',
      footer:'Fundo',footerText:'Texto'}[key] || key);
  const regionKeys = {header:['header','headerText'],footer:['footer','footerText']};
  function colorsFor(target,scope,region) {
    const styles=getComputedStyle(target);
    return scope==='element'
      ? {color:hex(styles.color),backgroundColor:hex(styles.backgroundColor),borderColor:hex(styles.borderTopColor)}
      : scope==='page'
        ? {text:hex(styles.color),background:hex(styles.backgroundColor),border:hex(styles.borderTopColor)}
        : region==='header'
          ? {header:hex(styles.backgroundColor),headerText:hex(styles.color)}
          : {footer:hex(styles.backgroundColor),footerText:hex(styles.color)};
  }
  function palettePosition() {
    if (palette.hidden || !selectedTarget?.isConnected) return;
    const rect = selectedTarget.getBoundingClientRect();
    const left = Math.max(8,Math.min(rect.left,innerWidth-palette.offsetWidth-8));
    const below = rect.bottom + 10;
    const top = below+palette.offsetHeight<=innerHeight-8 ? below : rect.top-palette.offsetHeight-10;
    palette.style.left = left+'px';
    palette.style.top = Math.max(8,Math.min(top,innerHeight-palette.offsetHeight-8))+'px';
  }
  function showPalette(target,info,colors) {
    clearSelection();
    selectedTarget=target;
    selectedInfo=info;
    target.classList.add('appearance-editor-selected');
    palette.querySelector('.appearance-color-popup-title').textContent=info.label;
    const fields=palette.querySelector('.appearance-color-popup-fields');
    fields.replaceChildren();
    const keys=info.scope==='element' ? Object.keys(ELEMENT_SWATCHES) :
      info.scope==='page' ? ['background','text','border'] : regionKeys[info.region];
    fields.style.gridTemplateColumns=`repeat(${keys.length},minmax(0,1fr))`;
    for(const key of keys) {
      const field=document.createElement('label');
      const text=document.createElement('span');
      text.textContent=labelForColor(info.scope,key);
      const input=document.createElement('input');
      input.type='color';input.dataset.appearanceColor=key;
      input.setAttribute('aria-label','Cor: '+text.textContent);
      input.value=colors[key]||'#ffffff';
      field.append(text,input);fields.append(field);
    }
    palette.hidden=false;
    palettePosition();
  }
  palette.querySelector('.appearance-color-popup-close').addEventListener('click',clearSelection);
  palette.querySelector('.appearance-color-popup-reset').addEventListener('click',()=>{
    if (!selectedInfo) return;
    window.parent.postMessage({type:'kipeixe:appearance-quick-reset',...selectedInfo},location.origin);
  });
  palette.addEventListener('input',event=>{
    const input=event.target.closest?.('input[data-appearance-color]');
    if (!input || !selectedInfo) return;
    window.parent.postMessage({type:'kipeixe:appearance-quick-color',
      ...selectedInfo,key:input.dataset.appearanceColor,color:input.value},location.origin);
  });
  const placeOnScroll = () => palettePosition();
  window.addEventListener('scroll',placeOnScroll,true);
  window.addEventListener('resize',placeOnScroll);
  function pickingTarget(node) {
    let e=node instanceof Element ? node : node?.parentElement;
    if (!e || palette.contains(e)) return null;
    // Clicking an icon within a button should select the full button.
    const interactive=e.closest('button,a');
    if (interactive) e=interactive;
    if (e.classList.contains('menu-entry-photo-button')) e=e.closest('.menu-entry')||e;
    const section=e.closest('.site-page[data-page]');
    if (section) return {target:e,section,scope:e===section?'page':'element'};
    const header=e.closest('.site-header');
    if (header) return {target:header,scope:'global',region:'header'};
    const footer=e.closest('.footer');
    if (footer) return {target:footer,scope:'global',region:'footer'};
    return null;
  }
  document.addEventListener('mouseover',event=>{
    if (!pickerEnabled) return;
    const choice=pickingTarget(event.target);
    if (choice?.target===hoverTarget) return;
    stopHover();
    if (choice) {hoverTarget=choice.target;hoverTarget.classList.add('appearance-editor-hover');}
  },true);
  document.addEventListener('click',event=>{
    if (!pickerEnabled) return;
    if (palette.contains(event.target)) return;
    const choice=pickingTarget(event.target);
    if (!choice) return;
    event.preventDefault();event.stopImmediatePropagation();
    const {target,section,scope,region}=choice;
    const selector=scope==='element'?elementSelector(target,section):'';
    if (scope==='element' && !selector) return;
    const title=(target.getAttribute('aria-label')||target.textContent||target.getAttribute('alt')||target.tagName).trim().replace(/\s+/g,' ').slice(0,42);
    const label=scope==='global'?({header:'Cabeçalho do site',footer:'Rodapé do site'}[region]):
      scope==='page'?'Fundo da página':(title||target.tagName);
    const colors=colorsFor(target,scope,region);
    const info={scope,region,selector,page:section?.dataset.page||'',label};
    showPalette(target,info,colors);
    window.parent.postMessage({type:'kipeixe:appearance-picked',...info,colors},location.origin);
  },true);
  window.addEventListener('message',event=>{
    if (event.source!==window.parent || event.origin!==location.origin) return;
    if (event.data?.type==='kipeixe:appearance-theme') {
      render(event.data.appearance);
      window.__kipeixeAppearanceReveal?.();
      const page=event.data.page;
      if (allowedPage(page) && location.hash!==`#${page}`) location.hash=`#${page}`;
      if (selectedInfo?.page && selectedInfo.page!==page) clearSelection();
      requestAnimationFrame(()=>{
        if (selectedTarget?.isConnected && selectedInfo && !palette.hidden) {
          const colors=colorsFor(selectedTarget,selectedInfo.scope,selectedInfo.region);
          palette.querySelectorAll('input[data-appearance-color]').forEach(input=>{
            if (input!==document.activeElement && colors[input.dataset.appearanceColor])
              input.value=colors[input.dataset.appearanceColor];
          });
        }
        palettePosition();
      });
    }
    if (event.data?.type==='kipeixe:appearance-pick-mode') selectMode(event.data.enabled);
    if (event.data?.type==='kipeixe:appearance-clear-selection') clearSelection();
  });
  window.parent.postMessage({type:'kipeixe:appearance-ready'},location.origin);
}

const appearanceRequest = window.__kipeixeAppearancePromise
  || fetch((location.hostname==='127.0.0.1'?'http://127.0.0.1:8787':'https://api.restaurantekipeixe.com.br')+'/api/appearance',
    {cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null);
appearanceRequest.then(data => { if (data && !preview) render(data); })
  .catch(() => {})
  .finally(() => { if (!preview) window.__kipeixeAppearanceReveal?.(); });
