#requires -Version 5.1
#requires -RunAsAdministrator
[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z][A-Za-z0-9_-]{2,63}$')][string]$ServiceName = 'ZhikeCourse',
    [string]$ProjectRoot = (Join-Path $PSScriptRoot '..\..'),
    [string]$DataDirectory,
    [string]$BackupDirectory = (Join-Path $env:ProgramData 'ZhikeCourse\backups'),
    [ValidateRange(2, 365)][int]$KeepDays = 7,
    [ValidatePattern('^([01][0-9]|2[0-3]):[0-5][0-9]$')][string]$DailyAt = '03:30'
)
$ErrorActionPreference = 'Stop'
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
if (-not $DataDirectory) { $DataDirectory = Join-Path $ProjectRoot 'server\data\production' }
$DataDirectory = [IO.Path]::GetFullPath($DataDirectory)
$BackupDirectory = [IO.Path]::GetFullPath($BackupDirectory)
$script = Join-Path $ProjectRoot 'deploy\windows\Backup-Service.ps1'
if (-not (Test-Path -LiteralPath $script)) { throw 'Backup script is missing.' }
[void](Get-Service -Name $ServiceName -ErrorAction Stop)
$taskName = $ServiceName + '-DailyBackup'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw 'This backup task already exists. Inspect it before replacing it.' }
foreach ($value in @($script, $ProjectRoot, $DataDirectory, $BackupDirectory)) { if ($value.Contains('"')) { throw 'A path cannot contain quotation marks.' } }
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -ServiceName "{1}" -ProjectRoot "{2}" -DataDirectory "{3}" -BackupDirectory "{4}" -KeepDays {5}' -f $script, $ServiceName, $ProjectRoot, $DataDirectory, $BackupDirectory, $KeepDays
$action = New-ScheduledTaskAction -Execute (Join-Path $env:windir 'System32\WindowsPowerShell\v1.0\powershell.exe') -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Daily -At ([DateTime]::ParseExact($DailyAt, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture))
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Consistent course database, uploads and private configuration backup. Briefly stops the course API.' | Select-Object TaskName, State
Write-Output 'Run Backup-Service.ps1 once manually and verify restoration before relying on the daily task.'
