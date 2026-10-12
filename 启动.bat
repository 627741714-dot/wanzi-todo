@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [!] Node.js not found.
  echo       Install it from https://nodejs.org/ then run this file again.
  echo.
  pause
  exit /b 1
)
echo.
echo   Starting local server for "Wanzi Todo" ...
echo   (Chinese hints are printed by tools\serve.mjs below.)
node tools\serve.mjs %*
echo.
echo   Server stopped.
pause
