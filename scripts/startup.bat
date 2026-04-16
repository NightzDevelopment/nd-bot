@echo off
cd /d "%~dp0.."
if not exist "logs" mkdir logs
pm2 start ecosystem.config.cjs
pause
