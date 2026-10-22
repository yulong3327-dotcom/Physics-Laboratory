#requires -Version 5.1
#requires -RunAsAdministrator
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ReleaseZip,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$Sha256,
    [ValidatePattern('^[A-Za-z][A-Za-z0-9_-]{2,63}$')][string]$ServiceName = 'ZhikeCourse',
    [string]$ProjectRoot = (Join-Path $PSScriptRoot '..\..'),
    [string]$NodeDirectory = 'C:\course-deploy\node-v24.19.0-win-x64',
    [string]$WorkDirectory = 'C:\course-deploy\updates',
    [string]$DataDirectory,
    [string]$BackupDirectory = (Join-Path $env:ProgramData 'ZhikeCourse\backups'),
    [string]$HealthBaseUrl = 'http://127.0.0.1:4310',
    [ValidateSet('wechat-virtual', 'wechat')][string]$PaymentMode = 'wechat-virtual',
    [ValidateRange(10, 120)][int]$ServiceTimeoutSeconds = 45,
    [ValidateRange(1, 30)][int]$HealthAttempts = 10
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Private-Paths.ps1')

function Get-FullPath([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    if ($full -eq [IO.Path]::GetPathRoot($full).TrimEnd('\')) { throw 'A filesystem root is not an application or work directory.' }
    return $full
}
function Test-Within([string]$Path, [string]$Parent) {
    return $Path.StartsWith($Parent.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
}
function Assert-Child([string]$Path, [string]$Parent) {
    if (-not (Test-Within ([IO.Path]::GetFullPath($Path)) $Parent)) { throw 'Refusing an operation outside its verified parent directory.' }
}
function Assert-NoReparseAncestor([string]$Path) {
    $cursor = [IO.Path]::GetFullPath($Path)
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw ('Reparse-point parent is not allowed: ' + $cursor) }
        }
        $next = Split-Path -Parent $cursor
        if ($next -eq $cursor) { break }
        $cursor = $next
    }
}
function Stop-CourseService {
    $current = Get-Service -Name $ServiceName
    if ($current.Status -ne 'Stopped') {
        if ($current.Status -ne 'StopPending') { Stop-Service -Name $ServiceName }
        (Get-Service -Name $ServiceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds($ServiceTimeoutSeconds))
    }
}
function Start-CourseService {
    $current = Get-Service -Name $ServiceName
    if ($current.Status -eq 'StopPending') { $current.WaitForStatus('Stopped', [TimeSpan]::FromSeconds($ServiceTimeoutSeconds)) }
    if ((Get-Service -Name $ServiceName).Status -ne 'Running') { Start-Service -Name $ServiceName }
    (Get-Service -Name $ServiceName).WaitForStatus('Running', [TimeSpan]::FromSeconds($ServiceTimeoutSeconds))
}
function Test-Production([int]$Attempts) {
    for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri ($HealthBaseUrl + '/api/health') -TimeoutSec 4
            $config = Invoke-RestMethod -Uri ($HealthBaseUrl + '/api/config') -TimeoutSec 4
            $paymentReady = if ($PaymentMode -eq 'wechat-virtual') { $config.virtualPaymentConfigured -eq $true } else { $config.paymentConfigured -eq $true }
            if ($health.ok -eq $true -and $health.mode -eq 'production' -and $config.mode -eq 'production' -and $config.demoMode -eq $false -and $config.devLoginEnabled -eq $false -and $config.paymentMode -eq $PaymentMode -and $paymentReady) { return $true }
        } catch { }
        if ($attempt + 1 -lt $Attempts) { Start-Sleep -Seconds 2 }
    }
    return $false
}
function Get-PrivateHashes {
    $hashes = @{}
    $paths = @((Join-Path $ProjectRoot '.env'))
    $secretRoot = Join-Path $ProjectRoot 'secrets'
    if (Test-Path -LiteralPath $secretRoot) {
        Assert-NoReparseAncestor $secretRoot
        foreach ($item in @(Get-ChildItem -LiteralPath $secretRoot -Force -Recurse)) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Secret directories must not contain reparse points.' }
            if (-not $item.PSIsContainer) { $paths += $item.FullName }
        }
    }
    foreach ($path in $paths) { $hashes[$path] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }
    return $hashes
}
function Assert-PrivateHashes($Expected) {
    $actual = Get-PrivateHashes
    if ($Expected.Count -ne $actual.Count) { throw 'Private configuration file set changed during the update.' }
    foreach ($path in $Expected.Keys) {
        if (-not $actual.ContainsKey($path) -or $actual[$path] -ne $Expected[$path]) { throw 'Private configuration changed during the update.' }
    }
}

