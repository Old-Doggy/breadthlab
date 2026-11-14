# 注册计划任务：每个交易日 17:35 增量更新；每周日 02:00 全量重算
$ErrorActionPreference = "Stop"
# Times below use the host timezone and weekdays, not the exchange calendar.
$root = Split-Path -Parent $PSScriptRoot
$updateScript = Join-Path $root "scripts\update.ps1"
$rebuildScript = Join-Path $root "scripts\rebuild.ps1"
$py = & (Join-Path $PSScriptRoot "python.ps1")
$pyLiteral = $py.Replace("'", "''")

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 45)

# 把已验证的解释器写进任务，避免计划任务环境里 PATH 指向缺少依赖的 python。
$dailyArgs = "-NoProfile -ExecutionPolicy Bypass -Command `"`$env:ASHARE_RADAR_PYTHON='$pyLiteral'; & '$updateScript'`""
$dailyAction = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument $dailyArgs -WorkingDirectory $root
$dailyTrigger = New-ScheduledTaskTrigger -Weekly `
  -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At 17:35

Register-ScheduledTask -TaskName "Ashare Radar Daily Update" `
  -Action $dailyAction -Trigger $dailyTrigger -Settings $settings `
  -Description "Ashare Radar: 收盘后增量更新 A 股数据并重新导出 dashboard" -Force | Out-Null

$weeklyArgs = "-NoProfile -ExecutionPolicy Bypass -Command `"`$env:ASHARE_RADAR_PYTHON='$pyLiteral'; & '$rebuildScript'`""
$weeklyAction = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument $weeklyArgs -WorkingDirectory $root
$weeklyTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 02:00

Register-ScheduledTask -TaskName "Ashare Radar Weekly Rebuild" `
  -Action $weeklyAction -Trigger $weeklyTrigger -Settings $settings `
  -Description "Ashare Radar: 周日全量重算 mart、刷新状态与简报" -Force | Out-Null

Write-Host "已注册：Ashare Radar Daily Update（周一至周五 17:35）"
Write-Host "已注册：Ashare Radar Weekly Rebuild（周日 02:00）"
Write-Host "使用解释器：$py"
Write-Host "手动运行：Start-ScheduledTask -TaskName 'Ashare Radar Daily Update'"
