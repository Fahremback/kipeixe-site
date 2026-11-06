param([switch]$AtivarAsaas)
$ErrorActionPreference = 'Stop'
$worker = Split-Path -Parent $PSScriptRoot
$site = Split-Path -Parent $worker
Push-Location $worker
try {
  & npx wrangler whoami | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Autorize primeiro o Wrangler na Cloudflare.' }

  $databases = (& npx wrangler d1 list --json | Out-String | ConvertFrom-Json)
  if ($LASTEXITCODE -ne 0) { throw 'Falha na listagem dos bancos D1.' }
  $database = @($databases | Where-Object { $_.name -eq 'kipeixe-orders' }) | Select-Object -First 1
  if (-not $database) {
    & npx wrangler d1 create kipeixe-orders
    if ($LASTEXITCODE -ne 0) { throw 'Falha na criação do banco D1.' }
    $databases = (& npx wrangler d1 list --json | Out-String | ConvertFrom-Json)
    $database = @($databases | Where-Object { $_.name -eq 'kipeixe-orders' }) | Select-Object -First 1
  }
  if (-not $database -or -not $database.uuid) { throw 'Banco D1 não encontrado.' }
  $configPath = Join-Path $worker 'wrangler.jsonc'
  $config = Get-Content $configPath -Raw | ConvertFrom-Json
  $config.d1_databases[0].database_id = $database.uuid
  $config.vars.PAYMENTS_ENABLED = 'false'
  if ($AtivarAsaas) { $config.vars.ASAAS_ENV = 'production' }
  [IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 15), [Text.UTF8Encoding]::new($false))

  & npx wrangler d1 migrations apply kipeixe-orders --remote
  if ($LASTEXITCODE -ne 0) { throw 'Falha nas migrations remotas.' }
  $vars = @{}
  foreach ($line in Get-Content (Join-Path $worker '.dev.vars')) {
    if ($line -match '^([A-Z_]+)=(.*)$') {
      $vars[$Matches[1]] = ($Matches[2] | ConvertFrom-Json)
    }
  }
  $secrets = @{
    ADMIN_USERNAME = [string]$vars.ADMIN_USERNAME
    ADMIN_PASSWORD_SALT = [string]$vars.ADMIN_PASSWORD_SALT
    ADMIN_PASSWORD_HASH = [string]$vars.ADMIN_PASSWORD_HASH
    ASAAS_WEBHOOK_TOKEN = [string]$vars.ASAAS_WEBHOOK_TOKEN
  }
  if (@($secrets.Values | Where-Object { -not $_ }).Count) {
    throw 'Credenciais administrativas locais ausentes.'
  }
  if ($AtivarAsaas) {
    $secure = Read-Host 'Chave de API de produção do Asaas' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $asaasKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if ([string]::IsNullOrWhiteSpace($asaasKey)) { throw 'Chave Asaas não informada.' }
    $email = Read-Host 'Email para notificações técnicas do webhook Asaas'
    if ($email -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { throw 'Email inválido.' }
    $secrets.ASAAS_API_KEY = $asaasKey
  }
  $temp = Join-Path $env:TEMP ('kipeixe-worker-secrets-' + [guid]::NewGuid().ToString('N') + '.json')
  try {
    [IO.File]::WriteAllText($temp, ($secrets | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
    & npx wrangler deploy --secrets-file $temp
    if ($LASTEXITCODE -ne 0) { throw 'Deploy do Worker falhou.' }
  } finally {
    Remove-Item $temp -Force -ErrorAction SilentlyContinue
  }
  $health = Invoke-RestMethod -Uri 'https://api.restaurantekipeixe.com.br/health' -TimeoutSec 20
  if ($health.ok -ne $true) { throw 'API não passou no health check.' }

  if ($AtivarAsaas) {
    $headers = @{
      'access_token' = $asaasKey
      'Accept' = 'application/json'
      'Content-Type' = 'application/json'
      'User-Agent' = 'Kipeixe-Orders/2.0'
    }
    $hookUrl = 'https://api.restaurantekipeixe.com.br/api/webhook/asaas'
    $existing = Invoke-RestMethod -Uri 'https://api.asaas.com/v3/webhooks' -Headers $headers -TimeoutSec 20
    if (@($existing.data | Where-Object { $_.url -eq $hookUrl }).Count) {
      throw 'Webhook Asaas existente: conferir token e eventos antes de habilitar o pagamento.'
    }
    $body = @{
      name = 'KIPEIXE - Pedidos do site'
      url = $hookUrl
      email = $email
      enabled = $true
      interrupted = $false
      apiVersion = 3
      authToken = $secrets.ASAAS_WEBHOOK_TOKEN
      sendType = 'SEQUENTIALLY'
      events = @('CHECKOUT_CREATED', 'CHECKOUT_PAID', 'CHECKOUT_CANCELED', 'CHECKOUT_EXPIRED', 'PAYMENT_REFUNDED')
    } | ConvertTo-Json -Depth 8
    Invoke-RestMethod -Method Post -Uri 'https://api.asaas.com/v3/webhooks' -Headers $headers -Body $body -TimeoutSec 20 | Out-Null

    $config.vars.PAYMENTS_ENABLED = 'true'
    [IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 15), [Text.UTF8Encoding]::new($false))
    & npx wrangler deploy
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao habilitar pagamentos.' }
    $state = Invoke-RestMethod -Uri 'https://api.restaurantekipeixe.com.br/api/config' -TimeoutSec 20
    if (-not $state.onlinePaymentEnabled) { throw 'Checkout não foi habilitado.' }

    $htmlPath = Join-Path $site 'index.html'
    $html = (Get-Content $htmlPath -Raw).Replace('window.KIPEIXE_API_ENABLED = false', 'window.KIPEIXE_API_ENABLED = true')
    [IO.File]::WriteAllText($htmlPath, $html, [Text.UTF8Encoding]::new($false))
    git -C $site add index.html
    git -C $site commit -m 'Enable verified online checkout with Asaas'
    if ($LASTEXITCODE -ne 0) { throw 'Falha no commit de ativação.' }
    git -C $site push origin main
    if ($LASTEXITCODE -ne 0) { throw 'Falha no push de ativação.' }
    Write-Output 'API, webhook e checkout habilitados.'
  } else {
    Write-Output 'API administrativa publicada; cobranças continuam desativadas.'
  }
} finally {
  Remove-Variable asaasKey, secure -ErrorAction SilentlyContinue
  Pop-Location
}
