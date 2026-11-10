# 每日更新：增量 -> 重算 mart -> 重新导出单文件 dashboard
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$py = "D:\Anaconda\envs\breadthlab\python.exe"
if (-not (Test-Path $py)) { $py = "python" }

$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$log = Join-Path $logDir "update_$stamp.log"

try {
  & $py -m pipeline.update_daily 2>&1 | Tee-Object -FilePath $log
  if ($LASTEXITCODE -ne 0) { throw "update_daily failed ($LASTEXITCODE)" }

  & $py -m pipeline.build_marts 2>&1 | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) { throw "build_marts failed ($LASTEXITCODE)" }

  & $py -m pipeline.export_static 2>&1 | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) { throw "export_static failed ($LASTEXITCODE)" }

  & (Join-Path $PSScriptRoot "briefing.ps1") 2>&1 | Tee-Object -FilePath $log -Append
  Write-Host "[update] OK -> frontend/dist/BreadthLab.html"
} catch {
  Write-Host "[update] FAILED: $_"
  exit 1
}
