@echo off
REM AddressIQ — starts the API (port 8000) and the web app (port 5173) in two windows.
cd /d %~dp0
start "AddressIQ API" cmd /k "cd backend && python -X utf8 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"
start "AddressIQ Web" cmd /k "cd frontend && npm run dev"
timeout /t 4 >nul
start http://localhost:5173
