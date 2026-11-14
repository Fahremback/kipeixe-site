# Publica exclusivamente os arquivos estaticos versionados do site no Cloudflare Pages.
# Uso (Windows): pwsh -File scripts/publish-site.ps1
# Um git push, sozinho, NAO publica no Pages de upload direto.
param(
  [string]$Project = 'restaurantekipeixe-web',
  [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$wrangler = if ($env:KIPEIXE_WRANGLER_PATH) { $env:KIPEIXE_WRANGLER_PATH } else { Join-Path $repo 'worker\node_modules\wrangler\bin\wrangler.js' }
if (-not (Test-Path $wrangler)) { throw 'Instale as dependencias em worker antes de publicar.' }

$commit = (& git -C $repo rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Falha ao identificar o commit atual.' }
if ($Branch -eq 'main') {
  & git -C $repo fetch --quiet origin main
  if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel conferir a versao atual de origin/main. Publicacao bloqueada.' }
  $remoteMain = (& git -C $repo rev-parse FETCH_HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao consultar origin/main. Publicacao bloqueada.' }
  & git -C $repo merge-base --is-ancestor $remoteMain HEAD
  if ($LASTEXITCODE -ne 0) {
    throw 'Publicacao bloqueada: este checkout esta atras do main remoto. Atualize e integre as alteracoes antes de publicar.'
  }
}

$temp = Join-Path ([IO.Path]::GetTempPath()) ('kipeixe-pages-' + [guid]::NewGuid().ToString('N'))
$archive = Join-Path $temp 'site.zip'
$source = Join-Path $temp 'source'
$public = Join-Path $temp 'public'
New-Item -ItemType Directory -Force -Path $source, $public | Out-Null

try {
  & git -C $repo archive --format=zip --output=$archive HEAD
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar a versao do Git.' }
  Expand-Archive -LiteralPath $archive -DestinationPath $source

  $publicFiles = @(
    'index.html', 'visite.html', 'visite.css', 'reservas.mjs',
    'placar-presencial.html', 'placar.css', 'placar-ui.mjs', 'placar-data.mjs',
    'gestao.html', 'gestao.js', 'gestao.css', 'gestao-unified.css',
    'training-engine.js', 'ifood-ops.js', 'styles.css', 'menu-ordering.css', 'script.js', 'store-hours.js',
    'menu-data.js', 'product-images.js', 'meta-pixel.js', 'webmcp.js', 'favicon.ico',
    'appearance-config.mjs', 'appearance-site.mjs', 'appearance-theme.css',
    'appearance-admin.mjs', 'appearance-admin.css',
    'robots.txt', 'sitemap.xml', 'llms.txt', 'llms-full.txt'
  )
  foreach ($name in $publicFiles) {
    $file = Join-Path $source $name
    if (Test-Path $file) { Copy-Item -LiteralPath $file -Destination (Join-Path $public $name) }
  }

  $extensions = @('.webp', '.jpg', '.jpeg', '.png', '.svg', '.ico', '.json', '.txt', '.xml', '.mp4')
  foreach ($folder in @('assets', 'ai')) {
    $directory = Join-Path $source $folder
    if (-not (Test-Path $directory)) { continue }
    foreach ($file in (Get-ChildItem -LiteralPath $directory -Recurse -File)) {
      if ($extensions -notcontains $file.Extension.ToLowerInvariant()) { continue }
      $relative = $file.FullName.Substring($source.Length + 1)
      $destination = Join-Path $public $relative
      New-Item -ItemType Directory -Force -Path (Split-Path $destination -Parent) | Out-Null
      Copy-Item -LiteralPath $file.FullName -Destination $destination
    }
  }

  if (-not (Test-Path (Join-Path $public 'training-engine.js'))) {
    throw 'O arquivo do modo treinamento nao foi incluido no pacote.'
  }
  if (-not (Test-Path (Join-Path $public 'gestao-unified.css'))) {
    throw 'O estilo compacto compartilhado nao foi incluido no pacote.'
  }
  if (-not (Test-Path (Join-Path $public 'ifood-ops.js'))) {
    throw 'O painel de homologacao iFood nao foi incluido no pacote.'
  }
  if (-not (Test-Path (Join-Path $public 'product-images.js'))) {
    throw 'O indice de fotos de produtos nao foi incluido no pacote.'
  }
  if (-not (Test-Path (Join-Path $public 'menu-ordering.css'))) {
    throw 'O estilo do novo cardapio nao foi incluido no pacote.'
  }
  foreach ($name in @('appearance-config.mjs', 'appearance-site.mjs', 'appearance-admin.mjs', 'appearance-theme.css', 'appearance-admin.css')) {
    if (-not (Test-Path (Join-Path $public $name))) { throw ('Arquivo de aparencia ausente: ' + $name) }
  }
  foreach ($name in @('visite.html', 'visite.css', 'reservas.mjs')) {
    if (-not (Test-Path (Join-Path $public $name))) { throw ('Arquivo de reservas ausente: ' + $name) }
  }
  foreach ($name in @('placar-presencial.html', 'placar.css', 'placar-ui.mjs', 'placar-data.mjs')) {
    if (-not (Test-Path (Join-Path $public $name))) { throw ('Arquivo do placar ausente: ' + $name) }
  }
  foreach ($name in @('feed_peixe.png', 'feed_lago.png', 'story_peixe.png', 'story_lago.png', 'cartaz_a5.png', 'reel_visite_12s.mp4', 'reel_imagens_reais_10s.mp4', 'reel_experiencia_premium_14s.mp4', 'reel_peixe_premium_14s.mp4')) {
    if (-not (Test-Path (Join-Path $public 'assets\campanha' $name))) { throw ('Arquivo de campanha ausente: ' + $name) }
  }
  foreach ($code in @('rhino', 'farmacia3l', 'brunabosco', 'amandalara', 'dourado', 'montanari', 'precojusto', 'tradicao', 'serenity', 'gracie', 'kozievitch', 'vaz')) {
    if (-not (Test-Path (Join-Path $public 'assets\campanha\parceiros' ('cartaz_parceiro_' + $code + '.png')))) {
      throw ('Cartaz de parceiro ausente: ' + $code)
    }
  }
  Write-Output ('Publicando commit ' + $commit.Substring(0, 7) + ' no Cloudflare Pages...')
  Push-Location $public
  try {
    & node $wrangler pages deploy $public --project-name $Project --branch $Branch
    if ($LASTEXITCODE -ne 0) { throw 'Falha na publicacao Cloudflare Pages.' }
  } finally { Pop-Location }

  foreach ($path in @('/index.html', '/gestao.html', '/training-engine.js', '/ifood-ops.js', '/gestao-unified.css', '/menu-ordering.css', '/product-images.js',
      '/appearance-config.mjs', '/appearance-site.mjs', '/appearance-admin.mjs',
      '/appearance-theme.css', '/appearance-admin.css', '/visite.html', '/visite.css', '/reservas.mjs',
      '/placar-presencial.html', '/placar.css', '/placar-ui.mjs', '/placar-data.mjs',
      '/assets/campanha/feed_peixe.png', '/assets/campanha/feed_lago.png',
      '/assets/campanha/story_peixe.png', '/assets/campanha/story_lago.png',
      '/assets/campanha/cartaz_a5.png', '/assets/campanha/reel_visite_12s.mp4',
      '/assets/campanha/reel_imagens_reais_10s.mp4',
      '/assets/campanha/parceiros/cartaz_parceiro_rhino.png',
      '/assets/campanha/parceiros/cartaz_parceiro_vaz.png')) {
    $url = 'https://' + $Project + '.pages.dev' + $path + '?rev=' + $commit.Substring(0, 12)
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing
    if ([int]$response.StatusCode -ne 200) { throw ('Verificacao HTTP falhou: ' + $url) }
    Write-Output ('OK ' + $path + ' HTTP 200')
    if ($path -eq '/visite.html' -and -not $response.Content.Contains('data-reserva-form')) {
      throw ('Pagina de reservas nao encontrada no conteudo de ' + $url)
    }
    if ($path -eq '/reservas.mjs' -and -not $response.Content.Contains('buildReservationLink')) {
      throw ('Modulo de reservas nao encontrado no conteudo de ' + $url)
    }
    if ($path -eq '/placar-presencial.html' -and -not $response.Content.Contains('booking-form')) {
      throw ('Placar presencial nao encontrado no conteudo de ' + $url)
    }
  }
  foreach ($path in @('/assets/campanha/reel_experiencia_premium_14s.mp4',
                      '/assets/campanha/reel_peixe_premium_14s.mp4')) {
    $url = 'https://' + $Project + '.pages.dev' + $path + '?rev=' + $commit.Substring(0, 12)
    $response = Invoke-WebRequest -Uri $url -Method Head -UseBasicParsing
    if ([int]$response.StatusCode -ne 200) { throw ('Video premium indisponivel: ' + $url) }
    Write-Output ('OK ' + $path + ' HTTP 200')
  }
} finally {
  if (Test-Path $temp) { Remove-Item -LiteralPath $temp -Force -Recurse }
}
