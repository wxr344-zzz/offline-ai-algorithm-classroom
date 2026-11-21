$ErrorActionPreference='Stop'
$testRoot=Split-Path -Parent $PSScriptRoot
function Test-OwnedProcess([int]$ProcessNumber) {
    for($i=0;$i -lt 6 -and $ProcessNumber -gt 0;$i++) {
        $p=Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessNumber" -ErrorAction SilentlyContinue
        if(-not $p){return $false}
        if(($p.CommandLine -and $p.CommandLine.IndexOf($testRoot,[StringComparison]::OrdinalIgnoreCase) -ge 0) -or ($p.ExecutablePath -and $p.ExecutablePath.StartsWith($testRoot,[StringComparison]::OrdinalIgnoreCase))){return $true}
        $ProcessNumber=$p.ParentProcessId
    }
    return $false
}
$owned=@()
foreach($port in @(3400,8401,11436)) {
    $listeners=Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    foreach($processNumber in @($listeners.OwningProcess | Select-Object -Unique)) {
        if(-not $processNumber){continue}
        if(-not (Test-OwnedProcess $processNumber)){throw "Port $port belongs to an unverified process; nothing has been stopped."}
        $owned+=$processNumber
    }
}
# Only after every listener was verified as belonging to this copy.
foreach($processNumber in $owned){Stop-Process -Id $processNumber -ErrorAction SilentlyContinue}
# Do not unload model tags shared with the preserved workspaces.
Write-Host 'Stopped this dual-model web/Agent/queue only. Original services and Qwen tags were not stopped.' -ForegroundColor Green
