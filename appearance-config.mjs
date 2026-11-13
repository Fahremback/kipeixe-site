// Shared by the public site, visual editor, and API. Never accept arbitrary CSS.
export const PAGE_NAMES = Object.freeze({
  inicio: 'O Kipeixe', cardapio: 'Cardápio', ambiente: 'Ambiente',
  pesque: 'Pesque-pague', contato: 'Contato',
});
export const GLOBAL_SWATCHES = Object.freeze({
  header: ['Fundo do cabeçalho', '#173527'], headerText: ['Texto do cabeçalho', '#ffffff'],
  footer: ['Fundo do rodapé', '#2b2019'], footerText: ['Texto do rodapé', '#ffffff'],
  cart: ['Fundo do carrinho', '#2b2019'], cartText: ['Texto do carrinho', '#ffffff'],
  cartButton: ['Botão de finalizar', '#b94521'], cartButtonText: ['Texto do botão', '#ffffff'],
});
export const PAGE_SWATCHES = Object.freeze({
  background: ['Fundo da página', '#fff9f1'],
  surface: ['Caixas e superfícies', '#ffffff'],
  surfaceAlt: ['Superfícies secundárias', '#f7eadb'],
  text: ['Texto principal', '#2c241d'],
  muted: ['Texto secundário', '#756357'],
  accent: ['Destaques e botões', '#b94521'],
  accentHover: ['Botão ao passar mouse', '#de8142'],
  accentText: ['Texto sobre destaque', '#ffffff'],
  dark: ['Seções escuras', '#2b2019'],
  darkSoft: ['Variação das seções escuras', '#805438'],
  darkText: ['Texto sobre fundo escuro', '#ffffff'],
  border: ['Bordas', '#d4c6b7'],
  heroOverlay: ['Sobreposição das fotos', '#2b2019'],
  heroText: ['Texto sobre fotos', '#ffffff'],
  card: ['Fundo dos cartões', '#ffffff'],
  cardText: ['Texto dos cartões', '#2c241d'],
});
export const ELEMENT_SWATCHES = Object.freeze({
  color: ['Cor do texto', '#2c241d'],
  backgroundColor: ['Cor do fundo', '#ffffff'],
  borderColor: ['Cor da borda', '#d4c6b7'],
});
const COLOR = /^#[0-9a-fA-F]{6}$/;
const SEGMENT = '[a-z][a-z0-9-]*:nth-of-type\\([1-9][0-9]{0,2}\\)';
const SAFE_SELECTOR = new RegExp('^' + SEGMENT + '(?: > ' + SEGMENT + '){0,15}$');
export const cleanColor = value => typeof value === 'string' && COLOR.test(value)
  ? value.toLowerCase() : null;
export const isSafeElementSelector = selector => typeof selector === 'string' &&
  selector.length <= 440 && SAFE_SELECTOR.test(selector);
export const emptyAppearance = () => ({ version: 1, global: {}, pages: {}, elements: {} });

