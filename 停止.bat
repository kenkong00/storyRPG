@echo off
title 停止 RPG故事游戏服务
cd /d "%~dp0"

set "PORT=8000"
echo 正在查找占用 %PORT% 端口的进程……

set "FOUND="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
    if not defined FOUND set "FOUND=%%p"
)

if not defined FOUND goto nothing

echo 结束进程 PID=%FOUND%
taskkill /PID %FOUND% /F >nul 2>&1
if errorlevel 1 goto kill_fail
echo 已停止。
goto end

:nothing
echo 没有发现正在监听 %PORT% 的进程，服务本来就没在跑。
goto end

:kill_fail
echo 结束进程失败，可能需要以管理员身份运行本文件。
goto end

:end
echo.
echo 本窗口 6 秒后自动关闭。
%SystemRoot%\System32\timeout.exe /t 6 /nobreak >nul
