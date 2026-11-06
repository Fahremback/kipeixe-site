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
