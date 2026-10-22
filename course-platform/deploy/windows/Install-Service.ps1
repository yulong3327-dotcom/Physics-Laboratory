#requires -Version 5.1
#requires -RunAsAdministrator
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$WinSWPath,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$WinSWSha256,
    [ValidatePattern('^[A-Za-z][A-Za-z0-9_-]{2,63}$')][string]$ServiceName = 'ZhikeCourse',
    [string]$ProjectRoot = (Join-Path $PSScriptRoot '..\..'),
    [string]$NodePath,
    [switch]$Start,
    [switch]$ConfigureOnly
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Private-Paths.ps1')
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$WinSWPath = (Resolve-Path -LiteralPath $WinSWPath).Path
if ((Get-FileHash -LiteralPath $WinSWPath -Algorithm SHA256).Hash -ne $WinSWSha256) { throw 'WinSW SHA256 does not match the trusted download.' }
if (-not $NodePath) { $NodePath = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source }
$NodePath = (Resolve-Path -LiteralPath $NodePath).Path
$nodeMajor = & $NodePath -p 'parseInt(process.versions.node,10)'
if ($LASTEXITCODE -ne 0 -or [int]$nodeMajor -lt 24) { throw 'Node.js 24 or later is required.' }
foreach ($required in @('server\index.js', 'node_modules', '.env')) {
    if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $required))) { throw ('Missing project prerequisite: ' + $required) }
}
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) { throw 'This service name already exists. Inspect it before updating; this installer will not overwrite an existing service.' }
$serviceRoot = Join-Path $ProjectRoot ('.services\' + $ServiceName)
New-Item -ItemType Directory -Path $serviceRoot -Force | Out-Null
$wrapperPath = Join-Path $serviceRoot ($ServiceName + '.exe')
$xmlPath = Join-Path $serviceRoot ($ServiceName + '.xml')
if (Test-Path -LiteralPath $xmlPath) { throw 'Service configuration already exists. Inspect it before replacing it.' }
Copy-Item -LiteralPath $WinSWPath -Destination $wrapperPath
$logDirectory = Join-Path $serviceRoot 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
function Escape-Xml([string]$Value) { return [Security.SecurityElement]::Escape($Value) }
$xml = @"
<service>
  <id>$(Escape-Xml $ServiceName)</id>
  <name>Zhike Course API</name>
  <description>Course API managed by WinSW. Credentials remain in the project .env.</description>
  <executable>$(Escape-Xml $NodePath)</executable>
  <arguments>&quot;$(Escape-Xml (Join-Path $ProjectRoot 'server\index.js'))&quot;</arguments>
  <workingdirectory>$(Escape-Xml $ProjectRoot)</workingdirectory>
  <startmode>Automatic</startmode>
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
  <onfailure action="restart" delay="60 sec" />
  <resetfailure>1 hour</resetfailure>
  <stoptimeout>30 sec</stoptimeout>
  <logpath>$(Escape-Xml $logDirectory)</logpath>
  <log mode="roll">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
</service>
"@
[void][xml]$xml
[IO.File]::WriteAllText($xmlPath, $xml, (New-Object Text.UTF8Encoding($false)))
# WinSW's default account is LocalSystem. Keep its configuration and credential files
# restricted to SYSTEM and local Administrators; no account password is stored here.
foreach ($privatePath in @($serviceRoot, (Join-Path $ProjectRoot '.env'), (Join-Path $ProjectRoot 'secrets'))) {
    if (Test-Path -LiteralPath $privatePath) {
        Protect-PrivatePath -LiteralPath $privatePath
    }
}
if ($ConfigureOnly) {
    Write-Output ('Prepared service configuration without registering a Windows service: ' + $xmlPath)
    return
}
& $wrapperPath install
if ($LASTEXITCODE -ne 0) { throw 'WinSW service installation failed. Inspect the wrapper log.' }
if ($Start) {
    Start-Service -Name $ServiceName
    (Get-Service -Name $ServiceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
}
Get-Service -Name $ServiceName | Select-Object Name, Status, StartType
Write-Output ('WinSW logs: ' + $logDirectory)
Write-Output 'Verify the health endpoint and an actual process restart before considering deployment complete.'
