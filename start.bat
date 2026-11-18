@echo off
REM AddressIQ — starts the API (port 8000) and the web app (port 5173) in two windows.
cd /d %~dp0
start "AddressIQ API" cmd /k api.bat
start "AddressIQ Web" cmd /k "cd frontend && (if not exist node_modules call npm install) && npm run dev"
timeout /t 4 >nul
start http://localhost:5173
