@echo off
REM AddressIQ - safety copy of the code (all branches), the database, the map data and the keys.
REM It is written next to the project folder, in addressiq-backups\<date_time>\ . See scripts\backup.py.
cd /d %~dp0
python -X utf8 scripts\backup.py
pause
