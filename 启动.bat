@echo off
title RPG故事游戏后台管理系统

REM ===== 定位到项目根目录（本文件所在目录） =====
cd /d "%~dp0"

REM ===== 优先使用项目自带虚拟环境 .venv =====
set "PY_EXE=%~dp0.venv\Scripts\python.exe"
if not exist "%PY_EXE%" (
    echo [提示] 未找到项目虚拟环境 .venv，将使用系统 python
    set "PY_EXE=python"
)

echo ========================================
echo   RPG故事游戏后台管理系统启动中...
echo   后端地址: http://localhost:8000
echo   管理后台: http://localhost:8000/admin/index.html
echo   API文档:  http://localhost:8000/docs
echo ========================================
echo.

REM ===== 检查依赖是否齐全，缺失则自动安装 =====
"%PY_EXE%" -c "import fastapi, uvicorn, sqlalchemy" >nul 2>&1
if errorlevel 1 (
    echo [提示] 检测到依赖未安装，正在自动安装...
    "%PY_EXE%" -m pip install -r "%~dp0backend\requirements.txt" -i https://pypi.tuna.tsinghua.edu.cn/simple
    if errorlevel 1 (
        echo [错误] 依赖安装失败，请检查网络后重试。
        pause
        exit /b 1
    )
)

echo 正在启动后端服务，按 Ctrl+C 可停止...
cd /d "%~dp0backend"
"%PY_EXE%" -m uvicorn app.main:app --host 0.0.0.0 --port 8000
pause
