@echo off
REM AddressIQ - public link. Builds the web app, starts the API if it is not running, then opens a Cloudflare tunnel:
REM   - after tunnel-setup.bat was run once: the fixed address https://addressiq.live
REM   - otherwise: a quick tunnel with a random https://....trycloudflare.com address printed below
REM The link works for as long as this window and the API window stay open.
cd /d %~dp0
if not exist tools\cloudflared.exe (
  echo tools\cloudflared.exe is missing. Download cloudflared-windows-amd64.exe from
  echo https://github.com/cloudflare/cloudflared/releases/latest and save it as tools\cloudflared.exe
  pause
  exit /b 1
)
pushd frontend
call npm run build
popd
curl -s -o nul -m 3 http://127.0.0.1:8000/api/health || start "AddressIQ API" cmd /k api.bat
timeout /t 8 >nul
if exist tools\addressiq-tunnel.json (
  echo.
  echo  === Public link: https://addressiq.live   Keep this window open. ===
  echo.
  tools\cloudflared.exe tunnel --no-autoupdate --logfile data\tunnel-named.log run --credentials-file tools\addressiq-tunnel.json --url http://127.0.0.1:8000 addressiq
) else (
  if exist data\tunnel.log del data\tunnel.log
  echo.
  echo  === Public link: look for  https://....trycloudflare.com  below. Keep this window open. ===
  echo.
  tools\cloudflared.exe tunnel --url http://127.0.0.1:8000 --no-autoupdate --logfile data\tunnel.log
)
