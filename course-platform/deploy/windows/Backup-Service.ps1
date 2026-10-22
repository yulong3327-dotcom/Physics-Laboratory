#requires -Version 5.1
#requires -RunAsAdministrator
[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z][A-Za-z0-9_-]{2,63}$')][string]$ServiceName = 'ZhikeCourse',
    [string]$ProjectRoot = (Join-Path $PSScriptRoot '..\..'),
    [string]$DataDirectory,
    [string]$BackupDirectory = (Join-Path $env:ProgramData 'ZhikeCourse\backups'),
    [ValidateRange(2, 365)][int]$KeepDays = 7
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Private-Paths.ps1')
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
if (-not $DataDirectory) { $DataDirectory = Join-Path $ProjectRoot 'server\data\production' }
$DataDirectory = [IO.Path]::GetFullPath($DataDirectory)
$BackupDirectory = [IO.Path]::GetFullPath($BackupDirectory)
if (-not (Test-Path -LiteralPath $DataDirectory -PathType Container)) { throw 'Data directory does not exist. Pass the configured production data directory explicitly.' }
if ($BackupDirectory.TrimEnd('\').StartsWith($DataDirectory.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or $BackupDirectory.TrimEnd('\') -eq $DataDirectory.TrimEnd('\')) { throw 'Backups must be outside the data directory.' }
if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot '.env') -PathType Leaf)) { throw 'Root .env is missing.' }
$service = Get-Service -Name $ServiceName -ErrorAction Stop
New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
Protect-PrivatePath -LiteralPath $BackupDirectory
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$stage = Join-Path $BackupDirectory ('snapshot-' + $stamp)
$zip = Join-Path $BackupDirectory ('zhike-' + $stamp + '.zip')
New-Item -ItemType Directory -Path $stage | Out-Null
$wasRunning = $service.Status -eq 'Running'
$copySucceeded = $false
try {
    if ($service.Status -ne 'Stopped') {
        Stop-Service -Name $ServiceName
        (Get-Service -Name $ServiceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(60))
    }
    # Keep the database, WAL and uploaded files in the same stopped-service snapshot.
    Copy-Item -LiteralPath $DataDirectory -Destination (Join-Path $stage 'data') -Recurse
    Copy-Item -LiteralPath (Join-Path $ProjectRoot '.env') -Destination (Join-Path $stage '.env')
    $secretDirectory = Join-Path $ProjectRoot 'secrets'
    if (Test-Path -LiteralPath $secretDirectory -PathType Container) { Copy-Item -LiteralPath $secretDirectory -Destination (Join-Path $stage 'secrets') -Recurse }
    [ordered]@{ CreatedUtc = [DateTime]::UtcNow.ToString('o'); ProjectRoot = $ProjectRoot; DataDirectory = $DataDirectory; ServiceName = $ServiceName; Consistency = 'Service stopped during copy; data includes SQLite WAL and uploads.' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'manifest.json') -Encoding UTF8
    $copySucceeded = $true
} finally {
    if ($wasRunning) {
        Start-Service -Name $ServiceName
        (Get-Service -Name $ServiceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(60))
    }
}
if (-not $copySucceeded) { throw 'Snapshot copy failed; partial files were preserved for inspection.' }
# Compression runs after the API has resumed, reducing maintenance downtime.
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [IO.Compression.CompressionLevel]::Fastest, $false)
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText($zip + '.sha256', $hash + '  ' + [IO.Path]::GetFileName($zip) + [Environment]::NewLine)
# Delete only this invocation's verified staging directory, within the backup root.
$stageFull = [IO.Path]::GetFullPath($stage)
if (-not $stageFull.StartsWith($BackupDirectory.TrimEnd('\') + '\snapshot-', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected staging path; refusing cleanup.' }
Remove-Item -LiteralPath $stageFull -Recurse -Force
$cutoff = [DateTime]::UtcNow.AddDays(-$KeepDays)
foreach ($expired in @(Get-ChildItem -LiteralPath $BackupDirectory -File -Filter 'zhike-*.zip' | Where-Object { $_.LastWriteTimeUtc -lt $cutoff })) {
    Remove-Item -LiteralPath $expired.FullName -Force
    if (Test-Path -LiteralPath ($expired.FullName + '.sha256')) { Remove-Item -LiteralPath ($expired.FullName + '.sha256') -Force }
}
Write-Output ('Backup completed: ' + $zip)
Write-Output ('SHA256: ' + $hash)
Write-Output 'The backup contains private credentials. Keep it in protected storage and copy it off-server securely.'
