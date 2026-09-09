param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git ausente. Instale Git para atualizar.' }
Push-Location $PSScriptRoot
try {
    $changes = & git status --porcelain --untracked-files=normal
    if ($LASTEXITCODE -ne 0) { throw 'Esta pasta nao e um clone Git valido.' }
    if ($changes) { throw 'Existem modificacoes locais no codigo. Preserve ou registre essas mudancas antes de atualizar; nenhum arquivo foi substituido.' }
    & git rev-parse --abbrev-ref '@{upstream}' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'O clone nao possui uma origem de atualizacao configurada.' }
    if ($CheckOnly) { Write-Host 'Clone apto a tentar atualizacao fast-forward; nenhuma alteracao efetuada.'; exit 0 }
    & git pull --ff-only
    if ($LASTEXITCODE -ne 0) { throw 'Atualizacao interrompida. Nenhum reset ou limpeza foi executado.' }
    & (Join-Path $PSScriptRoot 'INSTALAR.ps1')
} finally { Pop-Location }
