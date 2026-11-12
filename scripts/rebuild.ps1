# Shared publication entry point: locking, gates, build and atomic export.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("rebuild_{0}.log" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
try {
  $py = & (Join-Path $PSScriptRoot "python.ps1")
} catch {
  "[rebuild] FAILED: $_" | Tee-Object -FilePath $log
  exit 1
}
& $py -m pipeline.release --rebuild 2>&1 | Tee-Object -FilePath $log
$code = $LASTEXITCODE
if ($code -ne 0) {
  Write-Host "[rebuild] FAILED; previous HTML preserved; see $log"
  exit $code
}
try { & (Join-Path $PSScriptRoot "briefing.ps1") }
catch { Write-Warning "Dashboard published; briefing generation failed" }
Write-Host "[rebuild] OK"
