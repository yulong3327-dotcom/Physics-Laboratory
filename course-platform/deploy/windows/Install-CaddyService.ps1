#requires -Version 5.1
#requires -RunAsAdministrator
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$WinSWPath,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$WinSWSha256,
    [Parameter(Mandatory = $true)][string]$CaddyPath,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$CaddySha256,
    [ValidatePattern('^[A-Za-z][A-Za-z0-9_-]{2,63}$')][string]$ServiceName = 'ZhikeCaddy',
    [ValidatePattern('^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$')][string]$Domain = 'course.yulongchemistry.cn',
    [string]$ServiceDirectory = (Join-Path $env:ProgramData 'ZhikeCourse\proxy'),
    [switch]$Start,
    [switch]$ConfigureOnly,
    [switch]$OpenFirewall,
    [ValidateRange(10, 600)][int]$HealthTimeoutSeconds = 90
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Private-Paths.ps1')
$WinSWPath = (Resolve-Path -LiteralPath $WinSWPath).Path
$CaddyPath = (Resolve-Path -LiteralPath $CaddyPath).Path
if ((Get-FileHash -LiteralPath $WinSWPath -Algorithm SHA256).Hash -ne $WinSWSha256) { throw 'WinSW SHA256 does not match the trusted download.' }
if ((Get-FileHash -LiteralPath $CaddyPath -Algorithm SHA256).Hash -ne $CaddySha256) { throw 'Caddy executable SHA256 does not match the trusted extracted binary.' }
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) { throw 'This service name already exists. Inspect it before updating; this installer will not overwrite an existing service.' }
$ServiceDirectory = [IO.Path]::GetFullPath($ServiceDirectory)
if ($ServiceDirectory.Contains('"') -or $ServiceDirectory.Contains("`r") -or $ServiceDirectory.Contains("`n")) { throw 'Invalid service directory.' }
$wrapperPath = Join-Path $ServiceDirectory ($ServiceName + '.exe')
$xmlPath = Join-Path $ServiceDirectory ($ServiceName + '.xml')
$installedCaddy = Join-Path $ServiceDirectory 'caddy.exe'
$configPath = Join-Path $ServiceDirectory 'Caddyfile'
foreach ($target in @($wrapperPath, $xmlPath, $installedCaddy, $configPath)) {
    if (Test-Path -LiteralPath $target) { throw ('Existing proxy installation file; inspect before replacing: ' + $target) }
}
if (-not $ConfigureOnly) {
    $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -in @(80, 443) })
    if ($listeners.Count -gt 0) { throw 'TCP 80 or 443 is in use. Inspect the existing web server before installing Caddy.' }
    if ($OpenFirewall) {
        $firewallService = Get-Service -Name 'MpsSvc' -ErrorAction Stop
        if ($firewallService.Status -ne 'Running') { throw 'Windows Defender Firewall service (MpsSvc) must be running before -OpenFirewall. Inspect the existing firewall setup; this installer does not change global firewall state.' }
        foreach ($ruleName in @(($ServiceName + '-HTTP'), ($ServiceName + '-HTTPS'))) {
            if (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue) { throw 'A matching firewall rule already exists. Inspect it before installing.' }
        }
    }
    if ($Start) {
        $upstreamHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:4310/api/health' -TimeoutSec 10
        if ($upstreamHealth.ok -ne $true -or $upstreamHealth.mode -ne 'production') { throw 'The upstream API is not healthy in production mode. Start and verify it before installing the proxy.' }
    }
}
New-Item -ItemType Directory -Path $ServiceDirectory -Force | Out-Null
Protect-PrivatePath -LiteralPath $ServiceDirectory
$dataDirectory = Join-Path $ServiceDirectory 'data'
$logsDirectory = Join-Path $ServiceDirectory 'logs'
$configDirectory = Join-Path $ServiceDirectory 'config-cache'
New-Item -ItemType Directory -Path $dataDirectory, $logsDirectory, $configDirectory -Force | Out-Null
foreach ($privatePath in @($dataDirectory, $logsDirectory, $configDirectory)) { Protect-PrivatePath -LiteralPath $privatePath }
Copy-Item -LiteralPath $WinSWPath -Destination $wrapperPath
Copy-Item -LiteralPath $CaddyPath -Destination $installedCaddy
$caddyfile = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'Caddyfile.template'))
$caddyfile = $caddyfile.Replace('@@DOMAIN@@', $Domain.ToLowerInvariant()).Replace('@@DATA_PATH@@', $dataDirectory.Replace('\', '/')).Replace('@@ACCESS_LOG_PATH@@', (Join-Path $logsDirectory 'access.json').Replace('\', '/'))
if ($caddyfile.Contains('@@')) { throw 'An unresolved Caddyfile template token remains.' }
[IO.File]::WriteAllText($configPath, $caddyfile, (New-Object Text.UTF8Encoding($false)))
function Escape-Xml([string]$Value) { return [Security.SecurityElement]::Escape($Value) }
$xml = @"
<service>
  <id>$(Escape-Xml $ServiceName)</id>
  <name>Zhike HTTPS Proxy</name>
  <description>Caddy HTTPS reverse proxy for $(Escape-Xml $Domain). Managed by WinSW.</description>
  <executable>$(Escape-Xml $installedCaddy)</executable>
  <arguments>run --config &quot;$(Escape-Xml $configPath)&quot; --adapter caddyfile</arguments>
  <workingdirectory>$(Escape-Xml $ServiceDirectory)</workingdirectory>
  <env name="XDG_DATA_HOME" value="$(Escape-Xml $dataDirectory)" />
  <env name="XDG_CONFIG_HOME" value="$(Escape-Xml $configDirectory)" />
  <startmode>Automatic</startmode>
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
  <onfailure action="restart" delay="60 sec" />
  <resetfailure>1 hour</resetfailure>
  <stoptimeout>30 sec</stoptimeout>
  <logpath>$(Escape-Xml $logsDirectory)</logpath>
  <log mode="roll">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
</service>
"@
[void][xml]$xml
[IO.File]::WriteAllText($xmlPath, $xml, (New-Object Text.UTF8Encoding($false)))
if ($ConfigureOnly) {
    Write-Output ('Prepared proxy configuration without executing Caddy or registering a service: ' + $configPath)
    Write-Output 'Run caddy.exe validate --config Caddyfile --adapter caddyfile before installation.'
    return
}
# Adapt only checks syntax; validate also checks that the config can be provisioned.
& $installedCaddy validate --config $configPath --adapter caddyfile
if ($LASTEXITCODE -ne 0) { throw 'Caddy configuration validation failed; the Windows service was not installed.' }
& $wrapperPath install
if ($LASTEXITCODE -ne 0) { throw 'WinSW proxy service installation failed. Inspect the wrapper log.' }
if ($OpenFirewall) {
    foreach ($port in @(80, 443)) {
        $suffix = if ($port -eq 80) { 'HTTP' } else { 'HTTPS' }
        New-NetFirewallRule -Name ($ServiceName + '-' + $suffix) -DisplayName ('Zhike proxy ' + $suffix) -Direction Inbound -Action Allow -Enabled True -Protocol TCP -LocalPort $port -Program $installedCaddy -Profile Any -ErrorAction Stop | Out-Null
    }
}
if ($Start) {
    Start-Service -Name $ServiceName
    (Get-Service -Name $ServiceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $deadline = [DateTime]::UtcNow.AddSeconds($HealthTimeoutSeconds)
    $publicHealthy = $false
    do {
        try {
            $publicHealth = Invoke-RestMethod -Uri ('https://' + $Domain + '/api/health') -TimeoutSec 5
            if ($publicHealth.ok -eq $true -and $publicHealth.mode -eq 'production') { $publicHealthy = $true; break }
        } catch { }
        if ([DateTime]::UtcNow -lt $deadline) { Start-Sleep -Seconds 3 }
    } while ([DateTime]::UtcNow -lt $deadline)
    if (-not $publicHealthy) { throw ('Proxy service is installed, but public HTTPS health verification did not pass. Keep the service and inspect DNS, TCP 80/443, certificate logs and ICP status: ' + $logsDirectory) }
    Write-Output 'Public HTTPS health check passed with normal Windows certificate validation.'
}
Get-Service -Name $ServiceName | Select-Object Name, Status, StartType
Write-Output ('Public URL: https://' + $Domain)
Write-Output ('Certificate data: ' + $dataDirectory)
Write-Output ('Proxy and access logs: ' + $logsDirectory)
Write-Output 'Verify public HTTPS, certificate renewal, backend health, and restart recovery. Running status alone is not validation.'
