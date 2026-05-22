# Levanta backend + frontend en modo dev (dos procesos en background).
# Util durante desarrollo para no abrir dos terminales.
#
# Uso:
#   .\scripts\dev-up.ps1            # arranca
#   .\scripts\dev-down.ps1          # para los procesos

$ErrorActionPreference = "Stop"

$root      = Split-Path -Parent $PSScriptRoot
$pythonExe = Join-Path $root "backend\.venv\Scripts\python.exe"
$envFile   = Join-Path $root "backend\.env"

if (-not (Test-Path $pythonExe)) { throw "Falta el venv en backend\.venv. Crealo primero." }
if (-not (Test-Path $envFile))   { Write-Warning "backend\.env no existe — el backend arrancara con defaults." }

# Asegurar carpeta de logs (Start-Process no la crea automaticamente).
$logsDir = Join-Path $root "logs"
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir -Force | Out-Null }

$be = Start-Process -FilePath $pythonExe `
    -ArgumentList "-m","uvicorn","rbom_api.main:app","--host","127.0.0.1","--port","8000","--reload" `
    -WorkingDirectory (Join-Path $root "backend") `
    -RedirectStandardOutput (Join-Path $root "logs\dev-backend.out") `
    -RedirectStandardError  (Join-Path $root "logs\dev-backend.err") `
    -NoNewWindow -PassThru

$fe = Start-Process -FilePath "npm.cmd" `
    -ArgumentList "run","dev","--","--host","127.0.0.1","--port","5173" `
    -WorkingDirectory (Join-Path $root "frontend") `
    -RedirectStandardOutput (Join-Path $root "logs\dev-frontend.out") `
    -RedirectStandardError  (Join-Path $root "logs\dev-frontend.err") `
    -NoNewWindow -PassThru

"$($be.Id)`n$($fe.Id)" | Out-File -FilePath (Join-Path $root ".dev-pids.txt") -Encoding ASCII

Write-Host "Backend (PID=$($be.Id)): http://127.0.0.1:8000"
Write-Host "Frontend (PID=$($fe.Id)): http://127.0.0.1:5173"
Write-Host "Para detener: .\scripts\dev-down.ps1"
