@echo off
chcp 65001 >nul
cd /d "%~dp0"
%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0Install-ChatGuardLocal.ps1"
echo.
pause
