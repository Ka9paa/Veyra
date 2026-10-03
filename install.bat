@echo off
cd /d "%~dp0"
py -m pip install -r requirements.txt
py -m pip install -r Vivetauth\requirements.txt
pause
