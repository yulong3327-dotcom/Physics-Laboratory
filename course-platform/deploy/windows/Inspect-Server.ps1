#requires -Version 5.1
<#
.SYNOPSIS
只读检查知课 Windows Server 部署条件，不安装软件、不修改服务或防火墙。
.EXAMPLE
powershell.exe -NoProfile -File .\Inspect-Server.ps1
.EXAMPLE
powershell.exe -NoProfile -File .\Inspect-Server.ps1 -Json
#>
[CmdletBinding()]
param(
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$')]
    [string]$Domain = 'course.yulongchemistry.cn',
    [ValidatePattern('^(?:\d{1,3}\.){3}\d{1,3}$')]
    [string]$ExpectedIPv4 = '43.138.144.203',
    [switch]$Json
)

$ErrorActionPreference = 'Stop'
$checks = New-Object 'System.Collections.Generic.List[object]'

function Add-Check {
    param([string]$Name, [string]$Status, [string]$Message)
    $checks.Add([pscustomobject][ordered]@{ Name = $Name; Status = $Status; Message = $Message })
}

function Get-ExecutableVersion {
    param([string]$Name, [string]$Pattern)
    $command = Get-Command -Name $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $command) { return $null }
    try {
        # 只调用版本查询；捕获输出后仅保留版本号，避免将外部诊断内容写入报告。
        $lines = @(& $command.Source --version 2>$null)
        if ($LASTEXITCODE -ne 0) { return $null }
        foreach ($line in $lines) {
            if ([string]$line -match $Pattern) {
                return [pscustomobject]@{ Path = $command.Source; Version = $Matches[1] }
            }
        }
    } catch { return $null }
    return $null
}

$os = $null
try {
    $system = Get-CimInstance -ClassName Win32_OperatingSystem -Property Caption, Version, BuildNumber, OSArchitecture
    $os = [pscustomobject][ordered]@{
        Caption = $system.Caption
        Version = $system.Version
        Build = $system.BuildNumber
        Architecture = $system.OSArchitecture
        PowerShellVersion = $PSVersionTable.PSVersion.ToString()
    }
    Add-Check '操作系统' 'PASS' ('{0}，版本 {1}，{2}；PowerShell {3}' -f $os.Caption, $os.Version, $os.Architecture, $os.PowerShellVersion)
} catch {
    Add-Check '操作系统' 'WARN' '无法读取 Windows 系统信息；请在 Windows PowerShell 5.1 或更新版本中运行。'
}

$identity = $null
try {
    $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
    $isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    $identity = [pscustomobject][ordered]@{ User = $currentIdentity.Name; IsAdministrator = $isAdministrator }
    if ($isAdministrator) {
        Add-Check '当前权限' 'PASS' ('当前用户 {0}，已提升为管理员。' -f $identity.User)
    } else {
        Add-Check '当前权限' 'WARN' ('当前用户 {0}，未提升为管理员；只读检查可继续，安装服务或修改防火墙时才需要提升权限。' -f $identity.User)
    }
} catch {
    Add-Check '当前权限' 'WARN' '无法确认当前 Windows 用户或管理员权限。'
}

$node = Get-ExecutableVersion 'node.exe' '^v(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$'
$npm = Get-ExecutableVersion 'npm.cmd' '^(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$'
if ($node -and [int]($node.Version.Split('.')[0]) -ge 24) {
    Add-Check 'Node.js' 'PASS' ('Node.js {0}，符合 >= 24 的要求。' -f $node.Version)
} elseif ($node) {
    Add-Check 'Node.js' 'FAIL' ('Node.js {0} 版本过低，需要安装 Node.js 24 或更新版本。' -f $node.Version)
} else {
    Add-Check 'Node.js' 'FAIL' '当前 PATH 未找到可用的 node.exe，或版本查询失败。'
}
if ($npm) {
    Add-Check 'npm' 'PASS' ('npm {0} 可用。' -f $npm.Version)
} else {
    Add-Check 'npm' 'FAIL' '当前 PATH 未找到可用的 npm.cmd，或版本查询失败。'
}

