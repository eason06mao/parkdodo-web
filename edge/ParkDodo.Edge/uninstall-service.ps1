# 停止並移除開機自動執行（資料與裝置金鑰保留在 %ProgramData%\ParkDodo\Edge）
$ErrorActionPreference = "SilentlyContinue"
Stop-ScheduledTask -TaskName "ParkDodo Edge"
Get-Process -Name "ParkDodo.Edge" | Stop-Process -Force
Unregister-ScheduledTask -TaskName "ParkDodo Edge" -Confirm:$false
Write-Host "已移除開機自動執行。"
