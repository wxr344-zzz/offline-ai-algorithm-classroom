# OpenMAIC 离线部署：准备阶段（需要联网一次；之后启动与使用全程离线）。
# 用法（项目根目录）：powershell -ExecutionPolicy Bypass -File scripts\offline\setup.ps1 [-Mirror] [-ContextLength 16384]
#   -Mirror         依赖下载走国内镜像（npmmirror / 清华 PyPI）；只作用于本次命令，不改全局配置
#   -ContextLength  为本地模型派生一个自带该上下文长度的版本，并把 openmaic.yml 指向它
#   -Model          使用的 Ollama 模型，默认取 openmaic.yml 的 llm 槽（qwen2.5-coder:7b）
#   -SkipBuild      跳过生产构建（只用 pnpm dev 时）
# 可重复运行：已完成的步骤会被检测并跳过，不会覆盖已有配置或密钥。
param(
    [switch]$Mirror,
    [ValidateRange(0, 131072)]
    [int]$ContextLength = 0,
    [string]$Model = '',
    [switch]$SkipBuild
)

# 原生命令的 stderr 在 PowerShell 5.1 + Stop 下会被当成异常；统一按退出码判断。
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'common.ps1')
Set-Location -LiteralPath $script:ProjectRoot
$npmRegistry = 'https://registry.npmmirror.com'
$pipIndex = 'https://pypi.tuna.tsinghua.edu.cn/simple'
if ($Mirror) { $env:EDUPLUS_ASSET_REGISTRY = $npmRegistry }

Write-Step '[1/7] Node.js 与 pnpm'
if (-not (Test-Command 'node')) { Write-Bad '未检测到 Node.js，请安装 Node.js 22.19 或更高版本（https://nodejs.org）后重试'; exit 1 }
$nodeVer = (node -v).TrimStart('v')
$nv = $nodeVer.Split('.')
if ([int]$nv[0] -lt 22 -or ([int]$nv[0] -eq 22 -and [int]$nv[1] -lt 19)) { Write-Bad "Node.js $nodeVer 版本过低，需要 22.19 或更高"; exit 1 }
Write-Ok "Node.js $nodeVer"
if (-not (Test-Command 'pnpm')) {
    Write-Warn '未检测到 pnpm，安装项目指定的 pnpm 10.28.0'
    if ($Mirror) { npm install -g pnpm@10.28.0 --registry $npmRegistry } else { npm install -g pnpm@10.28.0 }
    if ($LASTEXITCODE -ne 0) { Write-Bad 'pnpm 安装失败'; exit 1 }
}
Write-Ok "pnpm $(pnpm -v)"

Write-Step '[2/7] 网页依赖（pnpm install）'
$pnpmArgs = @('install')
if ($Mirror) { $pnpmArgs += @('--registry', $npmRegistry) }
& pnpm @pnpmArgs
if ($LASTEXITCODE -ne 0) {
    if (Test-Path -LiteralPath 'node_modules\next') { Write-Warn 'pnpm install 未成功（可能没有网络），沿用已安装的依赖继续' }
    else { Write-Bad '依赖安装失败：请检查网络，或加 -Mirror 使用国内镜像后重试'; exit 1 }
} else { Write-Ok '网页依赖已就绪' }

Write-Step '[3/7] Python 虚拟环境与 Agent 依赖'
if (-not (Test-Path -LiteralPath $script:VenvPython)) {
    $py = Find-SystemPython
    if (-not $py) { Write-Bad '未找到 Python 3.11 及以上版本，请安装 Python 3.11（https://www.python.org）后重试'; exit 1 }
    $exe = $py[0]; $rest = @(); if ($py.Count -gt 1) { $rest = $py[1..($py.Count - 1)] }
    & $exe @rest -m venv .venv
    if ($LASTEXITCODE -ne 0) { Write-Bad '创建 .venv 失败'; exit 1 }
    Write-Ok '已创建 .venv'
}
$importCheck = 'import fastapi, uvicorn, httpx, pydantic, tenacity, langgraph, langchain_core, nbformat'
& $script:VenvPython -c $importCheck 2>$null
if ($LASTEXITCODE -ne 0) {
    $pipArgs = @('-m', 'pip', 'install', '-r', 'requirements-api.txt')
    if ($Mirror) { $pipArgs += @('-i', $pipIndex) }
    & $script:VenvPython @pipArgs
    & $script:VenvPython -c $importCheck
    if ($LASTEXITCODE -ne 0) { Write-Bad 'Python 依赖安装失败：请检查网络，或加 -Mirror 后重试'; exit 1 }
}
Write-Ok "Agent 依赖已就绪（$(& $script:VenvPython --version)）"

