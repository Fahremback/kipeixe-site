param()
$ErrorActionPreference = 'Stop'
$worker = Split-Path -Parent $PSScriptRoot
Push-Location $worker
try {
  Write-Output 'KIPEIXE ASAAS - DIAGNOSTICO SEM CRIAR COBRANCAS'
  $config = Invoke-RestMethod 'https://api.restaurantekipeixe.com.br/api/config' -TimeoutSec 20
  Write-Output ('AMBIENTE: ' + $config.paymentMode)
  Write-Output ('PAGAMENTOS_CONFIGURADOS: ' + $config.paymentsConfigured)
  Write-Output ('PAGAMENTOS_ONLINE_ATIVOS: ' + $config.onlinePaymentEnabled)

  $secrets = & npx --no-install wrangler secret list --name kipeixe-orders | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao listar nomes de secrets.' }
  foreach ($name in @('ASAAS_PRODUCTION_API_KEY', 'ASAAS_PRODUCTION_WEBHOOK_TOKEN')) {
    Write-Output ($name + '_PRESENTE: ' + ($secrets.name -contains $name))
  }

  $statements = [ordered]@{
    PEDIDOS_PRODUCAO = "SELECT id,created_at,payment_status,checkout_id,total_cents FROM orders WHERE asaas_environment='production' ORDER BY created_at DESC LIMIT 8"
    EVENTOS_WEBHOOK = "SELECT event,received_at FROM webhook_events ORDER BY received_at DESC LIMIT 8"
    FALHAS_ASAAS = "SELECT subject,details,created_at FROM audit_log WHERE action='ASAAS_CHECKOUT_FAILED' ORDER BY created_at DESC LIMIT 10"
  }
  foreach ($item in $statements.GetEnumerator()) {
    Write-Output ('--- ' + $item.Key + ' ---')
    & npx --no-install wrangler d1 execute kipeixe-orders --remote --command $item.Value
    if ($LASTEXITCODE -ne 0) { throw ('Falha consultando ' + $item.Key) }
  }
} finally {
  Pop-Location
}
