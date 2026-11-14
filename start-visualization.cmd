@echo off
setlocal
cd /d "%~dp0"

set "VISUALIZATION_NODE="
for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined VISUALIZATION_NODE set "VISUALIZATION_NODE=%%N"
if not defined VISUALIZATION_NODE if exist "%ProgramFiles%\nodejs\node.exe" set "VISUALIZATION_NODE=%ProgramFiles%\nodejs\node.exe"
if not defined VISUALIZATION_NODE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "VISUALIZATION_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not defined VISUALIZATION_NODE (
    echo Node.js was not found. Install Node.js and reopen this terminal.
    exit /b 1
)
if not exist "%~dp0node_modules\vite\bin\vite.js" (
    echo Vite was not found. Install the project dependencies first.
    exit /b 1
)

echo Open http://127.0.0.1:5174/animation.html in your browser.
echo Keep this terminal open. Press Ctrl+C to stop the server.
"%VISUALIZATION_NODE%" "%~dp0node_modules\vite\bin\vite.js" --host 127.0.0.1 --port 5174
exit /b %errorlevel%
