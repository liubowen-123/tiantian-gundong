@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 天天滚动 · 本地预览
echo ============================================
echo  天天滚动 本地预览
echo ============================================
netstat -ano 2>nul | findstr "127.0.0.1:8341" >nul
if %errorlevel%==0 (
  echo [提示] 服务器已在运行，跳过启动，直接打开页面...
) else (
  echo 正在启动本地服务器 (http://127.0.0.1:8341) ...
  start "天天滚动服务器" cmd /k "node server.js"
  timeout /t 2 /nobreak >nul
)
start "" "http://127.0.0.1:8341/index.html"
echo 已打开预览页面。
echo 以后就用这个 bat 启动；关掉"天天滚动服务器"窗口即可停止服务。
pause
