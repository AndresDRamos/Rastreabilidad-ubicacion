# Build de produccion: compila el frontend y lo copia al backend para que
# uvicorn sirva la SPA en "/" via StaticFiles.
#
# Uso:
#   .\scripts\build.ps1
#
# Salida: backend/src/rbom_api/static/ con index.html, assets/...

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $root "frontend"
$backendStatic = Join-Path $root "backend\src\rbom_api\static"
$frontendDist = Join-Path $frontend "dist"

Write-Host "==> Compilando frontend en $frontend ..." -ForegroundColor Cyan
Push-Location $frontend
try {
    npm install --silent
    if ($LASTEXITCODE -ne 0) { throw "npm install fallo" }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build fallo" }
} finally {
    Pop-Location
}

if (-not (Test-Path $frontendDist)) {
    throw "No se encontro frontend/dist tras el build."
}

Write-Host "==> Copiando $frontendDist -> $backendStatic ..." -ForegroundColor Cyan
if (Test-Path $backendStatic) {
    Remove-Item -Path $backendStatic -Recurse -Force
}
New-Item -ItemType Directory -Path $backendStatic -Force | Out-Null
Copy-Item -Path (Join-Path $frontendDist "*") -Destination $backendStatic -Recurse -Force

Write-Host "==> Build OK. uvicorn ahora sirve la SPA en /" -ForegroundColor Green
Write-Host "    Arranca el backend con:"
Write-Host "    cd backend; .\.venv\Scripts\python.exe -m uvicorn rbom_api.main:app --host 0.0.0.0 --port 8000"
