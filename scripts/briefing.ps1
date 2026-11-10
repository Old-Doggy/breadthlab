# 生成每日市场体检简报（PDF + PNG），无需服务器
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$edge = @(
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $edge) { throw "未找到 Edge/Chrome" }

$html = Join-Path $root "frontend\dist\BreadthLab.html"
if (-not (Test-Path $html)) { throw "请先运行 python -m pipeline.export_static" }

$stamp = Get-Date -Format "yyyyMMdd"
$outDir = Join-Path $root "data\snapshots\$stamp"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$url = "file:///" + ($html -replace "\\", "/") + "#/briefing"
$pdf = Join-Path $outDir "briefing.pdf"
$png = Join-Path $outDir "briefing.png"

& $edge --headless=new --disable-gpu --no-first-run --allow-file-access-from-files `
  --no-pdf-header-footer --virtual-time-budget=12000 --print-to-pdf="$pdf" "$url" 2>&1 | Out-Null

& $edge --headless=new --disable-gpu --no-first-run --allow-file-access-from-files `
  --hide-scrollbars --window-size=1240,1754 --virtual-time-budget=12000 --screenshot="$png" "$url" 2>&1 | Out-Null

if (Test-Path $pdf) { Write-Host "[briefing] PDF  -> $pdf" } else { Write-Host "[briefing] PDF 生成失败" }
if (Test-Path $png) { Write-Host "[briefing] PNG  -> $png" } else { Write-Host "[briefing] PNG 生成失败" }
