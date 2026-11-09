import { PAGE_NAMES, validateAppearance, emptyAppearance, makeAppearanceCss } from './appearance-config.mjs';

const stylesheet = document.createElement('style');
stylesheet.id = 'kipeixe-live-appearance';
document.head.append(stylesheet);
let appearance = emptyAppearance();
let pickerEnabled = false;
let hoverTarget = null;
const preview = window.parent !== window && new URLSearchParams(location.search).has('theme_editor');
const allowedPage = page => Object.hasOwn(PAGE_NAMES, page);

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
  if (hoverTarget) hoverTarget.style.removeProperty('outline');
  if (hoverTarget) hoverTarget.style.removeProperty('outline-offset');
  hoverTarget = null;
}
function selectMode(enabled) {
  pickerEnabled = Boolean(enabled) && preview;
  stopHover();
  document.documentElement.classList.toggle('appearance-picking',pickerEnabled);
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
  document.addEventListener('mouseover',event=>{
    if (!pickerEnabled) return;
    const e=event.target.closest?.('*');
    if (!e?.closest?.('.site-page[data-page]')) return;
    stopHover();hoverTarget=e;
    hoverTarget.style.setProperty('outline','2px dashed #00bcd4','important');
    hoverTarget.style.setProperty('outline-offset','2px','important');
  },true);
  document.addEventListener('click',event=>{
    if (!pickerEnabled) return;
    const e=event.target.closest?.('*');
    const section=e?.closest?.('.site-page[data-page]');
    if (!section || section===e) return;
    event.preventDefault();event.stopImmediatePropagation();
    const selector=elementSelector(e,section);
    if (!selector) return;
    const styles=getComputedStyle(e);
    window.parent.postMessage({type:'kipeixe:appearance-picked',page:section.dataset.page,selector,
      label:(e.textContent||e.getAttribute('alt')||e.tagName).trim().slice(0,65)||e.tagName,
      colors:{color:hex(styles.color),backgroundColor:hex(styles.backgroundColor),borderColor:hex(styles.borderTopColor)}},location.origin);
    selectMode(false);
  },true);
  window.addEventListener('message',event=>{
    if (event.source!==window.parent || event.origin!==location.origin) return;
    if (event.data?.type==='kipeixe:appearance-theme') {
      render(event.data.appearance);
      const page=event.data.page;
      if (allowedPage(page) && location.hash!==`#${page}`) location.hash=`#${page}`;
    }
    if (event.data?.type==='kipeixe:appearance-pick-mode') selectMode(event.data.enabled);
  });
  window.parent.postMessage({type:'kipeixe:appearance-ready'},location.origin);
}

fetch((location.hostname==='127.0.0.1'?'http://127.0.0.1:8787':'https://api.restaurantekipeixe.com.br')+'/api/appearance',
  {cache:'no-store'}).then(r=>r.ok?r.json():null).then(data=>{if(data && !preview) render(data);})
  .catch(()=>{});
