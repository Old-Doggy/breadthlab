# Generate daily briefing PDF + PNG without a server.
# Edge is given an ASCII-only temp path to avoid code-page issues with Chinese paths.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$edge = @(
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $edge) { throw "Edge/Chrome not found" }

$html = Join-Path $root "frontend\dist\ashare-radar.html"
if (-not (Test-Path $html)) { throw "Run python -m pipeline.export_static first" }

$stamp = Get-Date -Format "yyyyMMdd"
$outDir = Join-Path $root "data\snapshots\$stamp"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$tmp = Join-Path $env:TEMP "ashare-radar_briefing"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$tmpHtml = Join-Path $tmp "dashboard.html"
$tmpPdf = Join-Path $tmp "briefing.pdf"
$tmpPng = Join-Path $tmp "briefing.png"
Copy-Item $html $tmpHtml -Force
Remove-Item $tmpPdf, $tmpPng -Force -ErrorAction SilentlyContinue

$url = "file:///" + ($tmpHtml -replace "\\", "/") + "#/briefing"
$common = "--headless=new --disable-gpu --no-first-run --allow-file-access-from-files --virtual-time-budget=12000"

$pdfArgs = "$common --no-pdf-header-footer --print-to-pdf=`"$tmpPdf`" `"$url`""
Start-Process -FilePath $edge -ArgumentList $pdfArgs -NoNewWindow -Wait `
  -RedirectStandardError (Join-Path $tmp "edge_pdf.log") `
  -RedirectStandardOutput (Join-Path $tmp "edge_out.log") | Out-Null

$pngArgs = "$common --hide-scrollbars --window-size=1240,1754 --screenshot=`"$tmpPng`" `"$url`""
Start-Process -FilePath $edge -ArgumentList $pngArgs -NoNewWindow -Wait `
  -RedirectStandardError (Join-Path $tmp "edge_png.log") `
  -RedirectStandardOutput (Join-Path $tmp "edge_out2.log") | Out-Null

$pdf = Join-Path $outDir "briefing.pdf"
$png = Join-Path $outDir "briefing.png"
if (Test-Path $tmpPdf) { Copy-Item $tmpPdf $pdf -Force; Write-Host "[briefing] PDF -> $pdf" } else { throw "PDF generation failed" }
if (Test-Path $tmpPng) { Copy-Item $tmpPng $png -Force; Write-Host "[briefing] PNG -> $png" } else { throw "PNG generation failed" }
