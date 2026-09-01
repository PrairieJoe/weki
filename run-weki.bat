@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules\vite" (
  echo Weki dependencies are being installed for the first run...
  call npm install
  if errorlevel 1 (
    echo.
    echo Failed to install dependencies. Please check Node.js and your network connection.
    pause
    exit /b 1
  )
)

start "Weki Local Server" /min cmd /c "npm run start"

for /l %%i in (1,1,20) do (
  powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173/api/status -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }"
  if not errorlevel 1 goto :open
  timeout /t 1 /nobreak >nul
)

echo Weki server could not be started. Check the Weki Local Server window.
pause
exit /b 1

:open
start "" "http://127.0.0.1:5173/"
endlocal
