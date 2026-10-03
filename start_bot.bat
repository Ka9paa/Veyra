@echo off
cd /d "%~dp0\Vivetauth"
if not exist ".env" (
  echo Copy .env.example to .env first.
  pause
  exit /b 1
)
py main.py
pause
