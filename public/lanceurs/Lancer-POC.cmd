@echo off
cd /d "%~dp0.."
set "PORT=4177"
node scripts/prepare-site.mjs
if errorlevel 1 goto :erreur
start "" "http://127.0.0.1:4177/"
node scripts/server.mjs
pause
exit /b
:erreur
pause
exit /b 1
