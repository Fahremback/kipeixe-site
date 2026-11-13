# Pedidos e gestão do Kipeixe

O site público está em restaurantekipeixe.com.br, a gestão em /gestao.html e
a API em api.restaurantekipeixe.com.br, com Cloudflare Worker e banco D1.

## Sandbox e Produção

Os ambientes do Asaas têm contas e API Keys independentes:

- Sandbox: https://sandbox.asaas.com/
- Produção: https://www.asaas.com/

Na conta Sandbox, abra Integrações > Chaves API > Gerar chave. Uma chave da conta
normal de produção não funciona no ambiente de teste.

O painel tem, em Horários e operação > Pagamentos Asaas, as opções Sandbox e
Produção e um controle independente para habilitar os pagamentos.
O botão de ativação é recusado enquanto a chave ou webhook do ambiente não
estiverem configurados. Nenhuma chave é enviada ao navegador.

Cada pedido mantém seu ambiente de origem para que confirmações e estornos
sejam enviados à conta correta mesmo depois de mudar a seleção do painel.

Webhooks separados:

- https://api.restaurantekipeixe.com.br/api/webhook/asaas/sandbox
- https://api.restaurantekipeixe.com.br/api/webhook/asaas/production

Variáveis secretas:

| Sandbox | Produção |
|---|---|
| ASAAS_SANDBOX_API_KEY | ASAAS_PRODUCTION_API_KEY |
| ASAAS_SANDBOX_WEBHOOK_TOKEN | ASAAS_PRODUCTION_WEBHOOK_TOKEN |

## Desenvolvimento Windows

No diretório website/worker:

~~~powershell
npm install
node scripts/create-admin.mjs
npm test
npx wrangler d1 migrations apply kipeixe-orders --local
npx wrangler dev --local --ip 127.0.0.1 --port 8787
~~~

Arquivos .dev.vars e .local-admin-credentials.txt são privados, não devem ser
enviados ao Git nem compartilhados.

## Publicação

Autorize primeiro a conta Cloudflare do restaurante com Wrangler. Para
configurar o Sandbox e publicar API + site:

~~~powershell
.\scripts\deploy-production.ps1 -AmbienteAsaas sandbox -PublicarSite
~~~

Para registrar uma conta de Produção independente:

~~~powershell
.\scripts\deploy-production.ps1 -AmbienteAsaas production
~~~

A publicação do backend não habilita cobranças automaticamente. Elas só
funcionam após autenticação, webhook, configuração da chave e ativação no painel.
O pagamento é confirmado somente pelo evento CHECKOUT_PAID; o redirecionamento
da página de pagamento não tem efeito sobre a confirmação financeira.

## Uber Direct — logística de entregas

Integração pronta no Worker, **desativada por padrão**. Não depende do Asaas
para emitir cotações, mas o pedido precisa estar pago e aceito antes de
solicitar um entregador.

É preciso criar/habilitar a organização de produção em https://direct.uber.com/,
confirmar cobertura em Foz do Iguaçu e registrar uma forma de faturamento.
No painel Developer da Uber, obtenha Customer ID, Client ID e Client Secret.
Cadastre como segredos do Worker:

- UBER_DIRECT_CUSTOMER_ID
- UBER_DIRECT_CLIENT_ID
- UBER_DIRECT_CLIENT_SECRET
- UBER_DIRECT_WEBHOOK_SECRET (chave de assinatura do webhook)

Os segredos nunca devem aparecer no Git, no HTML nem no JavaScript público.

Retirada: Av. João Ricieri Maran, 1417, Três Lagoas, Foz do Iguaçu,
PR, 85862-425. Telefone: +55 45 3577-2363. Esses dados estão nas variáveis
UBER_PICKUP_ADDRESS e UBER_PICKUP_PHONE.

Configure o webhook da Uber Direct em Developer > Webhooks para o evento
event.delivery_status, com o endereço:

https://api.restaurantekipeixe.com.br/api/webhook/uber-direct

Depois da aprovação da conta, mude UBER_DIRECT_ENABLED para true no Wrangler,
publique o Worker e ative Uber Direct e Entrega na Central Kipeixe.

### Regras operacionais

1. O cliente informa seu endereço, calcula o frete na Uber (em BRL) e
   paga esse valor dentro do checkout Asaas, junto com os produtos.
   Cotação expira em aproximadamente 15 minutos.
2. O restaurante aceita o pedido e prepara normalmente. A Uber só é
   solicitada ao clicar Marcar pronto, não ao pagar ou aceitar o pedido.
