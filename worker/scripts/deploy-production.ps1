# Deploy seguro. Ex.: .\scripts\deploy-production.ps1 -AmbienteAsaas sandbox -PublicarSite
# Sem -AmbienteAsaas, instala somente painel/API e mantém pagamentos como estão.
param(
  [ValidateSet('sandbox','production')][string]$AmbienteAsaas,
  [switch]$PublicarSite
)
$ErrorActionPreference = 'Stop'
$worker = Split-Path -Parent $PSScriptRoot
$site = Split-Path -Parent $worker
Push-Location $worker
try {
  & npx wrangler whoami | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Primeiro autorize o Wrangler na conta Cloudflare do restaurante.' }
  $dbs = @((& npx wrangler d1 list --json | Out-String | ConvertFrom-Json))
  if ($LASTEXITCODE -ne 0) { throw 'Não foi possível listar os bancos Cloudflare D1.' }
  $db = $dbs | Where-Object name -eq 'kipeixe-orders' | Select-Object -First 1
  if (-not $db) {
    & npx wrangler d1 create kipeixe-orders
    if ($LASTEXITCODE -ne 0) { throw 'Falha na criação do banco de dados.' }
    $db = @((& npx wrangler d1 list --json | Out-String | ConvertFrom-Json)) |
      Where-Object name -eq 'kipeixe-orders' | Select-Object -First 1
  }
  if (-not $db.uuid) { throw 'Banco remoto não encontrado.' }
  $configPath = Join-Path $worker 'wrangler.jsonc'
  $config = Get-Content $configPath -Raw | ConvertFrom-Json
  $config.d1_databases[0].database_id = $db.uuid

  $vars = @{}
  foreach ($line in Get-Content (Join-Path $worker '.dev.vars')) {
    if ($line -match '^([A-Z_]+)=(.*)$') {
      $vars[$Matches[1]] = ($Matches[2] | ConvertFrom-Json)
    }
  }
  $secrets = @{}
  foreach ($name in @('ADMIN_USERNAME','ADMIN_PASSWORD_HASH','ADMIN_PASSWORD_SALT',
      'ASAAS_SANDBOX_WEBHOOK_TOKEN','ASAAS_PRODUCTION_WEBHOOK_TOKEN')) {
    if ([string]::IsNullOrWhiteSpace($vars[$name])) { throw "Segredo ausente: $name" }
    $secrets[$name] = [string]$vars[$name]
  }
  foreach ($name in @('ASAAS_SANDBOX_API_KEY','ASAAS_PRODUCTION_API_KEY')) {
    if ($vars[$name] -and $vars[$name] -notmatch 'NAO_CONFIGURADA') {
      $secrets[$name] = [string]$vars[$name]
    }
  }
  if ($PSBoundParameters.ContainsKey('AmbienteAsaas')) {
    if ($AmbienteAsaas -eq 'production') {
      $confirmation = Read-Host 'Produção fará cobranças reais. Digite PRODUCAO para continuar'
      if ($confirmation -ne 'PRODUCAO') { throw 'Ativação de produção cancelada.' }
    }
    $prefix = $AmbienteAsaas.ToUpperInvariant()
    $apiKeyName = 'ASAAS_' + $prefix + '_API_KEY'
    if (-not $secrets.ContainsKey($apiKeyName)) {
      $secure = Read-Host "Cole a API Key do Asaas $AmbienteAsaas" -AsSecureString
      $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
      try { $secrets[$apiKeyName] = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
      finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    }
    if (-not $secrets[$apiKeyName] -or $secrets[$apiKeyName] -match 'NAO_CONFIGURADA') {
      throw 'Chave Asaas não informada.'
    }
  }
  # O painel não ativa sozinho: pagamentos_enabled (D1) começa falso.
  # Habilita infraestrutura global somente quando registrar webhook do ambiente pedido.
  if ($PSBoundParameters.ContainsKey('AmbienteAsaas')) { $config.vars.PAYMENTS_ENABLED = 'true' }
  [IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 15),
    [Text.UTF8Encoding]::new($false))

  & npx wrangler d1 migrations apply kipeixe-orders --remote
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao aplicar migrations remotas.' }

  $temp = Join-Path $env:TEMP ('kipeixe-secret-' + [guid]::NewGuid().ToString('N') + '.json')
  try {
    [IO.File]::WriteAllText($temp, ($secrets | ConvertTo-Json -Depth 6),
      [Text.UTF8Encoding]::new($false))
    & npx wrangler deploy --secrets-file $temp
    if ($LASTEXITCODE -ne 0) { throw 'Falha no deploy do Worker.' }
  } finally {
    Remove-Item $temp -Force -ErrorAction SilentlyContinue
  }
  $health = Invoke-RestMethod -Uri 'https://api.restaurantekipeixe.com.br/health' -TimeoutSec 20
  if ($health.ok -ne $true) { throw 'A API não passou no health check.' }

  if ($PSBoundParameters.ContainsKey('AmbienteAsaas')) {
    $mode = $AmbienteAsaas
    $prefix = $mode.ToUpperInvariant()
    $keyName = 'ASAAS_' + $prefix + '_API_KEY'
    $tokenName = 'ASAAS_' + $prefix + '_WEBHOOK_TOKEN'
    $base = if ($mode -eq 'production') { 'https://api.asaas.com/v3' } else { 'https://api-sandbox.asaas.com/v3' }
    $hook = "https://api.restaurantekipeixe.com.br/api/webhook/asaas/$mode"
    $headers = @{
      'access_token' = $secrets[$keyName]
      'Accept' = 'application/json'
      'Content-Type' = 'application/json'
      'User-Agent' = 'Kipeixe-Orders/2.0'
    }
    $existing = Invoke-RestMethod -Uri "$base/webhooks" -Headers $headers -TimeoutSec 20
    $found = @($existing.data | Where-Object { $_.url -eq $hook })
    if (-not $found.Count) {
      $email = Read-Host 'Email para avisos técnicos dos webhooks'
      if ($email -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { throw 'Email inválido.' }
      $payload = @{
        name = "KIPEIXE - $mode"
        url = $hook
        email = $email
        enabled = $true
        interrupted = $false
        apiVersion = 3
        authToken = $secrets[$tokenName]
        sendType = 'SEQUENTIALLY'
        events = @('CHECKOUT_CREATED','CHECKOUT_PAID','CHECKOUT_CANCELED',
          'CHECKOUT_EXPIRED','PAYMENT_REFUNDED')
      } | ConvertTo-Json -Depth 8
      Invoke-RestMethod -Method Post -Uri "$base/webhooks" -Headers $headers -Body $payload -TimeoutSec 20 | Out-Null
    } else {
      throw 'Webhook já cadastrado. Verifique manualmente o authToken, eventos e a fila antes de ativar pedidos.'
    }
  }

  if ($PublicarSite) {
    $page = Join-Path $site 'index.html'
    $markup = (Get-Content $page -Raw).Replace(
      'window.KIPEIXE_API_ENABLED = false', 'window.KIPEIXE_API_ENABLED = true')
    [IO.File]::WriteAllText($page, $markup, [Text.UTF8Encoding]::new($false))
    git -C $site add index.html
    git -C $site commit -m 'Enable verified Kipeixe backend for storefront'
    if ($LASTEXITCODE -ne 0) { throw 'Falha no commit do site.' }
    git -C $site push origin main
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao publicar o site.' }
  }
  Write-Output 'Worker publicado. Pagamentos continuam desligados no painel até a ativação explícita.'
} finally {
  Remove-Variable secrets,secure -ErrorAction SilentlyContinue
  Pop-Location
}
