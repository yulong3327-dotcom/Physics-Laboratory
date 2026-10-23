#requires -Version 5.1
#requires -RunAsAdministrator
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [Parameter(Mandatory = $true)][string]$ConfigFile
)
$ErrorActionPreference = 'Stop'

# Standalone so that only this script and the private VOD .env need uploading.
function Protect-VodPrivatePath([string]$LiteralPath) {
    $item = Get-Item -LiteralPath $LiteralPath -Force
    if ($item.PSIsContainer) { $acl = New-Object Security.AccessControl.DirectorySecurity }
    else { $acl = New-Object Security.AccessControl.FileSecurity }
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
        $identity = New-Object Security.Principal.SecurityIdentifier($sid)
        if ($item.PSIsContainer) {
            $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, [Security.AccessControl.FileSystemRights]::FullControl, ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit), [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
        } else {
            $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow)
        }
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $LiteralPath -AclObject $acl
}
function Assert-VodNoReparseAncestor([string]$LiteralPath) {
    $cursor = [IO.Path]::GetFullPath($LiteralPath)
    while ($cursor) {
        if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Configuration paths must not contain reparse points.' }
        $parent = Split-Path -Parent $cursor
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
}
function Read-VodDotEnv([string]$Text) {
    if ($Text.Length -gt 1MB -or $Text.Contains([char]0)) { throw 'Invalid environment file size or encoding.' }
    # Quoted multiline values are consumed as a whole, preventing a key inside
    # another variable from being mistaken for a top-level VOD assignment.
    $pattern = '\G(?:(?<blank>[ \t]*(?:#[^\r\n]*)?)(?:\r?\n|\z)|(?<entry>[ \t]*(?:export[ \t]+)?(?<key>[A-Za-z_][A-Za-z0-9_.-]*)[ \t]*=[ \t]*(?<value>''(?:\\''|[^''])*''|"(?:\\"|[^"])*"|`(?:\\`|[^`])*`|[^#\r\n]*)[ \t]*(?:#[^\r\n]*)?)(?:\r?\n|\z))'
    $regex = New-Object Text.RegularExpressions.Regex($pattern)
    $values = New-Object 'Collections.Generic.Dictionary[string,string]' ([StringComparer]::Ordinal)
    $entries = New-Object 'Collections.Generic.List[object]'
    $cursor = 0
    while ($cursor -lt $Text.Length) {
        $match = $regex.Match($Text, $cursor)
        if (-not $match.Success -or $match.Index -ne $cursor -or $match.Length -eq 0) { throw 'Unsupported environment syntax; no configuration was changed.' }
        if ($match.Groups['entry'].Success) {
            $key = $match.Groups['key'].Value
            $value = $match.Groups['value'].Value.Trim()
            if ($value.Length -ge 2 -and $value[0] -in @([char]39, [char]34, [char]96) -and $value[$value.Length - 1] -eq $value[0]) {
                $quote = $value[0]
                $value = $value.Substring(1, $value.Length - 2)
                if ($quote -eq [char]34) { $value = $value.Replace('\n', "`n").Replace('\r', "`r") }
            }
            $values[$key] = $value
            $entries.Add([PSCustomObject]@{ Key = $key; Value = $value; Index = $match.Groups['entry'].Index; Length = $match.Groups['entry'].Length })
        }
        $cursor += $match.Length
    }
    return [PSCustomObject]@{ Values = $values; Entries = $entries.ToArray() }
}
function Merge-VodEnvironment([string]$Original, [string]$Incoming) {
    $allowed = @('TENCENT_VOD_SECRET_ID', 'TENCENT_VOD_SECRET_KEY', 'TENCENT_VOD_SUB_APP_ID', 'TENCENT_VOD_REGION', 'TENCENT_VOD_STORAGE_REGION', 'TENCENT_VOD_TRANSCODE_DEFINITION', 'TENCENT_VOD_PLAYBACK_DOMAIN', 'TENCENT_VOD_URL_KEY', 'TENCENT_VOD_URL_TTL_SECONDS')
    $old = Read-VodDotEnv $Original
    $incomingEnv = Read-VodDotEnv $Incoming
    $updates = New-Object 'Collections.Generic.Dictionary[string,string]' ([StringComparer]::Ordinal)
    foreach ($entry in $incomingEnv.Entries) {
        if ($entry.Key -cnotin $allowed) { throw 'The input file must contain only the documented TENCENT_VOD_* keys.' }
        if ($updates.ContainsKey($entry.Key)) { throw 'The input file contains a duplicate VOD key.' }
        if (-not $entry.Value -or $entry.Value -notmatch '^[A-Za-z0-9._+/=\-]+$') { throw ('Invalid or empty VOD value: ' + $entry.Key) }
        $updates[$entry.Key] = $entry.Value
    }
    if ($updates.Count -eq 0) { throw 'The input file contains no VOD configuration.' }
    $merged = New-Object 'Collections.Generic.Dictionary[string,string]' ([StringComparer]::Ordinal)
    foreach ($key in $old.Values.Keys) { $merged[$key] = $old.Values[$key] }; foreach ($key in $updates.Keys) { $merged[$key] = $updates[$key] }
    foreach ($key in @('TENCENT_VOD_SECRET_ID', 'TENCENT_VOD_SECRET_KEY')) {
        if ($merged[$key] -notmatch '^[A-Za-z0-9+/=_\-]{8,256}$') { throw ('Missing or invalid VOD value: ' + $key) }
    }
    foreach ($key in @('TENCENT_VOD_SUB_APP_ID', 'TENCENT_VOD_TRANSCODE_DEFINITION')) {
        [long]$integer = 0
        if (-not [long]::TryParse($merged[$key], [ref]$integer) -or $integer -lt 1 -or $integer -gt 9007199254740991) { throw ('Missing or invalid VOD value: ' + $key) }
    }
    if ($merged['TENCENT_VOD_PLAYBACK_DOMAIN'] -notmatch '^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$') { throw 'Missing or invalid VOD playback domain.' }
    if ($merged['TENCENT_VOD_URL_KEY'] -notmatch '^[A-Za-z0-9]{8,40}$') { throw 'Missing or invalid VOD URL key.' }
    foreach ($key in @('TENCENT_VOD_REGION', 'TENCENT_VOD_STORAGE_REGION')) {
        if ($merged.ContainsKey($key) -and $merged[$key] -notmatch '^[a-z]{2}(?:-[a-z0-9]+)+$') { throw ('Invalid VOD region: ' + $key) }
    }
    if ($merged.ContainsKey('TENCENT_VOD_URL_TTL_SECONDS')) {
        [int]$ttl = 0
        if (-not [int]::TryParse($merged['TENCENT_VOD_URL_TTL_SECONDS'], [ref]$ttl) -or $ttl -lt 300 -or $ttl -gt 10800) { throw 'VOD URL TTL must be between 300 and 10800 seconds.' }
    }
    $result = New-Object Text.StringBuilder
    $seen = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    $cursor = 0
    foreach ($entry in $old.Entries) {
        if (-not $updates.ContainsKey($entry.Key)) { continue }
        [void]$result.Append($Original.Substring($cursor, $entry.Index - $cursor))
        if ($seen.Add($entry.Key)) { [void]$result.Append($entry.Key + '=' + $updates[$entry.Key]) }
        $cursor = $entry.Index + $entry.Length
    }
    [void]$result.Append($Original.Substring($cursor))
    $newline = if ($Original.Contains("`r`n")) { "`r`n" } else { "`n" }
    foreach ($key in $allowed) {
        if ($updates.ContainsKey($key) -and -not $seen.Contains($key)) {
            if ($result.Length -gt 0 -and $result[$result.Length - 1] -ne [char]10) { [void]$result.Append($newline) }
            [void]$result.Append($key + '=' + $updates[$key] + $newline)
        }
    }
    return [PSCustomObject]@{ Text = $result.ToString(); Values = $merged; UpdatedKeys = @($allowed | Where-Object { $updates.ContainsKey($_) }) }
}
function Stop-VodCourseService {
    $service = Get-Service -Name 'ZhikeCourse'
    if ($service.Status -ne 'Stopped') {
        if ($service.Status -ne 'StopPending') { Stop-Service -Name 'ZhikeCourse' }
        (Get-Service -Name 'ZhikeCourse').WaitForStatus('Stopped', [TimeSpan]::FromSeconds(45))
    }
}
function Start-VodCourseService {
    if ((Get-Service -Name 'ZhikeCourse').Status -eq 'StopPending') { (Get-Service -Name 'ZhikeCourse').WaitForStatus('Stopped', [TimeSpan]::FromSeconds(45)) }
    if ((Get-Service -Name 'ZhikeCourse').Status -ne 'Running') { Start-Service -Name 'ZhikeCourse' }
    (Get-Service -Name 'ZhikeCourse').WaitForStatus('Running', [TimeSpan]::FromSeconds(45))
}
function Test-VodServiceHealth([string]$BaseUrl, [int]$Attempts = 10) {
    for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri ($BaseUrl + '/api/health') -MaximumRedirection 0 -TimeoutSec 4
            if ($health.ok -eq $true -and $health.mode -eq 'production') { return $true }
        } catch { }
        if ($attempt + 1 -lt $Attempts) { Start-Sleep -Seconds 2 }
    }
    return $false
}