3. Como a cotação pode expirar durante o preparo, o Worker solicita uma
   cotação atualizada. Se estiver mais cara que o frete já pago,
   a entrega fica em revisão. Jamais é criado um frete mais caro
   sem aprovação ou um novo pagamento.
4. Apenas uma tentativa concorrente de despacho por pedido é autorizada.
   Um timeout após criação fica em REVIEW para investigação manual,
   pois a Uber pode já ter enviado um entregador.
5. Pedidos agendados prontos só são despachados até 45 minutos antes
   do horário escolhido. A rotina da Cloudflare verifica a cada minuto.
6. Acompanhamento Uber via link HTTPS validado. Webhooks são autenticados
   usando HMAC-SHA256 sobre o texto original da requisição.
7. Se falhar definitivamente antes da corrida ser criada, o painel permite
   tentar novamente ou cancelar e solicitar estorno ao Asaas.

As migrations 0005_uber_direct.sql e 0006_uber_quote_limits.sql adicionam
campos de entregas, cotações temporárias e controle de consultas por IP.

## iFood — Entrega Fácil para pedidos externos

O iFood permite usar entregadores em pedidos vendidos pelo site, sem que a
venda tenha ocorrido no aplicativo iFood. A operação tem dois canais:

- Manual: Portal do Parceiro iFood > Gestor de Pedidos > Solicitar Entrega
  Fácil/Sob Demanda. Requer conta de restaurante com serviço habilitado na
  região; não exige API.
- Automático: API Shipping, documentada em
  https://developer.ifood.com.br/en-US/docs/food/guides/modules/shipping/outside.
  Exige cadastro profissional com CNPJ, aplicativo funcional e homologação.

O módulo de automação do Kipeixe está implementado, desativado por padrão.
Configurar como secrets privados do Cloudflare Worker:

- IFOOD_CLIENT_ID
- IFOOD_CLIENT_SECRET
- IFOOD_MERCHANT_ID (UUID da loja habilitada para Entrega Fácil)

### Verificação real da API em sandbox

As credenciais do aplicativo de teste centralizado ficam somente em
`worker/.env.ifood-test` (ignorado pelo Git). Use
`node worker/scripts/check-ifood-test.mjs` a partir da raiz do site para
validar OAuth, consulta do merchant e cotação Shipping usando as coordenadas
da própria loja de teste. Esse comando não cria pedidos nem solicita entregadores.

Em 06/11/2026, as três consultas retornaram HTTP 200 e a cotação foi
interpretada pelo módulo de produção. A loja simulada retornada pelo iFood
fica em Bujari (AC); consultar um destino em Foz com esse merchant retorna
`DeliveryDistanceTooHigh`. Nunca instalar as credenciais de teste no Worker
de produção. O serviço real exige um aplicativo Shipping homologado e a
autorização do merchant Kipeixe de Foz do Iguaçu.

Depois da aprovação, ajustar IFOOD_SHIPPING_ENABLED para true no Wrangler,
publicar Worker, selecionar iFood como operador na Central Kipeixe e marcar
Ativar integração iFood e Habilitar entrega. Até esse momento o site não
oferece entregas sem operador confirmado.

Fluxo automatizado: cliente informa CEP, rua, número e bairro, e marca no
mapa o destino real. O backend consulta disponibilidade por coordenadas,
salva cotação e incorpora o frete no checkout Asaas. O pagamento é único e
vai para a conta Asaas, não para o iFood. Depois de pagamento confirmado,
aceite e preparo, a equipe marca Pronto. O backend recalcula o valor e
contrata entregador somente quando a nova tarifa for menor ou igual à taxa
já paga. Caso contrário, exige revisão. Em erros HTTP ambíguos, marca
REVIEW e não reenvia para evitar dois entregadores.

Pedidos agendados são despachados a partir de 45 minutos antes do horário.
O cron recebe eventos via polling uma vez por minuto, confirma eventos
processados e atualiza o status do cliente. O iFood oferece página segura
de rastreamento e código de confirmação pelos últimos quatro dígitos do
telefone do destinatário.

Migração 0007_ifood_shipping.sql: cotações e campos de pedido iFood.

## Homologação iFood — Shipping e Merchant (novembro de 2026)

