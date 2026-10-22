# Run in Windows PowerShell 5.1 or PowerShell 7 on the target server.
[CmdletBinding()]
param([switch]$SkipInstall)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'server\index.js'))) { throw 'Project files are missing.' }
$nodeCommand = Get-Command node.exe -ErrorAction Stop
$nodeMajor = & $nodeCommand.Source -p 'parseInt(process.versions.node,10)'
if ($LASTEXITCODE -ne 0 -or [int]$nodeMajor -lt 24) { throw 'Install Node.js 24 or later before continuing.' }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'web\dist\index.html'))) { throw 'Use the prepared Windows ZIP, or build web/dist before running this script.' }
Push-Location -LiteralPath $projectRoot
try {
    if (-not $SkipInstall) {
        & npm.cmd ci --omit=dev
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    }
    $envPath = Join-Path $projectRoot '.env'
    if (-not (Test-Path -LiteralPath $envPath)) {
        $random = [Security.Cryptography.RandomNumberGenerator]::Create()
        try {
            $adminBytes = New-Object byte[] 24
            $sessionBytes = New-Object byte[] 48
            $random.GetBytes($adminBytes)
            $random.GetBytes($sessionBytes)
            $template = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '.env.example'))
            $template = [regex]::Replace($template, '(?m)^ADMIN_PASSWORD=.*$', 'ADMIN_PASSWORD=' + [Convert]::ToBase64String($adminBytes))
            $template = [regex]::Replace($template, '(?m)^SESSION_SECRET=.*$', 'SESSION_SECRET=' + [Convert]::ToBase64String($sessionBytes))
            $stream = [IO.File]::Open($envPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
            try {
                $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($template)
                $stream.Write($bytes, 0, $bytes.Length)
            } finally { $stream.Dispose() }
        } finally { $random.Dispose() }
        Write-Host 'Created root .env with random admin password and session secret. Values are not printed.'
    } else { Write-Host 'Existing root .env preserved.' }
    & $nodeCommand.Source 'scripts/check-wechat-login.mjs'
    if ($LASTEXITCODE -ne 0) { Write-Host 'Fill WECHAT_APP_SECRET in root .env locally, then run npm run check:wechat -- --verify.' }
    Write-Host 'Next: configure a Windows service or process manager to run node.exe server/index.js from this project directory.'
    Write-Host 'Expected upstream: http://127.0.0.1:4310 ; public site: https://course.yulongchemistry.cn'
} finally { Pop-Location }