$ProjectRoot = Get-FullPath $ProjectRoot
$NodeDirectory = Get-FullPath $NodeDirectory
$WorkDirectory = Get-FullPath $WorkDirectory
$BackupDirectory = Get-FullPath $BackupDirectory
if (-not $DataDirectory) { $DataDirectory = Join-Path $ProjectRoot 'server\data\production' }
$DataDirectory = Get-FullPath $DataDirectory
$ReleaseZip = (Resolve-Path -LiteralPath $ReleaseZip).Path
if (-not (Test-Path -LiteralPath $ReleaseZip -PathType Leaf)) { throw 'ReleaseZip must be a file.' }
foreach ($path in @($ProjectRoot, $WorkDirectory, $DataDirectory, $BackupDirectory, $NodeDirectory)) { Assert-NoReparseAncestor $path }
if ((Test-Within $WorkDirectory $ProjectRoot) -or (Test-Within $ProjectRoot $WorkDirectory) -or $WorkDirectory -eq $ProjectRoot) { throw 'WorkDirectory must be outside the application directory and cannot contain it.' }
if ((Test-Within $WorkDirectory $DataDirectory) -or (Test-Within $DataDirectory $WorkDirectory) -or $WorkDirectory -eq $DataDirectory) { throw 'WorkDirectory must not overlap production data.' }
if ((Test-Within $BackupDirectory $ProjectRoot) -or (Test-Within $BackupDirectory $WorkDirectory) -or $BackupDirectory -eq $ProjectRoot -or $BackupDirectory -eq $WorkDirectory) { throw 'BackupDirectory must be outside the application and update directories.' }
if ([IO.Path]::GetPathRoot($WorkDirectory) -ne [IO.Path]::GetPathRoot($ProjectRoot)) { throw 'WorkDirectory and ProjectRoot must be on the same volume for fast dependency swaps.' }
if (-not (Test-Path -LiteralPath $DataDirectory -PathType Container)) { throw 'The configured production data directory does not exist.' }
$healthUri = [Uri]$HealthBaseUrl
if (-not $healthUri.IsAbsoluteUri -or $healthUri.Scheme -ne 'http' -or $healthUri.Host -notin @('localhost', '127.0.0.1', '[::1]', '::1') -or $healthUri.AbsolutePath -ne '/' -or $healthUri.Query -or $healthUri.Fragment -or $healthUri.UserInfo) { throw 'HealthBaseUrl must be a loopback HTTP origin.' }
$HealthBaseUrl = $HealthBaseUrl.TrimEnd('/')
foreach ($required in @('.env', 'server\index.js', 'node_modules', 'deploy\windows\Backup-Service.ps1')) {
    if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $required))) { throw ('Missing existing installation prerequisite: ' + $required) }
}
Assert-NoReparseAncestor (Join-Path $ProjectRoot '.env')
$node = Join-Path $NodeDirectory 'node.exe'
$npm = Join-Path $NodeDirectory 'node_modules\npm\bin\npm-cli.js'
foreach ($required in @($node, $npm)) { if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw 'NodeDirectory must contain official Node.js and npm.' } }
$nodeMajor = & $node -p "process.platform === 'win32' ? parseInt(process.versions.node,10) : 0"
if ($LASTEXITCODE -ne 0 -or [int]$nodeMajor -lt 24) { throw 'Node.js 24 or later for Windows is required.' }
if ((Get-Service -Name $ServiceName).Status -ne 'Running' -or -not (Test-Production 1)) { throw 'Existing service must pass production and payment-configuration checks before upgrading.' }

