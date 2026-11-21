param([switch]$NoBrowser, [switch]$SkipBuild, [switch]$Dev)
$ErrorActionPreference = 'Stop'
$testRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $testRoot
New-Item -ItemType Directory -Path (Join-Path $testRoot 'logs') -Force | Out-Null
foreach ($line in Get-Content -Encoding UTF8 -LiteralPath (Join-Path $testRoot '.env.local')) {
    if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') {
        [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
    }
}
$env:OPENMAIC_CONFIG = Join-Path $testRoot 'openmaic.yml'
Remove-Item Env:EDUPLUS_AGENT_PORT -ErrorAction SilentlyContinue
$env:EDUPLUS_AGENT_AUTO_START = '0'
$env:NODE_ENV = 'production'
if($Dev){$env:NODE_ENV='development'}
$url = 'http://127.0.0.1:3400'
Write-Host '=== OPENMAIC DUAL MODEL MAIN | Gemma lectures + Qwen labs | WEB 3400 ===' -ForegroundColor Cyan
Write-Host 'Uses its own database, Agent 8401, and model queue 11436.'
. (Join-Path $testRoot 'scripts/offline/common.ps1')
$dbRuntime = Get-Content -Encoding UTF8 -LiteralPath (Join-Path $testRoot 'database-runtime.json') -Raw | ConvertFrom-Json
$databasePort=[int]$dbRuntime.port
if($databasePort -lt 1024 -or $databasePort -gt 65535){throw 'Invalid private database port.'}
function Ensure-MainDatabase {
    # Check the database before reusing an existing web server. A successful
    # homepage response does not mean owner/model settings can be read.
    $control = Join-Path $dbRuntime.pgBin 'pg_ctl.exe'
    & $control status -D 'local-database' *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Restoring the independent main database.' -ForegroundColor Yellow
        # Give PostgreSQL a separate hidden console, so closing this launcher
        # cannot send Ctrl+C to the database. Do not use -Wait: on Windows it
        # waits for descendants too, including the long-running database.
        $databaseStart = Start-Process -FilePath $control -ArgumentList @('start','-D','local-database','-l','logs/dual-postgres.log','-o',('"-h 127.0.0.1 -p '+$databasePort+'"'),'-w') -WorkingDirectory $testRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $testRoot 'logs/dual-database-start.stdout.log') -RedirectStandardError (Join-Path $testRoot 'logs/dual-database-start.stderr.log')
        if (-not $databaseStart.WaitForExit(60000)) { throw 'Database startup did not finish within 60 seconds. See logs/dual-postgres.log.' }
        $databaseStart.Refresh()
        # Windows PowerShell 5.1 can return a null ExitCode after this hidden
        # process exits, even when pg_ctl reports success. Do not equate null
        # with failure. The authenticated SQL check below decides readiness,
        # and also handles another launcher starting this same database first.
    }
    node scripts/check-openmaic-db.cjs *> (Join-Path $testRoot 'logs/dual-database-check.log')
    if ($LASTEXITCODE -ne 0) { throw 'The main database is unavailable; the page will not be opened as healthy. See logs/dual-database-check.log and logs/dual-postgres.log.' }
}
$staleSource = Get-StaleSource
$stale = -not (Test-Path -LiteralPath '.next/BUILD_ID') -or !!$staleSource
$occupied=@()
foreach ($port in @(3400,8401,11436)) {
    $probe = [Net.Sockets.TcpClient]::new()
    try {
        $attempt = $probe.ConnectAsync('127.0.0.1', $port)
        if ($attempt.Wait(500) -and $probe.Connected) { $occupied+=$port }
    } catch {
        if ($_.Exception.Message -like 'Test port *') { throw }
    } finally { $probe.Dispose() }
}
if($occupied.Count){
    foreach($port in $occupied){
        $listener=Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop
        foreach($ownerProcess in @($listener.OwningProcess | Select-Object -Unique)){
            $verified=$false;$currentProcess=$ownerProcess
            for($i=0;$i -lt 6 -and $currentProcess -gt 0;$i++){
                $p=Get-CimInstance Win32_Process -Filter "ProcessId=$currentProcess" -ErrorAction SilentlyContinue
                if(-not $p){break}
                if(($p.CommandLine -and $p.CommandLine.IndexOf($testRoot,[StringComparison]::OrdinalIgnoreCase) -ge 0) -or ($p.ExecutablePath -and $p.ExecutablePath.StartsWith($testRoot,[StringComparison]::OrdinalIgnoreCase))){$verified=$true;break}
                $currentProcess=$p.ParentProcessId
            }
            if(-not $verified){throw "Port $port belongs to another workspace. No processes were stopped."}
        }
    }
    Ensure-MainDatabase
    $healthy=$false
    if($occupied.Count -eq 3){try{
        $web=Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        $agent=Invoke-RestMethod 'http://127.0.0.1:8401/health' -TimeoutSec 3
        $gateway=Invoke-RestMethod 'http://127.0.0.1:11436/health' -TimeoutSec 3
        $settings=Invoke-WebRequest ($url+'/api/model-config') -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
        $healthy=$web.StatusCode -eq 200 -and $settings.StatusCode -eq 200 -and $agent.service -eq 'eduplus-agent' -and $gateway.service -eq 'openmaic-dual-model-gateway'
    }catch{}}
    if($healthy -and -not $stale -and -not $Dev){Write-Host "Main workspace is already running: $url" -ForegroundColor Green;if(-not $NoBrowser){Start-Process $url};exit 0}
    if($healthy -and $stale){Write-Host "Source changed ($staleSource). Restarting this workspace and rebuilding before opening the page." -ForegroundColor Yellow}
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $testRoot 'scripts/stop-dual.ps1')
    if($LASTEXITCODE -ne 0){throw 'Could not stop verified incomplete main services.'}
    Start-Sleep -Milliseconds 500
}
$tags=$null
try{$tags=Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5 -ErrorAction Stop}catch{
    $ollama=Get-Command ollama -ErrorAction SilentlyContinue
    if($ollama){Start-Process -FilePath $ollama.Source -ArgumentList 'serve' -WindowStyle Hidden;for($i=0;$i -lt 30;$i++){try{$tags=Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 -ErrorAction Stop;break}catch{Start-Sleep -Seconds 1}}}
}
if(-not $tags){throw 'Start the installed local Ollama service first.'}
foreach ($model in @('qwen2.5-coder:7b','openmaic-gemma4-e4b:dual-16k')) {
    if (-not ($tags.models | Where-Object { $_.name -eq $model })) {
        throw "Missing local model $model. Run the model preparation CMD in this test folder first."
    }
}
# Qwen keeps its weights; this alias only carries a 16K context window, because
# Ollama's OpenAI-compatible endpoint cannot set num_ctx per request (default 4096
# silently truncates classroom, outline and interactive-page prompts). Offline.
$qwenRuntime='openmaic-qwen2.5-coder:dual-16k'
if (-not ($tags.models | Where-Object { $_.name -eq $qwenRuntime })) {
    $ollamaCmd=Get-Command ollama -ErrorAction SilentlyContinue
    if($ollamaCmd){
        $qwenModelfile=Join-Path $testRoot 'logs/Modelfile.dual-qwen'
        [IO.File]::WriteAllText($qwenModelfile,"FROM qwen2.5-coder:7b`nPARAMETER num_ctx 16384`n",[Text.UTF8Encoding]::new($false))
        Write-Host 'Preparing the 16K-context Qwen runtime (local, one time).'
        try { & $ollamaCmd.Source create $qwenRuntime -f $qwenModelfile | Out-Null } catch { }
        if($LASTEXITCODE -ne 0){Write-Host 'Could not prepare the 16K Qwen runtime; Qwen will use the Ollama default context.' -ForegroundColor Yellow}
    }
}
Ensure-MainDatabase
$stale = -not (Test-Path -LiteralPath '.next/BUILD_ID')
if (-not $stale) { $stale = !!(Get-StaleSource) }
if ($stale -and -not $SkipBuild -and -not $Dev) {
    Write-Host 'Building the independent main edition. This may take several minutes.'
    pnpm build
    if ($LASTEXITCODE -ne 0) { throw 'Test edition build failed. Original edition was not changed.' }
}
if (-not $Dev -and -not (Test-Path -LiteralPath '.next/BUILD_ID')) { throw 'No production build for this main edition.' }
node scripts/check-openmaic-db.cjs
if ($LASTEXITCODE -ne 0) { throw 'Independent test database is unavailable.' }
$gatewayProc = $null
$agentProc = $null
$browserJob = $null
try {
    $gatewayFile = Join-Path $testRoot 'scripts/dual-model-gateway.mjs'
    $gatewayProc = Start-Process -FilePath (Get-Command node).Source -ArgumentList @(('"' + $gatewayFile + '"')) -WorkingDirectory $testRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $testRoot 'logs/dual-gateway.stdout.log') -RedirectStandardError (Join-Path $testRoot 'logs/dual-gateway.stderr.log')
    $ready = $false
    for ($i=0; $i -lt 30; $i++) {
        try {
            $health=Invoke-RestMethod 'http://127.0.0.1:11436/health' -TimeoutSec 2
            if ($health.service -eq 'openmaic-dual-model-gateway') { $ready=$true;break }
        } catch { }
        if ($gatewayProc.HasExited) { break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw 'Dual-model queue failed to start; see logs.' }
    $agentFile=Join-Path $testRoot 'scripts/run-eduplus-agent.mjs'
    $agentProc=Start-Process -FilePath (Get-Command node).Source -ArgumentList @(('"'+$agentFile+'"'),'8401') -WorkingDirectory $testRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $testRoot 'logs/dual-agent.stdout.log') -RedirectStandardError (Join-Path $testRoot 'logs/dual-agent.stderr.log')
    $ready=$false
    for ($i=0; $i -lt 60; $i++) {
        try {
            $health=Invoke-RestMethod 'http://127.0.0.1:8401/health' -TimeoutSec 2
            if ($health.service -eq 'eduplus-agent' -and $health.status -eq 'ok') { $ready=$true;break }
        } catch { }
        if ($agentProc.HasExited) { break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw 'Test Agent failed to start; see logs/dual-agent.stderr.log.' }
    if (-not $NoBrowser) {
        $browserJob=Start-Job -ArgumentList $url -ScriptBlock {
            param($u)
            for ($i=0; $i -lt 120; $i++) {
                try { Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop | Out-Null; Start-Process $u; return } catch { Start-Sleep -Seconds 1 }
            }
        }
    }
    Write-Host "MAIN URL: $url | Keep this window open. Ctrl+C stops this edition." -ForegroundColor Green
    if($Dev){pnpm exec next dev --hostname 127.0.0.1 --port 3400}else{pnpm exec next start --hostname 127.0.0.1 --port 3400}
} finally {
    if ($browserJob) { Stop-Job $browserJob; Remove-Job $browserJob }
    foreach ($child in @($agentProc,$gatewayProc)) {
        if ($child -and -not $child.HasExited) { taskkill /PID $child.Id /T /F | Out-Null }
    }
    # Shared Ollama models are retained for the preserved workspaces.
}