$listeners = @()
$listenerQuerySucceeded = $false
try {
    $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -in @(80, 443, 4310) } | ForEach-Object {
        [pscustomobject]@{ Address = $_.LocalAddress; Port = [int]$_.LocalPort; ProcessId = [int]$_.OwningProcess }
    })
    $listenerQuerySucceeded = $true
} catch {
    # 某些 Windows 版本不能查询 NetTCPIP；只读回退到 netstat，且不保存其他端口。
    try {
        $netstat = Get-Command 'netstat.exe' -CommandType Application -ErrorAction Stop | Select-Object -First 1
        $rows = @(& $netstat.Source -ano -p tcp 2>$null)
        if ($LASTEXITCODE -ne 0) { throw 'netstat failed' }
        $listeners = @($rows | ForEach-Object {
            if ([string]$_ -match '^\s*TCP\s+(\S+):(80|443|4310)\s+\S+\s+LISTENING\s+(\d+)\s*$') {
                [pscustomobject]@{ Address = $Matches[1]; Port = [int]$Matches[2]; ProcessId = [int]$Matches[3] }
            }
        })
        $listenerQuerySucceeded = $true
    } catch {
        Add-Check '端口监听' 'WARN' '无法读取 TCP 监听状态；请在服务器上检查 80、443、4310 的占用。'
    }
}
$portDetails = @($listeners | Sort-Object Port, ProcessId, Address -Unique | ForEach-Object {
    $processName = '无法读取'
    $executablePath = $null
    try {
        $processInfo = Get-Process -Id $_.ProcessId -ErrorAction Stop
        $processName = $processInfo.ProcessName
        try { $executablePath = $processInfo.Path } catch { }
    } catch { }
    # 不读取进程命令行或服务启动参数，避免输出其中可能存在的凭据。
    [pscustomobject][ordered]@{
        Port = $_.Port; Address = $_.Address; ProcessId = $_.ProcessId
        ProcessName = $processName; ExecutablePath = $executablePath
    }
})
if ($listenerQuerySucceeded) {
    foreach ($port in @(80, 443, 4310)) {
        $occupied = @($portDetails | Where-Object { $_.Port -eq $port })
        if ($occupied.Count -gt 0) {
            $descriptions = @($occupied | ForEach-Object { '{0}，PID {1}，{2}' -f $_.Address, $_.ProcessId, $_.ProcessName })
            Add-Check ('TCP {0}' -f $port) 'WARN' ('正在监听：{0}。安装或启动其他站点服务前，先确认是否复用现有服务。' -f ($descriptions -join '；'))
        } else {
            Add-Check ('TCP {0}' -f $port) 'PASS' '未发现本机 TCP 监听；此结果不代表云安全组、防火墙或公网访问已经放行。'
        }
    }
}

$disks = @()
try {
    $disks = @(Get-CimInstance -ClassName Win32_LogicalDisk -Filter 'DriveType=3' | Where-Object { $_.Size -gt 0 } | ForEach-Object {
        [pscustomobject][ordered]@{
            Drive = $_.DeviceID
            TotalGiB = [math]::Round($_.Size / 1GB, 2)
            FreeGiB = [math]::Round($_.FreeSpace / 1GB, 2)
            FreePercent = [math]::Round(100 * $_.FreeSpace / $_.Size, 1)
        }
    })
    foreach ($disk in $disks) {
        $diskStatus = 'PASS'
        if ($disk.FreeGiB -lt 5 -or $disk.FreePercent -lt 10) { $diskStatus = 'WARN' }
        Add-Check ('磁盘 {0}' -f $disk.Drive) $diskStatus ('剩余 {0} GiB / 总计 {1} GiB（{2}%）；课程视频和备份应预留足够空间。' -f $disk.FreeGiB, $disk.TotalGiB, $disk.FreePercent)
    }
} catch {
    Add-Check '磁盘空间' 'WARN' '无法读取本地固定磁盘空间。'
}

$knownServices = @()
try {
    $knownServices = @(Get-CimInstance -ClassName Win32_Service -Property Name, DisplayName, State, StartMode | Where-Object {
        $_.Name -match '^(W3SVC|WAS|IISADMIN|nginx|Apache.*|httpd|Caddy|BT[-_]?(Panel|Task|Web|Service).*|BaoTa.*|phpstudy.*|phpmanager.*)$' -or
        $_.DisplayName -match '(宝塔|BaoTa|BT-Panel|nginx|Apache|Caddy|World Wide Web Publishing|IIS Admin|Windows Process Activation)'
    } | Select-Object Name, DisplayName, State, StartMode)
    if ($knownServices.Count -gt 0) {
        Add-Check '网站相关服务' 'INFO' ('发现 {0} 个已知网站服务，详见下方列表；已安装不代表占用 80/443，请结合端口结果判断。' -f $knownServices.Count)
    } else {
        Add-Check '网站相关服务' 'INFO' '未发现匹配名称的宝塔、IIS、nginx、Apache 或 Caddy 服务；这不能排除自定义名称或手动启动的程序。'
    }
} catch {
    Add-Check '网站相关服务' 'WARN' '无法读取 Windows 服务列表。'
}

