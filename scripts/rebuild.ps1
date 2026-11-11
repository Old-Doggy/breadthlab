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

$stage = "marts"
try {
  & $py -m pipeline.build_marts 2>&1 | Tee-Object -FilePath $log
  if ($LASTEXITCODE -ne 0) { throw "build_marts failed" }

  $stage = "status"
  & $py -m pipeline.refresh_status 2>&1 | Tee-Object -FilePath $log -Append

  $stage = "export"
  & $py -m pipeline.export_static 2>&1 | Tee-Object -FilePath $log -Append
  & (Join-Path $PSScriptRoot "briefing.ps1")

  & $py -m pipeline.alerts --clear 2>&1 | Out-Null
  Write-Host "[rebuild] OK"
} catch {
  $msg = "$_"
  try {
    & $py -m pipeline.alerts --set --stage $stage --message $msg --log $log 2>&1 | Out-Null
  } catch {
    Write-Warning "[rebuild] could not write alert: $_"
  }
  try {
    & $py -m pipeline.export_static 2>&1 | Tee-Object -FilePath $log -Append
  } catch {
    Write-Warning "[rebuild] could not export alert build: $_"
  }
  Write-Host "[rebuild] FAILED ($stage): $msg"
  exit 1
}