$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
$ConfigFile = [IO.Path]::GetFullPath($ConfigFile)
$envPath = Join-Path $ProjectRoot '.env'
$backupRoot = Join-Path $env:ProgramData 'ZhikeCourse\config-backups'
if ($ProjectRoot -eq [IO.Path]::GetPathRoot($ProjectRoot).TrimEnd('\')) { throw 'ProjectRoot must be an application directory.' }
if ($ConfigFile.StartsWith($ProjectRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'The input configuration must be uploaded outside the application directory.' }
foreach ($path in @($ProjectRoot, $ConfigFile, $envPath, $backupRoot)) { Assert-VodNoReparseAncestor $path }
foreach ($path in @($envPath, $ConfigFile)) { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Both the existing .env and the uploaded configuration file are required.' } }
Protect-VodPrivatePath $ConfigFile
$serviceAccount = (Get-CimInstance Win32_Service -Filter "Name='ZhikeCourse'").StartName
if ($serviceAccount -notin @('LocalSystem', 'NT AUTHORITY\SYSTEM')) { throw 'This script requires the existing ZhikeCourse service to run as LocalSystem.' }
if ((Get-Service -Name 'ZhikeCourse').Status -ne 'Running') { throw 'The existing service must be running before configuration.' }
$mutex = New-Object Threading.Mutex($false, 'Global\ZhikeCourse-Update-ZhikeCourse')
$hasMutex = $false; $modified = $false; $stopRequested = $false; $token = $null; $baseUrl = $null; $tempPath = $null
try {
    try { $hasMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $hasMutex = $true }
    if (-not $hasMutex) { throw 'Another course service configuration or deployment is in progress.' }
    $originalBytes = [IO.File]::ReadAllBytes($envPath)
    # StreamReader detects an existing UTF BOM; written replacements use UTF-8.
    $original = [IO.File]::ReadAllText($envPath)
    $merged = Merge-VodEnvironment $original ([IO.File]::ReadAllText($ConfigFile))
    [int]$port = 4310
    if ($merged.Values.ContainsKey('PORT') -and (-not [int]::TryParse($merged.Values['PORT'], [ref]$port) -or $port -lt 1 -or $port -gt 65535)) { throw 'Invalid existing PORT setting.' }
    $baseUrl = 'http://127.0.0.1:' + $port
    if (-not (Test-VodServiceHealth $baseUrl 1)) { throw 'Existing production health check failed; configuration was not changed.' }
    if (-not $merged.Values['ADMIN_USERNAME'] -or -not $merged.Values['ADMIN_PASSWORD']) { throw 'Existing .env must explicitly configure the administrator account for verification.' }
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    Protect-VodPrivatePath $backupRoot
    $stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $backupPath = Join-Path $backupRoot ('before-vod-' + $stamp + '.env')
    [IO.File]::WriteAllBytes($backupPath, $originalBytes)
    Protect-VodPrivatePath $backupPath
    Protect-VodPrivatePath $envPath
    $tempPath = Join-Path $ProjectRoot ('.env.vod-' + $stamp + '.tmp')
    [IO.File]::WriteAllBytes($tempPath, [byte[]]@())
    Protect-VodPrivatePath $tempPath
    [IO.File]::WriteAllText($tempPath, $merged.Text, (New-Object Text.UTF8Encoding($false)))
    try {
        $stopRequested = $true
        Stop-VodCourseService
        [IO.File]::Replace($tempPath, $envPath, $null)
        $modified = $true
        Protect-VodPrivatePath $envPath
        Start-VodCourseService
        if (-not (Test-VodServiceHealth $baseUrl)) { throw 'Health check failed.' }
        $body = @{ username = $merged.Values['ADMIN_USERNAME']; password = $merged.Values['ADMIN_PASSWORD'] } | ConvertTo-Json -Compress
        $login = Invoke-RestMethod -Uri ($baseUrl + '/api/admin/login') -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -MaximumRedirection 0 -TimeoutSec 10
        $token = $login.token
        if (-not $token) { throw 'Administrator verification failed.' }
        $vod = Invoke-RestMethod -Uri ($baseUrl + '/api/admin/vod/config') -Headers @{ Authorization = 'Bearer ' + $token } -MaximumRedirection 0 -TimeoutSec 60
        if ($vod.configured -ne $true) { throw 'The service did not load the complete VOD configuration.' }
    } catch {
        $restored = $false
        try {
            if ($modified) {
                Stop-VodCourseService
                [IO.File]::WriteAllBytes($tempPath, [byte[]]@())
                Protect-VodPrivatePath $tempPath
                [IO.File]::WriteAllBytes($tempPath, $originalBytes)
                [IO.File]::Replace($tempPath, $envPath, $null)
                Protect-VodPrivatePath $envPath
            }
            if ($stopRequested) { Start-VodCourseService }
            $restored = Test-VodServiceHealth $baseUrl
        } catch { }
        if ($restored) { throw 'VOD installation verification failed. The previous configuration was restored and production health is OK. No credentials were printed.' }
        throw 'VOD installation failed and automatic recovery could not be verified. The private backup remains under ProgramData\ZhikeCourse\config-backups. Inspect the Windows service locally; no credentials were printed.'
    }
    $message = [string]$vod.message
    foreach ($secret in @($merged.Values['TENCENT_VOD_SECRET_ID'], $merged.Values['TENCENT_VOD_SECRET_KEY'], $merged.Values['TENCENT_VOD_URL_KEY'], $merged.Values['ADMIN_PASSWORD'], $token)) {
        if ($secret) { $message = $message.Replace($secret, '[redacted]') }
    }
    $message = ($message -replace '[\x00-\x1F\x7F]', ' ')
    if ($message.Length -gt 500) { $message = $message.Substring(0, 500) }
    [ordered]@{
        health = 'OK'; configured = [bool]$vod.configured; protectionReady = [bool]$vod.protectionReady
        uploadConfigured = [bool]$vod.uploadConfigured; playbackConfigured = [bool]$vod.playbackConfigured
        missing = @($vod.missing | Where-Object { $_ -in $merged.UpdatedKeys }); message = $message
        note = if ($vod.protectionReady -eq $true) { 'VOD authorization and domain protection checks passed.' } else { 'Configuration installed; cloud permissions, HTTPS or Key protection still need attention. Upload is not ready.' }
    } | ConvertTo-Json -Depth 3
} finally {
    if ($token -and $baseUrl) { try { Invoke-RestMethod -Uri ($baseUrl + '/api/auth/logout') -Method Post -Headers @{ Authorization = 'Bearer ' + $token } -MaximumRedirection 0 -TimeoutSec 4 | Out-Null } catch { } }
    if ($tempPath -and (Test-Path -LiteralPath $tempPath -PathType Leaf)) { Remove-Item -LiteralPath $tempPath -Force }
    if ($hasMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
