# Windows 常驻进程与一致备份

Node 服务和备份脚本不修改 DNS、代理或防火墙。可选的 `Install-CaddyService.ps1` 独立安装 HTTPS 代理；仅明确传入 `-OpenFirewall` 时添加 Caddy 程序的 TCP 80/443 入站规则。先完成 `Prepare-Server.ps1`、在生产目录保存 `.env` 并验证 `127.0.0.1:4310/api/health`。安装 Node 服务前停止该项目的临时 Node 进程，防止两个进程争用端口；不要停止其他网站的进程。

## 课程服务

使用官方 [WinSW 2.12.0 稳定版发布页](https://github.com/winsw/winsw/releases/tag/v2.12.0) 的 `WinSW-x64.exe`。在可信设备从官方地址下载并记录 SHA256，然后将同一文件传到服务器；`Install-Service.ps1` 强制核对该 SHA256，避免用错文件。此仓库不附带第三方可执行文件。若服务器不能访问 GitHub，可通过官方终端文件上传传入已验证的文件。

管理员 PowerShell 示例（按实际目录填写）：

```powershell
$expectedHash = '从可信设备记录的64位SHA256'
& 'C:\course-platform\deploy\windows\Install-Service.ps1' `
  -ProjectRoot 'C:\course-platform' `
  -WinSWPath 'C:\installers\WinSW-x64.exe' `
  -WinSWSha256 $expectedHash -Start
```

服务名默认为 `ZhikeCourse`，工作目录固定为项目根，直接运行已安装的 `node.exe server/index.js`，默认 LocalSystem 账号。管理员和 SYSTEM 才可访问包装器配置、根 `.env` 和 `secrets` 目录，脚本不读取或打印密钥。此账号拥有系统权限，项目目录也应仅允许受信任的管理员修改；如果改用低权限专用账号，需要另外授予项目读取、数据目录写入权限及服务登录权限。

服务开机自动启动，异常退出依次等待 10、30、60 秒重启。Node 标准输出和错误日志保存在 `.services\ZhikeCourse\logs`，每个日志约 10 MiB 时轮转，保留 8 份。服务安装脚本拒绝覆盖同名既有服务。更新已运行服务时使用 [Update-Service.ps1](UPDATE.md)，在独立目录先安装生产依赖，备份后短暂停服替换，失败自动恢复旧运行时和依赖；不要解压覆盖运行中的依赖目录。`-ConfigureOnly` 可仅生成配置供审阅，不向 SCM 注册服务。

验证 `Get-Service ZhikeCourse`、本机健康检查、主动终止该服务对应的 Node 子进程后自动恢复；最后在维护时间进行服务器重启验收。单看 SCM 的 Running 状态不足以证明 API 正常，仍需实际 HTTP 请求。

## Caddy HTTPS 代理

80/443 没有现有网站占用时，可独立使用 Caddy。官方 [Caddy 2.11.7 Windows amd64 ZIP](https://github.com/caddyserver/caddy/releases/download/v2.11.7/caddy_2.11.7_windows_amd64.zip) 的发布记录 SHA256 为 `0a1edc0b799512051c57071ce0e798d3f2cf67dc98171366f1d2b326072e3b06`。先核对 ZIP，再解压。经核对 ZIP 中的 `caddy.exe` SHA256 为 `5f93a9bd555f3aac9d33af2756ba14b3519d8cca4ffd55256bdaeab444c9db2a`。

传入 `-OpenFirewall` 前，先用 `Get-Service MpsSvc` 检查 Windows Defender Firewall 服务正在运行，再确认现有防火墙策略。安装器会检查该服务；未运行或创建规则失败时终止并报错，不会继续报告安装成功，也不会启动、启用或关闭系统防火墙。若服务器使用其他防火墙方案，按现有策略另行配置并验证 80/443，不传此开关；不能仅凭公网 HTTPS 可访问判断 Windows 入站规则已创建成功。

```powershell
& 'C:\course-platform\course-platform\deploy\windows\Install-CaddyService.ps1' `
  -WinSWPath 'C:\installers\WinSW-x64.exe' `
  -WinSWSha256 $expectedHash `
  -CaddyPath 'C:\installers\caddy.exe' `
  -CaddySha256 '5f93a9bd555f3aac9d33af2756ba14b3519d8cca4ffd55256bdaeab444c9db2a' `
  -OpenFirewall -Start
```

默认服务 `ZhikeCaddy` 将 `course.yulongchemistry.cn` 反向代理至 `127.0.0.1:4310`，自动申请和续期 HTTPS 证书。安装器检查端口、哈希、同名服务及既有文件，再用实际 Caddy 二进制验证配置；拒绝覆盖已有安装。`-Start` 要求上游健康且为 production，并在启动后使用正常 Windows 证书验证请求公网 HTTPS 健康接口。若证书签发或公网检查失败，会保留已安装服务并报错，便于查阅日志；不得把 SCM Running 当作 HTTPS 验收通过。

程序、配置、证书存储 `data`、配置缓存 `config-cache`、日志均固定于 `C:\ProgramData\ZhikeCourse\proxy`，仅 SYSTEM 和本机管理员可访问。证书存储由配置中的 `storage file_system` 明确指定，不依赖 SYSTEM 用户默认目录。Caddy 管理 API 关闭，使用 Windows 服务重启应用配置。标准输出、错误及访问日志各按约 10 MiB 轮转，保留 8 份；访问日志删除 URI 和请求/响应头，避免留下签名下载链接、令牌和 Cookie。

`-ConfigureOnly` 只生成文件，既不执行 Caddy、不注册服务，也不放行防火墙；在独立测试目录运行后，可用 `caddy.exe validate --config Caddyfile --adapter caddyfile` 进一步验证。正式安装会再次检查 TCP 80/443 空闲。云端实例防火墙还需允许 TCP 80/443，DNS 必须指向此实例；这些条件与 ICP、小程序备案应分别检查。TCP 4310 继续只监听 loopback，不增加其公网规则。

## 数据和讲义共同备份

`Backup-Service.ps1` 会短暂停止课程服务，将指定数据目录（SQLite、WAL 和上传文件）、根 `.env`、`secrets` 一起复制，随后立即恢复原来运行中的服务，再压缩快照和生成 SHA256。数据目录参数必须与生产 `DATABASE_PATH`、`UPLOAD_DIR` 对应；默认部署二者均放在 `server\data\production`。脚本不解析 `.env`，不要在数据目录以外另放未纳入备份的上传文件或支付证书。

首次手动执行并检查恢复：

```powershell
& 'C:\course-platform\deploy\windows\Backup-Service.ps1' `
  -ProjectRoot 'C:\course-platform' `
  -DataDirectory 'C:\course-platform\server\data\production'
```

默认备份存放于 `C:\ProgramData\ZhikeCourse\backups`，仅 SYSTEM/本机管理员可访问，保留 7 天。压缩包包含配置和私钥，不属于可公开分享的发布包。课程内容较多时复制期间会暂时不可访问，应在低峰期运行，预留原数据两倍以上的备份空间，或迁移到容量充足的独立磁盘。备份失败会保留未完成快照供排查，不会用失败结果清理旧备份。

手动成功后再注册每天服务器当地时间 03:30 的备份任务：

```powershell
& 'C:\course-platform\deploy\windows\Register-Backup.ps1' `
  -ProjectRoot 'C:\course-platform' `
  -DataDirectory 'C:\course-platform\server\data\production'
Get-ScheduledTaskInfo -TaskName 'ZhikeCourse-DailyBackup'
```

任务以 SYSTEM 运行，重复触发时不并发，错过时间会补运行；通过任务历史和 `LastTaskResult` 检查故障。每日本机备份不能应对服务器或磁盘丢失，还需安全复制到独立存储。

恢复演练应先在隔离目录或测试实例：核对 ZIP 的 SHA256，停止课程服务，将 `data/` 恢复到原生产数据目录、`.env` 恢复到项目根、`secrets/` 恢复到原目录，保留原文件以便回退，核对权限后再启动并验证管理后台、课程、订单和讲义。不要只恢复 `courses.sqlite` 而混用另一个时间点的 WAL 或讲义文件。备份目录须位于网站静态目录和数据目录以外。
