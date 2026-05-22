# PostToolUse hook: alerta de drift entre los modelos pydantic en
# backend/src/rbom_api/domain/modelo.py y los tipos espejo en
# frontend/src/api/types.ts cuando se edita modelo.py.
#
# NO bloquea (exit 0 siempre). Solo emite warning si detecta deriva.

$ErrorActionPreference = "Stop"

$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }
try { $payload = $raw | ConvertFrom-Json } catch { exit 0 }

$filePath = $payload.tool_input.file_path
if (-not $filePath) { exit 0 }

$pattern = 'backend[\\/]src[\\/]rbom_api[\\/]domain[\\/]modelo\.py$'
if (-not ($filePath -match $pattern)) { exit 0 }

# Modelos pydantic que el backend usa internamente y NO se exponen al frontend.
# El frontend recibe ya el ArbolPT finalizado, no los result-sets crudos del SQL.
$exclusionsPydantic = @("FilaBom", "FilaRuta", "FilaWip")
# Tipos TS propios del frontend (no tienen equivalente pydantic).
$exclusionsTs = @("Mode")

$root = $env:CLAUDE_PROJECT_DIR
if (-not $root) { $root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path }

$modeloPath = Join-Path $root "backend\src\rbom_api\domain\modelo.py"
$typesPath  = Join-Path $root "frontend\src\api\types.ts"

if (-not (Test-Path $modeloPath)) { exit 0 }
if (-not (Test-Path $typesPath))  { exit 0 }

# Extraer nombres de clase pydantic (excluyendo _Base)
$pydanticClasses = @(
    (Get-Content $modeloPath) |
        Select-String '^class (\w+)\(' |
        ForEach-Object { $_.Matches[0].Groups[1].Value } |
        Where-Object { $_ -ne "_Base" }
)

# Extraer nombres de interface/type TS
$tsTypes = @(
    (Get-Content $typesPath) |
        Select-String '^(?:export )?(?:interface|type) (\w+)' |
        ForEach-Object { $_.Matches[0].Groups[1].Value }
)

$missingInTs = $pydanticClasses | Where-Object { ($tsTypes -notcontains $_) -and ($exclusionsPydantic -notcontains $_) }
$missingInPy = $tsTypes        | Where-Object { ($pydanticClasses -notcontains $_) -and ($exclusionsTs -notcontains $_) }

if (($missingInTs -and $missingInTs.Count -gt 0) -or ($missingInPy -and $missingInPy.Count -gt 0)) {
    Write-Output "types-mirror-warning: posible drift entre modelo.py y types.ts"
    if ($missingInTs -and $missingInTs.Count -gt 0) {
        Write-Output ("  En pydantic pero no en TS: " + ($missingInTs -join ', '))
    }
    if ($missingInPy -and $missingInPy.Count -gt 0) {
        Write-Output ("  En TS pero no en pydantic: " + ($missingInPy -join ', '))
    }
    Write-Output "  Considera invocar el subagent docs-sync o replicar manualmente."
} else {
    Write-Output "types-mirror-warning: modelo.py y types.ts alineados ($($pydanticClasses.Count) modelos)"
}
exit 0
