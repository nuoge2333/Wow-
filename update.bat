@echo off
setlocal enabledelayedexpansion
:: wow~ 更新脚本 (Windows)
:: 从 GitHub Releases 下载最新版本并覆盖更新
:: 保留 server\ pool\ jre\ schemes\ node_modules\ 等运行时目录

set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"

set TEMP_DIR=%TEMP%\wow_update_%RANDOM%
set TEMP_ZIP=%TEMP_DIR%\update.zip

echo ========================================
echo   wow~ 自动更新工具
echo ========================================
echo.

:: 获取最新 Release 信息
echo 正在检查最新版本...
powershell -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try { $r = Invoke-RestMethod -Uri 'https://api.github.com/repos/nuoge2333/Wow-/releases/latest'; Write-Output $r.tag_name; Write-Output $r.assets[0].browser_download_url } catch { Write-Output 'ERROR' } }" > "%TEMP_DIR%\release.txt" 2>nul

if not exist "%TEMP_DIR%\release.txt" (
    echo 无法访问 GitHub API，请检查网络
    goto :cleanup
)

:: 读取版本号和下载链接
set /p LATEST_TAG=<"%TEMP_DIR%\release.txt"
:: 第二行是下载链接 - 用 more +1 跳过第一行
for /f "usebackq skip=1 delims=" %%a in ("%TEMP_DIR%\release.txt") do (
    set DOWNLOAD_URL=%%a
    goto :got_url
)
:got_url

if "%LATEST_TAG%"=="ERROR" (
    echo 无法获取版本信息
    goto :cleanup
)

echo 最新版本: %LATEST_TAG%
echo 下载地址: %DOWNLOAD_URL%
echo.

:: 下载
echo 正在下载更新包...
powershell -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%DOWNLOAD_URL%' -OutFile '%TEMP_ZIP%' }"
if errorlevel 1 (
    echo 下载失败
    goto :cleanup
)
echo 下载完成
echo.

:: 解压
echo 正在安装更新...
mkdir "%TEMP_DIR%\extract" 2>nul
powershell -Command "& { Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('%TEMP_ZIP%', '%TEMP_DIR%\extract'); }"
if errorlevel 1 (
    echo 解压失败
    goto :cleanup
)

:: 找到解压后的项目目录（可能有一层嵌套）
set EXTRACT_DIR=%TEMP_DIR%\extract
:: 检查是否只有一层子目录
set COUNT=0
for /d %%d in ("%EXTRACT_DIR%\*") do set /a COUNT+=1
if !COUNT! equ 1 (
    for /d %%d in ("%EXTRACT_DIR%\*") do set EXTRACT_DIR=%%d
)

:: 覆盖更新
echo 正在覆盖文件...
xcopy /E /Y /Q "%EXTRACT_DIR%\*" "%SCRIPT_DIR%" >nul 2>&1

echo.
echo ========================================
echo   更新完成! %LATEST_TAG%
echo ========================================
echo.
echo 运行 start.bat 启动 wow~

:cleanup
rmdir /s /q "%TEMP_DIR%" 2>nul
pause
