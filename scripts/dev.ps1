# 开发模式：Flask API (8000) + Vite (5173)
$root = Split-Path -Parent $PSScriptRoot
$py = "D:\Anaconda\envs\breadthlab\python.exe"
if (-not (Test-Path $py)) { $py = "python" }

Start-Process pwsh -ArgumentList @(
  "-NoExit", "-Command", "Set-Location '$root'; & '$py' -m backend.main"
)
Start-Process pwsh -ArgumentList @(
  "-NoExit", "-Command", "Set-Location '$root\frontend'; npm run dev"
)
Start-Sleep -Seconds 3
Start-Process "http://127.0.0.1:5173"
