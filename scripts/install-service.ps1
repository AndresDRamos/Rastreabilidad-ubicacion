# Instala el backend como servicio Windows con NSSM.
#
# Requisitos:
#   - NSSM en el PATH (https://nssm.cc/download). En PowerShell admin:
#         choco install nssm
#     o bajar el binario y agregarlo al PATH.
#   - Backend ya buildeado (correr scripts/build.ps1 antes).
#   - backend/.env con credenciales reales (no .env.test).
#
# Uso (PowerShell elevado):
#   .\scripts\install-service.ps1
#
# Para desinstalar:
#   nssm remove RastreabilidadBom confirm

$ErrorActionPreference = "Stop"

$serviceName = "RastreabilidadBom"
$root        = Split-Path -Parent $PSScriptRoot
$backendDir  = Join-Path $root "backend"
$pythonExe   = Join-Path $backendDir ".venv\Scripts\python.exe"
$logsDir     = Join-Path $root "logs"

# Validaciones previas ---------------------------------------------------------

if (-not (Get-Command nssm.exe -ErrorAction SilentlyContinue)) {
    throw "NSSM no esta en el PATH. Instalalo (choco install nssm) y vuelve a correr."
}
if (-not (Test-Path $pythonExe)) {
    throw "No se encontro .venv/Scripts/python.exe en backend. Crea el venv primero."
}
$envFile = Join-Path $backendDir ".env"
if (-not (Test-Path $envFile)) {
    Write-Warning "No existe backend/.env. El servicio arrancara con la config por defecto."
}
$staticDir = Join-Path $backendDir "src\rbom_api\static"
if (-not (Test-Path $staticDir)) {
    Write-Warning "No hay $staticDir — la SPA NO se servira. Corre scripts/build.ps1 primero."
}

# Crear logs dir y limpiar instalacion previa --------------------------------

New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

$existing = nssm.exe status $serviceName 2>$null
if ($LASTEXITCODE -eq 0 -and $existing) {
    Write-Host "==> Servicio existente, reinstalando..." -ForegroundColor Yellow
    nssm.exe stop   $serviceName | Out-Null
    nssm.exe remove $serviceName confirm | Out-Null
}

# Instalar -------------------------------------------------------------------

Write-Host "==> Instalando servicio $serviceName ..." -ForegroundColor Cyan
nssm.exe install $serviceName $pythonExe "-m uvicorn rbom_api.main:app --host 0.0.0.0 --port 8000 --workers 1"
nssm.exe set $serviceName AppDirectory  $backendDir
nssm.exe set $serviceName DisplayName   "Rastreabilidad BOM API"
nssm.exe set $serviceName Description   "FastAPI backend + SPA para rastreabilidad del arbol BOM netteado."
nssm.exe set $serviceName Start         SERVICE_AUTO_START
nssm.exe set $serviceName AppStdout     (Join-Path $logsDir "stdout.log")
nssm.exe set $serviceName AppStderr     (Join-Path $logsDir "stderr.log")
nssm.exe set $serviceName AppRotateFiles 1
nssm.exe set $serviceName AppRotateBytes 10485760    # 10 MB
nssm.exe set $serviceName AppRotateOnline 1

Write-Host "==> Iniciando servicio ..." -ForegroundColor Cyan
nssm.exe start $serviceName

Start-Sleep -Seconds 3
$status = nssm.exe status $serviceName
Write-Host "==> Estado: $status" -ForegroundColor Green

Write-Host ""
Write-Host "Health check: curl http://localhost:8000/health"
Write-Host "Logs:         $logsDir"
Write-Host "Detener:      nssm.exe stop $serviceName"
Write-Host "Eliminar:     nssm.exe remove $serviceName confirm"
