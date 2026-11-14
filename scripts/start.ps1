param(
  [int]$Port = 8000,
  [switch]$NoBrowser
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Test-AshareRadar([int]$candidate) {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$candidate/api/health" -UseBasicParsing -TimeoutSec 2
    return ($response.StatusCode -eq 200 -and $response.Content -match '"ok"\s*:\s*true')
  } catch {
    return $false
  }
}

function Test-PortBusy([int]$candidate) {
  $connection = Get-NetTCPConnection -LocalPort $candidate -State Listen -ErrorAction SilentlyContinue
  return [bool]$connection
}

function Open-Dashboard([int]$candidate) {
  if ($NoBrowser) { return }
  Start-Process "http://127.0.0.1:$candidate"
}

if (Test-AshareRadar $Port) {
  Write-Host "Ashare Radar 已在运行：http://127.0.0.1:$Port"
  Open-Dashboard $Port
  exit 0
}

$dist = Join-Path $root "frontend\dist"
$index = Join-Path $dist "index.html"
$single = Join-Path $dist "ashare-radar.html"

if (-not (Test-Path -LiteralPath $index)) {
  if (Test-Path -LiteralPath $single) {
    Write-Host "未找到 Web 构建，打开离线单文件：$single"
    if (-not $NoBrowser) { Start-Process $single }
    exit 0
  }
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $npm) {
    throw "缺少 frontend/dist/index.html，且未找到 npm。请先运行 cd frontend; npm install; npm run build"
  }
  Write-Host "首次启动：安装并构建前端（约 1-3 分钟）..."
  Push-Location (Join-Path $root "frontend")
  try {
    & npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
  } finally {
    Pop-Location
  }
}

try {
  $py = & (Join-Path $PSScriptRoot "python.ps1")
} catch {
  Write-Warning "Python 启动失败：$_"
  if (Test-Path -LiteralPath $single) {
    Write-Warning "改为打开离线单文件（不包含实时接口）。"
    if (-not $NoBrowser) { Start-Process $single }
    exit 0
  }
  throw
}

if (-not (Test-Path -LiteralPath (Join-Path $root "data\lake.duckdb"))) {
  Write-Warning "data/lake.duckdb 不存在；页面会没有数据。请先运行 python -m pipeline.bootstrap_api --start 20240101"
}

$chosen = $Port
for ($i = 0; $i -lt 10; $i++) {
  if (-not (Test-PortBusy $chosen)) { break }
  $chosen = $Port + $i + 1
}
if (Test-PortBusy $chosen) {
  throw "端口 $Port 到 $($Port + 10) 都被占用"
}

$env:ASHARE_RADAR_PORT = "$chosen"
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outLog = Join-Path $logDir "server_$stamp.log"
$errLog = Join-Path $logDir "server_$stamp.err.log"
$process = Start-Process -FilePath $py -ArgumentList "-m", "backend.main" `
  -WorkingDirectory $root -RedirectStandardOutput $outLog -RedirectStandardError $errLog `
  -WindowStyle Hidden -PassThru

$pidFile = Join-Path $root "data\meta\server.pid"
New-Item -ItemType Directory -Force -Path (Split-Path $pidFile) | Out-Null
Set-Content -Path $pidFile -Value $process.Id -Encoding ASCII

$ready = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  if (Test-AshareRadar $chosen) { $ready = $true; break }
  if ($process.HasExited) { break }
}
if (-not $ready) {
  Write-Host "启动失败，错误日志：$errLog"
  if (Test-Path -LiteralPath $errLog) { Get-Content -LiteralPath $errLog -Tail 20 }
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
  exit 1
}

Write-Host "Ashare Radar 已启动：http://127.0.0.1:$chosen"
Write-Host "日志：$outLog"
Open-Dashboard $chosen
exit 0
