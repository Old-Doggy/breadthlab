# 全量重算（周日 02:00）：mart -> status -> 导出 -> 简报
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$py = $env:PYTHON
if (-not $py) { $py = "python" }
if (-not (Test-Path $py)) { $py = "python" }

$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("rebuild_{0}.log" -f (Get-Date -Format "yyyyMMdd_HHmmss"))

try {
  & $py -m pipeline.build_marts 2>&1 | Tee-Object -FilePath $log
  if ($LASTEXITCODE -ne 0) { throw "build_marts failed" }
  & $py -m pipeline.refresh_status 2>&1 | Tee-Object -FilePath $log -Append
  & $py -m pipeline.export_static 2>&1 | Tee-Object -FilePath $log -Append
  & (Join-Path $PSScriptRoot "briefing.ps1")
  Write-Host "[rebuild] OK"
} catch {
  Write-Host "[rebuild] FAILED: $_"
  exit 1
}