**Procedimento oficial para destravar o merchant:** entrar com a **conta do responsável da loja real** em https://portal.ifood.com.br/ > **Minha Loja > Loja**, obter o **merchant UUID exibido abaixo do nome** e verificar em **Serviços e Soluções** se o **Sob Demanda está contratado/opt-in**. No Developer Portal, Shipping já está selecionado em Detalhes, mas é necessário vincular o merchant real em **Permissões > Pedir autorização** e o proprietário confirmar a solicitação no Portal do Parceiro. A FAQ oficial (https://developer.ifood.com.br/pt-BR/support/faq) especifica esses passos. Sem acesso autenticado à conta da loja ou retorno do suporte #36153793, a autorização não pode ser emitida; não usar merchant de teste em produção.


**AUTORIZAÇÃO DA LOJA REAL — 10/11/2026, 17h03:** o aplicativo já consta **Homologado**, mas o merchant do restaurante não aparece na busca por CNPJ `78.238.110/0001-83` para `Permissões > Pedir autorização`. Após triagem da categoria incorreta no #36153639, foi aberto o **ticket técnico #36153793, Dúvidas ou Informações > Acessos / Permissões**, para o iFood confirmar existência/UUID do merchant, o procedimento de cadastro/autorização da loja e a possibilidade de usar Entrega Sob Demanda em pedidos de site próprio. Aguardando retorno: https://developer.ifood.com.br/pt-BR/developer/tickets/189a482b-2fc0-4ce8-aba9-7f06cd77c72b . **Não habilitar Shipping** sem merchant real e autorização do responsável.


**STATUS ATUAL — 10/11/2026, 16h44 BRT: APP DE PRODUÇÃO HOMOLOGADO.** Às 16h34, a equipe do iFood confirmou no ticket **#36113984** que o status do app **Kipeixe Entregas** (`627547e1-c322-4c43-b717-18de09dce6fc`) foi alterado para **Homologado**. O botão **Permissões > Pedir autorização** está liberado. O cadastro do restaurante real foi identificado por endereço e CNPJ (**78.238.110/0001-83**, Valdair Maltezo); porém a pesquisa do CNPJ no pedido de autorização não exibiu nenhum merchant selecionável. Às **16h44**, foi solicitada no mesmo ticket a localização/regularização do merchant do restaurante e orientação de habilitação de Shipping para pedidos vindos do site próprio. A autorização individual da loja e o merchant UUID real **continuam pendentes**. A API de produção ainda está **desativada** (`IFOOD_SHIPPING_ENABLED=false`).

Referência do processo de autorização de aplicativos centralizados: https://developer.ifood.com.br/en-US/docs/getting-started/first-steps/request-access . Nenhum pedido real deve ser registrado antes da autorização do proprietário da loja, instalação de `IFOOD_MERCHANT_ID` e liberação explícita do frete no sistema.


**Atualização 10/11/2026:** a equipe do iFood confirmou **homologação técnica validada com sucesso para Shipping e Merchant** no ticket **#36113984** às 16h05. O aplicativo de produção **Kipeixe Entregas**, Client ID `627547e1-c322-4c43-b717-18de09dce6fc`, slug `kipeixe-entregas`, foi identificado e encaminhado ao iFood no mesmo chamado às **16h22**, conforme solicitado para efetivar a vinculação final.

O código e os vídeos de homologação incluem o Shipping 2 bem-sucedido (`confirm` HTTP 202, `requestDriver` HTTP 202 e `REQUEST_DRIVER_SUCCESS`), além dos cenários Merchant 2/3 comprovados no Portal do Parceiro. Os **664 logs HTTP oficiais** e os oito vídeos foram enviados. O cadastro do aplicativo de produção continuava marcado **Em desenvolvimento**, sem merchants autorizados, na última verificação. **Não ativar produção** sem confirmação final do iFood e identificação/autorização do merchant real do KIPEIXE. O arquivo local `.env.ifood-prod` possui Client ID e Client Secret, porém **não contém `IFOOD_MERCHANT_ID`**. Em **10/11/2026**, os secrets `IFOOD_CLIENT_ID` e `IFOOD_CLIENT_SECRET` foram instalados no Cloudflare Worker de produção usando `wrangler secret put`, e a versão remota `5d4c8b00-7e5a-4593-9ec3-23c57fc05c21` foi inspecionada para confirmar os bindings e a flag **`IFOOD_SHIPPING_ENABLED=false`**. O merchant real permanece ausente; não criar pedidos em produção.

Protocolo e evidências atuais: `evidence/STATUS.md` e `evidence/Protocolo-Homologacao-Shipping-Merchant-36113984-2026-11-09.md`. Os registros antigos abaixo permanecem apenas como histórico das tentativas iniciais e não refletem a homologação atual.

