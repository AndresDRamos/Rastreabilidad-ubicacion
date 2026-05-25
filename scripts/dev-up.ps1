# Levanta backend + frontend en modo dev (dos procesos en background).
# Util durante desarrollo para no abrir dos terminales.
#
# Uso:
#   .\scripts\dev-up.ps1            # arranca
#   .\scripts\dev-down.ps1          # para los procesos
#
# Notas sobre el reloader de uvicorn (Windows):
#   - Limpiamos __pycache__ antes de arrancar. Si dev-down dejo un worker
#     huerfano (uvicorn forkea un child cuando corre con --reload), su
#     bytecode obsoleto puede colarse al siguiente arranque y servir un
#     SQL/modulo viejo (ej. variables @ no declaradas que si estan en el
#     archivo actual). Limpiar __pycache__ obliga a Python a recompilar
#     desde la fuente actual.
#   - Acotamos --reload-dir a src/rbom_api para que el watcher no tenga que
#     escanear .venv, static/, ni __pycache__. Sin esto el watcher se
#     atrasa en Windows y a veces pierde el evento de cambio.
#   - --reload-include limita a .py: cambios en .sql no requieren restart
#     porque los archivos SQL se leen en cada request (no hay cache).

$ErrorActionPreference = "Stop"

$root      = Split-Path -Parent $PSScriptRoot
$pythonExe = Join-Path $root "backend\.venv\Scripts\python.exe"
$envFile   = Join-Path $root "backend\.env"
$backendDir = Join-Path $root "backend"

if (-not (Test-Path $pythonExe)) { throw "Falta el venv en backend\.venv. Crealo primero." }
if (-not (Test-Path $envFile))   { Write-Warning "backend\.env no existe — el backend arrancara con defaults." }

# Asegurar carpeta de logs (Start-Process no la crea automaticamente).
$logsDir = Join-Path $root "logs"
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir -Force | Out-Null }

# Limpiar bytecode obsoleto antes de arrancar — ver nota al inicio del archivo.
$srcDir = Join-Path $backendDir "src"
if (Test-Path $srcDir) {
    Get-ChildItem -Path $srcDir -Recurse -Directory -Filter '__pycache__' -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

$be = Start-Process -FilePath $pythonExe `
    -ArgumentList @(
        "-m","uvicorn","rbom_api.main:app",
        "--host","127.0.0.1","--port","8000",
        "--reload",
        "--reload-dir","src/rbom_api",
        "--reload-include","*.py"
    ) `
    -WorkingDirectory $backendDir `
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
