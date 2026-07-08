@echo off
REM Serve this project locally and open it in your browser.
cd /d "%~dp0"
set PORT=%1
if "%PORT%"=="" set PORT=8080
echo Serving on http://localhost:%PORT%  (Ctrl+C to stop)
start "" http://localhost:%PORT%
python -m http.server %PORT%
