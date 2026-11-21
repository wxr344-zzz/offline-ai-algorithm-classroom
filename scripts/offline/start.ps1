# OpenMAIC 离线启动：检查并拉起 Ollama、数据库，然后启动网页（Agent 由网页按需自动启动）。
# 用法：powershell -ExecutionPolicy Bypass -File scripts\offline\start.ps1 [-Dev] [-Port 3000] [-NoBrowser]
#   默认以生产模式运行（需先执行 setup.ps1 完成构建）；-Dev 以开发模式运行（pnpm dev）。
param(
    [switch]$Dev,
    [ValidateRange(1024, 65535)]
    [int]$Port = 3000,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'common.ps1')
Set-Location -LiteralPath $script:ProjectRoot

Write-Step '检查运行环境'
if (-not (Test-Path -LiteralPath 'node_modules\next')) { Write-Bad '尚未安装依赖，请先运行 scripts\offline\setup.ps1'; exit 1 }
if (-not (Test-Path -LiteralPath $script:VenvPython)) { Write-Bad '缺少 Python 虚拟环境 .venv，请先运行 scripts\offline\setup.ps1'; exit 1 }
if (-not (Test-EnvKey 'EDUPLUS_AGENT_SERVICE_TOKEN')) { Write-Bad '缺少内部服务凭据，请先运行 scripts\offline\setup.ps1'; exit 1 }
# 已有一个 OpenMAIC 在运行（例如之前开的 pnpm dev）：构建和端口会冲突，直接打开它。
try {
    Invoke-WebRequest -Uri "http://127.0.0.1:$Port" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop | Out-Null
    Write-Warn "OpenMAIC 已经在 http://127.0.0.1:$Port 运行；如需以离线生产模式重新启动，请先关闭正在运行的窗口（如 pnpm dev）再双击本脚本"
    if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$Port" }
    exit 0
} catch { }

if (-not $Dev) {
    # 没有生产构建（例如运行过 pnpm dev 后被清掉）或构建早于源码时，自动构建；断网也能完成。
    $stale = $null
    if (-not (Test-Path -LiteralPath '.next\BUILD_ID')) { $stale = '（尚无生产构建）' } else { $stale = Get-StaleSource }
    if ($stale) {
        Write-Warn "需要重新构建（$stale）：正在构建，断网也可完成，约需几分钟"
        $env:NEXT_TELEMETRY_DISABLED = '1'
        pnpm build
        if ($LASTEXITCODE -ne 0) { Write-Bad '重新构建失败；可改用 -Dev 以开发模式启动，并把报错发给开发者'; exit 1 }
        Write-Ok '已重新构建'
    }
}

$model = Get-ConfiguredModel
$tags = Get-OllamaTags
if (-not $tags -and (Test-Command 'ollama')) {
    Write-Warn 'Ollama 未运行，正在后台启动'
    Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden
    for ($i = 0; $i -lt 30 -and -not $tags; $i++) { Start-Sleep -Seconds 1; $tags = Get-OllamaTags }
}
if (-not $tags) { Write-Bad '无法连接 Ollama（127.0.0.1:11434），请先打开 Ollama'; exit 1 }
if ($model -and -not (Test-OllamaModel $tags $model)) { Write-Bad "Ollama 中没有模型 $model（openmaic.yml 的 llm 槽）"; exit 1 }
# 网页端调用需要模型自带足够的上下文（见 common.ps1），不足时自动派生一次。
$model = Ensure-ContextModel $model
Write-Ok "Ollama 就绪，模型 $model"

node scripts/check-openmaic-db.cjs *> $null
if ($LASTEXITCODE -ne 0) {
    $started = $false
    if (Test-Command 'docker') { pnpm db:up | Out-Null; $started = $true }
    else {
        $svc = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($svc -and $svc.Status -ne 'Running') {
            Write-Warn "数据库服务 $($svc.Name) 未运行，尝试启动（可能需要管理员权限）"
            try { Start-Service -Name $svc.Name -ErrorAction Stop; $started = $true } catch { }
        }
    }
    if ($started) { node scripts/check-openmaic-db.cjs *> $null }
    if ($LASTEXITCODE -ne 0) { Write-Bad '数据库连不上：请启动 PostgreSQL（服务 postgresql-x64-16 或 pnpm db:up）后重试'; exit 1 }
}
Write-Ok '数据库可连接'

# 本地 Agent（127.0.0.1:8001）由网页在需要时自动启动，生产模式下也开启。
$env:EDUPLUS_AGENT_AUTO_START = '1'
$env:NEXT_TELEMETRY_DISABLED = '1'
$env:PYTHONIOENCODING = 'utf-8'
$url = "http://127.0.0.1:$Port"

if (-not $NoBrowser) {
    Start-Job -ArgumentList $url -ScriptBlock {
        param($u)
        for ($i = 0; $i -lt 180; $i++) {
            try { Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop | Out-Null; Start-Process $u; return } catch { Start-Sleep -Seconds 1 }
        }
    } | Out-Null
}

Write-Step "启动 OpenMAIC：$url（Ctrl+C 停止）"
if ($Dev) {
    if ($Port -ne 3000) { Write-Warn '开发模式固定使用 3000 端口' }
    pnpm dev
} else {
    $env:NODE_ENV = 'production'
    pnpm exec next start --hostname 127.0.0.1 --port $Port
}
exit $LASTEXITCODE
