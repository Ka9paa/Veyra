@echo off
title Veyra Studio V11 — Sol
cd /d "%~dp0"
echo Starting Veyra Studio V11 — Sol...
echo Open http://127.0.0.1:8765
echo.
py -3.13 -c "from waitress import serve; from app import app; import os; serve(app, host=os.getenv('HOST','127.0.0.1'), port=int(os.getenv('PORT','8765')), threads=8)"
pause
