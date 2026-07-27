@echo off
setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set CORE_DIR=%SCRIPT_DIR%core

if not exist "%CORE_DIR%" (
    echo Error: core directory not found
    pause
    exit /b 1
)

pushd "%CORE_DIR%"

:: Detect system architecture
if "%PROCESSOR_ARCHITECTURE%"=="AMD64" (
    set ARCH=x64
) else if "%PROCESSOR_ARCHITECTURE%"=="ARM64" (
    set ARCH=arm64
) else (
    set ARCH=x64
)

set NODE_DIR=node\win\%ARCH%
set NODE_EXE=%NODE_DIR%\node.exe

if not exist "%NODE_EXE%" (
    echo Portable Node.js not found, downloading...
    :: Clean up old installation if exists
    if exist "%NODE_DIR%" rmdir /s /q "%NODE_DIR%" 2>nul
    call :download_node_win %ARCH%
    if errorlevel 1 (
        echo Download failed. Check your network or manually place Node.js into %NODE_DIR%
        pause
        exit /b 1
    )
)

:: Install dependencies on first run
if not exist "node_modules" (
    echo Installing dependencies...
    :: Try extracted npm first, fallback to npm.cmd
    if exist "%NODE_DIR%\extracted\npm.cmd" (
        "%NODE_DIR%\extracted\npm.cmd" install --no-audit --no-fund
    ) else if exist "%NODE_DIR%\extracted\node_modules\npm\bin\npm-cli.js" (
        "%NODE_EXE%" "%NODE_DIR%\extracted\node_modules\npm\bin\npm-cli.js" install --no-audit --no-fund
    ) else (
        echo npm not found in portable Node.js, trying system npm...
        call npm install --no-audit --no-fund 2>nul
    )
    if errorlevel 1 (
        echo Failed to install dependencies. Try: cd core ^&^& npm install
        popd
        pause
        exit /b 1
    )
)

"%NODE_EXE%" src\cli.js %*

if errorlevel 1 (
    popd
    echo.
    echo An error occurred (exit code %errorlevel%). Press any key to close...
    pause >nul
    exit /b 1
)

:: Always keep the window open so the user can read the output (prevents flash-close)
echo.
echo Press any key to exit...
pause >nul

popd
exit /b 0

:download_node_win
set ARCH=%1
set NODE_VERSION=20.17.0
set NODE_URL=https://nodejs.org/dist/v%NODE_VERSION%/node-v%NODE_VERSION%-win-%ARCH%.zip
set ZIP_FILE=node-temp.zip

echo Download URL: %NODE_URL%
powershell -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%ZIP_FILE%' }"

if errorlevel 1 (
    echo Download failed
    exit /b 1
)

:: Extract
if not exist "%NODE_DIR%" mkdir "%NODE_DIR%"
powershell -Command "& { Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('%ZIP_FILE%', '.'); }"

if errorlevel 1 (
    echo Extraction failed
    del "%ZIP_FILE%" 2>nul
    exit /b 1
)

:: Move files - keep full directory structure for npm
move "node-v%NODE_VERSION%-win-%ARCH%" "%NODE_DIR%\extracted" >nul 2>&1
:: Create node.exe symlink (or copy)
if not exist "%NODE_EXE%" (
    copy "%NODE_DIR%\extracted\node.exe" "%NODE_EXE%" >nul 2>&1
)
del "%ZIP_FILE%"

echo Portable Node.js installed to %NODE_DIR%
exit /b 0
