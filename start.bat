@echo off
cd /d "%~dp0"
rem Load AMAP_KEY from local .env (git-ignored)
if exist ".env" for /f "usebackq tokens=1,* delims==" %%a in (".env") do if "%%a"=="AMAP_KEY" set "AMAP_KEY=%%b"
if not defined AMAP_KEY echo [warn] AMAP_KEY is not configured. Copy .env.example to .env and fill it in, otherwise /amap-static will be unavailable.
if exist "D:\ProgramData\anaconda31\python.exe" set "WEBGIS_PYTHON=D:\ProgramData\anaconda31\python.exe"
set "WEBGIS_URL=http://127.0.0.1:5182/"
set "TRAIN_URL=http://127.0.0.1:5182/train"

start "WebGIS Full Stack" cmd /k npm run dev:all
timeout /t 4 /nobreak >nul
start "" "%WEBGIS_URL%"

echo WebGIS: %WEBGIS_URL%
echo Training Center: %TRAIN_URL%
