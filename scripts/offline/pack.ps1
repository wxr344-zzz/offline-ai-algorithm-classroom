# 生成离线分发包：生成一个 zip，只含源码、脚本与说明，不含可重新安装的依赖和本机私密配置。
# 用法：powershell -ExecutionPolicy Bypass -File scripts\offline\pack.ps1 [-Output <zip 路径>]
# 不打包：node_modules、.next、.venv、.pnpm-store、.git、logs、缓存，以及 .env / .env.local（内部服务凭据、本机数据库账号密码）。
param([string]$Output = '', [switch]$NoReveal)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = $script:ProjectRoot
if (-not $Output) {
    $stamp = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'Pacific Standard Time').ToString('yyyyMMdd-HHmmss')
    $Output = Join-Path (Split-Path -Parent $root) "基于OpenMAIC的离线AI算法课堂-分发包-$stamp.zip"
}
$entryRoot = '基于OpenMAIC的离线AI算法课堂'
$skipDirs = @('node_modules', '.next', '.venv', '.pnpm-store', '.git', '.codegraph', '.pytest_cache',
    '__pycache__', '.turbo', '.vitest', 'coverage', 'test-results', 'playwright-report', 'local-database', '.codex', '.agents')
$skipFiles = @('database-runtime.json', 'openmaic.yml', '恢复下载前代理配置.cmd')
$skipPaths = @('scripts/temporary-download-dns.cjs','scripts/setup-dual-isolation.cjs')

Write-Step "打包到 $Output"
if (Test-Path -LiteralPath $Output) { throw 'Output archive already exists. Choose another name; existing packages are never overwritten.' }
$zip = [System.IO.Compression.ZipFile]::Open($Output, [System.IO.Compression.ZipArchiveMode]::Create)
$count = 0
function Add-Folder([string]$dir, [string]$prefix) {
    foreach ($item in Get-ChildItem -LiteralPath $dir -Force) {
        $rel = if ($prefix) { "$prefix/$($item.Name)" } else { $item.Name }
        if ($item.PSIsContainer) {
            if (-not $prefix -and $item.Name -in @('logs','data','recovery')) { continue }
            if ($skipDirs -contains $item.Name) { continue }
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
            Add-Folder $item.FullName $rel
        } else {
            if ($skipFiles -contains $item.Name) { continue }
            if ($skipPaths -contains $rel) { continue }
            if ($item.Name -like '.env*' -and $item.Name -notmatch '\.(example|sample|template)$') { continue }
            if (-not $prefix -and $item.Name -match '(?i)\.(zip|7z)$') { continue }
            if ($item.Name -match '(?i)\.(tsbuildinfo|log|bak|private)$') { continue }
            if ($item.FullName -eq $Output) { continue }
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $item.FullName, "$entryRoot/$rel", [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
            $script:count++
        }
    }
}
try {
    Add-Folder $root ''
    # Package the public fixed model routing, never the operator's live configuration.
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $root 'openmaic-dual.example.yml'), "$entryRoot/openmaic.yml", [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    # 版本信息（自动生成）：打包时间，方便使用者确认所用版本。
    $entry = $zip.CreateEntry("$entryRoot/分发包版本.txt")
    $writer = New-Object System.IO.StreamWriter($entry.Open(), (New-Object System.Text.UTF8Encoding $true))
    $writer.WriteLine('离线分发包：Gemma 4 E4B 16K 讲解 + Qwen 7B 大纲/实验。')
    $writer.WriteLine('打包时间（America/Los_Angeles）：' + [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'Pacific Standard Time').ToString('yyyy-MM-dd HH:mm'))
    $writer.Dispose()
} finally { $zip.Dispose() }
$size = [math]::Round((Get-Item -LiteralPath $Output).Length / 1MB, 1)
Write-Ok "完成：$count 个文件，$size MB"
Write-Host ''
Write-Host '已排除 .env 和 .env.local（你的内部服务凭据和数据库密码）；使用者运行准备脚本时会填写自己的。' -ForegroundColor Yellow
Write-Host '模型权重不在包里：准备运行环境.cmd 会准备 Qwen 和 Gemma 两个模型。请先阅读 主开发版本说明.md。' -ForegroundColor Yellow
if (-not $NoReveal) { explorer.exe /select, "$Output" }
