# Windows Server 域名与部署参数

目标服务器公网 IPv4：`43.138.144.203`。课程站点使用 `course.yulongchemistry.cn`，同一域名提供 API、学生网页和 `/admin` 管理后台。本文件为部署操作说明；当前实例的安装与实测状态见 [部署记录](DEPLOYED.md)。

## 1. 确认备案

腾讯云域名列表的“正常”仅表示域名状态。访问 [工信部备案管理系统](https://beian.miit.gov.cn/)，进入 ICP 备案查询，以 `yulongchemistry.cn` 查询；如果要求验证，手动完成。若无备案，使用腾讯云 ICP 备案入口办理。已备案时核对备案主体、用途及接入情况，是否需要新增接入以腾讯云审核要求为准；小程序备案需另外确认。

服务器在广州，正式提供服务前应满足适用的备案与接入要求。可先配置 DNS 和准备后端；备案查询结果未确认前，不以解析成功或证书签发成功判断已具备上线条件。

## 2. DNSPod 添加解析

在腾讯云域名列表点击 `yulongchemistry.cn` 右侧“解析”，添加一条记录：

| 字段 | 值 |
| --- | --- |
| 主机记录 | `course` |
| 记录类型 | `A` |
| 线路 | 默认 |
| 记录值 | `43.138.144.203` |
| TTL | 600 秒，或控制台默认值 |

添加前检查是否已有同名记录，如有记录先核实用途。不要修改其他在用记录。DNS 更新后用 `Resolve-DnsName course.yulongchemistry.cn -Type A` 检查，预期 IPv4 为 `43.138.144.203`。

## 3. 服务器部署

此实例使用 Windows Server，当前已采用原生 Node.js 24、WinSW 服务与 Caddy 反向代理。现有 Dockerfile 是 Linux 镜像，不能直接用于当前原生 Windows 环境。

可在开发机运行 `npm run package:windows`，将生成的 `.tmp/releases/zhike-windows-*.zip` 上传服务器并解压。发布包包含已构建网页、后端源码和本目录脚本，排除开发数据库与全部凭据。安装 Node.js 24 后在服务器 PowerShell 运行 `& '项目路径\deploy\windows\Prepare-Server.ps1'`，安装生产依赖并在 `.env` 不存在时生成随机管理密码、会话密钥。脚本不会覆盖已有 `.env`，仍需本地填写微信凭据、设置常驻进程和 HTTPS。Windows 示例通过 `HOST=127.0.0.1` 限制后端只供本机反向代理访问。

1. 在服务器确认 Windows 版本、宝塔 Web 服务和端口占用情况，安装 Node.js 24。将 GitHub 分支 `codex/zhike-course-platform` 中的 `course-platform/` 放入固定目录（例如 `D:\course-platform`）。
2. 在项目目录执行 `npm ci`、`npm run build`。将本目录 `.env.example` 复制为项目根 `.env`，在服务器本地填写独立管理密码（至少 12 位）、随机会话密钥（至少 32 位）与微信凭据。不要复制开发数据库或上传凭据到 GitHub。
3. 先运行 `npm run check:wechat`，条件具备时运行 `npm run check:wechat -- --verify`，然后 `npm start`；检查 `http://127.0.0.1:4310/api/health` 和管理后台。
4. 使用受维护的 Windows 服务包装器或面板中可用的进程管理功能配置服务常驻、工作目录、开机启动和故障重启，先验证重启恢复，再对外开放。仅运行终端中的 `npm start` 不构成常驻部署。
5. 使用宝塔当前 Web 服务创建 `course.yulongchemistry.cn` 站点，安装该域名证书，将请求反向代理至 `http://127.0.0.1:4310`，传递正确的转发请求头，并按 250 MB 上传上限设置代理大小与超时。根据实际 IIS/Nginx 等服务选择对应配置，避免另装代理占用已有的 80/443。
6. 腾讯云实例防火墙与 Windows 防火墙允许站点使用的 80/443；不对公网开放后端 4310。使用 Caddy 安装器的 `-OpenFirewall` 前先用 `Get-Service MpsSvc` 确认 Windows Defender Firewall 服务正在运行；安装器不会改变系统防火墙的全局状态，创建规则失败会终止。管理后台、面板及远程管理端口限制为管理员来源。
7. 在实际运行服务的账号下验证 `.env`、`secrets/`、数据库及上传目录的读取/写入权限；配置数据库和文件的共同备份、日志轮转与恢复演练。

常驻服务和每日备份可使用本目录已提供的 `Install-Service.ps1`、`Backup-Service.ps1`、`Register-Backup.ps1`，具体安装、验收和恢复步骤见 [SERVICES.md](./SERVICES.md)。脚本不替换宝塔已有代理。

## 4. HTTPS 验收后配置微信

- 健康检查：`https://course.yulongchemistry.cn/api/health`
- 管理后台：`https://course.yulongchemistry.cn/admin`
- `miniprogram/app.js` 的 `apiBaseUrl`：默认已设置为 `https://course.yulongchemistry.cn`。本机调试可临时改为 `http://127.0.0.1:4310`，真机和发布前恢复 HTTPS 地址。
- 微信 request、downloadFile 合法域名：`https://course.yulongchemistry.cn`。学生端当前不上传文件；若后续加入上传功能，再设置对应 uploadFile 合法域名。视频或资料使用其他域名时按微信要求另外配置。
- 支付通知 URL：`https://course.yulongchemistry.cn/api/payments/wechat/notify`。填写 URL 本身不会开通支付，还需配置商户并验证真实付款。

最后在 Android、iOS 真机检查登录、学习、讲义下载与付款流程。当前模板不包含已完成备案、商户开通、视频托管或微信审核的承诺。
