# PostToolUse hook: corre los 8 tests unitarios del netteo cuando se edita
# domain/netteo.py o tests/unit/test_netteo.py.
#
# Activado por .claude/settings.json. Lee JSON del stdin con tool_input.file_path.
# Exit 0 = silencioso (no aplica) o tests OK. Exit 2 = tests fallaron, bloquea.

$ErrorActionPreference = "Stop"

# Leer payload del runtime (JSON via stdin)
$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }
try {
    $payload = $raw | ConvertFrom-Json
} catch {
    exit 0   # payload inesperado, no rompemos al agente
}

$filePath = $payload.tool_input.file_path
if (-not $filePath) { exit 0 }

# Filtro por path: domain/netteo.py o tests/unit/test_netteo.py
$pattern = 'backend[\\/]src[\\/]rbom_api[\\/]domain[\\/]netteo\.py$|backend[\\/]tests[\\/]unit[\\/]test_netteo\.py$'
if (-not ($filePath -match $pattern)) { exit 0 }

$root = $env:CLAUDE_PROJECT_DIR
if (-not $root) { $root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path }

$backendDir = Join-Path $root "backend"
$pytestExe = Join-Path $backendDir ".venv\Scripts\python.exe"
if (-not (Test-Path $pytestExe)) {
    Write-Output "netteo-tests-gate: venv no existe ($pytestExe); skip"
    exit 0
}

Push-Location $backendDir
try {
    $output = & $pytestExe -m pytest -m "not e2e" -q 2>&1
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        Write-Output "netteo-tests-gate: tests FALLAN tras editar $filePath"
        Write-Output ""
        Write-Output ($output | Out-String)
        exit 2
    }
    Write-Output "netteo-tests-gate: 8 tests OK (editado $filePath)"
    exit 0
} finally {
    Pop-Location
}
