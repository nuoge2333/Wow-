@echo off
setlocal enabledelayedexpansion
:: wow~ updater (Windows)
:: Download latest from Gitee (GitHub old repo as fallback) and overwrite.
:: 版本解析：优先 releases/latest；若无 Release 则回退 tags API（过滤 backup/ 等非版本标签，取最大 semver），
:: 直接下载源站 zip，无需私人令牌，也不保留多镜像。

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

:: Resolve latest tag: releases/latest -> tags API (max semver, filter non-version tags)
powershell -Command ^
  "$ErrorActionPreference='SilentlyContinue';" ^
  "function Get-LatestTag($base,$repo){" ^
  "  try { $r=Invoke-RestMethod -Uri \"$base/repos/$repo/releases/latest\"; if($r.tag_name){return $r.tag_name} } catch {}" ^
  "  try { $tags=Invoke-RestMethod -Uri \"$base/repos/$repo/tags\";" ^
  "    $vs=$tags | Where-Object { $_.name -match '^v?\d+\.\d+\.\d+(-[0-9]+\.[0-9]+)?$' } | ForEach-Object {" ^
  "      $n=$_.name.TrimStart('v');" ^
  "      if($n -match '^(\d+)\.(\d+)\.(\d+)'){ [PSCustomObject]@{name=$_.name; k=([int]$Matches[1]*1000000+[int]$Matches[2]*1000+[int]$Matches[3])} } };" ^
  "    return (($vs | Sort-Object k | Select-Object -Last 1).name) } catch {}" ^
  "  return $null" ^
  "}" ^
  "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12;" ^
  "$hosts = @(@('gitee','https://gitee.com/api/v5','nuoge233/wow'), @('github','https://api.github.com','nuoge2333/Wow-'));" ^
  "foreach($h in $hosts){ $t=Get-LatestTag $h[1] $h[2]; if($t){ Write-Output $h[0]; Write-Output $t; break } }" ^
  > "%TEMP_DIR%\resolve.txt" 2>nul

set RELEASE_HOST=
set LATEST_TAG=
set /a IDX=0
for /f "usebackq delims=" %%a in ("%TEMP_DIR%\resolve.txt") do (
    if !IDX!==0 ( set RELEASE_HOST=%%a ) else ( set LATEST_TAG=%%a )
    set /a IDX+=1
)

if "%LATEST_TAG%"=="" (
    echo Cannot access Gitee/GitHub API. Check your network.
    goto :cleanup
)

echo Latest: %LATEST_TAG% (source: %RELEASE_HOST%)
echo.

:: Build download URL from source archive (works without a published Release)
if "%RELEASE_HOST%"=="gitee" (
    set DOWNLOAD_URL=https://gitee.com/%GITEE_REPO%/repository/archive/%LATEST_TAG%.zip
) else (
    set DOWNLOAD_URL=https://github.com/%GITHUB_REPO%/archive/refs/tags/%LATEST_TAG%.zip
)
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