// Strict validation also prevents untrusted values from becoming CSS selectors/properties.
export function validateAppearance(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1)
    throw Error('Formato da aparência inválido.');
  const serialized = JSON.stringify(value);
  if (!serialized || serialized.length > 40000) throw Error('Configuração de cores muito grande.');
  const result = emptyAppearance();
  for (const [scope, swatches] of [['global', GLOBAL_SWATCHES], ...Object.keys(PAGE_NAMES).map(page => [page, PAGE_SWATCHES])]) {
    const provided = scope === 'global' ? (value.global || {}) : (value.pages?.[scope] || {});
    if (typeof provided !== 'object' || !provided || Array.isArray(provided))
      throw Error('Conjunto de cores inválido.');
    const destination = scope === 'global' ? result.global : (result.pages[scope] = {});
    for (const [key, color] of Object.entries(provided)) {
      if (!Object.hasOwn(swatches, key) || !cleanColor(color)) throw Error('Cor inválida: ' + key);
      destination[key] = cleanColor(color);
    }
  }
  if (value.pages && Object.keys(value.pages).some(key => !Object.hasOwn(PAGE_NAMES,key)))
    throw Error('Página desconhecida.');
  if (value.global && Object.keys(value.global).some(key => !Object.hasOwn(GLOBAL_SWATCHES,key)))
    throw Error('Cor global desconhecida.');
  if (value.elements && (typeof value.elements !== 'object' || Array.isArray(value.elements)))
    throw Error('Elementos inválidos.');
  for (const [page, entries] of Object.entries(value.elements || {})) {
    if (!Object.hasOwn(PAGE_NAMES,page) || !Array.isArray(entries) || entries.length > 80)
      throw Error('Lista de elementos inválida.');
    const seen = new Set();
    result.elements[page] = entries.map(entry => {
      if (!entry || typeof entry !== 'object' || !isSafeElementSelector(entry.selector) ||
          seen.has(entry.selector) || !entry.colors || typeof entry.colors !== 'object')
        throw Error('Seletor de elemento inválido.');
      seen.add(entry.selector);
      const colors = {};
      for (const [key, color] of Object.entries(entry.colors)) {
        if (!Object.hasOwn(ELEMENT_SWATCHES,key) || !cleanColor(color)) throw Error('Cor do elemento inválida.');
        colors[key] = cleanColor(color);
      }
      return { selector: entry.selector, colors };
    });
  }
  return result;
}

export function makeAppearanceCss(data) {
  const theme = validateAppearance(data);
  const rules = [];
  const globalMap = {
    header: '--theme-header', headerText: '--theme-header-text',
    footer: '--theme-footer', footerText: '--theme-footer-text',
    cart: '--theme-cart', cartText: '--theme-cart-text',
    cartButton: '--theme-cart-button', cartButtonText: '--theme-cart-button-text',
  };
  const rootVars = Object.entries(theme.global).map(([key,value]) => `${globalMap[key]}:${value};`).join('');
  if (rootVars) rules.push(`:root{${rootVars}}`);
  for (const page of Object.keys(PAGE_NAMES)) {
    const colors = theme.pages[page] || {};
    if (Object.keys(colors).length) {
      const map = {
        background: ['--theme-page-bg','--paper'], surface: ['--theme-page-surface'],
        surfaceAlt: ['--theme-page-surface-alt','--cream','--cream-deep'],
        text: ['--theme-page-text','--ink'], muted: ['--theme-page-muted','--muted'],
        accent: ['--theme-page-accent','--orange'], accentHover: ['--theme-page-accent-hover','--orange-2'],
        accentText: ['--theme-page-accent-text'], dark: ['--theme-page-dark','--forest-950','--forest-900','--forest-800'],
        darkSoft: ['--theme-page-dark-soft','--forest-700'], darkText: ['--theme-page-dark-text'],
        border: ['--theme-page-border','--line'], heroOverlay: ['--theme-page-overlay'],
        heroText: ['--theme-page-hero-text'], card: ['--theme-page-card'], cardText: ['--theme-page-card-text'],
      };
      const vars = Object.entries(colors).flatMap(([key,value]) => map[key].map(name => `${name}:${value};`)).join('');
      rules.push(`[data-page="${page}"]{${vars}}`);
      rules.push(`[data-page="${page}"]{background:var(--theme-page-bg,var(--paper));color:var(--theme-page-text,var(--ink));}`);
      rules.push(`[data-page="${page}"]{--theme-custom-active:1;}`);
    }
    for (const entry of (theme.elements[page] || [])) {
      const styles = Object.entries(entry.colors).map(([k,v]) => `${k.replace(/[A-Z]/g,m=>'-'+m.toLowerCase())}:${v}!important;`).join('');
      if (styles) rules.push(`[data-page="${page}"] > ${entry.selector}{${styles}}`);
    }
  }
  return rules.join('\n');
}
