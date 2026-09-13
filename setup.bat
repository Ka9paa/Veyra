@echo off
setlocal
cd /d "%~dp0"
title Veyra Studio V8 Setup
py -3.13 --version >nul 2>&1
if errorlevel 1 (echo Python 3.13 was not found.&pause&exit /b 1)
py -3.13 -m pip install -r requirements.txt
if errorlevel 1 (echo Dependency installation failed.&pause&exit /b 1)
if not exist ".env" copy ".env.example" ".env" >nul
echo.
echo Veyra V8 is installed.
echo Add OPENAI_API_KEY to .env for live Veyra AI.
echo Normal local previews still work without it.
echo.
pause