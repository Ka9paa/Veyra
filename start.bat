@echo off
title Veyra
cd /d "%~dp0"
if not exist ".env" (
  echo Missing .env - copy .env.example to .env first.
  pause
  exit /b 1
)
where py >nul 2>nul
if %errorlevel%==0 (py app.py) else (python app.py)
pause
