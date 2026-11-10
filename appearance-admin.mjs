import { PAGE_NAMES, PAGE_SWATCHES, GLOBAL_SWATCHES, ELEMENT_SWATCHES,
  emptyAppearance, validateAppearance, isSafeElementSelector } from './appearance-config.mjs';

const $ = id => document.getElementById(id);
const API = location.hostname === '127.0.0.1' ? 'http://127.0.0.1:8787' : 'https://api.restaurantekipeixe.com.br';
const preview = $('appearance-preview');
let draft = emptyAppearance();
let saved = emptyAppearance();
let page = 'cardapio';
let loaded = false;
let picked = null;
let picking = true;
const copy = value => JSON.parse(JSON.stringify(value));
const changed = () => JSON.stringify(draft) !== JSON.stringify(saved);
const validHex = value => /^#[0-9a-f]{6}$/i.test(value);
function status(message, error = false) {
  $('appearance-status').textContent = message;
  $('appearance-status').classList.toggle('is-error', error);
}
async function api(path, method = 'GET', data) {
  const response = await fetch(API+path, { method, credentials:'include', cache:'no-store',
    headers: data ? {'Content-Type':'application/json'} : {},
    ...(data ? {body:JSON.stringify(data)} : {}) });
  const body = await response.json().catch(()=>({}));
  if (!response.ok) throw Error(body.error || `HTTP ${response.status}`);
  return body;
}
function sendLive() {
  if (!loaded) return;
  preview.contentWindow?.postMessage({type:'kipeixe:appearance-theme',appearance:draft,page},location.origin);
  status(changed() ? 'Alterações em prévia — clique em “Publicar cores no site” para salvar.' : 'As cores estão salvas no site.');
  $('appearance-element-summary').textContent = `${draft.elements[page]?.length || 0} elemento(s) personalizado(s) nesta página.`;
}
const PAGE_PICK_SWATCHES = Object.freeze({
  background:['Fundo','#fff9f1'],text:['Texto','#2c241d'],border:['Borda','#d4c6b7'],
});
const GLOBAL_PICK_SWATCHES = Object.freeze({
  header: {header:['Fundo','#173527'],headerText:['Texto','#ffffff']},
  footer: {footer:['Fundo','#2b2019'],footerText:['Texto','#ffffff']},
});
function pickedDefinition(selection) {
  if (selection?.scope==='element' && isSafeElementSelector(selection.selector)) return ELEMENT_SWATCHES;
  if (selection?.scope==='page') return PAGE_PICK_SWATCHES;
  if (selection?.scope==='global') return GLOBAL_PICK_SWATCHES[selection.region];
  return null;
}
function changePicked(key,value) {
  if (!picked || !validHex(value) || !Object.hasOwn(pickedDefinition(picked)||{},key)) return;
  if (picked.scope==='page') {
    (draft.pages[page] ||= {})[key]=value;
  } else if (picked.scope==='global') {
    draft.global[key]=value;
  } else {
    const items=(draft.elements[page] ||= []);
    let entry=items.find(item=>item.selector===picked.selector);
    if (!entry) {
      if (items.length>=80) {status('Limite de 80 elementos por página.',true);return;}
      entry={selector:picked.selector,colors:{}};items.push(entry);
    }
    entry.colors[key]=value;
  }
  const source=picked.scope==='page'?'appearance-page-swatches':
    picked.scope==='global'?'appearance-global-swatches':null;
  if (source) {
    const field=document.getElementById(`appearance-${source}-${key}`);
    if (field) {
      field.value=value;
      const code=field.closest('.appearance-swatch')?.querySelector('code');
      if (code) code.textContent=value;
    }
  }
  sendLive();
}
function removePicked() {
  if (!picked) return;
  if (picked.scope==='element') {
    draft.elements[page]=(draft.elements[page]||[]).filter(item=>item.selector!==picked.selector);
    if (!draft.elements[page].length) delete draft.elements[page];
  } else if (picked.scope==='page') {
    for (const key of Object.keys(PAGE_PICK_SWATCHES)) delete draft.pages[page]?.[key];
    swatches($('appearance-page-swatches'),PAGE_SWATCHES,draft.pages[page]||{},(key,value)=>{
      (draft.pages[page] ||= {})[key]=value;
    });
  } else if (picked.scope==='global') {
    for (const key of Object.keys(GLOBAL_PICK_SWATCHES[picked.region]||{})) delete draft.global[key];
    swatches($('appearance-global-swatches'),GLOBAL_SWATCHES,draft.global,(key,value)=>{
      draft.global[key]=value;
    });
  }
  picked=null;
  $('appearance-picked').hidden=true;
  preview.contentWindow?.postMessage({type:'kipeixe:appearance-clear-selection'},location.origin);
  sendLive();
}
function swatches(container, definition, values, change) {
  container.replaceChildren();
  for (const [key, [label, defaultColor]] of Object.entries(definition)) {
    const row = document.createElement('div');row.className='appearance-swatch';
    const name = document.createElement('label'); name.textContent=label;
    const input=document.createElement('input');input.type='color';input.value=values?.[key]||defaultColor;
    const output=document.createElement('code');output.textContent=input.value;
    name.htmlFor=input.id=`appearance-${container.id}-${key}`;
    input.addEventListener('input',()=>{
      if (!validHex(input.value)) return;
      output.textContent=input.value;change(key,input.value);
      sendLive();
    });
    row.append(name,input,output);container.append(row);
  }
}
function drawPage() {
  $('appearance-page-shortcut').value=page;
  const colors=draft.pages[page]||{};
  swatches($('appearance-page-swatches'),PAGE_SWATCHES,colors,(key,value)=>{
    (draft.pages[page] ||= {})[key]=value;
  });
  picked=null;
  $('appearance-picked').hidden=true;
  picking=true;
  $('appearance-pick').textContent='Pausar seleção';
  $('appearance-pick').setAttribute('aria-pressed','true');
  $('appearance-selection-help').textContent='Clique em qualquer elemento da prévia. A paleta aparece ao lado do item selecionado.';
  preview.contentWindow?.postMessage({type:'kipeixe:appearance-clear-selection'},location.origin);
  preview.contentWindow?.postMessage({type:'kipeixe:appearance-pick-mode',enabled:true},location.origin);
  sendLive();
}
function showPicked(selection) {
  const definition=pickedDefinition(selection);
  if (!definition) {status('Não foi possível selecionar esse elemento.',true);return;}
  const {scope,selector='',region='',label='Elemento',colors={}}=selection;
  picked={scope,selector,region,label,computed:colors};
  $('appearance-picked').hidden=false;
  $('appearance-picked-name').textContent=`Selecionado na prévia: ${label}`;
  $('appearance-selection-help').textContent='Mude as cores na paleta sobre o item, ou ajuste os mesmos controles abaixo.';
  const stored=scope==='element' ? (draft.elements[page]||[]).find(e=>e.selector===selector)?.colors :
    scope==='page' ? draft.pages[page] : draft.global;
  swatches($('appearance-element-swatches'),definition,{...colors,...stored},changePicked);
  $('appearance-remove-element').textContent=scope==='element'?'Restaurar cores deste elemento':'Restaurar estas cores';
}
async function load() {
  if (loaded) return;
  status('Carregando cores publicadas…');
  try {
    const data=await api('/api/admin/appearance');
    draft=validateAppearance(data);saved=copy(draft);loaded=true;
    swatches($('appearance-global-swatches'),GLOBAL_SWATCHES,draft.global,(key,value)=>{draft.global[key]=value;});
    drawPage();
  } catch(error) {status('Falha ao carregar: '+error.message,true);}
}
$('appearance-page').replaceChildren(...Object.entries(PAGE_NAMES).map(([id,name])=>{
  const option=document.createElement('option');option.value=id;option.textContent=name;return option;
}));
$('appearance-page-shortcut').replaceChildren(...[...$('appearance-page').options].map(option=>option.cloneNode(true)));
$('appearance-page').value=page;
$('appearance-page-shortcut').value=page;
$('appearance-page').addEventListener('change',event=>{
  if (!(event.target.value in PAGE_NAMES)) return;
  page=event.target.value;drawPage();
});
$('appearance-page-shortcut').addEventListener('change',event=>{
  if (!(event.target.value in PAGE_NAMES)) return;
  page=event.target.value;
  $('appearance-page').value=page;
  drawPage();
});
$('appearance-pick').addEventListener('click',()=>{
  picking=!picking;
  $('appearance-pick').textContent=picking?'Pausar seleção':'Ativar seleção';
  $('appearance-pick').setAttribute('aria-pressed',String(picking));
  preview.contentWindow?.postMessage({type:'kipeixe:appearance-pick-mode',enabled:picking},location.origin);
  status(picking?'Clique no elemento desejado na prévia.':'Seleção pausada. Clique em “Ativar seleção” para editar de novo.');
});
$('appearance-reset-page').addEventListener('click',()=>{
  delete draft.pages[page];delete draft.elements[page];drawPage();
});
$('appearance-remove-element').addEventListener('click',()=>{
  removePicked();
});
$('appearance-discard').addEventListener('click',()=>{
  draft=copy(saved);
  swatches($('appearance-global-swatches'),GLOBAL_SWATCHES,draft.global,(key,value)=>{draft.global[key]=value;});
  drawPage();
});
$('appearance-save').addEventListener('click',async()=>{
  if (!loaded) return;
  const button=$('appearance-save');button.disabled=true;
  status('Publicando alterações…');
  try {
    const cleaned=validateAppearance(draft);
    await api('/api/admin/appearance','PUT',cleaned);
    saved=copy(cleaned);draft=cleaned;
    status('Publicado! As cores já estão disponíveis aos visitantes.');
  } catch(error) {status('Erro ao salvar: '+error.message,true);}
  finally {button.disabled=false;}
});
for (const btn of document.querySelectorAll('[data-appearance-device]')) {
  btn.addEventListener('click',()=>{
    $('appearance-viewport').classList.toggle('is-mobile',btn.dataset.appearanceDevice==='mobile');
    document.querySelectorAll('[data-appearance-device]').forEach(b=>b.classList.toggle('is-selected',b===btn));
  });
}
preview.addEventListener('load',()=>{
  if (!loaded) return;
  sendLive();
  preview.contentWindow?.postMessage({type:'kipeixe:appearance-pick-mode',enabled:picking},location.origin);
});
window.addEventListener('message',event=>{
  if (event.origin!==location.origin || event.source!==preview.contentWindow) return;
  if (event.data?.type==='kipeixe:appearance-ready' && loaded) {
    sendLive();
    preview.contentWindow?.postMessage({type:'kipeixe:appearance-pick-mode',enabled:picking},location.origin);
  }
  if (event.data?.type==='kipeixe:appearance-picked') {
    if (event.data.scope!=='global' && !(event.data.page in PAGE_NAMES)) return;
    if (event.data.scope!=='global' && page!==event.data.page) {
      page=event.data.page;$('appearance-page').value=page;drawPage();
    }
    showPicked(event.data);
    status('Elemento selecionado. Escolha uma cor na paleta que apareceu sobre a prévia.');
  }
  if (event.data?.type==='kipeixe:appearance-quick-color') {
    if (!picked || event.data.scope!==picked.scope || (event.data.selector||'')!==picked.selector ||
        (event.data.region||'')!==picked.region || (picked.scope!=='global' && event.data.page!==page)) return;
    if (!validHex(event.data.color) || !Object.hasOwn(pickedDefinition(picked)||{},event.data.key)) return;
    changePicked(event.data.key,event.data.color);
    showPicked({...picked,colors:{...picked.computed,[event.data.key]:event.data.color}});
  }
  if (event.data?.type==='kipeixe:appearance-quick-reset') {
    if (!picked || event.data.scope!==picked.scope || (event.data.selector||'')!==picked.selector ||
        (event.data.region||'')!==picked.region || (picked.scope!=='global' && event.data.page!==page)) return;
    removePicked();
  }
});
document.addEventListener('kipeixe:appearance-open',load);
