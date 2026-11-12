# Shared publication entry point: locking, gates, build and atomic export.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$py = & (Join-Path $PSScriptRoot "python.ps1")
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("update_{0}.log" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
& $py -m pipeline.release 2>&1 | Tee-Object -FilePath $log
$code = $LASTEXITCODE
if ($code -ne 0) {
  Write-Host "[update] FAILED; previous HTML preserved; see $log"
  exit $code
}
try { & (Join-Path $PSScriptRoot "briefing.ps1") }
catch { Write-Warning "Dashboard published; briefing generation failed" }
Write-Host "[update] OK"
