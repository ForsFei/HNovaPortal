@echo off
setlocal
cd /d "%~dp0"
title HNova Portal - 127.0.0.1:43100

where node >nul 2>nul
if errorlevel 1 (
  echo [HNova Portal] Node.js 22 or newer is required.
  goto failed
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [HNova Portal] npm was not found.
  goto failed
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
  echo [HNova Portal] Node.js 22 or newer is required.
  goto failed
)
powershell.exe -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 43100 -State Listen -ErrorAction SilentlyContinue) { exit 1 }"
if errorlevel 1 (
  echo [HNova Portal] Port 43100 is already in use. Close the other service first.
  goto failed
)

if not exist "node_modules\next\package.json" (
  echo [HNova Portal] Installing dependencies...
  call npm ci
  if errorlevel 1 goto failed
)

echo [HNova Portal] Building application...
call npm run build
if errorlevel 1 goto failed

echo [HNova Portal] Starting http://127.0.0.1:43100
start "" /min powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -WindowStyle Hidden -File "%~dp0scripts\open-when-ready.ps1"
call npm start
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo [HNova Portal] Startup failed. Check the message above.
pause
exit /b 1
