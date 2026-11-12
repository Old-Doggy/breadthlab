# Shared interpreter selection for both scheduled entry points.
$root = Split-Path -Parent $PSScriptRoot

function Test-ProjectPython([string]$candidate) {
  if (-not $candidate -or -not (Test-Path -LiteralPath $candidate)) { return $false }
  & $candidate -c "import duckdb, tushare" 2>$null | Out-Null
  return ($LASTEXITCODE -eq 0)
}

$py = $env:BREADTHLAB_PYTHON
if ($py) {
  if (-not (Test-ProjectPython $py)) {
    throw "BREADTHLAB_PYTHON does not provide duckdb/tushare: $py"
  }
  return $py
}

$candidates = @(
  (Join-Path $root ".venv\Scripts\python.exe"),
  (Join-Path $env:USERPROFILE "anaconda3\envs\breadthlab\python.exe"),
  (Join-Path $env:USERPROFILE "miniconda3\envs\breadthlab\python.exe"),
  (Join-Path $env:USERPROFILE "anaconda3\python.exe"),
  (Join-Path $env:USERPROFILE "miniconda3\python.exe"),
  "C:\ProgramData\Anaconda3\python.exe"
)
if ($env:CONDA_PREFIX) { $candidates = @((Join-Path $env:CONDA_PREFIX "python.exe")) + $candidates }
$command = Get-Command python -ErrorAction SilentlyContinue
if ($command) { $candidates += $command.Source }

foreach ($candidate in $candidates) {
  if (Test-ProjectPython $candidate) { return $candidate }
}
throw "No Python with duckdb/tushare found; set BREADTHLAB_PYTHON to the project interpreter"
