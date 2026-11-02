@echo off
title RPG故事游戏 - 后台管理系统
cd /d "%~dp0"

set "PORT=8000"
set "PY_EXE=%~dp0.venv\Scripts\python.exe"

if exist "%PY_EXE%" goto py_ok
set "PY_EXE=python"
echo [提示] 没找到项目自带的 .venv，改用系统 python。
:py_ok

REM 先检查端口：已经有服务在监听 = 系统正在运行
netstat -ano | findstr ":%PORT%" | findstr "LISTENING" >nul
if errorlevel 1 goto do_start

:port_busy
echo ============================================================
echo   端口 %PORT% 已经有服务在监听了
echo ============================================================
echo.
echo   系统应该已经在运行（可能是后台方式启动的）。
echo   现在帮你打开后台页面：
start "" http://localhost:%PORT%/admin/index.html
echo.
echo   本窗口会一直显示服务状态，不会自动消失。
echo   想真正停掉服务，请用「停止.bat」或任务管理器结束 python 进程。
echo.
goto status_loop

:do_start
echo ============================================================
echo   RPG故事游戏 - 后台管理系统
echo   前台: http://localhost:%PORT%
echo   后台: http://localhost:%PORT%/admin/index.html
echo   文档: http://localhost:%PORT%/docs
echo ============================================================
echo.

"%PY_EXE%" -c "import fastapi, uvicorn, sqlalchemy" >nul 2>&1
if errorlevel 1 goto install_deps
goto run

:install_deps
echo [提示] 检测到依赖未装完，自动安装（只一次）……
"%PY_EXE%" -m pip install -r "%~dp0backend\requirements.txt" -i https://pypi.tuna.tsinghua.edu.cn/simple
if errorlevel 1 goto dep_fail
goto run

:dep_fail
echo.
echo [错误] 依赖安装失败。请手动执行：
echo        .venv\Scripts\python.exe -m pip install -r backend\requirements.txt
echo.
echo 窗口保持打开，方便你看到这条信息。
goto status_loop

:run
echo 正在启动服务…… 想停止就关闭这个窗口（或按 Ctrl+C）。
echo.
cd /d "%~dp0backend"
"%PY_EXE%" -m uvicorn app.main:app --host 0.0.0.0 --port %PORT%
echo.
echo ============================================================
echo   服务已退出！（关闭这个窗口 = 服务停止）
echo ============================================================

:status_loop
echo.
echo  ---- 服务状态监控（本窗口不会自动关闭）----
echo   按 Ctrl+C 或直接关闭本窗口即可退出（不影响已运行的服务）。
echo.
:loop
netstat -ano | findstr ":%PORT%" | findstr "LISTENING" >nul
if errorlevel 1 (
    echo [%date% %time%]  服务未在运行！端口 %PORT% 是空的
) else (
    echo [%date% %time%]  服务运行中 -^> http://localhost:%PORT%/admin/index.html
)
REM 等 5 秒再查一次（用 ping 做延迟，兼容各种环境）
ping -n 6 127.0.0.1 >nul
goto loop