# Detiene los procesos dev arrancados por dev-up.ps1.
#
# Estrategia en capas (de lo mas especifico a lo mas defensivo):
#
# 1. Tree-kill de los PIDs guardados en .dev-pids.txt (el parent que
#    arranco dev-up). taskkill /T mata children/grandchildren.
#
# 2. Para cada puerto dev (8000 backend, 5173 frontend), mata al
#    OwningProcess del socket en LISTEN. Importante: cuando uvicorn
#    --reload restartea varias veces y termina abruptamente, el TCP
#    listener queda apuntando a un PID muerto (stale OwningProcess).
#    En ese caso el listener "responde" porque otro proceso heredo el
#    socket via fork; lo encontramos en el paso siguiente.
#
# 3. Mata cualquier python.exe spawned por multiprocessing.spawn
#    (worker child de WatchFiles) cuyo parent_pid en CommandLine sea
#    el OwningProcess del listener del paso 2. Esto cubre el caso
#    "PID dueño del socket esta muerto, pero el fork sigue corriendo
#    bajo el python del sistema y heredo el FD".

$ErrorActionPreference = "Continue"

$root     = Split-Path -Parent $PSScriptRoot
$pidsFile = Join-Path $root ".dev-pids.txt"

function Stop-ProcessTree {
    param([int]$ProcessId)
    if ($ProcessId -le 0) { return }
    # /T = mata el proceso y todos sus descendientes; /F = force
    & taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null
}

# Coleccion de PIDs sospechosos (del pidsFile + owners de puertos dev).
$ownersDev = New-Object System.Collections.Generic.HashSet[int]

if (Test-Path $pidsFile) {
    Get-Content $pidsFile | ForEach-Object {
        if ($_) {
            [int]$parsed = 0
            if ([int]::TryParse($_, [ref]$parsed)) {
                [void]$ownersDev.Add($parsed)
            }
        }
    }
    Remove-Item $pidsFile -Force -ErrorAction SilentlyContinue
}

foreach ($puerto in 5173, 8000) {
    Get-NetTCPConnection -LocalPort $puerto -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.OwningProcess -gt 0) { [void]$ownersDev.Add([int]$_.OwningProcess) }
    }
}

# Capa 1 + 2: tree-kill de todo PID conocido.
foreach ($targetPid in $ownersDev) {
    Stop-ProcessTree -ProcessId $targetPid
}

# Capa 3: forks zombi cuyo parent_pid apunta a algo que ya matamos.
# Estos suelen ser workers de WatchFiles que sobreviven al parent.
$forks = Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
        $_.CommandLine -and
        $_.CommandLine -match 'multiprocessing-fork' -and
        $_.CommandLine -match 'parent_pid=(\d+)' -and
        $ownersDev.Contains([int]$Matches[1])
    }
foreach ($p in $forks) {
    Stop-ProcessTree -ProcessId $p.ProcessId
}

# Espera breve a que Windows libere los listeners TCP.
# Solo nos importa State=Listen; los TimeWait son cleanup normal de Windows
# (no impiden rearrancar y desaparecen solos en 1-4 min).
$libre = $false
for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Milliseconds 200
    $ocupado = $false
    foreach ($puerto in 5173, 8000) {
        $listen = Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue
        if ($listen) { $ocupado = $true; break }
    }
    if (-not $ocupado) { $libre = $true; break }
}

if ($libre) {
    Write-Host "Procesos dev detenidos."
} else {
    Write-Warning "Procesos dev detenidos, pero algun puerto sigue con un listener activo. Revisa con: Get-NetTCPConnection -LocalPort 8000,5173 -State Listen"
}
