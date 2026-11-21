# OpenMAIC 离线自检：逐项检查离线运行所需的一切，只读，不修改任何文件。
# 用法：powershell -ExecutionPolicy Bypass -File scripts\offline\check.ps1
# 建议在断网状态下运行一次，确认全部通过。
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'common.ps1')
Set-Location -LiteralPath $script:ProjectRoot
$failed = 0
function Fail([string]$Text) { Write-Bad $Text; $script:failed++ }

Write-Step '网络状态'
try {
    Invoke-WebRequest -Uri 'https://registry.npmjs.org' -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop | Out-Null
    Write-Warn '本机当前可以联网；要验证离线能力，请断网后再运行一次本脚本'
} catch { Write-Ok '本机当前处于离线状态，以下结果即离线运行结果' }

Write-Step '运行时与依赖'
if (Test-Command 'node') { Write-Ok "Node.js $(node -v)" } else { Fail '未安装 Node.js' }
if (Test-Path -LiteralPath 'node_modules\next') { Write-Ok '网页依赖已安装' } else { Fail '网页依赖未安装（运行 setup.ps1）' }
if (Test-Path -LiteralPath '.next\BUILD_ID') {
    $stale = Get-StaleSource
    if ($stale) { Write-Warn "生产构建早于当前代码（如 $stale）：用 启动平台.cmd 启动时会自动重新构建" }
    else { Write-Ok '生产构建已完成，且与当前代码一致' }
} else { Write-Warn '没有生产构建：启动平台.cmd 启动时会自动构建（断网也可完成）' }
if (Test-Path -LiteralPath $script:VenvPython) {
    & $script:VenvPython -c 'import fastapi, uvicorn, httpx, pydantic, tenacity, langgraph, langchain_core, nbformat' 2>$null
    if ($LASTEXITCODE -eq 0) { Write-Ok "Agent 依赖齐全（$(& $script:VenvPython --version)）" } else { Fail 'Agent 依赖不全（运行 setup.ps1）' }
} else { Fail '缺少 Python 虚拟环境 .venv' }
$assets = @{
    'Pyodide（浏览器内 Python）' = 'public\vendor\eduplus\pyodide\pyodide.asm.wasm'
    'Monaco 代码编辑器'          = 'public\vendor\eduplus\monaco\vs\loader.js'
    'KaTeX 公式'                 = 'public\vendor\eduplus\katex\katex.min.js'
}
foreach ($k in $assets.Keys) {
    if (Test-Path -LiteralPath $assets[$k]) { Write-Ok "$k 本地资源就绪" } else { Fail "$k 本地资源缺失（联网运行一次 setup.ps1 或 pnpm build）" }
}

Write-Step '配置'
if (Test-EnvKey 'EDUPLUS_AGENT_SERVICE_TOKEN') { Write-Ok '内部服务凭据已配置（值不显示）' } else { Fail '缺少 EDUPLUS_AGENT_SERVICE_TOKEN（运行 setup.ps1）' }
if (Test-EnvKey 'DATABASE_URL') { Write-Ok 'DATABASE_URL 已配置（值不显示）' } else { Fail '缺少 DATABASE_URL' }
$yml = Join-Path $script:ProjectRoot 'openmaic.yml'
if (Test-Path -LiteralPath $yml) {
    $text = [System.IO.File]::ReadAllText($yml)
    if ($text -match '(?m)^lock:\s*all') { Write-Ok 'openmaic.yml 锁定全部模型槽（不允许接入云端服务）' } else { Write-Warn 'openmaic.yml 未设置 lock: all' }
    if ($text -match '(?m)^\s*baseUrl:\s*https?://(?!localhost|127\.0\.0\.1)') { Fail 'openmaic.yml 中存在非本机的 baseUrl' }
} else { Fail '缺少 openmaic.yml' }
foreach ($legacy in @('DEFAULT_MODEL', 'OLLAMA_MODELS')) {
    if (Test-EnvKey $legacy) { Write-Warn "$legacy 是旧版配置，本项目以 openmaic.yml 为准，它不会生效" }
}

Write-Step '数据库'
node scripts/check-openmaic-db.cjs *> $null
if ($LASTEXITCODE -eq 0) { Write-Ok 'PostgreSQL 可连接且有建表权限' } else { Fail 'PostgreSQL 连不上（启动数据库服务或 pnpm db:up）' }

Write-Step '本地模型（Ollama）'
$model = Get-ConfiguredModel
$tags = Get-OllamaTags
if (-not $tags) { Fail 'Ollama 未运行（127.0.0.1:11434）' }
elseif (-not (Test-OllamaModel $tags $model)) { Fail "Ollama 中没有 openmaic.yml 指定的模型 $model" }
else {
    Write-Ok "模型 $model 已安装"
    $ctx = Get-ModelContext $model
    $envCtx = 0
    foreach ($scope in @('Process', 'User', 'Machine')) {
        $v = [Environment]::GetEnvironmentVariable('OLLAMA_CONTEXT_LENGTH', $scope)
        if ($v -match '^\d+$' -and [int]$v -gt $envCtx) { $envCtx = [int]$v }
    }
    if ($ctx -ge 8192) { Write-Ok "模型上下文 $ctx" }
    elseif ($ctx -gt 0) { Write-Warn "模型上下文只有 $ctx：课堂讨论、大纲和讲义的提示词更长，会被截断。启动平台.cmd 启动时会自动派生足够上下文的模型" }
    elseif ($envCtx -ge 8192) { Write-Ok "模型上下文由 OLLAMA_CONTEXT_LENGTH=$envCtx 提供" }
    else { Write-Warn '模型未设置上下文长度：网页端调用使用 Ollama 默认值（通常 4096），课堂讨论和长课件会被截断；启动平台.cmd 启动时会自动派生足够上下文的模型' }
    try {
        $body = @{ model = $model; prompt = '只回答：好'; stream = $false; options = @{ num_predict = 16 } } | ConvertTo-Json -Compress
        $r = Invoke-RestMethod -Uri "$script:OllamaBase/api/generate" -Method Post -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 180 -ErrorAction Stop
        $speed = 0
        if ($r.eval_duration -gt 0) { $speed = [math]::Round($r.eval_count / ($r.eval_duration / 1e9), 1) }
        Write-Ok "实际生成成功（$speed token/s）"
        $ps = ''
        if (Test-Command 'ollama') { $ps = (ollama ps 2>$null | Select-Object -Skip 1) -join ' ' }
        if ($ps -match '(\d+)%/(\d+)%\s*CPU/GPU') { Write-Warn "模型有 $($Matches[1])% 运行在 CPU 上（显存不足），速度会变慢" }
        elseif ($ps -match '100% GPU') { Write-Ok '模型 100% 运行在 GPU 上' }
    } catch { Fail '模型生成测试失败' }
}

Write-Step '正在运行的服务（未启动时可忽略）'
try { Invoke-WebRequest -Uri 'http://127.0.0.1:3000' -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop | Out-Null; Write-Ok '网页 http://127.0.0.1:3000 正在运行' } catch { Write-Host '  网页未运行' }
try {
    $h = Invoke-RestMethod -Uri 'http://127.0.0.1:8001/health' -TimeoutSec 3 -ErrorAction Stop
    Write-Ok "Agent 服务正在运行（$($h.status)）"
} catch { Write-Host '  Agent 未运行（网页会在需要时自动启动）' }

Write-Host ''
if ($failed -eq 0) { Write-Host '自检通过：可以离线运行。' -ForegroundColor Green; exit 0 }
Write-Host "自检有 $failed 项未通过，请按上面的提示处理。" -ForegroundColor Red
exit 1
