@echo off
setlocal enabledelayedexpansion
:: wow~ updater (Windows)
:: Download latest from Gitee Releases (GitHub old repo as fallback) and overwrite

set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"

set GITEE_REPO=nuoge233/wow
set GITHUB_REPO=nuoge2333/Wow-
set TEMP_DIR=%TEMP%\wow_update_%RANDOM%
set TEMP_ZIP=%TEMP_DIR%\update.zip

echo ========================================
echo   wow~ Updater
echo ========================================
echo.

:: Create temp dir
mkdir "%TEMP_DIR%" 2>nul

:: Get latest release info: Gitee first, GitHub fallback
echo Checking latest version...
set RELEASE_HOST=gitee
powershell -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try { $r = Invoke-RestMethod -Uri 'https://gitee.com/api/v5/repos/nuoge233/wow/releases/latest'; Write-Output $r.tag_name; Write-Output $r.assets[0].browser_download_url } catch { Write-Output 'ERROR' } }" > "%TEMP_DIR%\release.txt" 2>nul

set /p LATEST_TAG=<"%TEMP_DIR%\release.txt"
if "%LATEST_TAG%"=="ERROR" (
    echo Gitee unavailable, trying GitHub...
    set RELEASE_HOST=github
    powershell -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try { $r = Invoke-RestMethod -Uri 'https://api.github.com/repos/nuoge2333/Wow-/releases/latest'; Write-Output $r.tag_name; Write-Output $r.assets[0].browser_download_url } catch { Write-Output 'ERROR' } }" > "%TEMP_DIR%\release.txt" 2>nul
    set /p LATEST_TAG=<"%TEMP_DIR%\release.txt"
)

if "%LATEST_TAG%"=="ERROR" (
    echo Cannot access Gitee/GitHub API. Check your network.
    goto :cleanup
)

:: Read download url (2nd line)
for /f "usebackq skip=1 delims=" %%a in ("%TEMP_DIR%\release.txt") do (
    set DOWNLOAD_URL=%%a
    goto :got_url
)
:got_url

echo Latest: %LATEST_TAG% (source: %RELEASE_HOST%)
echo URL: %DOWNLOAD_URL%
echo.

:: Fallback to source zip if no custom asset
if "%DOWNLOAD_URL%"=="" (
    if "%RELEASE_HOST%"=="gitee" (
        set DOWNLOAD_URL=https://gitee.com/nuoge233/wow/repository/archive/%LATEST_TAG%.zip
    ) else (
        set DOWNLOAD_URL=https://github.com/nuoge2333/Wow-/archive/refs/tags/%LATEST_TAG%.zip
    )
    echo Fallback URL: %DOWNLOAD_URL%
)

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

:: Find project root: locate wow.bat, skip core/ subdir
set PROJECT_DIR=
for /r "%TEMP_DIR%\extract" %%f in (wow.bat) do (
    set FULL=%%~dpf
    echo !FULL! | findstr /i "\\core\\" >nul
    if errorlevel 1 (
        set PROJECT_DIR=%%~dpf
        goto :found_project
    )
)
:found_project

if "%PROJECT_DIR%"=="" (
    echo Update package format error: wow.bat not found.
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
echo   Update complete! %LATEST_TAG% (source: %RELEASE_HOST%)
echo ========================================
echo.
echo Run wow.bat to launch wow~

:cleanup
rmdir /s /q "%TEMP_DIR%" 2>nul
pause