**Estado verificado em 09/11/2026:** as oito gravações individuais de tela
inteira, com cursor e relógio, foram produzidas e enviadas ao Drive, mas
Shipping 2 **não foi aprovado**: o sandbox retornou HTTP 400
`RequestDriverUnavailable` em vez de HTTP 202, e a gravação registra esse
bloqueio real. As alterações Merchant 2/3 foram confirmadas pela API, não
pelo Portal do Parceiro (autenticação/verificação humana pendente). O ticket
técnico **#36047658 foi encerrado** em 08/11 sem aprovação de homologação.
O protocolo oficial para Shipping/Merchant é **novo chamado na categoria
Homologação**, não o assistente automatizado de Order/Events. **Chamado
#36095059 enviado em 09/11 às 13:55**, triagem respondida, checklists oficiais
recebidos e o chamado **encerrado pelo iFood às 14:45 sem homologação**.
Às 14:59 foi anexada ao mesmo chamado a exportação oficial de **640 requisições
HTTP**, disponível em `evidence/iFood-HTTP-Requests-oficiais-640-2026-11-08-09.json`
e https://drive.google.com/file/d/1CO8JftLRuJUDpP-VCooBJu5KxDc8wJPd/view .
Dúvidas técnicas/categoria foram separadas no **#36095527** (14:02), que segue
como canal de suporte sobre habilitar Entrega sob Demanda na loja de testes.
A recuperação do Portal do Parceiro foi conduzida até a verificação de e-mail;
a inserção automatizada do código foi bloqueada explicitamente pelas
configurações de segurança e a tela foi entregue ao titular para concluir.
Categoria atual do app de produção confirmada **LOGISTIC**,
com Shipping/Events/Merchant marcados; elegibilidade do Shipping precisa de
resposta formal do iFood. A solicitação completa que embasou o envio está em
`evidence/Solicitacao-Homologacao-Shipping-Merchant-2026-11-09.md`. Todos os
vídeos e logs constam em `evidence/Manifesto-Homologacao-Kipeixe-2026-11-08.txt`.
**Produção permanece desligada:** `IFOOD_SHIPPING_ENABLED=false`.

### Captura contínua da tela inteira

**Vídeos com cursor e círculo sobre o botão clicado.** A skill
`playwright-recording` foi instalada em
`%USERPROFILE%\.codex\skills\playwright-recording`. O console local
carrega `scripts/cursor-overlay.js`, com cursor de alto contraste,
realce amarelo do botão e onda de clique em cada evento real de mouse.

Para gravar automaticamente um cenário Merchant 1 com consultas reais:

~~~powershell
python scripts/record-ifood-click-demo.py
~~~

Para gravar os demais cenários disponíveis em sandbox:

~~~powershell
python scripts/record-ifood-scenarios.py
~~~

Os scripts gravam vídeo **contínuo** com Playwright e convertem para MP4 H.264.
Os arquivos ficam em `worker/evidence/recordacoes-tela-inteira`. Não há
simulação de resposta da API: os botões executam chamadas do aplicativo de
teste. O cenário de pedido interno e eventos de entregador continua sujeito
às limitações reais da loja de testes.

O roteiro automático de Merchant 2 pode ficar incompleto se a listagem de
pausas demorar a refletir a criação. O script de Merchant 3 sempre tenta
restaurar os horários originais, mas o resultado deve ser conferido no GET
da loja de testes. Os arquivos sinalizados como parciais não devem ser
apresentados como evidência de homologação completa.

O painel local de homologação está disponível com:

~~~powershell
cd C:\Users\fahre\Documents\Kipeixe\website\worker
node scripts/ifood-homolog-console.mjs
~~~

Abra no Chrome o endereço temporário `http://127.0.0.1:8788/?token=...`
impresso pelo comando. Ele usa somente a loja e o aplicativo de testes do
iFood, com sessão local e credenciais privadas. Selecione um cenário e
clique em **Gravar tela inteira**. No diálogo nativo do Chrome, escolha
**Tela inteira** (não apenas uma aba). Execute as ações pela interface e
clique em **Encerrar e salvar MP4**. O arquivo gerado é enviado somente
para o serviço local `127.0.0.1` e fica em
`worker/evidence/recordacoes-tela-inteira/`.

A captura contínua exige autorização explícita da tela no próprio Chrome.
As prévias `*-PREVIA.mp4` são sequências de capturas e **não substituem**
esses vídeos. O endpoint local de gravação não foi validado ponta a
ponta por upload automatizado.