# 只检查常见的固定目录，不递归、不扫描整盘、不打开配置或密码文件。
$candidatePaths = @(
    'C:\BtSoft', 'D:\BtSoft', 'E:\BtSoft',
    'C:\BtSoft\panel', 'D:\BtSoft\panel', 'E:\BtSoft\panel',
    'C:\BtSoft\WebSoft\nginx', 'D:\BtSoft\WebSoft\nginx', 'E:\BtSoft\WebSoft\nginx',
    'C:\www\server\panel', 'D:\www\server\panel', 'E:\www\server\panel',
    'C:\www\server\nginx', 'D:\www\server\nginx', 'E:\www\server\nginx',
    'C:\nginx', 'D:\nginx', 'C:\Apache24', 'D:\Apache24'
)
if ($env:windir) { $candidatePaths += (Join-Path $env:windir 'System32\inetsrv\appcmd.exe') }
if ($env:ProgramFiles) {
    $candidatePaths += (Join-Path $env:ProgramFiles 'nginx')
    $candidatePaths += (Join-Path $env:ProgramFiles 'Caddy')
}
$knownPaths = @($candidatePaths | Select-Object -Unique | Where-Object { Test-Path -LiteralPath $_ -ErrorAction SilentlyContinue })
Add-Check '常见安装路径' 'INFO' ('固定位置检查发现 {0} 个路径；仅代表目录或文件存在，未读取其中内容。' -f $knownPaths.Count)

$dns = [pscustomobject][ordered]@{ Domain = $Domain; ExpectedIPv4 = $ExpectedIPv4; Addresses = @(); MatchesExpected = $false }
try {
    if (Get-Command Resolve-DnsName -ErrorAction SilentlyContinue) {
        $dns.Addresses = @(Resolve-DnsName -Name $Domain -Type A -DnsOnly -QuickTimeout -ErrorAction Stop | Where-Object { $_.Type -eq 'A' } | Select-Object -ExpandProperty IPAddress -Unique)
    } else {
        $dns.Addresses = @([Net.Dns]::GetHostAddresses($Domain) | Where-Object { $_.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork } | ForEach-Object { $_.IPAddressToString } | Select-Object -Unique)
    }
    $dns.MatchesExpected = $dns.Addresses -contains $ExpectedIPv4
    if ($dns.MatchesExpected) {
        Add-Check 'DNS A 记录' 'PASS' ('{0} 当前解析包含 {1}。DNS 正确不代表 ICP 备案、HTTPS 或微信合法域名已配置。' -f $Domain, $ExpectedIPv4)
    } else {
        $addressText = '无 A 记录'
        if ($dns.Addresses.Count -gt 0) { $addressText = $dns.Addresses -join '、' }
        Add-Check 'DNS A 记录' 'WARN' ('{0} 当前返回 {1}，预期为 {2}；请核对 DNSPod 记录及缓存。' -f $Domain, $addressText, $ExpectedIPv4)
    }
} catch {
    Add-Check 'DNS A 记录' 'WARN' ('无法通过本机 DNS 查询 {0}；请核对解析、DNS 网络及缓存。' -f $Domain)
}

$overall = 'PASS'
if (@($checks | Where-Object { $_.Status -eq 'FAIL' }).Count -gt 0) { $overall = 'FAIL' }
elseif (@($checks | Where-Object { $_.Status -eq 'WARN' }).Count -gt 0) { $overall = 'WARN' }
$report = [pscustomobject][ordered]@{
    SchemaVersion = 1
    CheckedAt = [DateTimeOffset]::Now.ToString('o')
    ReadOnly = $true
    Overall = $overall
    OperatingSystem = $os
    Identity = $identity
    Node = $node
    Npm = $npm
    ListeningPorts = @($portDetails)
    Disks = @($disks)
    KnownServices = @($knownServices)
    KnownInstallationPaths = @($knownPaths)
    Dns = $dns
    Checks = @($checks.ToArray())
    Limitations = @(
        '未读取 .env、密码、私钥或服务命令行；未安装软件、修改配置、服务、防火墙或 DNS。',
        'WARN 表示需要核对，不一定是故障；80/443 的现有监听可能正是宝塔网站服务。',
        '本脚本不验证公网端口、HTTPS、ICP 备案、小程序备案、数据库或真实支付；不得据此判断已经可以上线。'
    )
}

if ($Json) {
    $report | ConvertTo-Json -Depth 8
    return
}

Write-Output '知课 Windows Server 部署预检（只读）'
Write-Output ('检查时间：{0}' -f $report.CheckedAt)
Write-Output ('综合结果：{0}' -f $report.Overall)
foreach ($check in $checks) { Write-Output ('[{0}] {1}：{2}' -f $check.Status, $check.Name, $check.Message) }
if ($portDetails.Count -gt 0) {
    Write-Output ''
    Write-Output '端口与进程（不含命令行）：'
    Write-Output ($portDetails | Format-Table Port, Address, ProcessId, ProcessName, ExecutablePath -AutoSize | Out-String -Width 220).TrimEnd()
}
if ($knownServices.Count -gt 0) {
    Write-Output '已知网站相关服务：'
    Write-Output ($knownServices | Format-Table Name, DisplayName, State, StartMode -AutoSize | Out-String -Width 220).TrimEnd()
}
if ($knownPaths.Count -gt 0) {
    Write-Output '发现的常见安装路径：'
    foreach ($knownPath in $knownPaths) { Write-Output ('  {0}' -f $knownPath) }
}
foreach ($limitation in $report.Limitations) { Write-Output ('说明：{0}' -f $limitation) }
