@echo off
REM AddressIQ - one-time setup of the fixed public address https://addressiq.live as a named Cloudflare tunnel.
REM After this the tunnel shows in the Cloudflare dashboard and share.bat uses the fixed address.
cd /d %~dp0
if not exist data mkdir data
echo setup started > data\tunnel-setup.log
if not exist "%USERPROFILE%\.cloudflared\cert.pem" (
  echo.
  echo  STEP 1 of 3: a Cloudflare page opens in the browser. Choose addressiq.live and press Authorize.
  echo.
  tools\cloudflared.exe tunnel login
)
if not exist "%USERPROFILE%\.cloudflared\cert.pem" (
  echo login not completed >> data\tunnel-setup.log
  echo  Login was not completed. Run tunnel-setup.bat again.
  pause
  exit /b 1
)
echo login ok >> data\tunnel-setup.log
if not exist tools\addressiq-tunnel.json (
  echo  STEP 2 of 3: creating the tunnel addressiq ...
  tools\cloudflared.exe tunnel create --credentials-file "%~dp0tools\addressiq-tunnel.json" addressiq >> data\tunnel-setup.log 2>&1
)
echo  STEP 3 of 3: pointing addressiq.live at the tunnel ...
tools\cloudflared.exe tunnel route dns --overwrite-dns addressiq addressiq.live >> data\tunnel-setup.log 2>&1
tools\cloudflared.exe tunnel list >> data\tunnel-setup.log 2>&1
echo DONE >> data\tunnel-setup.log
if exist tools\addressiq-tunnel.json (
  echo  Setup finished. Starting the public link ...
  start "AddressIQ public link" cmd /k share.bat
) else (
  echo  Something went wrong - see data\tunnel-setup.log
  pause
)
