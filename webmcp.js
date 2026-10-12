/* WebMCP browser-native tools (draft 2026). Not a remote HTTP MCP server.
 * Read-only lookups; orders still require Kipeixe confirmation.
 */
(async () => {
  'use strict';
  const modelContext = document.modelContext || navigator.modelContext;
  if (typeof modelContext?.registerTool !== 'function') return;
  const base = new URL('.', document.currentScript?.src || location.href);
  const load = async (path) => {
    const response = await fetch(new URL(path, base));
    if (!response.ok) throw new Error('Unable to load Kipeixe ' + path + ': ' + response.status);
    return response.json();
  };
  const [catalog, business] = await Promise.all([
    load('ai/catalog.json'), load('ai/business.json'),
  ]);
  const all = catalog.categories.flatMap((category) => category.items);
  const normalize = (value) => String(value ?? '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const output = (value) => JSON.stringify(value);
  const wrap = (items) => ({
    total: items.length,
    results: items,
    note: 'Preços e opções do cardápio publicado. Confirme disponibilidade e entrega com o Kipeixe pelo WhatsApp.',
  });
  const register = (name, description, properties, required, execute) =>
    modelContext.registerTool({
      name, description,
      inputSchema: { type: 'object', properties, required, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async (args = {}) => output(await execute(args)),
    });

  await register(
    'kipeixe_business_info',
    'Informações oficiais do restaurante e pesque-pague Kipeixe: endereço em Foz do Iguaçu, horários, telefone, WhatsApp, serviços, localização, Instagram e como solicitar pedidos.',
    {}, [],
    () => business,
  );

  await register(
    'kipeixe_list_categories',
    'Lista as categorias do cardápio do Kipeixe, quantidade de pratos/produtos e o endereço do menu.',
    {}, [],
    () => ({
      restaurant: business.name, menu_url: catalog.menu_url, total_items: catalog.total_items,
      categories: catalog.categories.map((category) => ({
        id: category.id, name: category.name, count: category.items.length,
      })),
    }),
  );

  await register(
    'kipeixe_search_menu',
    'Busca pratos, porções, carnes, peixes, lanches, sucos e demais itens do Kipeixe por nome ou descrição. Retorna preços exatos e variações, não confirma disponibilidade.',
    {
      query: { type: 'string', description: 'Nome, ingrediente ou termo de busca, por exemplo: tilápia, camarão ou batata.' },
      category_id: { type: 'string', description: 'Opcional: identificador da categoria retornado pela listagem.' },
      limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Máximo de resultados (padrão: 25).' },
    },
    ['query'],
    ({ query, category_id, limit }) => {
      const term = normalize(query);
      if (!term) return { error: 'query deve conter um termo de busca.' };
      const selected = category_id ? all.filter((item) => item.category_id === category_id) : all;
      const matched = selected.filter((item) =>
        normalize([item.name, item.description, item.category].join(' ')).includes(term));
      const requested = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 100)) : 25;
      return {
        ...wrap(matched.slice(0, requested)), total_matches: matched.length,
        displayed: Math.min(requested, matched.length), query, category_id: category_id || null,
      };
    },
  );

  await register(
    'kipeixe_get_product',
    'Detalhes de um item pelo identificador ou nome: descrição, preço em BRL e opções por tamanho. Nomes repetidos retornam todas as apresentações.',
    { id_or_name: { type: 'string', description: 'ID único ou nome do item, por exemplo Skol ou Picanha completa.' } },
    ['id_or_name'],
    ({ id_or_name }) => {
      const term = normalize(id_or_name);
      return wrap(all.filter((item) => item.id === id_or_name || normalize(item.name) === term));
    },
  );

  await register(
    'kipeixe_get_category',
    'Lista completa de uma categoria do cardápio com descrições, preços e variações.',
    { category_id: { type: 'string', description: 'ID da categoria: peixes, porcoes, sucos, carnes etc.' } },
    ['category_id'],
    ({ category_id }) => {
      const category = catalog.categories.find((entry) => entry.id === category_id);
      return category ? { category: category.name, ...wrap(category.items) }
        : { error: 'Categoria não encontrada', valid_categories: catalog.categories.map((entry) => entry.id) };
    },
  );

  await register(
    'kipeixe_get_full_menu',
    'Retorna todas as categorias e todos os itens publicados do Kipeixe com descrições, preços e variações. Use busca para dúvidas específicas.',
    {}, [],
    () => catalog,
  );
})().catch((error) => console.warn('Kipeixe WebMCP unavailable:', error));