O relatório atualizado, as limitações conhecidas e a mensagem de
solicitação técnica ao iFood estão em
`worker/evidence/RELATORIO_HOMOLOGACAO_2026-11-07.md` e
`worker/evidence/SOLICITACAO_AO_SUPORTE_IFOOD.md`.

O checklist recebido do suporte exige **oito vídeos separados**: cinco
cenários Shipping e três Merchant. Cada vídeo deve mostrar o **front-end
funcional**, as chamadas reais do aplicativo de teste, a **data e a hora**
na tela. Informar o Client ID de testes e compartilhar **links dos vídeos**,
preferencialmente do Google Drive. Baixar e anexar os logs de
**Developer Portal > Logs da API > HTTP Requests** do mesmo aplicativo.
Não entregar vídeos como anexos ao chamado.

### Ambiente de teste local

A Central de Gestão agora tem a aba **iFood — Entregas**, disponível apenas
ao proprietário autenticado. O módulo usa endpoints reais, não simulações
de interface ou chamadas executadas manualmente no Postman.

As credenciais de homologação ficam somente em `worker/.dev.vars`:

- `LOCAL_DEVELOPMENT=true`
- `IFOOD_TEST_CLIENT_ID`
- `IFOOD_TEST_CLIENT_SECRET`
- `IFOOD_TEST_MERCHANT_ID`

O ambiente de produção ignora todas as operações de homologação. Elas são
bloqueadas se `LOCAL_DEVELOPMENT` não for `true`, mesmo que haja
credenciais de teste. A ativação de entregas reais continua dependente de
`IFOOD_SHIPPING_ENABLED=true` e homologação.

No Windows, executar a partir de `website/worker`:

~~~powershell
npm test
npx wrangler d1 migrations apply kipeixe-orders --local
npx wrangler dev --local --ip 127.0.0.1 --port 8787
~~~

Em outro terminal, a partir de `website`:

~~~powershell
python -m http.server 8080 --bind 127.0.0.1
~~~

Verificação de leitura da loja e das permissões do aplicativo de testes:
`node scripts/check-ifood-merchant.mjs` dentro de `website/worker`.
Esse comando não cria, edita nem cancela recursos e não substitui os
vídeos feitos pela Central.

Acessar `http://127.0.0.1:8080/gestao.html`, autenticar como proprietário
e abrir a aba **iFood — Entregas**. A tela exibe o Client ID e o Merchant ID
do aplicativo de testes. O merchant de sandbox observado em novembro/2026
fica em **Bujari/AC**; endereços de Foz não produzem uma cotação válida
nesse merchant. Não criar pedidos externos reais com ele.

### Roteiro dos oito vídeos

| Vídeo | Fluxo na Central | Evidência obrigatória |
| --- | --- | --- |
| Shipping 1 | Eventos: polling a cada 30 s, registro pelo eventId e acknowledgment | Mostrar consulta, evento e comportamento de duplicata |
| Shipping 2 | Pedido interno: cotação e solicitar entregador | Pedido de teste com entrega própria, ID e pickupCode nos detalhes |
| Shipping 3 | Pedido externo: disponibilidade e criar pedido | Cotação válida, pedido de teste e pickupCode |
| Shipping 4 | Alteração de endereço | Solicitar pela página de rastreamento; aceitar ou negar na Central |
| Shipping 5 | Cancelar pedido | Consultar motivos dinâmicos, selecionar motivo e enviar cancelamento |
| Merchant 1 | Listar, detalhar e consultar status da loja | Mostrar as três respostas |
| Merchant 2 | Criar, listar e remover pausa | Mostrar a pausa refletida no Portal do Parceiro após cada ação |
| Merchant 3 | Consultar e configurar horários | Sábado 10h–19h; domingo 9h–12h, 13h–16h e 17h–23h; comprovar no Portal do Parceiro |

A criação de pedidos, solicitação de entregadores, pausas e alteração dos
horários **gera chamadas reais ao iFood de testes**. Cada ação destrutiva ou
que cria um recurso solicita confirmação na tela.

**Situação:** integração local e testes automatizados não equivalem à
homologação. Somente depois de executar, gravar e conferir os oito cenários,
exportar os HTTP Requests e disponibilizar os vídeos deve-se abrir um novo
chamado em **Suporte > Chamados > Agendar Homologação**, como orientado
pelo iFood. O chamado anterior pode ser encerrado normalmente.
