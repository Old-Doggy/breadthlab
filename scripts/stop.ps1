param(
  [int]$Port = 8000
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root "data\meta\server.pid"
$stopped = $false

if (Test-Path -LiteralPath $pidFile) {
  $serverPid = [int]((Get-Content -LiteralPath $pidFile -Raw).Trim())
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$serverPid" -ErrorAction SilentlyContinue
  if ($process -and $process.CommandLine -match 'backend\.main') {
    Stop-Process -Id $serverPid -Force
    $stopped = $true
  }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

if (-not $stopped) {
  for ($candidate = $Port; $candidate -le ($Port + 10); $candidate++) {
    $connection = Get-NetTCPConnection -LocalPort $candidate -State Listen -ErrorAction SilentlyContinue
    if (-not $connection) { continue }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)" -ErrorAction SilentlyContinue
    if ($process -and $process.CommandLine -match 'backend\.main') {
      Stop-Process -Id $connection.OwningProcess -Force
      $stopped = $true
    }
  }
}

if ($stopped) {
  Write-Host "Ashare Radar 已停止"
} else {
  Write-Host "没有找到运行中的 Ashare Radar"
}
