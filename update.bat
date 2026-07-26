@echo off
setlocal enabledelayedexpansion
:: wow~ updater (Windows)
:: Download latest from GitHub Releases and overwrite

set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"

set TEMP_DIR=%TEMP%\wow_update_%RANDOM%
set TEMP_ZIP=%TEMP_DIR%\update.zip

echo ========================================
echo   wow~ Updater
echo ========================================
echo.

:: Create temp dir
mkdir "%TEMP_DIR%" 2>nul

:: Get latest release info
echo Checking latest version...
powershell -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try { $r = Invoke-RestMethod -Uri 'https://api.github.com/repos/nuoge2333/Wow-/releases/latest'; Write-Output $r.tag_name; Write-Output $r.assets[0].browser_download_url } catch { Write-Output 'ERROR' } }" > "%TEMP_DIR%\release.txt" 2>nul

if not exist "%TEMP_DIR%\release.txt" (
    echo Cannot access GitHub API. Check your network.
    goto :cleanup
)

:: Read tag and download url
set /p LATEST_TAG=<"%TEMP_DIR%\release.txt"
for /f "usebackq skip=1 delims=" %%a in ("%TEMP_DIR%\release.txt") do (
    set DOWNLOAD_URL=%%a
    goto :got_url
)
:got_url

if "%LATEST_TAG%"=="ERROR" (
    echo Failed to get version info.
    goto :cleanup
)

echo Latest: %LATEST_TAG%
echo URL: %DOWNLOAD_URL%
echo.

:: Download
echo Downloading update package...
powershell -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%DOWNLOAD_URL%' -OutFile '%TEMP_ZIP%' }"
if errorlevel 1 (
    echo Download failed.
    goto :cleanup
)
echo Download complete.
echo.

:: Extract
echo Installing update...
mkdir "%TEMP_DIR%\extract" 2>nul
powershell -Command "& { Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('%TEMP_ZIP%', '%TEMP_DIR%\extract'); }"
if errorlevel 1 (
    echo Extraction failed.
    goto :cleanup
)

:: Find project root: locate start.bat, skip core/ subdir
set PROJECT_DIR=
for /r "%TEMP_DIR%\extract" %%f in (start.bat) do (
    set FULL=%%~dpf
    echo !FULL! | findstr /i "\\core\\" >nul
    if errorlevel 1 (
        set PROJECT_DIR=%%~dpf
        goto :found_project
    )
)
:found_project

if "%PROJECT_DIR%"=="" (
    echo Update package format error: start.bat not found.
    goto :cleanup
)

:: Overwrite (skip runtime dirs)
echo Overwriting files...
for %%i in ("%PROJECT_DIR%*") do (
    set NAME=%%~nxi
    if /i not "!NAME!"=="server" if /i not "!NAME!"=="node_modules" if /i not "!NAME!"==".git" (
        if exist "%%i\" (
            xcopy /E /Y /Q "%%i\*" "%SCRIPT_DIR%\!NAME!\" >nul 2>&1
        ) else (
            copy /Y "%%i" "%SCRIPT_DIR%" >nul 2>&1
        )
    )
)

echo.
echo ========================================
echo   Update complete! %LATEST_TAG%
echo ========================================
echo.
echo Run start.bat to launch wow~

:cleanup
rmdir /s /q "%TEMP_DIR%" 2>nul
pause
