@echo off
py -3.13 -c "import secrets; print(secrets.token_hex(32))"
pause