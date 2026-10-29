# ParkDodo Edge：設定成開機自動執行（請用「以系統管理員身分執行」的 PowerShell）
#   powershell -ExecutionPolicy Bypass -File .\install-service.ps1
# 做的事：
#   1. 建立工作排程「ParkDodo Edge」：開機時以 SYSTEM 身分執行 ParkDodo.Edge.exe run，不需要登入 Windows
#   2. 每 5 分鐘檢查一次：程式沒在跑就重新啟動（當機或被關掉也會自己回來）
#   3. 限制資料夾權限：只有 SYSTEM 與系統管理員能讀取裝置金鑰與資料
$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $dir "ParkDodo.Edge.exe"
if (-not (Test-Path $exe)) { throw "找不到 $exe" }
$data = Join-Path $env:ProgramData "ParkDodo\Edge"
New-Item -ItemType Directory -Force -Path $data | Out-Null
icacls $data /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null

$action   = New-ScheduledTaskAction -Execute $exe -Argument "run" -WorkingDirectory $dir
$atBoot   = New-ScheduledTaskTrigger -AtStartup
$watchdog = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName "ParkDodo Edge" -Action $action -Trigger @($atBoot, $watchdog) -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName "ParkDodo Edge"
Write-Host "✅ 已設定開機自動執行，並已啟動。日誌在 $data\logs"
