# 注册「每个交易日 17:35 自动更新」的 Windows 计划任务（当前用户）
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $root "scripts\update.ps1"

$action = New-ScheduledTaskAction -Execute "pwsh.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`"" `
  -WorkingDirectory $root

$trigger = New-ScheduledTaskTrigger -Weekly `
  -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At 17:35

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName "BreadthLab Daily Update" `
  -Action $action -Trigger $trigger -Settings $settings `
  -Description "BreadthLab: 收盘后增量更新 A 股数据并重新导出 dashboard" -Force

Write-Host "已注册：BreadthLab Daily Update（周一至周五 17:35）"
Write-Host "手动运行：Start-ScheduledTask -TaskName 'BreadthLab Daily Update'"
