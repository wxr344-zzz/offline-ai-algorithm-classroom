param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 8001
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw '找不到项目 .venv，请先创建虚拟环境并安装 requirements-api.txt。'
}
$env:PYTHONIOENCODING = 'utf-8'
Push-Location -LiteralPath $projectRoot
try {
    # 单进程服务使并发限制覆盖本机模型的全部请求；Ctrl+C 停止。
    & node (Join-Path $PSScriptRoot 'run-eduplus-agent.mjs') $Port
    if ($LASTEXITCODE -ne 0) { throw "Agent 服务退出，状态码：$LASTEXITCODE" }
} finally {
    Pop-Location
}