Write-Step '[4/7] 内部服务凭据'
node scripts/prepare-eduplus-env.mjs
if ($LASTEXITCODE -ne 0) { Write-Bad '无法写入 EDUPLUS_AGENT_SERVICE_TOKEN'; exit 1 }
Write-Ok '凭据已配置（值不显示）'

Write-Step '[5/7] PostgreSQL 数据库'
if (-not (Test-EnvKey 'DATABASE_URL')) {
    # 新电脑：询问连接串并写入 .env.local（只写一次，值不回显）。
    $default = 'postgres://openmaic:openmaic@127.0.0.1:5432/openmaic'
    $m = [regex]::Match([System.IO.File]::ReadAllText((Join-Path $script:ProjectRoot '.env.example')), '(?m)^#\s*DATABASE_URL=(\S+)')
    if ($m.Success) { $default = $m.Groups[1].Value }
    Write-Warn '还没有配置数据库连接（DATABASE_URL）'
    Write-Host '  用 Docker（pnpm db:up）的直接回车；本机安装的 PostgreSQL 请输入连接串，'
    Write-Host '  格式：postgresql://用户名:密码@127.0.0.1:5432/数据库名'
    $secure = Read-Host '  DATABASE_URL' -AsSecureString
    $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
    if (-not $value) { $value = $default }
    $local = Join-Path $script:ProjectRoot '.env.local'
    [System.IO.File]::AppendAllText($local, "`n# PostgreSQL（离线部署脚本写入）`nDATABASE_URL=$value`n", (New-Object System.Text.UTF8Encoding $false))
    Write-Ok '已写入 .env.local（值不显示）'
}
node scripts/check-openmaic-db.cjs
if ($LASTEXITCODE -ne 0) {
    if (Test-Command 'docker') {
        Write-Warn '数据库未连通，尝试用 Docker 启动开发数据库（pnpm db:up）'
        pnpm db:up
        node scripts/check-openmaic-db.cjs
    }
    if ($LASTEXITCODE -ne 0) { Write-Bad '数据库连不上：请先启动 PostgreSQL 服务（服务名通常为 postgresql-x64-16），再重试'; exit 1 }
}
Write-Ok '数据库可连接'

Write-Step '[6/7] Ollama 本地模型'
if (-not $Model) { $Model = Get-ConfiguredModel }
if (-not $Model) { $Model = 'qwen2.5-coder:7b' }
$tags = Get-OllamaTags
if (-not $tags -and (Test-Command 'ollama')) {
    Write-Warn 'Ollama 服务未运行，正在后台启动 ollama serve'
    Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden
    for ($i = 0; $i -lt 30 -and -not $tags; $i++) { Start-Sleep -Seconds 1; $tags = Get-OllamaTags }
}
if (-not $tags) { Write-Bad '无法连接 Ollama（127.0.0.1:11434）：请安装并打开 Ollama（https://ollama.com）后重试'; exit 1 }
if (-not (Test-OllamaModel $tags $Model)) {
    Write-Warn "未安装模型 $Model，开始下载（约 4.7GB，支持断点续传）"
    ollama pull $Model
    if ($LASTEXITCODE -ne 0) { Write-Bad "模型下载失败，可稍后手动执行：ollama pull $Model"; exit 1 }
}
Write-Ok "模型 $Model 已安装"
# 网页端调用需要模型自带足够的上下文：-ContextLength 指定，否则按显存自动选择（16384，6GB 显存为 8192）。
$Model = Ensure-ContextModel $Model $ContextLength

Write-Step '[7/7] 生产构建（pnpm build）'
if ($SkipBuild) {
    Write-Warn '已跳过构建；之后只能用 -Dev 方式启动'
} else {
    pnpm build
    if ($LASTEXITCODE -ne 0) { Write-Bad '构建失败，请把上面的报错发给开发者'; exit 1 }
    Write-Ok '构建完成（.next）'
}

Write-Host ''
Write-Host '准备完成。现在可以断网，运行离线自检与启动：' -ForegroundColor Green
Write-Host '  powershell -ExecutionPolicy Bypass -File scripts\offline\check.ps1'
Write-Host '  双击项目根目录的 启动平台.cmd（或 scripts\offline\start.ps1）'
