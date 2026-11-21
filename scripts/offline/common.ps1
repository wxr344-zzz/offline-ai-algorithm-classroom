# 离线部署脚本的公共函数（由 setup / start / check 以 dot-source 方式加载）。
# 兼容 Windows PowerShell 5.1 与 PowerShell 7；本文件须保存为 UTF-8 BOM。

$script:ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$script:VenvPython = Join-Path $script:ProjectRoot '.venv\Scripts\python.exe'
$script:OllamaBase = 'http://127.0.0.1:11434'

function Write-Step([string]$Text) { Write-Host ''; Write-Host "=== $Text ===" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "  [通过] $Text" -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host "  [注意] $Text" -ForegroundColor Yellow }
function Write-Bad([string]$Text) { Write-Host "  [失败] $Text" -ForegroundColor Red }

function Test-Command([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

# openmaic.yml 中 llm 槽使用的 Ollama 模型名（"local:qwen2.5-coder:7b" -> "qwen2.5-coder:7b"）。
function Get-ConfiguredModel {
    $file = Join-Path $script:ProjectRoot 'openmaic.yml'
    if (-not (Test-Path -LiteralPath $file)) { return $null }
    $text = [System.IO.File]::ReadAllText($file)
    $m = [regex]::Match($text, '(?m)^\s*llm:\s*[''"]?([^\s''"#]+)')
    if (-not $m.Success) { return $null }
    $slot = $m.Groups[1].Value
    $provider = $slot.Split(':')[0]
    if ([regex]::IsMatch($text, "(?m)^\s+$([regex]::Escape($provider)):\s*$")) {
        return $slot.Substring($provider.Length + 1)
    }
    return $slot
}

function Get-OllamaTags {
    try {
        return Invoke-RestMethod -Uri "$script:OllamaBase/api/tags" -TimeoutSec 5 -ErrorAction Stop
    } catch {
        return $null
    }
}

function Test-OllamaModel([object]$Tags, [string]$Model) {
    if (-not $Tags) { return $false }
    $want = $Model
    if ($want -notmatch ':') { $want = "${want}:latest" }
    foreach ($m in $Tags.models) { if ($m.name -eq $want -or $m.model -eq $want) { return $true } }
    return $false
}

# 模型自带的上下文长度（Modelfile 中的 num_ctx）；未设置时返回 0。
function Get-ModelContext([string]$Model) {
    try {
        $body = @{ model = $Model } | ConvertTo-Json -Compress
        $show = Invoke-RestMethod -Uri "$script:OllamaBase/api/show" -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 15 -ErrorAction Stop
        $m = [regex]::Match([string]$show.parameters, '(?m)^\s*num_ctx\s+(\d+)')
        if ($m.Success) { return [int]$m.Groups[1].Value }
    } catch { }
    return 0
}

# 只判断 .env / .env.local 里是否配置了某个键，从不读出或打印它的值。
function Test-EnvKey([string]$Key) {
    if ([Environment]::GetEnvironmentVariable($Key)) { return $true }
    foreach ($name in @('.env.local', '.env')) {
        $file = Join-Path $script:ProjectRoot $name
        if (Test-Path -LiteralPath $file) {
            $text = [System.IO.File]::ReadAllText($file)
            if ([regex]::IsMatch($text, "(?m)^\s*$([regex]::Escape($Key))\s*=\s*\S")) { return $true }
        }
    }
    return $false
}

# 生产构建（.next\BUILD_ID）是否早于网页源码：源码更新后必须重新构建，
# 否则 next start 运行的仍是旧代码。Python 代码不需要构建（Agent 按代码指纹自动重启）。
function Get-StaleSource {
    $buildId = Join-Path $script:ProjectRoot '.next\BUILD_ID'
    if (-not (Test-Path -LiteralPath $buildId)) { return $null }
    $built = (Get-Item -LiteralPath $buildId).LastWriteTimeUtc
    $roots = @('app', 'lib', 'components', 'packages', 'public', 'configs', 'contracts')
    foreach ($r in $roots) {
        $dir = Join-Path $script:ProjectRoot $r
        if (-not (Test-Path -LiteralPath $dir)) { continue }
        $newer = Get-ChildItem -LiteralPath $dir -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -notmatch '\\(node_modules|dist|\.turbo|vendor)\\' -and $_.LastWriteTimeUtc -gt $built } |
            Select-Object -First 1
        if ($newer) { return $newer.FullName.Substring($script:ProjectRoot.Length + 1) }
    }
    foreach ($f in @('package.json', 'next.config.ts', 'next.config.mjs', 'next.config.js', 'tsconfig.json')) {
        $file = Join-Path $script:ProjectRoot $f
        if ((Test-Path -LiteralPath $file) -and (Get-Item -LiteralPath $file).LastWriteTimeUtc -gt $built) { return $f }
    }
    return $null
}

# 显卡显存（MB），没有 NVIDIA 显卡或查不到时返回 0。
function Get-GpuMemoryMB {
    if (-not (Test-Command 'nvidia-smi')) { return 0 }
    try {
        $out = nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>$null | Select-Object -First 1
        if ($out -match '^\s*(\d+)') { return [int]$Matches[1] }
    } catch { }
    return 0
}

# 网页端通过 Ollama 的 OpenAI 兼容接口调用模型，这个接口不能按请求设置上下文长度，
# 只能使用模型自带的 num_ctx（未设置时 Ollama 默认通常只有 4096）。课堂讨论、大纲和讲义的
# 提示词都比这长，会被静默截断，表现为讨论“数据流中断”/直接结束、内容残缺。
# 这里在需要时由本机模型派生一个自带足够上下文的版本（离线即可完成），并让 openmaic.yml 指向它。
function Ensure-ContextModel([string]$Model, [int]$ContextLength = 0) {
    if (-not $Model -or -not (Test-Command 'ollama')) { return $Model }
    $current = Get-ModelContext $Model
    if ($ContextLength -le 0) {
        if ($current -ge 8192) { return $Model }
        $gpu = Get-GpuMemoryMB
        $ContextLength = 16384
        if ($gpu -gt 0 -and $gpu -lt 7500) { $ContextLength = 8192 }
    } elseif ($current -eq $ContextLength) { return $Model }
    $name = $Model; $tag = 'latest'
    if ($Model -match '^(.+):([^:]+)$') { $name = $Matches[1]; $tag = $Matches[2] -replace '-ctx\d+$', '' }
    $derived = "${name}:${tag}-ctx$ContextLength"
    $logs = Join-Path $script:ProjectRoot 'logs'
    New-Item -ItemType Directory -Force -Path $logs | Out-Null
    $modelfile = Join-Path $logs "Modelfile.$tag-ctx$ContextLength"
    [System.IO.File]::WriteAllText($modelfile, "FROM ${name}:$tag`nPARAMETER num_ctx $ContextLength`n", (New-Object System.Text.UTF8Encoding $false))
    Write-Warn "模型 $Model 的上下文只有 $(if ($current) { $current } else { 'Ollama 默认值' })，正在派生 $derived（上下文 $ContextLength，离线完成，只需一次）"
    ollama create $derived -f $modelfile | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Bad "派生模型 $derived 创建失败，继续使用 $Model"; return $Model }
    $yml = Join-Path $script:ProjectRoot 'openmaic.yml'
    $text = [System.IO.File]::ReadAllText($yml)
    if ($text.Contains($Model)) {
        Copy-Item -LiteralPath $yml -Destination (Join-Path $logs ('openmaic.yml.bak-' + (Get-Date -Format 'yyyyMMdd-HHmmss')))
        [System.IO.File]::WriteAllText($yml, $text.Replace($Model, $derived), (New-Object System.Text.UTF8Encoding $false))
    }
    Write-Ok "openmaic.yml 已改用 $derived（原文件备份在 logs\）"
    return $derived
}

function Find-SystemPython {
    $candidates = @()
    if (Test-Command 'py') { $candidates += , @('py', '-3.11'); $candidates += , @('py', '-3.12'); $candidates += , @('py', '-3') }
    if (Test-Command 'python') { $candidates += , @('python') }
    foreach ($c in $candidates) {
        $exe = $c[0]
        $rest = @()
        if ($c.Count -gt 1) { $rest = $c[1..($c.Count - 1)] }
        try {
            $ver = & $exe @rest -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>$null
            if ($LASTEXITCODE -eq 0 -and $ver) {
                $parts = $ver.Trim().Split('.')
                if ([int]$parts[0] -eq 3 -and [int]$parts[1] -ge 11) { return , $c }
            }
        } catch { }
    }
    return $null
}
