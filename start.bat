@echo off
cd /d "%~dp0"
set "WEBGIS_URL=http://127.0.0.1:5182/"
netstat -ano | findstr /R /C:"127.0.0.1:5182 .*LISTENING" >nul
if %errorlevel%==0 (
  echo WebGIS dev server is already running at %WEBGIS_URL%
  start "" "%WEBGIS_URL%"
  exit /b 0
)
start "WebGIS Dev Server" cmd /k npm start
timeout /t 2 /nobreak >nul
start "" "%WEBGIS_URL%"
