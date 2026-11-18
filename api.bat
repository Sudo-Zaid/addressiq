@echo off
REM AddressIQ API (port 8000). Installs the Python packages the first time, then starts the server.
cd /d %~dp0backend
python -c "import uvicorn, fastapi, jwt, rapidfuzz, shapely, multipart, pydantic" 2>nul
if errorlevel 1 (
  echo.
  echo  Installing the Python packages for AddressIQ ^(first time only, needs internet^)...
  echo.
  python -m pip install --user -r requirements.txt
)
python -X utf8 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
