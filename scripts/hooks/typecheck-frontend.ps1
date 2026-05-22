# PostToolUse hook: corre tsc --noEmit cuando se edita un .ts/.tsx en frontend/src.
#
# Activado por .claude/settings.json. Exit 0 = silencioso o OK. Exit 2 = errores TS.

$ErrorActionPreference = "Stop"

$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }
try { $payload = $raw | ConvertFrom-Json } catch { exit 0 }

$filePath = $payload.tool_input.file_path
if (-not $filePath) { exit 0 }

# Filtro: cualquier .ts/.tsx en frontend/src
$pattern = 'frontend[\\/]src[\\/].*\.(ts|tsx)$'
if (-not ($filePath -match $pattern)) { exit 0 }

$root = $env:CLAUDE_PROJECT_DIR
if (-not $root) { $root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path }

$frontendDir = Join-Path $root "frontend"
$nodeModules = Join-Path $frontendDir "node_modules"
if (-not (Test-Path $nodeModules)) {
    Write-Output "typecheck-frontend: node_modules no existe; skip"
    exit 0
}

$tscCmd = Join-Path $frontendDir "node_modules\.bin\tsc.cmd"
if (-not (Test-Path $tscCmd)) {
    Write-Output "typecheck-frontend: tsc no instalado ($tscCmd); skip"
    exit 0
}

Push-Location $frontendDir
try {
    $output = & $tscCmd -p tsconfig.json --noEmit 2>&1
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        Write-Output "typecheck-frontend: tsc FALLA tras editar $filePath"
        Write-Output ""
        $lines = ($output | Out-String) -split "`r?`n"
        Write-Output ($lines | Select-Object -First 40 | Out-String)
        exit 2
    }
    Write-Output "typecheck-frontend: OK (editado $filePath)"
    exit 0
} finally {
    Pop-Location
}