$mutex = New-Object Threading.Mutex($false, ('Global\ZhikeCourse-Update-' + $ServiceName))
$hasMutex = $false
try {
    try { $hasMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $hasMutex = $true }
    if (-not $hasMutex) { throw 'Another service update is already in progress.' }
    New-Item -ItemType Directory -Path $WorkDirectory -Force | Out-Null
    Protect-PrivatePath -LiteralPath $WorkDirectory
    $stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $stage = Join-Path $WorkDirectory ('release-' + $stamp)
    $rollback = Join-Path $WorkDirectory ('rollback-' + $stamp)
    New-Item -ItemType Directory -Path $stage, $rollback | Out-Null
    Protect-PrivatePath -LiteralPath $stage
    Protect-PrivatePath -LiteralPath $rollback
    # Use a private immutable copy for both hashing and extraction.
    $privateZip = Join-Path $stage 'release.zip'
    Copy-Item -LiteralPath $ReleaseZip -Destination $privateZip
    if ((Get-FileHash -LiteralPath $privateZip -Algorithm SHA256).Hash -ne $Sha256) { throw 'Release SHA256 does not match the trusted build.' }
    $payload = Join-Path $stage 'payload'
    New-Item -ItemType Directory -Path $payload | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($privateZip)
    try {
        $seen = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        [long]$unpackedBytes = 0
        if ($archive.Entries.Count -gt 20000) { throw 'Release has too many entries.' }
        foreach ($entry in $archive.Entries) {
            $relative = $entry.FullName.Replace('/', '\').TrimEnd('\')
            if (-not $relative -or $relative.StartsWith('\') -or $relative -match ':' -or $relative -match '[\x00-\x1f]') { throw 'Unsafe ZIP entry.' }
            $parts = $relative.Split('\')
            if ($parts[0] -cne 'course-platform') { throw 'Release must have a single course-platform top-level folder.' }
            foreach ($part in $parts) {
                if (-not $part -or $part -in @('.', '..') -or $part.EndsWith('.') -or $part.EndsWith(' ') -or $part -match '[<>"|?*]' -or $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') { throw 'Unsafe Windows ZIP path component.' }
                if ($part -in @('node_modules', 'data', 'uploads', 'secrets', '.git', '.tmp', '.services')) { throw 'Release includes a protected or generated directory.' }
            }
            $name = $parts[$parts.Count - 1]
            if (($name -like '.env*' -and $name -ne '.env.example') -or $name -match '(?i)\.(pem|key|sqlite|db|log)$' -or $name -eq 'project.private.config.json') { throw 'Release includes private configuration or state.' }
            if ((($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000 -or ($entry.ExternalAttributes -band [int][IO.FileAttributes]::ReparsePoint)) { throw 'Release may not contain links.' }
            $target = [IO.Path]::GetFullPath((Join-Path $payload $relative))
            Assert-Child $target $payload
            if (-not $seen.Add($target)) { throw 'Release has duplicate Windows paths.' }
            $unpackedBytes += $entry.Length
            if ($unpackedBytes -gt 1GB) { throw 'Release exceeds the 1 GiB unpacked limit.' }
        }
    } finally { $archive.Dispose() }
    [IO.Compression.ZipFile]::ExtractToDirectory($privateZip, $payload)
    $source = Join-Path $payload 'course-platform'
    foreach ($required in @('package.json', 'package-lock.json', 'server\package.json', 'server\index.js', 'server\app.js', 'web\dist\index.html')) {
        if (-not (Test-Path -LiteralPath (Join-Path $source $required) -PathType Leaf)) { throw ('Incomplete runtime release: ' + $required) }
    }
    $package = Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw | ConvertFrom-Json
    if (@($package.workspaces).Count -ne 1 -or @($package.workspaces)[0] -ne 'server') { throw 'Unexpected npm workspace layout; review the update script before deploying.' }
    $serverPackage = Get-Content -LiteralPath (Join-Path $source 'server\package.json') -Raw | ConvertFrom-Json
    if ($serverPackage.name -notmatch '^[a-z0-9][a-z0-9._-]*$') { throw 'Unexpected server workspace package name.' }
    # Capture only the verified ZIP payload, before npm can create workspace links.
    $files = @(Get-ChildItem -LiteralPath $source -File -Recurse | Where-Object {
        $_.FullName.Substring($source.Length + 1) -notmatch '^web\\dist\\'
    })
    # Network access and all dependency installation happen while production keeps running.
    Write-Output 'Preparing production dependencies in the private staging directory.'
    $oldPath = $env:Path
    try {
        $env:Path = $NodeDirectory + ';' + $oldPath
        Push-Location -LiteralPath $source
        try {
            & $node $npm ci --omit=dev --ignore-scripts --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'Staged npm ci failed; production was not replaced.' }
            & $node --input-type=module -e "await import('./server/app.js'); console.log('STAGED_RUNTIME_IMPORT_OK');"
            if ($LASTEXITCODE -ne 0) { throw 'Staged runtime cannot resolve its dependencies.' }
        } finally { Pop-Location }
    } finally { $env:Path = $oldPath }
    # npm creates an absolute Windows workspace junction. Retarget it before moving
    # node_modules so it cannot refer back to a later-deleted staging directory.
    $workspaceLink = Join-Path (Join-Path $source 'node_modules') $serverPackage.name
    $workspaceItem = Get-Item -LiteralPath $workspaceLink -Force
    if (-not ($workspaceItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Expected the npm workspace junction.' }
    [IO.Directory]::Delete($workspaceLink)
    New-Item -ItemType Junction -Path $workspaceLink -Target (Join-Path $ProjectRoot 'server') | Out-Null
    $privateHashes = Get-PrivateHashes
    # The established backup script resumes the API before compressing the snapshot.
    # This is a separate, consistent data-backup window; never compress while the
    # final replacement window is open.
    & (Join-Path $ProjectRoot 'deploy\windows\Backup-Service.ps1') -ProjectRoot $ProjectRoot -ServiceName $ServiceName -DataDirectory $DataDirectory -BackupDirectory $BackupDirectory
    if (-not (Test-Production 2)) { throw 'Service did not recover after its pre-upgrade backup.' }
    Assert-PrivateHashes $privateHashes
    $runtimeBackup = Join-Path $rollback 'runtime'
    New-Item -ItemType Directory -Path $runtimeBackup | Out-Null
    $fileRecords = @()
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($source.Length + 1)
        $destination = [IO.Path]::GetFullPath((Join-Path $ProjectRoot $relative))
        Assert-Child $destination $ProjectRoot
        Assert-NoReparseAncestor $destination
        if (Test-Path -LiteralPath $destination -PathType Container) { throw 'A runtime file conflicts with an existing directory.' }
        $fileRecords += [PSCustomObject]@{ Relative = $relative; Existed = (Test-Path -LiteralPath $destination -PathType Leaf) }
    }
    foreach ($path in @((Join-Path $ProjectRoot 'node_modules'), (Join-Path $ProjectRoot 'server\node_modules'), (Join-Path $ProjectRoot 'web\dist'))) {
        Assert-NoReparseAncestor $path
    }
    $dependencyRecords = @()
    foreach ($relative in @('node_modules', 'server\node_modules', 'web\dist')) {
        $dependencyRecords += [PSCustomObject]@{ Relative = $relative; OldMoved = $false; NewMoved = $false }
    }
    [ordered]@{ CreatedUtc = [DateTime]::UtcNow.ToString('o'); ServiceName = $ServiceName; ProjectRoot = $ProjectRoot; ReleaseSha256 = $Sha256.ToLowerInvariant(); Files = $fileRecords; Note = 'Runtime/dependencies only. Production data, uploads, credentials and service configuration are never replaced.' } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $rollback 'manifest.json') -Encoding UTF8
    $runtimeMutated = $false
    $stopRequested = $false
    try {
        $stopRequested = $true
        Stop-CourseService
        # Only the small immutable runtime is copied in this maintenance window.
        foreach ($record in $fileRecords) {
            if ($record.Existed) {
                $snapshot = Join-Path $runtimeBackup $record.Relative
                New-Item -ItemType Directory -Path (Split-Path -Parent $snapshot) -Force | Out-Null
                Copy-Item -LiteralPath (Join-Path $ProjectRoot $record.Relative) -Destination $snapshot
            }
        }
        $runtimeMutated = $true
        foreach ($record in $dependencyRecords) {
            $livePath = Join-Path $ProjectRoot $record.Relative
            $savedPath = Join-Path $rollback $record.Relative
            $newPath = Join-Path $source $record.Relative
            if (Test-Path -LiteralPath $livePath) {
                New-Item -ItemType Directory -Path (Split-Path -Parent $savedPath) -Force | Out-Null
                Move-Item -LiteralPath $livePath -Destination $savedPath
                $record.OldMoved = $true
                # Same-volume moves retain former inherited ACLs. Reset the moved
                # directory too, so its children inherit the private recovery ACL.
                Protect-PrivatePath -LiteralPath $savedPath
            }
            if (Test-Path -LiteralPath $newPath) {
                New-Item -ItemType Directory -Path (Split-Path -Parent $livePath) -Force | Out-Null
                Move-Item -LiteralPath $newPath -Destination $livePath
                $record.NewMoved = $true
            }
        }
        foreach ($record in $fileRecords) {
            $destination = Join-Path $ProjectRoot $record.Relative
            New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
            Copy-Item -LiteralPath (Join-Path $source $record.Relative) -Destination $destination -Force
        }
        Assert-PrivateHashes $privateHashes
        Start-CourseService
        if (-not (Test-Production $HealthAttempts)) { throw 'New runtime failed production or payment-configuration health checks.' }
    } catch {
        $failure = $_.Exception.Message
        try {
            if ($runtimeMutated) {
                Stop-CourseService
                foreach ($record in $dependencyRecords) {
                    $livePath = Join-Path $ProjectRoot $record.Relative
                    $savedPath = Join-Path $rollback $record.Relative
                    if ($record.NewMoved -and (Test-Path -LiteralPath $livePath)) {
                        $rejectedPath = Join-Path (Join-Path $stage 'rejected') $record.Relative
                        Assert-Child $rejectedPath $stage
                        New-Item -ItemType Directory -Path (Split-Path -Parent $rejectedPath) -Force | Out-Null
                        Move-Item -LiteralPath $livePath -Destination $rejectedPath
                    }
                    if ($record.OldMoved) { Move-Item -LiteralPath $savedPath -Destination $livePath }
                }
                foreach ($record in $fileRecords) {
                    $destination = Join-Path $ProjectRoot $record.Relative
                    Assert-Child $destination $ProjectRoot
                    if ($record.Existed) { Copy-Item -LiteralPath (Join-Path $runtimeBackup $record.Relative) -Destination $destination -Force }
                    elseif (Test-Path -LiteralPath $destination -PathType Leaf) { Remove-Item -LiteralPath $destination -Force }
                }
            }
            if ($stopRequested) { Start-CourseService }
            Assert-PrivateHashes $privateHashes
            if (-not (Test-Production $HealthAttempts)) { throw 'Restored runtime did not pass production health checks.' }
        } catch {
            throw ('UPDATE_FAILED_AND_RECOVERY_NEEDS_ATTENTION. Original failure: ' + $failure + '. Recovery failure: ' + $_.Exception.Message + '. Private rollback directory: ' + $rollback)
        }
        throw ('UPDATE_FAILED_OLD_RUNTIME_RESTORED: ' + $failure + '. Private rollback directory: ' + $rollback)
    }
    [IO.File]::WriteAllText((Join-Path $rollback 'update-success.txt'), [DateTime]::UtcNow.ToString('o'))
    # No recursive deletion of old dependencies or snapshots: keep recovery material
    # private and let an administrator prune it after real playback acceptance.
    Write-Output 'RUNTIME_AND_DEPENDENCIES_UPDATED_CONFIG_PRESERVED'
    Get-Service -Name $ServiceName | Select-Object Name, Status
    Write-Output ('Private rollback directory: ' + $rollback)
    Write-Output ('Private preparation directory: ' + $stage)
    Write-Output 'Production mode and payment configuration passed. Actual payment, VOD, CDN and external HTTPS require separate functional checks.'
} finally {
    if ($hasMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
