$ErrorActionPreference = 'Stop'
$coreDir = Split-Path $PSScriptRoot -Parent
$url = 'http://127.0.0.1:5599'
$expected = [System.IO.Path]::GetFullPath($coreDir)
function Read-StudioHealth {
    try { return Invoke-RestMethod -Uri "$url/api/studio-health" -TimeoutSec 2 } catch { return $null }
}
$health = Read-StudioHealth
if ($health -and $health.schema -eq 'mkt-videos/local-studio-health@1' -and $health.coreDir -eq $expected) {
    Start-Process "$url/gerador"
    exit 0
}
$listener = Get-NetTCPConnection -LocalPort 5599 -State Listen -ErrorAction SilentlyContinue
if ($listener) { throw 'A porta 5599 esta ocupada por outro app ou outra copia do Studio. Feche essa instancia antes de iniciar.' }
if (-not (Test-Path -LiteralPath (Join-Path $coreDir 'node_modules'))) { throw 'Execute INSTALAR.ps1 antes de iniciar.' }
$node = (Get-Command node -ErrorAction Stop).Source
$scriptFile = Join-Path $coreDir 'app\editor\server.mjs'
$logDir = Join-Path $coreDir 'diagnosticos'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logId = [Guid]::NewGuid().ToString('N')
$process = Start-Process -FilePath $node -ArgumentList @('"' + $scriptFile + '"') -WorkingDirectory $coreDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir "app-$logId.log") -RedirectStandardError (Join-Path $logDir "app-$logId.error.log")
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    $health = Read-StudioHealth
    if ($health -and $health.schema -eq 'mkt-videos/local-studio-health@1' -and $health.coreDir -eq $expected) { Start-Process "$url/gerador"; exit 0 }
    $process.Refresh()
    if ($process.HasExited) { throw 'O app encerrou durante a abertura. Consulte os logs em CORE\diagnosticos.' }
}
throw 'O app ainda nao confirmou a inicializacao. Consulte DIAGNOSTICAR.cmd e os logs antes de iniciar outra copia.'
