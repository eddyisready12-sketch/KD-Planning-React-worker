@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE="
if exist "C:\Program Files\nodejs\node.exe" set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not defined NODE_EXE if exist "C:\Program Files (x86)\nodejs\node.exe" set "NODE_EXE=C:\Program Files (x86)\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"

if not defined NODE_EXE (
  echo.
  echo Node.js is niet gevonden op deze pc.
  echo Installeer eerst Node.js en start daarna dit bestand opnieuw.
  echo.
  pause
  exit /b 1
)

echo MixPlanner React 1.41 wordt gestart op http://localhost:3000
"%NODE_EXE%" ".\node_modules\vite\bin\vite.js" --port=3000 --host=0.0.0.0

endlocal
