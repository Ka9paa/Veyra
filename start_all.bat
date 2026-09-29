@echo off
cd /d "%~dp0"
start "Veyra Website" cmd /k call "%~dp0start.bat"
timeout /t 2 /nobreak >nul
start "Veyra Discord Bot" cmd /k call "%~dp0start_bot.bat"
exit /b
