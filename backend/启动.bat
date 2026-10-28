@echo off
chcp 65001 >nul
title RPG故事游戏后台管理系统
cd /d "%~dp0"
echo ========================================
echo   RPG故事游戏后台管理系统启动中...
echo   后端地址: http://localhost:8000
echo   管理后台: http://localhost:8000/admin/index.html
echo   API文档:  http://localhost:8000/docs
echo ========================================
echo.
echo 正在启动后端服务，按 Ctrl+C 可停止...
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
pause
