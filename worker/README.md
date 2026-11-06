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
