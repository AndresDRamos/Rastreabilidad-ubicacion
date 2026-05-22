# Detiene los procesos dev arrancados por dev-up.ps1.

$ErrorActionPreference = "Continue"

$root     = Split-Path -Parent $PSScriptRoot
$pidsFile = Join-Path $root ".dev-pids.txt"

if (Test-Path $pidsFile) {
    Get-Content $pidsFile | ForEach-Object {
        if ($_) {
            try { Stop-Process -Id ([int]$_) -Force -ErrorAction SilentlyContinue } catch {}
        }
    }
    Remove-Item $pidsFile -Force -ErrorAction SilentlyContinue
}

foreach ($puerto in 5173, 8000) {
    Get-NetTCPConnection -LocalPort $puerto -ErrorAction SilentlyContinue | ForEach-Object {
        try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
    }
}

Write-Host "Procesos dev detenidos."
