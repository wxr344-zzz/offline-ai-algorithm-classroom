$ErrorActionPreference='Continue'
$root=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
New-Item -ItemType Directory -Path (Join-Path $root 'logs') -Force | Out-Null
$tags=Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 10 -ErrorAction Stop
foreach($tag in @('qwen2.5-coder:7b','gemma4:e4b-it-qat')){
    if(-not ($tags.models | Where-Object {$_.name -eq $tag})){
        Write-Host "Downloading local model $tag. Internet is needed for this preparation only."
        ollama pull $tag
        if($LASTEXITCODE -ne 0){throw 'Model download failed. Fix the DNS/proxy download error and retry; no security checks are disabled.'}
    }
}
$modelfile=Join-Path $root 'logs/Modelfile.dual-gemma'
[IO.File]::WriteAllText($modelfile,"FROM gemma4:e4b-it-qat`nPARAMETER num_ctx 16384`n",[Text.UTF8Encoding]::new($false))
ollama create openmaic-gemma4-e4b:dual-16k -f $modelfile
if($LASTEXITCODE -ne 0){throw 'Creating the isolated Gemma runtime configuration failed.'}
$qwenfile=Join-Path $root 'logs/Modelfile.dual-qwen'
[IO.File]::WriteAllText($qwenfile,"FROM qwen2.5-coder:7b`nPARAMETER num_ctx 16384`n",[Text.UTF8Encoding]::new($false))
ollama create openmaic-qwen2.5-coder:dual-16k -f $qwenfile
if($LASTEXITCODE -ne 0){throw 'Creating the 16K-context Qwen runtime configuration failed.'}
Write-Host 'Local models prepared. Qwen keeps its original weights with a 16K context window.' -ForegroundColor Green
