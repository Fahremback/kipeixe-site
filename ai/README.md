# Kipeixe: integração com IAs (2026)

Fonte do cardápio: \`menu-data.js\`. Fonte do estabelecimento: \`ai/business.json\`.

## Publicado no GitHub Pages

- \`/llms.txt\`: mapa de conteúdo para sistemas de IA.
- \`/llms-full.txt\`: informações do estabelecimento e **todos os produtos** em um arquivo.
- \`/ai/business.json\`: endereço, contatos, horários, serviços e processo de pedidos.
- \`/ai/catalog.json\`: produtos, preços, categorias e tamanhos em JSON.
- \`/ai/cardapio.md\`: menu completo em Markdown.
- \`/ai/restaurant-schema.json\`: Restaurant/Menu/MenuSection/MenuItem/Offer em schema.org.
- JSON-LD incorporado no HTML, legível mesmo sem executar JavaScript.
- \`/sitemap.xml\`: índice de URL para buscadores.

## WebMCP

\`webmcp.js\` registra seis ferramentas **somente de leitura** no \`document.modelContext\`
(ou \`navigator.modelContext\`) de navegadores que suportam a proposta WebMCP:
\`kipeixe_business_info\`, \`kipeixe_list_categories\`,
\`kipeixe_search_menu\`, \`kipeixe_get_product\`,
\`kipeixe_get_category\`, \`kipeixe_get_full_menu\`.

O navegador só carrega esse JS quando a API está disponível. Não há confirmação
de pedido via ferramenta: clientes continuam montando o carrinho e confirmando
pelo WhatsApp.

**Limite técnico:** GitHub Pages é uma hospedagem estática. WebMCP disponibiliza
ferramentas **para agentes do navegador enquanto a aba do site está aberta**,
e **não** constitui servidor MCP remoto via HTTP para clientes externos.
IAs externas podem consumir os URLs públicos JSON, Markdown e schema.org,
mas usá-los depende das ferramentas de cada agente. Arquivos \`llms.txt\`
não garantem indexação ou inclusão nas respostas de modelos.

Um servidor MCP remoto requer hospedagem com backend, domínio/URL do endpoint
e registro no cliente MCP. Não há endpoint remoto anunciado sem implantação
real e testes do protocolo.

## Atualização e testes

Quando preços ou produtos mudarem, edite \`menu-data.js\`.
Para atualizar dados do estabelecimento, edite \`ai/business.json\`.
Regenere as exportações:

\`\`\`powershell
python scripts/build_ai_catalog.py
\`\`\`

Depois verifique:

\`\`\`powershell
python -m http.server 4189
# Em outra janela:
python tests/test_ai_access.py
\`\`\`

Em GitHub Pages, o \`robots.txt\` neste subdiretório não substitui
\`https://fahremback.github.io/robots.txt\` (raiz do domínio); o
\`sitemap.xml\` deste projeto pode ser enviado diretamente ao Search Console.

Referências oficiais:
- https://developer.chrome.com/docs/ai/webmcp/
- https://developer.chrome.com/docs/ai/webmcp/imperative-api
- https://developer.chrome.com/docs/ai/webmcp/compare-mcp
