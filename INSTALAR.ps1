param([switch]$CheckOnly, [switch]$WithWhisper)
$ErrorActionPreference = 'Stop'
$coreDir = Join-Path $PSScriptRoot 'CORE'
if (-not (Test-Path -LiteralPath (Join-Path $coreDir 'package-lock.json'))) { throw 'Abra este instalador na pasta completa do projeto.' }
$missing = @()
foreach ($tool in @('node', 'npm.cmd', 'ffmpeg', 'ffprobe')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { $missing += $tool }
}
$chromeCandidates = @($env:CHROME_PATH, (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'))
if (${env:ProgramFiles(x86)}) { $chromeCandidates += Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe' }
if ($env:LOCALAPPDATA) { $chromeCandidates += Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe' }
$chrome = $chromeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $chrome) { $missing += 'Google Chrome (ou CHROME_PATH)' }
if ($missing.Count) { throw ('Instale os requisitos e execute novamente: ' + ($missing -join ', ') + '. Consulte CORE\docs\INSTALACAO-WINDOWS.md.') }
$nodeVersion = & node -p 'process.versions.node'
if ($LASTEXITCODE -ne 0 -or [int]($nodeVersion.Split('.')[0]) -lt 22) { throw 'Node.js 22 ou superior e necessario; use a versao indicada no guia.' }
Write-Host "Requisitos locais encontrados. Node $nodeVersion."
if ($CheckOnly) { Write-Host 'Verificacao somente: nenhum pacote, login ou arquivo foi alterado.'; exit 0 }
Push-Location $coreDir
try {
    & npm.cmd ci --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw 'A instalacao das dependencias falhou.' }
    foreach ($directory in @('outputs', 'diagnosticos')) { New-Item -ItemType Directory -Force -Path (Join-Path $coreDir $directory) | Out-Null }
    Write-Host 'Preparando efeitos sonoros tecnicos localmente, sem contas e sem copiar audios de outra instalacao.'
    & node scripts/prepare-local-sfx.mjs
    if ($LASTEXITCODE -ne 0) { throw 'A preparacao local dos efeitos sonoros falhou.' }
    $configFile = Join-Path $env:LOCALAPPDATA 'GeradorDeVideos\installation.json'
    New-Item -ItemType Directory -Force -Path (Split-Path $configFile -Parent) | Out-Null
    $config = @{}
    if (Test-Path -LiteralPath $configFile) {
        $saved = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
        foreach ($property in $saved.PSObject.Properties) { $config[$property.Name] = $property.Value }
    }
    $config['chromePath'] = $chrome
    if ($WithWhisper) {
        if (-not (Get-Command py -ErrorAction SilentlyContinue)) { throw 'Instale Python 3.11 com o launcher py para configurar Whisper.' }
        $whisperRoot = Join-Path $env:LOCALAPPDATA 'GeradorDeVideos\Runtimes\whisper'
        $python = Join-Path $whisperRoot 'Scripts\python.exe'
        if (-not (Test-Path -LiteralPath $python)) {
            & py -3.11 -m venv $whisperRoot
            if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel criar o ambiente Python 3.11.' }
        }
        & $python -m pip install 'openai-whisper==20250625'
        if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel instalar Whisper.' }
        Write-Host 'Baixando explicitamente o modelo small para uso local em CPU.'
        & $python -c "import whisper; whisper.load_model('small', device='cpu')"
        if ($LASTEXITCODE -ne 0) { throw 'O modelo Whisper nao foi preparado.' }
        $env:WHISPER_COMMAND = Join-Path $whisperRoot 'Scripts\whisper.exe'
        $config['whisperCommand'] = $env:WHISPER_COMMAND
    }
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($configFile, ($config | ConvertTo-Json), $utf8)
    Write-Host 'Instalacao concluida. Use INICIAR.cmd; contas sao configuradas separadamente pelo ATIVAR-CONTAS.cmd.'
} finally { Pop-Location }
