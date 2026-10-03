@echo off
cd /d "%~dp0"
if not exist ".env" (
  echo Copy .env.example to .env first.
  pause
  exit /b 1
)
py app.py
pause
