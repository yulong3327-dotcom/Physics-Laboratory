# 更新现有 Windows 课程服务

`Update-Service.ps1` 用于更新已经安装并正常运行的 `ZhikeCourse`，同时替换生产 npm 依赖。它不会修改服务注册、Caddy、生产 `.env`、`secrets`、数据库或上传文件。必须使用管理员 PowerShell，并提供从可信构建机器取得的发布包 SHA256；不能把刚收到的未知文件自行计算出的值当作来源验证。

```powershell
& 'C:\course-platform\course-platform\deploy\windows\Update-Service.ps1' `
  -ProjectRoot 'C:\course-platform\course-platform' `
  -ReleaseZip 'C:\course-deploy\zhike-windows-实际时间.zip' `
  -Sha256 '可信构建机器记录的64位SHA256'
```

默认 Node 目录为 `C:\course-deploy\node-v24.19.0-win-x64`，可用 `-NodeDirectory` 指定包含 `node.exe` 和 `node_modules\npm\bin\npm-cli.js` 的官方 Node.js 24 目录。脚本不安装或升级 Node，也不改动 WinSW 指向的可执行文件；若切换 Node 版本，应先单独核对服务配置。`-WorkDirectory` 默认 `C:\course-deploy\updates`，必须在项目外、与项目同一磁盘卷，以便直接移动依赖目录。

生产数据默认在项目的 `server\data\production`；若生产数据库和上传路径不同，应传入实际共同目录 `-DataDirectory`。备份目录默认 `C:\ProgramData\ZhikeCourse\backups`，也可通过 `-BackupDirectory` 指定项目与更新工作目录以外的目录。路径不得经过目录联接或符号链接。脚本按现有 LocalSystem 服务权限设计；专用低权限账号需要另行确认更新后依赖目录的读取权限。

## 执行流程与回滚

1. 先验证当前服务为生产模式，演示登录关闭，当前支付模式配置完整。默认要求微信虚拟支付；普通商户支付部署可传 `-PaymentMode wechat`。检查只确认配置存在，不会发起实际扣款。
2. 在仅管理员和 SYSTEM 可访问的工作目录复制 ZIP、校验 SHA256，拒绝路径穿越、重复 Windows 路径、链接、生产数据和凭据。随后在解压目录运行 `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`，并导入后端模块验证依赖。网络下载、安装失败均发生在替换现网之前。
3. 调用既有 `Backup-Service.ps1` 创建数据、上传文件和凭据的一致快照。该脚本复制期间暂时停服，恢复服务后才压缩。更新脚本确认服务恢复，然后进入第二个较短的运行时替换窗口。
4. 停服后保存被覆盖的旧文件，将旧 `node_modules`、可能存在的 `server\node_modules` 和网页产物移入私有回滚目录，再移动新依赖与网页、替换发布文件。npm 在 Windows 上生成的工作区目录联接会提前指向正式项目，避免依赖仍引用临时目录。
5. 保证根 `.env` 和 `secrets` 文件哈希未变，重启服务，检查 `/api/health` 与 `/api/config` 的生产模式、演示开关及支付配置。失败时停服，自动恢复旧文件、旧依赖和旧网页，再重启并检查旧服务。恢复也失败时明确报错并保留回滚资料。

成功标志为 `RUNTIME_AND_DEPENDENCIES_UPDATED_CONFIG_PRESERVED`。`Running` 状态本身不代表成功；脚本还必须完成 HTTP 检查。成功后的自动检查不包括云点播上传、签名播放、CDN 防盗链、外网 HTTPS、微信登录或真实扣款，仍需完成本次功能验收。

## 停机和数据限制

依赖下载和压缩均在服务运行时执行，最终停机窗口只包含小型代码备份、同卷目录移动、复制与重启。前置一致备份仍需要复制全部上传文件，数据量大时可能耗时，应在低峰期执行，并避开每日备份任务；脚本不会强行结束未停止的进程。磁盘需同时容纳新依赖、旧依赖和一致备份，空间不足会中止或触发回滚。

自动回滚仅恢复代码、依赖和网页，不自动倒回业务数据，避免覆盖升级期间新增的订单或支付通知。新后端启动时可能自行执行数据库迁移；本次 VOD 为新增表的兼容迁移，旧版可继续使用。未来出现破坏性迁移时，应另行安排维护和迁移回退，不能只依赖本脚本。

回滚目录及准备目录会保留并输出路径，不会自动递归删除。其中有旧运行时、依赖、发布包和恢复清单；一致备份还包含实际凭据，不能公开分享。功能验收和备份恢复确认后，由管理员核对绝对路径再清理过期目录。自动回滚结果为 `UPDATE_FAILED_OLD_RUNTIME_RESTORED`；出现 `UPDATE_FAILED_AND_RECOVERY_NEEDS_ATTENTION` 时查看服务日志和输出的私有目录，按 [SERVICES.md](SERVICES.md) 的备份恢复流程处理。
