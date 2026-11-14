# Shared interpreter selection for both scheduled entry points.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot

function Test-ProjectPython([string]$candidate) {
  if (-not $candidate -or -not (Test-Path -LiteralPath $candidate)) { return $false }
  & $candidate -c "import duckdb, tushare" *> $null
  return ($LASTEXITCODE -eq 0)
}

$py = $env:ASHARE_RADAR_PYTHON
if ($py) {
  if (-not (Test-ProjectPython $py)) {
    throw "ASHARE_RADAR_PYTHON does not provide duckdb/tushare: $py"
  }
  return $py
}

$candidates = @((Join-Path $root ".venv\Scripts\python.exe"))

# conda records every environment it created, including envs outside PATH.
$condaRegistry = Join-Path $env:USERPROFILE ".conda\environments.txt"
if (Test-Path -LiteralPath $condaRegistry) {
  foreach ($line in Get-Content -LiteralPath $condaRegistry) {
    $envRoot = $line.Trim()
    if ($envRoot) { $candidates += (Join-Path $envRoot "python.exe") }
  }
}
if ($env:CONDA_PREFIX) { $candidates += (Join-Path $env:CONDA_PREFIX "python.exe") }

$candidates += @(
  (Join-Path $env:USERPROFILE "anaconda3\envs\ashare-radar\python.exe"),
  (Join-Path $env:USERPROFILE "miniconda3\envs\ashare-radar\python.exe"),
  (Join-Path $env:USERPROFILE "anaconda3\python.exe"),
  (Join-Path $env:USERPROFILE "miniconda3\python.exe"),
  "C:\ProgramData\Anaconda3\python.exe"
)
$command = Get-Command python -ErrorAction SilentlyContinue
if ($command) { $candidates += $command.Source }

foreach ($candidate in ($candidates | Select-Object -Unique)) {
  if (Test-ProjectPython $candidate) { return $candidate }
}
throw "No Python with duckdb/tushare found; set ASHARE_RADAR_PYTHON to the project interpreter"
