@echo off
title Veyra Discord Bot
cd /d "%~dp0\Vivetauth"
if not exist ".env" (
  echo Missing Vivetauth\.env - copy .env.example to .env first.
  pause
  exit /b 1
)
where py >nul 2>nul
if %errorlevel%==0 (py main.py) else (python main.py)
pause
