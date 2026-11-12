# Shared interpreter selection for both scheduled entry points.
$root = Split-Path -Parent $PSScriptRoot
$py = $env:BREADTHLAB_PYTHON
if (-not $py) {
  foreach ($candidate in @(
    (Join-Path $root ".venv\Scripts\python.exe"),
    (Join-Path $env:USERPROFILE "anaconda3\envs\breadthlab\python.exe"),
    (Join-Path $env:USERPROFILE "miniconda3\envs\breadthlab\python.exe")
  )) {
    if (Test-Path -LiteralPath $candidate) { $py = $candidate; break }
  }
}
if (-not $py) {
  $command = Get-Command python -ErrorAction SilentlyContinue
  if ($command) { $py = $command.Source }
}
if (-not $py) { throw "Python not found; configure BREADTHLAB_PYTHON" }
return $py
