# Publica exclusivamente os arquivos estaticos versionados do site no Cloudflare Pages.
# Uso (Windows): pwsh -File scripts/publish-site.ps1
# Um git push, sozinho, NAO publica no Pages de upload direto.
param(
  [string]$Project = 'restaurantekipeixe-web',
  [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$wrangler = Join-Path $repo 'worker\node_modules\wrangler\bin\wrangler.js'
if (-not (Test-Path $wrangler)) { throw 'Instale as dependencias em worker antes de publicar.' }

$commit = (& git -C $repo rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Falha ao identificar o commit atual.' }

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
    'index.html', 'gestao.html', 'gestao.js', 'gestao.css', 'gestao-unified.css',
    'training-engine.js', 'styles.css', 'menu-ordering.css', 'script.js', 'store-hours.js',
    'menu-data.js', 'meta-pixel.js', 'webmcp.js', 'favicon.ico',
    'appearance-config.mjs', 'appearance-site.mjs', 'appearance-theme.css',
    'appearance-admin.mjs', 'appearance-admin.css',
    'robots.txt', 'sitemap.xml', 'llms.txt', 'llms-full.txt'
  )
  foreach ($name in $publicFiles) {
    $file = Join-Path $source $name
    if (Test-Path $file) { Copy-Item -LiteralPath $file -Destination (Join-Path $public $name) }
  }

  $extensions = @('.webp', '.jpg', '.jpeg', '.png', '.svg', '.ico', '.json', '.txt', '.xml')
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
  if (-not (Test-Path (Join-Path $public 'menu-ordering.css'))) {
    throw 'O estilo do novo cardapio nao foi incluido no pacote.'
  }
  foreach ($name in @('appearance-config.mjs', 'appearance-site.mjs', 'appearance-admin.mjs', 'appearance-theme.css', 'appearance-admin.css')) {
    if (-not (Test-Path (Join-Path $public $name))) { throw ('Arquivo de aparencia ausente: ' + $name) }
  }
  Write-Output ('Publicando commit ' + $commit.Substring(0, 7) + ' no Cloudflare Pages...')
  Push-Location $public
  try {
    & node $wrangler pages deploy $public --project-name $Project --branch $Branch
    if ($LASTEXITCODE -ne 0) { throw 'Falha na publicacao Cloudflare Pages.' }
  } finally { Pop-Location }

  foreach ($path in @('/index.html', '/gestao.html', '/training-engine.js', '/gestao-unified.css', '/menu-ordering.css',
      '/appearance-config.mjs', '/appearance-site.mjs', '/appearance-admin.mjs',
      '/appearance-theme.css', '/appearance-admin.css')) {
    $url = 'https://' + $Project + '.pages.dev' + $path + '?rev=' + $commit.Substring(0, 12)
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing
    if ([int]$response.StatusCode -ne 200) { throw ('Verificacao HTTP falhou: ' + $url) }
    Write-Output ('OK ' + $path + ' HTTP 200')
  }
} finally {
  if (Test-Path $temp) { Remove-Item -LiteralPath $temp -Force -Recurse }
}
