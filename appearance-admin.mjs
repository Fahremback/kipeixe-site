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
let picking = false;
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
  const colors=draft.pages[page]||{};
  swatches($('appearance-page-swatches'),PAGE_SWATCHES,colors,(key,value)=>{
    (draft.pages[page] ||= {})[key]=value;
  });
  picked=null;
  $('appearance-picked').hidden=true;
  $('appearance-pick').textContent='Selecionar elemento';
  picking=false;
  preview.contentWindow?.postMessage({type:'kipeixe:appearance-pick-mode',enabled:false},location.origin);
  sendLive();
}
function showPicked(name, selector, computed={}) {
  if (!isSafeElementSelector(selector)) { status('Não foi possível selecionar esse elemento.',true);return; }
  picked={selector,name,computed};
  const existing=(draft.elements[page]||[]).find(e=>e.selector===selector);
  $('appearance-picked').hidden=false;
  $('appearance-picked-name').textContent=`Selecionado: ${name}`;
  const base={...computed,...existing?.colors};
  swatches($('appearance-element-swatches'),ELEMENT_SWATCHES,base,(key,value)=>{
    const items=(draft.elements[page] ||= []);
    let entry=items.find(item=>item.selector===selector);
    if (!entry) {if (items.length>=80) {status('Limite de 80 elementos por página.',true);return;} entry={selector,colors:{}};items.push(entry);}
    entry.colors[key]=value;
  });
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
$('appearance-page').value=page;
$('appearance-page').addEventListener('change',event=>{
  if (!(event.target.value in PAGE_NAMES)) return;
  page=event.target.value;drawPage();
});
$('appearance-pick').addEventListener('click',()=>{
  picking=!picking;
  $('appearance-pick').textContent=picking?'Cancelar seleção':'Selecionar elemento';
  preview.contentWindow?.postMessage({type:'kipeixe:appearance-pick-mode',enabled:picking},location.origin);
  status(picking?'Clique no elemento desejado na prévia.':'Seleção cancelada.');
});
$('appearance-reset-page').addEventListener('click',()=>{
  delete draft.pages[page];delete draft.elements[page];drawPage();
});
$('appearance-remove-element').addEventListener('click',()=>{
  if (!picked) return;
  draft.elements[page]=(draft.elements[page]||[]).filter(item=>item.selector!==picked.selector);
  if (!draft.elements[page].length) delete draft.elements[page];
  picked=null;$('appearance-picked').hidden=true;sendLive();
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
preview.addEventListener('load',()=>{if (loaded) sendLive();});
window.addEventListener('message',event=>{
  if (event.origin!==location.origin || event.source!==preview.contentWindow) return;
  if (event.data?.type==='kipeixe:appearance-ready' && loaded) sendLive();
  if (event.data?.type==='kipeixe:appearance-picked') {
    if (!(event.data.page in PAGE_NAMES)) return;
    if (page!==event.data.page) {
      page=event.data.page;$('appearance-page').value=page;drawPage();
    }
    picking=false;$('appearance-pick').textContent='Selecionar elemento';
    showPicked(event.data.label||'Elemento',event.data.selector,event.data.colors||{});
    status('Elemento selecionado. Altere uma das três cores e veja a prévia.');
  }
});
document.addEventListener('kipeixe:appearance-open',load);
