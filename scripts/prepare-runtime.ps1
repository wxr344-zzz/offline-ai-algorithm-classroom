param([string]$PgBin='', [switch]$NoMirror, [switch]$SkipBuild)
$ErrorActionPreference='Continue'
$testRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $testRoot
. (Join-Path $testRoot 'scripts/offline/common.ps1')
New-Item -ItemType Directory -Path (Join-Path $testRoot 'logs') -Force | Out-Null
if(-not (Get-Command node -ErrorAction SilentlyContinue)){throw 'Install Node.js 22.19 or newer first.'}
$version=(node -p 'process.versions.node').Split('.')
if([int]$version[0] -lt 22 -or ([int]$version[0] -eq 22 -and [int]$version[1] -lt 19)){throw 'Node.js 22.19 or newer is required.'}
if(-not (Get-Command pnpm -ErrorAction SilentlyContinue)){
    if($NoMirror){npm install -g pnpm@10.28.0}else{npm install -g pnpm@10.28.0 --registry https://registry.npmmirror.com}
    if($LASTEXITCODE -ne 0){throw 'Install pnpm 10.28.0 and retry.'}
}
Write-Host '[1/5] Installing web/workspace dependencies' -ForegroundColor Cyan
if($NoMirror){pnpm install --frozen-lockfile}else{pnpm install --frozen-lockfile --registry https://registry.npmmirror.com}
if($LASTEXITCODE -ne 0){throw 'Dependency installation failed.'}
Write-Host '[2/5] Preparing this copy Python environment' -ForegroundColor Cyan
if(-not (Test-Path -LiteralPath '.venv/Scripts/python.exe')){
    $python=Find-SystemPython
    if(-not $python){throw 'Install Python 3.11 first.'}
    $exe=$python[0];$rest=@();if($python.Count -gt 1){$rest=$python[1..($python.Count-1)]}
    & $exe @rest -m venv .venv
    if($LASTEXITCODE -ne 0){throw 'Could not create Python virtual environment.'}
}
if($NoMirror){& '.\.venv\Scripts\python.exe' -m pip install -r requirements-api.txt}else{& '.\.venv\Scripts\python.exe' -m pip install -r requirements-api.txt -i https://pypi.tuna.tsinghua.edu.cn/simple}
if($LASTEXITCODE -ne 0){throw 'Python dependency installation failed.'}
Write-Host '[3/5] Preparing a private PostgreSQL cluster for this main workspace' -ForegroundColor Cyan
if(-not (Test-Path -LiteralPath 'database-runtime.json')){
    if(-not $PgBin){
        $binary=Get-Command initdb.exe -ErrorAction SilentlyContinue
        if($binary){$PgBin=Split-Path -Parent $binary.Source}
    }
    if(-not $PgBin){
        $candidates=@()
        if($env:ProgramFiles){$candidates+=Get-ChildItem -Path (Join-Path $env:ProgramFiles 'PostgreSQL/*/bin') -Directory -ErrorAction SilentlyContinue}
        $candidates+=Get-ChildItem -Path 'D:/PostgreSQL*/bin' -Directory -ErrorAction SilentlyContinue
        $candidate=$candidates | Where-Object {Test-Path -LiteralPath (Join-Path $_.FullName 'initdb.exe')} | Sort-Object FullName -Descending | Select-Object -First 1
        if($candidate){$PgBin=$candidate.FullName}
    }
    if(-not $PgBin){$PgBin=Read-Host 'Enter PostgreSQL bin directory (contains initdb.exe and pg_ctl.exe)'}
    node scripts/setup-local-database.cjs --pg-bin "$PgBin"
}else{node scripts/setup-local-database.cjs}
if($LASTEXITCODE -ne 0){throw 'Private database preparation failed. Existing data was not overwritten.'}
if(-not (Test-Path -LiteralPath 'openmaic.yml')){Copy-Item -LiteralPath 'openmaic-dual.example.yml' -Destination 'openmaic.yml' -ErrorAction Stop}
Write-Host '[4/5] Preparing BOTH local models (first download needs internet)' -ForegroundColor Cyan
if(-not (Get-Command ollama -ErrorAction SilentlyContinue)){throw 'Install and start Ollama, then retry.'}
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $testRoot 'scripts/prepare-dual-model.ps1')
if($LASTEXITCODE -ne 0){throw 'Model preparation failed.'}
Write-Host '[5/5] Building this edition' -ForegroundColor Cyan
if(-not $NoMirror){$env:EDUPLUS_ASSET_REGISTRY='https://registry.npmmirror.com'}
if(-not $SkipBuild){pnpm build;if($LASTEXITCODE -ne 0){throw 'Production build failed.'}}
Write-Host 'READY. Start the dual-model test CMD in this folder. Web: http://127.0.0.1:3400' -ForegroundColor Green
