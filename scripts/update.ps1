# 每日更新：增量 -> 重算 mart -> 重新导出单文件 dashboard
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$py = $env:PYTHON
if (-not $py) { $py = "python" }
if (-not (Test-Path $py)) { $py = "python" }

$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$log = Join-Path $logDir "update_$stamp.log"

$stage = "update"
try {
  $updated = $false
  for ($i = 1; $i -le 3; $i++) {
    & $py -m pipeline.update_daily 2>&1 | Tee-Object -FilePath $log -Append
    if ($LASTEXITCODE -eq 0) { $updated = $true; break }
    if ($LASTEXITCODE -eq 2) { throw "update_daily: quality gates failed" }
    Write-Warning "[update] attempt $i failed (exit $LASTEXITCODE), retrying in $($i * 45)s"
    Start-Sleep -Seconds ($i * 45)
  }
  if (-not $updated) { throw "update_daily failed after 3 attempts" }

  $stage = "marts"
  & $py -m pipeline.build_marts 2>&1 | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) { throw "build_marts failed ($LASTEXITCODE)" }

  $stage = "export"
  & $py -m pipeline.export_static 2>&1 | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) { throw "export_static failed ($LASTEXITCODE)" }

  try {
    & (Join-Path $PSScriptRoot "briefing.ps1")
  } catch {
    Write-Warning "[update] briefing failed (data is still updated): $_"
  }

  & $py -m pipeline.alerts --clear 2>&1 | Out-Null
  Write-Host "[update] OK -> frontend/dist/BreadthLab.html"
} catch {
  $msg = "$_"
  try {
    & $py -m pipeline.alerts --set --stage $stage --message $msg --log $log 2>&1 | Out-Null
  } catch {
    Write-Warning "[update] could not write alert: $_"
  }
  Write-Host "[update] FAILED ($stage): $msg"
  exit 1
}
