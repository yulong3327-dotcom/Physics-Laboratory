@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 24 或更新版本。
  pause
  exit /b 1
)
if not exist node_modules\vite\bin\vite.js (
  call npm install
  if errorlevel 1 goto failed
)
call npm run build
if errorlevel 1 goto failed
echo.
echo 学生端：http://127.0.0.1:4310
echo 管理后台：http://127.0.0.1:4310/admin
echo 演示账号：admin  密码：admin123456
echo 关闭此窗口即可停止服务。
call npm start
if errorlevel 1 goto failed
exit /b 0
:failed
echo 启动失败，请查看以上错误信息。
pause
exit /b 1
